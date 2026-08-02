import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { buildSceneHeatmap } from './scene-heatmap';

describe('buildSceneHeatmap', () => {
  it('keeps selection aligned with the canvas point-name protocol', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (2,0);
\draw (A) -- (B);
\end{tikzpicture}`;
    const { scene } = analyze(source, 1);
    const heatmap = buildSceneHeatmap(scene, {
      selection: ['A'],
      selectedStmtIndex: 2,
    });

    const point = heatmap.entries.find((entry) => entry.id === 'point:A');
    const segment = heatmap.entries.find((entry) => entry.kind === 'element');
    expect(point?.selectionRefs).toEqual(['A']);
    expect(point?.activity).toBe(1);
    expect(segment?.selectionRefs).toEqual(['A', 'B']);
    expect(segment?.activity).toBe(1);
  });
});
