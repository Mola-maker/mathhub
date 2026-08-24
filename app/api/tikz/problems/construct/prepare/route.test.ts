import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/client-ip', () => ({
  clientIp: vi.fn(async () => '127.0.0.1'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 11, resetMs: 60_000 })),
}));

vi.mock('@/lib/tikz/problems/source-gateway', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/tikz/problems/source-gateway')>();
  return { ...original, resolveGeometryProblemReference: vi.fn() };
});

import { POST } from './route';
import {
  __problemGatewayTest,
  resolveGeometryProblemReference,
} from '@/lib/tikz/problems/source-gateway';
import { createProblemInspectionReceipt } from '@/lib/tikz/problems/problem-inspection-receipt.server';

function fixture() {
  return __problemGatewayTest.mathNetRecord({
    id: 'construct-route-fixture',
    problem_markdown: 'Let ABC be a triangle.',
    solutions_markdown: ['Sensitive source solution.'],
    topics_flat: ['Geometry > Triangle'],
  }, 15)!;
}

const basis = {
  documentId: 'document-route',
  epoch: 'epoch-route',
  revision: 2,
  sourceId: 'document-route:tikz',
  sourceHash: '0123456789abcdef',
  kernelHash: 'kernel-route',
  projectionHash: 'projection-route',
  pluginSetDigest: 'plugins-route',
};

const request = (body: unknown) => new NextRequest(
  'http://localhost/api/tikz/problems/construct/prepare',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  },
);

describe('POST /api/tikz/problems/construct/prepare', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upgrades an explicit inspected reference to a short construct-only action', async () => {
    const problem = fixture();
    const receipt = createProblemInspectionReceipt(problem);
    vi.mocked(resolveGeometryProblemReference).mockResolvedValue(problem);
    const response = await POST(request({ inspectionReceipt: receipt, basis }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.action).toMatchObject({
      inspectionReceiptId: receipt.receiptId,
      basis,
      writeAuthority: 'construct-only',
    });
    expect(JSON.stringify(payload)).not.toContain('Sensitive source solution.');
  });

  it('rejects an invalid receipt before resolving and changed upstream metadata after resolving', async () => {
    const problem = fixture();
    const receipt = createProblemInspectionReceipt(problem);
    const invalid = await POST(request({
      inspectionReceipt: { ...receipt, title: 'forged' },
      basis,
    }));
    expect(invalid.status).toBe(403);
    expect(resolveGeometryProblemReference).not.toHaveBeenCalled();

    vi.mocked(resolveGeometryProblemReference).mockResolvedValue({
      ...problem,
      title: 'Changed upstream title',
    });
    const changed = await POST(request({ inspectionReceipt: receipt, basis }));
    expect(changed.status).toBe(409);
  });
});
