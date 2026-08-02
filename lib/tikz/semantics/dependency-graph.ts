import type { Statement, CoordExpr } from '../../tikz/subset/ast';
import { collectCoordRefs } from '../../tikz/subset/static-check';

export interface DepGraph {
  order: string[];
  cycle: string[] | null;
  nodeKinds: Map<string, 'point' | 'path'>;
  dependencies: Map<string, readonly string[]>;
  dependents: Map<string, readonly string[]>;
}

export interface DependencyClosureOptions {
  includeAncestors?: boolean;
  includeDescendants?: boolean;
  maxNodes?: number;
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
  const dependents = new Map<string, string[]>();
  for (const id of deps.keys()) dependents.set(id, []);
  for (const [dependent, dependencies] of deps) {
    for (const dependency of dependencies) {
      const values = dependents.get(dependency) ?? [];
      if (!values.includes(dependent)) values.push(dependent);
      dependents.set(dependency, values);
    }
  }
  for (const values of dependents.values()) values.sort();
  return {
    order,
    cycle,
    nodeKinds,
    dependencies: deps,
    dependents,
  };
}

function traverse(
  edges: ReadonlyMap<string, readonly string[]>,
  seeds: readonly string[],
  maxNodes: number,
): string[] {
  const visited = new Set<string>();
  const queue = [...new Set(seeds)].sort();
  while (queue.length > 0 && visited.size < maxNodes) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of edges.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return [...visited];
}

export function dependencyAncestors(
  graph: DepGraph,
  seeds: readonly string[],
  maxNodes = 512,
): readonly string[] {
  return traverse(graph.dependencies, seeds, Math.max(0, maxNodes));
}

export function dependencyDescendants(
  graph: DepGraph,
  seeds: readonly string[],
  maxNodes = 512,
): readonly string[] {
  return traverse(graph.dependents, seeds, Math.max(0, maxNodes));
}

export function dependencyClosure(
  graph: DepGraph,
  seeds: readonly string[],
  options: DependencyClosureOptions = {},
): readonly string[] {
  const maxNodes = Math.max(0, options.maxNodes ?? 512);
  const values = new Set(seeds);
  if (options.includeAncestors ?? true) {
    for (const id of dependencyAncestors(graph, seeds, maxNodes)) values.add(id);
  }
  if (options.includeDescendants ?? true) {
    for (const id of dependencyDescendants(graph, seeds, maxNodes)) values.add(id);
  }
  return [...values].sort().slice(0, maxNodes);
}
