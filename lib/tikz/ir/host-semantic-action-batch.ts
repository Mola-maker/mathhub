import {
  isConstructionIntent,
  type ConstructionIntent,
} from '../authoring/construction-intent';
import {
  compileAiConstructionIntentProposal,
  type AiConstructionIntentValidationContext,
} from './ai-construction-intent-proposal';
import {
  compileAiManagedPresentationIntent,
  isAiManagedPresentationIntent,
  type AiManagedPresentationIntent,
} from './ai-managed-presentation-intent';
import type { AiPatchCompileOptions } from './ai-patch-proposal';
import type { JsonObject, SourceTextPatch } from './model';
import type {
  GeometryPrecondition,
  GeometryResourceReference,
  GeometryTransactionRequest,
} from './transactions';

export const HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION =
  'host-semantic-action-batch/v1' as const;

/**
 * Host-only composition of two already-closed public intents. This schema is
 * deliberately absent from model extractors and prompts: only the server may
 * create it after resolving one managed owner from the attested GeometryDoc.
 */
export interface HostSemanticActionBatch {
  readonly schemaVersion: typeof HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION;
  readonly batchId: string;
  readonly idempotencyKey: string;
  readonly styleIntent: AiManagedPresentationIntent;
  readonly labelIntent: ConstructionIntent;
}

export type HostSemanticActionBatchCompilation =
  | {
    readonly ok: true;
    readonly proposal: HostSemanticActionBatch;
    readonly transaction: GeometryTransactionRequest;
  }
  | {
    readonly ok: false;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
  };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameBasis(
  left: AiManagedPresentationIntent['basis'],
  right: ConstructionIntent['basis'],
): boolean {
  return left.documentId === right.documentId
    && left.epoch === right.epoch
    && left.revision === right.revision
    && left.sourceId === right.sourceId
    && left.sourceHash === right.sourceHash
    && left.hashAlgorithm === right.hashAlgorithm
    && left.kernelHash === right.kernelHash
    && left.projectionHash === right.projectionHash
    && left.pluginSetDigest === right.pluginSetDigest;
}

export function isHostSemanticActionBatch(
  value: unknown,
): value is HostSemanticActionBatch {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys) === JSON.stringify([
    'batchId', 'idempotencyKey', 'labelIntent', 'schemaVersion', 'styleIntent',
  ])
    && value.schemaVersion === HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION
    && typeof value.batchId === 'string'
    && value.batchId.length > 0
    && value.batchId.length <= 256
    && typeof value.idempotencyKey === 'string'
    && value.idempotencyKey.length > 0
    && value.idempotencyKey.length <= 256
    && isAiManagedPresentationIntent(value.styleIntent)
    && isConstructionIntent(value.labelIntent);
}

function uniqueByJson<T>(values: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourcePatches(transaction: GeometryTransactionRequest): readonly SourceTextPatch[] {
  return transaction.operations.flatMap((operation) => (
    operation.op === 'source-patch' ? [...operation.patches] : []
  ));
}

function rangesOverlap(left: SourceTextPatch, right: SourceTextPatch): boolean {
  if (left.sourceId !== right.sourceId) return false;
  if (left.range.start === left.range.end) {
    return left.range.start > right.range.start && left.range.start < right.range.end;
  }
  if (right.range.start === right.range.end) {
    return right.range.start > left.range.start && right.range.start < left.range.end;
  }
  return left.range.start < right.range.end && right.range.start < left.range.end;
}

function fail(code: string, message: string): HostSemanticActionBatchCompilation {
  return { ok: false, errors: [{ code, message }] };
}

export function compileHostSemanticActionBatch(
  value: unknown,
  context: AiConstructionIntentValidationContext,
  options: AiPatchCompileOptions = {},
): HostSemanticActionBatchCompilation {
  if (!isHostSemanticActionBatch(value)) {
    return fail('invalid-shape', 'Host semantic action batch has an invalid or open shape.');
  }
  if (!sameBasis(value.styleIntent.basis, value.labelIntent.basis)) {
    return fail('basis-mismatch', 'Host semantic action components do not share one source basis.');
  }
  if (
    value.labelIntent.operation !== 'create'
    || value.labelIntent.toolId !== 'label'
    || value.labelIntent.bindingIds.length !== 1
    || value.styleIntent.operation.constructionId.length === 0
  ) {
    return fail('invalid-shape', 'Host semantic action batch must contain one style update and one label create.');
  }

  const style = compileAiManagedPresentationIntent(value.styleIntent, context, options);
  if (!style.ok) return { ok: false, errors: style.errors };
  const label = compileAiConstructionIntentProposal(value.labelIntent, context, options);
  if (!label.ok) return { ok: false, errors: label.errors };

  const stylePatches = sourcePatches(style.transaction);
  const labelPatches = sourcePatches(label.transaction);
  if (
    stylePatches.length !== 1
    || labelPatches.length !== 1
    || stylePatches[0]!.insert.length === 0
    || labelPatches[0]!.insert.length === 0
    || rangesOverlap(stylePatches[0]!, labelPatches[0]!)
  ) {
    return fail('compile-failed', 'Host semantic action components did not compile to two disjoint atomic patches.');
  }

  const styleMetadata = style.transaction.metadata ?? {};
  const labelMetadata = label.transaction.metadata ?? {};
  const patches = [stylePatches[0]!, labelPatches[0]!]
    .sort((left, right) => right.range.start - left.range.start);
  const preconditions = uniqueByJson<GeometryPrecondition>([
    ...(style.transaction.preconditions ?? []),
    ...(label.transaction.preconditions ?? []),
  ]);
  const readSet = uniqueByJson<GeometryResourceReference>([
    ...style.transaction.readSet,
    ...label.transaction.readSet,
  ]);
  const writeSet = uniqueByJson<GeometryResourceReference>([
    ...style.transaction.writeSet,
    ...label.transaction.writeSet,
  ]);
  const focusBindingIds = uniqueByJson<string>([
    ...value.styleIntent.focusBindingIds,
    ...value.labelIntent.bindingIds,
  ]);
  const readBindingIds = uniqueByJson<string>([
    ...value.styleIntent.readBindingIds,
    ...value.labelIntent.bindingIds,
    value.labelIntent.capability.bindingId,
  ]);

  return {
    ok: true,
    proposal: value,
    transaction: {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: value.batchId,
      idempotencyKey: value.idempotencyKey,
      documentId: style.transaction.documentId,
      documentEpoch: style.transaction.documentEpoch,
      origin: 'ai',
      stage: 'proposed',
      expectedRevision: style.transaction.expectedRevision,
      sourceHash: style.transaction.sourceHash,
      expectedKernelHash: style.transaction.expectedKernelHash,
      expectedProjectionHash: label.transaction.expectedProjectionHash,
      pluginSetDigest: style.transaction.pluginSetDigest,
      readSet,
      writeSet,
      preconditions,
      operations: [{
        operationId: `${value.batchId}:source`,
        op: 'source-patch',
        patches,
        preconditions,
      }],
      actorId: options.actorId,
      correlationId: options.correlationId,
      metadata: {
        ...styleMetadata,
        ...labelMetadata,
        ...options.metadata,
        proposalSchemaVersion: HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION,
        sourceEditOrigin: 'ai',
        semanticWrite: true,
        focusBindingIds,
        readBindingIds,
        managedConstructionOperationKind: 'create-managed-construction',
        managedConstructionStyleProof: styleMetadata.managedConstructionStyleProof,
        managedPresentationTargetEntityId:
          styleMetadata.managedPresentationTargetEntityId,
        managedConstructionCreateProof: labelMetadata.managedConstructionCreateProof,
        authoringSchemaVersion: labelMetadata.authoringSchemaVersion,
        constructionIntentProof: labelMetadata.constructionIntentProof,
        hostSemanticActionBatchProof: value as unknown as JsonObject,
      },
    },
  };
}
