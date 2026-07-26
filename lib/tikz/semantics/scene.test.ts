import { describe, it, expect } from 'vitest';
import { parseTikz } from '../../tikz/subset/parser';
import { evaluateScene } from './scene';

const sceneOf = (body: string) => evaluateScene(parseTikz(`\\begin{tikzpicture}${body}\\end{tikzpicture}`).statements);

describe('evaluateScene', () => {
  it('自由点/派生点求值与 free 标记', () => {
    const s = sceneOf('\\coordinate (A) at (0,0);\\coordinate (B) at (4,0);\\coordinate (M) at ($(A)!0.5!(B)$);');
    expect(s.issues).toEqual([]);
    expect(s.points.get('A')).toMatchObject({ position: { x: 0, y: 0 }, free: true });
    expect(s.points.get('M')).toMatchObject({ position: { x: 2, y: 0 }, free: false, dependsOn: ['A', 'B'] });
  });
  it('through 圆半径 = center 到 through 点距离', () => {
    const s = sceneOf('\\coordinate (O) at (1,1);\\coordinate (A) at (4,5);\\draw (O) circle [through=(A)];');
    const c = s.elements.find(e => e.kind === 'circle');
    expect(c).toMatchObject({ center: { x: 1, y: 1 } });
    expect(c && c.kind === 'circle' ? c.radius : 0).toBeCloseTo(5, 6);
  });
  it('交点绑定到点名', () => {
    const s = sceneOf(`
      \\coordinate (A) at (-3,0);\\coordinate (B) at (3,0);\\coordinate (C) at (0,0);
      \\draw[name path=c1] (C) circle (2);
      \\path[name path=l1] (A) -- (B);
      \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);`);
    expect(s.points.get('P')?.position.x).toBeCloseTo(-2, 6);
    expect(s.points.get('Q')?.position.x).toBeCloseTo(2, 6);
  });
  it('环依赖 → cycle issue，场景为空', () => {
    const s = sceneOf('\\coordinate (A) at ($(B)!0.5!(B)$);\\coordinate (B) at ($(A)!0.5!(A)$);');
    expect(s.issues[0].kind).toBe('cycle');
    expect(s.elements).toHaveLength(0);
  });
  it('let-coordinate（内心加权公式）求值', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);\\coordinate (C) at (0,3);
      \\path let \\p1=($(B)-(A)$), \\n1={veclen(\\x1,\\y1)}
        in coordinate (I) at ($(A)+({\\x1/\\n1},{\\y1/\\n1})$);`);
    expect(s.issues).toEqual([]);
    expect(s.points.get('I')?.position).toEqual({ x: 1, y: 0 });
  });
  it('node → label 元素带锚点；pic → angle-mark', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (1,0);\\coordinate (C) at (0,1);
      \\node[above right] at (A) {$A$};
      \\pic {right angle = B--A--C};`);
    expect(s.elements.find(e => e.kind === 'label')).toMatchObject({ at: { x: 0, y: 0 }, text: '$A$', anchor: 'above right' });
    expect(s.elements.find(e => e.kind === 'angle-mark')).toMatchObject({ right: true, vertex: { x: 0, y: 0 } });
  });
  it('求值失败的语句进 issues，其余正常渲染（best-attempt）', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);
      \\coordinate (H) at ($(A)!(A)!(A)$);
      \\draw (A) -- (H);`);
    expect(s.issues.some(i => i.kind === 'degenerate')).toBe(true);
    expect(s.points.get('A')).toBeDefined();
  });
});
