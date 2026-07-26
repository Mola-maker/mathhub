import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';

const GOOD = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (M) at ($(A)!0.5!(A)$);\n\\draw (A) -- (M);\n\\end{tikzpicture}';

describe('analyze', () => {
  it('合法代码：scene 就绪、零 issue、freePointRanges 只含字面量点', () => {
    const analysis = analyze(GOOD);
    expect(analysis.scene).not.toBeNull();
    expect(analysis.issues).toEqual([]);
    expect([...analysis.freePointRanges.keys()]).toEqual(['A']);
    const range = analysis.freePointRanges.get('A')!;
    expect(GOOD.slice(range.start, range.end)).toBe('(0,0)');
  });

  it('解析失败：scene 为 null，issue 带 range', () => {
    const analysis = analyze('\\begin{tikzpicture}\\draw (0,0)');
    expect(analysis.scene).toBeNull();
    expect(analysis.issues[0].severity).toBe('error');
    expect(analysis.issues[0].range).not.toBeNull();
  });

  it('静态错误（未知引用）跳过求值', () => {
    const analysis = analyze('\\begin{tikzpicture}\\coordinate (M) at ($(Z)!0.5!(Z)$);\\end{tikzpicture}');
    expect(analysis.scene).toBeNull();
    expect(analysis.issues.length).toBeGreaterThan(0);
  });

  it('求值级错误（退化）保留场景（best-attempt）', () => {
    const analysis = analyze('\\begin{tikzpicture}\\coordinate (A) at (0,0);\\coordinate (H) at ($(A)!(A)!(A)$);\\end{tikzpicture}');
    expect(analysis.scene).not.toBeNull();
    expect(analysis.issues.some((issue) => issue.message.includes('退化'))).toBe(true);
    expect(analysis.issues.find((issue) => issue.message.includes('退化'))?.range).not.toBeNull();
  });
});

