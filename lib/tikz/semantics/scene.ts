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
import { parseTikzOptionSequence } from '../syntax/option-sequence';
import { circularArcFromStart } from '../geometry/circular-arc';
import { affineEllipseAxes } from '../geometry/ellipse';
import {
  ellipticalArcFromStart,
  ellipticalArcPoint,
} from '../geometry/elliptical-arc';
import {
  applyTikzCoordinateTransform,
  isTikzCoordinateTransformSimilarity,
  tikzCoordinateTransformRotationDegrees,
  tikzCoordinateTransformScale,
  type TikzCoordinateTransform,
} from '../subset/coordinate-transform';
import {
  layoutStaticGraph,
  type GraphLayoutFidelity,
  type GraphLayoutIntent,
  type StaticGraphLayout,
} from './graph-layout';

export interface ScenePoint {
  stableId: string;
  name: string;
  /** Writer-owned helper points are not direct canvas interaction targets. */
  internal?: boolean;
  position: Pt;
  free: boolean;
  dependsOn: string[];
  stmtIndex: number;
  /** False for projected library products without a proven source writer. */
  writable?: boolean;
  coordinateTransform?: TikzCoordinateTransform;
  definition?: ScenePointDefinition;
  constraint?: {
    kind: 'circle';
    centerName: string;
    throughName: string | null;
    radius: number | null;
    angleDeg: number;
    angleRanges: readonly SourceRange[];
  };
}
export type ScenePointDefinition =
  | {
    kind: 'interpolate';
    startName: string;
    endName: string;
    t: number;
  }
  | {
    kind: 'perpendicular-foot';
    pointName: string;
    lineStartName: string;
    lineEndName: string;
  }
  | {
    kind: 'rotate';
    centerName: string;
    pointName: string;
    scale: number;
    angleDegrees: number;
  }
  | {
    kind: 'reference';
    pointName: string;
  };
interface Base {
  stableId: string;
  stmtIndex: number;
  refs: string[];
  style: ResolvedStyle;
  coordinateTransform?: TikzCoordinateTransform;
  /** False for projected library products without a proven source writer. */
  writable?: boolean;
}
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
export type SceneEllipseParameterSources =
  | {
    sourceKind: 'ellipse';
    xRadius: { range: SourceRange; value: number };
    yRadius: { range: SourceRange; value: number };
    /** Present only when the CTM has one uniform length scale. */
    coordinateScale: number | null;
    /** Present only when the CTM has one world rotation. */
    coordinateRotationDegrees: number | null;
    coordinateTransformSimilarity: boolean;
    /** Reversible path-local `rotate=<number>` slot; scope rotation is not rewritten here. */
    localRotation: { range: SourceRange; value: number } | null;
  }
  | {
    /** A source `circle (<literal>)` whose affine image is an ellipse. */
    sourceKind: 'circle';
    radius: { range: SourceRange; value: number };
    coordinateScale: null;
    coordinateRotationDegrees: null;
    coordinateTransformSimilarity: false;
    localRotation: { range: SourceRange; value: number } | null;
  };
export type SceneElement =
  | (Base & {
    kind: 'polyline';
    points: Pt[];
    cycle: boolean;
    /** Lossless source operator needed to gate transforms that change axes. */
    sourcePathOperator?: 'polyline' | 'rectangle';
    /**
     * Source provenance parallel to `points`. A coordinate reference is an
     * existing named point; literal/calc coordinates are anonymous geometry
     * and must never be promoted to named entities by AI consumers.
     */
    pointOrigins?: ({ kind: 'named'; name: string } | { kind: 'literal' } | { kind: 'expression' })[];
  })
  | (Base & {
    kind: 'cubic-bezier';
    start: Pt;
    control1: Pt;
    control2: Pt;
    end: Pt;
    /** Source provenance for start, control1, control2, and end, in order. */
    pointOrigins: ({ kind: 'named'; name: string } | { kind: 'literal' } | { kind: 'expression' })[];
  })
  | (Base & {
    kind: 'circular-arc'; center: Pt; radius: number;
    startAngleDeg: number; endAngleDeg: number; start: Pt; end: Pt;
    /** Exact TikZ numeric slots plus the enclosing coordinate projection. */
    parameterSources: {
      startAngle: { range: SourceRange; value: number };
      endAngle: { range: SourceRange; value: number };
      radius: { range: SourceRange; value: number };
      coordinateScale: number;
      coordinateRotationDegrees: number;
    };
  })
  | (Base & {
    /** Exact affine image of a source TikZ circular arc. */
    kind: 'elliptical-arc';
    center: Pt;
    axisX: Pt;
    axisY: Pt;
    startAngleDeg: number;
    endAngleDeg: number;
    start: Pt;
    end: Pt;
    /** Canonical world ellipse axes for UI/AI descriptions. */
    xRadius: number;
    yRadius: number;
    rotationDegrees: number;
    parameterSources: {
      sourceKind: 'circular-arc';
      startAngle: { range: SourceRange; value: number };
      endAngle: { range: SourceRange; value: number };
      radius: { range: SourceRange; value: number };
      coordinateTransformSimilarity: false;
    };
  })
  | (Base & {
    kind: 'ellipse'; center: Pt; xRadius: number; yRadius: number;
    /** Counter-clockwise world-space rotation inherited from the TikZ CTM. */
    rotationDegrees: number;
    parameterSources: SceneEllipseParameterSources;
  })
  | (Base & {
    kind: 'circle';
    center: Pt;
    radius: number;
    /** Exact source slot for a literal radius, if the subset can rewrite it. */
    radiusSource: {
      range: SourceRange;
      value: number;
      coordinateScale: number;
    } | null;
    /**
     * Typed, source-derived construction roles. This is deliberately absent
     * for calculated centers/radii: `refs` is only a dependency set and must
     * never be reinterpreted as center/through semantics.
     */
    definition: SceneCircleDefinition | null;
  })
  | (Base & {
    /** Presentation node produced by the official TikZ graphs library. */
    kind: 'graph-node';
    center: Pt;
    radius: number;
    text: string;
    outlined: boolean;
    /** Canvas projection intent; never a claim of Lua graphdrawing equality. */
    layoutIntent: GraphLayoutIntent;
    layoutAlgorithm: string | null;
    layoutFidelity: GraphLayoutFidelity;
    exactCompilerRequired: boolean;
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

function rectanglePoints(first: Pt, opposite: Pt): [Pt, Pt, Pt, Pt] {
  return [
    first,
    { x: opposite.x, y: first.y },
    opposite,
    { x: first.x, y: opposite.y },
  ];
}

function stmtOfPoint(stmts: Statement[], name: string): { stmt: Statement; idx: number } | null {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.kind === 'coordinate' && s.name === name) return { stmt: s, idx: i };
    if (s.kind === 'let-coordinate' && s.name === name) return { stmt: s, idx: i };
    if (s.kind === 'graph' && s.nodes.some((node) => node.name === name)) {
      return { stmt: s, idx: i };
    }
  }
  return null;
}

function unwrappedOptionValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function graphOption(statement: Extract<Statement, { kind: 'graph' }>, key: string): string | null {
  const entry = statement.options?.sequence.entries
    .filter((candidate) => candidate.interpretedKey.replace(/^\/tikz\//u, '').trim().toLowerCase() === key)
    .at(-1);
  return unwrappedOptionValue(entry?.interpretedValue ?? null);
}

const graphLayoutCache = new WeakMap<object, StaticGraphLayout>();

function graphLayout(statement: Extract<Statement, { kind: 'graph' }>): StaticGraphLayout {
  const cached = graphLayoutCache.get(statement);
  if (cached) return cached;
  const layout = layoutStaticGraph(statement);
  graphLayoutCache.set(statement, layout);
  return layout;
}

function graphPositions(statement: Extract<Statement, { kind: 'graph' }>): ReadonlyMap<string, Pt> {
  return graphLayout(statement).positions;
}

function graphStyleRaw(...values: Array<string | null | undefined>): string | null {
  const entries = values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  ));
  return entries.length > 0 ? entries.join(',') : null;
}

function graphHasDraw(raw: string | null): boolean {
  if (!raw) return false;
  return parseTikzOptionSequence(raw).entries.some((entry) => (
    entry.interpretedKey.replace(/^\/tikz\//u, '').trim().toLowerCase() === 'draw'
  ));
}

function graphNodeRadius(text: string, statement: Extract<Statement, { kind: 'graph' }>): number {
  const local = Math.min(0.8, 0.34 + Math.max(0, [...text].length - 1) * 0.075);
  return local * statementScale(statement);
}

function directPointRef(expr: CalcExpr): string | null {
  return expr.op === 'coord' && expr.coord.kind === 'ref'
    ? expr.coord.name
    : null;
}

function directCoordPointRef(expr: CoordExpr): string | null {
  return expr.kind === 'ref' ? expr.name : null;
}

function coordinateOrigin(
  expr: CoordExpr,
): { kind: 'named'; name: string } | { kind: 'literal' } | { kind: 'expression' } {
  if (expr.kind === 'ref') return { kind: 'named', name: expr.name };
  if (expr.kind === 'literal') return { kind: 'literal' };
  return { kind: 'expression' };
}

function directCalcPointRef(expr: CalcExpr): string | null {
  return expr.op === 'coord' && expr.coord.kind === 'ref'
    ? expr.coord.name
    : null;
}

function pointDefinitionOf(expr: CoordExpr): ScenePointDefinition | undefined {
  if (expr.kind === 'ref') return { kind: 'reference', pointName: expr.name };
  if (expr.kind !== 'calc') return undefined;
  const calc = expr.expr;
  if (calc.op === 'interpolate' && calc.t.kind === 'num-lit') {
    const startName = directCalcPointRef(calc.a);
    const endName = directCalcPointRef(calc.b);
    return startName && endName
      ? { kind: 'interpolate', startName, endName, t: calc.t.value }
      : undefined;
  }
  if (calc.op === 'project') {
    const lineStartName = directCalcPointRef(calc.a);
    const pointName = directCalcPointRef(calc.p);
    const lineEndName = directCalcPointRef(calc.b);
    return lineStartName && pointName && lineEndName
      ? { kind: 'perpendicular-foot', pointName, lineStartName, lineEndName }
      : undefined;
  }
  if (
    calc.op === 'rotate'
    && calc.t.kind === 'num-lit'
    && calc.angleDeg.kind === 'num-lit'
  ) {
    const centerName = directCalcPointRef(calc.a);
    const pointName = directCalcPointRef(calc.b);
    return centerName && pointName
      ? {
        kind: 'rotate',
        centerName,
        pointName,
        scale: calc.t.value,
        angleDegrees: calc.angleDeg.value,
      }
      : undefined;
  }
  return undefined;
}

function circleDefinitionOf(
  center: CoordExpr,
  radius: CircleRadius,
  radiusScale = 1,
): SceneCircleDefinition | null {
  const centerName = directCoordPointRef(center);
  if (!centerName) return null;
  if (radius.kind === 'literal') {
    return Number.isFinite(radius.value) && radius.value > 0
      ? { kind: 'center-radius', centerName, radius: radius.value * radiusScale }
      : null;
  }
  const throughName = directCoordPointRef(radius.point);
  return throughName
    ? { kind: 'center-through', centerName, throughName }
    : null;
}

function evalSceneCoord(
  expr: CoordExpr,
  env: EvalEnvs,
  transform: TikzCoordinateTransform | undefined,
): Pt {
  const point = evalCoord(expr, env);
  // Official TikZ semantics: a named coordinate has already been reduced to a
  // paper position, so an enclosing coordinate transform must not apply again.
  return expr.kind === 'literal'
    ? applyTikzCoordinateTransform(transform, point)
    : point;
}

function statementScale(statement: Statement): number {
  return tikzCoordinateTransformScale(statement.coordinateTransform);
}

function statementRotation(statement: Statement): number {
  return tikzCoordinateTransformRotationDegrees(statement.coordinateTransform);
}

function localPathRotationSource(
  statement: Statement,
): { range: SourceRange; value: number } | null {
  if (statement.kind !== 'path' || !statement.options?.sequence.balanced) return null;
  const candidates = statement.options.sequence.entries.filter((entry) => (
    entry.interpretedKey.replace(/^\/tikz\//u, '').trim().toLowerCase() === 'rotate'
  ));
  if (candidates.length !== 1) return null;
  const entry = candidates[0]!;
  if (!entry.valueRange || entry.interpretedValue === null) return null;
  const value = Number(entry.interpretedValue);
  return Number.isFinite(value)
    ? { range: { ...entry.valueRange }, value }
    : null;
}

function statementStyleRaw(statement: Statement, local: string | null): string | null {
  const options = [statement.inheritedStyleRaw, local].filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  ));
  return options.length > 0 ? options.join(',') : null;
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
          for (const c of spec.points) pts.push(evalSceneCoord(c, env, s.coordinateTransform));
          pathEnv.set(pathName, { type: 'poly', points: pts, closed: spec.cycle });
        } else if (spec.type === 'rectangle') {
          const first = evalSceneCoord(spec.first, env, s.coordinateTransform);
          const opposite = evalSceneCoord(spec.opposite, env, s.coordinateTransform);
          pathEnv.set(pathName, {
            type: 'poly',
            points: rectanglePoints(first, opposite),
            closed: true,
          });
        } else if (spec.type === 'cubic-bezier') {
          pathEnv.set(pathName, {
            type: 'cubic-bezier',
            start: evalSceneCoord(spec.start, env, s.coordinateTransform),
            control1: evalSceneCoord(spec.control1, env, s.coordinateTransform),
            control2: evalSceneCoord(spec.control2, env, s.coordinateTransform),
            end: evalSceneCoord(spec.end, env, s.coordinateTransform),
          });
        } else if (spec.type === 'circular-arc') {
          // Named-path intersections currently model Euclidean circular arcs.
          // The visible affine ellipse arc is still projected below, but an
          // unequal/slanted CTM must not be misrepresented to the intersection
          // kernel as a circle.
          if (isTikzCoordinateTransformSimilarity(s.coordinateTransform)) {
            const arc = circularArcFromStart(
              evalSceneCoord(spec.start, env, s.coordinateTransform),
              spec.radius * statementScale(s),
              spec.startAngleDeg + statementRotation(s),
              spec.endAngleDeg + statementRotation(s),
            );
            pathEnv.set(pathName, { type: 'circular-arc', ...arc });
          }
        } else if (spec.type === 'ellipse') {
          // Named ellipse intersections are intentionally not projected yet.
          // The statement remains exact-renderable and the visible ellipse is
          // still emitted below, but pathEnv must not invent intersection math.
        } else if (spec.type === 'circle') {
          const center = evalSceneCoord(spec.center, env, s.coordinateTransform);
          // The intersection kernel currently stores Euclidean circles. An
          // affine image with unequal singular values is an ellipse, so keep
          // the visible conic semantic below without inventing circle
          // intersections in this compatibility path.
          if (!isTikzCoordinateTransformSimilarity(s.coordinateTransform)) {
            continue;
          }
          let radius: number;
          if (spec.radius.kind === 'literal') radius = spec.radius.value * statementScale(s);
          else {
            const throughPt = evalSceneCoord(spec.radius.point, env, s.coordinateTransform);
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

    if (s.kind === 'graph') {
      const position = graphPositions(s).get(id);
      if (!position) continue;
      points.set(id, {
        stableId: `point:${id}`,
        name: id,
        internal: true,
        position,
        free: false,
        writable: false,
        dependsOn: [],
        stmtIndex: found.idx,
        coordinateTransform: s.coordinateTransform,
      });
      continue;
    }

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
        const pos = evalSceneCoord(s.at, env, s.coordinateTransform);
        const constraint = circleConstraintOf(s.at);
        points.set(id, {
          stableId: `point:${id}`,
          name: id,
          internal: id.startsWith('mg-'),
          position: pos,
          free: s.at.kind === 'literal',
          dependsOn: collectCoordRefs(s.at),
          stmtIndex: found.idx,
          coordinateTransform: s.coordinateTransform,
          definition: pointDefinitionOf(s.at),
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
      const style = resolveStyle(statementStyleRaw(s, s.options?.raw ?? null), s.command);
      for (const spec of s.specs) {
        try {
          const env: EvalEnvs = { points: ptEnv() };
          if (spec.type === 'polyline') {
            const pts = spec.points.map(c => evalSceneCoord(c, env, s.coordinateTransform));
            const refs: string[] = [];
            for (const p of spec.points) refs.push(...collectCoordRefs(p));
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'polyline',
              points: pts,
              pointOrigins: spec.points.map(coordinateOrigin),
              cycle: spec.cycle,
              sourcePathOperator: 'polyline',
              stmtIndex: idx,
              refs,
              style,
              coordinateTransform: s.coordinateTransform,
            });
          } else if (spec.type === 'rectangle') {
            const first = evalSceneCoord(spec.first, env, s.coordinateTransform);
            const opposite = evalSceneCoord(spec.opposite, env, s.coordinateTransform);
            const refs = [spec.first, spec.opposite].flatMap(collectCoordRefs);
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'polyline',
              points: rectanglePoints(first, opposite),
              pointOrigins: [
                coordinateOrigin(spec.first),
                { kind: 'expression' },
                coordinateOrigin(spec.opposite),
                { kind: 'expression' },
              ],
              cycle: true,
              sourcePathOperator: 'rectangle',
              stmtIndex: idx,
              refs,
              style,
              coordinateTransform: s.coordinateTransform,
            });
          } else if (spec.type === 'cubic-bezier') {
            const coords = [spec.start, spec.control1, spec.control2, spec.end];
            const values = coords.map((coord) => evalSceneCoord(coord, env, s.coordinateTransform));
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'cubic-bezier',
              start: values[0]!,
              control1: values[1]!,
              control2: values[2]!,
              end: values[3]!,
              pointOrigins: coords.map(coordinateOrigin),
              stmtIndex: idx,
              refs: coords.flatMap(collectCoordRefs),
              style,
              coordinateTransform: s.coordinateTransform,
            });
          } else if (spec.type === 'circular-arc') {
            const start = evalSceneCoord(spec.start, env, s.coordinateTransform);
            const similarity = isTikzCoordinateTransformSimilarity(s.coordinateTransform);
            if (!similarity) {
              const transform = s.coordinateTransform!;
              const ellipticalArc = ellipticalArcFromStart(
                start,
                { x: transform.a * spec.radius, y: transform.b * spec.radius },
                { x: transform.c * spec.radius, y: transform.d * spec.radius },
                spec.startAngleDeg,
                spec.endAngleDeg,
              );
              const axes = affineEllipseAxes(
                transform,
                spec.radius,
                spec.radius,
              );
              elements.push({
                stableId: `element:${idx}:${elements.length}`,
                kind: 'elliptical-arc',
                ...ellipticalArc,
                start,
                end: ellipticalArcPoint(ellipticalArc, spec.endAngleDeg),
                ...axes,
                parameterSources: {
                  sourceKind: 'circular-arc',
                  startAngle: { ...spec.parameterSources.startAngle },
                  endAngle: { ...spec.parameterSources.endAngle },
                  radius: { ...spec.parameterSources.radius },
                  coordinateTransformSimilarity: false,
                },
                stmtIndex: idx,
                refs: collectCoordRefs(spec.start),
                style,
                coordinateTransform: s.coordinateTransform,
              });
              continue;
            }
            const rotation = statementRotation(s);
            const arc = circularArcFromStart(
              start,
              spec.radius * statementScale(s),
              spec.startAngleDeg + rotation,
              spec.endAngleDeg + rotation,
            );
            const endAngle = (spec.endAngleDeg + rotation) * Math.PI / 180;
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'circular-arc',
              ...arc,
              start,
              end: {
                x: arc.center.x + arc.radius * Math.cos(endAngle),
                y: arc.center.y + arc.radius * Math.sin(endAngle),
              },
              parameterSources: {
                startAngle: {
                  range: spec.parameterSources.startAngle.range,
                  value: spec.parameterSources.startAngle.value,
                },
                endAngle: {
                  range: spec.parameterSources.endAngle.range,
                  value: spec.parameterSources.endAngle.value,
                },
                radius: {
                  range: spec.parameterSources.radius.range,
                  value: spec.parameterSources.radius.value,
                },
                coordinateScale: statementScale(s),
                coordinateRotationDegrees: rotation,
              },
              stmtIndex: idx,
              refs: collectCoordRefs(spec.start),
              style,
              coordinateTransform: s.coordinateTransform,
            });
          } else if (spec.type === 'ellipse') {
            const center = evalSceneCoord(spec.center, env, s.coordinateTransform);
            const similarity = isTikzCoordinateTransformSimilarity(s.coordinateTransform);
            const axes = similarity
              ? {
                xRadius: spec.xRadius * statementScale(s),
                yRadius: spec.yRadius * statementScale(s),
                rotationDegrees: statementRotation(s),
              }
              : affineEllipseAxes(s.coordinateTransform, spec.xRadius, spec.yRadius);
            elements.push({
              stableId: `element:${idx}:${elements.length}`,
              kind: 'ellipse',
              center,
              ...axes,
              parameterSources: {
                sourceKind: 'ellipse',
                xRadius: { ...spec.parameterSources.xRadius },
                yRadius: { ...spec.parameterSources.yRadius },
                coordinateScale: similarity ? statementScale(s) : null,
                coordinateRotationDegrees: similarity ? statementRotation(s) : null,
                coordinateTransformSimilarity: similarity,
                localRotation: localPathRotationSource(s),
              },
              stmtIndex: idx,
              refs: collectCoordRefs(spec.center),
              style,
              coordinateTransform: s.coordinateTransform,
            });
          } else {
            const center = evalSceneCoord(spec.center, env, s.coordinateTransform);
            const similarity = isTikzCoordinateTransformSimilarity(s.coordinateTransform);
            if (!similarity && spec.radius.kind === 'literal') {
              const axes = affineEllipseAxes(
                s.coordinateTransform,
                spec.radius.value,
                spec.radius.value,
              );
              const refs = collectCoordRefs(spec.center);
              elements.push({
                stableId: `element:${idx}:${elements.length}`,
                kind: 'ellipse',
                center,
                ...axes,
                parameterSources: {
                  sourceKind: 'circle',
                  radius: { range: spec.radius.range, value: spec.radius.value },
                  coordinateScale: null,
                  coordinateRotationDegrees: null,
                  coordinateTransformSimilarity: false,
                  localRotation: localPathRotationSource(s),
                },
                stmtIndex: idx,
                refs,
                style,
                coordinateTransform: s.coordinateTransform,
              });
              continue;
            }
            let radius: number;
            if (spec.radius.kind === 'literal') radius = spec.radius.value * statementScale(s);
            else {
              const tp = evalSceneCoord(spec.radius.point, env, s.coordinateTransform);
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
              radiusSource: spec.radius.kind === 'literal'
                ? {
                  range: spec.radius.range,
                  value: spec.radius.value,
                  coordinateScale: statementScale(s),
                }
                : null,
              definition: circleDefinitionOf(spec.center, spec.radius, statementScale(s)),
              stmtIndex: idx,
              refs,
              style,
              coordinateTransform: s.coordinateTransform,
            });
          }
        } catch (e) {
          if (e instanceof EvalError) issues.push({ stmtIndex: idx, message: e.message, kind: e.code });
        }
      }
    } else if (s.kind === 'graph') {
      const layout = graphLayout(s);
      const positions = layout.positions;
      const graphNodeOptions = graphOption(s, 'nodes');
      const graphEdgeOptions = graphOption(s, 'edges');
      const nodeByName = new Map(s.nodes.map((node) => [node.name, node] as const));
      for (const edge of s.edges) {
        if (edge.connector === '-!-') continue;
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        const arrow = edge.connector === '->'
          ? '->'
          : edge.connector === '<-'
            ? '<-'
            : edge.connector === '<->'
              ? '<->'
              : null;
        elements.push({
          stableId: `element:${idx}:${elements.length}`,
          kind: 'polyline',
          points: [from, to],
          pointOrigins: [
            { kind: 'named', name: edge.from },
            { kind: 'named', name: edge.to },
          ],
          cycle: false,
          sourcePathOperator: 'polyline',
          stmtIndex: idx,
          refs: [edge.from, edge.to],
          style: resolveStyle(graphStyleRaw(
            s.inheritedStyleRaw,
            graphEdgeOptions,
            edge.options?.raw,
            arrow,
          ), 'draw'),
          coordinateTransform: s.coordinateTransform,
          writable: false,
        });
      }
      for (const graphNode of s.nodes) {
        const center = positions.get(graphNode.name);
        if (!center) continue;
        const rawStyle = graphStyleRaw(
          s.inheritedStyleRaw,
          graphNodeOptions,
          graphNode.options?.raw,
        );
        elements.push({
          stableId: `element:${idx}:${elements.length}`,
          kind: 'graph-node',
          center,
          radius: graphNodeRadius(graphNode.text, s),
          text: nodeByName.get(graphNode.name)?.text ?? graphNode.name,
          outlined: graphHasDraw(rawStyle),
          layoutIntent: layout.intent,
          layoutAlgorithm: layout.requestedKey,
          layoutFidelity: layout.fidelity,
          exactCompilerRequired: layout.exactCompilerRequired,
          stmtIndex: idx,
          refs: [graphNode.name],
          style: resolveStyle(rawStyle, 'draw'),
          coordinateTransform: s.coordinateTransform,
          writable: false,
        });
      }
    } else if (s.kind === 'node') {
      try {
        const env: EvalEnvs = { points: ptEnv() };
        const at = evalSceneCoord(s.at, env, s.coordinateTransform);
        const refs = collectCoordRefs(s.at);
        const anchor = anchorFromRaw(statementStyleRaw(s, s.options?.raw ?? null));
        elements.push({
          stableId: `element:${idx}:${elements.length}`,
          kind: 'label',
          at,
          text: s.text,
          anchor,
          stmtIndex: idx,
          refs,
          style: resolveStyle(statementStyleRaw(s, s.options?.raw ?? null), 'node'),
          coordinateTransform: s.coordinateTransform,
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
          stmtIndex: idx, refs: [...s.points], style: resolveStyle(statementStyleRaw(s, s.options?.raw ?? null), 'pic'),
          coordinateTransform: s.coordinateTransform,
        });
      } catch (e) {
        if (e instanceof EvalError) issues.push({ stmtIndex: idx, message: e.message, kind: e.code });
      }
    }
  });

  return { sourceRevision, points, elements, issues, graphOrder: graph.order };
}
