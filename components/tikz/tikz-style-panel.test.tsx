import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseTikz } from '@/lib/tikz/subset/parser';
import { TikzStylePanel } from './tikz-style-panel';

describe('TikzStylePanel', () => {
  it('未选中可样式化元素时给出操作提示', () => {
    render(<TikzStylePanel engine={{
      code: '',
      revision: 0,
      interactiveWritebackSafe: true,
      stmts: [],
      selectedStmtIndex: null,
      applySourcePatch: vi.fn(),
      setSelection: vi.fn(),
    }} />);
    expect(screen.getByText('在画布中点击一个图形元素以调整样式。')).toBeTruthy();
  });

  it('修改颜色后把 options 原位补进源代码', () => {
    const code = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';
    const applySourcePatch = vi.fn();
    render(<TikzStylePanel engine={{
      code,
      revision: 3,
      interactiveWritebackSafe: true,
      stmts: parseTikz(code).statements,
      selectedStmtIndex: 0,
      applySourcePatch,
      setSelection: vi.fn(),
    }} />);

    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: 'red' } });
    expect(applySourcePatch).toHaveBeenCalledWith(
      expect.objectContaining({ insert: '[red]' }),
      'style',
      3,
    );
  });
});
