import { describe, expect, it } from 'vitest';
import { circularArcFromStart, circularArcPoint, flattenCircularArc } from './circular-arc';

describe('circular arc geometry kernel', () => {
  it('derives the center from TikZ current-point arc semantics', () => {
    const arc = circularArcFromStart({ x: 2, y: 0 }, 2, 0, 90);
    expect(arc.center.x).toBeCloseTo(0);
    expect(arc.center.y).toBeCloseTo(0);
    const end = circularArcPoint(arc, 90);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(2);
  });

  it('retains both exact endpoints while flattening', () => {
    const arc = circularArcFromStart({ x: 2, y: 0 }, 2, 0, 90);
    const points = flattenCircularArc(arc, 10);
    expect(points[0]).toEqual({ x: 2, y: 0 });
    expect(points.at(-1)?.x).toBeCloseTo(0);
    expect(points.at(-1)?.y).toBeCloseTo(2);
  });
});
