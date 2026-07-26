import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TikzCodePanel } from './tikz-code-panel';

afterEach(() => cleanup());

describe('TikzCodePanel', () => {
  it('渲染初始代码', () => {
    render(<TikzCodePanel code="\\draw (A) -- (B);" issues={[]} onChange={() => {}} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('\\draw (A) -- (B);');
    expect(screen.getByRole('textbox', { name: 'TikZ 源码编辑器' })).toBeTruthy();
  });

  it('外部 code 更新（LLM/拖拽 patch）同步进编辑器且不回调 onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TikzCodePanel code="A" issues={[]} onChange={onChange} />);
    rerender(<TikzCodePanel code="B" issues={[]} onChange={onChange} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('B');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('issue 渲染为 lint 标记（含 message）', () => {
    render(
      <TikzCodePanel
        code="\\draw (A)"
        issues={[{
          severity: 'error',
          message: '未闭合',
          range: { start: 0, end: 5 },
        }]}
        onChange={() => {}}
      />,
    );
    expect(document.querySelector('.cm-lintRange-error')).toBeTruthy();
  });
});

