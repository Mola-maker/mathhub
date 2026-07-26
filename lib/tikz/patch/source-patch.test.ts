import { describe, expect, it } from 'vitest';
import { formatCoordNumber, patchCoordinateLiteral, patchStyleOptions } from './source-patch';

describe('formatCoordNumber', () => {
  it('最多 4 位小数、去尾零、-0 归零', () => {
    expect(formatCoordNumber(1.5000001)).toBe('1.5');
    expect(formatCoordNumber(-2)).toBe('-2');
    expect(formatCoordNumber(0.123456789)).toBe('0.1235');
    expect(formatCoordNumber(-0.00000001)).toBe('0');
  });

  it('拒绝非有限数字', () => {
    expect(() => formatCoordNumber(Number.NaN)).toThrow(/有限/);
    expect(() => formatCoordNumber(Number.POSITIVE_INFINITY)).toThrow(/有限/);
  });
});

describe('patchCoordinateLiteral', () => {
  const code = '\\begin{tikzpicture}\n  \\coordinate (A) at (0,0);  % 注释保留\n\\end{tikzpicture}';

  it('只替换坐标字面量，其余文本逐字节不动', () => {
    const start = code.indexOf('(0,0)');
    const next = patchCoordinateLiteral(code, { start, end: start + 5 }, { x: 2.34, y: -1 });
    expect(next).toBe('\\begin{tikzpicture}\n  \\coordinate (A) at (2.34,-1);  % 注释保留\n\\end{tikzpicture}');
  });

  it('拒绝越界范围', () => {
    expect(() => patchCoordinateLiteral(code, { start: -1, end: 2 }, { x: 0, y: 0 }))
      .toThrow(RangeError);
  });
});

describe('patchStyleOptions', () => {
  it('替换已有 options 整体', () => {
    const code = '\\draw[thick,red] (A) -- (B);';
    const start = code.indexOf('[');
    const end = code.indexOf(']') + 1;
    expect(patchStyleOptions(code, { start, end }, 'blue,dashed', 0))
      .toBe('\\draw[blue,dashed] (A) -- (B);');
  });

  it('原无 options 时在 insertPos 插入', () => {
    const code = '\\draw (A) -- (B);';
    expect(patchStyleOptions(code, null, 'thick', 5)).toBe('\\draw[thick] (A) -- (B);');
  });
});

