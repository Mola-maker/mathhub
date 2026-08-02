import { describe, it, expect } from 'vitest';
import { parseTikz } from './parser';

const DOC = `\\begin{tikzpicture}[scale=1]
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (4,0);
  \\coordinate (M) at ($(A)!0.5!(B)$);
  \\coordinate (H) at ($(A)!(C)!(B)$);
  \\draw[name path=c1] (C) circle (1.5);
  \\path[name path=l1] (A) -- (B);
  \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);
  \\draw[thick,->] (A) -- (B) -- (C) -- cycle;
  \\node[above right] at (A) {$A$};
  \\pic[draw] {right angle = B--H--C};
\\end{tikzpicture}`;

describe('parseTikz', () => {
  it('语句种类与数量正确', () => {
    const pic = parseTikz(DOC);
    expect(pic.scale).toBe(1);
    expect(pic.statements.map(s => s.kind)).toEqual([
      'coordinate','coordinate','coordinate','coordinate','path','path','path','path','node','pic',
    ]);
  });

  it('calc 插值 AST 形状与 source range', () => {
    const m = parseTikz(DOC).statements[2];
    if (m.kind !== 'coordinate' || m.at.kind !== 'calc') throw new Error('bad shape');
    expect(m.at.expr.op).toBe('interpolate');
    expect(DOC.slice(m.at.range.start, m.at.range.end)).toBe('($(A)!0.5!(B)$)');
  });

  it('投影 $(A)!(C)!(B)$ → project', () => {
    const h = parseTikz(DOC).statements[3];
    if (h.kind !== 'coordinate' || h.at.kind !== 'calc') throw new Error('bad shape');
    expect(h.at.expr.op).toBe('project');
  });

  it('name path / intersections 绑定', () => {
    const stmts = parseTikz(DOC).statements;
    expect(stmts[4]).toMatchObject({ kind: 'path', namePath: 'c1' });
    expect(stmts[6]).toMatchObject({ kind: 'path', intersections: { of: ['c1','l1'], bindings: [{ index: 1, name: 'P' }, { index: 2, name: 'Q' }] } });
  });

  it('折线 cycle 与箭头 options 原文', () => {
    const d = parseTikz(DOC).statements[7];
    if (d.kind !== 'path') throw new Error('bad');
    expect(d.specs[0]).toMatchObject({ type: 'polyline', cycle: true });
    expect(d.options?.raw).toBe('thick,->');
  });

  it('node 文本取花括号原文；pic 三点', () => {
    const n = parseTikz(DOC).statements[8];
    expect(n).toMatchObject({ kind: 'node', text: '$A$' });
    expect(parseTikz(DOC).statements[9]).toMatchObject({ kind: 'pic', picType: 'right-angle', points: ['B','H','C'] });
  });

  it('let-coordinate 绑定解析', () => {
    const src = `\\begin{tikzpicture}
      \\path let \\p1=($(B)-(A)$), \\n1={veclen(\\x1,\\y1)} in coordinate (D) at ($(A)+({\\x1/\\n1},{\\y1/\\n1})$);
    \\end{tikzpicture}`;
    const s = parseTikz(src).statements[0];
    expect(s).toMatchObject({ kind: 'let-coordinate', name: 'D' });
    if (s.kind !== 'let-coordinate') throw new Error('bad');
    expect(s.bindings.map(b => b.type)).toEqual(['point', 'num']);
    expect(s.bindings.map(b => b.name)).toEqual(['\\p1', '\\n1']);
    expect(s.bindings[1]).toMatchObject({
      type: 'num',
      value: {
        kind: 'veclen',
        x: { kind: 'num-comp', pvar: '\\p1', axis: 'x' },
        y: { kind: 'num-comp', pvar: '\\p1', axis: 'y' },
      },
    });
    expect(s.at).toMatchObject({
      kind: 'calc',
      expr: {
        op: 'add',
        right: {
          op: 'coord',
          coord: {
            kind: 'literal',
            x: { kind: 'num-bin', binop: '/', left: { kind: 'num-comp' }, right: { kind: 'num-var', name: '\\n1' } },
            y: { kind: 'num-bin', binop: '/', left: { kind: 'num-comp' }, right: { kind: 'num-var', name: '\\n1' } },
          },
        },
      },
    });
  });

  it('through 圆半径', () => {
    const s = parseTikz('\\begin{tikzpicture}\\node[draw,circle through=(A)] at (O) {};\\end{tikzpicture}').statements[0];
    if (s.kind !== 'path') throw new Error('bad');
    expect(s.specs[0]).toMatchObject({ type: 'circle', radius: { kind: 'through' } });
  });

  it('错误：未知命令 / 坐标带单位 / 未闭合', () => {
    expect(() => parseTikz('\\begin{tikzpicture}\\foreach \\x in {1,2} {}\\end{tikzpicture}')).toThrowError(/不支持的命令/);
    expect(() => parseTikz('\\begin{tikzpicture}\\coordinate (A) at (1cm,2);\\end{tikzpicture}')).toThrowError(/纯数字/);
    expect(() => parseTikz('\\begin{tikzpicture}\\coordinate (A) at (1,2);')).toThrowError(/end{tikzpicture}/);
  });
});
