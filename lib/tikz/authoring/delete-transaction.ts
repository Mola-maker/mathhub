import type { TextPatch } from '../document/source-transaction';
import { assertTextPatch } from '../document/source-transaction';
import type { Scene, SceneElement } from '../semantics/scene';
import { evalCoord, type Pt } from '../semantics/calc-eval';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import type { CoordExpr, SourceRange, Statement } from '../subset/ast';
import { collectCoordRefs } from '../subset/static-check';
import { deleteStatementPatch } from './property-patch';
import { formatCoordNumber } from '../patch/source-patch';

/** The deletion policy is deliberately explicit because each mode has a different
 * source-level consequence. There is no second in-memory scene to mutate. */
export type DeleteMode = 'cascade' | 'block' | 'detach';

export type DeleteTarget =
  | string
  | {
    stableId?: string | null;
    stmtIndex?: number | null;
  };

export type DeletionNodeKind = 'statement' | 'point' | 'path' | 'element';

export interface DeletionNode {
  /** Internal graph id. It is stable for one source revision only. */
  id: string;
  /** Entity identity used by hit testing, when one exists. */
  stableId: string | null;
  kind: DeletionNodeKind;
  name: string | null;
  stmtIndex: number | null;
  range: SourceRange | null;
  /** Human-readable semantic references (point names or named paths). */
  refs: readonly string[];
  dependencies: readonly string[];
  dependents: readonly string[];
}

export interface DeletionDependencyGraph {
  nodes: ReadonlyMap<string, DeletionNode>;
  byStableId: ReadonlyMap<string, readonly string[]>;
  byStmtIndex: ReadonlyMap<number, string>;
  /** Dependency closure excluding the node itself. */
  ancestors: ReadonlyMap<string, readonly string[]>;
  /** Dependent closure excluding the node itself. */
  descendants: ReadonlyMap<string, readonly string[]>;
}

export interface ResolvedDeleteTarget {
  target: DeleteTarget;
  node: DeletionNode;
}

export type DeleteDiagnosticSeverity = 'info' | 'warning' | 'error';

export type DeleteDiagnosticCode =
  | 'target-not-found'
  | 'target-ambiguous'
  | 'target-mismatch'
  | 'blocked-by-dependents'
  | 'detach-unsupported'
  | 'invalid-source-range'
  | 'overlapping-patches'
  | 'duplicate-target'
  | 'no-op';

export interface DeleteDiagnostic {
  severity: DeleteDiagnosticSeverity;
  code: DeleteDiagnosticCode;
  message: string;
  nodeIds?: readonly string[];
  stmtIndices?: readonly number[];
}

export type DeletePreviewAction = 'delete' | 'detach' | 'keep' | 'blocked';

export interface DeletePreviewItem {
  nodeId: string;
  stableId: string | null;
  kind: DeletionNodeKind;
  name: string | null;
  stmtIndex: number | null;
  range: SourceRange | null;
  action: DeletePreviewAction;
  dependencies: readonly string[];
  dependents: readonly string[];
}

export interface DeletePlan {
  mode: DeleteMode;
  graph: DeletionDependencyGraph;
  requested: readonly DeleteTarget[];
  resolved: readonly ResolvedDeleteTarget[];
  /** Nodes selected by the user (before policy expansion). */
  rootNodeIds: readonly string[];
  /** Statement-owner roots used to preserve source-granular deletion semantics. */
  sourceRootNodeIds: readonly string[];
  /** Full dependent closure for cascade/block; roots only for detach. */
  affectedNodeIds: readonly string[];
  removedNodeIds: readonly string[];
  detachedNodeIds: readonly string[];
  blockedNodeIds: readonly string[];
  removedStatementIndices: readonly number[];
  detachedStatementIndices: readonly number[];
  patches: readonly TextPatch[];
  diagnostics: readonly DeleteDiagnostic[];
  preview: readonly DeletePreviewItem[];
  canApply: boolean;
}

export interface DeletePlanInput {
  source: string;
  scene: Scene;
  statements: readonly Statement[];
  targets: DeleteTarget | readonly DeleteTarget[];
  mode: DeleteMode;
}

interface MutableNode {
  id: string;
  stableId: string | null;
  kind: DeletionNodeKind;
  name: string | null;
  stmtIndex: number | null;
  range: SourceRange | null;
  refs: Set<string>;
  dependencies: Set<string>;
  dependents: Set<string>;
}

interface StatementRefs {
  points: Set<string>;
  paths: Set<string>;
}

interface DetachResult {
  patches: TextPatch[];
  detachedStatementIndices: number[];
  unsupported: Array<{ stmtIndex: number; reason: string }>;
}

function emptyStatementRefs(): StatementRefs {
  return { points: new Set<string>(), paths: new Set<string>() };
}

/**
 * Managed `@mathgeo` construction blocks are command transactions. Deleting
 * any planned generated statement removes the whole block, including directive
 * comments, so the source cannot retain empty or misleading recipe metadata.
 */
export function expandManagedConstructionDeletions(
  source: string,
  patches: readonly TextPatch[],
): TextPatch[] {
  const blocks = parseManagedConstructionBlocks(source);
  const expandedBlocks = blocks.filter((block) => patches.some((patch) => (
    patch.insert.length === 0
    && patch.from < block.range.end
    && patch.to > block.range.start
  )));
  if (expandedBlocks.length === 0) return [...patches];
  const retained = patches.filter((patch) => !expandedBlocks.some((block) => (
    patch.from >= block.range.start && patch.to <= block.range.end
  )));
  return [
    ...retained,
    ...expandedBlocks.map((block) => ({
      from: block.range.start,
      to: block.range.end,
      insert: '',
    })),
  ];
}

function managedConstructionStatementGroups(
  source: string,
  statements: readonly Statement[],
): Array<{
  block: ReturnType<typeof parseManagedConstructionBlocks>[number];
  statementIndices: readonly number[];
}> {
  return parseManagedConstructionBlocks(source).map((block) => ({
    block,
    statementIndices: statements.flatMap((statement, stmtIndex) => (
      statement.range.start < block.bodyRange.end
      && statement.range.end > block.bodyRange.start
        ? [stmtIndex]
        : []
    )),
  }));
}

function addCoordRefs(target: Set<string>, coord: CoordExpr): void {
  for (const ref of collectCoordRefs(coord)) target.add(ref);
}

function refsOfStatement(statement: Statement): StatementRefs {
  const refs = emptyStatementRefs();
  if (statement.kind === 'coordinate') {
    addCoordRefs(refs.points, statement.at);
  } else if (statement.kind === 'let-coordinate') {
    for (const binding of statement.bindings) {
      if (binding.type === 'point') addCoordRefs(refs.points, binding.value);
    }
    addCoordRefs(refs.points, statement.at);
  } else if (statement.kind === 'path') {
    for (const spec of statement.specs) {
      if (spec.type === 'polyline') {
        for (const point of spec.points) addCoordRefs(refs.points, point);
      } else if (spec.type === 'rectangle') {
        addCoordRefs(refs.points, spec.first);
        addCoordRefs(refs.points, spec.opposite);
      } else if (spec.type === 'cubic-bezier') {
        for (const point of [spec.start, spec.control1, spec.control2, spec.end]) {
          addCoordRefs(refs.points, point);
        }
      } else if (spec.type === 'circular-arc') {
        addCoordRefs(refs.points, spec.start);
      } else if (spec.type === 'ellipse') {
        addCoordRefs(refs.points, spec.center);
      } else {
        addCoordRefs(refs.points, spec.center);
        if (spec.radius.kind === 'through') addCoordRefs(refs.points, spec.radius.point);
      }
    }
    if (statement.intersections) {
      refs.paths.add(statement.intersections.of[0]);
      refs.paths.add(statement.intersections.of[1]);
    }
  } else if (statement.kind === 'node') {
    addCoordRefs(refs.points, statement.at);
  } else if (statement.kind === 'pic') {
    for (const point of statement.points) refs.points.add(point);
  }
  return refs;
}

function toRefNames(refs: StatementRefs): string[] {
  return [
    ...new Set([
      ...refs.points,
      ...[...refs.paths].map((path) => `path:${path}`),
    ]),
  ].sort();
}

function pointNodeId(name: string): string {
  return `point:${name}`;
}

function pathNodeId(name: string): string {
  return `path:${name}`;
}

function statementNodeId(stmtIndex: number): string {
  return `stmt:${stmtIndex}`;
}

function elementNodeId(stableId: string, stmtIndex: number, ordinal: number): string {
  return `element:${stableId || `${stmtIndex}:${ordinal}`}`;
}

function ensureNode(
  nodes: Map<string, MutableNode>,
  value: Omit<MutableNode, 'refs' | 'dependencies' | 'dependents'> & { refs?: Iterable<string> },
): MutableNode {
  const existing = nodes.get(value.id);
  if (existing) {
    if (!existing.stableId && value.stableId) existing.stableId = value.stableId;
    if (existing.stmtIndex === null && value.stmtIndex !== null) existing.stmtIndex = value.stmtIndex;
    if (!existing.range && value.range) existing.range = value.range;
    if (!existing.name && value.name) existing.name = value.name;
    if (value.refs) for (const ref of value.refs) existing.refs.add(ref);
    return existing;
  }
  const node: MutableNode = {
    id: value.id,
    stableId: value.stableId,
    kind: value.kind,
    name: value.name,
    stmtIndex: value.stmtIndex,
    range: value.range,
    refs: new Set(value.refs ?? []),
    dependencies: new Set<string>(),
    dependents: new Set<string>(),
  };
  nodes.set(node.id, node);
  return node;
}

function addEdge(nodes: Map<string, MutableNode>, dependencyId: string, dependentId: string): void {
  if (dependencyId === dependentId) return;
  const dependency = nodes.get(dependencyId);
  const dependent = nodes.get(dependentId);
  if (!dependency || !dependent) return;
  dependency.dependents.add(dependentId);
  dependent.dependencies.add(dependencyId);
}

function nodeSort(nodes: Map<string, MutableNode>, a: string, b: string): number {
  const left = nodes.get(a);
  const right = nodes.get(b);
  const l = left?.stmtIndex ?? Number.MAX_SAFE_INTEGER;
  const r = right?.stmtIndex ?? Number.MAX_SAFE_INTEGER;
  return l - r || a.localeCompare(b);
}

function closure(
  nodes: Map<string, MutableNode>,
  start: string,
  direction: 'ancestors' | 'descendants',
): string[] {
  const seen = new Set<string>();
  const queue = [...(direction === 'ancestors' ? nodes.get(start)?.dependencies ?? [] : nodes.get(start)?.dependents ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const next = direction === 'ancestors'
      ? nodes.get(current)?.dependencies
      : nodes.get(current)?.dependents;
    if (next) queue.push(...next);
  }
  return [...seen].sort((a, b) => nodeSort(nodes, a, b));
}

function immutableGraph(nodes: Map<string, MutableNode>): DeletionDependencyGraph {
  const frozen = new Map<string, DeletionNode>();
  for (const node of nodes.values()) {
    frozen.set(node.id, {
      id: node.id,
      stableId: node.stableId,
      kind: node.kind,
      name: node.name,
      stmtIndex: node.stmtIndex,
      range: node.range,
      refs: [...node.refs].sort(),
      dependencies: [...node.dependencies].sort((a, b) => nodeSort(nodes, a, b)),
      dependents: [...node.dependents].sort((a, b) => nodeSort(nodes, a, b)),
    });
  }
  const byStableId = new Map<string, string[]>();
  const byStmtIndex = new Map<number, string>();
  for (const node of frozen.values()) {
    if (node.stableId) {
      const ids = byStableId.get(node.stableId) ?? [];
      ids.push(node.id);
      byStableId.set(node.stableId, ids);
    }
    if (node.kind === 'statement' && node.stmtIndex !== null) {
      byStmtIndex.set(node.stmtIndex, node.id);
    }
  }
  const ancestors = new Map<string, readonly string[]>();
  const descendants = new Map<string, readonly string[]>();
  for (const id of frozen.keys()) {
    ancestors.set(id, closure(nodes, id, 'ancestors'));
    descendants.set(id, closure(nodes, id, 'descendants'));
  }
  return {
    nodes: frozen,
    byStableId,
    byStmtIndex,
    ancestors,
    descendants,
  };
}

/**
 * Builds a deletion-oriented graph from the parsed source and the current scene.
 * Scene stable ids are only identity handles; all ranges and ownership come from
 * parsed statements so source remains the only durable truth.
 */
export function buildDeletionDependencyGraph(
  scene: Scene,
  statements: readonly Statement[],
): DeletionDependencyGraph {
  const nodes = new Map<string, MutableNode>();

  statements.forEach((statement, stmtIndex) => {
    ensureNode(nodes, {
      id: statementNodeId(stmtIndex),
      stableId: null,
      kind: 'statement',
      name: null,
      stmtIndex,
      range: statement.range,
      refs: [],
    });
    if (statement.kind === 'coordinate' || statement.kind === 'let-coordinate') {
      ensureNode(nodes, {
        id: pointNodeId(statement.name),
        stableId: null,
        kind: 'point',
        name: statement.name,
        stmtIndex,
        range: statement.range,
        refs: [],
      });
    } else if (statement.kind === 'path') {
      if (statement.namePath) {
        ensureNode(nodes, {
          id: pathNodeId(statement.namePath),
          stableId: `path:${statement.namePath}`,
          kind: 'path',
          name: statement.namePath,
          stmtIndex,
          range: statement.range,
          refs: [],
        });
      }
      if (statement.intersections) {
        for (const binding of statement.intersections.bindings) {
          ensureNode(nodes, {
            id: pointNodeId(binding.name),
            stableId: null,
            kind: 'point',
            name: binding.name,
            stmtIndex,
            range: statement.range,
            refs: [],
          });
        }
      }
    }
  });

  for (const [name, point] of scene.points) {
    ensureNode(nodes, {
      id: pointNodeId(name),
      stableId: point.stableId,
      kind: 'point',
      name,
      stmtIndex: point.stmtIndex,
      range: statements[point.stmtIndex]?.range ?? null,
      refs: point.dependsOn,
    });
  }

  const elementOrdinal = new Map<number, number>();
  scene.elements.forEach((element) => {
    const ordinal = elementOrdinal.get(element.stmtIndex) ?? 0;
    elementOrdinal.set(element.stmtIndex, ordinal + 1);
    const id = elementNodeId(element.stableId, element.stmtIndex, ordinal);
    ensureNode(nodes, {
      id,
      stableId: element.stableId,
      kind: 'element',
      name: null,
      stmtIndex: element.stmtIndex,
      range: statements[element.stmtIndex]?.range ?? null,
      refs: element.refs,
    });
  });

  const refNodeId = (name: string, paths: Set<string>): string | null => {
    if (paths.has(name)) return nodes.has(pathNodeId(name)) ? pathNodeId(name) : null;
    if (nodes.has(pointNodeId(name))) return pointNodeId(name);
    if (nodes.has(pathNodeId(name))) return pathNodeId(name);
    return null;
  };

  statements.forEach((statement, stmtIndex) => {
    const refs = refsOfStatement(statement);
    const statementId = statementNodeId(stmtIndex);
    const allRefs = toRefNames(refs);
    const statementNode = nodes.get(statementId)!;
    allRefs.forEach((ref) => statementNode.refs.add(ref));
    for (const point of refs.points) {
      const dependency = refNodeId(point, new Set<string>());
      if (dependency) addEdge(nodes, dependency, statementId);
    }
    for (const path of refs.paths) {
      const dependency = refNodeId(path, refs.paths);
      if (dependency) addEdge(nodes, dependency, statementId);
    }

    if (statement.kind === 'coordinate' || statement.kind === 'let-coordinate') {
      const output = nodes.get(pointNodeId(statement.name));
      if (output) {
        for (const ref of refs.points) output.refs.add(ref);
        refs.points.forEach((point) => {
          const dependency = refNodeId(point, new Set<string>());
          if (dependency) addEdge(nodes, dependency, output.id);
        });
        addEdge(nodes, statementId, output.id);
      }
    } else if (statement.kind === 'path') {
      if (statement.namePath) {
        const output = nodes.get(pathNodeId(statement.namePath));
        if (output) {
          for (const ref of refs.points) output.refs.add(ref);
          for (const ref of refs.paths) output.refs.add(`path:${ref}`);
          refs.points.forEach((point) => {
            const dependency = refNodeId(point, new Set<string>());
            if (dependency) addEdge(nodes, dependency, output.id);
          });
          addEdge(nodes, statementId, output.id);
        }
      }
      if (statement.intersections) {
        for (const binding of statement.intersections.bindings) {
          const output = nodes.get(pointNodeId(binding.name));
          if (!output) continue;
          for (const path of statement.intersections.of) output.refs.add(`path:${path}`);
          for (const path of statement.intersections.of) {
            const dependency = refNodeId(path, refs.paths);
            if (dependency) addEdge(nodes, dependency, output.id);
          }
          addEdge(nodes, statementId, output.id);
        }
      }
    }
  });

  scene.elements.forEach((element, index) => {
    const ordinal = [...scene.elements.slice(0, index)].filter((candidate) => candidate.stmtIndex === element.stmtIndex).length;
    const id = elementNodeId(element.stableId, element.stmtIndex, ordinal);
    const node = nodes.get(id);
    if (!node) return;
    const statementId = statementNodeId(element.stmtIndex);
    addEdge(nodes, statementId, id);
    for (const rawRef of element.refs) {
      const normalized = rawRef.startsWith('path:') ? rawRef.slice(5) : rawRef;
      const dependency = rawRef.startsWith('path:')
        ? nodes.has(pathNodeId(normalized)) ? pathNodeId(normalized) : null
        : refNodeId(normalized, new Set<string>());
      if (dependency) addEdge(nodes, dependency, id);
    }
  });

  // A point-on-circle coordinate is numerically expressed through the
  // circle's center/radius point, but semantically it also belongs to the
  // visible host circle. Preserve that ownership edge so deleting the circle
  // can cascade to its gliders instead of leaving detached look-alikes.
  for (const point of scene.points.values()) {
    const constraint = point.constraint;
    if (constraint?.kind !== 'circle') continue;
    const host = scene.elements.find((element) => (
      element.kind === 'circle'
      && element.refs[0] === constraint.centerName
      && (
        constraint.throughName
          ? element.refs[1] === constraint.throughName
          : constraint.radius !== null
            && Math.abs(element.radius - constraint.radius) <= 1e-9
      )
    ));
    if (!host) continue;
    const hostStatement = statementNodeId(host.stmtIndex);
    const pointNode = pointNodeId(point.name);
    if (nodes.has(hostStatement) && nodes.has(pointNode)) {
      addEdge(nodes, hostStatement, pointNode);
      nodes.get(pointNode)?.refs.add(host.stableId);
    }
  }

  return immutableGraph(nodes);
}

/** Backwards-friendly alias for callers that call the index a dependency graph. */
export const buildDeletionDependencyIndex = buildDeletionDependencyGraph;

function candidateNodeIds(graph: DeletionDependencyGraph, target: DeleteTarget): string[] {
  if (typeof target === 'string') {
    if (graph.nodes.has(target)) return [target];
    const byStable = graph.byStableId.get(target);
    if (byStable?.length) return [...byStable];
    const byName = graph.nodes.has(pointNodeId(target)) ? pointNodeId(target) : null;
    return byName ? [byName] : [];
  }
  if (target.stableId) {
    const byStable = graph.byStableId.get(target.stableId) ?? [];
    if (byStable.length) return [...byStable];
  }
  if (target.stmtIndex !== null && target.stmtIndex !== undefined) {
    const id = graph.byStmtIndex.get(target.stmtIndex);
    if (id) return [id];
  }
  return [];
}

export function resolveDeleteTarget(
  graph: DeletionDependencyGraph,
  target: DeleteTarget,
): ResolvedDeleteTarget | null {
  const candidates = candidateNodeIds(graph, target);
  if (candidates.length !== 1) return null;
  const node = graph.nodes.get(candidates[0]);
  return node ? { target, node } : null;
}

function intersects(left: Iterable<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function pointPositions(scene: Scene): Map<string, Pt> {
  return new Map([...scene.points].map(([name, point]) => [name, point.position]));
}

function literalForCoord(coord: CoordExpr, points: Map<string, Pt>): string | null {
  try {
    const value = evalCoord(coord, { points });
    return `(${formatCoordNumber(value.x)},${formatCoordNumber(value.y)})`;
  } catch {
    return null;
  }
}

function pushCoordDetachPatch(
  patches: TextPatch[],
  coord: CoordExpr,
  removedPoints: Set<string>,
  points: Map<string, Pt>,
  stmtIndex: number,
  unsupported: Array<{ stmtIndex: number; reason: string }>,
): void {
  const refs = collectCoordRefs(coord);
  if (!intersects(refs, removedPoints)) return;
  const insert = literalForCoord(coord, points);
  if (!insert) {
    unsupported.push({ stmtIndex, reason: `无法将坐标表达式 ${coord.range.start}..${coord.range.end} 冻结为字面量` });
    return;
  }
  patches.push({ from: coord.range.start, to: coord.range.end, insert });
}

function buildDetachPatches(
  scene: Scene,
  statements: readonly Statement[],
  dependentStmtIndices: readonly number[],
  removedPoints: Set<string>,
  removedPaths: Set<string>,
): DetachResult {
  const patches: TextPatch[] = [];
  const unsupported: Array<{ stmtIndex: number; reason: string }> = [];
  const points = pointPositions(scene);
  for (const stmtIndex of dependentStmtIndices) {
    const statement = statements[stmtIndex];
    if (!statement) continue;
    if (statement.kind === 'coordinate') {
      pushCoordDetachPatch(patches, statement.at, removedPoints, points, stmtIndex, unsupported);
    } else if (statement.kind === 'let-coordinate') {
      for (const binding of statement.bindings) {
        if (binding.type === 'point') {
          pushCoordDetachPatch(patches, binding.value, removedPoints, points, stmtIndex, unsupported);
        }
      }
      pushCoordDetachPatch(patches, statement.at, removedPoints, points, stmtIndex, unsupported);
    } else if (statement.kind === 'path') {
      for (const spec of statement.specs) {
        if (spec.type === 'polyline') {
          for (const point of spec.points) {
            pushCoordDetachPatch(patches, point, removedPoints, points, stmtIndex, unsupported);
          }
        } else if (spec.type === 'rectangle') {
          pushCoordDetachPatch(patches, spec.first, removedPoints, points, stmtIndex, unsupported);
          pushCoordDetachPatch(patches, spec.opposite, removedPoints, points, stmtIndex, unsupported);
        } else if (spec.type === 'cubic-bezier') {
          for (const point of [spec.start, spec.control1, spec.control2, spec.end]) {
            pushCoordDetachPatch(patches, point, removedPoints, points, stmtIndex, unsupported);
          }
        } else if (spec.type === 'circular-arc') {
          pushCoordDetachPatch(patches, spec.start, removedPoints, points, stmtIndex, unsupported);
        } else if (spec.type === 'ellipse') {
          pushCoordDetachPatch(patches, spec.center, removedPoints, points, stmtIndex, unsupported);
        } else {
          pushCoordDetachPatch(patches, spec.center, removedPoints, points, stmtIndex, unsupported);
          if (spec.radius.kind === 'through') {
            pushCoordDetachPatch(patches, spec.radius.point, removedPoints, points, stmtIndex, unsupported);
          }
        }
      }
      if (statement.intersections && statement.intersections.of.some((path) => removedPaths.has(path))) {
        unsupported.push({ stmtIndex, reason: '交点语句依赖被删除的命名路径，无法在不改变语义的情况下 detach' });
      }
    } else if (statement.kind === 'node') {
      pushCoordDetachPatch(patches, statement.at, removedPoints, points, stmtIndex, unsupported);
    } else if (statement.kind === 'pic' && statement.points.some((point) => removedPoints.has(point))) {
      unsupported.push({ stmtIndex, reason: 'pic 的点引用没有可安全写回的坐标槽位' });
    }
  }
  return {
    patches,
    detachedStatementIndices: [...new Set(dependentStmtIndices)].sort((a, b) => a - b),
    unsupported,
  };
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function statementPatches(
  source: string,
  statements: readonly Statement[],
  stmtIndices: readonly number[],
): { patches: TextPatch[]; diagnostics: DeleteDiagnostic[] } {
  const diagnostics: DeleteDiagnostic[] = [];
  const patches: TextPatch[] = [];
  for (const stmtIndex of uniqueSorted(stmtIndices)) {
    const statement = statements[stmtIndex];
    if (!statement) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-source-range',
        message: `语句 ${stmtIndex} 不存在，无法生成删除 transaction`,
        stmtIndices: [stmtIndex],
      });
      continue;
    }
    try {
      const patch = deleteStatementPatch(source, statement.range);
      assertTextPatch(source, patch);
      patches.push(patch);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-source-range',
        message: error instanceof Error ? error.message : `语句 ${stmtIndex} 的 source range 无效`,
        stmtIndices: [stmtIndex],
      });
    }
  }
  const ordered = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].from < ordered[index - 1].to) {
      diagnostics.push({
        severity: 'error',
        code: 'overlapping-patches',
        message: '删除语句的 source ranges 重叠，拒绝提交以保护源码',
      });
      return { patches: [], diagnostics };
    }
  }
  return { patches: ordered, diagnostics };
}

/**
 * Source-only deletion adapter. Dependency closure must be decided by the
 * caller; this helper only turns already-authorized statement indices into
 * validated minimal patches.
 */
export function statementDeletionPatches(
  source: string,
  statements: readonly Statement[],
  stmtIndices: readonly number[],
): { patches: TextPatch[]; diagnostics: DeleteDiagnostic[] } {
  return statementPatches(source, statements, stmtIndices);
}

function mergePatches(
  source: string,
  patches: readonly TextPatch[],
): { patches: TextPatch[]; diagnostics: DeleteDiagnostic[] } {
  const diagnostics: DeleteDiagnostic[] = [];
  const ordered = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const patch of ordered) {
    try {
      assertTextPatch(source, patch);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-source-range',
        message: error instanceof Error ? error.message : '生成了无效 source patch',
      });
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].from < ordered[index - 1].to) {
      diagnostics.push({
        severity: 'error',
        code: 'overlapping-patches',
        message: 'detach 写回与删除 range 重叠，拒绝提交以保护源码',
      });
      return { patches: [], diagnostics };
    }
    if (
      ordered[index].from === ordered[index - 1].from
      && ordered[index].to === ordered[index - 1].to
      && ordered[index].insert !== ordered[index - 1].insert
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'overlapping-patches',
        message: '多个 detach 写回命中了同一 source range',
      });
      return { patches: [], diagnostics };
    }
  }
  const deduped = ordered.filter((patch, index) => (
    index === 0
    || patch.from !== ordered[index - 1].from
    || patch.to !== ordered[index - 1].to
    || patch.insert !== ordered[index - 1].insert
  ));
  return { patches: deduped, diagnostics };
}

function previewFor(
  graph: DeletionDependencyGraph,
  mode: DeleteMode,
  rootNodeIds: Set<string>,
  removedNodeIds: Set<string>,
  detachedNodeIds: Set<string>,
  blockedNodeIds: Set<string>,
): DeletePreviewItem[] {
  const nodes = [...graph.nodes.values()].filter((node) => (
    rootNodeIds.has(node.id)
    || removedNodeIds.has(node.id)
    || detachedNodeIds.has(node.id)
    || blockedNodeIds.has(node.id)
  ));
  return nodes.sort((a, b) => (
    (a.stmtIndex ?? Number.MAX_SAFE_INTEGER) - (b.stmtIndex ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id)
  )).map((node) => ({
    nodeId: node.id,
    stableId: node.stableId,
    kind: node.kind,
    name: node.name,
    stmtIndex: node.stmtIndex,
    range: node.range,
    action: blockedNodeIds.has(node.id)
      ? 'blocked'
      : mode === 'detach' && detachedNodeIds.has(node.id)
        ? 'detach'
        : removedNodeIds.has(node.id) || rootNodeIds.has(node.id)
          ? 'delete'
          : 'keep',
    dependencies: node.dependencies,
    dependents: node.dependents,
  }));
}

export function planDeletion(input: DeletePlanInput): DeletePlan;
export function planDeletion(
  source: string,
  scene: Scene,
  statements: readonly Statement[],
  targets: DeleteTarget | readonly DeleteTarget[],
  mode?: DeleteMode,
): DeletePlan;
export function planDeletion(
  first: DeletePlanInput | string,
  sceneArg?: Scene,
  statementsArg?: readonly Statement[],
  targetsArg?: DeleteTarget | readonly DeleteTarget[],
  modeArg: DeleteMode = 'block',
): DeletePlan {
  const input: DeletePlanInput = typeof first === 'string'
    ? {
      source: first,
      scene: sceneArg!,
      statements: statementsArg ?? [],
      targets: targetsArg ?? [],
      mode: modeArg,
    }
    : first;
  const statements = input.statements;
  const requested = Array.isArray(input.targets) ? [...input.targets] : [input.targets];
  const graph = buildDeletionDependencyGraph(input.scene, statements);
  const diagnostics: DeleteDiagnostic[] = [];
  const resolved: ResolvedDeleteTarget[] = [];
  const rootNodeIds = new Set<string>();

  for (const target of requested) {
    const candidates = candidateNodeIds(graph, target);
    if (candidates.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'target-not-found',
        message: typeof target === 'string'
          ? `找不到删除目标 ${target}`
          : `找不到 stableId=${target.stableId ?? '∅'} / stmtIndex=${target.stmtIndex ?? '∅'}`,
      });
      continue;
    }
    if (candidates.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'target-ambiguous',
        message: '删除目标 stableId 对应多个实体，拒绝猜测',
        nodeIds: candidates,
      });
      continue;
    }
    const node = graph.nodes.get(candidates[0]);
    if (!node) continue;
    if (
      typeof target !== 'string'
      && target.stableId
      && node.stableId
      && target.stableId !== node.stableId
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'target-mismatch',
        message: 'stableId 与 stmtIndex 指向不同实体，拒绝生成 transaction',
        nodeIds: [node.id],
      });
      continue;
    }
    if (
      typeof target !== 'string'
      && target.stmtIndex !== null
      && target.stmtIndex !== undefined
      && node.stmtIndex !== null
      && target.stmtIndex !== node.stmtIndex
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'target-mismatch',
        message: 'stableId 与 stmtIndex 指向不同 source 语句，拒绝生成 transaction',
        nodeIds: [node.id],
      });
      continue;
    }
    if (rootNodeIds.has(node.id)) {
      diagnostics.push({
        severity: 'info',
        code: 'duplicate-target',
        message: `删除目标 ${node.id} 重复，已合并`,
        nodeIds: [node.id],
      });
      continue;
    }
    rootNodeIds.add(node.id);
    resolved.push({ target, node });
  }

  const rootStmtIndices = new Set(
    [...rootNodeIds]
      .map((id) => graph.nodes.get(id)?.stmtIndex)
      .filter((value): value is number => value !== null && value !== undefined),
  );
  const managedGroups = managedConstructionStatementGroups(input.source, statements);
  const rootManagedGroups = managedGroups.filter((group) => (
    group.statementIndices.some((stmtIndex) => rootStmtIndices.has(stmtIndex))
  ));
  for (const group of rootManagedGroups) {
    for (const stmtIndex of group.statementIndices) rootStmtIndices.add(stmtIndex);
  }
  const managedDetachBlocked = input.mode === 'detach' && rootManagedGroups.length > 0;
  if (managedDetachBlocked) {
    diagnostics.push({
      severity: 'error',
      code: 'detach-unsupported',
      message: '受管构造是原子事务，不能只分离或删除其中一条语句；请删除整个构造。',
      stmtIndices: uniqueSorted(rootManagedGroups.flatMap((group) => group.statementIndices)),
    });
  }
  // A stable id may point at one rendered element inside a statement that also
  // defines a named path or several intersection points. Source deletion is
  // statement-granular, so include each owning statement in the closure before
  // expanding dependents. Managed construction blocks are source transactions,
  // so every statement in a selected block becomes an atomic source root.
  const sourceRootNodeIds = new Set(rootNodeIds);
  for (const stmtIndex of rootStmtIndices) {
    const statementId = graph.byStmtIndex.get(stmtIndex);
    if (statementId) sourceRootNodeIds.add(statementId);
  }
  const affectedNodeIds = new Set(sourceRootNodeIds);
  const allDescendants = new Set<string>();
  for (const root of sourceRootNodeIds) {
    for (const id of graph.descendants.get(root) ?? []) {
      affectedNodeIds.add(id);
      allDescendants.add(id);
    }
  }
  if (input.mode === 'cascade') {
    let changed = true;
    while (changed) {
      changed = false;
      const affectedStatementIndices = new Set(
        [...affectedNodeIds]
          .map((id) => graph.nodes.get(id)?.stmtIndex)
          .filter((value): value is number => value !== null && value !== undefined),
      );
      for (const group of managedGroups) {
        if (!group.statementIndices.some((stmtIndex) => affectedStatementIndices.has(stmtIndex))) {
          continue;
        }
        for (const stmtIndex of group.statementIndices) {
          for (const node of graph.nodes.values()) {
            if (node.stmtIndex !== stmtIndex || affectedNodeIds.has(node.id)) continue;
            affectedNodeIds.add(node.id);
            allDescendants.add(node.id);
            changed = true;
            for (const descendant of graph.descendants.get(node.id) ?? []) {
              if (!affectedNodeIds.has(descendant)) changed = true;
              affectedNodeIds.add(descendant);
              allDescendants.add(descendant);
            }
          }
        }
      }
    }
  }

  const blockedNodeIds = new Set<string>();
  if (input.mode === 'block') {
    for (const id of allDescendants) {
      const node = graph.nodes.get(id);
      if (!node || node.stmtIndex === null || rootStmtIndices.has(node.stmtIndex)) continue;
      blockedNodeIds.add(id);
    }
    if (blockedNodeIds.size > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'blocked-by-dependents',
        message: `删除被 ${blockedNodeIds.size} 个下游对象阻止；可改用 cascade 或确认 detach`,
        nodeIds: [...blockedNodeIds],
        stmtIndices: uniqueSorted([...blockedNodeIds].map((id) => graph.nodes.get(id)?.stmtIndex ?? -1).filter((n) => n >= 0)),
      });
    }
  }

  const removedNodeIds = new Set<string>();
  const detachedNodeIds = new Set<string>();
  let removedStatementIndices: number[] = [];
  let detachedStatementIndices: number[] = [];
  let patches: TextPatch[] = [];

  if (input.mode === 'cascade' || (input.mode === 'block' && blockedNodeIds.size === 0)) {
    for (const id of affectedNodeIds) {
      if (input.mode === 'block' && blockedNodeIds.has(id)) continue;
      removedNodeIds.add(id);
    }
    removedStatementIndices = uniqueSorted(
      [...removedNodeIds]
        .map((id) => graph.nodes.get(id)?.stmtIndex)
        .filter((value): value is number => value !== null && value !== undefined),
    );
    const result = statementPatches(input.source, statements, removedStatementIndices);
    patches = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? []
      : expandManagedConstructionDeletions(input.source, result.patches);
    diagnostics.push(...result.diagnostics);
  } else if (input.mode === 'detach' && !managedDetachBlocked) {
    const removedPoints = new Set<string>();
    const removedPaths = new Set<string>();
    for (const root of sourceRootNodeIds) {
      const node = graph.nodes.get(root);
      if (!node) continue;
      if (node.kind === 'point' && node.name) removedPoints.add(node.name);
      if (node.kind === 'path' && node.name) removedPaths.add(node.name);
      if (node.kind === 'statement' && node.stmtIndex !== null) {
        for (const candidate of graph.nodes.values()) {
          if (candidate.stmtIndex !== node.stmtIndex) continue;
          if (candidate.kind === 'point' && candidate.name) removedPoints.add(candidate.name);
          if (candidate.kind === 'path' && candidate.name) removedPaths.add(candidate.name);
        }
      }
    }
    for (const id of allDescendants) {
      const node = graph.nodes.get(id);
      if (!node || node.stmtIndex === null || rootStmtIndices.has(node.stmtIndex)) continue;
      detachedNodeIds.add(id);
    }
    detachedStatementIndices = uniqueSorted(
      [...detachedNodeIds]
        .map((id) => graph.nodes.get(id)?.stmtIndex)
        .filter((value): value is number => value !== null && value !== undefined),
    );
    const detachResult = buildDetachPatches(
      input.scene,
      statements,
      detachedStatementIndices,
      removedPoints,
      removedPaths,
    );
    if (detachResult.unsupported.length > 0) {
      for (const unsupported of detachResult.unsupported) {
        diagnostics.push({
          severity: 'error',
          code: 'detach-unsupported',
          message: `语句 ${unsupported.stmtIndex}: ${unsupported.reason}`,
          stmtIndices: [unsupported.stmtIndex],
        });
      }
    }
    const rootPatches = statementPatches(input.source, statements, [...rootStmtIndices]);
    diagnostics.push(...rootPatches.diagnostics);
    const merged = mergePatches(input.source, [...detachResult.patches, ...rootPatches.patches]);
    diagnostics.push(...merged.diagnostics);
    patches = merged.patches;
    removedStatementIndices = uniqueSorted(rootStmtIndices);
    for (const id of sourceRootNodeIds) removedNodeIds.add(id);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) patches = [];
  }

  if (requested.length === 0) {
    diagnostics.push({ severity: 'error', code: 'no-op', message: '没有提供删除目标' });
  } else if (resolved.length === 0 && !diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    diagnostics.push({ severity: 'error', code: 'no-op', message: '没有可删除的源码实体' });
  }

  const preview = previewFor(graph, input.mode, rootNodeIds, removedNodeIds, detachedNodeIds, blockedNodeIds);
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    mode: input.mode,
    graph,
    requested,
    resolved,
    rootNodeIds: [...rootNodeIds],
    sourceRootNodeIds: [...sourceRootNodeIds],
    affectedNodeIds: [...affectedNodeIds],
    removedNodeIds: [...removedNodeIds],
    detachedNodeIds: [...detachedNodeIds],
    blockedNodeIds: [...blockedNodeIds],
    removedStatementIndices,
    detachedStatementIndices,
    patches: hasErrors ? [] : patches,
    diagnostics,
    preview,
    canApply: !hasErrors && patches.length > 0,
  };
}

export const createDeletePlan = planDeletion;

// Keep SceneElement in the module's public type graph for consumers that import
// the helper's related entity types while still avoiding a runtime dependency.
export type DeletableSceneElement = SceneElement;
