import { describe, expect, it } from 'vitest';
import {
  ellipticalArcFromStart,
  ellipticalArcPoint,
  ellipticalArcSvgUnitPath,
  flattenEllipticalArc,
} from './elliptical-arc';

describe('elliptical arc geometry', () => {
  it('preserves the exact affine image parameterization', () => {
    const arc = ellipticalArcFromStart(
      { x: 2, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      0,
      90,
    );
    expect(arc.center).toEqual({ x: 0, y: 0 });
    expect(ellipticalArcPoint(arc, 90).x).toBeCloseTo(1, 12);
    expect(ellipticalArcPoint(arc, 90).y).toBeCloseTo(1, 12);
    expect(flattenEllipticalArc(arc, 45)).toHaveLength(3);
  });

  it('splits full and multi-turn arcs into unambiguous SVG segments', () => {
    expect(ellipticalArcSvgUnitPath({ startAngleDeg: 0, endAngleDeg: 360 }))
      .toContain('A 1 1 0 0 1 -1');
    expect(
      ellipticalArcSvgUnitPath({ startAngleDeg: 0, endAngleDeg: -540 })
        .match(/A 1 1/g),
    ).toHaveLength(3);
  });
});
