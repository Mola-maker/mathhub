import { describe, expect, it } from 'vitest';
import { compactGeometryConversationContext } from '@/lib/geometry/agent/conversation-context';
import {
  createTikzAgentRunBasisTransition,
  createTikzAgentRunCheckpoint,
  isTikzAgentRunBasisTransition,
  isTikzAgentRunCheckpoint,
  sameTikzAgentRunBasis,
} from './run-checkpoint';

describe('TikZ Agent run checkpoint', () => {
  const contextCheckpoint = compactGeometryConversationContext([
    { role: 'user', content: 'construct the altitude' },
  ], {
    lane: 'tikz',
    basis: {
      lane: 'tikz',
      documentId: 'doc-1',
      epoch: 'epoch-1',
      sourceId: 'doc-1:tikz',
      revision: 2,
      sourceHash: '1111111111111111',
      attestation: 'server-attested',
    },
  }).checkpoint;

  it('binds a durable context receipt to one server-attested GeometryDoc basis', () => {
    const checkpoint = createTikzAgentRunCheckpoint({
      runId: 'run-1',
      contextCheckpoint,
      pluginSetDigest: 'plugins-v1',
      createdAt: 1_000,
    });
    expect(checkpoint).not.toBeNull();
    expect(isTikzAgentRunCheckpoint(checkpoint)).toBe(true);
    expect(checkpoint?.basis.revision).toBe(2);
    expect(sameTikzAgentRunBasis(
      checkpoint!.basis,
      { ...checkpoint!.basis, pluginSetDigest: 'other-plugins' },
    )).toBe(false);
  });

  it('records only an exact one-revision proposal successor', () => {
    const transition = createTikzAgentRunBasisTransition({
      runId: 'run-1',
      transactionId: 'tx-1',
      documentId: 'doc-1',
      epoch: 'epoch-1',
      sourceId: 'doc-1:tikz',
      beforeRevision: 2,
      beforeSourceHash: '1111111111111111',
      afterRevision: 3,
      afterSourceHash: '2222222222222222',
      pluginSetDigest: 'plugins-v1',
      createdAt: 1_001,
    });
    expect(isTikzAgentRunBasisTransition(transition)).toBe(true);
    expect(createTikzAgentRunBasisTransition({
      runId: 'run-1',
      transactionId: 'tx-2',
      documentId: 'doc-1',
      epoch: 'epoch-1',
      sourceId: 'doc-1:tikz',
      beforeRevision: 2,
      beforeSourceHash: '1111111111111111',
      afterRevision: 4,
      afterSourceHash: '3333333333333333',
    })).toBeNull();
  });
});
