import { describe, expect, it } from 'vitest';
import { GEOMETRY_TRANSACTION_SCHEMA_VERSION } from '@/lib/tikz/ir/transactions';
import type { GeometryTransactionRequest } from '@/lib/tikz/ir/transactions';
import {
  attestAiTransaction,
  matchesAiTransactionAttestation,
} from './transaction-attestation';

function transaction(): GeometryTransactionRequest {
  return {
    schemaVersion: GEOMETRY_TRANSACTION_SCHEMA_VERSION,
    transactionId: 'ai-style-nine-point-circle',
    idempotencyKey: 'ai-style-nine-point-circle',
    documentId: 'document-1',
    documentEpoch: 'epoch-1',
    origin: 'ai',
    stage: 'validated',
    expectedRevision: 1,
    sourceHash: 'source-hash-1',
    expectedKernelHash: 'kernel-hash-1',
    expectedProjectionHash: 'projection-hash-1',
    pluginSetDigest: 'plugins-1',
    readSet: [],
    writeSet: [{
      kind: 'source-range',
      sourceId: 'document-1:tikz',
      range: { start: 10, end: 20 },
      sliceHash: 'slice-1',
    }],
    preconditions: [],
    operations: [{
      op: 'source-patch',
      operationId: 'style-circle',
      patches: [{
        sourceId: 'document-1:tikz',
        range: { start: 10, end: 20 },
        expectedText: 'circle',
        insert: '[red,very thick] circle',
      }],
    }],
    metadata: {
      proposalSchemaVersion: 'managed-presentation-intent/v1',
      managedConstructionOperationKind: 'style',
      managedPresentationTargetEntityId: 'circle-N1',
      focusBindingIds: ['binding:circle'],
      readBindingIds: ['binding:circle'],
      bindingPreconditions: [{ bindingId: 'binding:circle', sliceHash: 'slice-1' }],
      agentRunId: 'run-1',
    },
  };
}

describe('AI transaction transport attestation', () => {
  it('accepts the independently rebuilt transaction without transporting it', async () => {
    const value = transaction();
    const attestation = await attestAiTransaction(value);
    expect(JSON.stringify({ sourceTransactionAttestation: attestation }).length)
      .toBeLessThan(1_024);
    await expect(matchesAiTransactionAttestation(attestation, value))
      .resolves.toBe(true);
  });

  it('rejects tampered operations and Broker-consumed proof metadata', async () => {
    const value = transaction();
    const attestation = await attestAiTransaction(value);
    const changedPatch: GeometryTransactionRequest = {
      ...value,
      operations: [{
        op: 'source-patch',
        operationId: 'style-circle',
        patches: [{
          sourceId: 'document-1:tikz',
          range: { start: 10, end: 20 },
          expectedText: 'circle',
          insert: '[blue] circle',
        }],
      }],
    };
    const changedProof: GeometryTransactionRequest = {
      ...value,
      metadata: { ...value.metadata, readBindingIds: ['binding:other'] },
    };
    const changedSemanticWrite: GeometryTransactionRequest = {
      ...value,
      metadata: { ...value.metadata, semanticWrite: true },
    };
    const changedTarget: GeometryTransactionRequest = {
      ...value,
      metadata: {
        ...value.metadata,
        managedPresentationTargetEntityId: 'circle-other',
      },
    };
    const changedBatchProof: GeometryTransactionRequest = {
      ...value,
      metadata: {
        ...value.metadata,
        hostSemanticActionBatchProof: {
          schemaVersion: 'host-semantic-action-batch/v1',
          batchId: 'forged-batch',
        },
      },
    };
    const changedTransformProof: GeometryTransactionRequest = {
      ...value,
      metadata: {
        ...value.metadata,
        aiSelectionTransformIntentProof: {
          schemaVersion: 'ai-selection-transform-intent/v1',
          transform: { kind: 'translate', dx: 1, dy: 0 },
        },
        canvasSelectionTransformProof: {
          schemaVersion: 'canvas-selection-transform-proof/v1',
          impactedEntityIds: ['point:A'],
        },
      },
    };
    const changedDeleteProof: GeometryTransactionRequest = {
      ...value,
      metadata: {
        ...value.metadata,
        aiSemanticDeleteIntentProof: {
          schemaVersion: 'ai-semantic-delete-intent/v1',
          selectedEntityIds: ['point:A'],
          mode: 'block',
        },
        canvasDeleteProof: {
          schemaVersion: 'canvas-delete-proof/v1',
          mode: 'block',
          closureFingerprint: 'forged-closure',
        },
      },
    };
    const changedConstructionDagProof: GeometryTransactionRequest = {
      ...value,
      metadata: {
        ...value.metadata,
        constructionDagIntentProof: {
          schemaVersion: 'construction-dag-intent/v1',
          intentId: 'forged-dag',
        },
        canvasConstructionBatchProof: {
          schemaVersion: 'canvas-construction-batch-proof/v1',
          planProofs: [],
        },
      },
    };
    await expect(matchesAiTransactionAttestation(attestation, changedPatch))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedProof))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedSemanticWrite))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedTarget))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedBatchProof))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedTransformProof))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedDeleteProof))
      .resolves.toBe(false);
    await expect(matchesAiTransactionAttestation(attestation, changedConstructionDagProof))
      .resolves.toBe(false);
  });

  it('binds user-visible GeometryWorkspaceEdit annotations into the attestation', async () => {
    const value: GeometryTransactionRequest = {
      ...transaction(),
      workspaceEdit: {
        schemaVersion: 'geometry-workspace-edit/v1',
        failureHandling: 'atomic',
        changeAnnotations: {
          'change-1': { label: 'Style nine-point circle' },
          'change-1-patch-1': { label: 'Set circle stroke to red' },
        },
        operationAnnotations: [{
          operationId: 'style-circle',
          annotationId: 'change-1',
          patchAnnotationIds: ['change-1-patch-1'],
        }],
      },
    };
    const attestation = await attestAiTransaction(value);
    const tampered: GeometryTransactionRequest = {
      ...value,
      workspaceEdit: {
        ...value.workspaceEdit!,
        changeAnnotations: {
          ...value.workspaceEdit!.changeAnnotations,
          'change-1-patch-1': { label: 'Hide circle instead' },
        },
      },
    };
    await expect(matchesAiTransactionAttestation(attestation, tampered))
      .resolves.toBe(false);
  });
});
