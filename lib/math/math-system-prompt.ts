import { GEOGEBRA_CONSTRUCTION_GUIDE } from '@/lib/math/geogebra-commands';
import { formatCompactCommandIndexForPrompt } from '@/lib/math/geogebra-command-index';
import {
  buildGgbContextForProblem,
  formatFullCommandIndexAppendix,
  type GgbContextResult,
} from '@/lib/math/geogebra-context-builder';
import { formatPreviousGgbContext } from '@/lib/math/math-continuation';
import type { DrawingCommand } from '@/lib/math/math-drawing/commands';
import { formatDrawingCommandInstructions } from '@/lib/math/math-drawing/prompts';
import { shouldUseFullCommandIndex, userMessageHasDrawableContent } from '@/lib/math/math-task-mode';
import type { CommandFailure } from '@/lib/math/geometry-render/run-script';

const MATH_DRAWING_BASE = `You are a math assistant paired with a live GeoGebra Classic canvas (2D graphics, algebra view, CAS, 3D, spreadsheet, probability tools).

Your PRIMARY job: produce **executable GeoGebra commands** in a \`\`\`geogebra block. Prose is secondary.

COMPREHENSION FIRST (do this silently, then emit commands):
- Read the construction steps and resolve the dependency order: which points are FREE
  (give them numeric coordinates) and which are DERIVED (built by command from earlier objects).
- Build the configuration the problem SETS UP. Do not solve/prove the question.

CURRENT STATE AND COMPACTED MEMORY:
- Conversation history is advisory. CURRENT CANVAS commands, when supplied, are the only durable construction state.
- If prose or an older fenced block conflicts with CURRENT CANVAS, keep the current commands and current dependency graph.
- Never resurrect a dropped object, constraint, or relation from a compacted summary; reconstruct only from the current command snapshot or ask for clarification.

FORBIDDEN OUTPUT:
- TikZ, tkz-euclide, asymptote, \\begin{tikzpicture}, \\tkzDef*, \\tkzDraw*
- LaTeX math blocks as drawing code ($…$, \\frac in commands)
- Invented commands: TriangleCircumcenter, Circumcenter, DefTriangleCenter, Draw, Plot
- English "We need to interpret the TikZ…" analysis — translate directly to GeoGebra

TRIANGLE CENTERS (official GeoGebra):
  O=TriangleCenter(A,B,C,3)   circumcenter (外心)
  O=TriangleCenter(A,B,C,1)   incenter
  O=TriangleCenter(A,B,C,2)   centroid
  O=TriangleCenter(A,B,C,4)   orthocenter

STRICT RULES for the geogebra block:
- Use ONLY commands from SERVER COMMAND LOOKUP below. Never invent syntax.
- One command per line. No semicolons. No JavaScript (var/let).
- EXECUTION ORDER: coordinates → segments/lines → circles → Intersect last.
- Line∩circle and circle∩circle give TWO points: use Intersect(obj,obj,1)/(…,2).
- Point on segment: D=Point(Segment(A,C),0.35). Circle diameter AB: M=Midpoint(A,B); c=Circle(M,A).
- Intersect needs geometric objects (Segment/Line/Circle), not bare point names.
- Midpoint of arc BC not containing A (on circumcircle Γ): Intersect(Line(A,Incenter),Γ,2).
- If user pasted TikZ, translate coordinates and construction to GeoGebra — do NOT echo TikZ.

DEFINE-BEFORE-USE (the #1 cause of broken figures — obey strictly):
- Every name must be DEFINED on an earlier line than ANY line that uses it.
  WRONG: \`lineBD=Line(B,D)\` appearing before \`D=…\`. Order it AFTER D exists.
- Define each name EXACTLY ONCE. Never redefine (no second \`D=…\`). If you need
  D, decide its single correct definition and write it once.
- Names are CASE-SENSITIVE. \`omega\` and \`Omega\` are different objects — reference
  a name with the identical spelling/case you defined it with.

CONSTRAINTS ARE CONSTRUCTED, NEVER APPROXIMATED (this is what makes the figure
provable, not just plausible). A point with a geometric property is the
INTERSECTION of the loci of its constraints — never a hardcoded coordinate, and
never a near-miss like a midpoint:
- "X on line ℓ with XB=XC"  → X=Intersect(PerpendicularBisector(B,C), ℓ)
    e.g. "D on AC with DB=DC" → D=Intersect(PerpendicularBisector(B,C), Line(A,C))
    (D=Midpoint(B,C) is WRONG: that point is equidistant but NOT on AC.)
- "X on ℓ with XA=XB"  → X=Intersect(PerpendicularBisector(A,B), ℓ)
- "second meet of line g and circle c (other than P)" → Intersect(g, c, 2) (pick
    the index that is not P).
- Free base points get numeric coordinates; EVERY other point is built by command
  from earlier objects so all stated equalities hold exactly.

${GEOGEBRA_CONSTRUCTION_GUIDE}`;

export type BuildPromptOptions = {
  /** Slash-command drawing mode (default draw). */
  drawingCommand?: DrawingCommand;
  /** Append every indexed command signature (~large). Default auto. */
  fullIndex?: boolean;
  /** Commands already on canvas — continuation turns. */
  previousGgbCommands?: string[];
};

/**
 * Build the system prompt with **server-side command lookup** for this problem.
 * One call per POST /api/math — not static at page load. Fuses the
 * comprehension hints (relevant official signatures) into a single generation
 * prompt instead of a separate analysis pass.
 */
export function buildMathDrawingSystemPrompt(
  problem: string,
  options: BuildPromptOptions = {},
): { prompt: string; ggbContext: GgbContextResult; drawingCommand: DrawingCommand } {
  const drawingCommand = options.drawingCommand ?? 'draw';
  const ggbContext = buildGgbContextForProblem(problem, drawingCommand);
  const fullIndex = options.fullIndex === true
    || shouldUseFullCommandIndex(problem, drawingCommand)
    || (options.previousGgbCommands?.length ?? 0) > 0;

  const parts = [
    MATH_DRAWING_BASE,
    formatDrawingCommandInstructions(drawingCommand, problem),
    ggbContext.block,
    formatCompactCommandIndexForPrompt(),
  ];

  if (options.previousGgbCommands?.length) {
    parts.push(formatPreviousGgbContext(options.previousGgbCommands));
  }
  if (fullIndex) {
    parts.push(formatFullCommandIndexAppendix());
  }
  return { prompt: parts.join('\n\n'), ggbContext, drawingCommand };
}

const REPAIR_BASE = `You fix a GeoGebra construction script that FAILED to execute in the live applet.

You are given the script that ran and the EXACT error string GeoGebra returned for each
failing command. Return a CORRECTED, complete script that runs without errors and preserves
the intended figure.

RULES:
- Reply with EXACTLY ONE \`\`\`geogebra block (the full corrected script), nothing else.
- Keep the commands that already worked; fix only what is needed. Preserve object names and order.
- Use ONLY official signatures from SERVER COMMAND LOOKUP below — never invent syntax or TikZ.
- "undefined" / "Illegal argument" usually means: object used before defined, wrong argument
  count, or a missing intersection index (use Intersect(obj,obj,1)/(…,2)).`;

/** System prompt for the repair call — reuses the official-command lookup. */
export function buildGgbRepairSystemPrompt(
  problem: string,
  drawingCommand: DrawingCommand = 'draw',
): { prompt: string; ggbContext: GgbContextResult } {
  const ggbContext = buildGgbContextForProblem(problem, drawingCommand);
  const fullIndex = shouldUseFullCommandIndex(problem, drawingCommand);
  const parts = [REPAIR_BASE, ggbContext.block, formatCompactCommandIndexForPrompt()];
  if (fullIndex) parts.push(formatFullCommandIndexAppendix());
  return { prompt: parts.join('\n\n'), ggbContext };
}

/** User message for the repair call: the script plus per-command GeoGebra errors. */
export function formatRepairUserContent(
  commands: string[],
  failures: CommandFailure[],
  canvasState?: string[],
): string {
  const script = commands.join('\n');
  const errors = failures.map((f) => `- \`${f.cmd}\` → ${f.error}`).join('\n');
  // Live canvas snapshot (label: type @ coords) — lets the model reason about
  // the actual evaluated geometry instead of guessing from the script alone.
  const state = canvasState && canvasState.length
    ? `\n\nObjects currently on the canvas (evaluated by the engine):\n${canvasState.slice(0, 48).map((l) => `  ${l}`).join('\n')}`
    : '';
  return `Script that was run:
\`\`\`geogebra
${script}
\`\`\`

GeoGebra reported these errors:
${errors}${state}

Return the full corrected script as ONE \`\`\`geogebra block.`;
}

export { userMessageHasDrawableContent };
