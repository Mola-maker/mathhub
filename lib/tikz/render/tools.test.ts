import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { applyTextPatch, type TextPatch } from '../document/source-transaction';
import type { Scene } from '../semantics/scene';
import { createToolInteractionSession, selectTool, type ToolContext } from './tools';

const CODE = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
const scene: Scene = {
  sourceRevision: 0,
  points: new Map([
    ['A', { stableId: 'point-a', name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
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
    const patches: TextPatch[] = [];
    const previews: Array<string | null> = [];
    const context: ToolContext = {
      session: createToolInteractionSession(),
      code: CODE,
      revision: 0,
      scene,
      viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      applySourcePatches: (nextPatches) => {
        patches.push(...nextPatches);
        return true;
      },
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
    selectTool.onPointerMove!(event(130, 80), context);
    expect(patches).toHaveLength(0);
    expect(previews.at(-1)).toContain('(3,2)');
    selectTool.onPointerUp!(event(130, 80), context);
    expect(patches).toHaveLength(1);
    expect(applyTextPatch(CODE, patches[0])).toContain('(3,2)');
    expect(previews.at(-1)).toBeNull();
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
});
