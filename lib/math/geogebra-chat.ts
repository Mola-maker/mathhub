import { parseGgbBlock } from '@/lib/math/geogebra-commands';
import {
  isMostlyReasoningChain,
  REASONING_MODEL_FALLBACK_MSG,
  stripReasoningAndTikz,
  TIKZ_INSTEAD_OF_GGB_MSG,
  hasTikzDrawing,
} from '@/lib/math/math-response-sanitize';
import { userMessageHasDrawableContent } from '@/lib/math/math-task-mode';
import type { DrawingCommand } from '@/lib/math/math-drawing/commands';
import { commandRequiresGgb } from '@/lib/math/math-drawing/commands';

const GGB_FENCE = /```(?:geogebra|ggb|geo)[\s\S]*?```/gi;
const TIKZ_FENCE = /```(?:tikz|latex|tex)[\s\S]*?```/gi;
const TIKZ_ENV = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/gi;

/** Text shown in chat sidebar — strips executable blocks, keeps explanation. */
export function formatAssistantChatText(content: string): string {
  return stripReasoningAndTikz(content)
    .replace(GGB_FENCE, '')
    .replace(TIKZ_FENCE, '')
    .replace(TIKZ_ENV, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function assistantDisplayText(content: string): string {
  const cmds = parseGgbBlock(content);

  if (isMostlyReasoningChain(content) && cmds.length === 0) {
    if (hasTikzDrawing(content)) return TIKZ_INSTEAD_OF_GGB_MSG;
    return REASONING_MODEL_FALLBACK_MSG;
  }

  const prose = formatAssistantChatText(content);
  if (prose) return prose;

  if (cmds.length > 0) {
    return `几何图形已在 GeoGebra 画布绘制（${cmds.length} 条命令）。可在代数区查看对象列表，在 CAS 区做符号计算。`;
  }

  if (hasTikzDrawing(content)) {
    return TIKZ_INSTEAD_OF_GGB_MSG;
  }

  if (/^思考型模型只输出|^模型返回了 TikZ|正在生成 GeoGebra|几何语义|深度推理|构造计划|请稍候/i.test(content.trim())) {
    return content.trim();
  }

  return content.trim() || '…';
}

export function userMessageHasTikz(content: string): boolean {
  return /\\begin\{tikzpicture\}|\\tkzDef|\\tkzDraw|```tikz/i.test(content);
}

function buildUserAugmentHint(content: string, drawingCommand: DrawingCommand): string | null {
  if (drawingCommand === 'algebra' && !userMessageHasDrawableContent(content)) return null;

  const parts: string[] = [`[模式 /${drawingCommand}]`];

  switch (drawingCommand) {
    case 'draw':
      parts.push('**只作图**：完整复现题目图形，不要写证明或长篇解析。必须 ```geogebra 在前**。');
      break;
    case 'continue':
      parts.push('**续画**：在现有画布上补充/修正，输出完整更新脚本。');
      break;
    case 'draw_steps':
      parts.push('**分步/分色作图**：用 SetColor 分层展示过程，禁止 TikZ 分析。');
      break;
    case 'translate_tikz':
      parts.push('**TikZ→GGB**：语义翻译，禁止 echo TikZ。');
      break;
    case 'solve_optional':
      parts.push('**解题+作图**：GGB 完整图在前，解答简要。');
      break;
    case 'algebra':
      parts.push('**代数/CAS**；无必要可省略 GGB。');
      break;
  }

  if (userMessageHasTikz(content) || drawingCommand === 'translate_tikz') {
    parts.push('含 TikZ：转换为 ```geogebra，禁止 \\\\tkzDef、tikzpicture。');
  } else if (commandRequiresGgb(drawingCommand) && userMessageHasDrawableContent(content)) {
    parts.push('必须输出 ```geogebra 代码块。');
  }

  return parts.join(' ');
}

/** Append server-side drawing hints to every relevant user turn. */
export function augmentUserMessageForModel(
  content: string,
  drawingCommand: DrawingCommand = 'draw',
): string {
  const hint = buildUserAugmentHint(content, drawingCommand);
  if (!hint) return content;
  return `${content.trim()}

${hint}`;
}

/** Normalize LaTeX pasted from problem statements for KaTeX/remark-math. */
export function normalizeLatexForKatex(raw: string): string {
  let t = raw
    // Strip zero-width space / joiner / BOM that survive copy-paste of RENDERED
    // MathJax/KaTeX and break KaTeX parsing inside $…$ (the "ω 1 ω 1" soup).
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
    .replace(/\\par\b/g, '\n\n')
    .replace(/\\\\(?=\s|$)/gm, '\n');
  // Copying rendered math often doubles each token onto its own line
  // ("ω\n1\nω\n1"); drop a line that exactly repeats the one before it.
  const deduped: string[] = [];
  for (const line of t.split('\n')) {
    const clean = line.replace(/[ \t]+$/g, '');
    if (deduped.length > 0 && deduped[deduped.length - 1] === clean) continue;
    deduped.push(clean);
  }
  t = deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Wrap a bare \omega_n so KaTeX renders it — but skip ones already inside $…$.
  t = t.replace(/(?<!\$)\\omega(?:_\{?[A-Za-z0-9]+\}?)?(?!\$)/g, (m) => `$${m}$`);
  return t;
}

/** Extract LaTeX/math fragments for KaTeX preview panel. */
export function extractKatexPreviewSource(content: string): string {
  const normalized = normalizeLatexForKatex(content);

  const fenced = normalized.match(/```(?:latex|tex|math)\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return normalizeLatexForKatex(fenced[1].trim());

  const ggbMatches = [...normalized.matchAll(/```(?:geogebra|ggb|geo)\s*([\s\S]*?)```/gi)];
  const prose = formatAssistantChatText(
    normalized.replace(ggbMatches.length ? ggbMatches[ggbMatches.length - 1][0] : '', ''),
  );
  const displayLines = prose.split('\n').filter(Boolean);

  const blockMath = normalized.match(/\$\$[\s\S]*?\$\$/g) ?? [];
  const inline = normalized.match(/(?<!\$)\$(?!\$)[^$\n]+\$/g) ?? [];

  const chunks = [
    ...displayLines.slice(0, 12),
    ...blockMath,
    ...inline,
  ].filter(Boolean);

  return normalizeLatexForKatex(chunks.join('\n\n').trim());
}

export { inferMathTaskMode, formatTaskModeInstructions } from '@/lib/math/math-task-mode';
