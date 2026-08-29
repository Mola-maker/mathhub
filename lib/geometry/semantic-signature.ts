import { hashSource } from '@/lib/tikz/document/source-hash';
import type { GeometryDoc } from '@/lib/tikz/ir/geometry-doc';
import type {
  GeometryArgument,
  GeometryConstraint,
  GeometryEntity,
  GeometryRelation,
  GeometryStyle,
  JsonObject,
} from '@/lib/tikz/ir/model';

export const GEOMETRY_SEMANTIC_SIGNATURE_SCHEMA_VERSION =
  'geometry-semantic-signature/v1' as const;
export const GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE =
  'named-dependency-topology/v2' as const;

export type GeometrySemanticSnapshotLike = Pick<GeometryDoc, 'basis' | 'semantic'>;

export interface GeometrySemanticSignatureExclusion {
  readonly recordType: 'entity' | 'constraint' | 'relation' | 'style';
  readonly recordId: string;
  readonly reason:
    | 'anonymous-entity'
    | 'duplicate-semantic-address'
    | 'unresolved-entity-reference'
    | 'non-portable-relation'
    | 'unresolved-style-selector';
}

export interface GeometrySemanticSignatureCoverage {
  readonly entities: { readonly portable: number; readonly total: number };
  readonly constraints: { readonly portable: number; readonly total: number };
  readonly relations: { readonly portable: number; readonly total: number };
  readonly styles: { readonly portable: number; readonly total: number };
}

export interface GeometrySemanticSignature {
  readonly schemaVersion: typeof GEOMETRY_SEMANTIC_SIGNATURE_SCHEMA_VERSION;
  readonly normalizationProfile: typeof GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE;
  readonly basis: {
    readonly documentId: string;
    readonly epoch: string;
    readonly revision: number;
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly pluginSetDigest?: string;
  };
  readonly sourceLanguage: string;
  readonly projectionStatus: 'complete' | 'partial' | 'invalid';
  /** True only when the semantic core is complete and every entity/constraint is portable. */
  readonly comparable: boolean;
  readonly semanticHash: string;
  readonly relationHash: string;
  readonly presentationHash: string;
  readonly coverage: GeometrySemanticSignatureCoverage;
  readonly exclusions: readonly GeometrySemanticSignatureExclusion[];
  readonly canonical: {
    readonly entities: readonly string[];
    readonly constraints: readonly string[];
    readonly relations: readonly string[];
    readonly styles: readonly string[];
  };
}

export interface GeometrySemanticSignatureComparison {
  readonly schemaVersion: 'geometry-semantic-signature-comparison/v1';
  readonly equivalent: boolean;
  readonly semanticHashMatches: boolean;
  readonly relationHashMatches: boolean;
  readonly presentationHashMatches: boolean;
  readonly reasons: readonly (
    | 'left-not-comparable'
    | 'right-not-comparable'
    | 'semantic-mismatch'
    | 'relation-mismatch'
    | 'presentation-mismatch'
  )[];
}

const STRUCTURAL_ENTITY_KINDS = new Set([
  'segment',
  'line',
  'ray',
  'circle',
  'polygon',
]);
const SYMMETRIC_ENTITY_KINDS = new Set(['segment']);
const SYMMETRIC_CONSTRAINT_KINDS = new Set([
  'coincident',
  'collinear',
  'concyclic',
  'equal-length',
  'parallel',
  'perpendicular',
  'tangent',
]);
const PORTABLE_RELATION_KINDS = new Set([
  'congruence',
  'incidence',
  'intersection',
  'ownership',
]);
const PORTABLE_PARAMETER_KEYS = new Set([
  'angle',
  'angleDegrees',
  'distance',
  'radius',
  'ratio',
  'value',
]);

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value)
        ? JSON.stringify(Math.round(value * 1e9) / 1e9)
        : 'null';
    case 'object': {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
    }
    case 'undefined': return 'null';
    default: return JSON.stringify(String(value));
  }
}

function normalizedToken(value: string): string {
  return value.normalize('NFKC').trim();
}

function normalizedKind(value: string): string {
  const normalized = normalizedToken(value)
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-');
  if (normalized === 'coordinate' || normalized === 'node') return 'point';
  if (normalized === 'perpendicular-line') return 'line';
  if (normalized === 'parallel-line') return 'line';
  if (normalized === 'tangent-at-point') return 'tangent';
  if (normalized === 'on-circle') return 'point-on-circle';
  if (normalized === 'cyclic' || normalized === 'cyclic-quadrilateral') {
    return 'concyclic';
  }
  return normalized;
}

function entityKind(entity: GeometryEntity): string {
  const kind = normalizedKind(entity.kind);
  const references = sourceReferences(entity);
  if (kind === 'polyline' && references.length === 2) return 'segment';
  if (kind === 'polyline' && entity.parameters?.cycle === true) return 'polygon';
  if (
    kind === 'conic'
    && normalizedKind(String(entity.parameters?.commandName ?? '')) === 'circle'
  ) return 'circle';
  return kind;
}

function sourceReferences(entity: GeometryEntity): string[] {
  const parameters = entity.parameters as Record<string, unknown> | undefined;
  if (Array.isArray(parameters?.references)) {
    return parameters.references.flatMap((value) => (
      typeof value === 'string' && normalizedToken(value)
        ? [normalizedToken(value)]
        : []
    ));
  }
  if (entity.definition?.kind === 'extension') {
    const argumentsValue = entity.definition.payload.arguments;
    if (Array.isArray(argumentsValue)) {
      return argumentsValue.flatMap((value) => (
        typeof value === 'string' && normalizedToken(value)
          ? [normalizedToken(value)]
          : []
      ));
    }
  }
  return [];
}

function portableParameters(parameters: JsonObject | undefined): JsonObject | undefined {
  if (!parameters) return undefined;
  const selected = Object.fromEntries(Object.entries(parameters).filter(([key]) => (
    PORTABLE_PARAMETER_KEYS.has(key)
  ))) as JsonObject;
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function portableArgument(
  argument: GeometryArgument,
  entityAddress: (entityId: string) => string | null,
): string | null {
  if (argument.entityId) return entityAddress(argument.entityId);
  if (argument.value !== undefined) return `value:${canonicalJson(argument.value)}`;
  if (argument.expression?.kind === 'entity-reference') {
    const address = entityAddress(argument.expression.entityId);
    return address ? `expression:${address}:${argument.expression.component ?? ''}` : null;
  }
  if (argument.expression?.kind === 'literal') {
    return `expression:${canonicalJson(argument.expression.value)}`;
  }
  return null;
}

function recordSignature(input: {
  readonly kind: string;
  readonly arguments: readonly GeometryArgument[];
  readonly parameters?: JsonObject;
  readonly symmetric: boolean;
  readonly entityAddress: (entityId: string) => string | null;
}): string | null {
  const arguments_ = input.arguments.map((argument) => (
    portableArgument(argument, input.entityAddress)
  ));
  if (arguments_.some((argument) => argument === null)) return null;
  const portableArguments = arguments_ as string[];
  if (input.symmetric) portableArguments.sort();
  return canonicalJson({
    kind: normalizedKind(input.kind),
    arguments: portableArguments,
    parameters: portableParameters(input.parameters),
  });
}

function styleSignature(
  style: GeometryStyle,
  entityAddress: (entityId: string) => string | null,
): string | null {
  const entityIds = style.selector.entityIds ?? [];
  const entities = entityIds.map(entityAddress);
  if (entities.some((entity) => entity === null)) return null;
  return canonicalJson({
    entities: (entities as string[]).sort(),
    entityKinds: (style.selector.entityKinds ?? []).map(normalizedKind).sort(),
    tags: [...(style.selector.tags ?? [])].map(normalizedToken).sort(),
    properties: style.properties,
    precedence: style.precedence ?? 0,
  });
}

function languageFor(snapshot: GeometrySemanticSnapshotLike): string {
  const value = snapshot.semantic.ir.metadata?.sourceLanguage;
  if (typeof value === 'string' && value.trim()) return value;
  const adapterId = snapshot.semantic.ir.metadata?.adapterId;
  if (typeof adapterId === 'string' && /tikz/iu.test(adapterId)) return 'tikz';
  if (snapshot.basis.sourceId?.endsWith(':tikz')) return 'tikz';
  return 'unknown';
}

export function buildGeometrySemanticSignature(
  snapshot: GeometrySemanticSnapshotLike,
): GeometrySemanticSignature {
  const sourceId = snapshot.basis.sourceId;
  if (!sourceId) throw new TypeError('Semantic signature requires a GeometryDoc sourceId.');
  // Construction helpers such as TikZ `name path` aliases remain in GeometryIR
  // for source bindings and dependency tracing, but are not mathematical
  // entities and must not change cross-renderer semantic identity or coverage.
  const entities = (snapshot.semantic.ir.entities as readonly GeometryEntity[])
    .filter((entity) => !entity.tags?.includes('construction-helper'));
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const namedEntities = new Map<string, GeometryEntity[]>();
  for (const entity of entities) {
    const name = typeof entity.name === 'string' ? normalizedToken(entity.name) : '';
    if (!name) continue;
    const group = namedEntities.get(name) ?? [];
    group.push(entity);
    namedEntities.set(name, group);
  }
  const memo = new Map<string, string | null>();
  const resolving = new Set<string>();
  const address = (entityId: string): string | null => {
    if (memo.has(entityId)) return memo.get(entityId) ?? null;
    const entity = entitiesById.get(entityId);
    if (!entity || resolving.has(entityId)) return null;
    resolving.add(entityId);
    const kind = entityKind(entity);
    const references = sourceReferences(entity);
    let result: string | null = null;
    if (STRUCTURAL_ENTITY_KINDS.has(kind) && references.length > 0) {
      const referenceAddresses = references.map((reference) => {
        const targets = namedEntities.get(reference);
        return targets?.length === 1 ? address(targets[0]!.id) : null;
      });
      if (referenceAddresses.every((reference) => reference !== null)) {
        const resolved = referenceAddresses as string[];
        if (SYMMETRIC_ENTITY_KINDS.has(kind)) resolved.sort();
        result = `${kind}(${resolved.join(',')})`;
      }
    }
    if (!result && typeof entity.name === 'string') {
      const name = normalizedToken(entity.name);
      if (name && namedEntities.get(name)?.length === 1) result = `name:${name}`;
    }
    resolving.delete(entityId);
    memo.set(entityId, result);
    return result;
  };

  const addresses = new Map(entities.map((entity) => [entity.id, address(entity.id)] as const));
  const addressCounts = new Map<string, number>();
  for (const value of addresses.values()) {
    if (value) addressCounts.set(value, (addressCounts.get(value) ?? 0) + 1);
  }
  const portableAddress = (entityId: string): string | null => {
    const value = addresses.get(entityId) ?? null;
    return value && addressCounts.get(value) === 1 ? value : null;
  };
  const exclusions: GeometrySemanticSignatureExclusion[] = [];
  const canonicalEntities = entities.flatMap((entity) => {
    const semanticAddress = portableAddress(entity.id);
    if (!semanticAddress) {
      const rawAddress = addresses.get(entity.id);
      exclusions.push({
        recordType: 'entity',
        recordId: entity.id,
        reason: rawAddress ? 'duplicate-semantic-address' : 'anonymous-entity',
      });
      return [];
    }
    return [canonicalJson({
      address: semanticAddress,
      kind: entityKind(entity),
      dimension: entity.dimension,
    })];
  }).sort();

  const constraints = snapshot.semantic.ir.constraints as readonly GeometryConstraint[];
  const canonicalConstraints = constraints.flatMap((constraint) => {
    const kind = normalizedKind(constraint.kind);
    const signature = recordSignature({
      kind,
      arguments: constraint.arguments,
      parameters: constraint.parameters as JsonObject | undefined,
      symmetric: SYMMETRIC_CONSTRAINT_KINDS.has(kind),
      entityAddress: portableAddress,
    });
    if (!signature) {
      exclusions.push({
        recordType: 'constraint',
        recordId: constraint.id,
        reason: 'unresolved-entity-reference',
      });
      return [];
    }
    return [signature];
  }).sort();

  const relations = snapshot.semantic.ir.relations as readonly GeometryRelation[];
  const canonicalRelations = relations.flatMap((relation) => {
    const kind = normalizedKind(relation.kind);
    if (!PORTABLE_RELATION_KINDS.has(kind)) {
      exclusions.push({
        recordType: 'relation',
        recordId: relation.id,
        reason: 'non-portable-relation',
      });
      return [];
    }
    const signature = recordSignature({
      kind,
      arguments: relation.participants,
      parameters: relation.properties as JsonObject | undefined,
      symmetric: relation.directed !== true,
      entityAddress: portableAddress,
    });
    if (!signature) {
      exclusions.push({
        recordType: 'relation',
        recordId: relation.id,
        reason: 'unresolved-entity-reference',
      });
      return [];
    }
    return [signature];
  }).sort();

  const styles = snapshot.semantic.ir.styles as readonly GeometryStyle[];
  const canonicalStyles = styles.flatMap((style) => {
    const signature = styleSignature(style, portableAddress);
    if (!signature) {
      exclusions.push({
        recordType: 'style',
        recordId: style.id,
        reason: 'unresolved-style-selector',
      });
      return [];
    }
    return [signature];
  }).sort();
  const coverage: GeometrySemanticSignatureCoverage = {
    entities: { portable: canonicalEntities.length, total: entities.length },
    constraints: { portable: canonicalConstraints.length, total: constraints.length },
    relations: { portable: canonicalRelations.length, total: relations.length },
    styles: { portable: canonicalStyles.length, total: styles.length },
  };
  const comparable = snapshot.semantic.status === 'complete'
    && coverage.entities.portable === coverage.entities.total
    && coverage.constraints.portable === coverage.constraints.total;
  return {
    schemaVersion: GEOMETRY_SEMANTIC_SIGNATURE_SCHEMA_VERSION,
    normalizationProfile: GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE,
    basis: {
      documentId: snapshot.basis.documentId,
      epoch: snapshot.basis.epoch,
      revision: snapshot.basis.revision,
      sourceId,
      sourceHash: snapshot.basis.sourceHash,
      ...(snapshot.basis.pluginSetDigest
        ? { pluginSetDigest: snapshot.basis.pluginSetDigest }
        : {}),
    },
    sourceLanguage: languageFor(snapshot),
    projectionStatus: snapshot.semantic.status,
    comparable,
    semanticHash: hashSource(canonicalJson({
      profile: GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE,
      entities: canonicalEntities,
      constraints: canonicalConstraints,
    })),
    relationHash: hashSource(canonicalJson({
      profile: GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE,
      relations: canonicalRelations,
    })),
    presentationHash: hashSource(canonicalJson({
      profile: GEOMETRY_SEMANTIC_NORMALIZATION_PROFILE,
      styles: canonicalStyles,
    })),
    coverage,
    exclusions: exclusions.sort((left, right) => (
      `${left.recordType}:${left.recordId}`.localeCompare(`${right.recordType}:${right.recordId}`)
    )),
    canonical: {
      entities: canonicalEntities,
      constraints: canonicalConstraints,
      relations: canonicalRelations,
      styles: canonicalStyles,
    },
  };
}

export function compareGeometrySemanticSignatures(
  left: GeometrySemanticSignature,
  right: GeometrySemanticSignature,
): GeometrySemanticSignatureComparison {
  const semanticHashMatches = left.semanticHash === right.semanticHash;
  const relationHashMatches = left.relationHash === right.relationHash;
  const presentationHashMatches = left.presentationHash === right.presentationHash;
  const reasons: GeometrySemanticSignatureComparison['reasons'][number][] = [];
  if (!left.comparable) reasons.push('left-not-comparable');
  if (!right.comparable) reasons.push('right-not-comparable');
  if (!semanticHashMatches) reasons.push('semantic-mismatch');
  if (!relationHashMatches) reasons.push('relation-mismatch');
  if (!presentationHashMatches) reasons.push('presentation-mismatch');
  return {
    schemaVersion: 'geometry-semantic-signature-comparison/v1',
    equivalent: left.comparable && right.comparable && semanticHashMatches,
    semanticHashMatches,
    relationHashMatches,
    presentationHashMatches,
    reasons,
  };
}
