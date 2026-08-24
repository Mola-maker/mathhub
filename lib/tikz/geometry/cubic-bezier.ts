import type { Pt } from '../semantics/calc-eval';

export interface CubicBezierGeometry {
  readonly start: Pt;
  readonly control1: Pt;
  readonly control2: Pt;
  readonly end: Pt;
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointLineDistance(point: Pt, start: Pt, end: Pt): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

export function cubicBezierPoint(curve: CubicBezierGeometry, t: number): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * curve.start.x + 3 * uu * t * curve.control1.x
      + 3 * u * tt * curve.control2.x + tt * t * curve.end.x,
    y: uu * u * curve.start.y + 3 * uu * t * curve.control1.y
      + 3 * u * tt * curve.control2.y + tt * t * curve.end.y,
  };
}

export function splitCubicBezier(
  curve: CubicBezierGeometry,
): readonly [CubicBezierGeometry, CubicBezierGeometry] {
  const a = midpoint(curve.start, curve.control1);
  const b = midpoint(curve.control1, curve.control2);
  const c = midpoint(curve.control2, curve.end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const middle = midpoint(d, e);
  return [
    { start: curve.start, control1: a, control2: d, end: middle },
    { start: middle, control1: e, control2: c, end: curve.end },
  ];
}

/** Deterministic adaptive de Casteljau flattening in curve order. */
export function flattenCubicBezier(
  curve: CubicBezierGeometry,
  tolerance = 0.01,
  maxDepth = 12,
): readonly Pt[] {
  const output: Pt[] = [curve.start];
  const visit = (part: CubicBezierGeometry, depth: number): void => {
    const flatness = Math.max(
      pointLineDistance(part.control1, part.start, part.end),
      pointLineDistance(part.control2, part.start, part.end),
    );
    if (depth >= maxDepth || flatness <= tolerance) {
      output.push(part.end);
      return;
    }
    const [left, right] = splitCubicBezier(part);
    visit(left, depth + 1);
    visit(right, depth + 1);
  };
  visit(curve, 0);
  return output;
}
