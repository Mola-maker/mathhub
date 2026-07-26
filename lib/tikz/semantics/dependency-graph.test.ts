import { describe, it, expect } from 'vitest';
import { parseTikz } from '../../tikz/subset/parser';
import { buildDependencyGraph } from './dependency-graph';

const stmtsOf = (body: string) => parseTikz(`\\begin{tikzpicture}${body}\\end{tikzpicture}`).statements;

describe('buildDependencyGraph', () => {
  it('派生点排在其依赖之后', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (A) at (0,0);\\coordinate (M) at ($(A)!0.5!(A)$);'));
    expect(g.cycle).toBeNull();
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('M'));
  });
  it('前向引用也正确排序', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (M) at ($(A)!0.5!(B)$);\\coordinate (A) at (0,0);\\coordinate (B) at (4,0);'));
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('M'));
    expect(g.order.indexOf('B')).toBeLessThan(g.order.indexOf('M'));
  });
  it('路径节点依赖其点，交点依赖两条路径', () => {
    const g = buildDependencyGraph(stmtsOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);
      \\draw[name path=c1] (A) circle (1.5);
      \\path[name path=l1] (A) -- (B);
      \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P);`));
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('path:c1'));
    expect(g.order.indexOf('path:c1')).toBeLessThan(g.order.indexOf('P'));
    expect(g.order.indexOf('path:l1')).toBeLessThan(g.order.indexOf('P'));
    expect(g.nodeKinds.get('path:c1')).toBe('path');
  });
  it('环检测返回环上点名', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (A) at ($(B)!0.5!(B)$);\\coordinate (B) at ($(A)!0.5!(A)$);'));
    expect(g.cycle).not.toBeNull();
    expect(g.cycle).toContain('A');
    expect(g.cycle).toContain('B');
  });
  it('let-coordinate 依赖绑定值中的点', () => {
    const g = buildDependencyGraph(stmtsOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);
      \\path let \\p1=($(B)-(A)$) in coordinate (D) at ($(A)+({\\x1},{\\y1})$);`));
    expect(g.order.indexOf('B')).toBeLessThan(g.order.indexOf('D'));
  });
});