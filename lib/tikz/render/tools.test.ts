import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Scene } from '../semantics/scene';
import {
  cancelActiveToolInteraction,
  createToolInteractionSession,
  selectTool,
  toolInteractionPhase,
  type ToolContext,
} from './tools';

const CODE = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
const scene: Scene = {
  sourceRevision: 0,
  points: new Map([
    ['A', { stableId: 'tz_runtime_A', name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
  ]),
  elements: [],
  issues: [],
  graphOrder: ['A'],
};
const rangeStart = CODE.indexOf('(0,0)');

const event = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  currentTarget: {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  },
  preventDefault: vi.fn(),
}) as unknown as ReactPointerEvent;

describe('selectTool 拖拽', () => {
  it('拖自由点 → pointer up 时只提交一次，move 期间提供预览', () => {
    const commitCanvasPointMove = vi.fn(() => ({
      handled: true,
      committed: true,
    }));
    const previews: Array<string | null> = [];
    const completeInteraction = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      applySourcePatches: vi.fn(() => true),
      commitCanvasPointMove,
      completeInteraction,
      previewPatch: (next) => previews.push(next),
      setSelection: vi.fn(),
      setViewport: vi.fn(),
      toScenePoint: (clientX, clientY) => ({
        x: (clientX - 100) / 10,
        y: -(clientY - 100) / 10,
      }),
      toClientPoint: (point) => ({
        x: point.x * 10 + 100,
        y: -point.y * 10 + 100,
      }),
    };

    selectTool.onPointerDown!(event(100, 100), context);
    expect(toolInteractionPhase(context.session)).toBe('dragging');
    selectTool.onPointerMove!(event(130, 80), context);
    expect(commitCanvasPointMove).not.toHaveBeenCalled();
    expect(previews.at(-1)).toContain('(3,2)');
    selectTool.onPointerUp!(event(130, 80), context);
    expect(commitCanvasPointMove).toHaveBeenCalledTimes(1);
    expect(commitCanvasPointMove).toHaveBeenCalledWith(
      'point:A',
      'A',
      { x: 3, y: 2 },
      0,
    );
    expect(previews.at(-1)).toBeNull();
    expect(completeInteraction).toHaveBeenCalledWith(1);
    expect(toolInteractionPhase(context.session)).toBe('idle');
  });

  it('reports a Broker-rejected drag as a cancelled interaction', () => {
    const cancelInteraction = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      applySourcePatches: vi.fn(() => false),
      commitCanvasPointMove: vi.fn(() => ({
        handled: true,
        committed: false,
        message: 'stale proposal',
      })),
      cancelInteraction,
      previewPatch: vi.fn(),
      setSelection: vi.fn(),
      setViewport: vi.fn(),
      toScenePoint: (clientX, clientY) => ({
        x: (clientX - 100) / 10,
        y: -(clientY - 100) / 10,
      }),
      toClientPoint: (point) => ({
        x: point.x * 10 + 100,
        y: -point.y * 10 + 100,
      }),
    };

    selectTool.onPointerDown!(event(100, 100), context);
    selectTool.onPointerMove!(event(120, 80), context);
    selectTool.onPointerUp!(event(120, 80), context);

    expect(cancelInteraction).toHaveBeenCalledWith(1, 'commit-rejected');
    expect(toolInteractionPhase(context.session)).toBe('idle');
  });

  it('managed point commit is handled by the semantic callback without raw fallback', () => {
    const applySourcePatches = vi.fn(() => true);
    const commitCanvasPointMove = vi.fn(() => ({
      handled: true,
      committed: true,
    }));
    const setSelectionTargets = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      applySourcePatches,
      commitCanvasPointMove,
      previewPatch: vi.fn(),
      setSelection: vi.fn(),
      setSelectionTargets,
      setViewport: vi.fn(),
      toScenePoint: (clientX, clientY) => ({
        x: (clientX - 100) / 10,
        y: -(clientY - 100) / 10,
      }),
      toClientPoint: (point) => ({
        x: point.x * 10 + 100,
        y: -point.y * 10 + 100,
      }),
    };

    selectTool.onPointerDown!(event(100, 100), context);
    selectTool.onPointerMove!(event(130, 80), context);
    selectTool.onPointerUp!(event(130, 80), context);

    expect(commitCanvasPointMove).toHaveBeenCalledWith(
      'point:A',
      'A',
      { x: 3, y: 2 },
      0,
    );
    expect(setSelectionTargets).toHaveBeenCalledWith([expect.objectContaining({
      kind: 'entity',
      stableId: 'point:A',
      semanticEntityId: 'point:A',
      sourceBindingIds: ['binding:point:A'],
    })]);
    expect(applySourcePatches).not.toHaveBeenCalled();
  });

  it('uses canonical render provenance instead of the reconciled Scene point id', () => {
    const setSelectionTargets = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map(),
      applySourcePatches: vi.fn(() => true),
      hitTestRenderPrimitive: () => ({
        kind: 'point',
        pointName: 'A',
        sourceStableId: 'point:A',
        semanticEntityId: 'point:A',
        renderPrimitiveId: 'interactive:point:A',
        sourceBindingIds: ['binding:point:A'],
        sourceRange: { start: 20, end: 46 },
        stmtIndex: 0,
        refs: [],
        distance: 0,
      }),
      setSelection: vi.fn(),
      setSelectionTargets,
      setViewport: vi.fn(),
      toScenePoint: (x, y) => ({ x: (x - 100) / 10, y: -(y - 100) / 10 }),
      toClientPoint: (point) => ({ x: point.x * 10 + 100, y: -point.y * 10 + 100 }),
    };

    selectTool.onPointerDown!(event(100, 100), context);

    expect(setSelectionTargets).toHaveBeenCalledWith([{
      kind: 'entity',
      sourceRevision: 0,
      stableId: 'point:A',
      stmtIndex: 0,
      entityKind: 'point',
      refs: ['A'],
      semanticEntityId: 'point:A',
      renderPrimitiveId: 'interactive:point:A',
      sourceBindingIds: ['binding:point:A'],
      sourceRange: { start: 20, end: 46 },
    }]);
  });

  it('toggles canonical targets with Shift without starting a drag', () => {
    const selectedA = {
      kind: 'entity' as const,
      sourceRevision: 0,
      stableId: 'point:A',
      stmtIndex: 0,
      entityKind: 'point' as const,
      refs: ['A'],
      semanticEntityId: 'point:A',
      sourceBindingIds: ['binding:point:A'],
    };
    const setSelectionTargets = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      selectionTargets: [selectedA],
      applySourcePatches: vi.fn(() => true),
      commitCanvasPointMove: vi.fn(),
      setSelection: vi.fn(),
      setSelectionTargets,
      setViewport: vi.fn(),
      toScenePoint: (x, y) => ({ x: (x - 100) / 10, y: -(y - 100) / 10 }),
      toClientPoint: (point) => ({ x: point.x * 10 + 100, y: -point.y * 10 + 100 }),
    };
    const shifted = {
      ...event(100, 100),
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
    } as unknown as ReactPointerEvent;

    selectTool.onPointerDown!(shifted, context);

    expect(setSelectionTargets).toHaveBeenCalledWith([]);
    expect(context.session.drag).toBeNull();
  });

  it('派生点可选中但不可拖拽', () => {
    const derivedScene: Scene = {
      ...scene,
      points: new Map([
        ['M', { stableId: 'point-m', name: 'M', position: { x: 0, y: 0 }, free: false, dependsOn: ['A'], stmtIndex: 0 }],
      ]),
    };
    const setSelection = vi.fn();
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene: derivedScene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map(),
      applySourcePatches: vi.fn(() => true),
      setSelection,
      setViewport: vi.fn(),
      toScenePoint: (x, y) => ({ x: (x - 100) / 10, y: -(y - 100) / 10 }),
      toClientPoint: (point) => ({ x: point.x * 10 + 100, y: -point.y * 10 + 100 }),
    };
    selectTool.onPointerDown!(event(100, 100), context);
    selectTool.onPointerMove!(event(130, 80), context);
    selectTool.onPointerUp!(event(130, 80), context);
    expect(setSelection).toHaveBeenCalledWith(['M'], 0);
    expect(context.applySourcePatches).not.toHaveBeenCalled();
  });

  it('aborts the active solver request when the Canvas interaction is cancelled', () => {
    const derivedScene: Scene = {
      ...scene,
      points: new Map([
        ['M', {
          stableId: 'point-m',
          name: 'M',
          position: { x: 0, y: 0 },
          free: false,
          dependsOn: ['A'],
          stmtIndex: 0,
        }],
      ]),
    };
    let solverSignal: AbortSignal | undefined;
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene: derivedScene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map(),
      applySourcePatches: vi.fn(() => true),
      solveDerivedDrag: vi.fn((_name, _target, _revision, signal) => {
        solverSignal = signal;
        return new Promise<never>(() => undefined);
      }),
      previewPatch: vi.fn(),
      setSelection: vi.fn(),
      setViewport: vi.fn(),
      toScenePoint: (x, y) => ({ x: (x - 100) / 10, y: -(y - 100) / 10 }),
      toClientPoint: (point) => ({ x: point.x * 10 + 100, y: -point.y * 10 + 100 }),
    };

    selectTool.onPointerDown!(event(100, 100), context);
    selectTool.onPointerMove!(event(130, 80), context);
    expect(solverSignal?.aborted).toBe(false);

    cancelActiveToolInteraction(context.session, context);

    expect(solverSignal?.aborted).toBe(true);
    expect(context.session.drag).toBeNull();
  });
});
