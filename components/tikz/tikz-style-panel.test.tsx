import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseTikz } from '@/lib/tikz/subset/parser';
import { TikzStylePanel } from './tikz-style-panel';

describe('TikzStylePanel', () => {
  it('未选中可样式化元素时给出操作提示', () => {
    render(<TikzStylePanel engine={{
      code: '',
      stmts: [],
      selectedStmtIndex: null,
      applyPatch: vi.fn(),
    }} />);
    expect(screen.getByText('在画布中点击一个图形元素以调整样式。')).toBeTruthy();
  });

  it('修改颜色后把 options 原位补进源代码', () => {
    const code = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';
    const applyPatch = vi.fn();
    render(<TikzStylePanel engine={{
      code,
      stmts: parseTikz(code).statements,
      selectedStmtIndex: 0,
      applyPatch,
    }} />);

    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: 'red' } });
    expect(applyPatch).toHaveBeenCalledWith(expect.stringContaining('\\draw[red]'));
  });
});
