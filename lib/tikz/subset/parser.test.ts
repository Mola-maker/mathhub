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
  it('parses the official static graph chain with lossless node and edge options', () => {
    const source = String.raw`\begin{tikzpicture}
\graph [nodes={draw,circle}, edges={thick}, grow right=2cm] {
  A/Alpha ->[red] B -> C <-> A;
};
\end{tikzpicture}`;
    const graph = parseTikz(source).statements[0];
    if (graph.kind !== 'graph') throw new Error('bad graph');
    expect(graph.nodes.map((node) => [node.name, node.text])).toEqual([
      ['A', 'Alpha'],
      ['B', 'B'],
      ['C', 'C'],
    ]);
    expect(graph.edges.map((edge) => edge.connector)).toEqual(['->', '->', '<->']);
    expect(graph.edges[0]?.options?.raw).toBe('red');
    expect(source.slice(graph.nodes[0]!.range.start, graph.nodes[0]!.range.end)).toBe('A/Alpha');
  });

  it('keeps dynamic graph groups outside the static interactive parser', () => {
    const source = String.raw`\begin{tikzpicture}\graph { A -- { B, C } };\end{tikzpicture}`;
    expect(() => parseTikz(source)).toThrowError(/group|静态名称/u);
  });

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

  it('parses the official cubic Bezier operator without confusing it with decimals', () => {
    const source = '\\begin{tikzpicture}\\draw (0,0) .. controls (.5,1) and (2,1) .. (3,0);\\end{tikzpicture}';
    const statement = parseTikz(source).statements[0];
    if (statement.kind !== 'path') throw new Error('bad path');
    expect(statement.specs[0]).toMatchObject({
      type: 'cubic-bezier',
      start: { kind: 'literal', x: 0, y: 0 },
      control1: { kind: 'literal', x: 0.5, y: 1 },
      control2: { kind: 'literal', x: 2, y: 1 },
      end: { kind: 'literal', x: 3, y: 0 },
    });
  });

  it('treats a named point center anchor as the same reversible point reference', () => {
    const source = '\\begin{tikzpicture}\\coordinate (A) at (1,2);\\draw (A.center)--(3,4);\\end{tikzpicture}';
    const statement = parseTikz(source).statements[1];
    if (statement.kind !== 'path' || statement.specs[0]?.type !== 'polyline') {
      throw new Error('bad path');
    }
    expect(statement.specs[0].points[0]).toMatchObject({
      kind: 'ref',
      name: 'A',
      anchor: 'center',
    });
  });

  it('keeps unsupported shape-dependent anchors out of interactive semantics', () => {
    const source = '\\begin{tikzpicture}\\coordinate (A) at (1,2);\\draw (A.north)--(3,4);\\end{tikzpicture}';
    expect(() => parseTikz(source)).toThrowError(/暂只支持命名点的 center 锚点/);
  });

  it('parses both positional and keyed official circular arc forms', () => {
    const positionalSource = '\\begin{tikzpicture}\\draw (2,0) arc (0:120:2);\\end{tikzpicture}';
    const keyedSource = '\\begin{tikzpicture}\\draw (2,0) arc[start angle=0,end angle=120,radius=2];\\end{tikzpicture}';
    const positional = parseTikz(positionalSource).statements[0];
    const keyed = parseTikz(keyedSource).statements[0];
    if (positional.kind !== 'path' || keyed.kind !== 'path') throw new Error('bad path');
    expect(positional.specs[0]).toMatchObject({
      type: 'circular-arc', startAngleDeg: 0, endAngleDeg: 120, radius: 2,
    });
    expect(keyed.specs[0]).toMatchObject({
      type: 'circular-arc', startAngleDeg: 0, endAngleDeg: 120, radius: 2,
    });
    const positionalArc = positional.specs[0];
    const keyedArc = keyed.specs[0];
    if (positionalArc?.type !== 'circular-arc' || keyedArc?.type !== 'circular-arc') {
      throw new Error('bad circular arc');
    }
    expect(positionalSource.slice(
      positionalArc.parameterSources.startAngle.range.start,
      positionalArc.parameterSources.startAngle.range.end,
    )).toBe('0');
    expect(positionalSource.slice(
      positionalArc.parameterSources.endAngle.range.start,
      positionalArc.parameterSources.endAngle.range.end,
    )).toBe('120');
    expect(positionalSource.slice(
      positionalArc.parameterSources.radius.range.start,
      positionalArc.parameterSources.radius.range.end,
    )).toBe('2');
    expect(keyedSource.slice(
      keyedArc.parameterSources.startAngle.range.start,
      keyedArc.parameterSources.startAngle.range.end,
    )).toBe('0');
    expect(keyedSource.slice(
      keyedArc.parameterSources.endAngle.range.start,
      keyedArc.parameterSources.endAngle.range.end,
    )).toBe('120');
    expect(keyedSource.slice(
      keyedArc.parameterSources.radius.range.start,
      keyedArc.parameterSources.radius.range.end,
    )).toBe('2');
  });

  it('parses the official rectangle path operation without lowering it to fake source points', () => {
    const source = '\\begin{tikzpicture}\\draw (A) rectangle (B);\\end{tikzpicture}';
    const statement = parseTikz(source).statements[0];
    if (statement.kind !== 'path') throw new Error('bad path');
    expect(statement.specs[0]).toMatchObject({
      type: 'rectangle',
      first: { kind: 'ref', name: 'A' },
      opposite: { kind: 'ref', name: 'B' },
    });
    const rectangle = statement.specs[0];
    if (rectangle?.type !== 'rectangle') throw new Error('bad rectangle');
    expect(source.slice(rectangle.range.start, rectangle.range.end)).toBe('(A) rectangle (B)');
  });

  it('parses the official axis-aligned ellipse path with physical units', () => {
    const statement = parseTikz(
      '\\begin{tikzpicture}\\coordinate (O) at (0,0);\\draw (O) ellipse (20mm and 1cm);\\end{tikzpicture}',
    ).statements[1];
    if (statement.kind !== 'path') throw new Error('bad path');
    expect(statement.specs[0]).toMatchObject({
      type: 'ellipse',
      center: { kind: 'ref', name: 'O' },
      xRadius: 2,
      yRadius: 1,
    });
  });
});
