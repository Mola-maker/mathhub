import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

vi.mock('@/lib/client-ip', () => ({ clientIp: vi.fn(async () => '127.0.0.1') }));
vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 11, resetMs: 60_000 })),
}));
vi.mock('@/lib/provider/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/provider/settings')>();
  return {
    ...original,
    getEffectiveProvider: vi.fn(async () => ({
      apiKey: 'secret',
      baseUrl: 'https://api.molamaker.cn',
      model: 'drawing-model',
      visionModel: 'vlm-pro',
      configured: true,
    })),
  };
});

import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/tikz/visual-audit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /api/tikz/visual-audit', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns only a read-only visual audit widget', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            schemaVersion: 'tikz-visual-audit/v3',
            status: 'passed',
            fidelity: 'matched',
            summary: '图元、标签与语义摘要一致。',
            observations: [],
            patches: [{ insert: '\\draw' }],
          }),
        },
      }],
    }), { status: 200 }));
    const response = await POST(request({
      model: 'vlm-model',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 3,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: '{"entities":[]}',
      interactiveImageDataUrl: `data:image/png;base64,${Buffer.from('interactive').toString('base64')}`,
      exactImageDataUrl: `data:image/png;base64,${Buffer.from('exact').toString('base64')}`,
      artifactDigest: 'a'.repeat(64),
    }));
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.assistantWidget).toMatchObject({
      kind: 'visual-audit',
      status: 'passed',
      fidelity: 'matched',
    });
    expect(payload).toMatchObject({
      sourceRevision: 3,
      sourceHash: 'a1b2c3d4e5f60718',
      documentId: 'document-1',
      epoch: 'epoch-1',
      artifactDigest: 'a'.repeat(64),
      comparisonArtifact: {
        schemaVersion: 'tikz-render-comparison-artifact/v1',
        mode: 'interactive-vs-exact',
        interactiveRasterDigest: createHash('sha256').update('interactive').digest('hex'),
        exactRasterDigest: createHash('sha256').update('exact').digest('hex'),
        exactArtifactDigest: 'a'.repeat(64),
      },
    });
    expect(JSON.stringify(payload)).not.toContain('patches');
    const upstreamBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    ) as { model?: unknown; messages?: Array<{ content?: unknown }> };
    expect(upstreamBody.model).toBe('vlm-pro');
    expect(JSON.stringify(upstreamBody.messages)).toContain('interactiveRasterDigest=');
    expect(JSON.stringify(upstreamBody.messages)).toContain('exactRasterDigest=');
  });

  it('rejects SVG data before calling the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await POST(request({
      model: 'vlm-model',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 0,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: '{}',
      interactiveImageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
    }));
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not expose matched fidelity when only the interactive image was sent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            schemaVersion: 'tikz-visual-audit/v3',
            status: 'passed',
            fidelity: 'matched',
            summary: '交互画布看起来与语义摘要一致。',
            observations: [],
          }),
        },
      }],
    }), { status: 200 }));
    const response = await POST(request({
      model: 'vlm-model',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceRevision: 3,
      sourceHash: 'a1b2c3d4e5f60718',
      semanticSummary: '{}',
      interactiveImageDataUrl: `data:image/png;base64,${Buffer.from('interactive').toString('base64')}`,
    }));
    const payload = await response.json() as { assistantWidget?: { fidelity?: string } };
    expect(response.status).toBe(200);
    expect(payload.assistantWidget?.fidelity).toBe('not-compared');
  });
});
