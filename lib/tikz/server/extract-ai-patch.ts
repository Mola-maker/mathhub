import {
  AI_PATCH_PROPOSAL_SCHEMA_VERSION,
  isAiPatchProposal,
  type AiPatchProposal,
} from '../ir/ai-patch-proposal';
import {
  AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION,
  isAiConstructionPlanProposal,
  type AiConstructionPlanProposal,
} from '../ir/ai-construction-plan-proposal';

export interface AiPatchExtractionResult {
  proposal: AiPatchProposal | AiConstructionPlanProposal | null;
  error: string | null;
}

const PATCH_FENCE = /```(?:tikz-patch|tikz-construction-plan|json)\s*([\s\S]*?)```/giu;

/**
 * Extract the first explicitly fenced AI patch proposal.
 *
 * Deliberately does not scan arbitrary prose for balanced braces: accepting an
 * accidental JSON-looking fragment would weaken the output protocol and make
 * provider explanations capable of becoming write requests.
 */
export function extractAiPatchProposal(text: string): AiPatchExtractionResult {
  for (const match of text.matchAll(PATCH_FENCE)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (isAiPatchProposal(parsed) || isAiConstructionPlanProposal(parsed)) {
      return {
        proposal: parsed,
        error: null,
      };
    }
  }
  return {
    proposal: null,
    error: `模型输出缺少 ${AI_PATCH_PROPOSAL_SCHEMA_VERSION} 或 ${AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION} 的显式代码块`,
  };
}
