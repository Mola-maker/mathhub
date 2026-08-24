import { describe, expect, it } from 'vitest';
import { labelOffset, labelSceneFitPoints, labelScreenBounds } from './label-layout';

describe('label scene fit bounds', () => {
  it('includes physical ink outside an above anchor', () => {
    const points = labelSceneFitPoints({ x: 1, y: 2 }, '$C$', 'above');
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(2.45);
    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThan(2);
  });

  it('includes the lower-left label extent used by exact dvisvgm bounds', () => {
    const points = labelSceneFitPoints({ x: 0, y: 0 }, '$A$', 'below left');
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(-0.5);
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(-18 / (96 / 2.54), 5);
  });

  it('matches the standalone exact surface vertical fit extent', () => {
    const above = labelSceneFitPoints({ x: 0, y: 2.8 }, '$C$', 'above');
    expect(Math.max(...above.map((point) => point.y)))
      .toBeCloseTo(2.8 + 18 / (96 / 2.54), 5);
  });

  it('scales label offsets and hit bounds with the fitted TikZ presentation', () => {
    expect(labelOffset('above right', 2)).toEqual({ x: 12, y: -12 });
    expect(labelScreenBounds({ x: 10, y: 20 }, '$A$', 'above', 2)).toEqual({
      left: 0,
      top: -20,
      right: 20,
      bottom: 14,
    });
  });
});
