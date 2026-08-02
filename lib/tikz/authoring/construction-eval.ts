import type {
  AngleBisectorConstructionPlan,
  CircleConstructionReference,
  CompleteQuadrilateralConstructionPlan,
  CircumcircleConstructionPlan,
  ConstructionEntity,
  ConstructionPlan,
  ConstructionPlanKind,
  CyclicQuadrilateralConstructionPlan,
  Homothety2ConstructionPlan,
  InversionPointConstructionPlan,
  MidpointConstructionPlan,
  ParallelLineConstructionPlan,
  PerpendicularBisectorConstructionPlan,
  PerpendicularFootConstructionPlan,
  PerpendicularLineConstructionPlan,
  ReflectLineConstructionPlan,
  ReflectPointConstructionPlan,
  RadicalAxisConstructionPlan,
  Rotate90ConstructionPlan,
  TangentAtPointConstructionPlan,
} from './construction-ir';
import type { Pt } from '../semantics/calc-eval';

/**
 * Numeric tolerance used by the source-neutral construction evaluator.
 *
 * The evaluator intentionally has one tolerance and one set of guards.  The
 * writer and the reverse drag solver may choose their own numerical policies,
 * but a preview must never invent a value for an undefined construction.
 */
export const CONSTRUCTION_EPSILON = 1e-9;

export type ConstructionEvaluationDiagnosticCode =
  | 'unsupported-plan-kind'
  | 'missing-reference'
  | 'non-finite-coordinate'
  | 'zero-direction'
  | 'coincident-points'
  | 'collinear-points'
  | 'invalid-radius'
  | 'point-not-on-circle'
  | 'parallel-lines'
  | 'no-second-intersection'
  | 'invalid-geometry';

export interface ConstructionEvaluationDiagnostic {
  readonly code: ConstructionEvaluationDiagnosticCode;
  readonly severity: 'error';
  readonly path: string;
  readonly message: string;
}

export type EvaluatedConstructionGeometry =
  | {
    readonly kind: 'point';
    readonly id: string;
    readonly point: Pt;
  }
  | {
    readonly kind: 'segment' | 'line';
    readonly id: string;
    readonly from: Pt;
    readonly to: Pt;
    readonly extent: 'finite' | 'line';
  }
  | {
    readonly kind: 'circle';
    readonly id: string;
    readonly center: Pt;
    readonly radius: number;
  }
  | {
    readonly kind: 'polygon';
    readonly id: string;
    readonly points: readonly Pt[];
  };

/** One immutable evaluated entity.  `geometry` is omitted for non-output
 * entities which were only used as semantic dependencies by a plan. */
export interface EvaluatedConstructionEntity {
  readonly id: string;
  readonly name: string;
  readonly kind: ConstructionEntity['kind'];
  readonly geometry?: EvaluatedConstructionGeometry;
}

export interface ConstructionEvaluationResult {
  readonly planId: string;
  readonly planKind: ConstructionPlanKind;
  /** The complete finite point snapshot, including evaluated derived points. */
  readonly points: ReadonlyMap<string, Pt>;
  /** Alias retained for callers that want to make the derived nature explicit. */
  readonly evaluatedPoints: ReadonlyMap<string, Pt>;
  readonly entities: readonly EvaluatedConstructionEntity[];
  readonly evaluatedEntities: readonly EvaluatedConstructionEntity[];
  /** Visible, renderer-neutral output geometry in deterministic plan order. */
  readonly geometries: readonly EvaluatedConstructionGeometry[];
  readonly diagnostics: readonly ConstructionEvaluationDiagnostic[];
  readonly status: 'valid' | 'invalid' | 'unsupported';
}

/** A Map-shaped read-only view with no mutating methods exposed. */
class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  private readonly map: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.map = new Map(entries);
    Object.freeze(this.map);
    Object.freeze(this);
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.map.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  entries(): MapIterator<[K, V]> {
    return this.map.entries();
  }

  keys(): MapIterator<K> {
    return this.map.keys();
  }

  values(): MapIterator<V> {
    return this.map.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }
}

interface MutableEvaluationState {
  readonly points: Map<string, Pt>;
  readonly diagnostics: ConstructionEvaluationDiagnostic[];
  readonly geometriesByName: Map<string, EvaluatedConstructionGeometry>;
}

function freezePoint(point: Pt): Pt {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeGeometry(geometry: EvaluatedConstructionGeometry): EvaluatedConstructionGeometry {
  switch (geometry.kind) {
    case 'point':
      return Object.freeze({ ...geometry, point: freezePoint(geometry.point) });
    case 'segment':
    case 'line':
      return Object.freeze({
        ...geometry,
        from: freezePoint(geometry.from),
        to: freezePoint(geometry.to),
      });
    case 'circle':
      return Object.freeze({
        ...geometry,
        center: freezePoint(geometry.center),
      });
    case 'polygon':
      return Object.freeze({
        ...geometry,
        points: Object.freeze(geometry.points.map(freezePoint)),
      });
  }
}

function finitePoint(value: Pt): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isZeroDirection(first: Pt, second: Pt): boolean {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const directionScale = Math.max(1, Math.abs(dx), Math.abs(dy));
  const tolerance = CONSTRUCTION_EPSILON * directionScale;
  return dx * dx + dy * dy <= tolerance * tolerance;
}

function distance(first: Pt, second: Pt): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function add(first: Pt, second: Pt): Pt {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first: Pt, second: Pt): Pt {
  return { x: first.x - second.x, y: first.y - second.y };
}

function vectorSquaredLength(vector: Pt): number {
  return vector.x * vector.x + vector.y * vector.y;
}

function scale(point: Pt, factor: number): Pt {
  return { x: point.x * factor, y: point.y * factor };
}

function rotate90(point: Pt): Pt {
  return { x: -point.y, y: point.x };
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > CONSTRUCTION_EPSILON;
}

function diagnostic(
  state: MutableEvaluationState,
  code: ConstructionEvaluationDiagnosticCode,
  path: string,
  message: string,
): void {
  state.diagnostics.push(Object.freeze({
    code,
    severity: 'error',
    path,
    message,
  }));
}

function pointAt(
  state: MutableEvaluationState,
  source: ReadonlyMap<string, Pt>,
  ref: string,
  path: string,
): Pt | null {
  const value = state.points.get(ref) ?? source.get(ref);
  if (!value) {
    diagnostic(state, 'missing-reference', path, `Missing point reference: ${ref}`);
    return null;
  }
  const point = { x: value.x, y: value.y };
  if (!finitePoint(point)) {
    diagnostic(state, 'non-finite-coordinate', path, `Point reference is not finite: ${ref}`);
    return null;
  }
  return point;
}

function setPoint(state: MutableEvaluationState, ref: string, point: Pt): Pt | null {
  if (!finitePoint(point)) {
    diagnostic(state, 'invalid-geometry', ref, `Evaluated point is not finite: ${ref}`);
    return null;
  }
  const snapshot = { x: point.x, y: point.y };
  state.points.set(ref, snapshot);
  return snapshot;
}

function entityForName(plan: ConstructionPlan, name: string): ConstructionEntity | undefined {
  return plan.entities.find((entity) => entity.name === name);
}

function entityIdForName(plan: ConstructionPlan, name: string): string {
  return entityForName(plan, name)?.id ?? name;
}

function lineEntityName(
  plan: ConstructionPlan,
  from: string,
  to: string,
): string | null {
  const line = plan.entities.find((entity) => (
    entity.kind === 'line'
    && entity.from === from
    && entity.to === to
  ));
  return line?.name ?? null;
}

function registerPoint(
  state: MutableEvaluationState,
  plan: ConstructionPlan,
  name: string,
  point: Pt,
): void {
  const value = setPoint(state, name, point);
  if (!value) return;
  state.geometriesByName.set(name, {
    kind: 'point',
    id: entityIdForName(plan, name),
    point: value,
  });
}

function registerLine(
  state: MutableEvaluationState,
  plan: ConstructionPlan,
  name: string,
  from: Pt,
  to: Pt,
): void {
  if (!finitePoint(from) || !finitePoint(to)) {
    diagnostic(state, 'invalid-geometry', name, `Evaluated line is not finite: ${name}`);
    return;
  }
  state.geometriesByName.set(name, {
    kind: 'line',
    id: entityIdForName(plan, name),
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    extent: 'line',
  });
}

function registerSegment(
  state: MutableEvaluationState,
  plan: ConstructionPlan,
  name: string,
  from: Pt,
  to: Pt,
): void {
  if (!finitePoint(from) || !finitePoint(to)) {
    diagnostic(state, 'invalid-geometry', name, `Evaluated segment is not finite: ${name}`);
    return;
  }
  state.geometriesByName.set(name, {
    kind: 'segment',
    id: entityIdForName(plan, name),
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    extent: 'finite',
  });
}

function registerCircle(
  state: MutableEvaluationState,
  plan: ConstructionPlan,
  name: string,
  center: Pt,
  radius: number,
): void {
  if (!finitePoint(center) || !finitePositive(radius)) {
    diagnostic(state, 'invalid-geometry', name, `Evaluated circle is invalid: ${name}`);
    return;
  }
  state.geometriesByName.set(name, {
    kind: 'circle',
    id: entityIdForName(plan, name),
    center: { x: center.x, y: center.y },
    radius,
  });
}

function registerPolygon(
  state: MutableEvaluationState,
  plan: ConstructionPlan,
  name: string,
  points: readonly Pt[],
): void {
  if (points.length < 3 || points.some((point) => !finitePoint(point))) {
    diagnostic(state, 'invalid-geometry', name, `Evaluated polygon is invalid: ${name}`);
    return;
  }
  state.geometriesByName.set(name, {
    kind: 'polygon',
    id: entityIdForName(plan, name),
    points: points.map((point) => ({ x: point.x, y: point.y })),
  });
}

function resolveCircle(
  circle: CircleConstructionReference,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
  path: string,
): { readonly center: Pt; readonly radius: number } | null {
  // Named source dependencies are authoritative. Never revive a deleted or
  // stale center from the write-time evaluated snapshot carried by the plan.
  const center = pointAt(state, source, circle.center, `${path}.center`);
  if (!center) return null;

  let radius: number | null = null;
  if (circle.through) {
    const through = pointAt(state, source, circle.through, `${path}.through`);
    if (!through) return null;
    radius = distance(center, through);
  } else if (typeof circle.radius === 'number') {
    radius = circle.radius;
  }
  if (radius === null || !finitePositive(radius)) {
    diagnostic(state, 'invalid-radius', `${path}.radius`, `Circle radius is not resolved: ${path}`);
    return null;
  }
  return { center, radius };
}

function intersectInfiniteLines(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const first = subtract(b, a);
  const second = subtract(d, c);
  const denominator = first.x * second.y - first.y * second.x;
  const scaleGuard = Math.max(1, Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y));
  if (Math.abs(denominator) <= CONSTRUCTION_EPSILON * scaleGuard) return null;
  const between = subtract(c, a);
  const t = (between.x * second.y - between.y * second.x) / denominator;
  const result = add(a, scale(first, t));
  return finitePoint(result) ? result : null;
}

function collinearPoints(a: Pt, b: Pt, c: Pt): boolean {
  const first = subtract(b, a);
  const second = subtract(c, a);
  const cross = first.x * second.y - first.y * second.x;
  const scaleGuard = Math.max(1, Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y));
  return Math.abs(cross) <= CONSTRUCTION_EPSILON * scaleGuard;
}

function projectPointOnLine(point: Pt, lineStart: Pt, lineEnd: Pt): Pt {
  const direction = subtract(lineEnd, lineStart);
  const lengthSquared = vectorSquaredLength(direction);
  const offset = subtract(point, lineStart);
  const t = (offset.x * direction.x + offset.y * direction.y) / lengthSquared;
  return add(lineStart, scale(direction, t));
}

function evaluateMidpoint(
  plan: MidpointConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const a = pointAt(state, source, plan.a, 'a');
  const b = pointAt(state, source, plan.b, 'b');
  if (!a || !b) return;
  if (isZeroDirection(a, b)) {
    diagnostic(state, 'coincident-points', 'a/b', 'Midpoint endpoints must be distinct.');
    return;
  }
  registerPoint(state, plan, plan.result, scale(add(a, b), 0.5));
}

function evaluatePerpendicularFoot(
  plan: PerpendicularFootConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const lineStart = pointAt(state, source, plan.lineStart, 'lineStart');
  const lineEnd = pointAt(state, source, plan.lineEnd, 'lineEnd');
  if (!point || !lineStart || !lineEnd) return;
  if (isZeroDirection(lineStart, lineEnd)) {
    diagnostic(state, 'zero-direction', 'lineStart/lineEnd', 'Projection reference line has zero direction.');
    return;
  }
  registerPoint(state, plan, plan.result, projectPointOnLine(point, lineStart, lineEnd));
}

function evaluateParallelLine(
  plan: ParallelLineConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const through = pointAt(state, source, plan.through, 'through');
  const referenceStart = pointAt(state, source, plan.referenceStart, 'referenceStart');
  const referenceEnd = pointAt(state, source, plan.referenceEnd, 'referenceEnd');
  if (!through || !referenceStart || !referenceEnd) return;
  if (isZeroDirection(referenceStart, referenceEnd)) {
    diagnostic(state, 'zero-direction', 'referenceStart/referenceEnd', 'Parallel reference line has zero direction.');
    return;
  }
  const direction = subtract(referenceEnd, referenceStart);
  const result = add(through, direction);
  const line = lineEntityName(plan, plan.through, plan.result);
  registerPoint(state, plan, plan.result, result);
  if (line) registerLine(state, plan, line, through, result);
  else diagnostic(state, 'missing-reference', 'entities.line', 'Parallel plan is missing its output line entity.');
}

function evaluatePerpendicularLine(
  plan: PerpendicularLineConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const through = pointAt(state, source, plan.through, 'through');
  const referenceStart = pointAt(state, source, plan.referenceStart, 'referenceStart');
  const referenceEnd = pointAt(state, source, plan.referenceEnd, 'referenceEnd');
  if (!through || !referenceStart || !referenceEnd) return;
  if (isZeroDirection(referenceStart, referenceEnd)) {
    diagnostic(state, 'zero-direction', 'referenceStart/referenceEnd', 'Perpendicular reference line has zero direction.');
    return;
  }
  const result = add(through, rotate90(subtract(referenceEnd, referenceStart)));
  const line = lineEntityName(plan, plan.through, plan.result);
  registerPoint(state, plan, plan.result, result);
  if (line) registerLine(state, plan, line, through, result);
  else diagnostic(state, 'missing-reference', 'entities.line', 'Perpendicular plan is missing its output line entity.');
}

function evaluatePerpendicularBisector(
  plan: PerpendicularBisectorConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const a = pointAt(state, source, plan.a, 'a');
  const b = pointAt(state, source, plan.b, 'b');
  if (!a || !b) return;
  if (isZeroDirection(a, b)) {
    diagnostic(state, 'zero-direction', 'a/b', 'Perpendicular-bisector segment has zero direction.');
    return;
  }
  const midpoint = scale(add(a, b), 0.5);
  const result = add(midpoint, rotate90(subtract(b, a)));
  registerPoint(state, plan, plan.midpoint, midpoint);
  registerPoint(state, plan, plan.result, result);
  registerLine(state, plan, plan.line, midpoint, result);
}

function evaluateReflectPoint(
  plan: ReflectPointConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const center = pointAt(state, source, plan.center, 'center');
  if (!point || !center) return;
  registerPoint(state, plan, plan.result, subtract(scale(center, 2), point));
}

function evaluateReflectLine(
  plan: ReflectLineConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const lineStart = pointAt(state, source, plan.lineStart, 'lineStart');
  const lineEnd = pointAt(state, source, plan.lineEnd, 'lineEnd');
  if (!point || !lineStart || !lineEnd) return;
  if (isZeroDirection(lineStart, lineEnd)) {
    diagnostic(state, 'zero-direction', 'lineStart/lineEnd', 'Reflection axis has zero direction.');
    return;
  }
  const foot = projectPointOnLine(point, lineStart, lineEnd);
  const result = subtract(scale(foot, 2), point);
  registerPoint(state, plan, plan.foot, foot);
  registerPoint(state, plan, plan.result, result);
}

function evaluateRotate90(
  plan: Rotate90ConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const center = pointAt(state, source, plan.center, 'center');
  if (!point || !center) return;
  registerPoint(state, plan, plan.result, add(center, rotate90(subtract(point, center))));
}

function evaluateHomothety2(
  plan: Homothety2ConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const center = pointAt(state, source, plan.center, 'center');
  if (!point || !center) return;
  registerPoint(state, plan, plan.result, add(center, scale(subtract(point, center), 2)));
}

function evaluateInversionPoint(
  plan: InversionPointConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const point = pointAt(state, source, plan.point, 'point');
  const center = pointAt(state, source, plan.center, 'center');
  const radiusPoint = pointAt(state, source, plan.radiusPoint, 'radiusPoint');
  if (!point || !center || !radiusPoint) return;
  if (isZeroDirection(center, point)) {
    diagnostic(state, 'zero-direction', 'point/center', 'The inversion center has no finite inverse.');
    return;
  }
  if (isZeroDirection(center, radiusPoint)) {
    diagnostic(state, 'invalid-radius', 'radiusPoint/center', 'Inversion radius must be finite and positive.');
    return;
  }
  const vector = subtract(point, center);
  const radiusVector = subtract(radiusPoint, center);
  const factor = vectorSquaredLength(radiusVector) / vectorSquaredLength(vector);
  if (!Number.isFinite(factor) || factor <= 0) {
    diagnostic(state, 'invalid-geometry', 'result', 'Inversion produced an invalid scale factor.');
    return;
  }
  const result = add(center, scale(vector, factor));
  registerPoint(state, plan, plan.result, result);
  registerSegment(state, plan, plan.guide, point, result);
}

function evaluateRadicalAxis(
  plan: RadicalAxisConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const first = resolveCircle(plan.circle1, source, state, 'circle1');
  const second = resolveCircle(plan.circle2, source, state, 'circle2');
  if (!first || !second) return;
  const centers = subtract(second.center, first.center);
  const distanceSquared = vectorSquaredLength(centers);
  const centerScale = Math.max(1, first.radius, second.radius);
  if (distanceSquared <= CONSTRUCTION_EPSILON * CONSTRUCTION_EPSILON * centerScale * centerScale) {
    diagnostic(state, 'coincident-points', 'circle1.center/circle2.center', 'Concentric circles have no unique finite radical axis.');
    return;
  }
  const t = (
    distanceSquared + first.radius * first.radius - second.radius * second.radius
  ) / (2 * distanceSquared);
  const result = add(first.center, scale(centers, t));
  const direction = add(result, rotate90(centers));
  if (!finitePoint(result) || !finitePoint(direction)) {
    diagnostic(state, 'invalid-geometry', 'result', 'Radical-axis evaluation produced non-finite geometry.');
    return;
  }
  registerPoint(state, plan, plan.result, result);
  registerPoint(state, plan, plan.direction, direction);
  registerLine(state, plan, plan.line, result, direction);
}

function evaluateCyclicQuadrilateral(
  plan: CyclicQuadrilateralConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const a = pointAt(state, source, plan.a, 'a');
  const b = pointAt(state, source, plan.b, 'b');
  const c = pointAt(state, source, plan.c, 'c');
  const direction = pointAt(state, source, plan.direction, 'direction');
  if (!a || !b || !c || !direction) return;
  if (isZeroDirection(a, b) || isZeroDirection(a, c) || isZeroDirection(b, c)) {
    diagnostic(state, 'coincident-points', 'a/b/c', 'Cyclic-quadrilateral seed points must be distinct.');
    return;
  }
  if (isZeroDirection(a, direction)) {
    diagnostic(state, 'zero-direction', 'a/direction', 'Secant direction must differ from the known circle point.');
    return;
  }
  const circle = circumcenter(a, b, c);
  if (!circle) {
    diagnostic(state, 'collinear-points', 'a/b/c', 'Three collinear points do not define a cyclic quadrilateral.');
    return;
  }
  const secantDirection = subtract(direction, a);
  const radiusAtA = subtract(a, circle.center);
  const denominator = vectorSquaredLength(secantDirection);
  const t = -2 * (
    secantDirection.x * radiusAtA.x + secantDirection.y * radiusAtA.y
  ) / denominator;
  const result = add(a, scale(secantDirection, t));
  const resultScale = Math.max(1, circle.radius, Math.hypot(secantDirection.x, secantDirection.y));
  if (
    !Number.isFinite(t)
    || !finitePoint(result)
    || distance(result, a) <= CONSTRUCTION_EPSILON * resultScale
  ) {
    diagnostic(state, 'no-second-intersection', 'result', 'The selected line is tangent and has no distinct second circle intersection.');
    return;
  }
  if (distance(result, b) <= CONSTRUCTION_EPSILON * resultScale || distance(result, c) <= CONSTRUCTION_EPSILON * resultScale) {
    diagnostic(state, 'coincident-points', 'result', 'The second intersection must define a fourth distinct vertex.');
    return;
  }
  registerPoint(state, plan, plan.center, circle.center);
  registerPoint(state, plan, plan.result, result);
  registerCircle(state, plan, plan.circle, circle.center, circle.radius);
  registerLine(state, plan, plan.secant, a, direction);
  registerPolygon(state, plan, plan.polygon, [a, b, result, c]);
}

function evaluateCompleteQuadrilateral(
  plan: CompleteQuadrilateralConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const a = pointAt(state, source, plan.a, 'a');
  const b = pointAt(state, source, plan.b, 'b');
  const c = pointAt(state, source, plan.c, 'c');
  const d = pointAt(state, source, plan.d, 'd');
  if (!a || !b || !c || !d) return;
  if (isZeroDirection(a, b) || isZeroDirection(b, c) || isZeroDirection(c, d) || isZeroDirection(d, a)) {
    diagnostic(state, 'zero-direction', 'a/b/c/d', 'Complete-quadrilateral defining lines must not collapse to points.');
    return;
  }
  if (
    collinearPoints(a, b, c)
    || collinearPoints(b, c, d)
    || collinearPoints(c, d, a)
    || collinearPoints(d, a, b)
  ) {
    diagnostic(state, 'collinear-points', 'a/b/c/d', 'Complete quadrilateral requires four distinct supporting lines.');
    return;
  }
  const first = intersectInfiniteLines(a, b, c, d);
  const second = intersectInfiniteLines(b, c, d, a);
  if (!first || !second) {
    diagnostic(state, 'parallel-lines', 'intersections', 'Complete-quadrilateral opposite sides must have finite intersections.');
    return;
  }
  const diagonalScale = Math.max(1, distance(a, b), distance(b, c), distance(c, d), distance(d, a));
  if (distance(first, second) <= CONSTRUCTION_EPSILON * diagonalScale) {
    diagnostic(state, 'coincident-points', 'intersections', 'Complete-quadrilateral opposite intersections must be distinct.');
    return;
  }
  registerPoint(state, plan, plan.firstIntersection, first);
  registerPoint(state, plan, plan.secondIntersection, second);
  registerLine(state, plan, plan.lineAB, a, b);
  registerLine(state, plan, plan.lineBC, b, c);
  registerLine(state, plan, plan.lineCD, c, d);
  registerLine(state, plan, plan.lineDA, d, a);
  registerSegment(state, plan, plan.diagonal, first, second);
}

function evaluateAngleBisector(
  plan: AngleBisectorConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const armA = pointAt(state, source, plan.armA, 'armA');
  const vertex = pointAt(state, source, plan.vertex, 'vertex');
  const armB = pointAt(state, source, plan.armB, 'armB');
  if (!armA || !vertex || !armB) return;
  if (isZeroDirection(vertex, armA) || isZeroDirection(vertex, armB)) {
    diagnostic(state, 'zero-direction', 'armA/vertex/armB', 'Angle arm has zero direction.');
    return;
  }
  const first = scale(subtract(armA, vertex), 1 / distance(armA, vertex));
  const second = scale(subtract(armB, vertex), 1 / distance(armB, vertex));
  const direction = add(first, second);
  if (isZeroDirection({ x: 0, y: 0 }, direction)) {
    diagnostic(state, 'zero-direction', 'armA/vertex/armB', 'Opposite angle arms have no unique interior bisector.');
    return;
  }
  const result = add(vertex, direction);
  registerPoint(state, plan, plan.result, result);
  registerLine(state, plan, plan.line, vertex, result);
}

function circumcenter(
  a: Pt,
  b: Pt,
  c: Pt,
): { readonly center: Pt; readonly radius: number } | null {
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const determinant = 2 * (ab.x * ac.y - ab.y * ac.x);
  const determinantScale = Math.max(
    1,
    Math.hypot(ab.x, ab.y) * Math.hypot(ac.x, ac.y),
  );
  if (Math.abs(determinant) <= CONSTRUCTION_EPSILON * determinantScale) return null;
  const abSquared = ab.x * ab.x + ab.y * ab.y;
  const acSquared = ac.x * ac.x + ac.y * ac.y;
  const center = add(a, {
    x: (abSquared * ac.y - acSquared * ab.y) / determinant,
    y: (ab.x * acSquared - ac.x * abSquared) / determinant,
  });
  const radius = distance(center, a);
  return finitePoint(center) && finitePositive(radius)
    ? { center, radius }
    : null;
}

function evaluateCircumcircle(
  plan: CircumcircleConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const a = pointAt(state, source, plan.a, 'a');
  const b = pointAt(state, source, plan.b, 'b');
  const c = pointAt(state, source, plan.c, 'c');
  if (!a || !b || !c) return;
  if (isZeroDirection(a, b) || isZeroDirection(a, c) || isZeroDirection(b, c)) {
    diagnostic(state, 'coincident-points', 'a/b/c', 'Circumcircle points must be distinct.');
    return;
  }
  const value = circumcenter(a, b, c);
  if (!value) {
    diagnostic(state, 'collinear-points', 'a/b/c', 'Three collinear points do not define a circumcircle.');
    return;
  }
  registerPoint(state, plan, plan.center, value.center);
  registerCircle(state, plan, plan.circle, value.center, value.radius);
}

function evaluateTangent(
  plan: TangentAtPointConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  state: MutableEvaluationState,
): void {
  const center = pointAt(state, source, plan.circle.center, 'circle.center');
  if (!center) return;

  // The interaction adapter must bind the pointer-projected circle position to
  // the plan's derived touch identity. Falling back to the circle's through
  // witness would preview a tangent at a different point than the user's click.
  const touch = pointAt(state, source, plan.touch, 'touch');
  if (!touch) return;
  const radial = subtract(touch, center);
  const touchRadius = Math.hypot(radial.x, radial.y);
  if (!finitePositive(touchRadius)) {
    diagnostic(state, 'zero-direction', 'circle.center/touch', 'Tangent touch point coincides with the circle center.');
    return;
  }

  let declaredRadius: number | null = null;
  if (typeof plan.circle.radius === 'number') declaredRadius = plan.circle.radius;
  else if (typeof plan.circle.evaluatedRadius === 'number') declaredRadius = plan.circle.evaluatedRadius;
  else if (plan.circle.through) {
    const through = pointAt(state, source, plan.circle.through, 'circle.through');
    if (through) declaredRadius = distance(center, through);
  }
  if (declaredRadius === null || !finitePositive(declaredRadius)) {
    diagnostic(
      state,
      'invalid-radius',
      'circle.radius',
      'Tangent preview requires a resolved finite positive circle radius.',
    );
    return;
  }
  if (Math.abs(declaredRadius - touchRadius) > CONSTRUCTION_EPSILON * Math.max(1, declaredRadius, touchRadius)) {
    diagnostic(state, 'point-not-on-circle', 'touch', 'Tangent touch point is not on the declared circle.');
    return;
  }

  const result = add(touch, rotate90(radial));
  registerPoint(state, plan, plan.touch, touch);
  registerPoint(state, plan, plan.result, result);
  registerLine(state, plan, plan.line, touch, result);
}

function unsupportedResult(
  plan: ConstructionPlan,
  source: ReadonlyMap<string, Pt>,
  message: string,
): ConstructionEvaluationResult {
  const points = finitePointEntries(source);
  const diagnostics = Object.freeze([
    Object.freeze({
      code: 'unsupported-plan-kind' as const,
      severity: 'error' as const,
      path: 'plan.kind',
      message,
    }),
  ]);
  const empty: readonly EvaluatedConstructionEntity[] = Object.freeze([]);
  const geometries: readonly EvaluatedConstructionGeometry[] = Object.freeze([]);
  return Object.freeze({
    planId: plan.id,
    planKind: plan.kind,
    points,
    evaluatedPoints: points,
    entities: empty,
    evaluatedEntities: empty,
    geometries,
    diagnostics,
    status: 'unsupported' as const,
  });
}

function finitePointEntries(source: ReadonlyMap<string, Pt>): ReadonlyMap<string, Pt> {
  const entries: Array<readonly [string, Pt]> = [];
  source.forEach((value, key) => {
    const point = { x: value.x, y: value.y };
    if (finitePoint(point)) entries.push([key, freezePoint(point)]);
  });
  return new ImmutableReadonlyMap(entries);
}

function visibleNames(plan: ConstructionPlan): readonly string[] {
  switch (plan.kind) {
    case 'midpoint':
    case 'perpendicular-foot':
      return [plan.result];
    case 'parallel-line':
    case 'perpendicular-line': {
      const line = lineEntityName(plan, plan.through, plan.result);
      return line ? [plan.result, line] : [plan.result];
    }
    case 'perpendicular-bisector':
      return [plan.midpoint, plan.result, plan.line];
    case 'angle-bisector':
      return [plan.result, plan.line];
    case 'circumcircle':
      return [plan.center, plan.circle];
    case 'tangent-at-point':
      return [plan.touch, plan.result, plan.line];
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2':
      return [plan.result];
    case 'inversion-point':
      return [plan.result, plan.guide];
    case 'reflect-line':
      return [plan.foot, plan.result];
    case 'radical-axis':
    case 'cyclic-quadrilateral':
    case 'complete-quadrilateral':
      return plan.outputs.map((output) => output.ref);
    default:
      return [];
  }
}

function buildResult(
  plan: ConstructionPlan,
  state: MutableEvaluationState,
): ConstructionEvaluationResult {
  const immutablePoints = new ImmutableReadonlyMap(
    [...state.points.entries()].map(([name, point]) => [name, freezePoint(point)] as const),
  );
  const entityEntries: EvaluatedConstructionEntity[] = [];
  for (const entity of plan.entities) {
    const geometry = state.geometriesByName.get(entity.name);
    if (!geometry) continue;
    entityEntries.push(Object.freeze({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      geometry: freezeGeometry(geometry),
    }));
  }
  const entities = Object.freeze(entityEntries);
  const geometryByName = new Map(
    entityEntries.map((entity) => [entity.name, entity.geometry!] as const),
  );
  const geometries: EvaluatedConstructionGeometry[] = [];
  const seen = new Set<string>();
  for (const name of visibleNames(plan)) {
    const geometry = geometryByName.get(name);
    if (!geometry || seen.has(geometry.id)) continue;
    seen.add(geometry.id);
    geometries.push(geometry);
  }
  const frozenGeometries = Object.freeze(geometries);
  const diagnostics = Object.freeze([...state.diagnostics]);
  const hasError = diagnostics.length > 0;
  return Object.freeze({
    planId: plan.id,
    planKind: plan.kind,
    points: immutablePoints,
    evaluatedPoints: immutablePoints,
    entities,
    evaluatedEntities: entities,
    geometries: frozenGeometries,
    diagnostics,
    status: hasError ? 'invalid' as const : 'valid' as const,
  });
}

/**
 * Evaluate one immutable ConstructionPlan against a revision-bound point
 * snapshot.  This function is source-neutral: it neither parses TikZ nor
 * writes source/history/network state.  Unsupported plans deliberately return
 * no geometry so callers can retain their generic ghost fallback.
 */
export function evaluateConstructionPlan(
  plan: ConstructionPlan,
  source: ReadonlyMap<string, Pt>,
): ConstructionEvaluationResult {
  const state: MutableEvaluationState = {
    points: new Map(),
    diagnostics: [],
    geometriesByName: new Map(),
  };
  source.forEach((value, key) => {
    const point = { x: value.x, y: value.y };
    if (finitePoint(point)) state.points.set(key, point);
  });

  switch (plan.kind) {
    case 'midpoint':
      evaluateMidpoint(plan, source, state);
      break;
    case 'perpendicular-foot':
      evaluatePerpendicularFoot(plan, source, state);
      break;
    case 'parallel-line':
      evaluateParallelLine(plan, source, state);
      break;
    case 'perpendicular-line':
      evaluatePerpendicularLine(plan, source, state);
      break;
    case 'perpendicular-bisector':
      evaluatePerpendicularBisector(plan, source, state);
      break;
    case 'angle-bisector':
      evaluateAngleBisector(plan, source, state);
      break;
    case 'circumcircle':
      evaluateCircumcircle(plan, source, state);
      break;
    case 'tangent-at-point':
      evaluateTangent(plan, source, state);
      break;
    case 'reflect-point':
      evaluateReflectPoint(plan, source, state);
      break;
    case 'reflect-line':
      evaluateReflectLine(plan, source, state);
      break;
    case 'rotate-90':
      evaluateRotate90(plan, source, state);
      break;
    case 'homothety-2':
      evaluateHomothety2(plan, source, state);
      break;
    case 'inversion-point':
      evaluateInversionPoint(plan, source, state);
      break;
    case 'radical-axis':
      evaluateRadicalAxis(plan, source, state);
      break;
    case 'cyclic-quadrilateral':
      evaluateCyclicQuadrilateral(plan, source, state);
      break;
    case 'complete-quadrilateral':
      evaluateCompleteQuadrilateral(plan, source, state);
      break;
    default:
      return unsupportedResult(
        plan,
        source,
        `Construction plan kind is not supported by the derived preview evaluator: ${plan.kind}`,
      );
  }
  return buildResult(plan, state);
}

/** Concise alias for callers that treat evaluation as a kernel operation. */
export const evaluateConstruction = evaluateConstructionPlan;
