import { describe, expect, it } from 'vitest';
import { applyTextPatches } from '../document/source-transaction';
import { analyze } from '../analyze';
import { solveDerivedDrag } from './derived-drag';

describe('solveDerivedDrag', () => {
  it('拖动中点时写回上游自由点且保持中点表达式', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (M) at ($(A)!0.5!(B)$);
\end{tikzpicture}`;
    const result = solveDerivedDrag({
      source,
      sourceRevision: 7,
      pointName: 'M',
      target: { x: 3, y: 2 },
    });
    expect(result.status).toBe('underconstrained');
    expect(result.patches).toHaveLength(2);
    const next = applyTextPatches(source, result.patches);
    expect(next).toContain('\\coordinate (M) at ($(A)!0.5!(B)$)');
    const point = analyze(next, 8).scene?.points.get('M')?.position;
    expect(point?.x).toBeCloseTo(3, 2);
    expect(point?.y).toBeCloseTo(2, 2);
  });

  it('没有自由祖先时返回unsolved而不冻结派生点', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at ($(1,1)+(1,1)$);
\coordinate (M) at ($(A)!0.5!(A)$);
\end{tikzpicture}`;
    const result = solveDerivedDrag({
      source,
      sourceRevision: 0,
      pointName: 'M',
      target: { x: 9, y: 9 },
    });
    expect(result.status).toBe('unsolved');
    expect(result.patches).toEqual([]);
  });
});
