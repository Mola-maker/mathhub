import { describe, it, expect } from 'vitest';
import { lex } from './lexer';

describe('lex', () => {
  it('坐标语句切分为命令/括号/数字/逗号/分号', () => {
    const toks = lex('\\coordinate (A) at (1.5,-2);');
    expect(toks.map(t => t.type)).toEqual(['cmd','lparen','name','rparen','name','lparen','number','comma','minus','number','rparen','semi']);
    expect(toks[0]).toMatchObject({ value: '\\coordinate', start: 0, end: 11 });
  });

  it('-- 优先于单个 -，calc 符号齐全', () => {
    const types = lex('\\draw (A) -- ($(A)!0.5!(B)$);').map(t => t.type);
    expect(types).toContain('dashdash');
    expect(types).toContain('dollar');
    expect(types).toContain('bang');
  });

  it('% 注释与空白被跳过但位置保留', () => {
    const src = '% hello\n\\node';
    const toks = lex(src);
    expect(toks).toHaveLength(1);
    expect(toks[0].start).toBe(8);
  });

  it('\\p1 切分为 cmd(\\p) + number(1)', () => {
    const toks = lex('\\p1');
    expect(toks.map(t => t.value)).toEqual(['\\p', '1']);
  });
});