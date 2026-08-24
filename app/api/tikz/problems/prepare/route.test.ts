import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/client-ip', () => ({
  clientIp: vi.fn(async () => '127.0.0.1'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 19, resetMs: 60_000 })),
}));

vi.mock('@/lib/tikz/problems/source-gateway', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/tikz/problems/source-gateway')>();
  return {
    ...original,
    resolveGeometryProblemReference: vi.fn(),
  };
});

import { POST } from './route';
import {
  __problemGatewayTest,
  resolveGeometryProblemReference,
} from '@/lib/tikz/problems/source-gateway';

const request = (body: unknown) => new NextRequest(
  'http://localhost/api/tikz/problems/prepare',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  },
);

function fixture() {
  return __problemGatewayTest.mathNetRecord({
    id: 'prepare-fixture',
    competition: 'Geometry Olympiad',
    problem_markdown: 'Let ABC be a triangle and construct its nine-point circle.',
    solutions_markdown: ['Sensitive dataset-provided solution.'],
    topics_flat: ['Geometry > Triangle > Nine-point circle'],
  }, 12)!;
}

describe('POST /api/tikz/problems/prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-attests an exact row and issues only a read-only metadata receipt', async () => {
    const problem = fixture();
    vi.mocked(resolveGeometryProblemReference).mockResolvedValue(problem);

    const response = await POST(request({
      source: problem.source,
      id: problem.id,
      contentHash: problem.contentHash,
      provider: problem.provider,
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(payload.receipt).toMatchObject({
      sourceId: problem.id,
      contentHash: problem.contentHash,
      writeAuthority: 'none',
    });
    expect(payload).not.toHaveProperty('statement');
    expect(payload).not.toHaveProperty('solutions');
    expect(JSON.stringify(payload)).not.toContain('Sensitive dataset-provided solution.');
  });

  it('fails closed when the live row changed or the source is blocked', async () => {
    const problem = fixture();
    vi.mocked(resolveGeometryProblemReference).mockResolvedValueOnce(null);
    const changed = await POST(request({
      source: problem.source,
      id: problem.id,
      contentHash: problem.contentHash,
      provider: problem.provider,
    }));
    expect(changed.status).toBe(409);

    vi.mocked(resolveGeometryProblemReference).mockResolvedValueOnce({
      ...problem,
      rights: {
        ...problem.rights,
        sourceMaterialRights: 'blocked',
      },
    });
    const blocked = await POST(request({
      source: problem.source,
      id: problem.id,
      contentHash: problem.contentHash,
      provider: problem.provider,
    }));
    expect(blocked.status).toBe(403);
  });

  it('rejects a browser selector without a re-attestable row coordinate', async () => {
    const problem = fixture();
    const response = await POST(request({
      source: problem.source,
      id: problem.id,
      contentHash: problem.contentHash,
      provider: { ...problem.provider, rowIndex: undefined },
    }));
    expect(response.status).toBe(400);
    expect(vi.mocked(resolveGeometryProblemReference)).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before reading or resolving a reference', async () => {
    const response = await POST(new NextRequest(
      'http://localhost/api/tikz/problems/prepare',
      {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(8 * 1024 + 1),
        },
      },
    ));
    expect(response.status).toBe(413);
    expect(vi.mocked(resolveGeometryProblemReference)).not.toHaveBeenCalled();
  });
});
