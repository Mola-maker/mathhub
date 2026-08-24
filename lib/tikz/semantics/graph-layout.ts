import type { GraphEdgeSpec, Statement } from '../subset/ast';
import {
  applyTikzCoordinateTransform,
} from '../subset/coordinate-transform';
import type { Pt } from './calc-eval';

type GraphStatement = Extract<Statement, { kind: 'graph' }>;

export type GraphLayoutIntent = 'standard' | 'layered' | 'tree' | 'circular' | 'force';
export type GraphLayoutFidelity = 'deterministic-preview';

export interface StaticGraphLayout {
  readonly positions: ReadonlyMap<string, Pt>;
  /** Bounded Canvas interpretation of the requested official layout family. */
  readonly intent: GraphLayoutIntent;
  /** Exact normalized PGF key, when an algorithmic layout was requested. */
  readonly requestedKey: string | null;
  /** Canvas coordinates are a projection; LuaTeX remains visual truth. */
  readonly fidelity: GraphLayoutFidelity;
  readonly exactCompilerRequired: boolean;
}

interface Direction {
  readonly key: 'grow right' | 'grow left' | 'grow up' | 'grow down';
  readonly primary: Pt;
  readonly secondary: Pt;
}

interface RankedGraph {
  readonly rankByName: ReadonlyMap<string, number>;
  readonly cyclic: boolean;
}

const DIRECTIONS: readonly Direction[] = [
  { key: 'grow right', primary: { x: 1, y: 0 }, secondary: { x: 0, y: 1 } },
  { key: 'grow left', primary: { x: -1, y: 0 }, secondary: { x: 0, y: 1 } },
  { key: 'grow up', primary: { x: 0, y: 1 }, secondary: { x: 1, y: 0 } },
  { key: 'grow down', primary: { x: 0, y: -1 }, secondary: { x: 1, y: 0 } },
];

const ALGORITHM_KEYS: readonly {
  readonly key: string;
  readonly intent: Exclude<GraphLayoutIntent, 'standard'>;
}[] = [
  { key: 'binary tree layout', intent: 'tree' },
  { key: 'tree layout', intent: 'tree' },
  { key: 'layered layout', intent: 'layered' },
  { key: 'simple necklace layout', intent: 'circular' },
  { key: 'necklace layout', intent: 'circular' },
  { key: 'circular layout', intent: 'circular' },
  { key: 'radial layout', intent: 'circular' },
  { key: 'spring electrical layout', intent: 'force' },
  { key: 'spring layout', intent: 'force' },
  { key: 'force layout', intent: 'force' },
  { key: 'stress layout', intent: 'force' },
  { key: 'random layout', intent: 'force' },
];

function normalizedKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/tikz\//u, '')
    .replace(/^\/?graph drawing\//u, '');
}

function normalizedValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function optionEntries(statement: GraphStatement): readonly {
  readonly key: string;
  readonly value: string | null;
}[] {
  return statement.options?.sequence.entries.map((entry) => ({
    key: normalizedKey(entry.interpretedKey),
    value: normalizedValue(entry.interpretedValue),
  })) ?? [];
}

function optionValue(
  entries: readonly { readonly key: string; readonly value: string | null }[],
  key: string,
): string | null {
  return entries.filter((entry) => entry.key === key).at(-1)?.value ?? null;
}

function graphLength(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(cm|mm|pt)?$/iu.exec(value.trim());
  if (!match) return fallback;
  const numeric = Number(match[1]);
  const scale = match[2]?.toLowerCase() === 'mm'
    ? 0.1
    : match[2]?.toLowerCase() === 'pt'
      ? 1 / 28.45274
      : 1;
  const result = numeric * scale;
  return Number.isFinite(result) && Math.abs(result) > 1e-9
    ? Math.abs(result)
    : fallback;
}

function layoutRequest(
  entries: readonly { readonly key: string; readonly value: string | null }[],
): { readonly intent: GraphLayoutIntent; readonly requestedKey: string | null } {
  let selected: { readonly intent: GraphLayoutIntent; readonly requestedKey: string | null } = {
    intent: 'standard',
    requestedKey: null,
  };
  for (const entry of entries) {
    const match = ALGORITHM_KEYS.find((candidate) => entry.key === candidate.key);
    if (match) selected = { intent: match.intent, requestedKey: match.key };
  }
  return selected;
}

function graphDirection(
  entries: readonly { readonly key: string; readonly value: string | null }[],
): Direction {
  let selected = DIRECTIONS[0]!;
  for (const entry of entries) {
    const match = DIRECTIONS.find((candidate) => candidate.key === entry.key);
    if (match) selected = match;
  }
  return selected;
}

function orientedEdge(
  edge: GraphEdgeSpec,
  order: ReadonlyMap<string, number>,
): readonly [string, string] | null {
  if (edge.connector === '-!-') return null;
  if (edge.connector === '->') return [edge.from, edge.to];
  if (edge.connector === '<-') return [edge.to, edge.from];
  const fromIndex = order.get(edge.from) ?? 0;
  const toIndex = order.get(edge.to) ?? 0;
  return fromIndex <= toIndex ? [edge.from, edge.to] : [edge.to, edge.from];
}

/**
 * Condenses directed cycles before assigning longest-path ranks. This keeps
 * branch layout stable without pretending that Canvas executes PGF's Lua
 * algorithm phases.
 */
function rankedGraph(statement: GraphStatement): RankedGraph {
  const names = statement.nodes.map((node) => node.name);
  const order = new Map(names.map((name, index) => [name, index] as const));
  const adjacency = new Map(names.map((name) => [name, [] as string[]] as const));
  let selfLoop = false;
  for (const edge of statement.edges) {
    const pair = orientedEdge(edge, order);
    if (!pair || !adjacency.has(pair[0]) || !adjacency.has(pair[1])) continue;
    if (pair[0] === pair[1]) selfLoop = true;
    const values = adjacency.get(pair[0])!;
    if (!values.includes(pair[1])) values.push(pair[1]);
  }
  for (const values of adjacency.values()) {
    values.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  let visitIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (name: string): void => {
    indexes.set(name, visitIndex);
    lowLinks.set(name, visitIndex);
    visitIndex += 1;
    stack.push(name);
    onStack.add(name);
    for (const next of adjacency.get(name) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowLinks.set(name, Math.min(lowLinks.get(name)!, lowLinks.get(next)!));
      } else if (onStack.has(next)) {
        lowLinks.set(name, Math.min(lowLinks.get(name)!, indexes.get(next)!));
      }
    }
    if (lowLinks.get(name) !== indexes.get(name)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === name) break;
    }
    component.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    components.push(component);
  };

  for (const name of names) if (!indexes.has(name)) visit(name);
  const componentOf = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const name of component) componentOf.set(name, componentIndex);
  });
  const componentOrder = components.map((component) => Math.min(
    ...component.map((name) => order.get(name) ?? Number.MAX_SAFE_INTEGER),
  ));
  const componentEdges = new Map(components.map((_, index) => [index, new Set<number>()] as const));
  const indegree = new Map<number, number>(
    components.map((_, index) => [index, 0]),
  );
  for (const [from, values] of adjacency) {
    const fromComponent = componentOf.get(from)!;
    for (const to of values) {
      const toComponent = componentOf.get(to)!;
      if (fromComponent === toComponent || componentEdges.get(fromComponent)!.has(toComponent)) continue;
      componentEdges.get(fromComponent)!.add(toComponent);
      indegree.set(toComponent, (indegree.get(toComponent) ?? 0) + 1);
    }
  }
  const queue = components
    .map((_, index) => index)
    .filter((index) => indegree.get(index) === 0)
    .sort((a, b) => componentOrder[a]! - componentOrder[b]!);
  const componentRank = new Map<number, number>(
    components.map((_, index) => [index, 0]),
  );
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextComponents = [...componentEdges.get(current)!]
      .sort((a, b) => componentOrder[a]! - componentOrder[b]!);
    for (const next of nextComponents) {
      componentRank.set(next, Math.max(
        componentRank.get(next) ?? 0,
        (componentRank.get(current) ?? 0) + 1,
      ));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort((a, b) => componentOrder[a]! - componentOrder[b]!);
      }
    }
  }
  return {
    rankByName: new Map(names.map((name) => [
      name,
      componentRank.get(componentOf.get(name)!) ?? 0,
    ] as const)),
    cyclic: selfLoop || components.some((component) => component.length > 1),
  };
}

function linearPositions(
  statement: GraphStatement,
  direction: Direction,
  spacing: number,
): ReadonlyMap<string, Pt> {
  return new Map(statement.nodes.map((node, index) => [node.name, {
    x: direction.primary.x * spacing * index,
    y: direction.primary.y * spacing * index,
  }] as const));
}

function layeredPositions(
  statement: GraphStatement,
  direction: Direction,
  levelDistance: number,
  siblingDistance: number,
  ranked: RankedGraph,
): ReadonlyMap<string, Pt> {
  const ranks = new Map<number, string[]>();
  for (const node of statement.nodes) {
    const rank = ranked.rankByName.get(node.name) ?? 0;
    ranks.set(rank, [...(ranks.get(rank) ?? []), node.name]);
  }
  const positions = new Map<string, Pt>();
  for (const [rank, names] of ranks) {
    names.forEach((name, index) => {
      const secondary = (index - (names.length - 1) / 2) * siblingDistance;
      positions.set(name, {
        x: direction.primary.x * rank * levelDistance + direction.secondary.x * secondary,
        y: direction.primary.y * rank * levelDistance + direction.secondary.y * secondary,
      });
    });
  }
  return positions;
}

function circularPositions(statement: GraphStatement, radius: number): ReadonlyMap<string, Pt> {
  const count = statement.nodes.length;
  return new Map(statement.nodes.map((node, index) => {
    const angle = Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, count);
    return [node.name, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }] as const;
  }));
}

function forcePositions(
  statement: GraphStatement,
  scale: number,
): ReadonlyMap<string, Pt> {
  const count = statement.nodes.length;
  if (count <= 1) return new Map(statement.nodes.map((node) => [node.name, { x: 0, y: 0 }] as const));
  // O(n^2) repulsion is deliberately bounded for interactive latency.
  if (count > 120) return circularPositions(statement, Math.max(2, count * 0.18) * scale);
  const names = statement.nodes.map((node) => node.name);
  const indexOf = new Map(names.map((name, index) => [name, index] as const));
  const initialRadius = Math.max(1.5, count * 0.24) * scale;
  const positions = names.map((_, index) => {
    const angle = Math.PI / 2 + (2 * Math.PI * index) / count;
    return { x: initialRadius * Math.cos(angle), y: initialRadius * Math.sin(angle) };
  });
  const edges = new Map<string, readonly [number, number]>();
  for (const edge of statement.edges) {
    if (edge.connector === '-!-') continue;
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const pair = from < to ? [from, to] as const : [to, from] as const;
    edges.set(`${pair[0]}:${pair[1]}`, pair);
  }
  const area = Math.max(16, count * 4) * scale * scale;
  const ideal = Math.sqrt(area / count);
  const iterations = count <= 48 ? 72 : 44;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const displacement = positions.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        let dx = positions[left]!.x - positions[right]!.x;
        let dy = positions[left]!.y - positions[right]!.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
          dx = (left + 1) * 1e-4;
          dy = (right + 1) * -1e-4;
          distance = Math.hypot(dx, dy);
        }
        const force = (ideal * ideal) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        displacement[left]!.x += fx;
        displacement[left]!.y += fy;
        displacement[right]!.x -= fx;
        displacement[right]!.y -= fy;
      }
    }
    for (const [from, to] of edges.values()) {
      const dx = positions[from]!.x - positions[to]!.x;
      const dy = positions[from]!.y - positions[to]!.y;
      const distance = Math.max(1e-6, Math.hypot(dx, dy));
      const force = (distance * distance) / ideal;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      displacement[from]!.x -= fx;
      displacement[from]!.y -= fy;
      displacement[to]!.x += fx;
      displacement[to]!.y += fy;
    }
    const temperature = Math.max(0.025 * scale, (1 - iteration / iterations) * scale);
    for (let index = 0; index < count; index += 1) {
      const magnitude = Math.hypot(displacement[index]!.x, displacement[index]!.y);
      if (magnitude <= 1e-9) continue;
      const step = Math.min(magnitude, temperature);
      positions[index]!.x += (displacement[index]!.x / magnitude) * step;
      positions[index]!.y += (displacement[index]!.y / magnitude) * step;
    }
  }
  const centroid = positions.reduce((sum, point) => ({
    x: sum.x + point.x / count,
    y: sum.y + point.y / count,
  }), { x: 0, y: 0 });
  return new Map(names.map((name, index) => [name, {
    x: positions[index]!.x - centroid.x,
    y: positions[index]!.y - centroid.y,
  }] as const));
}

export function layoutStaticGraph(statement: GraphStatement): StaticGraphLayout {
  const entries = optionEntries(statement);
  const request = layoutRequest(entries);
  const direction = graphDirection(entries);
  const directionDistance = graphLength(optionValue(entries, direction.key), 2);
  const levelDistance = graphLength(optionValue(entries, 'level distance'), directionDistance);
  const siblingDistance = graphLength(optionValue(entries, 'sibling distance'), Math.max(1.4, levelDistance * 0.8));
  const ranked = rankedGraph(statement);
  const hasBranch = new Set(statement.edges
    .filter((edge) => edge.connector !== '-!-')
    .map((edge) => edge.connector === '<-' ? edge.to : edge.from)).size
    < statement.edges.filter((edge) => edge.connector !== '-!-').length;

  let local: ReadonlyMap<string, Pt>;
  if (request.intent === 'circular') {
    local = circularPositions(
      statement,
      graphLength(optionValue(entries, 'radius'), Math.max(2, statement.nodes.length * 0.45)),
    );
  } else if (request.intent === 'force') {
    local = forcePositions(statement, directionDistance / 2);
  } else if (request.intent === 'layered' || request.intent === 'tree') {
    local = layeredPositions(statement, direction, levelDistance, siblingDistance, ranked);
  } else if (statement.edges.length > 0 && hasBranch && !ranked.cyclic) {
    local = layeredPositions(statement, direction, levelDistance, siblingDistance, ranked);
  } else {
    local = linearPositions(statement, direction, directionDistance);
  }

  return {
    positions: new Map([...local].map(([name, point]) => [
      name,
      applyTikzCoordinateTransform(statement.coordinateTransform, point),
    ] as const)),
    intent: request.intent,
    requestedKey: request.requestedKey,
    fidelity: 'deterministic-preview',
    exactCompilerRequired: request.intent !== 'standard',
  };
}
