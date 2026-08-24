import {
  hashSourceAsync,
  hashSourceUsing,
  isSourceHashAlgorithm,
  type SourceHashAlgorithm,
} from '@/lib/tikz/document/source-hash';
import type { GeometryTransactionRequest } from '@/lib/tikz/ir/transactions';

export const AI_TRANSACTION_ATTESTATION_SCHEMA_VERSION =
  'ai-transaction-attestation/v1' as const;

export interface AiTransactionAttestation {
  readonly schemaVersion: typeof AI_TRANSACTION_ATTESTATION_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly algorithm: SourceHashAlgorithm;
  readonly digest: string;
}

/**
 * Canonical material shared by the server compiler and browser compiler.
 *
 * The proposal is transported once. The much larger transaction is rebuilt
 * independently in the browser, attested here, and then replayed again by the
 * Broker. Keeping every Broker-consumed proof field in this material prevents
 * a compact transport from weakening the existing three-party agreement.
 */
export function aiTransactionCommitMaterial(
  transaction: GeometryTransactionRequest,
): string {
  return JSON.stringify({
    schemaVersion: transaction.schemaVersion,
    transactionId: transaction.transactionId,
    idempotencyKey: transaction.idempotencyKey,
    documentId: transaction.documentId,
    documentEpoch: transaction.documentEpoch,
    origin: transaction.origin,
    stage: transaction.stage,
    expectedRevision: transaction.expectedRevision,
    sourceHash: transaction.sourceHash,
    expectedKernelHash: transaction.expectedKernelHash,
    expectedProjectionHash: transaction.expectedProjectionHash,
    pluginSetDigest: transaction.pluginSetDigest,
    readSet: transaction.readSet,
    writeSet: transaction.writeSet,
    preconditions: transaction.preconditions,
    operations: transaction.operations,
    workspaceEdit: transaction.workspaceEdit,
    actorId: transaction.actorId,
    correlationId: transaction.correlationId,
    proposalSchemaVersion: transaction.metadata?.proposalSchemaVersion,
    semanticWrite: transaction.metadata?.semanticWrite,
    managedConstructionOperationKind:
      transaction.metadata?.managedConstructionOperationKind,
    sourceEditOrigin: transaction.metadata?.sourceEditOrigin,
    managedConstructionRecompileProof:
      transaction.metadata?.managedConstructionRecompileProof,
    managedConstructionCreateProof:
      transaction.metadata?.managedConstructionCreateProof,
    managedConstructionStyleProof:
      transaction.metadata?.managedConstructionStyleProof,
    managedPresentationTargetEntityId:
      transaction.metadata?.managedPresentationTargetEntityId,
    hostSemanticActionBatchProof:
      transaction.metadata?.hostSemanticActionBatchProof,
    hostSemanticActionSetProof:
      transaction.metadata?.hostSemanticActionSetProof,
    managedConstructionCreateProofs:
      transaction.metadata?.managedConstructionCreateProofs,
    constructionIntentProofs:
      transaction.metadata?.constructionIntentProofs,
    aiSemanticDeleteIntentProof:
      transaction.metadata?.aiSemanticDeleteIntentProof,
    canvasDeleteProof:
      transaction.metadata?.canvasDeleteProof,
    aiSelectionTransformIntentProof:
      transaction.metadata?.aiSelectionTransformIntentProof,
    canvasSelectionTransformProof:
      transaction.metadata?.canvasSelectionTransformProof,
    authoringSchemaVersion: transaction.metadata?.authoringSchemaVersion,
    canvasConstructionBatchProof:
      transaction.metadata?.canvasConstructionBatchProof,
    constructionIntentProof: transaction.metadata?.constructionIntentProof,
    constructionDagIntentProof:
      transaction.metadata?.constructionDagIntentProof,
    focusBindingIds: transaction.metadata?.focusBindingIds,
    readBindingIds: transaction.metadata?.readBindingIds,
    bindingPreconditions: transaction.metadata?.bindingPreconditions,
    agentRunId: transaction.metadata?.agentRunId,
  });
}

export async function attestAiTransaction(
  transaction: GeometryTransactionRequest,
): Promise<AiTransactionAttestation> {
  const fingerprint = await hashSourceAsync(
    aiTransactionCommitMaterial(transaction),
  );
  return {
    schemaVersion: AI_TRANSACTION_ATTESTATION_SCHEMA_VERSION,
    transactionId: transaction.transactionId,
    algorithm: fingerprint.algorithm,
    digest: fingerprint.hash,
  };
}

export async function matchesAiTransactionAttestation(
  value: unknown,
  transaction: GeometryTransactionRequest,
): Promise<boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== AI_TRANSACTION_ATTESTATION_SCHEMA_VERSION
    || candidate.transactionId !== transaction.transactionId
    || !isSourceHashAlgorithm(candidate.algorithm)
    || typeof candidate.digest !== 'string'
    || candidate.digest.length === 0
  ) return false;
  const digest = await hashSourceUsing(
    aiTransactionCommitMaterial(transaction),
    candidate.algorithm,
  );
  return digest !== null && digest === candidate.digest;
}
