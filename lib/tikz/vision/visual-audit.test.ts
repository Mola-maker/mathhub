import { describe, expect, it } from 'vitest';
import {
  normalizeTikzVisualAuditFidelity,
  parseTikzVisualAuditRequest,
  parseTikzVisualAuditResponse,
} from './visual-audit';

describe('TikZ visual audit boundary', () => {
  it('accepts a bounded raster and revision identity', () => {
    expect(parseTikzVisualAuditRequest({
      model: 'vlm',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 4,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: '{"entities":[]}',
      interactiveImageDataUrl: `data:image/png;base64,${Buffer.from('interactive').toString('base64')}`,
      exactImageDataUrl: `data:image/png;base64,${Buffer.from('exact').toString('base64')}`,
      artifactDigest: 'a'.repeat(64),
    })).toMatchObject({
      sourceRevision: 4,
      sourceHash: 'a1b2c3d4e5f60718',
      documentId: 'document-1',
      epoch: 'epoch-1',
      exactImageDataUrl: expect.stringContaining('data:image/png'),
      artifactDigest: 'a'.repeat(64),
    });
  });

  it('requires an attested artifact digest whenever an exact image is compared', () => {
    const base = {
      model: 'vlm',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 4,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: '{"entities":[]}',
      interactiveImageDataUrl: `data:image/png;base64,${Buffer.from('interactive').toString('base64')}`,
      exactImageDataUrl: `data:image/png;base64,${Buffer.from('exact').toString('base64')}`,
    };
    expect(parseTikzVisualAuditRequest(base)).toBeNull();
    expect(parseTikzVisualAuditRequest({ ...base, artifactDigest: 'not-a-digest' })).toBeNull();
  });

  it('rejects SVG/script data and oversized semantic context', () => {
    expect(parseTikzVisualAuditRequest({
      model: 'vlm',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 0,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: 'x',
      interactiveImageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
    })).toBeNull();
  });

  it('parses observations but cannot carry a patch', () => {
    const widget = parseTikzVisualAuditResponse(JSON.stringify({
      schemaVersion: 'tikz-visual-audit/v3',
      status: 'warning',
      fidelity: 'drift',
      summary: '标签 A 与边重叠。',
      observations: ['建议人工复核标签位置。'],
      patches: [{ insert: '\\draw' }],
    }));
    expect(widget).toMatchObject({ kind: 'visual-audit', status: 'warning', fidelity: 'drift' });
    expect(widget).not.toHaveProperty('patches');
  });

  it('lowers provider fidelity claims when the exact surface is absent', () => {
    const response = JSON.stringify({
      schemaVersion: 'tikz-visual-audit/v3',
      status: 'passed',
      fidelity: 'matched',
      summary: '交互渲染看起来稳定。',
      observations: [],
    });
    expect(parseTikzVisualAuditResponse(response, { exactImageProvided: false })).toMatchObject({
      fidelity: 'not-compared',
    });
    expect(normalizeTikzVisualAuditFidelity({
      kind: 'visual-audit',
      title: 'VLM 视觉复核',
      status: 'passed',
      fidelity: 'drift',
      summary: '交互渲染看起来稳定。',
      observations: [],
    }, false)).toMatchObject({ fidelity: 'not-compared' });
  });
});
