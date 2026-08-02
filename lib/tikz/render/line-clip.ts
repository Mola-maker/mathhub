import type { Pt } from '../semantics/calc-eval';

export type ParametricExtent = 'line' | 'ray' | 'segment';

export interface ScreenFrame {
  readonly width: number;
  readonly height: number;
}

export interface ScreenRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const DIRECTION_EPSILON = 1e-9;

function finitePoint(point: Pt): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Clips P(t) = origin + t(directionPoint - origin) to a rectangle.
 *
 * The extent controls the admissible parameter interval:
 * - line:    (-infinity, +infinity)
 * - ray:     [0, +infinity)
 * - segment: [0, 1]
 *
 * The same function is intended for SVG rendering and hit testing so the
 * visible geometry and selectable geometry cannot drift apart.
 */
export function clipParametricLineToRect(
  origin: Pt,
  directionPoint: Pt,
  rect: ScreenRect,
  extent: ParametricExtent,
): readonly [Pt, Pt] | null {
  if (
    !finitePoint(origin)
    || !finitePoint(directionPoint)
    || !Number.isFinite(rect.minX)
    || !Number.isFinite(rect.minY)
    || !Number.isFinite(rect.maxX)
    || !Number.isFinite(rect.maxY)
    || rect.minX > rect.maxX
    || rect.minY > rect.maxY
  ) return null;

  const dx = directionPoint.x - origin.x;
  const dy = directionPoint.y - origin.y;
  if (Math.hypot(dx, dy) <= DIRECTION_EPSILON) return null;

  let tMin = extent === 'line' ? Number.NEGATIVE_INFINITY : 0;
  let tMax = extent === 'segment' ? 1 : Number.POSITIVE_INFINITY;

  const clipAxis = (
    coordinate: number,
    delta: number,
    minimum: number,
    maximum: number,
  ): boolean => {
    if (Math.abs(delta) <= DIRECTION_EPSILON) {
      return coordinate >= minimum && coordinate <= maximum;
    }
    const first = (minimum - coordinate) / delta;
    const second = (maximum - coordinate) / delta;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    return tMin <= tMax;
  };

  if (
    !clipAxis(origin.x, dx, rect.minX, rect.maxX)
    || !clipAxis(origin.y, dy, rect.minY, rect.maxY)
    || !Number.isFinite(tMin)
    || !Number.isFinite(tMax)
  ) return null;

  const start = {
    x: origin.x + dx * tMin,
    y: origin.y + dy * tMin,
  };
  const end = {
    x: origin.x + dx * tMax,
    y: origin.y + dy * tMax,
  };
  return finitePoint(start) && finitePoint(end) ? [start, end] : null;
}

export function clipParametricLineToFrame(
  origin: Pt,
  directionPoint: Pt,
  frame: ScreenFrame,
  extent: ParametricExtent,
  padding = 16,
): readonly [Pt, Pt] | null {
  if (
    !Number.isFinite(frame.width)
    || !Number.isFinite(frame.height)
    || frame.width <= 0
    || frame.height <= 0
    || !Number.isFinite(padding)
    || padding < 0
  ) return null;

  return clipParametricLineToRect(
    origin,
    directionPoint,
    {
      minX: -padding,
      minY: -padding,
      maxX: frame.width + padding,
      maxY: frame.height + padding,
    },
    extent,
  );
}
