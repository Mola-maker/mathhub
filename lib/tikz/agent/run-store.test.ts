import { afterEach, describe, expect, it, vi } from 'vitest';
import { tikzAgentEvent } from './protocol';
import { compactGeometryConversationContext } from '@/lib/geometry/agent/conversation-context';
import { createTikzAgentRunCheckpoint } from './run-checkpoint';
import {
  createMemoryTikzAgentRunStore,
  TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
  type TikzAgentProposalCheckpoint,
  getTikzAgentRunStore,
  resetMemoryTikzAgentRunStore,
} from './run-store';

const checkpoint = (createdAt = 1_000): TikzAgentProposalCheckpoint => ({
  schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
  runId: 'tikz-run-1',
  transactionId: 'transaction-1',
  transactionAttestation: {
    schemaVersion: 'ai-transaction-attestation/v1',
    transactionId: 'transaction-1',
    algorithm: 'fnv1a64-utf8',
    digest: '0123456789abcdef',
  },
  proposal: {
    schemaVersion: 'ai-patch-proposal/v1',
    proposalId: 'proposal-1',
  },
  documentId: 'document-1',
  epoch: 'epoch-1',
  sourceId: 'document-1:tikz',
  beforeRevision: 3,
  beforeSourceHash: '1111111111111111',
  afterRevision: 4,
  afterSourceHash: '2222222222222222',
  createdAt,
});

const runCheckpoint = () => createTikzAgentRunCheckpoint({
  runId: 'tikz-run-1',
  contextCheckpoint: compactGeometryConversationContext([
    { role: 'user', content: 'construct the circle' },
  ], {
    lane: 'tikz',
    basis: {
      lane: 'tikz',
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceId: 'document-1:tikz',
      revision: 3,
      sourceHash: '1111111111111111',
      attestation: 'server-attested',
    },
  }).checkpoint,
  createdAt: 900,
})!;

describe('TikzAgentRunStore', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetMemoryTikzAgentRunStore();
  });

  it('uses the bounded memory store without Redis outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AGENT_RUN_REDIS_URL', '');
    vi.stubEnv('RATE_LIMIT_REDIS_URL', '');

    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    expect(await resolved.store.checkpointProposal(checkpoint(Date.now())))
      .toEqual({ ok: true, stored: true });
  });

  it('fails closed without a shared Redis RunStore in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AGENT_RUN_REDIS_URL', '');
    vi.stubEnv('RATE_LIMIT_REDIS_URL', '');

    await expect(getTikzAgentRunStore()).resolves.toEqual({
      ok: false,
      message: 'shared Agent RunStore is not configured',
    });
  });

  it('accepts SHA-256 transaction attestations produced by the server lane', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    const shaCheckpoint: TikzAgentProposalCheckpoint = {
      ...checkpoint(),
      transactionId: '修改九点圆样式',
      transactionAttestation: {
        schemaVersion: 'ai-transaction-attestation/v1',
        transactionId: '修改九点圆样式',
        algorithm: 'sha256-utf8',
        digest: 'a'.repeat(64),
      },
    };
    const ready = tikzAgentEvent('tikz-run-1', 1, {
      type: 'proposal.ready',
      title: 'ready',
    });

    expect(await store.publishProposal(shaCheckpoint, ready)).toEqual({
      ok: true,
      stored: true,
    });
    expect(await store.readProposal('tikz-run-1')).toMatchObject({
      ok: true,
      value: {
        transactionId: '修改九点圆样式',
        transactionAttestation: {
          algorithm: 'sha256-utf8',
          digest: 'a'.repeat(64),
        },
      },
    });
  });

  it('rejects event identities that are not derived from run and sequence', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    expect(await store.appendEvent({
      ...tikzAgentEvent('tikz-run-1', 0, {
        type: 'run.started',
        title: 'started',
      }),
      eventId: 'opaque-event-id',
    })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('keeps proposal identity and accepts only one terminal event', async () => {
    let now = 1_000;
    const store = createMemoryTikzAgentRunStore(() => now);
    const started = tikzAgentEvent('tikz-run-1', 0, {
      type: 'run.started',
      title: 'started',
    });
    const terminal = tikzAgentEvent('tikz-run-1', 2, {
      type: 'run.completed',
      title: 'done',
      outcome: 'mutation',
    });

    expect(await store.appendEvent(started)).toEqual({ ok: true, stored: true });
    expect(await store.checkpointProposal(checkpoint())).toEqual({ ok: true, stored: true });
    expect(await store.complete(terminal)).toEqual({ ok: true, stored: true });
    expect(await store.complete(tikzAgentEvent('tikz-run-1', 3, {
      type: 'run.failed',
      title: 'late',
      outcome: 'failed',
    }))).toEqual({ ok: true, stored: false });
    expect(await store.appendEvent(tikzAgentEvent('tikz-run-1', 4, {
      type: 'context.read',
      title: 'late',
    }))).toEqual({ ok: true, stored: false });

    const snapshot = await store.read('tikz-run-1');
    expect(snapshot.ok && snapshot.value?.events.map((event) => event.type)).toEqual([
      'run.started',
      'run.completed',
    ]);
    expect(snapshot.ok && snapshot.value?.terminal?.eventId).toBe(terminal.eventId);
    expect(snapshot.ok && snapshot.value?.proposal).toBeUndefined();

    now += 31 * 60_000;
    expect(await store.read('tikz-run-1')).toEqual({ ok: true, value: null });
  });

  it('persists one immutable context basis and the proposal successor basis', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    expect(await store.checkpointRun(runCheckpoint())).toEqual({ ok: true, stored: true });
    expect(await store.checkpointRun(runCheckpoint())).toEqual({ ok: true, stored: true });
    expect(await store.publishProposal(checkpoint(), tikzAgentEvent('tikz-run-1', 1, {
      type: 'proposal.ready',
      title: 'ready',
    }))).toEqual({ ok: true, stored: true });

    const snapshot = await store.read('tikz-run-1');
    expect(snapshot.ok && snapshot.value?.runCheckpoint?.basis).toMatchObject({
      revision: 3,
      sourceHash: '1111111111111111',
    });
    expect(snapshot.ok && snapshot.value?.basisTransition).toMatchObject({
      transactionId: 'transaction-1',
      before: { revision: 3, sourceHash: '1111111111111111' },
      after: { revision: 4, sourceHash: '2222222222222222' },
    });
    expect(snapshot.ok && snapshot.value?.earliestSequence).toBe(1);
  });

  it('will not attach an initial basis after proposal state already exists', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    expect(await store.checkpointProposal(checkpoint())).toEqual({ ok: true, stored: true });
    expect(await store.checkpointRun(runCheckpoint())).toEqual({ ok: true, stored: false });
    const snapshot = await store.read('tikz-run-1');
    expect(snapshot.ok && snapshot.value?.runCheckpoint).toBeUndefined();
  });

  it('rejects a second, different proposal checkpoint for one run', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    expect(await store.checkpointProposal(checkpoint())).toEqual({ ok: true, stored: true });
    expect(await store.checkpointProposal({
      ...checkpoint(),
      transactionId: 'transaction-2',
      transactionAttestation: {
        ...checkpoint().transactionAttestation,
        transactionId: 'transaction-2',
      },
    })).toEqual({ ok: true, stored: false });
    const proposal = await store.readProposal('tikz-run-1');
    expect(proposal.ok && proposal.value?.transactionId).toBe('transaction-1');
  });

  it('publishes a proposal checkpoint and ready event as one idempotent step', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    const ready = tikzAgentEvent('tikz-run-1', 1, {
      type: 'proposal.ready',
      title: 'ready',
    });
    expect(await store.appendEvent(tikzAgentEvent('tikz-run-1', 0, {
      type: 'run.started',
      title: 'started',
    }))).toEqual({ ok: true, stored: true });
    expect(await store.publishProposal(checkpoint(), ready)).toEqual({
      ok: true,
      stored: true,
    });
    expect(await store.publishProposal(checkpoint(), ready)).toEqual({
      ok: true,
      stored: true,
    });

    const replay = await store.read('tikz-run-1');
    expect(replay.ok && replay.value?.events.map((event) => event.type)).toEqual([
      'run.started',
      'proposal.ready',
    ]);
    expect(replay.ok && replay.value?.proposal?.transactionId).toBe('transaction-1');
  });

  it('does not publish a late proposal after the run is terminal', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    expect(await store.complete(tikzAgentEvent('tikz-run-1', 0, {
      type: 'run.completed',
      title: 'done',
      outcome: 'answer',
    }))).toEqual({ ok: true, stored: true });
    expect(await store.publishProposal(checkpoint(), tikzAgentEvent('tikz-run-1', 1, {
      type: 'proposal.ready',
      title: 'late proposal',
    }))).toEqual({ ok: true, stored: false });
    expect(await store.readProposal('tikz-run-1')).toEqual({ ok: true, value: null });
  });

  it('claims a pending proposal exactly once and hides it from replay', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    const pending = checkpoint();
    expect(await store.checkpointProposal(pending)).toEqual({ ok: true, stored: true });
    expect(await store.claimProposal(pending)).toEqual({ ok: true, stored: true });
    expect(await store.claimProposal(pending)).toEqual({ ok: true, stored: false });
    expect(await store.readProposal('tikz-run-1')).toEqual({ ok: true, value: null });
    const replay = await store.read('tikz-run-1');
    expect(replay.ok && replay.value?.proposal).toBeUndefined();
    expect(replay.ok && replay.value?.verificationPending).toBe(true);
  });

  it('supports monotonic replay cursors without returning earlier events', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    for (let sequence = 0; sequence < 5; sequence += 1) {
      await store.appendEvent(tikzAgentEvent('tikz-run-1', sequence, {
        type: sequence === 0 ? 'run.started' : 'context.read',
        title: `event ${sequence}`,
      }));
    }
    const replay = await store.read('tikz-run-1', 2);
    expect(replay.ok && replay.value?.events.map((event) => event.sequence)).toEqual([3, 4]);
  });

  it('atomically appends the final verification observation and terminal event', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    await store.appendEvent(tikzAgentEvent('tikz-run-1', 0, {
      type: 'run.started',
      title: 'started',
    }));
    const verified = tikzAgentEvent('tikz-run-1', 1, {
      type: 'commit.verified',
      title: 'verified',
      outcome: 'mutation',
    });
    const terminal = tikzAgentEvent('tikz-run-1', 2, {
      type: 'run.completed',
      title: 'done',
      outcome: 'mutation',
    });

    expect(await store.completeWithEvent(verified, terminal)).toEqual({
      ok: true,
      stored: true,
    });
    expect(await store.completeWithEvent(verified, terminal)).toEqual({
      ok: true,
      stored: false,
    });
    const replay = await store.read('tikz-run-1');
    expect(replay.ok && replay.value?.events.map((event) => event.type)).toEqual([
      'run.started',
      'commit.verified',
      'run.completed',
    ]);
    expect(replay.ok && replay.value?.terminal?.eventId).toBe(terminal.eventId);
  });

  it('atomically consumes a rejected proposal and prevents later verification', async () => {
    const store = createMemoryTikzAgentRunStore(() => 1_000);
    const pending = checkpoint();
    await store.publishProposal(pending, tikzAgentEvent('tikz-run-1', 1, {
      type: 'proposal.ready',
      title: 'ready',
    }));
    const rejected = tikzAgentEvent('tikz-run-1', 3_000_000, {
      type: 'commit.rejected',
      title: 'stale basis',
      outcome: 'unapplied-candidate',
    });
    const terminal = tikzAgentEvent('tikz-run-1', 3_000_001, {
      type: 'run.completed',
      title: 'not applied',
      outcome: 'unapplied-candidate',
    });

    expect(await store.resolveProposal(pending, rejected, terminal)).toEqual({
      ok: true,
      stored: true,
    });
    expect(await store.resolveProposal(pending, rejected, terminal)).toEqual({
      ok: true,
      stored: false,
    });
    expect(await store.claimProposal(pending)).toEqual({ ok: true, stored: false });
    expect(await store.readProposal('tikz-run-1')).toEqual({ ok: true, value: null });
    const replay = await store.read('tikz-run-1');
    expect(replay.ok && replay.value?.events.map((event) => event.type)).toEqual([
      'proposal.ready',
      'commit.rejected',
      'run.completed',
    ]);
  });
});
