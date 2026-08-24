import { describe, expect, it } from 'vitest';
import {
  selectionTransformFromGesture,
  selectionTransformHandleLayout,
  selectionTransformPreviewLayout,
  selectionTransformPreviewSvgTransform,
} from './selection-transform-handles';

const bounds = { left: 10, top: 20, right: 110, bottom: 80 };

describe('selection transform handles', () => {
  it('keeps handle geometry in screen pixels', () => {
    const layout = selectionTransformHandleLayout(bounds);
    expect(layout.center).toEqual({ x: 60, y: 50 });
    expect(layout.rotation).toEqual({ x: 60, y: -12 });
  });

  it('converts screen translation into scene coordinates', () => {
    expect(selectionTransformFromGesture({
      pointerId: 1,
      handle: 'move',
      revision: 7,
      bounds,
      start: { x: 30, y: 40 },
      current: { x: 50, y: 60 },
    }, 10)).toEqual({ kind: 'translate', dx: 2, dy: -2 });
  });

  it('snaps rotation and previews scale from the frozen selection center', () => {
    const rotate = selectionTransformFromGesture({
      pointerId: 1,
      handle: 'rotate',
      revision: 7,
      bounds,
      start: { x: 60, y: -12 },
      current: { x: 122, y: 50 },
    }, 10, true);
    expect(rotate).toEqual({ kind: 'rotate', degrees: -90, center: 'selection' });

    const preview = selectionTransformPreviewLayout({
      pointerId: 1,
      handle: 'scale-se',
      revision: 7,
      bounds,
      start: { x: 110, y: 80 },
      current: { x: 160, y: 110 },
    });
    expect(preview.layout.bounds.right).toBeGreaterThan(110);
    expect(preview.layout.center).toEqual({ x: 60, y: 50 });
  });

  it('never lets a corner gesture collapse or explode the selection', () => {
    const base = {
      pointerId: 1,
      handle: 'scale-ne' as const,
      revision: 7,
      bounds,
      start: { x: 110, y: 20 },
    };
    expect(selectionTransformFromGesture({
      ...base,
      current: { x: 60, y: 50 },
    }, 10)).toEqual({ kind: 'scale', factor: 0.05, center: 'selection' });
    expect(selectionTransformFromGesture({
      ...base,
      current: { x: 1_000_000, y: 1_000_000 },
    }, 10)).toEqual({ kind: 'scale', factor: 100, center: 'selection' });
  });

  it('rejects a non-positive viewport scale', () => {
    expect(() => selectionTransformFromGesture({
      pointerId: 1,
      handle: 'move',
      revision: 7,
      bounds,
      start: { x: 10, y: 10 },
      current: { x: 20, y: 20 },
    }, 0)).toThrow(/Viewport scale/);
  });

  it('uses the same frozen pivot for the geometry ghost transform', () => {
    expect(selectionTransformPreviewSvgTransform({
      pointerId: 1,
      handle: 'move',
      revision: 7,
      bounds,
      start: { x: 30, y: 40 },
      current: { x: 50, y: 65 },
    })).toBe('translate(20 25)');
    expect(selectionTransformPreviewSvgTransform({
      pointerId: 1,
      handle: 'scale-se',
      revision: 7,
      bounds,
      start: { x: 110, y: 80 },
      current: { x: 160, y: 110 },
    })).toMatch(/^translate\(60 50\) scale\(.+\) translate\(-60 -50\)$/);
  });
});
