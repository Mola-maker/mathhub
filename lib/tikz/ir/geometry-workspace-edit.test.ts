import { describe, expect, it } from 'vitest';
import { StudioDocument } from '../document/studio-document';
import { hashSource } from '../document/source-hash';
import { TikzTransactionBroker } from '../transactions/broker';
import type { GeometryOperation, GeometryTransactionRequest } from './transactions';
import {
  createGeometryWorkspaceEdit,
  validateGeometryWorkspaceEdit,
} from './geometry-workspace-edit';

function transaction(document: StudioDocument): GeometryTransactionRequest {
  const snapshot = document.getSnapshot();
  const sourceId = `${snapshot.documentId}:tikz`;
  const start = snapshot.source.indexOf('(0,0)');
  const operation = {
    operationId: 'move-a',
    op: 'source-patch',
    patches: [{
      sourceId,
      range: { start, end: start + 5 },
      expectedText: '(0,0)',
      insert: '(1,1)',
    }],
  } satisfies GeometryOperation;
  return {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: 'workspace-edit-1',
    idempotencyKey: 'workspace-edit-1',
    documentId: snapshot.documentId,
    documentEpoch: snapshot.epoch,
    origin: 'external',
    stage: 'validated',
    expectedRevision: snapshot.revision,
    sourceHash: hashSource(snapshot.source),
    readSet: [{
      kind: 'source-range', sourceId,
      range: { start, end: start + 5 },
    }],
    writeSet: [{
      kind: 'source-range', sourceId,
      range: { start, end: start + 5 },
    }],
    operations: [operation],
    workspaceEdit: createGeometryWorkspaceEdit([operation], [{
      operationId: operation.operationId,
      label: 'Move point A',
      semanticTargetIds: ['point:A'],
      patchAnnotations: [{
        label: 'Update A coordinates',
        semanticTargetIds: ['point:A'],
      }],
    }]),
  };
}

describe('GeometryWorkspaceEdit/v1', () => {
  it('references the compiled operation and patch order without duplicating source edits', () => {
    const document = new StudioDocument('\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n');
    const request = transaction(document);
    expect(validateGeometryWorkspaceEdit(request)).toEqual([]);
    expect(request.workspaceEdit).toMatchObject({
      schemaVersion: 'geometry-workspace-edit/v1',
      failureHandling: 'atomic',
      operationAnnotations: [{
        operationId: 'move-a',
        patchAnnotationIds: ['change-1-patch-1'],
      }],
    });
    expect(JSON.stringify(request.workspaceEdit)).not.toContain('(1,1)');
  });

  it('rejects patch-count drift and unreferenced review metadata', () => {
    const document = new StudioDocument('\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n');
    const request = transaction(document);
    const edit = request.workspaceEdit!;
    const malformed: GeometryTransactionRequest = {
      ...request,
      workspaceEdit: {
        ...edit,
        changeAnnotations: {
          ...edit.changeAnnotations,
          unused: { label: 'Untrusted extra change' },
        },
        operationAnnotations: [{
          ...edit.operationAnnotations[0]!,
          patchAnnotationIds: [],
        }],
      },
    };
    expect(validateGeometryWorkspaceEdit(malformed).map((issue) => issue.code))
      .toEqual(expect.arrayContaining(['patch-mismatch', 'unreferenced-annotation']));
  });

  it('fails closed at the Broker before a forged review descriptor can commit', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n';
    const document = new StudioDocument(source);
    const request = transaction(document);
    const forged: GeometryTransactionRequest = {
      ...request,
      workspaceEdit: {
        ...request.workspaceEdit!,
        operationAnnotations: [{
          ...request.workspaceEdit!.operationAnnotations[0]!,
          operationId: 'different-operation',
        }],
      },
    };
    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 'rejected',
      code: 'invalid-request',
    });
    expect(document.getSnapshot()).toMatchObject({ source, revision: 0 });
  });
});
