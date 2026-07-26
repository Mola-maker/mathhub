import { describe, it, expect } from 'vitest';
import { evalCoord, type EvalEnvs, type Pt } from './calc-eval';
import { parseTikz } from '../../tikz/subset/parser';
import type { CoordExpr } from '../../tikz/subset/ast';

const at = (src: string): CoordExpr => {
  const s = parseTikz(`\\begin{tikzpicture}\\coordinate (T) at ${src};\\end{tikzpicture}`).statements[0];
  if (s.kind !== 'coordinate') throw new Error('bad');
  return s.at;
};
const env = (pts: Record<string, Pt>): EvalEnvs => ({ points: new Map(Object.entries(pts)) });
const close = (p: Pt, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };

describe('calc-eval', () => {
  it('字面量与引用', () => {
    close(evalCoord(at('(1.5,-2)'), env({})), 1.5, -2);
    close(evalCoord(at('(A)'), env({ A: { x: 3, y: 4 } })), 3, 4);
  });
  it('插值：中点与外插', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 4, y: 2 } });
    close(evalCoord(at('($(A)!0.5!(B)$)'), e), 2, 1);
    close(evalCoord(at('($(A)!1.5!(B)$)'), e), 6, 3);
  });
  it('旋转 60° 构成等边三角形', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 2, y: 0 } });
    const c = evalCoord(at('($(A)!1!60:(B)$)'), e);
    close(c, 1, Math.sqrt(3));
  });
  it('投影垂足', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 1, y: 2 } });
    close(evalCoord(at('($(A)!(C)!(B)$)'), e), 1, 0);
  });
  it('向量加减与嵌套', () => {
    const e = env({ A: { x: 1, y: 1 }, B: { x: 3, y: 0 }, C: { x: 0, y: 2 } });
    close(evalCoord(at('($(A)+(B)-(C)$)'), e), 4, -1);
    close(evalCoord(at('($(A)+($(B)!0.5!(C)$)$)'), e), 2.5, 2);
  });
  it('退化投影抛 EvalError(degenerate)，未知引用抛 unknown-ref', () => {
    expect(() => evalCoord(at('($(A)!(C)!(B)$)'), env({ A: {x:0,y:0}, B: {x:0,y:0}, C: {x:1,y:1} }))).toThrowError(/退化/);
    expect(() => evalCoord(at('(ZZ)'), env({}))).toThrowError(/未定义/);
  });
});