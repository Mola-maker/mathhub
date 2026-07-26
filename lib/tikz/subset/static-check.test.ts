import { describe, it, expect } from 'vitest';
import { parseTikz } from './parser';
import { staticCheck } from './static-check';

const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

describe('staticCheck', () => {
  it('合法文档零 issue', () => {
    const pic = parseTikz(wrap('\\coordinate (A) at (0,0);\\coordinate (M) at ($(A)!0.5!(A)$);'));
    expect(staticCheck(pic)).toEqual([]);
  });

  it('未知点引用报错并带 range', () => {
    const pic = parseTikz(wrap('\\coordinate (M) at ($(A)!0.5!(B)$);'));
    const issues = staticCheck(pic);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: 'error' });
    expect(issues[0].message).toContain('A');
  });

  it('未知 name path 引用报错', () => {
    const pic = parseTikz(wrap('\\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P);'));
    expect(staticCheck(pic).map(i => i.message).join()).toContain('c1');
  });

  it('重复定义同名点报错', () => {
    const pic = parseTikz(wrap('\\coordinate (A) at (0,0);\\coordinate (A) at (1,1);'));
    expect(staticCheck(pic)[0].message).toContain('重复');
  });

  it('pic 引用的点也要检查', () => {
    const pic = parseTikz(wrap('\\pic {angle = B--A--C};'));
    expect(staticCheck(pic)).toHaveLength(3);
  });
});