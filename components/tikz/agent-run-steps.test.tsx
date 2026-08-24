import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { tikzAgentEvent } from '@/lib/tikz/agent/protocol';
import { emptyTikzAgentRun, reduceTikzAgentRun } from '@/lib/tikz/agent/run-reducer';
import { AgentRunSteps } from './agent-run-steps';

afterEach(cleanup);

describe('AgentRunSteps', () => {
  it('renders one stable card for a started and completed tool call', () => {
    let run = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 0, { type: 'run.started', title: '正在处理' }),
    );
    run = reduceTikzAgentRun(run, tikzAgentEvent('run', 1, {
      type: 'tool.started',
      title: '正在读取几何上下文',
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
    }));
    run = reduceTikzAgentRun(run, tikzAgentEvent('run', 2, {
      type: 'tool.completed',
      title: '已读取几何上下文',
      detail: '12 个实体',
      toolCallId: 'call-1',
      toolName: 'read-geometry-context',
    }));

    const { container } = render(
      <AgentRunSteps steps={run.steps} toolCalls={run.toolCalls} />,
    );

    expect(container.querySelectorAll('[data-tool-call-id="call-1"]')).toHaveLength(1);
    expect(screen.getAllByText('已读取几何上下文')).toHaveLength(1);
    expect(screen.getByText('read-geometry-context · 已完成')).toBeTruthy();
    expect(screen.queryByText('正在读取几何上下文')).toBeNull();
    expect(screen.getByText(/查看过程（2 步）/)).toBeTruthy();
  });

  it('shows an unfinished tool as cancelled when the owning run stops', () => {
    let run = reduceTikzAgentRun(
      emptyTikzAgentRun('run'),
      tikzAgentEvent('run', 0, {
        type: 'tool.started',
        title: '正在检索题源',
        toolCallId: 'call-search',
        toolName: 'search-geometry-problems',
      }),
    );
    run = reduceTikzAgentRun(run, tikzAgentEvent('run', 1, {
      type: 'run.completed',
      title: '本轮已取消，画板未改变',
      outcome: 'unapplied-candidate',
    }));

    render(<AgentRunSteps steps={run.steps} toolCalls={run.toolCalls} />);

    expect(screen.getByText('search-geometry-problems · 已取消')).toBeTruthy();
  });
});
