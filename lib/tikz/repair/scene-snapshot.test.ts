import { describe, expect, it } from 'vitest';
import { parseTikz } from '../subset/parser';
import { evaluateScene } from '../semantics/scene';
import { snapshotScene } from './scene-snapshot';

describe('snapshotScene', () => {
  it('输出点与图元摘要，并标记自由/派生点', () => {
    const code = '\\begin{tikzpicture}\\coordinate (A) at (1,2);'
      + '\\coordinate (M) at ($(A)!0.5!(A)$);'
      + '\\draw (A) circle (1.5);\\end{tikzpicture}';
    const scene = evaluateScene(parseTikz(code).statements);
    const snapshot = snapshotScene(scene);
    expect(snapshot).toContain('A: point @ (1.000, 2.000) [自由]');
    expect(snapshot).toContain('M: point @ (1.000, 2.000) [派生]');
    expect(snapshot).toContain('circle @ (1.000, 2.000) r=1.500');
  });

  it('超过最大行数时截断并注明', () => {
    const coordinates = Array.from(
      { length: 60 },
      (_, index) => `\\coordinate (P${index}) at (${index},0);`,
    ).join('\n');
    const scene = evaluateScene(parseTikz(
      `\\begin{tikzpicture}${coordinates}\\end{tikzpicture}`,
    ).statements);
    expect(snapshotScene(scene)).toContain('…另有');
  });
});
