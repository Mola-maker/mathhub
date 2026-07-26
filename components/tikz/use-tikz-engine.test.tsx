import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTikzEngine } from './use-tikz-engine';

const GOOD = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}';
const GOOD2 = '\\begin{tikzpicture}\\coordinate (B) at (1,1);\\end{tikzpicture}';

describe('useTikzEngine', () => {
  it('初始场景就绪；坏代码保持上次好场景；恢复后更新', () => {
    const { result } = renderHook(() => useTikzEngine(GOOD));
    expect(result.current.scene?.points.has('A')).toBe(true);

    act(() => {
      result.current.setCode('\\begin{tikzpicture}\\draw (0,0)');
    });
    expect(result.current.scene?.points.has('A')).toBe(true);
    expect(result.current.issues.length).toBeGreaterThan(0);

    act(() => {
      result.current.setCode(GOOD2);
    });
    expect(result.current.scene?.points.has('B')).toBe(true);
  });

  it('applyPatch 与 setCode 共享更新语义，交互状态独立', () => {
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
  });
});

