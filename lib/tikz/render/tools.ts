import type { PointerEvent as ReactPointerEvent } from 'react';
import { patchCoordinateLiteral } from '../patch/source-patch';
import type { Pt } from '../semantics/calc-eval';
import type { Scene } from '../semantics/scene';
import type { SourceRange } from '../subset/ast';
import { hitTestElement, hitTestPointHandle } from './hit-test';
import type { Viewport } from './viewport';

export interface ToolContext {
  code: string;
  scene: Scene;
  viewport: Viewport;
  freePointRanges: Map<string, SourceRange>;
  applyPatch(next: string): void;
  previewPatch?(next: string | null): void;
  setSelection(refs: string[], stmtIndex?: number | null): void;
  toScenePoint(clientX: number, clientY: number): Pt;
  toClientPoint(scenePoint: Pt): Pt;
}

export interface Tool {
  id: string;
  label: string;
  cursor: string;
  onPointerDown?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerMove?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerUp?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerCancel?(event: ReactPointerEvent, context: ToolContext): void;
}

let drag: { pointName: string; baseCode: string; range: SourceRange; pendingCode: string | null } | null = null;

function localScreen(event: ReactPointerEvent, context: ToolContext): Pt {
  return context.toClientPoint(context.toScenePoint(event.clientX, event.clientY));
}

function clearDrag(context: ToolContext): void {
  drag = null;
  context.previewPatch?.(null);
}

export const selectTool: Tool = {
  id: 'select',
  label: '选择/拖拽',
  cursor: 'default',
  onPointerDown(event, context) {
    const screen = localScreen(event, context);
    const pointName = hitTestPointHandle(screen, context.scene, context.viewport, 12);
    if (pointName) {
      context.setSelection([pointName]);
      const range = context.freePointRanges.get(pointName);
      if (range) {
        drag = { pointName, baseCode: context.code, range, pendingCode: null };
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }
      return;
    }

    const hit = hitTestElement(screen, context.scene, context.viewport, 8);
    context.setSelection(hit ? hit.refs : [], hit?.stmtIndex ?? null);
  },
  onPointerMove(event, context) {
    if (!drag) return;
    const next = context.toScenePoint(event.clientX, event.clientY);
    drag.pendingCode = patchCoordinateLiteral(drag.baseCode, drag.range, next);
    context.previewPatch?.(drag.pendingCode);
    event.preventDefault();
  },
  onPointerUp(event, context) {
    if (!drag) return;
    const pendingCode = drag.pendingCode;
    if (pendingCode) context.applyPatch(pendingCode);
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    clearDrag(context);
  },
  onPointerCancel(_event, context) {
    clearDrag(context);
  },
};

export const toolRegistry: ReadonlyMap<string, Tool> = new Map([
  [selectTool.id, selectTool],
]);
