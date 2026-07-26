/** How the assistant should respond to this problem. */
export type MathTaskMode = 'draw' | 'solve' | 'algebra';

const SOLVE_RE =
  /证明|求证|解答|求解|求(?:出|证)|计算|化简|解方程|show\s+that|prove|solve|find\s+the\s+value/i;

const DRAW_ONLY_RE =
  /(?:仅|只)?作图|画出|绘制|复现(?:图形|原图)?|配图|构造图形|draw(?:ing)?|sketch|plot\s+the\s+figure/i;

const ALGEBRA_ONLY_RE =
  /^(?:解|化简|因式分解|展开|求导|积分)/;

const DRAWABLE_RE =
  /三角形|圆|几何|tikz|tkz|tikzpicture|作图|画出|绘制|复现|切线|外心|内心|垂心|重心|平行|垂直|相交|polygon|circle|triangle|segment|坐标|图形|四边形|外接圆|内切|根轴|圆幂|共圆|相切|求证|证明/i;

/** Infer whether user wants drawing only, full solution, or algebra-only. */
export function inferMathTaskMode(problem: string): MathTaskMode {
  const t = problem.trim();
  if (!t) return 'draw';
  if (ALGEBRA_ONLY_RE.test(t) && !DRAWABLE_RE.test(t)) return 'algebra';
  // An EXPLICIT drawing instruction (作图 / 画出 / draw the diagram) wins over an
  // incidental 证明 / prove that merely appears in the pasted problem body. The
  // user reported "draw the problem diagram" being answered with a proof: that
  // happened because SOLVE_RE matched the problem's own "Prove:…" first. A direct
  // draw verb must take precedence; a bare "证明 MF=MG" (no draw verb) stays solve.
  if (DRAW_ONLY_RE.test(t)) return 'draw';
  if (SOLVE_RE.test(t)) return 'solve';
  if (userMessageHasDrawableContent(t)) return 'draw';
  return 'draw';
}

export function userMessageHasDrawableContent(text: string): boolean {
  return DRAWABLE_RE.test(text)
    || /\\begin\{tikzpicture\}|\\tkzDef|```tikz/i.test(text)
    || /[A-Z]\s*=\s*\([^)]+\)/.test(text);
}

export function shouldUseFullCommandIndex(problem: string, drawingCommand?: string): boolean {
  if (drawingCommand === 'translate_tikz' || drawingCommand === 'draw_steps' || drawingCommand === 'continue') {
    return true;
  }
  return /\\begin\{tikzpicture\}|\\tkzDef|\\tkzDraw|```tikz/i.test(problem)
    || /外心|内心|垂心|切线|Tangent|TriangleCenter|复现|两圆|公切|circumcenter|tikz|tkz/i.test(problem)
    || /四边形|外接圆|内切|根轴|圆幂|共圆|相切|RadicalAxis|求证|证明/i.test(problem)
    || userMessageHasDrawableContent(problem);
}

function userMessageHasTikz(text: string): boolean {
  return /\\begin\{tikzpicture\}|\\tkzDef|\\tkzDraw|```tikz/i.test(text);
}

/** Task-specific instructions appended to system prompt. */
export function formatTaskModeInstructions(mode: MathTaskMode, problem: string): string {
  const hasTikz = userMessageHasTikz(problem);
  const lines: string[] = ['## TASK MODE (mandatory)'];

  switch (mode) {
    case 'draw':
      lines.push(
        '- User wants the **figure reproduced on GeoGebra**, not a written proof or step-by-step solution.',
        '- Reply with 2–4 short Chinese sentences describing what is drawn, then ONE ```geogebra block.',
        '- Do NOT write proof steps, "要证明", or lengthy analysis unless the user explicitly asked to solve.',
      );
      break;
    case 'solve':
      lines.push(
        '- User asked for a **solution / proof / calculation**. Give a concise Chinese solution (key steps only).',
        '- If the problem involves a figure, ALSO output ONE ```geogebra block reproducing the diagram after the explanation.',
        '- Keep geogebra commands ≤40 lines; focus on objects referenced in the solution.',
      );
      break;
    case 'algebra':
      lines.push(
        '- Pure algebra / CAS — explain briefly in Chinese.',
        '- Output ```geogebra block only if a graph or geometry helps (e.g. Function, Curve). Otherwise omit the block.',
      );
      break;
  }

  if (hasTikz) {
    lines.push(
      '- User pasted **TikZ/tkz-euclide**. Translate every construction to GeoGebra commands.',
      '- **NEVER** echo, quote, or analyze TikZ syntax in your reply. Forbidden: \\\\tkzDef, \\\\tkzDraw, tikzpicture.',
    );
  }

  lines.push(
    '- Your ```geogebra block is executed live — missing or TikZ-only output = total failure.',
    '- Required fence label: exactly ```geogebra (not tikz, latex, or plain text).',
  );

  return lines.join('\n');
}
