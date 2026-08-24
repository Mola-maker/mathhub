import { describe, expect, it } from 'vitest';
import {
  canvasInteractionAcceptsPointer,
  canvasInteractionOwnsPreview,
  canvasInteractionPreviewOwner,
  canvasInteractionReducer,
  createCanvasInteractionSession,
  type CanvasInteractionBasis,
} from './canvas-interaction-session';

const basis: CanvasInteractionBasis = {
  revision: 7,
  sourceHash: 'source-7',
  kernelHash: 'kernel-7',
  projectionHash: 'projection-7',
};

describe('CanvasInteractionSession', () => {
  it('owns one marquee pointer and ignores a competing pointer', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-marquee',
      pointerId: 11,
      start: { x: 10, y: 20 },
      additive: false,
      baseTargets: [],
    });
    const competing = canvasInteractionReducer(started, {
      type: 'begin-transform',
      pointerId: 12,
      start: { x: 30, y: 40 },
      handle: 'move',
      bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    });
    const moved = canvasInteractionReducer(competing, {
      type: 'move', pointerId: 11, current: { x: 50, y: 60 },
    });

    expect(competing).toBe(started);
    expect(moved).toMatchObject({
      phase: 'box-selecting',
      pointerId: 11,
      current: { x: 50, y: 60 },
    });
  });

  it('rejects a competing pointer before a mutable drag tool can run', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 11,
      start: { x: 10, y: 20 },
      toolId: 'select',
      phase: 'dragging',
    });

    expect(canvasInteractionAcceptsPointer(started, {
      kind: 'pointer-down', pointerId: 12, toolId: 'select',
    })).toBe(false);
    expect(canvasInteractionAcceptsPointer(started, {
      kind: 'pointer-move', pointerId: 12, toolId: 'select',
    })).toBe(false);
    expect(canvasInteractionAcceptsPointer(started, {
      kind: 'pointer-up', pointerId: 11, toolId: 'select',
    })).toBe(true);
  });

  it('allows a new pointer only when it continues the same multi-tap construction', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 11,
      start: { x: 10, y: 20 },
      toolId: 'segment',
      phase: 'constructing',
    });

    expect(canvasInteractionAcceptsPointer(started, {
      kind: 'pointer-down', pointerId: 29, toolId: 'segment',
    })).toBe(true);
    expect(canvasInteractionAcceptsPointer(started, {
      kind: 'pointer-down', pointerId: 29, toolId: 'circle',
    })).toBe(false);
  });

  it('cancels an active gesture when the source revision changes', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-transform',
      pointerId: 2,
      start: { x: 10, y: 10 },
      handle: 'rotate',
      bounds: { left: 0, top: 0, right: 20, bottom: 20 },
    });
    const stale = canvasInteractionReducer(started, {
      type: 'synchronize',
      basis: { ...basis, revision: 8, sourceHash: 'source-8' },
      toolId: 'select',
    });

    expect(stale).toMatchObject({
      phase: 'idle',
      basis: { revision: 8 },
      lastOutcome: { result: 'cancelled', reason: 'stale-revision' },
    });
  });

  it('cancels on tool switch and records explicit Escape cancellation', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 4,
      start: { x: 1, y: 2 },
      toolId: 'segment',
      phase: 'constructing',
    });
    const switched = canvasInteractionReducer(started, {
      type: 'synchronize', basis, toolId: 'pan',
    });
    expect(switched).toMatchObject({
      phase: 'idle',
      toolId: 'pan',
      lastOutcome: { reason: 'tool-switch' },
    });

    const transformed = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-transform',
      pointerId: 9,
      start: { x: 4, y: 5 },
      handle: 'move',
      bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    });
    const escaped = canvasInteractionReducer(transformed, {
      type: 'cancel', reason: 'escape',
    });
    expect(escaped).toMatchObject({
      phase: 'idle',
      lastOutcome: { result: 'cancelled', reason: 'escape' },
    });
  });

  it('finishes only the pointer that owns the session', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 5,
      start: { x: 0, y: 0 },
      toolId: 'pan',
      phase: 'panning',
    });
    expect(canvasInteractionReducer(started, { type: 'finish', pointerId: 6 }))
      .toBe(started);
    expect(canvasInteractionReducer(started, { type: 'finish', pointerId: 5 }))
      .toMatchObject({
        phase: 'idle',
        lastOutcome: { result: 'completed' },
      });
  });

  it('keeps one construction interaction while pointer ownership changes between taps', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 11,
      start: { x: 20, y: 30 },
      toolId: 'segment',
      phase: 'constructing',
    });
    const continued = canvasInteractionReducer(started, {
      type: 'begin-tool',
      pointerId: 29,
      start: { x: 80, y: 90 },
      toolId: 'segment',
      phase: 'constructing',
    });

    expect(continued).toMatchObject({
      phase: 'constructing',
      interactionId: 'canvas:7:1:11:constructing',
      pointerId: 29,
      start: { x: 80, y: 90 },
      current: { x: 80, y: 90 },
      sequence: 1,
    });
    expect(canvasInteractionReducer(continued, {
      type: 'finish',
      pointerId: 29,
    })).toMatchObject({
      phase: 'idle',
      lastOutcome: {
        interactionId: 'canvas:7:1:11:constructing',
        result: 'completed',
      },
    });
  });

  it('keeps preview ownership on one interaction and rejects stale late previews', () => {
    const started = canvasInteractionReducer(createCanvasInteractionSession(basis), {
      type: 'begin-tool',
      pointerId: 11,
      start: { x: 20, y: 30 },
      toolId: 'segment',
      phase: 'constructing',
    });
    const owner = canvasInteractionPreviewOwner(started);
    expect(owner).toMatchObject({
      interactionId: 'canvas:7:1:11:constructing',
      toolId: 'segment',
      basis,
    });

    const continued = canvasInteractionReducer(started, {
      type: 'begin-tool',
      pointerId: 29,
      start: { x: 80, y: 90 },
      toolId: 'segment',
      phase: 'constructing',
    });
    expect(canvasInteractionOwnsPreview(continued, owner)).toBe(true);

    const synchronized = canvasInteractionReducer(continued, {
      type: 'synchronize',
      basis: { ...basis, revision: 8, sourceHash: 'source-8' },
      toolId: 'segment',
    });
    expect(canvasInteractionOwnsPreview(synchronized, owner)).toBe(false);
    expect(canvasInteractionPreviewOwner(synchronized)).toBeNull();
  });
});
