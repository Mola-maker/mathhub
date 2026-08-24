import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageContent,
  assistantHistoryText,
  presentAssistantMessage,
} from './agent-message-content';

describe('AssistantMessageContent', () => {
  it('renders Markdown and inline/display mathematics through KaTeX without raw HTML', () => {
    const { container } = render(
      <AssistantMessageContent
        content={'由 **Euler 公式** 得 $OI^2=R(R-2r)$。\n\n$$N=\\frac{O+H}{2}$$\n\n<script>bad()</script>'}
      />,
    );

    expect(screen.getByText('Euler 公式').tagName).toBe('STRONG');
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('bad()');
  });

  it('turns a bounded clarification list into choices and uses a real click event', () => {
    const onChoose = vi.fn();
    render(
      <AssistantMessageContent
        content={'当前有两个圆满足描述。\n\n请选择要修改哪个圆？\n- 外接圆 $\\Gamma$\n- 九点圆'}
        onChooseClarification={onChoose}
      />,
    );

    expect(screen.getByRole('group', { name: '澄清选项' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '九点圆' }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ value: '九点圆' }));
    expect(screen.getByText(/不会直接修改画板/u)).toBeTruthy();
  });

  it('keeps ordinary code in a collapsed artifact and never displays privileged envelopes', () => {
    render(
      <AssistantMessageContent
        content={'解释如下。\n```tikz\n\\draw (A)--(B);\n```\n```tikz-patch\n{"operations":[]}\n```'}
      />,
    );

    const summary = screen.getByText('代码附件');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    expect(screen.queryByText('{"operations":[]}')).toBeNull();
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByText('\\draw (A)--(B);')).toBeTruthy();
  });

  it('excludes display artifacts from the next model history while retaining clarification meaning', () => {
    const source = [
      '需要确认目标。',
      '```tikz',
      '\\draw (A)--(B);',
      '```',
      '请选择哪条边？',
      '- AB',
      '- AC',
    ].join('\n');

    expect(assistantHistoryText(source)).toBe('需要确认目标。\n\n请选择哪条边？\n- AB\n- AC');
    expect(assistantHistoryText(source)).not.toContain('\\draw');
    expect(presentAssistantMessage(source).artifacts).toHaveLength(1);
  });
});
