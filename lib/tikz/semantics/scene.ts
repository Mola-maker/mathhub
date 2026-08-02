import type {
  CalcExpr,
  CircleRadius,
  CoordExpr,
  NumExpr,
  SourceRange,
  Statement,
} from '../../tikz/subset/ast';
import { buildDependencyGraph } from './dependency-graph';
import { evalCoord, evalNum, EvalError, type Pt, type EvalEnvs } from './calc-eval';
import { intersectPaths, type GeomPath } from './intersections';
import { collectCoordRefs } from '../../tikz/subset/static-check';
import { resolveStyle, anchorFromRaw, type ResolvedStyle } from '../render/style-resolver';

export interface ScenePoint {
  stableId: string;
  name: string;
  /** Writer-owned helper points are not direct canvas interaction targets. */
  internal?: boolean;
  position: Pt;
  free: boolean;
  dependsOn: string[];
  stmtIndex: number;
  constraint?: {
    kind: 'circle';
    centerName: string;
    throughName: string | null;
    radius: number | null;
    angleDeg: number;
    angleRanges: readonly SourceRange[];
  };
}
interface Base { stableId: string; stmtIndex: number; refs: string[]; style: ResolvedStyle }
export type SceneCircleDefinition =
  | {
    kind: 'center-through';
    centerName: string;
    throughName: string;
  }
  | {
    kind: 'center-radius';
    centerName: string;
    radius: number;
  };
export type SceneElement =
  | (Base & { kind: 'polyline'; points: Pt[]; cycle: boolean })
  | (Base & {
    kind: 'circle';
    center: Pt;
    radius: number;
    /**
     * Typed, source-derived construction roles. This is deliberately absent
     * for calculated centers/radii: `refs` is only a dependency set and must
     * never be reinterpreted as center/through semantics.
     */
    definition: SceneCircleDefinition | null;
  })
  | (Base & { kind: 'label'; at: Pt; text: string; anchor: string })
  | (Base & { kind: 'angle-mark'; vertex: Pt; from: Pt; to: Pt; right: boolean });
export interface SceneIssue { stmtIndex: number; message: string; kind: 'unknown-ref' | 'cycle' | 'degenerate' | 'eval' }
export interface Scene {
  sourceRevision: number;
  points: Map<string, ScenePoint>;
  elements: SceneElement[];
  issues: SceneIssue[];
  graphOrder: string[];
}

function stmtOfPoint(stmts: Statement[], name: string): { stmt: Statement; idx: number } | null {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.kind === 'coordinate' && s.name === name) return { stmt: s, idx: i };
    if (s.kind === 'let-coordinate' && s.name === name) return { stmt: s, idx: i };
  }
  return null;
}

function directPointRef(expr: CalcExpr): string | null {
  return expr.op === 'coord' && expr.coord.kind === 'ref'
    ? expr.coord.name
    : null;
}

function directCoordPointRef(expr: CoordExpr): string | null {
  return expr.kind === 'ref' ? expr.name : null;
}

function circleDefinitionOf(
  center: CoordExpr,
  radius: CircleRadius,
): SceneCircleDefinition | null {
  const centerName = directCoordPointRef(center);
  if (!centerName) return null;
  if (radius.kind === 'literal') {
    return Number.isFinite(radius.value) && radius.value > 0
      ? { kind: 'center-radius', centerName, radius: radius.value }
      : null;
  }
  const throughName = directCoordPointRef(radius.point);
  return throughName
    ? { kind: 'center-through', centerName, throughName }
    : null;
}

function polarTerm(
  value: number | NumExpr,
  fn: 'sin' | 'cos',
): { radius: number; angleDeg: number; angleRange: SourceRange } | null {
  if (typeof value === 'number' || value.kind !== 'num-bin' || value.binop !== '*') {
    return null;
  }
  const pairs = [
    [value.left, value.right],
    [value.right, value.left],
  ] as const;
  for (const [radius, call] of pairs) {
    if (
      radius.kind === 'num-lit'
      && call.kind === 'num-call'
      && call.fn === fn
      && call.arg.kind === 'num-lit'
    ) {
      return {
        radius: radius.value,
        angleDeg: call.arg.value,
        angleRange: call.arg.range,
      };
    }
  }
  return null;
}

function circleConstraintOf(at: CoordExpr): ScenePoint['constraint'] | undefined {
  if (at.kind !== 'calc') return undefined;
  if (at.expr.op === 'rotate') {
    const centerName = directPointRef(at.expr.a);
    const throughName = directPointRef(at.expr.b);
    if (
      !centerName
      || !throughName
      || at.expr.t.kind !== 'num-lit'
      || Math.abs(at.expr.t.value - 1) > 1e-9
      || at.expr.angleDeg.kind !== 'num-lit'
    ) {
      return undefined;
    }
    return {
      kind: 'circle',
      centerName,
      throughName,
      radius: null,
      angleDeg: at.expr.angleDeg.value,
      angleRanges: [at.expr.angleDeg.range],
    };
  }
  if (at.expr.op !== 'add') return undefined;
  const centerName = directPointRef(at.expr.left);
  const offset = at.expr.right.op === 'coord'
    ? at.expr.right.coord
    : null;
  if (!centerName || offset?.kind !== 'literal') return undefined;
  const x = polarTerm(offset.x, 'cos');
  const y = polarTerm(offset.y, 'sin');
  if (
    !x
    || !y
    || x.radius <= 0
    || Math.abs(x.radius - y.radius) > 1e-9
    || Math.abs(x.angleDeg - y.angleDeg) > 1e-9
  ) return undefined;
  return {
    kind: 'circle',
    centerName,
    throughName: null,
    radius: x.radius,
    angleDeg: x.angleDeg,
    angleRanges: [x.angleRange, y.angleRange],
  };
}

function stmtOfPath(stmts: Statement[], name: string): { stmt: Statement; idx: number } | null {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.kind === 'path' && s.namePath === name) return { stmt: s, idx: i };
  }
  return null;
}

function stmtOfIntersectionBinding(stmts: Statement[], pointName: string): { stmt: Statement; idx: number; bindingIndex: number } | null {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.kind === 'path' && s.intersections) {
      const b = s.intersections.bindings.findIndex(bi => bi.name === pointName);
      if (b >= 0) return { stmt: s, idx: i, bindingIndex: b };
    }
  }
  return null;
}

export function evaluateScene(stmts: Statement[], sourceRevision = 0): Scene {
  const issues: SceneIssue[] = [];
  const graph = buildDependencyGraph(stmts);

  if (graph.cycle) {
    issues.push({
      stmtIndex: -1,
      message: `构造存在环依赖: ${graph.cycle.join(' → ')}`,
      kind: 'cycle',
    });
    return { sourceRevision, points: new Map(), elements: [], issues, graphOrder: [] };
  }

  const points = new Map<string, ScenePoint>();
  const pathEnv = new Map<string, GeomPath>();
  const ptEnv = (): Map<string, Pt> => new Map([...points].map(([n, p]) => [n, p.position]));

  // 1. evaluate points and path geometries in topological order
  for (const id of graph.order) {
    if (id.startsWith('path:')) {
      const pathName = id.slice(5);
      const found = stmtOfPath(stmts, pathName);
      if (!found) continue;
      const s = found.stmt;
      if (s.kind !== 'path' || !s.specs.length) continue;
      // take first spec as path geometry (intersections require named geometry)
      const spec = s.specs[0];
      try {
        const env: EvalEnvs = { points: ptEnv() };
        if (spec.type === 'polyline') {
          const pts: Pt[] = [];
          for (const c of spec.points) pts.push(evalCoord(c, env));
          pathEnv.set(pathName, { type: 'poly', points: pts, closed: spec.cycle });
        } else if (spec.type === 'circle') {
          const center = evalCoord(spec.center, env);
          let radius: number;
          if (spec.radius.kind === 'literal') radius = spec.radius.value;
          else {
            const throughPt = evalCoord(spec.radius.point, env);
            radius = Math.hypot(throughPt.x - center.x, throughPt.y - center.y);
          }
          pathEnv.set(pathName, { type: 'circle', center, radius });
        }
      } catch (e) {
        if (e instanceof EvalError) {
          issues.push({ stmtIndex: found.idx, message: e.message, kind: e.code });
        }
      }
      continue;
    }

    // named point via coordinate / let-coordinate / intersection binding
    let found = stmtOfPoint(stmts, id);
    let isIntersectionBinding = false;
    let bindingIdx = 0;
    if (!found) {
      const ib = stmtOfIntersectionBinding(stmts, id);
      if (ib) {
        found = { stmt: ib.stmt, idx: ib.idx };
        isIntersectionBinding = true;
        bindingIdx = ib.bindingIndex;
      } else {
        continue;
      }
    }
    const s = found.stmt;

    if (isIntersectionBinding) {
      if (s.kind !== 'path' || !s.intersections) continue;
      const binding = s.intersections.bindings[bindingIdx];
      const g0 = pathEnv.get(s.intersections.of[0]);
      const g1 = pathEnv.get(s.intersections.of[1]);
      if (!g0 || !g1) {
        issues.push({ stmtIndex: found.idx, message: `交点 ${binding.name} 的依赖路径未就绪`, kind: 'unknown-ref' });
        continue;
      }
      const hits = intersectPaths(g1, g0); // poly-as-first for predictable ordering along the polyline
      const want = hits[binding.index - 1];
      if (!want) {
        issues.push({ stmtIndex: found.idx, message: `第 ${binding.index} 个交点不存在`, kind: 'degenerate' });
        continue;
      }
      const deps: string[] = [];
      if (g0.type === 'poly') for (const _ of g0.points) void _;
      if (g0.type === 'poly') for (const _ of g0.points) void _;
      deps.push(`path:${s.intersections.of[0]}`, `path:${s.intersections.of[1]}`);
      points.set(id, {
        stableId: `point:${id}`,
        name: id,
        internal: id.startsWith('mg-'),
        position: want,
        free: false,
        dependsOn: deps,
        stmtIndex: found.idx,
      });
      continue;
    }

    if (s.kind === 'coordinate') {
      try {
        const env: EvalEnvs = { points: ptEnv() };
        const pos = evalCoord(s.at, env);
        const constraint = circleConstraintOf(s.at);
        points.set(id, {
          stableId: `point:${id}`,
          name: id,
          internal: id.startsWith('mg-'),
          position: pos,
          free: s.at.kind === 'literal',
          dependsOn: collectCoordRefs(s.at),
          stmtIndex: found.idx,
          constraint,
        });
      } catch (e) {
        if (e instanceof EvalError) issues.push({ stmtIndex: found.idx, message: e.message, kind: e.code });
      }
    } else if (s.kind === 'let-coordinate') {
      try {
        const pvars = new Map<string, Pt>();
        const nvars = new Map<string, number>();
        for (const b of s.bindings) {
          if (b.type === 'point') {
            pvars.set(b.name, evalCoord(b.value, { points: ptEnv() }));
          } else {
            nvars.set(b.name, evalNum(b.value, { points: ptEnv(), pvars, nvars }));
          }
        }
        const env: EvalEnvs = { points: ptEnv(), pvars, nvars };
        const pos = evalCoord(s.at, env);
        const deps: string[] = [];
        for (const b of s.bindings) if (b.type === 'point') deps.push(...collectCoordRefs(b.value));
        deps.push(...collectCoordRefs(s.at));
        points.set(id, {
          stableId: `point:${id}`,
          name: id,
          internal: id.startsWith('mg-'),
          position: pos,
          free: false,
          dependsOn: deps,
          stmtIndex: found.idx,
        });
      } catch (e) {
        if (e instanceof EvalError) issues.push({ stmtIndex: found.idx, message: e.message, kind: e.code });
      }
    }
  }

  // 2. emit elements (in statement order)
  const elements: SceneElement[] = [];
  stmts.forEach((s, idx) => {
    if (s.kind === 'path' && s.specs.length > 0 && (s.command === 'draw' || s.command === 'fill' || s.command === 'filldraw')) {
      const style = resolveStyle(s.options?.raw ?? null, s.command);
      for (const spec of s.specs) {
        try {
          const env: EvalEnvs = { points: ptEnv() };
          if (spec.type === 'polyline') {
            const pts = spec.points.map(c => evalCoord(c, env));
            const refs: string[] = [];
            for (const p of spec.points) refs.push(...collectCoordRefs(p));
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'polyline',
              points: pts,
              cycle: spec.cycle,
              stmtIndex: idx,
              refs,
              style,
            });
          } else {
            const center = evalCoord(spec.center, env);
            let radius: number;
            if (spec.radius.kind === 'literal') radius = spec.radius.value;
            else {
              const tp = evalCoord(spec.radius.point, env);
              radius = Math.hypot(tp.x - center.x, tp.y - center.y);
            }
            const refs: string[] = [];
            refs.push(...collectCoordRefs(spec.center));
            if (spec.radius.kind === 'through') refs.push(...collectCoordRefs(spec.radius.point));
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'circle',
              center,
              radius,
              definition: circleDefinitionOf(spec.center, spec.radius),
              stmtIndex: idx,
              refs,
              style,
            });
          }
        } catch (e) {
          if (e instanceof EvalError) issues.push({ stmtIndex: idx, message: e.message, kind: e.code });
        }
      }
    } else if (s.kind === 'node') {
      try {
        const env: EvalEnvs = { points: ptEnv() };
        const at = evalCoord(s.at, env);
        const refs = collectCoordRefs(s.at);
        const anchor = anchorFromRaw(s.options?.raw ?? null);
        elements.push({
          stableId: `element:${idx}:${elements.length}`,
          kind: 'label',
          at,
          text: s.text,
          anchor,
          stmtIndex: idx,
          refs,
          style: resolveStyle(s.options?.raw ?? null, 'node'),
        });
      } catch (e) {
        if (e instanceof EvalError) issues.push({ stmtIndex: idx, message: e.message, kind: e.code });
      }
    } else if (s.kind === 'pic') {
      try {
        const refPts: { [k: string]: Pt } = {};
        for (const r of s.points) {
          const p = points.get(r);
          if (!p) throw new EvalError(`未定义的点 '${r}'`, 'unknown-ref');
          refPts[r] = p.position;
        }
        elements.push({
          stableId: `element:${idx}:${elements.length}`,
          kind: 'angle-mark', vertex: refPts[s.points[1]], from: refPts[s.points[0]], to: refPts[s.points[2]],
          right: s.picType === 'right-angle',
          stmtIndex: idx, refs: [...s.points], style: resolveStyle(s.options?.raw ?? null, 'pic'),
        });
      } catch (e) {
        if (e instanceof EvalError) issues.push({ stmtIndex: idx, message: e.message, kind: e.code });
      }
    }
  });

  return { sourceRevision, points, elements, issues, graphOrder: graph.order };
}
