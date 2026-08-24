import {
  compileAiConstructionDagIntent,
  isAiConstructionDagIntent,
  type AiConstructionDagIntentCompilation,
} from './ai-construction-dag-intent';
import {
  compileAiConstructionIntentProposal,
  isAiConstructionIntentProposal,
  type AiConstructionIntentProposalCompilation,
  type AiConstructionIntentValidationContext,
} from './ai-construction-intent-proposal';
import {
  compileAiConstructionPlanProposal,
  isAiConstructionPlanProposal,
  type AiConstructionPlanProposalCompilation,
} from './ai-construction-plan-proposal';
import {
  compileAiPatchProposal,
  type AiPatchCompilationResult,
  type AiPatchCompileOptions,
} from './ai-patch-proposal';
import {
  compileAiManagedPresentationIntent,
  isAiManagedPresentationIntent,
  type AiManagedPresentationIntentCompilation,
} from './ai-managed-presentation-intent';
import {
  compileAiSemanticDeleteIntent,
  isAiSemanticDeleteIntent,
  type AiSemanticDeleteIntentCompilation,
} from './ai-semantic-delete-intent';
import {
  compileAiSelectionTransformIntent,
  isAiSelectionTransformIntent,
  type AiSelectionTransformIntentCompilation,
} from './ai-selection-transform-intent';
import {
  compileHostSemanticActionBatch,
  isHostSemanticActionBatch,
  type HostSemanticActionBatchCompilation,
} from './host-semantic-action-batch';
import {
  compileHostSemanticActionSet,
  isHostSemanticActionSet,
  type HostSemanticActionSetCompilation,
} from './host-semantic-action-set';

export type AiWriteProposalCompilation =
  | AiConstructionDagIntentCompilation
  | AiConstructionIntentProposalCompilation
  | AiConstructionPlanProposalCompilation
  | AiManagedPresentationIntentCompilation
  | AiSemanticDeleteIntentCompilation
  | AiSelectionTransformIntentCompilation
  | HostSemanticActionBatchCompilation
  | HostSemanticActionSetCompilation
  | AiPatchCompilationResult;

/** Keep create-intent, managed replace-plan, and raw patch trust policies separate. */
export function compileAiWriteProposal(
  value: unknown,
  context: AiConstructionIntentValidationContext,
  options: AiPatchCompileOptions = {},
): AiWriteProposalCompilation {
  if (isHostSemanticActionBatch(value)) {
    return compileHostSemanticActionBatch(value, context, options);
  }
  if (isHostSemanticActionSet(value)) {
    return compileHostSemanticActionSet(value, context, options);
  }
  if (isAiConstructionDagIntent(value)) {
    return compileAiConstructionDagIntent(value, context, options);
  }
  if (isAiManagedPresentationIntent(value)) {
    return compileAiManagedPresentationIntent(value, context, options);
  }
  if (isAiSemanticDeleteIntent(value)) {
    const source = context.source;
    if (typeof source !== 'string') {
      return {
        ok: false,
        errors: [{
          code: 'invalid-shape',
          message: 'Semantic deletion requires the current source document.',
        }],
      };
    }
    return compileAiSemanticDeleteIntent(value, { ...context, source }, options);
  }
  if (isAiSelectionTransformIntent(value)) {
    const source = context.source;
    if (typeof source !== 'string') {
      return {
        ok: false,
        errors: [{
          code: 'invalid-shape',
          message: 'Semantic transformation requires the current source document.',
        }],
      };
    }
    return compileAiSelectionTransformIntent(value, { ...context, source }, options);
  }
  if (isAiConstructionIntentProposal(value)) {
    return compileAiConstructionIntentProposal(value, context, options);
  }
  if (isAiConstructionPlanProposal(value)) {
    if (value.operation.kind === 'create-managed-construction') {
      return {
        ok: false,
        errors: [{
          code: 'plan-invalid',
          message: 'AI managed creation must use construction-intent/v1; direct plan creation is internal-only.',
        }],
      };
    }
    return compileAiConstructionPlanProposal(value, context, options);
  }
  return compileAiPatchProposal(value, context, options);
}
