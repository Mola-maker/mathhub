import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTikzEngine } from './use-tikz-engine';

const GOOD = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}';
const GOOD2 = '\\begin{tikzpicture}\\coordinate (B) at (1,1);\\end{tikzpicture}';

describe('useTikzEngine', () => {
  it('坏代码保留上一版只读语义投影；恢复后切回当前 revision', () => {
    const { result } = renderHook(() => useTikzEngine(GOOD));
    expect(result.current.scene?.points.has('A')).toBe(true);
    expect(result.current.scene?.sourceRevision).toBe(0);

    act(() => {
      result.current.setCode('\\begin{tikzpicture}\\draw (0,0)');
    });
    expect(result.current.scene?.points.has('A')).toBe(true);
    expect(result.current.scene?.sourceRevision).toBe(0);
    expect(result.current.semanticProjectionState).toBe('stale');
    expect(result.current.interactiveWritebackSafe).toBe(false);
    expect(result.current.issues.length).toBeGreaterThan(0);
    expect(result.current.revision).toBe(1);

    act(() => {
      result.current.setCode(GOOD2);
    });
    expect(result.current.scene?.points.has('B')).toBe(true);
    expect(result.current.scene?.sourceRevision).toBe(2);
  });

  it('applyPatch 产生最小源码交易，交互状态独立', () => {
    const { result } = renderHook(() => useTikzEngine(GOOD));
    act(() => {
      result.current.applyPatch(GOOD2);
      result.current.setSelection(['B']);
      result.current.setActiveTool('drag');
      result.current.setViewport({ scale: 20, offsetX: 10, offsetY: 30 });
    });
    expect(result.current.code).toBe(GOOD2);
    expect(result.current.selection).toEqual(['B']);
    expect(result.current.activeTool).toBe('drag');
    expect(result.current.viewport.scale).toBe(20);
    expect(result.current.document.getSnapshot().lastTransaction?.origin).toBe('canvas');
  });
});
