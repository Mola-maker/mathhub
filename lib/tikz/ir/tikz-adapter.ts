import type { Analysis } from '../analyze';
import {
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
  type ManagedConstructionSemanticRecord,
} from '../semantics/managed-construction';
import type { SceneElement, ScenePoint } from '../semantics/scene';
import { tikzPictureBodyEndOffset } from '../document/tikz-envelope';
import { diagnoseConstraintStructure } from '../solver/constraint-diagnostics';
import {
  qualifiedManagedEntityReference,
  qualifiedSourceCircleReference,
} from './persistent-entity-reference';
import {
  GEOMETRY_IR_SCHEMA_VERSION,
  type ConstructionBinding,
  type ConstructionTruth,
  type GeometryConstraint,
  type GeometryDiagnostic,
  type GeometryEntity,
  type GeometryExpression,
  type GeometryIR,
  type GeometryRelation,
  type GeometryBindableRecordReference,
  type GeometryRevisionBasis,
  type GeometryStyle,
  type GeometryTruthSet,
  type JsonObject,
  type LosslessSourceReference,
  type OpaqueConstructionNode,
  type RenderPrimitive,
  type RenderingTruth,
  type SemanticTruth,
  type SourceDocument,
  type SourceDocumentReference,
} from './model';

export const TIKZ_SEMANTIC_ADAPTER_ID = 'mathgeo.tikz.semantic-adapter';
export const TIKZ_SEMANTIC_ADAPTER_VERSION = '1.11.0';
export const TIKZ_PLUGIN_SET_DIGEST =
  `${TIKZ_SEMANTIC_ADAPTER_ID}@${TIKZ_SEMANTIC_ADAPTER_VERSION}`;

export interface TikzGeometryProjectionInput {
  analysis: Analysis;
  source: string;
  basis: GeometryRevisionBasis;
  hashAlgorithm: string;
}

function sourceDocumentOf(input: TikzGeometryProjectionInput): SourceDocument {
  return {
    sourceId: input.basis.sourceId ?? `${input.basis.documentId}:tikz`,
    languageId: 'tikz',
    revision: input.basis.revision,
    hash: input.basis.sourceHash,
    hashAlgorithm: input.hashAlgorithm,
    offsetUnit: 'utf16-code-unit',
    encoding: 'utf-8',
    length: input.source.length,
    text: input.source,
  };
}

function sourceReference(
  document: SourceDocumentReference,
  source: string,
  range: { start: number; end: number },
): LosslessSourceReference {
  return {
    document,
    range: { ...range },
    verbatim: source.slice(range.start, range.end),
  };
}

function statementRange(
  analysis: Analysis,
  stmtIndex: number,
): { start: number; end: number } | null {
  const range = analysis.stmts?.[stmtIndex]?.range;
  return range ? { ...range } : null;
}

function styleProperties(element: SceneElement): JsonObject {
  return {
    stroke: element.style.stroke,
    strokeWidth: element.style.strokeWidth,
    dash: element.style.dash,
    arrow: element.style.arrow,
    fill: element.style.fill,
    fillOpacity: element.style.fillOpacity,
    opacity: element.style.opacity,
  };
}

function pointEntity(point: ScenePoint): GeometryEntity {
  return {
    recordType: 'entity',
    id: point.stableId,
    kind: 'point',
    name: point.name,
    dimension: 0,
    parameters: {
      x: point.position.x,
      y: point.position.y,
      free: point.free,
    },
    sourceBindingIds: [`binding:${point.stableId}`],
    tags: point.free ? ['free'] : ['derived'],
  };
}

function elementEntity(element: SceneElement): GeometryEntity {
  const common = {
    recordType: 'entity' as const,
    id: element.stableId,
    sourceBindingIds: [`binding:${element.stableId}`],
  };
  switch (element.kind) {
    case 'polyline':
      return {
        ...common,
        kind: element.cycle ? 'polygon' : 'polyline',
        dimension: 1,
        parameters: {
          points: element.points.map((point) => ({ x: point.x, y: point.y })),
          cycle: element.cycle,
          references: element.refs,
        },
      };
    case 'circle': {
      const persistentReference = element.definition
        ? qualifiedSourceCircleReference(element.definition)
        : null;
      return {
          ...common,
          kind: 'circle',
          dimension: 1,
          parameters: {
            center: { x: element.center.x, y: element.center.y },
            radius: element.radius,
            references: element.refs,
            ...(element.definition
              ? { circleDefinition: { ...element.definition } }
              : {}),
          },
          ...(persistentReference
            ? { metadata: { persistentSourceReference: persistentReference } }
            : {}),
        };
      }
    case 'label':
      return {
        ...common,
        kind: 'label',
        dimension: 0,
        parameters: {
          at: { x: element.at.x, y: element.at.y },
          text: element.text,
          anchor: element.anchor,
          references: element.refs,
        },
      };
    case 'angle-mark':
      return {
        ...common,
        kind: element.right ? 'right-angle-mark' : 'angle-mark',
        dimension: 1,
        parameters: {
          vertex: { x: element.vertex.x, y: element.vertex.y },
          from: { x: element.from.x, y: element.from.y },
          to: { x: element.to.x, y: element.to.y },
          references: element.refs,
        },
      };
  }
}

function dependencyRelations(
  points: readonly ScenePoint[],
  pointIdsByName: ReadonlyMap<string, string>,
): GeometryRelation[] {
  return points.flatMap((point) => point.dependsOn.map((dependency, index) => ({
    recordType: 'relation' as const,
    id: `relation:depends:${point.stableId}:${dependency}:${index}`,
    kind: 'depends-on',
    directed: true,
    participants: [
      { role: 'dependent', entityId: point.stableId },
      { role: 'dependency', entityId: dependency.startsWith('path:')
        ? dependency
        : pointIdsByName.get(dependency) ?? `unresolved:point:${dependency}` },
    ],
  })));
}

function publicSemanticPoints(
  points: readonly ScenePoint[],
): ScenePoint[] {
  const byName = new Map(points.map((point) => [point.name, point] as const));
  const expandDependency = (
    dependency: string,
    visited: ReadonlySet<string>,
  ): string[] => {
    if (dependency.startsWith('path:')) return [dependency];
    const point = byName.get(dependency);
    if (!point?.internal) return [dependency];
    if (visited.has(dependency)) return [];
    const nextVisited = new Set(visited);
    nextVisited.add(dependency);
    return point.dependsOn.flatMap((item) => (
      expandDependency(item, nextVisited)
    ));
  };
  return points
    .filter((point) => !point.internal)
    .map((point) => ({
      ...point,
      dependsOn: [...new Set(
        point.dependsOn.flatMap((dependency) => (
          expandDependency(dependency, new Set([point.name]))
        )),
      )],
    }));
}

function namedPathEntitiesOf(input: TikzGeometryProjectionInput): GeometryEntity[] {
  const seen = new Set<string>();
  return (input.analysis.stmts ?? []).flatMap((statement, statementIndex) => {
    if (
      statement.kind !== 'path'
      || !statement.namePath
      || seen.has(statement.namePath)
    ) return [];
    seen.add(statement.namePath);
    return [{
      recordType: 'entity' as const,
      id: `path:${statement.namePath}`,
      kind: 'path',
      name: statement.namePath,
      dimension: 1 as const,
      parameters: {
        command: statement.command,
        statementIndex,
        geometryKinds: statement.specs.map((spec) => spec.type),
      },
      tags: ['named-path', statement.command],
      sourceBindingIds: [`binding:path:${statement.namePath}`],
    }];
  });
}

function pointConstraints(
  points: readonly ScenePoint[],
  pointIdsByName: ReadonlyMap<string, string>,
): GeometryConstraint[] {
  return points.flatMap((point) => {
    const constraint = point.constraint;
    if (!constraint) return [];
    return [{
      recordType: 'constraint' as const,
      id: `constraint:on-circle:${point.stableId}`,
      kind: 'point-on-circle',
      strength: 'required' as const,
      enabled: true,
      arguments: [
        { role: 'point', entityId: point.stableId },
        {
          role: 'center',
          entityId: pointIdsByName.get(constraint.centerName)
            ?? `unresolved:point:${constraint.centerName}`,
        },
        ...(constraint.throughName
          ? [{
            role: 'through',
            entityId: pointIdsByName.get(constraint.throughName)
              ?? `unresolved:point:${constraint.throughName}`,
          }]
          : []),
      ],
      parameters: {
        parameterKind: 'angle-degrees',
        parameter: constraint.angleDeg,
        radius: constraint.radius,
        domain: 'circle',
        parameterRanges: constraint.angleRanges.map((range) => ({
          start: range.start,
          end: range.end,
        })),
      },
      sourceBindingIds: [`binding:${point.stableId}`],
    }];
  });
}

const MANAGED_ARGUMENT_ROLES: Readonly<Record<
  string,
  { inputs: readonly string[]; outputs: readonly string[] }
>> = {
  'rectangle-by-opposite-corners': {
    inputs: ['first-corner', 'opposite-corner'],
    outputs: ['second-corner', 'fourth-corner'],
  },
  midpoint: {
    inputs: ['segment-start', 'segment-end'],
    outputs: ['midpoint'],
  },
  'perpendicular-foot': {
    inputs: ['projected-point', 'reference-start', 'reference-end'],
    outputs: ['foot'],
  },
  'point-on-circle': {
    inputs: ['host-circle'],
    outputs: ['point'],
  },
  'parallel-line': {
    inputs: ['through', 'reference-start', 'reference-end'],
    outputs: ['direction-point'],
  },
  'perpendicular-line': {
    inputs: ['through', 'reference-start', 'reference-end'],
    outputs: ['direction-point'],
  },
  'perpendicular-bisector': {
    inputs: ['segment-start', 'segment-end'],
    outputs: ['midpoint', 'direction-point', 'line'],
  },
  'angle-bisector': {
    inputs: ['arm-start', 'vertex', 'arm-end'],
    outputs: ['direction-point', 'line'],
  },
  circumcircle: {
    inputs: ['point-a', 'point-b', 'point-c'],
    outputs: ['center', 'circle'],
  },
  'tangent-at-point': {
    inputs: ['circle'],
    outputs: ['touch-point', 'direction-point', 'line'],
  },
  'reflect-point': {
    inputs: ['source-point', 'center'],
    outputs: ['image-point'],
  },
  'reflect-line': {
    inputs: ['source-point', 'axis-start', 'axis-end'],
    outputs: ['foot', 'image-point'],
  },
  'rotate-90': {
    inputs: ['source-point', 'center'],
    outputs: ['image-point'],
  },
  'homothety-2': {
    inputs: ['source-point', 'center'],
    outputs: ['image-point'],
  },
  'inversion-point': {
    inputs: ['point', 'center', 'radius-point'],
    outputs: ['inverted-point', 'inversion-guide'],
  },
  'radical-axis': {
    inputs: ['first-circle', 'second-circle'],
    outputs: ['radical-axis-point', 'radical-axis-direction', 'radical-axis-line'],
  },
  'cyclic-quadrilateral': {
    inputs: ['vertex', 'vertex', 'vertex', 'secant-direction'],
    outputs: [
      'circumcenter',
      'fourth-vertex',
      'circumcircle',
      'secant-line',
      'cyclic-quadrilateral',
    ],
  },
  'complete-quadrilateral': {
    inputs: ['vertex', 'vertex', 'vertex', 'vertex'],
    outputs: [
      'opposite-intersection-1',
      'opposite-intersection-2',
      'side-line-ab',
      'side-line-bc',
      'side-line-cd',
      'side-line-da',
      'diagonal-segment',
    ],
  },
};

function managedEntityId(
  reference: string,
  pointIdsByName: ReadonlyMap<string, string>,
  entityIds: ReadonlySet<string>,
): string {
  if (entityIds.has(reference)) return reference;
  const pointId = pointIdsByName.get(reference);
  if (pointId) return pointId;
  return (
    reference.startsWith('point:')
    || reference.startsWith('path:')
    || reference.startsWith('element:')
  )
    ? reference
    : `unresolved:reference:${reference}`;
}

function managedArguments(
  block: ManagedConstructionBlock,
  pointIdsByName: ReadonlyMap<string, string>,
  entityIds: ReadonlySet<string>,
  persistentAliases: ReadonlyMap<string, string>,
) {
  const roles = MANAGED_ARGUMENT_ROLES[block.planKind];
  return [
    ...block.inputs.map((reference, index) => ({
      role: roles?.inputs[index] ?? `input-${index + 1}`,
      entityId: persistentAliases.get(reference)
        ?? managedEntityId(reference, pointIdsByName, entityIds),
    })),
    ...block.outputs.map((reference, index) => ({
      role: roles?.outputs[index] ?? `output-${index + 1}`,
      entityId: persistentAliases.get(reference)
        ?? managedEntityId(reference, pointIdsByName, entityIds),
    })),
  ];
}

type ManagedEntityRecord = Extract<
  ManagedConstructionSemanticRecord,
  { recordType: 'entity' }
>;

type ManagedConstraintRecord = Extract<
  ManagedConstructionSemanticRecord,
  { recordType: 'constraint' }
>;

function assertNever(value: never): never {
  throw new Error(`Unexpected managed constraint kind: ${String(value)}`);
}

/**
 * Keep constraint parameters explicit and exhaustive at the adapter boundary.
 * Only constraints with scalar/branch metadata expose a `parameters` field;
 * all other managed constraint records deliberately return `undefined`.
 */
function constraintParametersOf(
  record: ManagedConstraintRecord,
): GeometryConstraint['parameters'] | undefined {
  switch (record.kind) {
    case 'rotation':
      return { angleDegrees: record.angleDegrees };
    case 'homothety':
      return { scale: record.scale };
    case 'line-intersection':
      return { domain: record.domain };
    case 'line-circle-other-intersection':
      return {
        domain: record.domain,
        selector: record.selector,
      };
    case 'point-reflection':
    case 'line-reflection':
    case 'midpoint':
    case 'perpendicular-foot':
    case 'on-circle':
    case 'circle-through-three-points':
    case 'tangent-at-point':
    case 'perpendicular-bisector':
    case 'angle-bisector':
    case 'parallel':
    case 'perpendicular':
    case 'inversion':
    case 'radical-axis':
    case 'cyclic':
    case 'complete-quadrilateral':
      return undefined;
    default:
      return assertNever(record);
  }
}

interface ManagedEntityOverlay {
  definition?: GeometryExpression;
  semanticKind: string;
  dimension: 0 | 1 | 2;
  semanticReferences?: readonly string[];
  tags: readonly string[];
  sourceBindingIds: readonly string[];
  constructionIds: readonly string[];
  sourceRecordIds: readonly string[];
  semanticKinds: readonly string[];
}

function referenceListOf(entity: GeometryEntity): readonly string[] | null {
  const references = entity.parameters?.references;
  return Array.isArray(references)
    && references.every((value) => typeof value === 'string')
    ? references
    : null;
}

function sourceEntitySemanticKeys(entity: GeometryEntity): readonly string[] {
  const references = referenceListOf(entity);
  if (!references) return [];
  const exact = `${entity.kind}:${references.join('\u0000')}`;
  if (entity.kind === 'circle') {
    const definitionReference = entity.metadata?.persistentSourceReference;
    return typeof definitionReference === 'string'
      ? [`circle-definition:${definitionReference}`, exact]
      : [exact];
  }
  if (entity.kind !== 'polyline') return [exact];
  const uniqueReferences = references.filter(
    (reference, index) => references.indexOf(reference) === index,
  );
  if (uniqueReferences.length !== 2 || references.length === 2) return [exact];
  // Extended TikZ lines/rays repeat the two defining references inside calc
  // coordinates (A,B,A,B or A,A,B). Keep both the lossless syntax key and the
  // normalized two-point projection key so typed semantic identity can bind.
  return [
    exact,
    `polyline:${uniqueReferences.join('\u0000')}`,
  ];
}

function managedEntitySemanticKey(record: ManagedEntityRecord): string | null {
  switch (record.kind) {
    case 'point':
      return null;
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return `polyline:${record.from}\u0000${record.to}`;
    case 'polyline':
    case 'polygon':
      return `${record.kind}:${record.vertices.join('\u0000')}`;
    case 'rectangle':
      return `polygon:${record.corners.join('\u0000')}`;
    case 'circle': {
      const definitionReference = qualifiedSourceCircleReference(
        'through' in record
          ? {
            kind: 'center-through',
            centerName: record.center,
            throughName: record.through,
          }
          : {
            kind: 'center-radius',
            centerName: record.center,
            radius: record.radius,
          },
      );
      return definitionReference
        ? `circle-definition:${definitionReference}`
        : null;
    }
    case 'label':
      return `label:${record.at}`;
    case 'angle':
      return `angle-mark:${record.points.join('\u0000')}`;
    case 'right-angle':
      return `right-angle-mark:${record.points.join('\u0000')}`;
  }
}

function managedEntityReferences(
  record: ManagedEntityRecord,
): readonly string[] | undefined {
  switch (record.kind) {
    case 'point':
      return undefined;
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return [record.from, record.to];
    case 'polyline':
    case 'polygon':
      return record.vertices;
    case 'rectangle':
      return record.corners;
    case 'circle':
      return 'through' in record
        ? [record.center, record.through]
        : [record.center];
    case 'label':
      return [record.at];
    case 'angle':
    case 'right-angle':
      return record.points;
  }
}

function uniqueSourceEntityIdsBySemanticKey(
  entities: readonly GeometryEntity[],
  sourceRanges: ReadonlyMap<string, { start: number; end: number }>,
  managedBodyRange: { start: number; end: number },
): ReadonlyMap<string, string> {
  const candidates = new Map<string, string | null>();
  for (const entity of entities) {
    const sourceRange = sourceRanges.get(entity.id);
    if (
      !sourceRange
      || sourceRange.start < managedBodyRange.start
      || sourceRange.end > managedBodyRange.end
    ) continue;
    const keys = sourceEntitySemanticKeys(entity);
    for (const key of keys) {
      if (candidates.has(key)) {
        candidates.set(key, null);
      } else {
        candidates.set(key, entity.id);
      }
    }
  }
  return new Map(
    [...candidates.entries()].flatMap(([key, id]) => (
      id === null ? [] : [[key, id] as const]
    )),
  );
}

function relationSemanticKey(
  kind: string,
  directed: boolean,
  entityIds: readonly string[],
): string {
  return `${kind}:${directed ? 'directed' : 'undirected'}:${entityIds.join('\u0000')}`;
}

function ambiguousManagedConstructionIds(
  blocks: readonly ManagedConstructionBlock[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
  }
  return new Set(
    [...counts].flatMap(([id, count]) => count > 1 ? [id] : []),
  );
}

function managedBlockBindingId(
  block: ManagedConstructionBlock,
  ambiguousIds: ReadonlySet<string>,
): string {
  return ambiguousIds.has(block.id)
    ? `binding:managed:${block.id}:ambiguous:${block.range.start}`
    : `binding:managed:${block.id}`;
}

function managedRecordBindingId(
  blockBindingId: string,
  recordType: string,
  recordId: string,
): string {
  return `${blockBindingId}:record:${recordType}:${recordId}`;
}


function managedConstructionSemantics(
  blocks: readonly ManagedConstructionBlock[],
  ambiguousIds: ReadonlySet<string>,
  pointIdsByName: ReadonlyMap<string, string>,
  sourceEntities: readonly GeometryEntity[],
  sourceEntityRanges: ReadonlyMap<string, { start: number; end: number }>,
): {
  entities: GeometryEntity[];
  constraints: GeometryConstraint[];
  relations: GeometryRelation[];
  entityOverlays: ReadonlyMap<string, ManagedEntityOverlay>;
  constrainedPointIds: ReadonlySet<string>;
  relationKeys: ReadonlySet<string>;
  targetsByBlock: ReadonlyMap<string, readonly GeometryBindableRecordReference[]>;
  targetsByRecordBinding: ReadonlyMap<
    string,
    readonly GeometryBindableRecordReference[]
  >;
  extraEntityBindingIds: ReadonlyMap<string, readonly string[]>;
} {
  const entities: GeometryEntity[] = [];
  const constraints: GeometryConstraint[] = [];
  const relations: GeometryRelation[] = [];
  const entityOverlays = new Map<string, ManagedEntityOverlay>();
  const constrainedPointIds = new Set<string>();
  const relationKeys = new Set<string>();
  const targetsByBlock = new Map<
    string,
    readonly GeometryBindableRecordReference[]
  >();
  const targetsByRecordBinding = new Map<
    string,
    readonly GeometryBindableRecordReference[]
  >();
  const extraEntityBindingIds = new Map<string, string[]>();
  const addEntityBinding = (entityId: string, bindingId: string): void => {
    const current = extraEntityBindingIds.get(entityId) ?? [];
    if (!current.includes(bindingId)) {
      extraEntityBindingIds.set(entityId, [...current, bindingId]);
    }
  };
  const knownEntityIds = new Set(sourceEntities.map((entity) => entity.id));
  const persistentEntityAliases = new Map<string, string>();
  // Raw circle definition signatures are deliberately not aliases here. They
  // are revision-local selection keys, not entity identities: a different
  // statement can acquire the old center/radius definition after an edit.
  // Persisted dependencies must therefore target an adopted managed entity.
  // Managed records are persisted independently from runtime Scene UUIDs.
  // Pre-index every valid entity record so a later construction can reference
  // an earlier or later managed entity with a stable, document-level name.
  const crossBlockEntityAliases = new Map<string, string>();
  for (const block of blocks) {
    if (ambiguousIds.has(block.id)) continue;
    if (
      block.metadataStatus !== 'valid'
      || !(
        block.integrityStatus === 'valid'
        || block.integrityStatus === 'absent'
      )
    ) continue;
    const sourceEntityIdsBySemanticKey = uniqueSourceEntityIdsBySemanticKey(
      sourceEntities,
      sourceEntityRanges,
      block.tikzBodyRange,
    );
    for (const record of block.records) {
      if (record.recordType !== 'entity') continue;
      const existingPointId = record.kind === 'point'
        ? pointIdsByName.get(record.name)
        : undefined;
      const semanticKey = managedEntitySemanticKey(record);
      const existingSemanticId = semanticKey
        ? sourceEntityIdsBySemanticKey.get(semanticKey)
        : undefined;
      const id = existingPointId
        ?? existingSemanticId
        ?? (knownEntityIds.has(record.id)
          ? record.id
          : `entity:managed:${block.id}:${record.id}`);
      crossBlockEntityAliases.set(
        qualifiedManagedEntityReference(block.id, record.id),
        id,
      );
      persistentEntityAliases.set(
        qualifiedManagedEntityReference(block.id, record.id),
        id,
      );
    }
  }

  const uniqueTargets = (
    values: readonly GeometryBindableRecordReference[],
  ): GeometryBindableRecordReference[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = `${value.recordType}:${value.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  for (const block of blocks) {
    const bindingId = managedBlockBindingId(block, ambiguousIds);
    if (ambiguousIds.has(block.id)) {
      // Duplicate construction IDs make the writer target ambiguous. Preserve
      // source rendering, but do not project either block as writable managed
      // semantics.
      targetsByBlock.set(bindingId, []);
      continue;
    }
    const sourceEntityIdsBySemanticKey = uniqueSourceEntityIdsBySemanticKey(
      sourceEntities,
      sourceEntityRanges,
      block.tikzBodyRange,
    );
    const semanticRecords = (
      block.metadataStatus === 'valid'
      && (
        block.integrityStatus === 'valid'
        || block.integrityStatus === 'absent'
      )
    )
      ? block.records
      : [];

    if (
      semanticRecords.length === 0
      && block.metadataStatus !== 'absent'
    ) {
      // Versioned metadata is authoritative. Invalid, unsupported or detached
      // payloads must not be silently reinterpreted from the lossy header.
      targetsByBlock.set(bindingId, []);
      continue;
    }

    if (semanticRecords.length === 0) {
      const targets: GeometryBindableRecordReference[] = [];
      if (block.kind !== 'point-on-circle') {
        const constraint: GeometryConstraint = {
          recordType: 'constraint',
          id: `constraint:managed:${block.id}`,
          kind: block.planKind === 'primitive' ? block.kind : block.planKind,
          strength: 'required',
          enabled: true,
          arguments: managedArguments(
            block,
            pointIdsByName,
            knownEntityIds,
            persistentEntityAliases,
          ),
          sourceBindingIds: [bindingId],
          metadata: {
            constructionId: block.id,
            constructionPlanKind: block.planKind,
            constructionSyntaxKind: block.kind,
            source: 'mathgeo-managed-header-fallback',
            metadataStatus: block.metadataStatus,
            integrityStatus: block.integrityStatus,
          },
        };
        constraints.push(constraint);
        targets.push({ recordType: 'constraint', id: constraint.id });
      }
      const relation: GeometryRelation = {
        recordType: 'relation',
        id: `relation:managed:${block.id}`,
        kind: 'construction-dependency',
        directed: true,
        participants: managedArguments(
          block,
          pointIdsByName,
          knownEntityIds,
          persistentEntityAliases,
        ),
        properties: {
          constructionId: block.id,
          constructionKind: block.planKind,
          constructionSyntaxKind: block.kind,
          inputs: block.inputs.length,
          outputs: block.outputs.length,
          metadataStatus: block.metadataStatus,
          integrityStatus: block.integrityStatus,
        },
        sourceBindingIds: [bindingId],
      };
      relations.push(relation);
      targets.push({ recordType: 'relation', id: relation.id });
      targetsByBlock.set(bindingId, targets);
      continue;
    }

    const entityRecords = semanticRecords.filter(
      (record): record is Extract<
        ManagedConstructionSemanticRecord,
        { recordType: 'entity' }
      > => record.recordType === 'entity',
    );
    const aliases = new Map<string, string>();
    for (const record of entityRecords) {
      const existingPointId = record.kind === 'point'
        ? pointIdsByName.get(record.name)
        : undefined;
      const semanticKey = managedEntitySemanticKey(record);
      const existingSemanticId = semanticKey
        ? sourceEntityIdsBySemanticKey.get(semanticKey)
        : undefined;
      const id = existingPointId
        ?? existingSemanticId
        ?? (knownEntityIds.has(record.id)
          ? record.id
          : `entity:managed:${block.id}:${record.id}`);
      aliases.set(record.id, id);
      aliases.set(record.name, id);
    }

    const resolve = (reference: string): string => (
      aliases.get(reference)
      ?? crossBlockEntityAliases.get(reference)
      ?? persistentEntityAliases.get(reference)
      ?? managedEntityId(reference, pointIdsByName, knownEntityIds)
    );
    const entityReference = (reference: string): GeometryExpression => ({
      kind: 'entity-reference',
      entityId: resolve(reference),
    });
    const pointPositionValue = (
      position: NonNullable<Extract<ManagedEntityRecord, { kind: 'point' }>['position']>,
    ): JsonObject | readonly [number, number] => (
      'x' in position && 'y' in position
        ? { x: position.x, y: position.y }
        : [position[0], position[1]]
    );
    const definitionOf = (
      record: Extract<
        ManagedConstructionSemanticRecord,
        { recordType: 'entity' }
      >,
    ): GeometryExpression | undefined => {
      switch (record.kind) {
        case 'point':
          return record.position === undefined
            ? undefined
            : {
              kind: 'literal',
              value: pointPositionValue(record.position),
            };
        case 'segment':
        case 'vector':
        case 'line':
        case 'ray':
          return {
            kind: 'operation',
            operator: record.kind,
            arguments: [
              entityReference(record.from),
              entityReference(record.to),
            ],
          };
        case 'polyline':
        case 'polygon':
          return {
            kind: 'operation',
            operator: record.kind,
            arguments: record.vertices.map(entityReference),
          };
        case 'rectangle':
          return {
            kind: 'operation',
            operator: 'axis-aligned-rectangle-from-opposite-corners',
            arguments: record.corners.map(entityReference),
          };
        case 'circle':
          return 'through' in record
            ? {
              kind: 'operation',
              operator: 'circle-through-point',
              arguments: [
                entityReference(record.center),
                entityReference(record.through),
              ],
            }
            : {
              kind: 'operation',
              operator: 'circle-center-radius',
              arguments: [entityReference(record.center)],
              parameters: { radius: record.radius },
            };
        case 'label':
          return {
            kind: 'operation',
            operator: 'label-at-point',
            arguments: [entityReference(record.at)],
            parameters: { text: record.text },
          };
        case 'angle':
        case 'right-angle':
          return {
            kind: 'operation',
            operator: record.kind,
            arguments: record.points.map(entityReference),
          };
      }
    };
    const dimensionOf = (
      kind: Extract<
        ManagedConstructionSemanticRecord,
        { recordType: 'entity' }
      >['kind'],
    ): 0 | 1 | 2 => {
      if (kind === 'point' || kind === 'label') return 0;
      // Primitive polygons, circles and angle marks are 1D rendered boundaries.
      // Rectangle is the semantic 2D region; its polygon boundary is a separate
      // managed entity emitted by the rectangle construction.
      if (kind === 'rectangle') return 2;
      return 1;
    };

    const targets: GeometryBindableRecordReference[] = [];
    for (const record of entityRecords) {
      const id = aliases.get(record.id)!;
      const target = { recordType: 'entity' as const, id };
      const recordBindingId = managedRecordBindingId(
        bindingId,
        record.recordType,
        record.id,
      );
      targets.push(target);
      targetsByRecordBinding.set(recordBindingId, [target]);
      addEntityBinding(id, recordBindingId);
      const definition = definitionOf(record);
      const semanticReferences = managedEntityReferences(record);
      if (knownEntityIds.has(id)) {
        const previous = entityOverlays.get(id);
        entityOverlays.set(id, {
          definition: previous?.definition ?? definition,
          semanticKind: record.kind,
          dimension: dimensionOf(record.kind),
          semanticReferences:
            semanticReferences ?? previous?.semanticReferences,
          tags: [...new Set([...(previous?.tags ?? []), ...(record.tags ?? [])])],
          sourceBindingIds: [
            ...new Set([
              ...(previous?.sourceBindingIds ?? []),
              recordBindingId,
              bindingId,
            ]),
          ],
          constructionIds: [
            ...new Set([...(previous?.constructionIds ?? []), block.id]),
          ],
          sourceRecordIds: [
            ...new Set([...(previous?.sourceRecordIds ?? []), record.id]),
          ],
          semanticKinds: [
            ...new Set([...(previous?.semanticKinds ?? []), record.kind]),
          ],
        });
        continue;
      }
      const entity: GeometryEntity = {
        recordType: 'entity',
        id,
        kind: record.kind,
        name: record.name,
        dimension: dimensionOf(record.kind),
        definition,
        parameters: semanticReferences
          ? { references: semanticReferences }
          : undefined,
        tags: record.tags,
        sourceBindingIds: [recordBindingId, bindingId],
        metadata: {
          constructionId: block.id,
          constructionKind: block.planKind,
          constructionSyntaxKind: block.kind,
          sourceRecordId: record.id,
          source: 'mathgeo-managed-record',
          semanticOnly: true,
          visualEntityMatch: 'none',
        },
      };
      entities.push(entity);
      knownEntityIds.add(entity.id);
    }

    for (const record of semanticRecords) {
      if (record.recordType === 'constraint') {
        const recordBindingId = managedRecordBindingId(
          bindingId,
          record.recordType,
          record.id,
        );
        const argumentsForRecord: GeometryConstraint['arguments'] = (() => {
          switch (record.kind) {
            case 'point-reflection':
              return [
                { role: 'source', entityId: resolve(record.source) },
                { role: 'center', entityId: resolve(record.center) },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'line-reflection':
              return [
                { role: 'source', entityId: resolve(record.source) },
                { role: 'axis-start', entityId: resolve(record.axisStart) },
                { role: 'axis-end', entityId: resolve(record.axisEnd) },
                { role: 'foot', entityId: resolve(record.foot) },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'rotation':
              return [
                { role: 'source', entityId: resolve(record.source) },
                { role: 'center', entityId: resolve(record.center) },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'homothety':
              return [
                { role: 'source', entityId: resolve(record.source) },
                { role: 'center', entityId: resolve(record.center) },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'midpoint':
              return [
                { role: 'point', entityId: resolve(record.point) },
                { role: 'segment-start', entityId: resolve(record.a) },
                { role: 'segment-end', entityId: resolve(record.b) },
              ];
            case 'perpendicular-foot':
              return [
                { role: 'point', entityId: resolve(record.point) },
                {
                  role: 'reference-start',
                  entityId: resolve(record.lineStart),
                },
                {
                  role: 'reference-end',
                  entityId: resolve(record.lineEnd),
                },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'on-circle':
              return [
                { role: 'point', entityId: resolve(record.point) },
                { role: 'circle', entityId: resolve(record.circle) },
              ];
            case 'circle-through-three-points':
              return [
                { role: 'circle', entityId: resolve(record.circle) },
                { role: 'center', entityId: resolve(record.center) },
                ...record.points.map((reference, index) => ({
                  role: `point-${index + 1}`,
                  entityId: resolve(reference),
                })),
              ];
            case 'tangent-at-point':
              return [
                { role: 'line', entityId: resolve(record.line) },
                { role: 'touch-point', entityId: resolve(record.touch) },
                { role: 'circle', entityId: resolve(record.circle) },
                { role: 'center', entityId: resolve(record.center) },
              ];
            case 'perpendicular-bisector':
              return [
                { role: 'line', entityId: resolve(record.line) },
                {
                  role: 'midpoint',
                  entityId: resolve(record.midpoint),
                },
                { role: 'segment-start', entityId: resolve(record.a) },
                { role: 'segment-end', entityId: resolve(record.b) },
              ];
            case 'angle-bisector':
              return [
                { role: 'line', entityId: resolve(record.line) },
                { role: 'arm-a', entityId: resolve(record.armA) },
                { role: 'vertex', entityId: resolve(record.vertex) },
                { role: 'arm-b', entityId: resolve(record.armB) },
              ];
            case 'parallel':
            case 'perpendicular':
              return [
                { role: 'line', entityId: resolve(record.line) },
                { role: 'reference', entityId: resolve(record.reference) },
              ];
            case 'inversion':
              return [
                { role: 'point', entityId: resolve(record.point) },
                { role: 'center', entityId: resolve(record.center) },
                { role: 'radius-point', entityId: resolve(record.radius) },
                { role: 'result', entityId: resolve(record.result) },
              ];
            case 'radical-axis':
              return [
                { role: 'line', entityId: resolve(record.line) },
                { role: 'equal-power-point', entityId: resolve(record.point) },
                { role: 'first-circle', entityId: resolve(record.circle1) },
                { role: 'second-circle', entityId: resolve(record.circle2) },
              ];
            case 'line-intersection':
              return [
                { role: 'point', entityId: resolve(record.point) },
                { role: 'line-1', entityId: resolve(record.line1) },
                { role: 'line-2', entityId: resolve(record.line2) },
              ];
            case 'line-circle-other-intersection':
              return [
                { role: 'point', entityId: resolve(record.point) },
                { role: 'line', entityId: resolve(record.line) },
                { role: 'circle', entityId: resolve(record.circle) },
                { role: 'excluded-point', entityId: resolve(record.excludePoint) },
              ];
            case 'cyclic':
            case 'complete-quadrilateral':
              return record.points.map((reference, index) => ({
                role: `point-${index + 1}`,
                entityId: resolve(reference),
              }));
          }
        })();
        const parameters = constraintParametersOf(record);
        const constraint: GeometryConstraint = {
          recordType: 'constraint',
          id: `constraint:managed:${block.id}:${record.id}`,
          kind: record.kind,
          arguments: argumentsForRecord,
          strength: 'required',
          enabled: true,
          ...(parameters
            ? { parameters }
            : {}),
          sourceBindingIds: [recordBindingId, bindingId],
          metadata: {
            constructionId: block.id,
            constructionKind: block.planKind,
            constructionSyntaxKind: block.kind,
            sourceRecordId: record.id,
            source: 'mathgeo-managed-record',
          },
        };
        constraints.push(constraint);
        const target = {
          recordType: 'constraint' as const,
          id: constraint.id,
        };
        targets.push(target);
        targetsByRecordBinding.set(recordBindingId, [target]);
        if (record.kind === 'on-circle') {
          constrainedPointIds.add(resolve(record.point));
        } else if (record.kind === 'tangent-at-point') {
          constrainedPointIds.add(resolve(record.touch));
        }
      } else if (record.recordType === 'relation') {
        const recordBindingId = managedRecordBindingId(
          bindingId,
          record.recordType,
          record.id,
        );
        const relation: GeometryRelation = {
          recordType: 'relation',
          id: `relation:managed:${block.id}:${record.id}`,
          kind: record.kind,
          directed: record.directed ?? false,
          participants: [
            { role: 'from', entityId: resolve(record.from) },
            { role: 'to', entityId: resolve(record.to) },
          ],
          sourceBindingIds: [recordBindingId, bindingId],
          metadata: {
            constructionId: block.id,
            constructionKind: block.planKind,
            constructionSyntaxKind: block.kind,
            sourceRecordId: record.id,
            source: 'mathgeo-managed-record',
          },
        };
        relations.push(relation);
        const target = {
          recordType: 'relation' as const,
          id: relation.id,
        };
        targets.push(target);
        targetsByRecordBinding.set(recordBindingId, [target]);
        relationKeys.add(relationSemanticKey(
          relation.kind,
          relation.directed ?? false,
          relation.participants.flatMap((participant) => (
            participant.entityId ? [participant.entityId] : []
          )),
        ));
      } else if (record.recordType === 'output') {
        const outputId = resolve(record.ref);
        if (knownEntityIds.has(outputId)) {
          const target = { recordType: 'entity' as const, id: outputId };
          const recordBindingId = managedRecordBindingId(
            bindingId,
            record.recordType,
            record.id,
          );
          targets.push(target);
          targetsByRecordBinding.set(recordBindingId, [target]);
          addEntityBinding(outputId, recordBindingId);
        }
      }
    }
    targetsByBlock.set(bindingId, uniqueTargets(targets));
  }

  return {
    entities,
    constraints,
    relations,
    entityOverlays,
    constrainedPointIds,
    relationKeys,
    targetsByBlock,
    targetsByRecordBinding,
    extraEntityBindingIds,
  };
}

function diagnosticsOf(input: TikzGeometryProjectionInput): GeometryDiagnostic[] {
  return input.analysis.issues.map((issue, index) => ({
    code: issue.severity === 'error'
      ? 'tikz-projection-error'
      : 'tikz-preview-only',
    severity: issue.severity === 'error' ? 'error' : 'warning',
    message: issue.message,
    truth: issue.severity === 'error' ? 'semantic' : 'construction',
    source: issue.range
      ? sourceReference(sourceDocumentOf(input), input.source, issue.range)
      : undefined,
    pluginId: TIKZ_SEMANTIC_ADAPTER_ID,
    data: { issueIndex: index },
  }));
}

function managedMetadataDiagnosticsOf(
  input: TikzGeometryProjectionInput,
  blocks: readonly ManagedConstructionBlock[],
): GeometryDiagnostic[] {
  const document = sourceDocumentOf(input);
  return blocks.flatMap((block) => block.metadataIssues.map((item) => ({
    code: `managed-construction-${item.code}`,
    severity: item.code === 'unknown-record-type' ? 'info' : 'warning',
    message: `${block.id}: ${item.message}`,
    truth: 'construction',
    source: sourceReference(document, input.source, item.range),
    pluginId: TIKZ_SEMANTIC_ADAPTER_ID,
    data: {
      constructionId: block.id,
      constructionKind: block.planKind,
      constructionSyntaxKind: block.kind,
      metadataStatus: block.metadataStatus,
      integrityStatus: block.integrityStatus,
      schemaVersion: block.schemaVersion,
    },
  } satisfies GeometryDiagnostic)));
}

function duplicateManagedIdDiagnosticsOf(
  input: TikzGeometryProjectionInput,
  blocks: readonly ManagedConstructionBlock[],
  ambiguousIds: ReadonlySet<string>,
): GeometryDiagnostic[] {
  const document = sourceDocumentOf(input);
  return blocks.flatMap((block) => (
    ambiguousIds.has(block.id)
      ? [{
        code: 'managed-construction-duplicate-id',
        severity: 'error' as const,
        message: `Managed construction ID "${block.id}" is duplicated; semantic write-back is disabled for every duplicate.`,
        truth: 'construction' as const,
        source: sourceReference(
          document,
          input.source,
          block.headerRange,
        ),
        pluginId: TIKZ_SEMANTIC_ADAPTER_ID,
        data: {
          constructionId: block.id,
          blockStart: block.range.start,
          writePolicy: 'ambiguous-managed-id-read-only',
        },
      } satisfies GeometryDiagnostic]
      : []
  ));
}

function managedConstructionSummaries(
  blocks: readonly ManagedConstructionBlock[],
  ambiguousIds: ReadonlySet<string>,
): readonly JsonObject[] {
  return blocks.map((block): JsonObject => {
    const inputRecords = block.records.filter(
      (record): record is Extract<
        ManagedConstructionSemanticRecord,
        { recordType: 'input' }
      > => record.recordType === 'input',
    );
    const outputRecords = block.records.filter(
      (record): record is Extract<
        ManagedConstructionSemanticRecord,
        { recordType: 'output' }
      > => record.recordType === 'output',
    );
    const fallbackRoles = MANAGED_ARGUMENT_ROLES[block.planKind];
    const inputs: JsonObject[] = inputRecords.length > 0
      ? inputRecords.map((record) => ({
        id: record.id,
        role: record.role,
        ref: record.ref,
      }))
      : block.inputs.map((ref, index) => ({
        id: `input-${index + 1}`,
        role: fallbackRoles?.inputs[index] ?? `input-${index + 1}`,
        ref,
      }));
    const outputs: JsonObject[] = outputRecords.length > 0
      ? outputRecords.map((record) => ({
        id: record.id,
        role: record.role,
        ref: record.ref,
        kind: record.kind,
      }))
      : block.outputs.map((ref, index) => ({
        id: `output-${index + 1}`,
        role: fallbackRoles?.outputs[index] ?? `output-${index + 1}`,
        ref,
        kind: 'unknown',
      }));
    return {
      id: block.id,
      planKind: block.planKind,
      syntaxKind: block.kind,
      schemaVersion: block.schemaVersion,
      metadataStatus: block.metadataStatus,
      integrityStatus: block.integrityStatus,
      idAmbiguous: ambiguousIds.has(block.id),
      writePolicy: ambiguousIds.has(block.id)
        ? 'ambiguous-managed-id-read-only'
        : 'managed-recompile-only',
      inputs,
      outputs,
      entityRecordIds: block.records.flatMap((record) => (
        record.recordType === 'entity' ? [record.id] : []
      )),
      constraintRecordIds: block.records.flatMap((record) => (
        record.recordType === 'constraint' ? [record.id] : []
      )),
      relationRecordIds: block.records.flatMap((record) => (
        record.recordType === 'relation' ? [record.id] : []
      )),
      metadataIssueCodes: block.metadataIssues.map((item) => item.code),
      bindingId: managedBlockBindingId(block, ambiguousIds),
      sourceRange: { start: block.range.start, end: block.range.end },
      contentFingerprint: block.contentFingerprint,
      semanticRecords: block.records as unknown as JsonObject[],
    };
  });
}

function constraintDiagnosticsOf(
  entities: readonly GeometryEntity[],
  constraints: readonly GeometryConstraint[],
  relations: readonly GeometryRelation[],
): {
  diagnostics: GeometryDiagnostic[];
  components: ReturnType<typeof diagnoseConstraintStructure>['components'];
} {
  const report = diagnoseConstraintStructure({ entities, constraints, relations });
  return {
    components: report.components,
    diagnostics: report.diagnostics.map((item): GeometryDiagnostic => ({
      code: `constraint-${item.code}`,
      severity: item.code === 'unknown'
        ? 'info'
        : item.code === 'unsatisfied'
          ? 'error'
          : 'warning',
      message: item.message,
      truth: 'semantic',
      relatedRecords: [
        ...item.entityIds.map((id) => ({ recordType: 'entity' as const, id })),
        ...item.constraintIds.map((id) => ({ recordType: 'constraint' as const, id })),
        ...item.relationIds.map((id) => ({ recordType: 'relation' as const, id })),
      ],
      pluginId: TIKZ_SEMANTIC_ADAPTER_ID,
      data: {
        structural: true,
        mode: report.mode,
      },
    })),
  };
}

function bindingsOf(
  input: TikzGeometryProjectionInput,
  document: SourceDocument,
  points: readonly ScenePoint[],
  elements: readonly SceneElement[],
  managedBlocks: readonly ManagedConstructionBlock[],
  ambiguousManagedIds: ReadonlySet<string>,
): ConstructionBinding[] {
  const records: Array<{
    id: string;
    recordType: 'entity';
    stmtIndex: number;
  }> = [
    ...points.map((point) => ({
      id: point.stableId,
      recordType: 'entity' as const,
      stmtIndex: point.stmtIndex,
    })),
    ...elements.map((element) => ({
      id: element.stableId,
      recordType: 'entity' as const,
      stmtIndex: element.stmtIndex,
    })),
  ];

  return records.flatMap((record) => {
    const range = statementRange(input.analysis, record.stmtIndex);
    if (!range) return [];
    const managedBlock = managedBlocks.find((block) => (
      range.start < block.range.end && range.end > block.range.start
    ));
    return [{
      recordType: 'source-binding' as const,
      id: `binding:${record.id}`,
      kind: 'tikz-cst' as const,
      languageId: 'tikz' as const,
      role: 'definition' as const,
      targets: [{ recordType: record.recordType, id: record.id }],
      source: sourceReference(document, input.source, range),
      writable: !managedBlock,
      cstNodeType: input.analysis.stmts?.[record.stmtIndex]?.kind ?? 'statement',
      cstRanges: { node: range },
      ...(managedBlock
        ? {
          metadata: {
            managedConstructionId: managedBlock.id,
            writePolicy: ambiguousManagedIds.has(managedBlock.id)
              ? 'ambiguous-managed-id-read-only'
              : 'managed-recompile-only',
          },
        }
        : {}),
    }];
  });
}

function namedPathBindingsOf(
  input: TikzGeometryProjectionInput,
  document: SourceDocument,
  managedBlocks: readonly ManagedConstructionBlock[],
  ambiguousManagedIds: ReadonlySet<string>,
): ConstructionBinding[] {
  const seen = new Set<string>();
  return (input.analysis.stmts ?? []).flatMap((statement, statementIndex) => {
    if (
      statement.kind !== 'path'
      || !statement.namePath
      || seen.has(statement.namePath)
    ) return [];
    seen.add(statement.namePath);
    const range = statementRange(input.analysis, statementIndex);
    if (!range) return [];
    const managedBlock = managedBlocks.find((block) => (
      range.start < block.range.end && range.end > block.range.start
    ));
    return [{
      recordType: 'source-binding' as const,
      id: `binding:path:${statement.namePath}`,
      kind: 'tikz-cst' as const,
      languageId: 'tikz' as const,
      role: 'definition' as const,
      targets: [{
        recordType: 'entity' as const,
        id: `path:${statement.namePath}`,
      }],
      source: sourceReference(document, input.source, range),
      writable: !managedBlock,
      cstNodeType: 'named-path',
      cstRanges: { node: range },
      ...(managedBlock
        ? {
          metadata: {
            managedConstructionId: managedBlock.id,
            writePolicy: ambiguousManagedIds.has(managedBlock.id)
              ? 'ambiguous-managed-id-read-only'
              : 'managed-recompile-only',
          },
        }
        : {}),
    }];
  });
}

function managedBindingsOf(
  input: TikzGeometryProjectionInput,
  document: SourceDocument,
  blocks: readonly ManagedConstructionBlock[],
  ambiguousManagedIds: ReadonlySet<string>,
  targetsByBlock: ReadonlyMap<
    string,
    readonly GeometryBindableRecordReference[]
  >,
  targetsByRecordBinding: ReadonlyMap<
    string,
    readonly GeometryBindableRecordReference[]
  >,
): ConstructionBinding[] {
  return blocks.flatMap((block) => {
    const blockBindingId = managedBlockBindingId(block, ambiguousManagedIds);
    const ambiguousId = ambiguousManagedIds.has(block.id);
    const blockBinding: ConstructionBinding = {
      recordType: 'source-binding' as const,
      id: blockBindingId,
      kind: 'source-range' as const,
      role: 'custom' as const,
      targets: targetsByBlock.get(blockBindingId) ?? [],
      source: sourceReference(document, input.source, block.range),
      writable: false,
      syntaxNodeType: 'mathgeo-managed-construction',
      syntaxPath: ['managed-construction', block.id],
      metadata: {
        constructionId: block.id,
        constructionKind: block.planKind,
        constructionSyntaxKind: block.kind,
        schemaVersion: block.schemaVersion,
        metadataStatus: block.metadataStatus,
        integrityStatus: block.integrityStatus,
        contentFingerprint: block.contentFingerprint,
        semanticRecordCount: block.records.length,
        writePolicy: ambiguousId
          ? 'ambiguous-managed-id-read-only'
          : 'managed-recompile-only',
        ambiguousConstructionId: ambiguousId,
        headerStart: block.headerRange.start,
        headerEnd: block.headerRange.end,
        bodyStart: block.bodyRange.start,
        bodyEnd: block.bodyRange.end,
        tikzBodyStart: block.tikzBodyRange.start,
        tikzBodyEnd: block.tikzBodyRange.end,
        semanticRecordRanges: block.semanticRecordRanges.map((range) => ({
          start: range.start,
          end: range.end,
        })),
      },
    };
    const recordBindings = block.records.flatMap((record) => {
      const id = managedRecordBindingId(
        blockBindingId,
        record.recordType,
        record.id,
      );
      const targets = targetsByRecordBinding.get(id);
      if (!targets || targets.length === 0) return [];
      return [{
        recordType: 'source-binding' as const,
        id,
        kind: 'source-range' as const,
        role: 'custom' as const,
        targets,
        source: sourceReference(document, input.source, block.range),
        writable: false,
        syntaxNodeType: 'mathgeo-managed-record',
        syntaxPath: [
          'managed-construction',
          block.id,
          'record',
          record.recordType,
          record.id,
        ],
        metadata: {
          constructionId: block.id,
          managedConstructionId: block.id,
          constructionKind: block.planKind,
          constructionSyntaxKind: block.kind,
          sourceRecordType: record.recordType,
          sourceRecordId: record.id,
          writePolicy: 'managed-recompile-only',
        },
      } satisfies ConstructionBinding];
    });
    return [blockBinding, ...recordBindings];
  });
}

function documentInsertionBindingOf(
  input: TikzGeometryProjectionInput,
  document: SourceDocument,
): ConstructionBinding {
  const endMarkerStart = tikzPictureBodyEndOffset(input.source);
  const emptyDocument = input.source.trim().length === 0;
  const insertionOffset = endMarkerStart !== null
    ? endMarkerStart
    : emptyDocument
      ? 0
      : input.source.length;
  const range = emptyDocument
    ? { start: 0, end: input.source.length }
    : { start: insertionOffset, end: insertionOffset };
  return {
    recordType: 'source-binding',
    id: 'binding:document:tikzpicture-body-end',
    kind: 'source-range',
    role: 'custom',
    targets: [],
    source: sourceReference(document, input.source, range),
    writable: emptyDocument || endMarkerStart !== null,
    syntaxNodeType: emptyDocument
      ? 'empty-tikz-document'
      : 'tikzpicture-body-end',
    syntaxPath: ['document', 'tikzpicture', 'body-end'],
    metadata: {
      purpose: 'append-construction',
      emptyDocument,
      requiresFullEnvironment: emptyDocument,
    },
  };
}

function opaqueNodesOf(
  input: TikzGeometryProjectionInput,
  document: SourceDocument,
): OpaqueConstructionNode[] {
  return input.analysis.cst.opaqueNodes.map((node) => ({
    id: node.syntaxId,
    kind: 'opaque',
    languageId: 'tikz',
    syntaxNodeType: node.command || 'statement',
    reason: node.impact === 'local' ? 'unsupported-syntax' : 'unsafe-writeback',
    impact: node.impact === 'local' ? 'statement' : node.impact,
    source: sourceReference(document, input.source, node.range),
    metadata: {
      command: node.command,
      recognition: node.recognition,
      utf8Start: node.indexedRange.start.utf8,
      utf8End: node.indexedRange.end.utf8,
    },
  }));
}

function renderGeometry(entity: GeometryEntity): JsonObject {
  const parameters = entity.parameters ?? {};
  const references = referenceListOf(entity) ?? [];
  const definingReferences = references.filter(
    (reference, index) => references.indexOf(reference) === index,
  );
  switch (entity.kind) {
    case 'line':
      return {
        ...parameters,
        through: definingReferences,
        extent: 'infinite',
      };
    case 'ray':
      return {
        ...parameters,
        through: definingReferences,
        extent: 'positive-infinite',
      };
    case 'vector':
      return {
        ...parameters,
        endpoints: definingReferences,
        extent: 'finite',
        directed: true,
      };
    case 'segment':
      return {
        ...parameters,
        endpoints: definingReferences,
        extent: 'finite',
        directed: false,
      };
    default:
      return parameters;
  }
}

function renderPrimitive(
  element: SceneElement,
  entity: GeometryEntity,
  analysis: Analysis,
): RenderPrimitive {
  const range = statementRange(analysis, element.stmtIndex);
  const sourceBindingIds = entity.sourceBindingIds
    ?? [`binding:${element.stableId}`];
  return {
    id: `interactive:${element.stableId}`,
    kind: entity.kind,
    entityIds: [entity.id],
    sourceBindingIds,
    sourceRange: range ?? undefined,
    geometry: renderGeometry(entity),
    style: styleProperties(element),
    interactive: true,
    metadata: {
      sourceBindingIds,
      statementIndex: element.stmtIndex,
      sourceSyntaxKind: element.kind,
      semanticKind: entity.kind,
      sourceStableId: element.stableId,
    },
  };
}

function renderPointPrimitive(
  point: ScenePoint,
  entity: GeometryEntity,
  analysis: Analysis,
): RenderPrimitive {
  const range = statementRange(analysis, point.stmtIndex);
  const sourceBindingIds = entity.sourceBindingIds
    ?? [`binding:${point.stableId}`];
  return {
    id: `interactive:${point.stableId}`,
    kind: entity.kind,
    entityIds: [entity.id],
    sourceBindingIds,
    sourceRange: range ?? undefined,
    geometry: renderGeometry(entity),
    interactive: true,
    metadata: {
      sourceBindingIds,
      statementIndex: point.stmtIndex,
      sourceSyntaxKind: 'point',
      semanticKind: entity.kind,
      sourceStableId: point.stableId,
      pointName: point.name,
      free: point.free,
    },
  };
}

export function projectTikzAnalysisToGeometryTruth(
  input: TikzGeometryProjectionInput,
): GeometryTruthSet {
  const document = sourceDocumentOf(input);
  const points = input.analysis.scene
    ? publicSemanticPoints([...input.analysis.scene.points.values()])
    : [];
  const elements = input.analysis.scene?.elements ?? [];
  const namedPaths = namedPathEntitiesOf(input);
  const sourceEntities = [
    ...points.map(pointEntity),
    ...namedPaths,
    ...elements.map(elementEntity),
  ];
  const pointIdsByName = new Map(
    points.map((point) => [point.name, point.stableId] as const),
  );
  const sourceEntityRanges = new Map<string, { start: number; end: number }>([
    ...points.flatMap((point) => {
      const range = statementRange(input.analysis, point.stmtIndex);
      return range ? [[point.stableId, range] as const] : [];
    }),
    ...elements.flatMap((element) => {
      const range = statementRange(input.analysis, element.stmtIndex);
      return range ? [[element.stableId, range] as const] : [];
    }),
  ]);
  const managedBlocks = parseManagedConstructionBlocks(input.source);
  const ambiguousManagedIds = ambiguousManagedConstructionIds(managedBlocks);
  const managed = managedConstructionSemantics(
    managedBlocks,
    ambiguousManagedIds,
    pointIdsByName,
    sourceEntities,
    sourceEntityRanges,
  );
  const reconciledSourceEntities = sourceEntities.map((entity) => {
    const overlay = managed.entityOverlays.get(entity.id);
    const extraBindings = managed.extraEntityBindingIds.get(entity.id) ?? [];
    if (!overlay && extraBindings.length === 0) return entity;
    if (!overlay) {
      return {
        ...entity,
        sourceBindingIds: [
          ...new Set([
            ...(entity.sourceBindingIds ?? []),
            ...extraBindings,
          ]),
        ],
      } satisfies GeometryEntity;
    }
    return {
      ...entity,
      kind: overlay.semanticKind,
      dimension: overlay.dimension,
      definition: entity.definition ?? overlay.definition,
      parameters: overlay.semanticReferences
        ? {
          ...(entity.parameters ?? {}),
          references: overlay.semanticReferences,
        }
        : entity.parameters,
      tags: [...new Set([...(entity.tags ?? []), ...overlay.tags])],
      sourceBindingIds: [
        ...new Set([
          ...(entity.sourceBindingIds ?? []),
          ...overlay.sourceBindingIds,
          ...extraBindings,
        ]),
      ],
      metadata: {
        ...(entity.metadata ?? {}),
        source: 'tikz-scene+mathgeo-managed-record',
        sourceSyntaxKind: entity.kind,
        semanticKind: overlay.semanticKind,
        managedConstructionIds: overlay.constructionIds,
        managedSourceRecordIds: overlay.sourceRecordIds,
        managedSemanticKinds: overlay.semanticKinds,
        semanticOnly: false,
        visualEntityMatch: 'unique-semantic-key',
      },
    } satisfies GeometryEntity;
  });
  const entities = [
    ...reconciledSourceEntities,
    ...managed.entities.map((entity) => ({
      ...entity,
      sourceBindingIds: [
        ...new Set([
          ...(entity.sourceBindingIds ?? []),
          ...(managed.extraEntityBindingIds.get(entity.id) ?? []),
        ]),
      ],
    })),
  ];
  const entitiesById = new Map(
    entities.map((entity) => [entity.id, entity] as const),
  );
  const constraints = [
    ...pointConstraints(points, pointIdsByName).filter((constraint) => {
      const pointId = constraint.arguments.find(
        (argument) => argument.role === 'point',
      )?.entityId;
      return !pointId || !managed.constrainedPointIds.has(pointId);
    }),
    ...managed.constraints,
  ];
  const relations = [
    ...dependencyRelations(points, pointIdsByName).filter((relation) => (
      !managed.relationKeys.has(relationSemanticKey(
        relation.kind,
        relation.directed ?? false,
        relation.participants.flatMap((participant) => (
          participant.entityId ? [participant.entityId] : []
        )),
      ))
    )),
    ...managed.relations,
  ];
  const styles: GeometryStyle[] = elements.map((element) => ({
    recordType: 'style',
    id: `style:${element.stableId}`,
    selector: { entityIds: [element.stableId] },
    properties: styleProperties(element),
    sourceBindingIds: [`binding:${element.stableId}`],
  }));
  const sourceBindings = [
    documentInsertionBindingOf(input, document),
    ...namedPathBindingsOf(
      input,
      document,
      managedBlocks,
      ambiguousManagedIds,
    ),
    ...bindingsOf(
      input,
      document,
      points,
      elements,
      managedBlocks,
      ambiguousManagedIds,
    ),
    ...managedBindingsOf(
      input,
      document,
      managedBlocks,
      ambiguousManagedIds,
      managed.targetsByBlock,
      managed.targetsByRecordBinding,
    ),
  ];
  const opaqueNodes = opaqueNodesOf(input, document);
  const constraintDiagnostics = constraintDiagnosticsOf(
    entities,
    constraints,
    relations,
  );
  const diagnostics = [
    ...diagnosticsOf(input),
    ...managedMetadataDiagnosticsOf(input, managedBlocks),
    ...managedConstructionDocumentReferenceIssues(input.source).map((item) => ({
      code: item.code,
      severity: 'error' as const,
      message: item.message,
      truth: 'semantic' as const,
      source: sourceReference(document, input.source, item.range),
      pluginId: TIKZ_SEMANTIC_ADAPTER_ID,
      data: {
        constructionId: item.constructionId,
        recordId: item.recordId,
        reference: item.reference,
        path: item.path,
        ...(item.expectedKind ? { expectedKind: item.expectedKind } : {}),
        ...(item.actualKind ? { actualKind: item.actualKind } : {}),
      },
    } satisfies GeometryDiagnostic)),
    ...duplicateManagedIdDiagnosticsOf(
      input,
      managedBlocks,
      ambiguousManagedIds,
    ),
    ...constraintDiagnostics.diagnostics,
  ];

  const ir: GeometryIR = {
    schemaVersion: GEOMETRY_IR_SCHEMA_VERSION,
    entities,
    constraints,
    relations,
    styles,
    sourceBindings,
    metadata: {
      adapterId: TIKZ_SEMANTIC_ADAPTER_ID,
      adapterVersion: TIKZ_SEMANTIC_ADAPTER_VERSION,
      semanticCoverage: input.analysis.cst.coverage.semanticRatio,
      managedConstructionCount: managedBlocks.length,
      constraintDiagnosticsMode: 'structural-planning-only',
      constraintComponents: constraintDiagnostics.components.map((component) => ({
        id: component.id,
        entityIds: component.entityIds,
        constraintIds: component.constraintIds,
        relationIds: component.relationIds,
        estimatedDof: component.estimatedDof,
      })),
    },
    extensions: {
      'mathgeo.managed-constructions/v1':
        managedConstructionSummaries(managedBlocks, ambiguousManagedIds),
    },
  };
  const semantic: SemanticTruth = {
    kind: 'semantic',
    basis: input.basis,
    status: input.analysis.status,
    ir,
    diagnostics,
  };
  const construction: ConstructionTruth = {
    kind: 'construction',
    basis: input.basis,
    status: input.analysis.status,
    sources: [document],
    bindings: sourceBindings,
    opaqueNodes,
    diagnostics,
  };
  const interactive: RenderingTruth = {
    kind: 'rendering',
    basis: input.basis,
    renderRevision: input.basis.revision,
    rendererId: 'mathgeo.interactive-svg',
    target: 'interactive-svg',
    status: input.analysis.status,
    primitives: [
      ...points.map((point) => renderPointPrimitive(
        point,
        entitiesById.get(point.stableId) ?? pointEntity(point),
        input.analysis,
      )),
      ...elements.map((element) => renderPrimitive(
        element,
        entitiesById.get(element.stableId) ?? elementEntity(element),
        input.analysis,
      )),
    ],
    artifacts: [],
    diagnostics,
    metadata: {
      truth: 'interactive-projection',
      exact: false,
    },
  };

  return {
    semantic,
    construction,
    rendering: [interactive],
  };
}
