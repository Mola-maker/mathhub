import { describe, expect, it } from 'vitest';
import { geometryProblemSearchWidget } from './problem-search-widget';
import type { TikzAgentToolObservation } from './runtime';
import type { TikzAgentToolCall } from './tool-protocol';

const call: TikzAgentToolCall = {
  schemaVersion: 'tikz-agent-tool-call/v1',
  callId: 'search-1',
  name: 'search-geometry-problems',
  arguments: { query: 'nine-point circle', limit: 8 },
};

describe('geometryProblemSearchWidget', () => {
  it('projects a successful observation into bounded read-only cards', () => {
    const observation: TikzAgentToolObservation = {
      schemaVersion: 'tikz-agent-tool-observation/v1',
      callId: call.callId,
      ok: true,
      payload: {
        records: [{
          id: 'mathnet:9',
          source: 'mathnet',
          title: 'Nine-point circle',
          statement: 'SERVER-ONLY FULL STATEMENT',
          solutions: ['SERVER-ONLY FULL SOLUTION'],
          statementPreview: `Triangle ABC has a nine-point circle.${'x'.repeat(1_000)}`,
          solutionCount: 1,
          topics: ['Geometry', 'Circle'],
          sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=9',
          datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
          licenseId: 'CC-BY-4.0',
          contentHash: '0123456789abcdef'.repeat(4),
          contentHashAlgorithm: 'sha256-utf8',
          contentHashScope: 'normalized-live-snapshot',
          admission: 'search-reference-only',
          rights: {
            sourceMaterialRights: 'conditional',
            redistribution: 'review-required',
            commercial: 'review-required',
            training: 'review-required',
          },
          assets: [{ assetId: 'image:1' }],
          hasImages: true,
        }],
        sourceStatus: [{
          id: 'mathnet',
          enabled: true,
          accessMode: 'live-search',
          sourceMaterialRights: 'conditional',
          detail: 'available',
        }],
      },
    };
    const widget = geometryProblemSearchWidget(call, observation);
    expect(widget).toMatchObject({
      kind: 'problem-search',
      query: 'nine-point circle',
      results: [{
        id: 'mathnet:9',
        hasImages: true,
        assetCount: 1,
        rights: { redistribution: 'review-required' },
      }],
    });
    expect(widget?.results[0]?.statementPreview.length).toBe(800);
    expect(JSON.stringify(widget)).not.toContain('SERVER-ONLY FULL STATEMENT');
    expect(JSON.stringify(widget)).not.toContain('SERVER-ONLY FULL SOLUTION');
    expect(widget?.results[0]).not.toHaveProperty('solutions');
  });

  it('returns no widget for failed, empty, or unrelated observations', () => {
    const failed: TikzAgentToolObservation = {
      schemaVersion: 'tikz-agent-tool-observation/v1',
      callId: call.callId,
      ok: false,
      payload: { code: 'upstream-unavailable' },
    };
    expect(geometryProblemSearchWidget(call, failed)).toBeNull();
    expect(geometryProblemSearchWidget({ ...call, name: 'inspect-geometry' }, {
      ...failed,
      ok: true,
      payload: { records: [] },
    })).toBeNull();
  });
});
