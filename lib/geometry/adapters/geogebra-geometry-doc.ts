import { parseGgbScript } from '@/lib/math/tikz-export/ggb-script';
import {
  angleToDegrees,
  parseCommand,
  splitTopLevelArgs,
  type GgbObject,
} from '@/lib/math/tikz-export/ggb-to-tikz';
import { hashSource } from '@/lib/tikz/document/source-hash';
import {
  GEOMETRY_IR_SCHEMA_VERSION,
  type ConstructionBinding,
  type GeometryArgument,
  type GeometryConstraint,
  type GeometryDiagnostic,
  type GeometryEntity,
  type GeometryRelation,
  type GeometryRevisionBasis,
  type GeometryStyle,
  type JsonObject,
  type OpaqueConstructionNode,
  type SourceDocument,
} from '@/lib/tikz/ir/model';
import { buildGeometrySourceMap } from '@/lib/tikz/ir/source-map';
import { createGeometryDoc, type GeometryDoc } from '@/lib/tikz/ir/geometry-doc';
import {
  buildGeometrySemanticSignature,
  type GeometrySemanticSignature,
} from '@/lib/geometry/semantic-signature';

/**
 * Migration adapter: the neutral IR still lives under lib/tikz/ir, while this
 * source-specific projector lives in the shared geometry namespace.
 */
export const GEOGEBRA_GEOMETRY_PROJECTION_SCHEMA_VERSION =
  'geogebra-geometry-projection/v1' as const;
export const GEOGEBRA_PLUGIN_SET_DIGEST =
  'geogebra-command-projector/v2' as const;

export interface GeogebraProjectionIdentity {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
}

export interface GeogebraGeometryProjectionResult {
  readonly schemaVersion: typeof GEOGEBRA_GEOMETRY_PROJECTION_SCHEMA_VERSION;
  readonly geometryDoc: GeometryDoc;
  readonly semanticSignature: GeometrySemanticSignature;
  readonly source: string;
  readonly projectedCommandCount: number;
  readonly opaqueCommandCount: number;
}

interface SourceStatement {
  readonly index: number;
  readonly raw: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface ProjectedDefinition {
  readonly statement: SourceStatement;
  readonly object: GgbObject;
  readonly commandName: string;
  readonly args: readonly string[];
  readonly entity: GeometryEntity;
  readonly relation?: GeometryRelation;
  readonly constraint?: GeometryConstraint;
}

interface ParsedSourceCommand {
  readonly statement: SourceStatement;
  readonly name: string;
  readonly commandName: string;
  readonly args: readonly string[];
}

const STYLE_COMMAND =
  /^(SetColor|SetCaption|ShowLabel|SetLineThickness|SetPointSize|SetLineStyle|SetVisibleInView)\s*\(([\s\S]*)\)\s*$/u;
const ENTITY_NAME = /^[A-Za-z_][\w']*$/u;

function sourceStatements(commands: readonly string[]): { source: string; statements: SourceStatement[] } {
  const source = commands.join('\n');
  const statements: SourceStatement[] = [];
  let offset = 0;
  commands.forEach((raw, index) => {
    statements.push({
      index,
      raw,
      text: raw.trim(),
      start: offset,
      end: offset + raw.length,
    });
    offset += raw.length + (index < commands.length - 1 ? 1 : 0);
  });
  return { source, statements };
}

function assignment(statement: SourceStatement): { name?: string; expression: string } {
  const match = statement.text.match(/^([A-Za-z_][\w']*)\s*=(?!=)\s*([\s\S]+)$/u);
  return match
    ? { name: match[1], expression: match[2].trim() }
    : { expression: statement.text };
}

function entityId(name: string): string {
  return `ggb:entity:${encodeURIComponent(name)}`;
}

function recordId(kind: 'relation' | 'constraint' | 'style', statementIndex: number): string {
  return `ggb:${kind}:command-${statementIndex}`;
}

function bindingId(statementIndex: number): string {
  return `ggb:binding:command-${statementIndex}`;
}

function dimensionFor(type: string): 0 | 1 | 2 | undefined {
  if (type === 'point') return 0;
  if (type === 'line' || type === 'ray' || type === 'segment' || type === 'conic') return 1;
  if (type === 'polygon') return 2;
  return undefined;
}

function kindFor(object: GgbObject, commandName: string): string {
  if (/circle/iu.test(commandName)) return 'circle';
  if (commandName === 'Polygon') return 'polygon';
  return object.type;
}

function definitionRelationKind(commandName: string): string {
  if (commandName === 'Intersect') return 'intersection';
  if (commandName === 'Point') return 'incidence';
  if (commandName === 'Segment' || commandName === 'Line' || commandName === 'Ray') {
    return 'incidence';
  }
  if (/circle/iu.test(commandName)) return 'circle-definition';
  if (/center/iu.test(commandName)) return 'center-definition';
  return 'dependency';
}

function constraintKind(commandName: string): string | undefined {
  switch (commandName) {
    case 'Midpoint': return 'midpoint';
    case 'ParallelLine': return 'parallel';
    case 'PerpendicularLine': return 'perpendicular';
    case 'PerpendicularBisector': return 'perpendicular-bisector';
    case 'Foot': return 'perpendicular-foot';
    case 'Tangent': return 'tangent';
    default: return undefined;
  }
}

function referencedEntityIds(
  args: readonly string[],
  entitiesByName: ReadonlyMap<string, GeometryEntity>,
): string[] {
  return [...new Set(args.flatMap((arg) => {
    const candidate = arg.trim();
    return ENTITY_NAME.test(candidate) && entitiesByName.has(candidate)
      ? [entitiesByName.get(candidate)!.id]
      : [];
  }))];
}

function relationArguments(outputId: string, inputs: readonly string[]): GeometryArgument[] {
  return [
    { role: 'result', entityId: outputId },
    ...inputs.map((input) => ({ role: 'input', entityId: input })),
  ];
}

function unorderedNames(left: string, right: string): string {
  return left.localeCompare(right) <= 0
    ? `${left}\u0000${right}`
    : `${right}\u0000${left}`;
}

function isQuarterTurnLiteral(value: string): boolean {
  const angle = angleToDegrees(value);
  if (angle === null) return false;
  const normalized = ((angle % 180) + 180) % 180;
  return Math.abs(normalized - 90) <= 1e-9;
}

/**
 * Recover renderer-neutral constraints from ordinary GeoGebra construction
 * commands. Vector is construction-only here: it drives Translate but does not
 * become an extra mathematical entity in the paired drawing signature.
 */
function inferredGeometricConstraints(
  definitions: readonly ProjectedDefinition[],
  sourceCommands: readonly ParsedSourceCommand[],
): Array<{ readonly constraint: GeometryConstraint; readonly statementIndex: number }> {
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.object.name, definition] as const),
  );
  const commandsByName = new Map(
    sourceCommands.map((command) => [command.name, command] as const),
  );
  const segmentsByEndpoints = new Map<string, ProjectedDefinition[]>();
  for (const definition of definitions) {
    if (definition.commandName !== 'Segment' || definition.args.length !== 2) continue;
    const key = unorderedNames(definition.args[0]!, definition.args[1]!);
    segmentsByEndpoints.set(key, [...(segmentsByEndpoints.get(key) ?? []), definition]);
  }

  const output: Array<{ constraint: GeometryConstraint; statementIndex: number }> = [];
  const seen = new Set<string>();
  for (const line of definitions) {
    if (line.commandName !== 'Segment' || line.args.length !== 2) continue;
    for (const [touchName, directionName] of [
      [line.args[0]!, line.args[1]!],
      [line.args[1]!, line.args[0]!],
    ] as const) {
      const rotation = commandsByName.get(directionName);
      if (
        rotation?.commandName !== 'Rotate'
        || rotation.args.length !== 3
        || rotation.args[2] !== touchName
        || !isQuarterTurnLiteral(rotation.args[1]!)
      ) continue;
      const circles = definitions.filter((definition) => (
        definition.commandName === 'Circle'
        && definition.args[0] === rotation.args[0]
        && (
          definitionsByName.get(touchName)?.commandName === 'Intersect'
            ? definitionsByName.get(touchName)!.args.includes(definition.object.name)
            : definition.args.includes(touchName)
        )
      ));
      if (circles.length !== 1) continue;
      const touch = definitionsByName.get(touchName)?.entity;
      if (!touch) continue;
      const key = [
        'tangent',
        line.entity.id,
        touch.id,
        circles[0]!.entity.id,
      ].join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        statementIndex: line.statement.index,
        constraint: {
          recordType: 'constraint',
          id: `ggb:constraint:inferred-tangent-${line.statement.index}`,
          kind: 'tangent',
          arguments: relationArguments(line.entity.id, [touch.id, circles[0]!.entity.id]),
          strength: 'required',
          enabled: true,
          sourceBindingIds: [bindingId(line.statement.index)],
          metadata: { source: 'geogebra-quarter-turn-radius' },
        },
      });
    }

    for (const [throughName, translatedName] of [
      [line.args[0]!, line.args[1]!],
      [line.args[1]!, line.args[0]!],
    ] as const) {
      const translation = commandsByName.get(translatedName);
      if (translation?.commandName !== 'Translate' || translation.args.length !== 2) continue;
      const vector = commandsByName.get(translation.args[1]!);
      if (
        vector?.commandName !== 'Vector'
        || vector.args.length !== 2
        || vector.args[1] !== throughName
      ) continue;
      const references = segmentsByEndpoints.get(unorderedNames(
        vector.args[0]!,
        translation.args[0]!,
      ))?.filter((candidate) => candidate.entity.id !== line.entity.id) ?? [];
      if (references.length !== 1) continue;
      const reference = references[0]!;
      const key = ['parallel', line.entity.id, reference.entity.id].sort().join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        statementIndex: line.statement.index,
        constraint: {
          recordType: 'constraint',
          id: `ggb:constraint:inferred-parallel-${line.statement.index}`,
          kind: 'parallel',
          arguments: relationArguments(line.entity.id, [reference.entity.id]),
          strength: 'required',
          enabled: true,
          sourceBindingIds: [bindingId(line.statement.index)],
          metadata: { source: 'geogebra-vector-translation' },
        },
      });
    }
  }
  return output;
}

function sourceReference(source: SourceDocument, statement: SourceStatement) {
  return {
    document: {
      sourceId: source.sourceId,
      languageId: source.languageId,
      revision: source.revision,
      hash: source.hash,
      hashAlgorithm: source.hashAlgorithm,
      offsetUnit: source.offsetUnit,
      encoding: source.encoding,
      length: source.length,
    },
    range: { start: statement.start, end: statement.end },
    verbatim: statement.raw,
    sliceHash: hashSource(statement.raw),
  } as const;
}

function extensionBinding(input: {
  source: SourceDocument;
  statement: SourceStatement;
  role: 'definition' | 'style';
  commandName: string;
  args: readonly string[];
  assignmentName?: string;
  targets: ConstructionBinding['targets'];
}): ConstructionBinding {
  const payload: JsonObject = {
    statementIndex: input.statement.index,
    commandName: input.commandName,
    arguments: [...input.args],
    ...(input.assignmentName ? { assignmentName: input.assignmentName } : {}),
  };
  return {
    recordType: 'source-binding',
    id: bindingId(input.statement.index),
    kind: 'extension',
    namespace: 'org.geogebra.command',
    bindingType: input.role,
    role: input.role,
    targets: input.targets,
    source: sourceReference(input.source, input.statement),
    // The whole command list has a CAS broker, but a single extension binding
    // has no binding-to-command patch planner yet. Keep per-binding writes
    // fail-closed instead of pretending a semantic edit is lossless.
    writable: false,
    payload,
  };
}

function styleProperties(commandName: string, args: readonly string[]): JsonObject {
  const value = args.slice(1).map((item) => item.trim());
  switch (commandName) {
    case 'SetColor': return { color: value };
    case 'SetCaption': return { caption: value[0] ?? '' };
    case 'ShowLabel': return { labelVisible: /^true$/iu.test(value[0] ?? '') };
    case 'SetLineThickness': return { lineThickness: Number(value[0]) || 0 };
    case 'SetPointSize': return { pointSize: Number(value[0]) || 0 };
    case 'SetLineStyle': return { lineStyle: Number(value[0]) || 0 };
    case 'SetVisibleInView': return {
      view: Number(value[0]) || 1,
      visible: /^true$/iu.test(value[1] ?? ''),
    };
    default: return { values: value };
  }
}

function opaqueNode(
  source: SourceDocument,
  statement: SourceStatement,
  reason: 'unsupported-syntax' | 'parse-error',
): OpaqueConstructionNode {
  return {
    id: `ggb:opaque:command-${statement.index}`,
    kind: 'opaque',
    languageId: 'geogebra-command',
    syntaxNodeType: 'command-line',
    reason,
    impact: 'statement',
    source: sourceReference(source, statement),
    metadata: { statementIndex: statement.index },
  };
}

export function projectGeogebraCommandsToGeometryDoc(input: {
  readonly commands: readonly string[];
  readonly identity: GeogebraProjectionIdentity;
  readonly coordOf?: (name: string) => { x: number; y: number } | null;
}): GeogebraGeometryProjectionResult {
  if (
    !input.identity.documentId.trim()
    || !input.identity.epoch.trim()
    || !Number.isSafeInteger(input.identity.revision)
    || input.identity.revision < 0
  ) throw new TypeError('GeoGebra projection requires a valid revision identity.');

  const { source, statements } = sourceStatements(input.commands);
  const sourceId = `${input.identity.documentId}:geogebra`;
  const sourceHash = hashSource(source);
  const sourceDocument: SourceDocument = {
    sourceId,
    languageId: 'geogebra-command',
    revision: input.identity.revision,
    hash: sourceHash,
    hashAlgorithm: 'fnv1a64-utf8',
    offsetUnit: 'utf16-code-unit',
    encoding: 'utf-8',
    length: source.length,
    text: source,
  };

  const sourceCommands: ParsedSourceCommand[] = statements.flatMap((statement) => {
    if (!statement.text || STYLE_COMMAND.test(statement.text)) return [];
    const assigned = assignment(statement);
    const parsed = parseCommand(assigned.expression);
    return assigned.name && parsed
      ? [{
          statement,
          name: assigned.name,
          commandName: parsed.fn,
          args: parsed.args,
        }]
      : [];
  });
  const auxiliaryVectors = sourceCommands.filter((command) => (
    command.commandName === 'Vector' && command.args.length === 2
  ));

  const parsedDefinitions: Array<{
    statement: SourceStatement;
    object: GgbObject;
    commandName: string;
    args: readonly string[];
  }> = [];
  let anonymousIndex = 0;
  for (const statement of statements) {
    if (!statement.text || STYLE_COMMAND.test(statement.text)) continue;
    const assigned = assignment(statement);
    const parsed = parseCommand(assigned.expression);
    const object = parseGgbScript([statement.text], input.coordOf)[0];
    if (!object) continue;
    const literalPoint = assigned.expression.match(
      /^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/u,
    );
    if (!parsed && !literalPoint) continue;
    const name = assigned.name ?? `__command_${anonymousIndex++}`;
    parsedDefinitions.push({
      statement,
      object: { ...object, name },
      commandName: parsed?.fn ?? 'Coordinate',
      args: parsed?.args ?? [literalPoint![1]!, literalPoint![2]!],
    });
  }

  const entitiesByName = new Map<string, GeometryEntity>();
  for (const definition of parsedDefinitions) {
    const id = entityId(definition.object.name);
    const dimension = dimensionFor(definition.object.type);
    const parameters: JsonObject = {
      commandName: definition.commandName,
      visible: definition.object.visible,
      references: definition.args.filter((argument) => ENTITY_NAME.test(argument.trim()))
        .map((argument) => argument.trim()),
      ...(typeof definition.object.x === 'number' && Number.isFinite(definition.object.x)
        ? { x: definition.object.x }
        : {}),
      ...(typeof definition.object.y === 'number' && Number.isFinite(definition.object.y)
        ? { y: definition.object.y }
        : {}),
    };
    entitiesByName.set(definition.object.name, {
      recordType: 'entity',
      id,
      kind: kindFor(definition.object, definition.commandName),
      name: definition.object.name,
      ...(dimension !== undefined
        ? { dimension }
        : {}),
      definition: {
        kind: 'extension',
        namespace: 'org.geogebra.command',
        expressionType: definition.commandName,
        payload: { arguments: [...definition.args] },
      },
      parameters,
      tags: ['geogebra'],
      sourceBindingIds: [bindingId(definition.statement.index)],
    });
  }

  const definitions: ProjectedDefinition[] = parsedDefinitions.map((definition) => {
    const entity = entitiesByName.get(definition.object.name)!;
    const inputs = referencedEntityIds(definition.args, entitiesByName)
      .filter((id) => id !== entity.id);
    const relation = inputs.length > 0
      ? {
          recordType: 'relation' as const,
          id: recordId('relation', definition.statement.index),
          kind: definitionRelationKind(definition.commandName),
          participants: relationArguments(entity.id, inputs),
          directed: true,
          sourceBindingIds: [bindingId(definition.statement.index)],
          metadata: { commandName: definition.commandName },
        }
      : undefined;
    const semanticConstraintKind = constraintKind(definition.commandName);
    const constraint = semanticConstraintKind && inputs.length > 0
      ? {
          recordType: 'constraint' as const,
          id: recordId('constraint', definition.statement.index),
          kind: semanticConstraintKind,
          arguments: relationArguments(entity.id, inputs),
          strength: 'required' as const,
          enabled: true,
          sourceBindingIds: [bindingId(definition.statement.index)],
          metadata: { commandName: definition.commandName },
        }
      : undefined;
    return { ...definition, entity, relation, constraint };
  });
  const inferredConstraints = inferredGeometricConstraints(definitions, sourceCommands);
  const inferredConstraintIdsByStatement = new Map<number, string[]>();
  for (const inferred of inferredConstraints) {
    const ids = inferredConstraintIdsByStatement.get(inferred.statementIndex) ?? [];
    inferredConstraintIdsByStatement.set(
      inferred.statementIndex,
      [...ids, inferred.constraint.id],
    );
  }

  const styles: GeometryStyle[] = [];
  const styleBindings: ConstructionBinding[] = [];
  const consumedStatements = new Set([
    ...definitions.map((item) => item.statement.index),
    ...auxiliaryVectors.map((item) => item.statement.index),
  ]);
  for (const statement of statements) {
    const match = statement.text.match(STYLE_COMMAND);
    if (!match) continue;
    const commandName = match[1]!;
    const args = splitTopLevelArgs(match[2]!);
    const targetName = args[0]?.trim() ?? '';
    const target = entitiesByName.get(targetName);
    if (!target) continue;
    const style: GeometryStyle = {
      recordType: 'style',
      id: recordId('style', statement.index),
      selector: { entityIds: [target.id] },
      properties: styleProperties(commandName, args),
      sourceBindingIds: [bindingId(statement.index)],
      metadata: { commandName },
    };
    styles.push(style);
    styleBindings.push(extensionBinding({
      source: sourceDocument,
      statement,
      role: 'style',
      commandName,
      args,
      targets: [{ recordType: 'style', id: style.id }],
    }));
    consumedStatements.add(statement.index);
  }

  const definitionBindings = definitions.map((definition) => extensionBinding({
    source: sourceDocument,
    statement: definition.statement,
    role: 'definition',
    commandName: definition.commandName,
    args: definition.args,
    assignmentName: definition.object.name,
    targets: [
      { recordType: 'entity', id: definition.entity.id },
      ...(definition.relation
        ? [{ recordType: 'relation' as const, id: definition.relation.id }]
        : []),
      ...(definition.constraint
        ? [{ recordType: 'constraint' as const, id: definition.constraint.id }]
        : []),
      ...(inferredConstraintIdsByStatement.get(definition.statement.index) ?? []).map((id) => ({
        recordType: 'constraint' as const,
        id,
      })),
    ],
  }));
  const auxiliaryBindings = auxiliaryVectors.map((definition) => extensionBinding({
    source: sourceDocument,
    statement: definition.statement,
    role: 'definition',
    commandName: definition.commandName,
    args: definition.args,
    assignmentName: definition.name,
    targets: [],
  }));
  const bindings = [...definitionBindings, ...auxiliaryBindings, ...styleBindings]
    .sort((left, right) => left.source.range.start - right.source.range.start);
  const opaqueNodes = statements
    .filter((statement) => statement.text && !consumedStatements.has(statement.index))
    .map((statement) => opaqueNode(sourceDocument, statement, 'unsupported-syntax'));
  const diagnostics: GeometryDiagnostic[] = opaqueNodes.map((node) => ({
    code: 'GGB_COMMAND_NOT_PROJECTED',
    severity: 'warning',
    message: 'GeoGebra command was retained losslessly but not promoted to semantic truth.',
    truth: 'construction',
    source: node.source,
    data: { opaqueNodeId: node.id },
  }));
  const entities = definitions.map((item) => item.entity);
  const relations = definitions.flatMap((item) => item.relation ? [item.relation] : []);
  const constraints = [
    ...definitions.flatMap((item) => item.constraint ? [item.constraint] : []),
    ...inferredConstraints.map((item) => item.constraint),
  ];
  const kernelHash = hashSource(JSON.stringify({ entities, relations, constraints, styles }));
  const basis: GeometryRevisionBasis = {
    documentId: input.identity.documentId,
    epoch: input.identity.epoch,
    revision: input.identity.revision,
    sourceId,
    sourceHash,
    kernelHash,
    projectionHash: hashSource(`${GEOGEBRA_GEOMETRY_PROJECTION_SCHEMA_VERSION}\n${source}`),
    pluginSetDigest: GEOGEBRA_PLUGIN_SET_DIGEST,
  };
  const status = opaqueNodes.length > 0 ? 'partial' as const : 'complete' as const;
  const truths = {
    semantic: {
      kind: 'semantic' as const,
      basis,
      status,
      ir: {
        schemaVersion: GEOMETRY_IR_SCHEMA_VERSION,
        entities,
        constraints,
        relations,
        styles,
        sourceBindings: bindings,
        metadata: {
          sourceLanguage: 'geogebra-command',
          adapterSchema: GEOGEBRA_GEOMETRY_PROJECTION_SCHEMA_VERSION,
        },
      },
      diagnostics,
    },
    construction: {
      kind: 'construction' as const,
      basis,
      status,
      sources: [{ ...sourceDocument }],
      bindings,
      opaqueNodes,
      diagnostics,
    },
    rendering: [],
  };
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  return {
    schemaVersion: GEOGEBRA_GEOMETRY_PROJECTION_SCHEMA_VERSION,
    geometryDoc,
    semanticSignature: buildGeometrySemanticSignature(geometryDoc),
    source,
    projectedCommandCount: bindings.length,
    opaqueCommandCount: opaqueNodes.length,
  };
}
