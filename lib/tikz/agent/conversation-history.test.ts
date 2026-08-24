import { describe, expect, it } from 'vitest';
import { compactTikzConversationHistory } from './conversation-history';

describe('compactTikzConversationHistory', () => {
  it('preserves the newest short confirmation and actionable clarification tail', () => {
    const history = compactTikzConversationHistory([
      { role: 'assistant', content: `九点圆说明\n${'几何细节'.repeat(2_000)}\n可选：全部补上 / 保持不变` },
      { role: 'user', content: '全部补上' },
    ]);
    expect(history.at(-1)).toEqual({ role: 'user', content: '全部补上' });
    expect(history[0]!.content).toContain('九点圆说明');
    expect(history[0]!.content).toContain('全部补上 / 保持不变');
    expect(history[0]!.content.length).toBeLessThanOrEqual(3_000);
  });

  it('bounds the aggregate history and keeps chronological order', () => {
    const history = compactTikzConversationHistory(
      Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `${index}:${'x'.repeat(5_000)}`,
      })),
    );
    expect(history).toHaveLength(4);
    expect(history.map((message) => Number(message.content.split(':')[0]))).toEqual([8, 9, 10, 11]);
    expect(history.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(12_000);
  });
});
