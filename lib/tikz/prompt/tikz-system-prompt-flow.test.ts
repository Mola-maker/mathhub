import { describe, expect, it } from 'vitest';
import { buildTikzSystemPrompt } from './tikz-system-prompt';

describe('TikZ system prompt geometry-flow policy', () => {
  it('requires a read-only geometry-flow widget when explicitly requested', () => {
    const prompt = buildTikzSystemPrompt(
      '请把中点到中线的推导拆成动态几何流程图，只读，不修改画板。',
      {},
    );

    expect(prompt).toContain('Explicit read-only geometry-flow request');
    expect(prompt).toContain('Emit exactly one');
    expect(prompt).toContain('kind `geometry-flow`');
    expect(prompt).toContain('do not ask whether the user wants a mutation');
  });

  it('does not force a flow widget for an ordinary explanation', () => {
    const prompt = buildTikzSystemPrompt('解释当前三角形的高。', {});
    expect(prompt).not.toContain('Explicit read-only geometry-flow request');
  });

  it('keeps compacted dialogue subordinate to the current source projection', () => {
    const prompt = buildTikzSystemPrompt('继续当前构造。', {});
    expect(prompt).toContain('Conversation history and compacted summaries are advisory memory');
    expect(prompt).toContain('never geometry truth');
    expect(prompt).toContain('never resurrect an older fenced source block');
  });
});
