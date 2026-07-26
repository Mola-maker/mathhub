// Deterministically reorder GeoGebra commands so every object is defined before
// it is referenced. The LLM frequently emits forward references — e.g.
// `lineBD=Line(B,D)` BEFORE `D=…` — which GeoGebra rejects, collapsing the whole
// dependent chain (E, P, Q never get built). A stable topological sort by
// intra-script dependencies fixes this entire class of errors with no LLM
// round-trip, and leaves already-correct scripts untouched.

const IDENT = /[A-Za-z_]\w*/g;

/** LHS label of `Name=...` (but not `==`), else null (void / auto-named command). */
export function defLabel(cmd: string): string | null {
  const m = cmd.match(/^\s*([A-Za-z][\w]*)\s*=(?!=)/);
  return m ? m[1] : null;
}

/** Identifiers a command references (RHS for assignments; whole command otherwise). */
function referencedIdents(cmd: string, label: string | null): string[] {
  const body = label ? cmd.slice(cmd.indexOf('=') + 1) : cmd;
  return body.match(IDENT) ?? [];
}

/**
 * Stable topological reorder. Edge i→j when command j references a label first
 * defined by command i; i must come before j. Ties keep original order. A cycle
 * (shouldn't occur in valid geometry) is broken by emitting the lowest remaining
 * index, so no command is ever dropped.
 */
export function reorderByDependencies(commands: string[]): string[] {
  const n = commands.length;
  if (n < 2) return commands.slice();

  const labelToIndex = new Map<string, number>();
  const defs: (string | null)[] = commands.map((c) => defLabel(c));
  defs.forEach((lbl, i) => { if (lbl && !labelToIndex.has(lbl)) labelToIndex.set(lbl, i); });

  const deps: Array<Set<number>> = commands.map((c, j) => {
    const set = new Set<number>();
    for (const r of referencedIdents(c, defs[j])) {
      const i = labelToIndex.get(r);
      if (i !== undefined && i !== j) set.add(i);
    }
    return set;
  });

  const emitted = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (emitted[i]) continue;
      let ready = true;
      for (const d of deps[i]) if (!emitted[d]) { ready = false; break; }
      if (ready) { pick = i; break; }
    }
    if (pick === -1) for (let i = 0; i < n; i++) if (!emitted[i]) { pick = i; break; }
    emitted[pick] = true;
    order.push(pick);
  }
  return order.map((i) => commands[i]);
}
