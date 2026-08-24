import { describe, expect, it, vi } from 'vitest';
import { runTikzAgentLoop } from './runtime';

describe('Agent widget protocol repair', () => {
  it('repairs prose-only claims until a valid read-only widget is present', async () => {
    const valid = [
      '这里是交互函数图。',
      '```tikz-agent-widget',
      JSON.stringify({
        kind: 'function-plot',
        title: '直线',
        expression: 'y=x',
        series: [{
          label: 'f(x)',
          color: 'blue',
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        }],
      }),
      '```',
    ].join('\n');
    const invokeModel = vi.fn()
      .mockResolvedValueOnce('下面展示 Widget，但没有结构化输出。')
      .mockResolvedValueOnce(valid);
    const result = await runTikzAgentLoop({
      messages: [],
      invokeModel,
      executeTool: vi.fn(),
      requiresReadOnlyWidget: true,
    });
    expect(result).toMatchObject({ output: valid, steps: 2, protocolRepairs: 1 });
    expect(invokeModel.mock.calls[1]?.[0].at(-1)?.content)
      .toContain('missing-read-only-widget');
  });

  it('does not force widgets into ordinary natural-language answers', async () => {
    const result = await runTikzAgentLoop({
      messages: [],
      invokeModel: vi.fn(async () => '普通解释。'),
      executeTool: vi.fn(),
      requiresReadOnlyWidget: false,
    });
    expect(result).toMatchObject({ output: '普通解释。', steps: 1, protocolRepairs: 0 });
  });
});
