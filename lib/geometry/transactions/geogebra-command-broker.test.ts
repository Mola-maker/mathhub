import { describe, expect, it } from 'vitest';
import {
  GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION,
  GeogebraCommandTransactionBroker,
  createGeogebraAppliedScriptReceipt,
  createGeogebraObservedCommandSnapshotReceipt,
  createGeogebraReplaceScriptTransaction,
  geogebraCommandSourceHash,
  type GeogebraAppliedScriptReceipt,
  type GeogebraCommandTransaction,
} from './geogebra-command-broker';

const commands = ['A=(0,0)', 'B=(4,0)', 'AB=Segment(A,B)'] as const;

function broker() {
  return new GeogebraCommandTransactionBroker({
    documentId: 'math-studio-test',
    epoch: 'epoch-test',
  });
}

function transaction(
  target: GeogebraCommandTransactionBroker,
  transactionId = 'transaction-1',
) {
  return createGeogebraReplaceScriptTransaction({
    snapshot: target.snapshot(),
    commands,
    transactionId,
    origin: 'ai',
  });
}

function receipt(
  request: GeogebraCommandTransaction,
  targetCommands: readonly string[] = commands,
) {
  return createGeogebraAppliedScriptReceipt({
    transactionId: request.transactionId,
    commands: targetCommands,
    successfulCommandCount: targetCommands.length,
    failureCount: 0,
    appliedAt: 1_800_000_000_000,
  })!;
}

describe('GeogebraCommandTransactionBroker', () => {
  it('commits only an exact host-applied script against the current basis', () => {
    const target = broker();
    const before = target.snapshot();
    const request = transaction(target);
    const result = target.commitApplied(request, receipt(request));

    expect(result).toMatchObject({
      ok: true,
      status: 'committed',
      snapshot: {
        commands,
        geometryDoc: {
          basis: {
            documentId: 'math-studio-test',
            epoch: 'epoch-test',
            revision: 1,
            sourceHash: geogebraCommandSourceHash(commands),
          },
        },
        semanticSignature: { comparable: true },
      },
    });
    expect(before.geometryDoc.basis.revision).toBe(0);
    expect(target.snapshot().commands).toEqual(commands);
  });

  it('rejects stale revisions and hashes without changing the snapshot', () => {
    const target = broker();
    const request = transaction(target);
    const committed = target.commitApplied(request, receipt(request));
    expect(committed.ok).toBe(true);
    const after = target.snapshot();

    const staleRevision = target.commitApplied(
      { ...request, transactionId: 'transaction-stale-revision', idempotencyKey: 'transaction-stale-revision' },
      {
        ...receipt(request),
        transactionId: 'transaction-stale-revision',
      },
    );
    expect(staleRevision).toMatchObject({
      ok: false,
      status: 'conflict',
      code: 'revision-mismatch',
    });

    const fresh = createGeogebraReplaceScriptTransaction({
      snapshot: after,
      commands: [...commands, 'M=Midpoint(A,B)'],
      transactionId: 'transaction-stale-hash',
      origin: 'canvas',
    });
    const staleHash = target.commitApplied(
      { ...fresh, beforeSourceHash: 'stale-source-hash' },
      receipt(fresh, [...commands, 'M=Midpoint(A,B)']),
    );
    expect(staleHash).toMatchObject({
      ok: false,
      status: 'conflict',
      code: 'source-hash-mismatch',
    });
    expect(target.snapshot()).toEqual(after);
  });

  it('deduplicates an identical retry and rejects idempotency-key reuse', () => {
    const target = broker();
    const request = transaction(target);
    expect(target.commitApplied(request, receipt(request))).toMatchObject({
      ok: true,
      status: 'committed',
    });
    expect(target.commitApplied(request, receipt(request))).toMatchObject({
      ok: true,
      status: 'idempotent',
    });

    const changed = {
      ...request,
      patches: [{ ...request.patches[0]!, insert: ['A=(1,1)'] }],
    };
    expect(target.commitApplied(changed, receipt(changed, ['A=(1,1)']))).toMatchObject({
      ok: false,
      status: 'conflict',
      code: 'idempotency-conflict',
    });
  });

  it('rejects patch precondition and host receipt mismatches', () => {
    const target = broker();
    const request = transaction(target);
    const badPatch = {
      ...request,
      transactionId: 'transaction-bad-patch',
      idempotencyKey: 'transaction-bad-patch',
      patches: [{ ...request.patches[0]!, expected: ['unexpected'] }],
    };
    expect(target.commitApplied(badPatch, receipt(badPatch))).toMatchObject({
      ok: false,
      code: 'patch-precondition-failed',
    });

    const badReceipt: GeogebraAppliedScriptReceipt = {
      ...receipt(request),
      schemaVersion: GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION,
      candidateSourceHash: 'wrong-hash',
    };
    expect(target.commitApplied(request, badReceipt)).toMatchObject({
      ok: false,
      status: 'rejected',
      code: 'applied-receipt-mismatch',
    });
    expect(target.snapshot().geometryDoc.basis.revision).toBe(0);
  });

  it('refuses to mint a success receipt for partial execution', () => {
    expect(createGeogebraAppliedScriptReceipt({
      transactionId: 'transaction-partial',
      commands,
      successfulCommandCount: commands.length - 1,
      failureCount: 1,
    })).toBeNull();
  });

  it('commits a complete independently observed live command snapshot', () => {
    const target = broker();
    const request = createGeogebraReplaceScriptTransaction({
      snapshot: target.snapshot(),
      commands,
      transactionId: 'transaction-observed',
      origin: 'canvas',
    });
    const observed = createGeogebraObservedCommandSnapshotReceipt({
      transactionId: request.transactionId,
      snapshot: {
        complete: true,
        commands,
        sourceHash: geogebraCommandSourceHash(commands),
        objectCount: 3,
      },
      observedAt: 1_800_000_000_000,
    });

    expect(observed).not.toBeNull();
    expect(target.commitObserved(request, observed!)).toMatchObject({
      ok: true,
      status: 'committed',
      record: { evidence: 'observed-live-snapshot' },
      snapshot: { commands },
    });
  });

  it('refuses to mint an observed receipt for an incomplete snapshot', () => {
    expect(createGeogebraObservedCommandSnapshotReceipt({
      transactionId: 'transaction-observed-incomplete',
      snapshot: {
        complete: false,
        commands,
        sourceHash: geogebraCommandSourceHash(commands),
        objectCount: 3,
      },
    })).toBeNull();
  });
});
