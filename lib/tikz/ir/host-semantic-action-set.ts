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

export const HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION =
  'host-semantic-action-set/v1' as const;

const MAX_LABEL_ACTIONS = 16;

export interface HostSemanticActionSet {
  readonly schemaVersion: typeof HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION;
  readonly actionSetId: string;
  readonly idempotencyKey: string;
  /** Optional because a model may request several labels without a style edit. */
  readonly styleIntent?: AiManagedPresentationIntent;
  readonly labelIntents: readonly ConstructionIntent[];
}

export type HostSemanticActionSetCompilation =
  | {
    readonly ok: true;
    readonly proposal: HostSemanticActionSet;
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
  left: AiManagedPresentationIntent['basis'] | ConstructionIntent['basis'],
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

export function isHostSemanticActionSet(
  value: unknown,
): value is HostSemanticActionSet {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    'actionSetId',
    'idempotencyKey',
    'labelIntents',
    'schemaVersion',
    ...(value.styleIntent === undefined ? [] : ['styleIntent']),
  ])) return false;
  if (
    value.schemaVersion !== HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION
    || typeof value.actionSetId !== 'string'
    || value.actionSetId.length === 0
    || value.actionSetId.length > 256
    || typeof value.idempotencyKey !== 'string'
    || value.idempotencyKey.length === 0
    || value.idempotencyKey.length > 256
    || (
      value.styleIntent !== undefined
      && !isAiManagedPresentationIntent(value.styleIntent)
    )
    || !Array.isArray(value.labelIntents)
    || value.labelIntents.length === 0
    || value.labelIntents.length > MAX_LABEL_ACTIONS
    || value.labelIntents.some((intent) => !isConstructionIntent(intent))
  ) return false;
  return true;
}

function sourcePatches(
  transaction: GeometryTransactionRequest,
): readonly SourceTextPatch[] {
  return transaction.operations.flatMap((operation) => (
    operation.op === 'source-patch' ? [...operation.patches] : []
  ));
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

function fail(code: string, message: string): HostSemanticActionSetCompilation {
  return { ok: false, errors: [{ code, message }] };
}

/**
 * Host-only lowering for several label creations and an optional style
 * rewrite. The model still emits one closed GeometryIntent; the host merges
 * equal-position insertions into one deterministic patch and the Broker
 * replays every public intent.
 */
export function compileHostSemanticActionSet(
  value: unknown,
  context: AiConstructionIntentValidationContext,
  options: AiPatchCompileOptions = {},
): HostSemanticActionSetCompilation {
  if (!isHostSemanticActionSet(value)) {
    return fail('invalid-shape', 'Host semantic action set has an invalid or open shape.');
  }
  const sharedBasis = value.styleIntent?.basis ?? value.labelIntents[0]?.basis;
  if (
    !sharedBasis
    || value.labelIntents.some((intent) => !sameBasis(sharedBasis, intent.basis))
    || new Set(value.labelIntents.map((intent) => intent.intentId)).size
      !== value.labelIntents.length
    || new Set(value.labelIntents.map((intent) => intent.bindingIds[0])).size
      !== value.labelIntents.length
    || value.labelIntents.some((intent) => (
      intent.operation !== 'create'
      || intent.toolId !== 'label'
      || intent.bindingIds.length !== 1
    ))
  ) {
    return fail('basis-mismatch', 'Host semantic actions must be unique label creates on one source basis.');
  }

  const style = value.styleIntent
    ? compileAiManagedPresentationIntent(value.styleIntent, context, options)
    : null;
  if (style && !style.ok) return { ok: false, errors: style.errors };
  const labels = value.labelIntents.map((intent) => (
    compileAiConstructionIntentProposal(intent, context, options)
  ));
  const failed = labels.find((label) => !label.ok);
  if (failed && !failed.ok) return { ok: false, errors: failed.errors };

  const styleTransaction = style && style.ok ? style.transaction : null;
  const stylePatches = styleTransaction ? sourcePatches(styleTransaction) : [];
  const labelTransactions = labels.flatMap((label) => (
    label.ok ? [label.transaction] : []
  ));
  const labelPatches = labelTransactions.flatMap(sourcePatches);
  const firstLabelPatch = labelPatches[0];
  if (
    (styleTransaction !== null && (stylePatches.length !== 1 || !stylePatches[0]?.insert))
    || labelPatches.length !== value.labelIntents.length
    || !firstLabelPatch
    || labelPatches.some((patch) => (
      patch.sourceId !== firstLabelPatch.sourceId
      || patch.range.start !== firstLabelPatch.range.start
      || patch.range.end !== firstLabelPatch.range.end
      || patch.expectedText !== firstLabelPatch.expectedText
      || patch.insert.length === 0
    ))
  ) {
    return fail('compile-failed', 'Host semantic actions did not compile to one optional style patch and one shared insertion site.');
  }
  const mergedLabelPatch: SourceTextPatch = {
    ...firstLabelPatch,
    insert: labelPatches.map((patch) => patch.insert).join(''),
  };
  const patches = [...stylePatches, mergedLabelPatch]
    .sort((left, right) => right.range.start - left.range.start);
  if (patches.length === 2 && (
    patches[0]!.range.start < patches[1]!.range.end
    && patches[1]!.range.start < patches[0]!.range.end
  )) {
    return fail('compile-failed', 'Host semantic action patches overlap.');
  }

  const labelMetadata = labelTransactions.map((transaction) => transaction.metadata ?? {});
  if (
    (
      styleTransaction !== null
      && styleTransaction.metadata?.managedConstructionStyleProof === undefined
    )
    || labelMetadata.some((metadata) => (
      metadata.managedConstructionCreateProof === undefined
      || metadata.constructionIntentProof === undefined
    ))
  ) {
    return fail('compile-failed', 'Host semantic actions are missing trusted writer proofs.');
  }
  const preconditions = uniqueByJson<GeometryPrecondition>([
    ...(styleTransaction?.preconditions ?? []),
    ...labelTransactions.flatMap((transaction) => transaction.preconditions ?? []),
  ]);
  const readSet = uniqueByJson<GeometryResourceReference>([
    ...(styleTransaction?.readSet ?? []),
    ...labelTransactions.flatMap((transaction) => transaction.readSet),
  ]);
  const writeSet = uniqueByJson<GeometryResourceReference>([
    ...(styleTransaction?.writeSet ?? []),
    ...labelTransactions.flatMap((transaction) => transaction.writeSet),
  ]);
  const focusBindingIds = uniqueByJson<string>([
    ...(value.styleIntent?.focusBindingIds ?? []),
    ...value.labelIntents.flatMap((intent) => intent.bindingIds),
  ]);
  const readBindingIds = uniqueByJson<string>([
    ...(value.styleIntent?.readBindingIds ?? []),
    ...value.labelIntents.flatMap((intent) => [
      ...intent.bindingIds,
      intent.capability.bindingId,
    ]),
  ]);
  const basisTransaction = styleTransaction ?? labelTransactions[0]!;

  return {
    ok: true,
    proposal: value,
    transaction: {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: value.actionSetId,
      idempotencyKey: value.idempotencyKey,
      documentId: basisTransaction.documentId,
      documentEpoch: basisTransaction.documentEpoch,
      origin: 'ai',
      stage: 'proposed',
      expectedRevision: basisTransaction.expectedRevision,
      sourceHash: basisTransaction.sourceHash,
      expectedKernelHash: basisTransaction.expectedKernelHash,
      expectedProjectionHash: basisTransaction.expectedProjectionHash,
      pluginSetDigest: basisTransaction.pluginSetDigest,
      readSet,
      writeSet,
      preconditions,
      operations: [{
        operationId: `${value.actionSetId}:source`,
        op: 'source-patch',
        patches,
        preconditions,
      }],
      actorId: options.actorId,
      correlationId: options.correlationId,
      metadata: {
        ...(styleTransaction?.metadata ?? {}),
        ...options.metadata,
        proposalSchemaVersion: HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION,
        sourceEditOrigin: 'ai',
        semanticWrite: true,
        focusBindingIds,
        readBindingIds,
        managedConstructionOperationKind: 'create-managed-construction',
        authoringSchemaVersion: 'construction-intent/v1',
        managedConstructionCreateProofs: labelMetadata.map((metadata) => (
          metadata.managedConstructionCreateProof ?? null
        )),
        constructionIntentProofs: value.labelIntents as unknown as JsonObject[],
        hostSemanticActionSetProof: value as unknown as JsonObject,
      },
    },
  };
}
