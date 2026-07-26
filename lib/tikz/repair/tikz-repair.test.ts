import { describe, expect, it } from 'vitest';
import { localRepairTikz, runTikzRepair } from './tikz-repair';

describe('localRepairTikz', () => {
  it('把全角标点转成半角', () => {
    const { code, fixes } = localRepairTikz('\\coordinate （A）at （0，0）；');
    expect(code).toBe('\\coordinate (A)at (0,0);');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('补全缺失的 tikzpicture 结束标记', () => {
    const { code, fixes } = localRepairTikz('\\begin{tikzpicture}\n\\draw (0,0);');
    expect(code).toContain('\\end{tikzpicture}');
    expect(fixes).toContain('补全 \\end{tikzpicture}');
  });

  it('剥离 fenced code block', () => {
    const { code } = localRepairTikz('```tikz\n\\begin{tikzpicture}\\end{tikzpicture}\n```');
    expect(code).not.toContain('```');
  });

  it('只接受错误数量严格减少的 LLM 结果', async () => {
    const broken = '\\begin{tikzpicture}\\draw (A) -- (B);\\end{tikzpicture}';
    const fixed = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\coordinate (B) at (1,0);\\draw (A) -- (B);\\end{tikzpicture}';
    const request = async () => new Response(
      `data: ${JSON.stringify({ tikzCode: fixed })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    const result = await runTikzRepair({
      code: broken,
      provider: 'anthropic',
      request,
      maxRounds: 1,
    });
    expect(result.code).toBe(fixed);
    expect(result.errorsAfter).toBeLessThan(result.errorsBefore);
  });
});
