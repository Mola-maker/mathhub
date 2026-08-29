import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

function geometryDoc(source: string) {
  const analysis = analyze(source, 0);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'derived-constraint-test',
      epoch: 'epoch-1',
      revision: 0,
      sourceId: 'derived-constraint-test:tikz',
      sourceHash: 'fixture-source-hash',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

describe('TikZ derived coordinate semantic constraints', () => {
  it('projects ordinary calc midpoint and perpendicular-foot coordinates', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1,3);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (D) at ($(B)!(C)!(A)$);
\end{tikzpicture}`;
    const constraints = geometryDoc(source).semantic.ir.constraints;

    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'midpoint',
        arguments: [
          expect.objectContaining({ entityId: 'point:M' }),
          expect.objectContaining({ entityId: 'point:A' }),
          expect.objectContaining({ entityId: 'point:B' }),
        ],
      }),
      expect.objectContaining({
        kind: 'perpendicular-foot',
        arguments: [
          expect.objectContaining({ entityId: 'point:D' }),
          expect.objectContaining({ entityId: 'point:C' }),
          expect.objectContaining({ entityId: 'point:B' }),
          expect.objectContaining({ entityId: 'point:A' }),
        ],
      }),
    ]));
  });
});
