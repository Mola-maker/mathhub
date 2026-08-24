import { describe, expect, it } from 'vitest';
import { __problemGatewayTest } from './source-gateway';
import { createProblemInspectionReceipt } from './problem-inspection-receipt.server';
import {
  createProblemConstructionAction,
  verifyProblemConstructionAction,
} from './problem-construction-action.server';

function fixture() {
  return __problemGatewayTest.mathNetRecord({
    id: 'construction-action-fixture',
    problem_markdown: 'Let ABC be a triangle and construct its nine-point circle.',
    solutions_markdown: ['Sensitive source solution.'],
    topics_flat: ['Geometry > Triangle'],
  }, 9)!;
}

const basis = {
  documentId: 'document-test',
  epoch: 'epoch-test',
  revision: 7,
  sourceId: 'document-test:tikz',
  sourceHash: '0123456789abcdef',
  kernelHash: 'kernel-test',
  projectionHash: 'projection-test',
  pluginSetDigest: 'plugins-test',
};

describe('problem construction action', () => {
  it('binds construct-only authority to the inspected problem and GeometryDoc basis', () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const problem = fixture();
    const receipt = createProblemInspectionReceipt(problem, now);
    const action = createProblemConstructionAction(problem, receipt, basis, now);

    expect(verifyProblemConstructionAction(action, new Date(now.getTime() + 1_000)))
      .toEqual(action);
    expect(action).toMatchObject({
      inspectionReceiptId: receipt.receiptId,
      basis,
      writeAuthority: 'construct-only',
      allowedGeometryIntentOperations: ['construct', 'construct-dag'],
    });
    expect(action).not.toHaveProperty('statement');
    expect(action).not.toHaveProperty('solutions');
  });

  it('rejects changed basis, widened operations, extra fields, and expiry', () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const problem = fixture();
    const receipt = createProblemInspectionReceipt(problem, now);
    const action = createProblemConstructionAction(problem, receipt, basis, now);

    expect(verifyProblemConstructionAction({
      ...action,
      basis: { ...action.basis, revision: action.basis.revision + 1 },
    }, new Date(now.getTime() + 1_000))).toBeNull();
    expect(verifyProblemConstructionAction({
      ...action,
      allowedGeometryIntentOperations: ['construct', 'construct-dag', 'delete'],
    }, new Date(now.getTime() + 1_000))).toBeNull();
    expect(verifyProblemConstructionAction({
      ...action,
      rawTikz: '\\draw (A)--(B);',
    }, new Date(now.getTime() + 1_000))).toBeNull();
    expect(verifyProblemConstructionAction(action, new Date(action.expiresAt))).toBeNull();
  });
});
