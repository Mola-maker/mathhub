import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import { projectTikzAnalysisToGeometryTruth, TIKZ_PLUGIN_SET_DIGEST } from '../ir/tikz-adapter';
import { hashSource } from '../semantics/scene-manifest';
import { projectGeometryFlowEntityRefs } from './flow-projection';

function docFor(source: string) {
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, 0),
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'flow-test',
      epoch: 'epoch-1',
      revision: 0,
      sourceHash: hashSource(source),
      sourceId: 'flow-test:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

describe('projectGeometryFlowEntityRefs', () => {
  it('resolves canonical IDs and unique names to a bounded Canvas reveal index', () => {
    const source = `\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\coordinate (B) at (2,0);
\\draw (A) -- (B);
\\end{tikzpicture}`;
    const projection = projectGeometryFlowEntityRefs(docFor(source), ['A', 'element:2:0']);
    expect(projection.entityIds).toEqual(['element:2:0', 'point:A']);
    expect(projection.unresolvedRefs).toEqual([]);
    expect(projection.revealThroughStatementIndex).toBe(2);
  });

  it('does not broaden stale or ambiguous model refs', () => {
    const projection = projectGeometryFlowEntityRefs(null, ['point:A', 'point:A']);
    expect(projection).toEqual({
      entityIds: [],
      unresolvedRefs: ['point:A'],
      revealThroughStatementIndex: null,
    });
  });
});
