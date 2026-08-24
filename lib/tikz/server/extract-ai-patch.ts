import {
  isAiPatchProposal,
  type AiPatchProposal,
} from '../ir/ai-patch-proposal';
import {
  isAiConstructionPlanProposal,
  type AiConstructionPlanProposal,
} from '../ir/ai-construction-plan-proposal';
import {
  isAiConstructionIntentProposal,
  type AiConstructionIntentProposal,
} from '../ir/ai-construction-intent-proposal';
import {
  isAiManagedPresentationIntent,
  type AiManagedPresentationIntent,
} from '../ir/ai-managed-presentation-intent';
import {
  isGeometryIntent,
  type GeometryIntent,
} from '../agent/geometry-intent';

export interface AiPatchExtractionResult {
  proposal:
    | AiPatchProposal
    | AiConstructionPlanProposal
    | AiConstructionIntentProposal
    | AiManagedPresentationIntent
    | GeometryIntent
    | null;
  error: string | null;
  actionCount: number;
}

const PATCH_FENCE =
  /```(?:tikz-patch|tikz-construction-plan|tikz-construction-intent|tikz-managed-presentation|tikz-geometry-intent)\s*([\s\S]*?)```/giu;

/**
 * Extract the first explicitly fenced AI write proposal.
 *
 * Deliberately does not scan arbitrary prose for balanced braces: accepting an
 * accidental JSON fragment would make provider explanations executable.
 */
export function extractAiPatchProposal(text: string): AiPatchExtractionResult {
  const matches = [...text.matchAll(PATCH_FENCE)];
  if (matches.length > 1) {
    return {
      proposal: null,
      error: 'Model output contains more than one executable action block.',
      actionCount: matches.length,
    };
  }
  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (
      isAiPatchProposal(parsed)
      || isAiConstructionPlanProposal(parsed)
      || isAiConstructionIntentProposal(parsed)
      || isAiManagedPresentationIntent(parsed)
      || isGeometryIntent(parsed)
    ) {
      return { proposal: parsed, error: null, actionCount: 1 };
    }
  }
  return {
    proposal: null,
    error: '模型未返回有效的 GeometryIntent 动作；内部兼容提案也未通过验证，画板未改变。',
    actionCount: matches.length,
  };
}
