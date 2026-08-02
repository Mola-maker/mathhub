import type {
  ConstructionTruth,
  GeometryEntity,
  GeometryExpression,
  GeometryRevisionBasis,
  GeometryTruthSet,
  JsonObject,
  JsonValue,
  OpaqueConstructionNode,
  SemanticTruth,
} from './model';
import {
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
  type ConstructionPlanCodecIssueCode,
} from '../authoring/construction-plan-codec';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import {
  buildGeometrySourceMap,
  GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
  type GeometrySourceMap,
} from './source-map';

export const GEOMETRY_AI_CONTEXT_SCHEMA_VERSION = 'geometry-ai-context/v1' as const;

export interface GeometryAiContextOptions {
  maxEntities?: number;
  maxConstraints?: number;
  maxRelations?: number;
  maxBindings?: number;
  maxOpaqueNodes?: number;
  maxManagedConstructions?: number;
  focusRefs?: readonly string[];
  focusDepth?: number;
  maxFocusEntities?: number;
}

export interface GeometryAiContext {
  schemaVersion: typeof GEOMETRY_AI_CONTEXT_SCHEMA_VERSION;
  basis: GeometryRevisionBasis & {
    sourceId: string;
    hashAlgorithm: string;
  };
  projection: {
    status: SemanticTruth['status'];
    semanticCoverage: number | null;
    exactSourcePreserved: true;
    exactRenderingIsAuthoritative: true;
  };
  entities: readonly Pick<
    GeometryEntity,
    'id'
    | 'kind'
    | 'name'
    | 'dimension'
    | 'definition'
    | 'parameters'
    | 'tags'
    | 'sourceBindingIds'
  >[];
  constraints: SemanticTruth['ir']['constraints'];
  relations: SemanticTruth['ir']['relations'];
  focus: {
    requestedRefs: readonly string[];
    resolvedEntityIds: readonly string[];
    closureEntityIds: readonly string[];
    unresolvedRefs: readonly string[];
    depth: number;
    truncated: boolean;
  };
  construction: {
    sourceMapSchemaVersion: typeof GEOMETRY_SOURCE_MAP_SCHEMA_VERSION;
    authorizedBindingIds: readonly string[];
    sourceBindings: readonly {
      id: string;
      role: string;
      sourceId: string;
      targets: readonly { recordType: string; id: string }[];
      range: { start: number; end: number };
      writable: boolean;
      opaque: false;
      insertionPolicy: 'none' | 'tikzpicture-body' | 'full-document';
      writeCapabilities: readonly (
        | 'create-managed-construction'
        | 'replace-managed-construction'
      )[];
      managedConstructionId?: string;
      managedPlanKind?: string;
      /** Concrete managed syntax kind; primitive plans retain point/segment/etc. */
      managedSyntaxKind?: string;
      managedContentFingerprint?: string;
      /**
       * Focus-scoped proof that the current schema-v2 managed block can be
       * reconstructed by the same canonical writer on server and client.
       * This never makes the underlying raw source binding writable.
       */
      managedPlan?:
        | {
          schemaVersion: 'managed-construction-plan-context/v1';
          status: 'canonical';
          canonicalSource: true;
          syntaxKind: string;
          previousPlan: JsonObject;
        }
        | {
          schemaVersion: 'managed-construction-plan-context/v1';
          status: 'unavailable';
          issues: readonly {
            code: ConstructionPlanCodecIssueCode;
            path: string;
            message: string;
          }[];
        };
      sliceHash?: string;
      verbatim?: string;
      entityIds: readonly string[];
      renderTargets: readonly {
        rendererId: string;
        target: string;
        primitiveIds: readonly string[];
      }[];
    }[];
    opaqueNodes: readonly {
      id: string;
      impact: OpaqueConstructionNode['impact'];
      reason: OpaqueConstructionNode['reason'];
      range: { start: number; end: number };
      command?: string;
    }[];
    managedConstructions: readonly JsonObject[];
  };
  protocol: {
    writeMode: 'revision-hash-bound-transaction';
    opaquePolicy: 'preserve-never-invent-semantics';
    staleWritePolicy: 'reject';
  };
  truncation: {
    truncated: boolean;
    omitted: Partial<Record<
      'entities'
      | 'constraints'
      | 'relations'
      | 'sourceBindings'
      | 'opaqueNodes'
      | 'managedConstructions',
      number
    >>;
  };
}

function finiteLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function takeWithOmitted<T>(
  values: readonly T[],
  limit: number,
): { values: readonly T[]; omitted: number } {
  return {
    values: values.slice(0, limit),
    omitted: Math.max(0, values.length - limit),
  };
}

function semanticCoverage(semantic: SemanticTruth): number | null {
  const value = semantic.ir.metadata?.semanticCoverage;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function commandOf(node: OpaqueConstructionNode): string | undefined {
  const command = node.metadata?.command;
  return typeof command === 'string' ? command : undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function managedConstructionSummaries(
  semantic: SemanticTruth,
): readonly JsonObject[] {
  const value =
    semantic.ir.extensions?.['mathgeo.managed-constructions/v1'];
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => isJsonObject(item))
    : [];
}

function expressionEntityIds(expression: GeometryExpression | undefined): string[] {
  if (!expression) return [];
  if (expression.kind === 'entity-reference') return [expression.entityId];
  if (expression.kind === 'operation') {
    return expression.arguments.flatMap(expressionEntityIds);
  }
  return [];
}

function focusClosure(
  semantic: SemanticTruth,
  options: GeometryAiContextOptions,
): GeometryAiContext['focus'] {
  const requestedRefs = [...new Set(
    (options.focusRefs ?? []).map((value) => value.trim()).filter(Boolean),
  )];
  const entities = semantic.ir.entities;
  const aliases = new Map<string, string>();
  const entityIds = new Set(entities.map((entity) => entity.id));
  for (const entity of entities) {
    aliases.set(entity.id, entity.id);
    if (entity.name) {
      aliases.set(entity.name, entity.id);
      aliases.set(`point:${entity.name}`, entity.id);
    }
  }
  const resolvedEntityIds = [...new Set(
    requestedRefs.flatMap((reference) => {
      const resolved = aliases.get(reference);
      return resolved ? [resolved] : [];
    }),
  )];
  const unresolvedRefs = requestedRefs.filter((reference) => !aliases.has(reference));
  const adjacency = new Map<string, Set<string>>();
  const connect = (ids: readonly string[]) => {
    const known = [...new Set(ids.filter((id) => entityIds.has(id)))];
    for (const left of known) {
      const neighbors = adjacency.get(left) ?? new Set<string>();
      adjacency.set(left, neighbors);
      for (const right of known) {
        if (left !== right) neighbors.add(right);
      }
    }
  };
  for (const constraint of semantic.ir.constraints) {
    connect(constraint.arguments.flatMap((argument) =>
      argument.entityId ? [argument.entityId] : []));
  }
  for (const relation of semantic.ir.relations) {
    connect(relation.participants.flatMap((participant) =>
      participant.entityId ? [participant.entityId] : []));
  }
  for (const entity of entities) {
    connect([entity.id, ...expressionEntityIds(entity.definition)]);
  }

  const depth = finiteLimit(options.focusDepth, 2);
  const maxFocusEntities = finiteLimit(options.maxFocusEntities, 160);
  const visited = new Set(resolvedEntityIds);
  let frontier = [...resolvedEntityIds];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const entityId of frontier) {
      for (const neighbor of adjacency.get(entityId) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  const fullClosure = [...visited].sort();
  return {
    requestedRefs,
    resolvedEntityIds,
    closureEntityIds: fullClosure.slice(0, maxFocusEntities),
    unresolvedRefs,
    depth,
    truncated: fullClosure.length > maxFocusEntities,
  };
}

function prioritize<T>(
  values: readonly T[],
  preferred: (value: T) => boolean,
): readonly T[] {
  return [
    ...values.filter(preferred),
    ...values.filter((value) => !preferred(value)),
  ];
}

type ManagedPlanContext = NonNullable<
  GeometryAiContext['construction']['sourceBindings'][number]['managedPlan']
>;

function compactCodecMessage(message: string): string {
  return message.length <= 240 ? message : `${message.slice(0, 237)}...`;
}

function unavailableManagedPlan(
  code: ConstructionPlanCodecIssueCode,
  path: string,
  message: string,
): ManagedPlanContext {
  return {
    schemaVersion: 'managed-construction-plan-context/v1',
    status: 'unavailable',
    issues: [{ code, path, message: compactCodecMessage(message) }],
  };
}

function compactConstruction(
  construction: ConstructionTruth,
  managedConstructions: readonly JsonObject[],
  sourceMap: GeometrySourceMap,
  focusEntityIds: ReadonlySet<string>,
  options: GeometryAiContextOptions,
): {
  value: GeometryAiContext['construction'];
  omitted: GeometryAiContext['truncation']['omitted'];
} {
  const sourceMapByBinding = new Map(
    sourceMap.entries.map((entry) => [entry.bindingId, entry]),
  );
  const sourcesById = new Map(
    construction.sources.map((source) => [source.sourceId, source] as const),
  );
  const managedBlocksBySourceId = new Map<string, ReturnType<typeof parseManagedConstructionBlocks>>();
  const managedPlanCache = new Map<string, ManagedPlanContext>();
  const managedPlanOf = (
    binding: ConstructionTruth['bindings'][number],
    constructionId: string,
    expectedSyntaxKind: string | undefined,
  ): ManagedPlanContext => {
    const sourceId = binding.source.document.sourceId;
    const range = binding.source.range;
    const cacheKey = `${sourceId}:${range.start}:${range.end}:${constructionId}:${expectedSyntaxKind ?? 'missing-syntax-kind'}`;
    const cached = managedPlanCache.get(cacheKey);
    if (cached) return cached;

    const source = sourcesById.get(sourceId);
    if (!source) {
      const unavailable = unavailableManagedPlan(
        'stale-block',
        'sourceId',
        'The revision-bound source document for this managed binding is unavailable.',
      );
      managedPlanCache.set(cacheKey, unavailable);
      return unavailable;
    }
    let blocks = managedBlocksBySourceId.get(sourceId);
    if (!blocks) {
      blocks = parseManagedConstructionBlocks(source.text);
      managedBlocksBySourceId.set(sourceId, blocks);
    }
    const matches = blocks.filter((block) => (
      block.id === constructionId
      && block.range.start === range.start
      && block.range.end === range.end
    ));
    if (matches.length !== 1) {
      const unavailable = unavailableManagedPlan(
        'stale-block',
        'range',
        `Expected one current managed block at the binding range; found ${matches.length}.`,
      );
      managedPlanCache.set(cacheKey, unavailable);
      return unavailable;
    }
    const decoded = decodeManagedConstructionPlan(source.text, matches[0]!);
    const decodedSyntaxKind = decoded.ok
      ? constructionPlanSyntaxKind(decoded.plan)
      : undefined;
    let result: ManagedPlanContext;
    if (decoded.ok && expectedSyntaxKind === undefined) {
      result = unavailableManagedPlan(
        'semantic-mismatch',
        'metadata.constructionSyntaxKind',
        'Managed binding is missing the concrete syntax kind required for replacement.',
      );
    } else if (decoded.ok && decodedSyntaxKind !== expectedSyntaxKind) {
      result = unavailableManagedPlan(
        'semantic-mismatch',
        'metadata.constructionSyntaxKind',
        `Managed binding syntax kind ${String(expectedSyntaxKind)} does not match canonical plan kind ${String(decodedSyntaxKind)}.`,
      );
    } else if (decoded.ok && decodedSyntaxKind !== undefined) {
      result = {
        schemaVersion: 'managed-construction-plan-context/v1',
        status: 'canonical',
        canonicalSource: true,
        syntaxKind: decodedSyntaxKind,
        // The codec has validated and byte-recompiled the full plan. Keep the
        // complete plan so either runtime can feed it directly to the trusted
        // recompiler without inventing omitted authoring fields.
        previousPlan: decoded.plan as unknown as JsonObject,
      };
    } else if (!decoded.ok) {
      result = {
        schemaVersion: 'managed-construction-plan-context/v1',
        status: 'unavailable',
        issues: decoded.issues.slice(0, 4).map((codecIssue) => ({
          code: codecIssue.code,
          path: codecIssue.path,
          message: compactCodecMessage(codecIssue.message),
        })),
      };
    } else {
      result = unavailableManagedPlan(
        'semantic-mismatch',
        'metadata.constructionSyntaxKind',
        'Canonical plan did not expose a concrete managed syntax kind.',
      );
    }
    managedPlanCache.set(cacheKey, result);
    return result;
  };
  const orderedBindings = prioritize(
    construction.bindings,
    (binding) => sourceMapByBinding.get(binding.id)?.entityIds
      .some((entityId) => focusEntityIds.has(entityId)) ?? false,
  );
  const bindings = takeWithOmitted(
    orderedBindings,
    finiteLimit(options.maxBindings, 240),
  );
  const opaque = takeWithOmitted(
    construction.opaqueNodes,
    finiteLimit(options.maxOpaqueNodes, 120),
  );
  const managed = takeWithOmitted(
    managedConstructions,
    finiteLimit(options.maxManagedConstructions, 120),
  );
  const sourceBindings: GeometryAiContext['construction']['sourceBindings'] =
    bindings.values.map((binding) => {
      const entityIds = sourceMapByBinding.get(binding.id)?.entityIds ?? [];
      const focusScoped = entityIds.some((entityId) => focusEntityIds.has(entityId));
      const emptyDocument = binding.metadata?.emptyDocument === true;
      const requiresFullEnvironment =
        binding.metadata?.requiresFullEnvironment === true;
      const insertionPolicy = binding.id === 'binding:document:tikzpicture-body-end'
        ? emptyDocument && requiresFullEnvironment
          ? 'full-document' as const
          : 'tikzpicture-body' as const
        : 'none' as const;
      const managedConstructionId = typeof binding.metadata?.constructionId === 'string'
        ? binding.metadata.constructionId
        : undefined;
      const managedPlanKind = typeof binding.metadata?.constructionKind === 'string'
        ? binding.metadata.constructionKind
        : undefined;
      const managedSyntaxKind = typeof binding.metadata?.constructionSyntaxKind === 'string'
        ? binding.metadata.constructionSyntaxKind
        : undefined;
      const managedContentFingerprint = typeof binding.metadata?.contentFingerprint === 'string'
        ? binding.metadata.contentFingerprint
        : undefined;
      const managedMetadataStatus = binding.metadata?.metadataStatus;
      const managedIntegrityStatus = binding.metadata?.integrityStatus;
      const writePolicy = binding.metadata?.writePolicy;
      const isManagedBlockBinding = binding.kind === 'source-range'
        && binding.syntaxNodeType === 'mathgeo-managed-construction';
      const decodedManagedPlan = focusScoped
        && isManagedBlockBinding
        && managedConstructionId
        ? managedPlanOf(binding, managedConstructionId, managedSyntaxKind)
        : undefined;
      const writeCapabilities = binding.id === 'binding:document:tikzpicture-body-end'
        && binding.writable
        ? ['create-managed-construction' as const]
        : writePolicy === 'managed-recompile-only'
          && isManagedBlockBinding
          && managedConstructionId
          && managedPlanKind
          && managedSyntaxKind
          && managedContentFingerprint
          && managedMetadataStatus === 'valid'
          && managedIntegrityStatus === 'valid'
          && decodedManagedPlan?.status === 'canonical'
          && decodedManagedPlan.syntaxKind === managedSyntaxKind
          ? ['replace-managed-construction' as const]
          : [];
      return {
        id: binding.id,
        role: binding.role,
        sourceId: binding.source.document.sourceId,
        targets: binding.targets,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false as const,
        insertionPolicy,
        writeCapabilities,
        ...(managedConstructionId ? { managedConstructionId } : {}),
        ...(managedPlanKind ? { managedPlanKind } : {}),
        ...(managedSyntaxKind ? { managedSyntaxKind } : {}),
        ...(managedContentFingerprint ? { managedContentFingerprint } : {}),
        ...(focusScoped && decodedManagedPlan
          ? { managedPlan: decodedManagedPlan }
          : {}),
        sliceHash: binding.source.sliceHash,
        ...(binding.source.verbatim.length <= 4_096
          ? { verbatim: binding.source.verbatim }
          : {}),
        entityIds,
        renderTargets: sourceMapByBinding.get(binding.id)?.renderTargets.map((target) => ({
          rendererId: target.rendererId,
          target: target.target,
          primitiveIds: target.primitiveIds,
        })) ?? [],
      };
    });
  const authorizedBindingIds = sourceBindings
    .filter((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
      || binding.entityIds.some((entityId) => focusEntityIds.has(entityId))
    ))
    .map((binding) => binding.id);
  const managedForContext = managed.values.map((summary) => {
    // Canonical previousPlan is attached only to the focus-scoped managed
    // block binding above. Raw semantic records are intentionally withheld in
    // both success and failure cases so the model cannot guess a replacement
    // plan when the codec rejected reconstruction.
    return Object.fromEntries(
      Object.entries(summary).filter(([key]) => key !== 'semanticRecords'),
    ) as JsonObject;
  });
  return {
    value: {
      sourceMapSchemaVersion: GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
      authorizedBindingIds,
      sourceBindings,
      opaqueNodes: opaque.values.map((node) => ({
        id: node.id,
        impact: node.impact,
        reason: node.reason,
        range: node.source.range,
        command: commandOf(node),
      })),
      managedConstructions: managedForContext,
    },
    omitted: {
      ...(bindings.omitted > 0 ? { sourceBindings: bindings.omitted } : {}),
      ...(opaque.omitted > 0 ? { opaqueNodes: opaque.omitted } : {}),
      ...(managed.omitted > 0
        ? { managedConstructions: managed.omitted }
        : {}),
    },
  };
}

export function buildGeometryAiContext(
  truths: GeometryTruthSet,
  options: GeometryAiContextOptions = {},
): GeometryAiContext {
  const focus = focusClosure(truths.semantic, options);
  const focusEntityIds = new Set(focus.closureEntityIds);
  const orderedEntities = prioritize(
    truths.semantic.ir.entities,
    (entity) => focusEntityIds.has(entity.id),
  );
  const orderedConstraints = prioritize(
    truths.semantic.ir.constraints,
    (constraint) => constraint.arguments.some((argument) =>
      argument.entityId ? focusEntityIds.has(argument.entityId) : false),
  );
  const orderedRelations = prioritize(
    truths.semantic.ir.relations,
    (relation) => relation.participants.some((participant) =>
      participant.entityId ? focusEntityIds.has(participant.entityId) : false),
  );
  const entities = takeWithOmitted(
    orderedEntities,
    finiteLimit(options.maxEntities, 240),
  );
  const constraints = takeWithOmitted(
    orderedConstraints,
    finiteLimit(options.maxConstraints, 180),
  );
  const relations = takeWithOmitted(
    orderedRelations,
    finiteLimit(options.maxRelations, 320),
  );
  const sourceMap = buildGeometrySourceMap(truths);
  const managedConstructions = managedConstructionSummaries(truths.semantic);
  const construction = compactConstruction(
    truths.construction,
    managedConstructions,
    sourceMap,
    focusEntityIds,
    options,
  );
  const omitted = {
    ...(entities.omitted > 0 ? { entities: entities.omitted } : {}),
    ...(constraints.omitted > 0 ? { constraints: constraints.omitted } : {}),
    ...(relations.omitted > 0 ? { relations: relations.omitted } : {}),
    ...construction.omitted,
  };
  const source = truths.construction.sources[0];

  return {
    schemaVersion: GEOMETRY_AI_CONTEXT_SCHEMA_VERSION,
    basis: {
      ...truths.semantic.basis,
      sourceId: source?.sourceId
        ?? truths.semantic.basis.sourceId
        ?? `${truths.semantic.basis.documentId}:tikz`,
      hashAlgorithm: source?.hashAlgorithm ?? 'unknown',
    },
    projection: {
      status: truths.semantic.status,
      semanticCoverage: semanticCoverage(truths.semantic),
      exactSourcePreserved: true,
      exactRenderingIsAuthoritative: true,
    },
    entities: entities.values.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      dimension: entity.dimension,
      definition: entity.definition,
      parameters: entity.parameters,
      tags: entity.tags,
      sourceBindingIds: entity.sourceBindingIds,
    })),
    constraints: constraints.values,
    relations: relations.values,
    focus,
    construction: construction.value,
    protocol: {
      writeMode: 'revision-hash-bound-transaction',
      opaquePolicy: 'preserve-never-invent-semantics',
      staleWritePolicy: 'reject',
    },
    truncation: {
      truncated: Object.keys(omitted).length > 0,
      omitted,
    },
  };
}

/** Compact, JSON-safe context for provider prompts and API boundaries. */
export function serializeGeometryAiContext(context: GeometryAiContext): string {
  return JSON.stringify(context);
}

export type GeometryAiContextMetadata = JsonObject;
