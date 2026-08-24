import { describe, expect, it } from 'vitest';
import type { DecodedRenderPrimitive } from './render-primitive-decoder';
import {
  normalizedScreenRect,
  renderPrimitivesInScreenRect,
  renderPrimitivesScreenBounds,
} from './selection-marquee';

const base = {
  entityIds: ['entity:AB'], sourceBindingIds: ['binding:AB'],
  statementIndex: 0, references: ['A', 'B'],
  style: {
    stroke: '#000', strokeWidth: 1, dashOffset: 0,
    lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 10,
    strokeOpacity: 1, textOpacity: 1,
    arrow: 'none' as const, arrowTip: 'to' as const, fillOpacity: 1, opacity: 1,
  },
  zIndex: 0, interactive: true,
};

describe('selection marquee', () => {
  it('normalizes either drag direction and selects intersecting primitives', () => {
    const segment: DecodedRenderPrimitive = {
      ...base, primitiveId: 'segment:AB', kind: 'segment',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
    };
    const outside: DecodedRenderPrimitive = {
      ...base, primitiveId: 'point:C', entityIds: ['point:C'], kind: 'point',
      position: { x: 9, y: 9 }, pointName: 'C', free: true,
    };
    const rect = normalizedScreenRect({ x: 60, y: 60 }, { x: 0, y: 0 });
    expect(renderPrimitivesInScreenRect(
      [segment, outside], rect,
      { scale: 10, offsetX: 10, offsetY: 10 },
      { width: 200, height: 200 },
    ).map((primitive) => primitive.primitiveId)).toEqual(['segment:AB']);
  });

  it('distinguishes containment selection from crossing selection', () => {
    const segment: DecodedRenderPrimitive = {
      ...base, primitiveId: 'segment:AB', kind: 'segment',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    };
    const rect = normalizedScreenRect({ x: 40, y: 0 }, { x: 80, y: 20 });
    const primitives = [segment];
    const viewport = { scale: 10, offsetX: 0, offsetY: 10 };
    const frame = { width: 200, height: 200 };
    expect(renderPrimitivesInScreenRect(primitives, rect, viewport, frame, 'contain'))
      .toEqual([]);
    expect(renderPrimitivesInScreenRect(primitives, rect, viewport, frame, 'intersect'))
      .toEqual([segment]);
  });

  it('uses defining points instead of the clipped viewport for infinite-line transform bounds', () => {
    const line: DecodedRenderPrimitive = {
      ...base, primitiveId: 'line:AB', kind: 'line',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    };
    expect(renderPrimitivesScreenBounds(
      [line],
      { scale: 10, offsetX: 5, offsetY: 100 },
      { width: 1000, height: 800 },
    )).toEqual({ left: 15, top: 60, right: 35, bottom: 80 });
  });

  it('includes circle extents in the common transform bounds', () => {
    const circle: DecodedRenderPrimitive = {
      ...base,
      primitiveId: 'circle:O',
      entityIds: ['circle:O'],
      kind: 'circle',
      center: { x: 2, y: 3 },
      radius: 2,
    };
    expect(renderPrimitivesScreenBounds(
      [circle],
      { scale: 10, offsetX: 0, offsetY: 100 },
      { width: 300, height: 300 },
    )).toEqual({ left: 0, top: 50, right: 40, bottom: 90 });
  });

  it('uses the visible affine arc rather than the source circle for bounds', () => {
    const arc: DecodedRenderPrimitive = {
      ...base,
      primitiveId: 'elliptical-arc:1',
      entityIds: ['elliptical-arc:1'],
      kind: 'elliptical-arc',
      center: { x: 0, y: 0 },
      axisX: { x: 2, y: 0 },
      axisY: { x: 1, y: 1 },
      xRadius: 2.288245611270737,
      yRadius: 0.8740320488976422,
      rotationDegrees: 13.282525588539,
      startAngleDeg: 0,
      endAngleDeg: 90,
      start: { x: 2, y: 0 },
      end: { x: 1, y: 1 },
    };
    const bounds = renderPrimitivesScreenBounds(
      [arc],
      { scale: 10, offsetX: 0, offsetY: 20 },
      { width: 300, height: 300 },
    );
    expect(bounds?.left).toBeCloseTo(10, 12);
    expect(bounds?.top).toBeCloseTo(10, 12);
    // Bounds use a 3-degree interaction polyline; it must remain within one
    // hundredth of a screen pixel of the analytical x-extremum.
    expect(bounds?.right).toBeCloseTo(Math.sqrt(5) * 10, 2);
    expect(bounds?.bottom).toBeCloseTo(20, 12);
  });
});
