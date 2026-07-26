import type { Statement, CoordExpr } from '../../tikz/subset/ast';
import { collectCoordRefs } from '../../tikz/subset/static-check';

export interface DepGraph {
  order: string[];
  cycle: string[] | null;
  nodeKinds: Map<string, 'point' | 'path'>;
}

function refsOfCoord(c: CoordExpr): string[] {
  return collectCoordRefs(c);
}

export function buildDependencyGraph(stmts: Statement[]): DepGraph {
  const nodeKinds = new Map<string, 'point' | 'path'>();
  const deps = new Map<string, string[]>();

  function node(id: string, kind: 'point' | 'path', nodeDeps: string[]): void {
    if (!nodeKinds.has(id)) nodeKinds.set(id, kind);
    deps.set(id, [...(deps.get(id) ?? []), ...nodeDeps]);
  }

  for (const s of stmts) {
    if (s.kind === 'coordinate') {
      node(s.name, 'point', refsOfCoord(s.at));
    } else if (s.kind === 'let-coordinate') {
      const d: string[] = [];
      for (const b of s.bindings) if (b.type === 'point') d.push(...refsOfCoord(b.value));
      d.push(...refsOfCoord(s.at));
      node(s.name, 'point', d);
    } else if (s.kind === 'path') {
      if (s.namePath) {
        const d: string[] = [];
        for (const spec of s.specs) {
          if (spec.type === 'polyline') for (const p of spec.points) d.push(...refsOfCoord(p));
          else if (spec.type === 'circle') {
            d.push(...refsOfCoord(spec.center));
            if (spec.radius.kind === 'through') d.push(...refsOfCoord(spec.radius.point));
          }
        }
        node(`path:${s.namePath}`, 'path', d);
      }
      if (s.intersections) {
        for (const b of s.intersections.bindings) {
          node(b.name, 'point', [`path:${s.intersections.of[0]}`, `path:${s.intersections.of[1]}`]);
        }
      }
    }
  }

  // Kahn topological sort
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of deps.keys()) {
    indeg.set(id, indeg.get(id) ?? 0);
    adj.set(id, adj.get(id) ?? []);
  }
  for (const [id, ds] of deps) {
    for (const d of ds) {
      if (!deps.has(d)) continue; // skip unknown deps (covered by staticCheck elsewhere)
      adj.get(d)!.push(id);
      indeg.set(id, (indeg.get(id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, n] of indeg) if (n === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const n = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  let cycle: string[] | null = null;
  if (order.length < deps.size) {
    cycle = [];
    for (const id of deps.keys()) if (!order.includes(id)) cycle.push(id);
    cycle.sort();
  }
  return { order, cycle, nodeKinds };
}