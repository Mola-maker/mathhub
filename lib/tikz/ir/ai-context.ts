import type {
  ConstructionTruth,
  GeometryEntity,
  GeometryRevisionBasis,
  GeometryStyle,
  GeometryTruthSet,
  JsonObject,
  JsonValue,
  OpaqueConstructionNode,
  SemanticTruth,
} from './model';
import { buildGeometryRepoMap } from './geometry-repo-map';
import {
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
  type ConstructionPlanCodecIssueCode,
} from '../authoring/construction-plan-codec';
import {
  compileConstructionWriterArtifact,
  type ConstructionPlan,
} from '../authoring/construction-ir';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import {
  buildGeometrySourceMap,
  GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
  type GeometrySourceMap,
} from './source-map';
import type { GeometryDoc } from './geometry-doc';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  CONSTRUCTION_TOOL_SPECS,
  constructionIntentContract,
  type ConstructionCategory,
} from '../authoring/construction-catalog';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';

export const GEOMETRY_AI_CONTEXT_SCHEMA_VERSION = 'geometry-ai-context/v1' as const;

function isDirectRawCircleDefinition(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'center-through') {
    return typeof record.centerName === 'string'
      && record.centerName.length > 0
      && typeof record.throughName === 'string'
      && record.throughName.length > 0;
  }
  if (record.kind === 'center-radius') {
    return typeof record.centerName === 'string'
      && record.centerName.length > 0
      && typeof record.radius === 'number'
      && Number.isFinite(record.radius)
      && record.radius > 0;
  }
  return false;
}

export interface GeometryAiContextOptions {
  maxEntities?: number;
  maxConstraints?: number;
  maxRelations?: number;
  maxStyles?: number;
  /** Total JSON character budget for the provider-facing style slice. */
  maxStyleContextChars?: number;
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
  /** Ordered source option metadata is retained on each style when available. */
  styles: readonly GeometryStyle[];
  focus: {
    requestedRefs: readonly string[];
    resolvedEntityIds: readonly string[];
    closureEntityIds: readonly string[];
    unresolvedRefs: readonly string[];
    ambiguousRefs?: readonly string[];
    depth: number;
    truncated: boolean;
    ranking?: readonly {
      entityId: string;
      score: number;
      distance: number;
      reasons: readonly string[];
      evidenceRecordIds: readonly string[];
    }[];
  };
  construction: {
    constructionCatalogDigest: string;
    authorizationScopeFingerprint: string;
    intentTools: readonly {
      toolId: string;
      category: Exclude<ConstructionCategory, 'navigate'>;
      inputKinds: readonly ('point' | 'circle')[];
      minInputs: number;
      maxInputs: number;
      repeatedInputKind?: 'point' | 'circle';
      requestedNameKeys: readonly string[];
      parameterSchema: 'none' | 'point-position' | 'circle-angle' | 'label-text';
      /** Current focus can satisfy every input without an earlier DAG output. */
      currentInputReady: boolean;
      outputSlots: readonly {
        key: string;
        produces: 'point' | 'circle';
        roles: readonly string[];
      }[];
    }[];
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
        | 'update-managed-presentation'
      )[];
      managedPresentationTargets?: readonly {
        entityId: string;
        slotId: string;
        role: string;
      }[];
      managedConstructionId?: string;
      managedSourceRecordId?: string;
      managedPlanKind?: string;
      /** Concrete managed syntax kind; primitive plans retain point/segment/etc. */
      managedSyntaxKind?: string;
      managedContentFingerprint?: string;
      managedPresentationFingerprint?: string;
      managedWriterId?: string;
      managedWriterRevision?: number;
      managedWriterSlotIds?: readonly string[];
      managedWriterSlotSemanticFingerprints?: readonly string[];
      managedAttachmentsFingerprint?: string;
      createCapabilityFingerprint?: string;
      /**
       * Focus-scoped proof that the current schema-v2 managed block can be
       * reconstructed by the same writer ABI on server and client, with a
       * separate lossless presentation proof when source is non-canonical.
       * This never makes the underlying raw source binding writable.
       */
      managedPlan?:
        | {
          schemaVersion: 'managed-construction-plan-context/v1';
          status: 'canonical';
          /** True only when the complete block is canonical writer output. */
          canonicalSource: boolean;
          syntaxKind: string;
          previousPlan: JsonObject;
          writer: {
            writerId: string;
            writerRevision: number;
            slotIds: readonly string[];
            slotSemanticFingerprints: readonly string[];
          };
          presentation?: {
            schema: 'managed-presentation/v1';
            status: 'lossless';
            writerId: string;
            writerRevision: number;
            presentationFingerprint: string;
            attachmentsFingerprint: string;
            attachmentCount: number;
            opaqueSlotCount: number;
          };
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
      | 'styles'
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

const MAX_AI_STYLE_OPTION_ENTRIES = 24;
const MAX_AI_STYLE_OPTION_KEY_LENGTH = 128;
const MAX_AI_STYLE_OPTION_VALUE_LENGTH = 512;

function boundedAiText(value: JsonValue | undefined, limit: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function compactStyleMetadata(metadata: JsonObject | undefined): JsonObject | undefined {
  const sequence = metadata?.optionSequence;
  if (!sequence || !isJsonObject(sequence)) return undefined;
  const rawEntries = Array.isArray(sequence.entries)
    ? sequence.entries.filter((entry): entry is JsonObject => isJsonObject(entry))
    : [];
  const entries = rawEntries.slice(0, MAX_AI_STYLE_OPTION_ENTRIES).map((entry) => {
    const keySource = entry.interpretedKey ?? entry.key;
    const interpreted = boundedAiText(
      keySource,
      MAX_AI_STYLE_OPTION_KEY_LENGTH,
    );
    const valueSource = entry.interpretedValue ?? entry.value;
    const value = boundedAiText(valueSource, MAX_AI_STYLE_OPTION_VALUE_LENGTH);
    const originalValueLength = typeof valueSource === 'string' ? valueSource.length : 0;
    return {
      ordinal: typeof entry.ordinal === 'number' ? entry.ordinal : 0,
      key: interpreted ?? '',
      value,
      range: isJsonObject(entry.range) ? entry.range : null,
      ...(typeof valueSource === 'string' && originalValueLength > MAX_AI_STYLE_OPTION_VALUE_LENGTH
        ? { valueTruncated: true }
        : {}),
    };
  });
  return {
    optionSequence: {
      schema: typeof sequence.schema === 'string' ? sequence.schema : 'unknown',
      ordered: sequence.ordered === true,
      balanced: sequence.balanced === true,
      range: isJsonObject(sequence.range) ? sequence.range : null,
      entryCount: rawEntries.length,
      entries,
      truncated: rawEntries.length > entries.length,
    },
  };
}

function compactStyleForAi(style: GeometryStyle): GeometryStyle {
  const metadata = compactStyleMetadata(style.metadata);
  return {
    recordType: style.recordType,
    id: style.id,
    selector: style.selector,
    properties: style.properties,
    ...(style.precedence !== undefined ? { precedence: style.precedence } : {}),
    ...(style.sourceBindingIds ? { sourceBindingIds: style.sourceBindingIds } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function takeStylesWithinBudget(
  values: readonly GeometryStyle[],
  countLimit: number,
  characterBudget: number,
): { values: readonly GeometryStyle[]; omitted: number } {
  const selected: GeometryStyle[] = [];
  let used = 2; // JSON array brackets.
  for (const style of values.slice(0, countLimit)) {
    const compact = compactStyleForAi(style);
    const serializedLength = JSON.stringify(compact).length;
    const separatorLength = selected.length > 0 ? 1 : 0;
    if (used + separatorLength + serializedLength > characterBudget) break;
    selected.push(compact);
    used += separatorLength + serializedLength;
  }
  return {
    values: selected,
    omitted: Math.max(0, values.length - selected.length),
  };
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

function focusClosure(
  semantic: SemanticTruth,
  options: GeometryAiContextOptions,
): GeometryAiContext['focus'] {
  const depth = finiteLimit(options.focusDepth, 2);
  const maxFocusEntities = finiteLimit(options.maxFocusEntities, 160);
  const repoMap = buildGeometryRepoMap(semantic, {
    focusRefs: options.focusRefs,
    depth,
    maxEntries: maxFocusEntities,
  });
  return {
    requestedRefs: repoMap.requestedRefs,
    resolvedEntityIds: repoMap.resolvedEntityIds,
    closureEntityIds: repoMap.entries.map((entry) => entry.entityId),
    unresolvedRefs: repoMap.unresolvedRefs,
    ambiguousRefs: repoMap.ambiguousRefs,
    depth: repoMap.depth,
    truncated: repoMap.truncated,
    ranking: repoMap.entries,
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
  semantic: SemanticTruth,
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
      const writer = compileConstructionWriterArtifact(decoded.plan);
      result = {
        schemaVersion: 'managed-construction-plan-context/v1',
        status: 'canonical',
        canonicalSource: decoded.presentation === undefined,
        syntaxKind: decodedSyntaxKind,
        // The codec has validated and byte-recompiled the full plan. Keep the
        // complete plan so either runtime can feed it directly to the trusted
        // recompiler without inventing omitted authoring fields.
        previousPlan: decoded.plan as unknown as JsonObject,
        writer: {
          writerId: writer.writerId,
          writerRevision: writer.writerRevision,
          slotIds: writer.slots.map((slot) => slot.id),
          slotSemanticFingerprints: writer.slots.map((slot) => (
            slot.semanticFingerprint
          )),
        },
        ...(decoded.presentation
          ? {
            presentation: {
              schema: decoded.presentation.schema,
              status: 'lossless' as const,
              writerId: decoded.presentation.writerId,
              writerRevision: decoded.presentation.writerRevision,
              presentationFingerprint: decoded.presentation.presentationFingerprint,
              attachmentsFingerprint: decoded.presentation.attachmentsFingerprint,
              attachmentCount: decoded.presentation.attachments.length,
              opaqueSlotCount: decoded.presentation.opaqueSlots.length,
            },
          }
          : {}),
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
  // Managed constraint/relation records already appear in the semantic
  // constraints/relations lanes. Repeating each record as a source binding is
  // not actionable (managed records are never directly writable) and makes a
  // single composite construction exceed the API context budget. Keep entity
  // record bindings because typed construction intents can legitimately use a
  // managed output point/circle as their next input (for example, labeling the
  // nine-point center).
  const actionableBindings = construction.bindings.filter((binding) => {
    const sourceRecordType = binding.metadata?.sourceRecordType;
    return sourceRecordType === undefined || sourceRecordType === 'entity';
  });
  const compactedBindingCount = construction.bindings.length - actionableBindings.length;
  const orderedBindings = prioritize(
    actionableBindings,
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
      const managedSourceRecordId = typeof binding.metadata?.sourceRecordId === 'string'
        ? binding.metadata.sourceRecordId
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
      const semanticEntityIdsBySourceRecord = new Map<string, string>();
      if (managedConstructionId) {
        for (const recordBinding of construction.bindings) {
          const recordConstructionId = recordBinding.metadata?.constructionId
            ?? recordBinding.metadata?.managedConstructionId;
          const sourceRecordId = recordBinding.metadata?.sourceRecordId;
          const entityIds = sourceMapByBinding.get(recordBinding.id)?.entityIds ?? [];
          if (
            recordConstructionId === managedConstructionId
            && typeof sourceRecordId === 'string'
            && entityIds.length === 1
          ) {
            semanticEntityIdsBySourceRecord.set(sourceRecordId, entityIds[0]!);
          }
        }
      }
      const managedPresentationTargets = decodedManagedPlan?.status === 'canonical'
        ? compileConstructionWriterArtifact(
          decodedManagedPlan.previousPlan as unknown as ConstructionPlan,
        ).slots.flatMap((slot) => slot.optionSites.length === 1
          ? slot.owners.flatMap((owner) => owner.startsWith('entity:')
            ? (() => {
              const entityId = semanticEntityIdsBySourceRecord.get(
                owner.slice('entity:'.length),
              );
              return entityId
                ? [{ entityId, slotId: slot.id, role: slot.role }]
                : [];
            })()
            : [])
          : [])
        : [];
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
          ? [
            'replace-managed-construction' as const,
            ...(managedPresentationTargets.length > 0
              ? ['update-managed-presentation' as const]
              : []),
          ]
          : [];
      const createCapabilityFingerprint = typeof binding.metadata?.capabilityFingerprint === 'string'
        ? binding.metadata.capabilityFingerprint
        : undefined;
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
        ...(managedPresentationTargets.length > 0
          ? { managedPresentationTargets }
          : {}),
        ...(createCapabilityFingerprint ? { createCapabilityFingerprint } : {}),
        ...(managedConstructionId ? { managedConstructionId } : {}),
        ...(managedSourceRecordId ? { managedSourceRecordId } : {}),
        ...(managedPlanKind ? { managedPlanKind } : {}),
        ...(managedSyntaxKind ? { managedSyntaxKind } : {}),
        ...(managedContentFingerprint ? { managedContentFingerprint } : {}),
        ...(decodedManagedPlan?.status === 'canonical'
          ? {
            managedWriterId: decodedManagedPlan.writer.writerId,
            managedWriterRevision: decodedManagedPlan.writer.writerRevision,
            managedWriterSlotIds: decodedManagedPlan.writer.slotIds,
            managedWriterSlotSemanticFingerprints:
              decodedManagedPlan.writer.slotSemanticFingerprints,
          }
          : {}),
        ...(decodedManagedPlan?.status === 'canonical'
          && decodedManagedPlan.presentation
          ? {
            managedPresentationFingerprint:
              decodedManagedPlan.presentation.presentationFingerprint,
            managedAttachmentsFingerprint:
              decodedManagedPlan.presentation.attachmentsFingerprint,
          }
          : {}),
        ...(focusScoped && decodedManagedPlan
          ? { managedPlan: decodedManagedPlan }
          : {}),
        sliceHash: binding.source.sliceHash,
        ...(managedSourceRecordId === undefined && binding.source.verbatim.length <= 4_096
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
  const createCapabilityFingerprint = sourceBindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ))?.createCapabilityFingerprint ?? '';
  const authorizedBindingIdSet = new Set(authorizedBindingIds);
  const pointEntityIds = new Set(
    semantic.ir.entities
      .filter((entity) => entity.kind === 'point')
      .map((entity) => entity.id),
  );
  const pointInputEntityCount = new Set(sourceBindings.flatMap((binding) => (
    authorizedBindingIdSet.has(binding.id)
    && binding.entityIds.length === 1
    && pointEntityIds.has(binding.entityIds[0]!)
      ? [binding.entityIds[0]!]
      : []
  ))).size;
  const circleEntityIds = new Set(
    semantic.ir.entities
      .filter((entity) => entity.kind === 'circle')
      .map((entity) => entity.id),
  );
  const managedCircleEntityIds = new Set(sourceBindings.flatMap((binding) => (
    authorizedBindingIdSet.has(binding.id)
    && Boolean(binding.managedConstructionId)
    && Boolean(binding.managedSourceRecordId)
      ? binding.entityIds.filter((entityId) => circleEntityIds.has(entityId))
      : []
  )));
  const adoptableRawCircleEntityIds = new Set(
    semantic.ir.entities.flatMap((entity) => {
      if (
        entity.kind !== 'circle'
        || typeof entity.metadata?.persistentSourceReference !== 'string'
        || !isDirectRawCircleDefinition(entity.parameters?.circleDefinition)
      ) return [];
      const binding = sourceBindings.find((candidate) => (
        candidate.id === `binding:${entity.id}`
      ));
      return binding
        && authorizedBindingIdSet.has(binding.id)
        && binding.writable
        && binding.entityIds.length === 1
        && binding.entityIds[0] === entity.id
        ? [entity.id]
        : [];
    }),
  );
  const circleInputEntityCount = new Set([
    ...managedCircleEntityIds,
    ...adoptableRawCircleEntityIds,
  ]).size;
  const intentTools = CONSTRUCTION_TOOL_SPECS
    .filter((spec) => spec.category !== 'navigate')
    .map((spec) => {
      const contract = constructionIntentContract(spec);
      const requiredCircleInputs = contract.inputKinds.filter((kind) => (
        kind === 'circle'
      )).length;
      const requiredPointInputs = contract.inputKinds.filter((kind) => (
        kind === 'point'
      )).length;
      return {
        toolId: spec.id,
        category: spec.category as Exclude<ConstructionCategory, 'navigate'>,
        inputKinds: contract.inputKinds,
        minInputs: contract.minInputs,
        maxInputs: contract.maxInputs,
        ...(contract.repeatedInputKind
          ? { repeatedInputKind: contract.repeatedInputKind }
          : {}),
        requestedNameKeys: contract.requestedNameKeys,
        parameterSchema: contract.parameterSchema,
        currentInputReady: requiredCircleInputs <= circleInputEntityCount
          && requiredPointInputs <= pointInputEntityCount,
        outputSlots: contract.outputSlots,
      };
    });
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
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      authorizationScopeFingerprint: constructionAuthorizationScopeFingerprint({
        basis: semantic.basis,
        authorizedBindingIds,
        createCapabilityFingerprint,
      }),
      intentTools,
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
      ...(bindings.omitted + compactedBindingCount > 0
        ? { sourceBindings: bindings.omitted + compactedBindingCount }
        : {}),
      ...(opaque.omitted > 0 ? { opaqueNodes: opaque.omitted } : {}),
      ...(managed.omitted > 0
        ? { managedConstructions: managed.omitted }
        : {}),
    },
  };
}

export function buildGeometryAiContext(
  truths: GeometryTruthSet | GeometryDoc,
  options: GeometryAiContextOptions = {},
): GeometryAiContext {
  const focus = focusClosure(truths.semantic, options);
  const focusEntityIds = new Set(focus.closureEntityIds);
  const focusOrder = new Map(
    focus.closureEntityIds.map((entityId, index) => [entityId, index]),
  );
  const orderedEntities = [...truths.semantic.ir.entities].sort((left, right) => {
    const leftRank = focusOrder.get(left.id);
    const rightRank = focusOrder.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return 0;
  });
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
  const orderedStyles = prioritize(
    truths.semantic.ir.styles,
    (style) => style.selector.entityIds?.some((entityId) =>
      focusEntityIds.has(entityId)) ?? false,
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
  const styles = takeStylesWithinBudget(
    orderedStyles,
    finiteLimit(options.maxStyles, 64),
    finiteLimit(options.maxStyleContextChars, 24_000),
  );
  const sourceMap = 'sourceMap' in truths
    ? truths.sourceMap
    : buildGeometrySourceMap(truths);
  const managedConstructions = managedConstructionSummaries(truths.semantic);
  const construction = compactConstruction(
    truths.construction,
    truths.semantic,
    managedConstructions,
    sourceMap,
    focusEntityIds,
    options,
  );
  const omitted = {
    ...(entities.omitted > 0 ? { entities: entities.omitted } : {}),
    ...(constraints.omitted > 0 ? { constraints: constraints.omitted } : {}),
    ...(relations.omitted > 0 ? { relations: relations.omitted } : {}),
    ...(styles.omitted > 0 ? { styles: styles.omitted } : {}),
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
    // Exact presentation bytes remain source-bound. The provider receives a
    // bounded ordered view so a legal but huge option value cannot amplify the
    // semantic-kernel request beyond the API budget.
    styles: styles.values,
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

/**
 * Keep complete plans in the trusted host context, but replace them with an
 * on-demand reference in the provider prompt. Large composite plans otherwise
 * consume the model budget on every conversational turn even when the user is
 * only asking a question or adding a label.
 */
export function serializeGeometryAiContextForPrompt(
  context: GeometryAiContext,
): string {
  const sourceBindings = context.construction.sourceBindings.map((binding) => {
    const managedPlan = binding.managedPlan?.status === 'canonical'
      ? {
          ...binding.managedPlan,
          previousPlan: {
            schemaVersion: 'managed-plan-reference/v1',
            retrievalTool: 'inspect-geometry',
            planKind: binding.managedPlanKind,
            planId: binding.managedConstructionId,
          },
        }
      : binding.managedPlan;
    return {
      id: binding.id,
      sourceId: binding.sourceId,
      range: binding.range,
      writable: binding.writable,
      opaque: binding.opaque,
      insertionPolicy: binding.insertionPolicy,
      writeCapabilities: binding.writeCapabilities,
      managedPresentationTargets: binding.managedPresentationTargets,
      managedConstructionId: binding.managedConstructionId,
      managedSourceRecordId: binding.managedSourceRecordId,
      managedPlanKind: binding.managedPlanKind,
      managedSyntaxKind: binding.managedSyntaxKind,
      managedContentFingerprint: binding.managedContentFingerprint,
      managedPresentationFingerprint: binding.managedPresentationFingerprint,
      managedWriterId: binding.managedWriterId,
      managedWriterRevision: binding.managedWriterRevision,
      managedWriterSlotIds: binding.managedWriterSlotIds,
      managedWriterSlotSemanticFingerprints:
        binding.managedWriterSlotSemanticFingerprints,
      managedAttachmentsFingerprint: binding.managedAttachmentsFingerprint,
      createCapabilityFingerprint: binding.createCapabilityFingerprint,
      managedPlan,
      sliceHash: binding.sliceHash,
      entityIds: binding.entityIds,
    };
  });
  return JSON.stringify({
    schemaVersion: context.schemaVersion,
    basis: context.basis,
    projection: context.projection,
    entities: context.entities,
    constraints: context.constraints.map((constraint) => ({
      id: constraint.id,
      kind: constraint.kind,
      arguments: constraint.arguments.map((argument) => ({
        role: argument.role,
        entityId: argument.entityId,
        value: argument.value,
      })),
    })),
    relations: context.relations.map((relation) => ({
      id: relation.id,
      kind: relation.kind,
      participants: relation.participants.map((participant) => ({
        role: participant.role,
        entityId: participant.entityId,
      })),
    })),
    styles: context.styles,
    // The full evidence-backed ranking remains available to the host and the
    // inspect-geometry read tool. The initial provider prompt only needs the
    // already rank-ordered closure; repeating every reason/evidence edge here
    // wastes the runtime-context budget on large managed constructions.
    focus: {
      requestedRefs: context.focus.requestedRefs,
      resolvedEntityIds: context.focus.resolvedEntityIds,
      closureEntityIds: context.focus.closureEntityIds,
      unresolvedRefs: context.focus.unresolvedRefs,
      ambiguousRefs: context.focus.ambiguousRefs,
      depth: context.focus.depth,
      truncated: context.focus.truncated,
    },
    construction: {
      constructionCatalogDigest: context.construction.constructionCatalogDigest,
      authorizationScopeFingerprint:
        context.construction.authorizationScopeFingerprint,
      intentTools: context.construction.intentTools,
      sourceMapSchemaVersion: context.construction.sourceMapSchemaVersion,
      authorizedBindingIds: context.construction.authorizedBindingIds,
      sourceBindings,
      opaqueNodes: context.construction.opaqueNodes,
    },
    protocol: context.protocol,
    truncation: context.truncation,
  });
}

export type GeometryAiContextMetadata = JsonObject;
