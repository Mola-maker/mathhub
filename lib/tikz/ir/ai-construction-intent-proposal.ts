import {
  CONSTRUCTION_INTENT_SCHEMA_VERSION,
  compileConstructionIntent,
  isConstructionIntent,
  type ConstructionIntent,
} from '../authoring/construction-intent';
import type { GeometryDoc } from './geometry-doc';
import type { JsonObject } from './model';
import { compileCanvasConstructionBatchProposal } from './canvas-construction-batch-proposal';
import {
  compileAiConstructionPlanProposal,
  type AiConstructionPlanProposalCompilation,
} from './ai-construction-plan-proposal';
import type {
  AiPatchCompileOptions,
  AiPatchValidationContext,
} from './ai-patch-proposal';
import type { GeometryTransactionRequest } from './transactions';

export const AI_CONSTRUCTION_INTENT_PROPOSAL_SCHEMA_VERSION =
  CONSTRUCTION_INTENT_SCHEMA_VERSION;
export const AI_CONSTRUCTION_INTENT_BATCH_PROPOSAL_SCHEMA_VERSION =
  'ai-construction-intent-batch-proposal/v1' as const;
export type AiConstructionIntentProposal = ConstructionIntent;

export interface AiConstructionIntentValidationContext
  extends AiPatchValidationContext {
  readonly geometryDoc: GeometryDoc;
}

export type AiConstructionIntentProposalCompilation =
  | {
    readonly ok: true;
    readonly proposal: ConstructionIntent;
    readonly transaction: GeometryTransactionRequest;
  }
  | Extract<AiConstructionPlanProposalCompilation, { ok: false }>;

export const isAiConstructionIntentProposal = isConstructionIntent;

function intentReadBindingIds(
  intent: ConstructionIntent,
  context: AiConstructionIntentValidationContext,
): string[] {
  const allowed = new Set(context.allowedBindingIds);
  const bindings = 'get' in context.bindings
    ? [...context.bindings.values()]
    : context.bindings;
  const selected = bindings.filter((binding) => (
    intent.bindingIds.includes(binding.bindingId)
  ));
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
    ...intent.bindingIds,
    ...managedOwners,
  ])];
}

/**
 * Lower the public create-only intent through the trusted Catalog. The full
 * plan stays internal; Broker receives the original intent and must rebuild it.
 */
export function compileAiConstructionIntentProposal(
  value: unknown,
  context: AiConstructionIntentValidationContext,
  options: AiPatchCompileOptions = {},
): AiConstructionIntentProposalCompilation {
  if (!isConstructionIntent(value)) {
    return {
      ok: false,
      errors: [{ code: 'invalid-shape', message: 'Invalid construction-intent/v1 shape.' }],
    };
  }
  let compilation: ReturnType<typeof compileConstructionIntent>;
  try {
    compilation = compileConstructionIntent({
      source: context.source ?? '',
      geometryDoc: context.geometryDoc,
      allowedBindingIds: context.allowedBindingIds,
      intent: value,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: 'plan-invalid',
        message: error instanceof Error ? error.message : 'Construction intent compilation failed.',
      }],
    };
  }
  if (compilation.adoptions.length > 0) {
    try {
      const batch = compileCanvasConstructionBatchProposal({
        source: context.source ?? '',
        geometryDoc: context.geometryDoc,
        plans: [compilation.plan],
        primaryConstructionId: compilation.plan.id,
        adoptions: compilation.adoptions,
      });
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
          metadata: {
            ...(batch.transaction.metadata ?? {}),
            proposalSchemaVersion:
              AI_CONSTRUCTION_INTENT_BATCH_PROPOSAL_SCHEMA_VERSION,
            authoringSchemaVersion: CONSTRUCTION_INTENT_SCHEMA_VERSION,
            constructionIntentProof: value as unknown as JsonObject,
          },
        },
      };
    } catch (error) {
      return {
        ok: false,
        errors: [{
          code: 'compile-failed',
          message: error instanceof Error
            ? error.message
            : 'Construction intent adoption batch compilation failed.',
        }],
      };
    }
  }
  const lowered = compileAiConstructionPlanProposal({
    schemaVersion: 'construction-plan-proposal/v1',
    proposalId: value.intentId,
    idempotencyKey: value.idempotencyKey,
    basis: value.basis,
    focusBindingIds: value.bindingIds,
    // A managed entity-record binding identifies the exact semantic input,
    // while its owning block binding attests the TikZ statement range that
    // defines that input. Include both only when the owner is already inside
    // the host-authorized scope; this enables dependent constructions without
    // broadening model authority to unrelated managed blocks.
    readBindingIds: intentReadBindingIds(value, context),
    operation: {
      operationId: `${value.intentId}:create`,
      kind: 'create-managed-construction',
      bindingId: value.capability.bindingId,
      sourceId: value.basis.sourceId,
      plan: compilation.plan,
    },
  }, context, options);
  if (!lowered.ok) return lowered;
  return {
    ok: true,
    proposal: value,
    transaction: {
      ...lowered.transaction,
      expectedProjectionHash: value.basis.projectionHash,
      metadata: {
        ...(lowered.transaction.metadata ?? {}),
        authoringSchemaVersion: CONSTRUCTION_INTENT_SCHEMA_VERSION,
        constructionIntentProof: value as unknown as JsonObject,
      },
    },
  };
}
