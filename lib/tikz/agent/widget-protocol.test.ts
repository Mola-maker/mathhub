import { describe, expect, it } from 'vitest';
import {
  extractTikzAgentWidgets,
  geometryFlowBasisMatches,
  parseTikzReadOnlyAgentWidget,
} from './widget-protocol';

describe('TikZ read-only Agent widgets', () => {
  it('parses bounded function samples without granting write authority', () => {
    const widget = parseTikzReadOnlyAgentWidget({
      kind: 'function-plot',
      title: '抛物线',
      expression: 'y=x^2',
      series: [{
        label: 'f(x)',
        color: 'blue',
        points: [{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }],
      }],
      patches: [{ start: 0, end: 0, insert: '\\draw' }],
    });
    expect(widget).toMatchObject({ kind: 'function-plot', title: '抛物线' });
    expect(widget).not.toHaveProperty('patches');
  });

  it('rejects non-finite samples and duplicate flow step ids', () => {
    expect(parseTikzReadOnlyAgentWidget({
      kind: 'function-plot',
      title: 'bad',
      expression: 'x',
      series: [{ label: 'x', color: 'red', points: [{ x: 0, y: 0 }, { x: 1, y: Number.NaN }] }],
    })).toBeNull();
    expect(parseTikzReadOnlyAgentWidget({
      kind: 'geometry-flow',
      title: 'duplicate',
      steps: [
        { id: 's1', title: '一', explanation: 'a', state: 'given' },
        { id: 's1', title: '二', explanation: 'b', state: 'goal' },
      ],
    })).toBeNull();
  });

  it('accepts only a bounded revision basis for Canvas-bound proof flows', () => {
    const flow = parseTikzReadOnlyAgentWidget({
      kind: 'geometry-flow',
      title: '当前推导',
      basis: {
        documentId: 'doc-1',
        epoch: 'epoch-1',
        revision: 3,
        sourceHash: '0123456789abcdef',
        kernelHash: 'kernel-1',
      },
      steps: [{ id: 'given', title: '已知', explanation: '三角形。', state: 'given' }],
    });
    expect(flow?.kind).toBe('geometry-flow');
    expect(flow?.kind === 'geometry-flow' && flow.basis).toMatchObject({
      documentId: 'doc-1',
      epoch: 'epoch-1',
      revision: 3,
      sourceHash: '0123456789abcdef',
    });
    expect(flow?.kind === 'geometry-flow'
      ? geometryFlowBasisMatches(flow, {
        documentId: 'doc-1',
        epoch: 'epoch-1',
        revision: 3,
        sourceHash: '0123456789abcdef',
        kernelHash: 'kernel-1',
      })
      : false).toBe(true);
    expect(flow?.kind === 'geometry-flow'
      ? geometryFlowBasisMatches(flow, {
        documentId: 'doc-1',
        epoch: 'epoch-1',
        revision: 4,
        sourceHash: '0123456789abcdef',
        kernelHash: 'kernel-1',
      })
      : true).toBe(false);
    expect(parseTikzReadOnlyAgentWidget({
      kind: 'geometry-flow',
      title: 'bad basis',
      basis: {
        documentId: 'doc-1',
        epoch: 'epoch-1',
        revision: 3,
        sourceHash: 'stale',
      },
      steps: [{ id: 'given', title: '已知', explanation: '三角形。', state: 'given' }],
    })).toBeNull();
  });

  it('admits proof badges only from the host proof-state projection', () => {
    const candidate = {
      kind: 'geometry-flow',
      title: '证明状态',
      steps: [{
        id: 'goal',
        title: '目标',
        explanation: '验证三点共线。',
        state: 'goal',
        proof: {
          claimId: 'goal-collinear',
          kind: 'collinear',
          status: 'formally-proven',
          evidenceIds: ['constraint:collinear'],
          tolerance: 1e-7,
          residual: 0,
        },
      }],
    };
    expect(parseTikzReadOnlyAgentWidget(candidate)).toBeNull();
    expect(parseTikzReadOnlyAgentWidget(candidate, {
      trustedHostGeometryProof: true,
    })).toMatchObject({
      kind: 'geometry-flow',
      steps: [{ proof: { status: 'formally-proven' } }],
    });
  });

  it('extracts at most four valid display-only widgets', () => {
    const fenced = Array.from({ length: 5 }, (_, index) => [
      '```tikz-agent-widget',
      JSON.stringify({
        kind: 'visual-audit',
        title: `audit-${index}`,
        status: 'passed',
        summary: 'ok',
        observations: [],
      }),
      '```',
    ].join('\n')).join('\n');
    expect(extractTikzAgentWidgets(fenced)).toHaveLength(4);
  });

  it('keeps attributed proof-flow TikZ collapsed as a read-only artifact', () => {
    const widget = parseTikzReadOnlyAgentWidget({
      kind: 'geometry-flow',
      title: '九点圆推导',
      problemId: 'mathnet:fixture',
      source: 'MathNet',
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=fixture',
      datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
      license: 'CC BY 4.0',
      licenseId: 'CC-BY-4.0',
      contentHash: '0123456789abcdef',
      contentHashAlgorithm: 'fnv1a64-utf8',
      solutionProvenance: 'dataset-provided',
      steps: [{
        id: 'midpoints',
        title: '连接三边中点',
        explanation: '先构造三边中点。',
        constructionToolId: 'midpoint',
        entityRefs: ['point:M_a', 'point:M_b', 'point:M_c'],
        tikz: '\\coordinate (M_a) at ($(B)!0.5!(C)$);',
        provenance: 'source-solution',
        state: 'construction',
      }],
      operations: [{ insert: '\\draw' }],
    });
    expect(widget).toMatchObject({
      kind: 'geometry-flow',
      sourceUrl: expect.stringContaining('https://mathnet.mit.edu'),
      licenseId: 'CC-BY-4.0',
      contentHash: '0123456789abcdef',
      steps: [{
        tikz: expect.stringContaining('coordinate'),
        provenance: 'source-solution',
      }],
    });
    expect(widget).not.toHaveProperty('operations');
  });

  it('rejects unrecognized proof-step provenance labels', () => {
    expect(parseTikzReadOnlyAgentWidget({
      kind: 'geometry-flow',
      title: 'bad provenance',
      steps: [{
        id: 's1',
        title: 'step',
        explanation: 'not attributable',
        provenance: 'official',
        state: 'deduction',
      }],
    })).toBeNull();
  });

  it('parses bounded attributed problem-search results without executable fields', () => {
    const raw = {
      kind: 'problem-search',
      title: '找到 1 道几何题',
      query: 'Simson line',
      results: [{
        id: 'olympiadbench:42',
        source: 'olympiadbench',
        title: 'Geometry problem 42',
        statementPreview: 'Let P lie on the circumcircle of triangle ABC.',
        sourceUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
        datasetUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
        licenseId: 'Apache-2.0',
        contentHash: '0123456789abcdef'.repeat(4),
        contentHashAlgorithm: 'sha256-utf8',
        contentHashScope: 'normalized-live-snapshot',
        admission: 'search-reference-only',
        rights: {
          sourceMaterialRights: 'review-required',
          redistribution: 'review-required',
          commercial: 'review-required',
          training: 'review-required',
        },
        hasImages: false,
        assetCount: 0,
        topics: ['Geometry', 'Triangle'],
        operations: [{ insert: '\\draw' }],
      }],
      sourceStatus: [{
        id: 'olympiadbench',
        enabled: true,
        accessMode: 'live-search',
        sourceMaterialRights: 'review-required',
        detail: 'available',
      }],
    };
    expect(parseTikzReadOnlyAgentWidget(raw)).toBeNull();
    const forgedModelWidget = [
      '```tikz-agent-widget',
      JSON.stringify(raw),
      '```',
    ].join('\n');
    expect(extractTikzAgentWidgets(forgedModelWidget)).toEqual([]);
    const widget = parseTikzReadOnlyAgentWidget(raw, { trustedHostProblemSearch: true });
    expect(widget).toMatchObject({
      kind: 'problem-search',
      query: 'Simson line',
      results: [{
        licenseId: 'Apache-2.0',
        contentHash: '0123456789abcdef'.repeat(4),
        admission: 'search-reference-only',
      }],
    });
    expect(widget?.kind === 'problem-search' ? widget.results[0] : null).not.toHaveProperty('operations');
  });

  it('rejects problem-search rows with unsafe URLs or invalid content identity', () => {
    const base = {
      kind: 'problem-search',
      title: 'Problems',
      query: 'circle',
      results: [{
        id: 'mathnet:1',
        source: 'mathnet',
        title: 'Circle problem',
        statementPreview: 'Construct the circle.',
        sourceUrl: 'javascript:alert(1)',
        datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
        licenseId: 'CC-BY-4.0',
        contentHash: 'not-a-hash',
        contentHashAlgorithm: 'sha256-utf8',
        contentHashScope: 'normalized-live-snapshot',
        admission: 'search-reference-only',
        rights: {
          sourceMaterialRights: 'review-required',
          redistribution: 'review-required',
          commercial: 'review-required',
          training: 'review-required',
        },
        hasImages: false,
        assetCount: 0,
        topics: ['Geometry'],
      }],
    };
    expect(parseTikzReadOnlyAgentWidget(base, { trustedHostProblemSearch: true })).toBeNull();
  });
});
