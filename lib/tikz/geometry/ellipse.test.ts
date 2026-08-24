import { describe, expect, it } from 'vitest';
import { affineEllipseAxes } from './ellipse';

describe('affineEllipseAxes', () => {
  it('canonicalizes a non-uniformly scaled circle', () => {
    expect(affineEllipseAxes({ a: 2, b: 0, c: 0, d: 1 }, 1, 1))
      .toEqual({ xRadius: 2, yRadius: 1, rotationDegrees: 0 });
  });

  it('uses the exact singular axes of a slanted circle', () => {
    const axes = affineEllipseAxes({ a: 1, b: 0, c: 1, d: 1 }, 1, 1);
    expect(axes.xRadius).toBeCloseTo((1 + Math.sqrt(5)) / 2, 12);
    expect(axes.yRadius).toBeCloseTo((Math.sqrt(5) - 1) / 2, 12);
    expect(axes.rotationDegrees).toBeCloseTo(31.717474411461, 11);
    // A linear map scales ellipse area by |det(A)|.
    expect(axes.xRadius * axes.yRadius).toBeCloseTo(1, 12);
  });

  it('keeps the major axis deterministic under reflection', () => {
    expect(affineEllipseAxes({ a: -2, b: 0, c: 0, d: 1 }, 1, 1))
      .toEqual({ xRadius: 2, yRadius: 1, rotationDegrees: 0 });
  });

  it('rejects a singular image instead of fabricating a degenerate conic', () => {
    expect(() => affineEllipseAxes({ a: 1, b: 0, c: 0, d: 0 }, 1, 1))
      .toThrow(/invertible transform/iu);
  });
});
