import { parseGgbBlock } from '@/lib/math/geogebra-commands';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

const CONTINUATION_RE =
  /基础上|基于上面|基于上题|上一题|继续|接着|补充|修改|调整|在上面|在原图|已有图|不要清空|保留.*图/i;

/** User wants to extend the current figure, not start from scratch. */
export function isContinuationRequest(problem: string, history: HistoryMessage[]): boolean {
  if (CONTINUATION_RE.test(problem.trim())) return true;
  if (history.length >= 2) {
    const prevUser = [...history].reverse().find((m) => m.role === 'user');
    if (prevUser && CONTINUATION_RE.test(prevUser.content)) return true;
  }
  return false;
}

/** Last assistant reply that contained executable GeoGebra commands. */
export function extractLastGgbCommandsFromHistory(history: HistoryMessage[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant') continue;
    const cmds = parseGgbBlock(m.content);
    if (cmds.length > 0) return cmds;
  }
  return [];
}

export function formatPreviousGgbContext(commands: string[]): string {
  if (!commands.length) return '';
  const lines = commands.slice(0, 60).map((c) => `  ${c}`);
  return [
    '═══ CURRENT CANVAS (already on screen) ═══',
    'The GeoGebra canvas currently shows the construction below.',
    '- If the user is ITERATING on it (adds/fixes/proves/relabels, or refers to existing points like the ones below): reuse these EXACT labels and coordinates, and output the FULL updated script — every still-valid line below PLUS your new lines — as ONE ```geogebra block so nothing is lost.',
    '- If the user is clearly starting a DIFFERENT figure: ignore the lines below and build the new figure from scratch.',
    ...lines,
  ].join('\n');
}
