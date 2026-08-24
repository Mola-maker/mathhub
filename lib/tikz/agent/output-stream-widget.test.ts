import { describe, expect, it } from 'vitest';
import { createAgentVisibleOutputStream } from './output-stream';

describe('Agent widget stream filtering', () => {
  it('withholds read-only widget envelopes while preserving surrounding prose', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    [
      '这里是函数图。\n```tikz-agent-',
      'widget\n{"kind":"visual-audit","title":"检查","status":"passed","summary":"一致","observations":[]}',
      '\n```\n可以拖动缩放。',
    ].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('这里是函数图。\n\n可以拖动缩放。');
  });
});
