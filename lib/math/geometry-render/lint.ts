// Semantic geometry lint — the check the engine can't do.
//
// evalCommand happily "succeeds" while producing a wrong figure: an Intersect
// lands undefined (segment never reaches the circle), two named points
// coincide, a "triangle" is collinear, a circle has zero radius. These are the
// silent quality failures users actually see. This lint reads the LIVE applet
// after a clean run and turns each degeneracy into a CommandFailure whose
// error text tells the (local or LLM) repair tier exactly what to change.

import { parseGgbScript } from '@/lib/math/tikz-export/ggb-script';
import { parseCommand } from '@/lib/math/tikz-export/ggb-to-tikz';
import type { CommandFailure } from '@/lib/math/geometry-render/run-script';

/** Read-side applet surface the lint needs (subset of the classic bundle). */
export type GeometryReadApi = {
  getXcoord?: (name: string) => number;
  getYcoord?: (name: string) => number;
  isDefined?: (name: string) => boolean;
};

const EPS = 1e-6;

/** Points worth complaining about: meaningful labels, not scaffolding. */
function isVisiblePointLabel(name: string): boolean {
  return /^[A-Z]'*(?:_\d+|\d)?$/.test(name);
}

/** The script line that defines `label`, for failure attribution. */
function definingLine(commands: string[], label: string): string {
  const re = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  return commands.find((c) => re.test(c)) ?? label;
}

function triArea(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * Lint the figure the script just produced. Returns [] when the construction
 * is geometrically sound; otherwise repair-ready failures, capped so a wild
 * canvas can't flood the repair prompt.
 */
export function lintGeometry(
  api: GeometryReadApi,
  commands: string[],
): CommandFailure[] {
  const failures: CommandFailure[] = [];
  const push = (cmd: string, error: string) => {
    if (failures.length < 4 && !failures.some((f) => f.cmd === cmd)) failures.push({ cmd, error });
  };

  const coordOf = (name: string) => {
    const x = api.getXcoord?.(name);
    const y = api.getYcoord?.(name);
    if (x == null || y == null) return null;
    return { x, y };
  };

  const objects = parseGgbScript(commands, coordOf);
  const pts = new Map<string, { x: number; y: number }>();

  // 1 · undefined / NaN points — the parents never actually met
  for (const o of objects) {
    if (o.type !== 'point') continue;
    const defined = api.isDefined ? api.isDefined(o.name) : true;
    const bad = !defined
      || o.x == null || o.y == null
      || !isFinite(o.x) || !isFinite(o.y);
    if (bad) {
      const head = parseCommand(o.command)?.fn;
      const hint = head === 'Intersect'
        ? 'the two objects do not actually intersect — extend a Point(...) parameter past the circle/line or flip the Intersect index'
        : 'its parent objects do not reach this configuration — adjust the construction parameters';
      push(definingLine(commands, o.name), `point ${o.name} is undefined on the canvas: ${hint}`);
      continue;
    }
    if (o.x != null && o.y != null) pts.set(o.name, { x: o.x, y: o.y });
  }

  // 2 · coincident named points — almost always a wrong index / parameter
  const named = [...pts.entries()].filter(([n]) => isVisiblePointLabel(n));
  outer:
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const [na, a] = named[i];
      const [nb, b] = named[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < EPS) {
        push(
          definingLine(commands, nb),
          `points ${na} and ${nb} coincide at (${a.x.toFixed(3)}, ${a.y.toFixed(3)}) — likely the same intersection branch; use the other Intersect index or different parameters`,
        );
        if (failures.length >= 4) break outer;
      }
    }
  }

  // 3 · degenerate polygons (collinear vertices) and zero circles
  for (const o of objects) {
    const parsed = parseCommand(o.command);
    if (!parsed) continue;
    if (o.type === 'polygon' && parsed.fn === 'Polygon' && parsed.args.length >= 3) {
      const vs = parsed.args.map((a) => pts.get(a)).filter((p): p is { x: number; y: number } => !!p);
      if (vs.length >= 3) {
        let area = 0;
        for (let i = 2; i < vs.length; i++) area += triArea(vs[0], vs[i - 1], vs[i]);
        const span = Math.max(...vs.map((p) => Math.hypot(p.x - vs[0].x, p.y - vs[0].y)), 1);
        if (area < 1e-4 * span * span) {
          push(definingLine(commands, o.name) === o.name ? o.command : definingLine(commands, o.name),
            `polygon ${parsed.args.join('')} is degenerate (vertices are collinear) — spread the defining coordinates`);
        }
      }
    }
    if (o.type === 'conic' && parsed.fn === 'Circle' && parsed.args.length === 2) {
      const c = pts.get(parsed.args[0]);
      const t = pts.get(parsed.args[1]);
      if (c && t && Math.hypot(c.x - t.x, c.y - t.y) < EPS) {
        push(definingLine(commands, o.name) === o.name ? o.command : definingLine(commands, o.name),
          `circle ${o.name} has zero radius (centre ${parsed.args[0]} equals ${parsed.args[1]})`);
      }
    }
  }

  return failures;
}
