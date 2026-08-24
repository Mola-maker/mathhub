import {
  compileConstructionDagIntent,
  isConstructionDagIntent,
  type ConstructionDagIntent,
} from '../authoring/construction-dag-intent';
import { compileCanvasConstructionBatchProposal } from './canvas-construction-batch-proposal';
import type {
  AiPatchCompileOptions,
  AiPatchValidationError,
} from './ai-patch-proposal';
import type { AiConstructionIntentValidationContext } from './ai-construction-intent-proposal';
import type { JsonObject } from './model';
import type { GeometryTransactionRequest } from './transactions';

export const AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION =
  'ai-construction-dag-intent/v1' as const;

export type AiConstructionDagIntent = ConstructionDagIntent;

export type AiConstructionDagIntentCompilation =
  | {
    readonly ok: true;
    readonly proposal: ConstructionDagIntent;
    readonly transaction: GeometryTransactionRequest;
  }
  | {
    readonly ok: false;
    readonly errors: readonly AiPatchValidationError[];
  };

export const isAiConstructionDagIntent = isConstructionDagIntent;

function fail(
  code: AiPatchValidationError['code'],
  message: string,
): AiConstructionDagIntentCompilation {
  return { ok: false, errors: [{ code, message }] };
}

function intentReadBindingIds(
  intent: ConstructionDagIntent,
  context: AiConstructionIntentValidationContext,
): string[] {
  const allowed = new Set(context.allowedBindingIds);
  const bindings = 'get' in context.bindings
    ? [...context.bindings.values()]
    : context.bindings;
  const inputIds = new Set(intent.steps.flatMap((step) => (
    step.inputs.flatMap((input) => input.kind === 'binding' ? [input.bindingId] : [])
  )));
  const selected = bindings.filter((binding) => inputIds.has(binding.bindingId));
  const managedOwners = bindings.flatMap((binding) => (
    binding.managedConstructionId
    && allowed.has(binding.bindingId)
    && selected.some((inputBinding) => (
      inputBinding.managedConstructionId === binding.managedConstructionId
      && binding.range.start <= inputBinding.range.start
      && binding.range.end >= inputBinding.range.end
      && (
        binding.range.start < inputBinding.range.start
        || binding.range.end > inputBinding.range.end
      )
    ))
      ? [binding.bindingId]
      : []
  ));
  return [...new Set([
    intent.capability.bindingId,
    ...inputIds,
    ...managedOwners,
  ])].sort();
}

/** Compile one host-resolved Catalog DAG into one atomic source transaction. */
export function compileAiConstructionDagIntent(
  value: unknown,
  context: AiConstructionIntentValidationContext,
  options: AiPatchCompileOptions = {},
): AiConstructionDagIntentCompilation {
  if (!isConstructionDagIntent(value)) {
    return fail('invalid-shape', 'Invalid construction-dag-intent/v1 shape.');
  }
  try {
    const compilation = compileConstructionDagIntent({
      source: context.source ?? '',
      geometryDoc: context.geometryDoc,
      allowedBindingIds: context.allowedBindingIds,
      intent: value,
    });
    const batch = compileCanvasConstructionBatchProposal({
      source: context.source ?? '',
      geometryDoc: context.geometryDoc,
      plans: compilation.plans,
      primaryConstructionId: compilation.primaryConstructionId,
      adoptions: compilation.adoptions,
    });
    const readBindingIds = intentReadBindingIds(value, context);
    return {
      ok: true,
      proposal: value,
      transaction: {
        ...batch.transaction,
        transactionId: value.intentId,
        idempotencyKey: value.idempotencyKey,
        origin: 'ai',
        stage: 'proposed',
        expectedProjectionHash: value.basis.projectionHash,
        ...(options.actorId ? { actorId: options.actorId } : {}),
        ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        metadata: {
          ...(batch.transaction.metadata ?? {}),
          ...(options.metadata ?? {}),
          proposalSchemaVersion: AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION,
          authoringSchemaVersion: value.schemaVersion,
          constructionDagIntentProof: value as unknown as JsonObject,
          focusBindingIds: readBindingIds,
          readBindingIds,
        },
      },
    };
  } catch (error) {
    return fail(
      'plan-invalid',
      error instanceof Error ? error.message : 'Construction DAG compilation failed.',
    );
  }
}
