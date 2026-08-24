import { afterEach, describe, expect, it, vi } from 'vitest';
import { __problemGatewayTest } from './source-gateway';
import {
  createProblemInspectionReceipt,
  verifyProblemInspectionReceipt,
} from './problem-inspection-receipt.server';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fixture() {
  return __problemGatewayTest.mathNetRecord({
    id: 'receipt-fixture',
    problem_markdown: 'Let ABC be a triangle.',
    solutions_markdown: ['A private source solution.'],
    topics_flat: ['Geometry > Triangle'],
  }, 4)!;
}

describe('problem inspection receipt', () => {
  it('round-trips a bounded read-only capability without carrying source bodies', () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const receipt = createProblemInspectionReceipt(fixture(), now);

    expect(verifyProblemInspectionReceipt(receipt, new Date(now.getTime() + 1_000)))
      .toEqual(receipt);
    expect(receipt).toMatchObject({
      mode: 'read-only-analysis',
      taint: 'untrusted-external-reference',
      writeAuthority: 'none',
    });
    expect(receipt).not.toHaveProperty('statement');
    expect(receipt).not.toHaveProperty('solutions');
  });

  it('rejects tampering, extra fields, and expiry', () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const receipt = createProblemInspectionReceipt(fixture(), now);
    expect(verifyProblemInspectionReceipt({
      ...receipt,
      title: 'Forged title',
    }, new Date(now.getTime() + 1_000))).toBeNull();
    expect(verifyProblemInspectionReceipt({
      ...receipt,
      writeRequest: '\\draw (A)--(B);',
    }, new Date(now.getTime() + 1_000))).toBeNull();
    expect(verifyProblemInspectionReceipt(
      receipt,
      new Date(receipt.expiresAt),
    )).toBeNull();
  });
});
