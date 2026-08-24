import { describe, expect, it } from 'vitest';
import { cubicBezierPoint, flattenCubicBezier } from './cubic-bezier';

describe('cubic Bezier geometry kernel', () => {
  const curve = {
    start: { x: 0, y: 0 }, control1: { x: 0, y: 2 },
    control2: { x: 2, y: 2 }, end: { x: 2, y: 0 },
  };

  it('preserves endpoints and evaluates the midpoint analytically', () => {
    expect(cubicBezierPoint(curve, 0)).toEqual(curve.start);
    expect(cubicBezierPoint(curve, 1)).toEqual(curve.end);
    expect(cubicBezierPoint(curve, 0.5)).toEqual({ x: 1, y: 1.5 });
  });

  it('flattens deterministically while retaining exact endpoints', () => {
    const points = flattenCubicBezier(curve, 0.01);
    expect(points.length).toBeGreaterThan(4);
    expect(points[0]).toEqual(curve.start);
    expect(points.at(-1)).toEqual(curve.end);
  });
});
