import {
  isGeometryAgentContextCheckpoint,
  type GeometryAgentContextCheckpoint,
} from '@/lib/geometry/agent/conversation-context';

export const TIKZ_AGENT_RUN_BASIS_SCHEMA_VERSION =
  'tikz-agent-run-basis/v1' as const;
export const TIKZ_AGENT_RUN_CHECKPOINT_SCHEMA_VERSION =
  'tikz-agent-run-checkpoint/v1' as const;
export const TIKZ_AGENT_RUN_BASIS_TRANSITION_SCHEMA_VERSION =
  'tikz-agent-run-basis-transition/v1' as const;

export interface TikzAgentRunBasis {
  readonly schemaVersion: typeof TIKZ_AGENT_RUN_BASIS_SCHEMA_VERSION;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly semanticHash?: string;
  readonly relationHash?: string;
  readonly pluginSetDigest?: string;
}

export interface TikzAgentRunCheckpoint {
  readonly schemaVersion: typeof TIKZ_AGENT_RUN_CHECKPOINT_SCHEMA_VERSION;
  readonly runId: string;
  readonly basis: TikzAgentRunBasis;
  readonly contextCheckpoint: GeometryAgentContextCheckpoint;
  readonly createdAt: number;
}

export interface TikzAgentRunBasisTransition {
  readonly schemaVersion: typeof TIKZ_AGENT_RUN_BASIS_TRANSITION_SCHEMA_VERSION;
  readonly runId: string;
  readonly transactionId: string;
  readonly before: TikzAgentRunBasis;
  readonly after: TikzAgentRunBasis;
  readonly createdAt: number;
}

export type TikzAgentReplayBasis = Pick<
  TikzAgentRunBasis,
  'documentId' | 'epoch' | 'sourceId' | 'revision' | 'sourceHash'
>;

function boundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function isTikzAgentRunBasis(value: unknown): value is TikzAgentRunBasis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const basis = value as Partial<TikzAgentRunBasis>;
  return basis.schemaVersion === TIKZ_AGENT_RUN_BASIS_SCHEMA_VERSION
    && boundedIdentity(basis.documentId)
    && boundedIdentity(basis.epoch)
    && boundedIdentity(basis.sourceId)
    && Number.isSafeInteger(basis.revision)
    && (basis.revision ?? -1) >= 0
    && boundedIdentity(basis.sourceHash)
    && (basis.semanticHash === undefined || boundedIdentity(basis.semanticHash))
    && (basis.relationHash === undefined || boundedIdentity(basis.relationHash))
    && (
      basis.pluginSetDigest === undefined
      || boundedIdentity(basis.pluginSetDigest)
    );
}

export function sameTikzAgentReplayBasis(
  left: TikzAgentReplayBasis,
  right: TikzAgentReplayBasis,
): boolean {
  return left.documentId === right.documentId
    && left.epoch === right.epoch
    && left.sourceId === right.sourceId
    && left.revision === right.revision
    && left.sourceHash === right.sourceHash;
}

export function sameTikzAgentRunBasis(
  left: TikzAgentRunBasis,
  right: TikzAgentRunBasis,
): boolean {
  return sameTikzAgentReplayBasis(left, right)
    && left.schemaVersion === right.schemaVersion
    && left.semanticHash === right.semanticHash
    && left.relationHash === right.relationHash
    && left.pluginSetDigest === right.pluginSetDigest;
}

export function isTikzAgentRunCheckpoint(
  value: unknown,
): value is TikzAgentRunCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Partial<TikzAgentRunCheckpoint>;
  const contextBasis = checkpoint.contextCheckpoint?.basis;
  return checkpoint.schemaVersion === TIKZ_AGENT_RUN_CHECKPOINT_SCHEMA_VERSION
    && boundedIdentity(checkpoint.runId)
    && isTikzAgentRunBasis(checkpoint.basis)
    && isGeometryAgentContextCheckpoint(checkpoint.contextCheckpoint)
    && checkpoint.contextCheckpoint.lane === 'tikz'
    && contextBasis?.attestation === 'server-attested'
    && contextBasis.documentId === checkpoint.basis.documentId
    && contextBasis.epoch === checkpoint.basis.epoch
    && contextBasis.sourceId === checkpoint.basis.sourceId
    && contextBasis.revision === checkpoint.basis.revision
    && contextBasis.sourceHash === checkpoint.basis.sourceHash
    && contextBasis.semanticHash === checkpoint.basis.semanticHash
    && contextBasis.relationHash === checkpoint.basis.relationHash
    && Number.isSafeInteger(checkpoint.createdAt)
    && (checkpoint.createdAt ?? 0) > 0;
}

export function isTikzAgentRunBasisTransition(
  value: unknown,
): value is TikzAgentRunBasisTransition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const transition = value as Partial<TikzAgentRunBasisTransition>;
  return transition.schemaVersion === TIKZ_AGENT_RUN_BASIS_TRANSITION_SCHEMA_VERSION
    && boundedIdentity(transition.runId)
    && boundedIdentity(transition.transactionId)
    && isTikzAgentRunBasis(transition.before)
    && isTikzAgentRunBasis(transition.after)
    && transition.before.documentId === transition.after.documentId
    && transition.before.epoch === transition.after.epoch
    && transition.before.sourceId === transition.after.sourceId
    && transition.before.pluginSetDigest === transition.after.pluginSetDigest
    && transition.after.revision === transition.before.revision + 1
    && transition.after.sourceHash !== transition.before.sourceHash
    && Number.isSafeInteger(transition.createdAt)
    && (transition.createdAt ?? 0) > 0;
}

export function createTikzAgentRunCheckpoint(input: {
  readonly runId: string;
  readonly contextCheckpoint: GeometryAgentContextCheckpoint;
  readonly pluginSetDigest?: string;
  readonly createdAt?: number;
}): TikzAgentRunCheckpoint | null {
  const contextBasis = input.contextCheckpoint.basis;
  if (
    contextBasis?.lane !== 'tikz'
    || contextBasis.attestation !== 'server-attested'
    || !contextBasis.sourceId
  ) return null;
  const checkpoint: TikzAgentRunCheckpoint = {
    schemaVersion: TIKZ_AGENT_RUN_CHECKPOINT_SCHEMA_VERSION,
    runId: input.runId,
    basis: {
      schemaVersion: TIKZ_AGENT_RUN_BASIS_SCHEMA_VERSION,
      documentId: contextBasis.documentId,
      epoch: contextBasis.epoch,
      sourceId: contextBasis.sourceId,
      revision: contextBasis.revision,
      sourceHash: contextBasis.sourceHash,
      ...(contextBasis.semanticHash
        ? { semanticHash: contextBasis.semanticHash }
        : {}),
      ...(contextBasis.relationHash
        ? { relationHash: contextBasis.relationHash }
        : {}),
      ...(input.pluginSetDigest ? { pluginSetDigest: input.pluginSetDigest } : {}),
    },
    contextCheckpoint: input.contextCheckpoint,
    createdAt: input.createdAt ?? Date.now(),
  };
  return isTikzAgentRunCheckpoint(checkpoint) ? checkpoint : null;
}

export function createTikzAgentRunBasisTransition(input: {
  readonly runId: string;
  readonly transactionId: string;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly beforeRevision: number;
  readonly beforeSourceHash: string;
  readonly afterRevision: number;
  readonly afterSourceHash: string;
  readonly pluginSetDigest?: string;
  readonly createdAt?: number;
}): TikzAgentRunBasisTransition | null {
  const shared = {
    schemaVersion: TIKZ_AGENT_RUN_BASIS_SCHEMA_VERSION,
    documentId: input.documentId,
    epoch: input.epoch,
    sourceId: input.sourceId,
    ...(input.pluginSetDigest ? { pluginSetDigest: input.pluginSetDigest } : {}),
  } as const;
  const transition: TikzAgentRunBasisTransition = {
    schemaVersion: TIKZ_AGENT_RUN_BASIS_TRANSITION_SCHEMA_VERSION,
    runId: input.runId,
    transactionId: input.transactionId,
    before: {
      ...shared,
      revision: input.beforeRevision,
      sourceHash: input.beforeSourceHash,
    },
    after: {
      ...shared,
      revision: input.afterRevision,
      sourceHash: input.afterSourceHash,
    },
    createdAt: input.createdAt ?? Date.now(),
  };
  return isTikzAgentRunBasisTransition(transition) ? transition : null;
}
