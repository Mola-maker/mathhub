import { describe, expect, it } from 'vitest';
import type { DecodedRenderPrimitiveSet } from './render-primitive-decoder';
import { hitTestRenderPrimitives } from './render-primitive-hit-test';

describe('hitTestRenderPrimitives', () => {
  it('returns canonical point provenance from RenderingTruth', () => {
    const rendering: DecodedRenderPrimitiveSet = {
      issues: [],
      primitives: [{
        primitiveId: 'interactive:point:A',
        entityIds: ['point:A'],
        sourceStableId: 'point:A',
        sourceBindingIds: ['binding:point:A'],
        sourceRange: { start: 20, end: 46 },
        statementIndex: 0,
        references: [],
        style: {
          stroke: '#111111',
          strokeWidth: 1,
          dashOffset: 0,
          lineCap: 'butt',
          lineJoin: 'miter',
          miterLimit: 10,
          strokeOpacity: 1,
          textOpacity: 1,
          arrow: 'none',
          arrowTip: 'to',
          fillOpacity: 1,
          opacity: 1,
        },
        zIndex: 1,
        interactive: true,
        kind: 'point',
        position: { x: 0, y: 0 },
        pointName: 'A',
        free: true,
      }],
    };

    expect(hitTestRenderPrimitives(
      { x: 101, y: 99 },
      rendering,
      { scale: 10, offsetX: 100, offsetY: 100 },
      { width: 200, height: 200 },
      8,
    )).toEqual(expect.objectContaining({
      primitiveId: 'interactive:point:A',
      entityId: 'point:A',
      sourceStableId: 'point:A',
      sourceBindingIds: ['binding:point:A'],
      pointName: 'A',
      distance: Math.SQRT2,
    }));
  });

  it('hits a cubic Bezier by its curve rather than its control polygon', () => {
    const rendering: DecodedRenderPrimitiveSet = {
      issues: [],
      primitives: [{
        primitiveId: 'interactive:curve', entityIds: ['curve'],
        sourceBindingIds: ['binding:curve'], statementIndex: 0,
        references: ['A', 'C1', 'C2', 'B'],
        style: {
          stroke: '#111111', strokeWidth: 1, dashOffset: 0,
          lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
          strokeOpacity: 1, textOpacity: 1,
          arrow: 'none', arrowTip: 'to', fillOpacity: 1, opacity: 1,
        },
        zIndex: 1, interactive: true, kind: 'cubic-bezier',
        start: { x: 0, y: 0 }, control1: { x: 0, y: 2 },
        control2: { x: 2, y: 2 }, end: { x: 2, y: 0 },
      }],
    };
    expect(hitTestRenderPrimitives(
      { x: 10, y: -15 }, rendering,
      { scale: 10, offsetX: 0, offsetY: 0 },
      { width: 100, height: 100 }, 2,
    )?.primitiveId).toBe('interactive:curve');
  });

  it('hits the visible ellipse boundary with canonical provenance', () => {
    const rendering: DecodedRenderPrimitiveSet = {
      issues: [],
      primitives: [{
        primitiveId: 'interactive:ellipse', entityIds: ['ellipse'],
        sourceBindingIds: ['binding:ellipse'], statementIndex: 2,
        references: ['O'],
        style: {
          stroke: '#111111', strokeWidth: 1, dashOffset: 0,
          lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
          strokeOpacity: 1, textOpacity: 1,
          arrow: 'none', arrowTip: 'to', fillOpacity: 1, opacity: 1,
        },
        zIndex: 1, interactive: true, kind: 'ellipse',
        center: { x: 0, y: 0 }, xRadius: 2, yRadius: 1,
        rotationDegrees: 0,
      }],
    };
    expect(hitTestRenderPrimitives(
      { x: 20, y: 0 }, rendering,
      { scale: 10, offsetX: 0, offsetY: 0 },
      { width: 100, height: 100 }, 2,
    )).toMatchObject({ entityId: 'ellipse', kind: 'ellipse', statementIndex: 2 });
  });

  it('hit-tests a rotated ellipse in world space rather than its old axis-aligned outline', () => {
    const rendering: DecodedRenderPrimitiveSet = {
      issues: [],
      primitives: [{
        primitiveId: 'interactive:rotated-ellipse', entityIds: ['rotated-ellipse'],
        sourceBindingIds: ['binding:rotated-ellipse'], statementIndex: 3,
        references: [],
        style: {
          stroke: '#111111', strokeWidth: 1, dashOffset: 0,
          lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
          strokeOpacity: 1, textOpacity: 1,
          arrow: 'none', arrowTip: 'to', fillOpacity: 1, opacity: 1,
        },
        zIndex: 1, interactive: true, kind: 'ellipse',
        center: { x: 0, y: 0 }, xRadius: 2, yRadius: 1,
        rotationDegrees: 90,
      }],
    };
    expect(hitTestRenderPrimitives(
      { x: 0, y: -20 }, rendering,
      { scale: 10, offsetX: 0, offsetY: 0 },
      { width: 100, height: 100 }, 2,
    )).toMatchObject({ entityId: 'rotated-ellipse' });
    expect(hitTestRenderPrimitives(
      { x: 20, y: 0 }, rendering,
      { scale: 10, offsetX: 0, offsetY: 0 },
      { width: 100, height: 100 }, 2,
    )).toBeNull();
  });

  it('hits the actual affine elliptical-arc boundary', () => {
    const rendering: DecodedRenderPrimitiveSet = {
      issues: [],
      primitives: [{
        primitiveId: 'interactive:elliptical-arc', entityIds: ['elliptical-arc'],
        sourceBindingIds: ['binding:elliptical-arc'], statementIndex: 4,
        references: [],
        style: {
          stroke: '#111111', strokeWidth: 1, dashOffset: 0,
          lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
          strokeOpacity: 1, textOpacity: 1,
          arrow: 'none', arrowTip: 'to', fillOpacity: 1, opacity: 1,
        },
        zIndex: 1, interactive: true, kind: 'elliptical-arc',
        center: { x: 0, y: 0 },
        axisX: { x: 2, y: 0 }, axisY: { x: 1, y: 1 },
        xRadius: 2.288245611270737, yRadius: 0.8740320488976422,
        rotationDegrees: 13.282525588539,
        startAngleDeg: 0, endAngleDeg: 90,
        start: { x: 2, y: 0 }, end: { x: 1, y: 1 },
      }],
    };
    expect(hitTestRenderPrimitives(
      { x: Math.sqrt(5) * 10, y: -Math.sqrt(0.2) * 10 },
      rendering,
      { scale: 10, offsetX: 0, offsetY: 0 },
      { width: 100, height: 100 },
      2,
    )).toMatchObject({ entityId: 'elliptical-arc', kind: 'elliptical-arc' });
  });
});
