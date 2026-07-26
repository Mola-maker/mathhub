import type { DrawingCommand } from '@/lib/math/math-drawing/commands';

const PRIORITY_BLOCK = `## PRIORITY (non-negotiable)
1. **Complete, correct GeoGebra figure** matching the problem — this outweighs any proof or analysis.
2. Brief Chinese caption (see mode limits below).
3. Proof/solution text ONLY in /solve_optional when the user explicitly asked.
Missing or wrong \`\`\`geogebra\`\`\` = total failure.`;

function userMessageHasTikz(text: string): boolean {
  return /\\begin\{tikzpicture\}|\\tkzDef|\\tkzDraw|```tikz/i.test(text);
}

function lineBudget(command: DrawingCommand): string {
  switch (command) {
    case 'draw':
      return 'Target ≤80 commands for olympiad figures; never truncate ω₂, tangency, or named intersection points.';
    case 'continue':
      return 'Output the FULL updated script (all still-valid prior objects + changes). Target ≤120 lines.';
    case 'draw_steps':
      return 'Target ≤120 lines; group by layer with SetColor after each construction tier.';
    case 'translate_tikz':
      return 'Target ≤100 lines; translate semantics only — never echo TikZ.';
    case 'solve_optional':
      return 'GGB block first, then brief solution; target ≤90 lines for the figure.';
    case 'algebra':
      return 'Omit GGB unless a plot clearly helps.';
    default:
      return '';
  }
}

/** Mode-specific instructions for system prompt (slash-command driven). */
export function formatDrawingCommandInstructions(
  command: DrawingCommand,
  problem: string,
): string {
  const hasTikz = userMessageHasTikz(problem) || command === 'translate_tikz';
  const lines: string[] = [
    PRIORITY_BLOCK,
    '',
    `## ACTIVE MODE: /${command}`,
  ];

  switch (command) {
    case 'draw':
      lines.push(
        '- Reproduce the **full figure** on GeoGebra. No proof, no step-by-step solution.',
        '- Output order: **```geogebra block FIRST**, then 2–4 short Chinese sentences.',
      );
      break;
    case 'continue':
      lines.push(
        '- User is **extending or fixing** the current canvas. Read CURRENT CANVAS below.',
        '- Analyze what to keep, add, or fix; output ONE **complete** ```geogebra script (not a partial diff).',
        '- Output order: ```geogebra first, then 1–2 sentences on what changed.',
      );
      break;
    case 'draw_steps':
      lines.push(
        '- Show construction **in layers with different colors** (SetColor per layer).',
        '- Typical layers: base figure → auxiliary lines → tangency/circles → intersection labels.',
        '- Output order: ```geogebra first, then a one-line legend of colors.',
        '- Do NOT write English TikZ analysis or long proof text.',
      );
      break;
    case 'translate_tikz':
      lines.push(
        '- User pasted **TikZ/tkz-euclide**. Translate every construction step to GeoGebra.',
        '- **NEVER** echo, quote, or analyze TikZ in English or Chinese prose.',
        '- Output order: ```geogebra only (+ optional 1 sentence in Chinese).',
      );
      break;
    case 'solve_optional':
      lines.push(
        '- User explicitly asked for a **solution/proof** — keep it concise (key steps only).',
        '- Still output a **complete** ```geogebra figure BEFORE the solution text.',
      );
      break;
    case 'algebra':
      lines.push(
        '- Pure algebra / CAS. Explain briefly in Chinese.',
        '- ```geogebra only if a graph or geometry visualization helps.',
      );
      break;
  }

  if (hasTikz && command !== 'translate_tikz') {
    lines.push('- Problem contains TikZ: convert to GeoGebra — forbidden: \\\\tkzDef, tikzpicture.');
  }

  lines.push(
    `- ${lineBudget(command)}`,
    '- Required fence: exactly ```geogebra (not tikz, latex, or plain).',
    '- One official evalCommand per line; coordinates roughly in [-8,8].',
  );

  return lines.join('\n');
}
