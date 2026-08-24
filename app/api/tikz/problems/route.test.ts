import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/client-ip', () => ({ clientIp: vi.fn(async () => '127.0.0.1') }));
vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 29, resetMs: 60_000 })),
}));
vi.mock('@/lib/tikz/problems/source-gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tikz/problems/source-gateway')>(
    '@/lib/tikz/problems/source-gateway',
  );
  // Keep the production projection in this test. Only the remote search is
  // mocked so the public API's redaction boundary is exercised for real.
  return { ...actual, searchGeometryProblemSources: vi.fn() };
});

import { searchGeometryProblemSources } from '@/lib/tikz/problems/source-gateway';
import type { GeometryProblemRecord } from '@/lib/tikz/problems/source-gateway';
import { GET } from './route';

const searchMock = vi.mocked(searchGeometryProblemSources);

describe('GET /api/tikz/problems', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns attributed source results with a private cache boundary', async () => {
    searchMock.mockResolvedValueOnce({
      records: [],
      sourceStatus: [
        {
          id: 'mathnet', enabled: true, accessMode: 'live-search',
          sourceMaterialRights: 'conditional', detail: 'available',
        },
        {
          id: 'olympiadbench', enabled: true, accessMode: 'live-search',
          sourceMaterialRights: 'review-required', detail: 'available',
        },
        {
          id: 'formalgeo', enabled: false, accessMode: 'restricted-opt-in',
          sourceMaterialRights: 'review-required', detail: 'disabled',
        },
      ],
    });
    const response = await GET(new NextRequest('http://localhost/api/tikz/problems?q=Simson&limit=4'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60');
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 'geometry-problem-search/v2',
      query: 'Simson',
      records: [],
    });
  });

  it('projects full upstream rows to previews and never exposes statements or solutions', async () => {
    const upstream: GeometryProblemRecord = {
      id: 'mathnet:secret-row',
      source: 'mathnet',
      title: 'Secret geometry row',
      statement: 'FULL STATEMENT MUST STAY SERVER-SIDE',
      solutions: ['FULL SOLUTION MUST STAY SERVER-SIDE'],
      topics: ['Geometry'],
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=secret-row',
      datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
      license: 'Creative Commons Attribution 4.0 International',
      licenseId: 'CC-BY-4.0',
      contentHash: '0'.repeat(64),
      contentHashAlgorithm: 'sha256-utf8',
      contentHashScope: 'normalized-live-snapshot',
      solutionProvenance: 'dataset-provided',
      hasImages: false,
      assets: [],
      provider: {
        datasetId: 'ShadenA/MathNet',
        config: 'all',
        split: 'train',
        revision: null,
        revisionStatus: 'unpinned-live-viewer',
      },
      rights: {
        datasetLicenseId: 'CC-BY-4.0',
        codeLicenseId: 'unknown',
        sourceMaterialRights: 'conditional',
        redistribution: 'review-required',
        commercial: 'review-required',
        training: 'review-required',
        rowOverride: 'not-exposed',
        evidenceUrls: ['https://huggingface.co/datasets/ShadenA/MathNet'],
        notice: 'Original competition rights may remain with their owners.',
      },
      taint: 'untrusted-external-reference',
      admission: 'search-reference-only',
      retrievedAt: '2026-08-16T00:00:00.000Z',
    };
    searchMock.mockResolvedValueOnce({
      records: [upstream],
      sourceStatus: [{
        id: 'mathnet',
        enabled: true,
        accessMode: 'live-search',
        sourceMaterialRights: 'conditional',
        detail: 'available',
      }],
    });

    const response = await GET(new NextRequest('http://localhost/api/tikz/problems?q=secret'));
    const body = await response.json() as {
      records: Array<Record<string, unknown>>;
    };
    expect(response.status).toBe(200);
    expect(body.records[0]).toMatchObject({
      id: 'mathnet:secret-row',
      statementPreview: 'FULL STATEMENT MUST STAY SERVER-SIDE',
      solutionCount: 1,
    });
    expect(body.records[0]).not.toHaveProperty('statement');
    expect(body.records[0]).not.toHaveProperty('solutions');
    expect(JSON.stringify(body)).not.toContain('FULL SOLUTION MUST STAY SERVER-SIDE');
  });

  it('returns a structured degraded result instead of HTTP 500 on the gateway deadline', async () => {
    const timeout = new AbortController();
    timeout.abort(new DOMException('The operation timed out', 'TimeoutError'));
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    searchMock.mockRejectedValueOnce(timeout.signal.reason);

    const response = await GET(new NextRequest('http://localhost/api/tikz/problems?q=nine-point'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 'geometry-problem-search/v2',
      degraded: true,
      records: [],
      sourceStatus: expect.arrayContaining([
        { id: 'mathnet', enabled: false, accessMode: 'live-search', sourceMaterialRights: 'conditional', detail: 'upstream timeout' },
        { id: 'olympiadbench', enabled: false, accessMode: 'live-search', sourceMaterialRights: 'review-required', detail: 'upstream timeout' },
        expect.objectContaining({ id: 'formalgeo', enabled: false }),
      ]),
    });
  });
});
