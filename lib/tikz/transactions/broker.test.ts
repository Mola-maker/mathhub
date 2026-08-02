import { describe, expect, it } from 'vitest';
import { StudioDocument } from '../document/studio-document';
import type { GeometryTransactionRequest } from '../ir/transactions';
import { hashSource } from '../semantics/scene-manifest';
import { TikzTransactionBroker } from './broker';

function requestFor(
  document: StudioDocument,
  pluginSetDigest: string,
): GeometryTransactionRequest {
  const snapshot = document.getSnapshot();
  const sourceId = `${snapshot.documentId}:tikz`;
  const from = snapshot.source.indexOf('(0,0)');
  const to = from + 5;
  return {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: 'transaction-1',
    idempotencyKey: 'transaction-1',
    documentId: snapshot.documentId,
    documentEpoch: snapshot.epoch,
    origin: 'ai',
    stage: 'validated',
    expectedRevision: snapshot.revision,
    sourceHash: hashSource(snapshot.source),
    pluginSetDigest,
    readSet: [{
      kind: 'source-range',
      sourceId,
      range: { start: from, end: to },
    }],
    writeSet: [{
      kind: 'source-range',
      sourceId,
      range: { start: from, end: to },
    }],
    preconditions: [{
      kind: 'source-slice-equals',
      sourceId,
      range: { start: from, end: to },
      text: '(0,0)',
    }],
    operations: [{
      operationId: 'operation-1',
      op: 'source-patch',
      patches: [{
        sourceId,
        range: { start: from, end: to },
        insert: '(1,1)',
        expectedText: '(0,0)',
      }],
    }],
  };
}

describe('TikzTransactionBroker semantic guards', () => {
  it('在最终提交点拒绝不匹配的 kernel hash', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const result = new TikzTransactionBroker(document).commit(
      {
        ...requestFor(document, 'plugins-current'),
        expectedKernelHash: 'kernel-expected',
      },
      {
        hash: hashSource(snapshot.source),
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        kernelHash: 'kernel-current',
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'kernel-hash-mismatch',
    });
    expect(document.getSnapshot().source).toBe(snapshot.source);
  });

  it('在最终提交点拒绝不匹配的 plugin set', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const result = new TikzTransactionBroker(document).commit(
      requestFor(document, 'plugins-expected'),
      {
        hash: hashSource(snapshot.source),
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'plugin-set-mismatch',
    });
    expect(document.getSnapshot().source).toBe(snapshot.source);
  });

  it('匹配 guard 后只提交一次，同一幂等请求不会重复应用', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const broker = new TikzTransactionBroker(document);
    const request = requestFor(document, 'plugins-current');
    const evidence = {
      hash: hashSource(snapshot.source),
      algorithm: 'fnv1a64-utf8',
      source: snapshot.source,
      pluginSetDigest: 'plugins-current',
    };

    expect(broker.commit(request, evidence)).toMatchObject({
      ok: true,
      status: 'committed',
    });
    expect(broker.commit(request, evidence)).toMatchObject({
      ok: true,
      status: 'idempotent',
    });
    expect(document.getSnapshot().source).toContain('(1,1)');
  });
});
