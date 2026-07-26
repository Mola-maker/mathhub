import { parseGgbBlock } from '@/lib/math/geogebra-commands';

const GGB_FENCE_RE = /```(?:geogebra|ggb|geo)\s*([\s\S]*?)```/gi;
const TIKZ_FENCE_RE = /```(?:tikz|latex|tex)[\s\S]*?```/gi;
const TIKZ_ENV_RE = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/gi;
const RAW_TKZ_LINE_RE = /^\\(?:tkz|fuzhuxian)[^\n]*/gm;
const RAW_TKZ_INLINE_RE = /\\tkz[A-Za-z]+(?:\[[^\]]*\])?(?:\{[^}]*\})+/g;

/** Lines typical of model internal reasoning — not user-facing answer. */
const THINKING_LINE_RE =
  /^(我们被要求|首先|让我们|总结步骤|我们需要|从TikZ|实际上|一种方法|类似地|但这里|或者|由于我们在|计算坐标|定义两个圆|从代码看|从TikZ图|所以总结|GeoGebra中有|从GeoGebra手册|更简单的是|另一种方式|通常|可能需要|需要进一步|需要指定|需要选择|需要识别|需要用到)/;

export function isThinkingLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return THINKING_LINE_RE.test(t);
}

export function hasTikzDrawing(text: string): boolean {
  return /\\tkz|tikzpicture|\\begin\{tikz\}|\\fuzhuxian/i.test(text);
}

export function hasGgbBlock(text: string): boolean {
  return parseGgbBlock(text).length > 0;
}

/** Remove fences, raw TikZ, and obvious reasoning lines for chat display. */
export function stripReasoningAndTikz(text: string): string {
  return text
    .replace(GGB_FENCE_RE, '')
    .replace(TIKZ_FENCE_RE, '')
    .replace(TIKZ_ENV_RE, '')
    .replace(RAW_TKZ_INLINE_RE, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (RAW_TKZ_LINE_RE.test(t)) return false;
      if (/^\\tkz|^\\fuzhuxian|^\\begin\{|^\\end\{/.test(t)) return false;
      if (isThinkingLine(t)) return false;
      return true;
    })
    .join('\n')
    .replace(RAW_TKZ_LINE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Heuristic: long analysis-style text without a geogebra deliverable. */
export function isMostlyReasoningChain(text: string): boolean {
  const body = text.replace(GGB_FENCE_RE, '').trim();
  if (/^我们被要求/.test(body)) return true;
  if (body.length < 400) return false;
  const markers = body.match(/^(首先|让我们|我们需要|从TikZ|实际上|一种方法|类似地)/gm);
  return (markers?.length ?? 0) >= 2;
}

export type DeliverableExtract = {
  text: string;
  hasGgb: boolean;
  hasTikz: boolean;
  wasReasoningOnly: boolean;
};

/**
 * When a thinking model streams only `reasoning_content` (no `content`),
 * extract user-facing answer + geogebra block — never dump raw reasoning.
 */
export function extractDeliverableFromReasoning(reasoning: string): DeliverableExtract {
  const trimmed = reasoning.trim();
  if (!trimmed) {
    return { text: '', hasGgb: false, hasTikz: false, wasReasoningOnly: false };
  }

  const ggbMatch = trimmed.match(/```(?:geogebra|ggb|geo)\s*[\s\S]*?```/i);
  const hasTikz = hasTikzDrawing(trimmed);
  const hasGgb = !!ggbMatch || hasGgbBlock(trimmed);

  if (ggbMatch) {
    const prose = stripReasoningAndTikz(trimmed.replace(ggbMatch[0], '')).trim();
    const summaryLines = prose
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !isThinkingLine(l))
      .slice(0, 6);
    const summary = summaryLines.join('\n').trim()
      || '以下几何图形已在 GeoGebra 画布中绘制。';
    return {
      text: `${summary}\n\n${ggbMatch[0]}`,
      hasGgb: true,
      hasTikz,
      wasReasoningOnly: true,
    };
  }

  if (hasTikz || isMostlyReasoningChain(trimmed)) {
    return { text: '', hasGgb: false, hasTikz, wasReasoningOnly: true };
  }

  const prose = stripReasoningAndTikz(trimmed);
  if (prose.length >= 20 && prose.length <= 600) {
    return { text: prose, hasGgb: false, hasTikz, wasReasoningOnly: true };
  }

  return { text: '', hasGgb: false, hasTikz, wasReasoningOnly: true };
}

export const REASONING_MODEL_FALLBACK_MSG =
  '思考型模型只输出了内部推理，未生成 GeoGebra 作图脚本。请 **Clear chat** 后改用非推理模型（如 **deepseek-chat**、**qwen-plus**、**qwen-turbo**），并确保回复包含 ```geogebra 代码块。';

export const TIKZ_INSTEAD_OF_GGB_MSG =
  '模型返回了 TikZ/tkz-euclide 推理或代码，而非 GeoGebra 命令，画布无法自动作图。请 **Clear chat** 后重试，或更换作图模型。';

/** Stream text in small chunks so the UI updates progressively after a late fallback. */
export async function streamTextInChunks(
  send: (token: string) => void,
  text: string,
  chunkSize = 48,
): Promise<void> {
  if (!text) return;
  for (let i = 0; i < text.length; i += chunkSize) {
    send(text.slice(i, i + chunkSize));
    if (i + chunkSize < text.length) {
      await new Promise((r) => setTimeout(r, 8));
    }
  }
}
