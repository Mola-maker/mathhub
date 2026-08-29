import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/client-ip', () => ({
  clientIp: vi.fn(async () => '127.0.0.1'),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 59, resetMs: 60_000 })),
}));

import { tikzAgentEvent } from '@/lib/tikz/agent/protocol';
import { compactGeometryConversationContext } from '@/lib/geometry/agent/conversation-context';
import { createTikzAgentRunCheckpoint, type TikzAgentReplayBasis } from '@/lib/tikz/agent/run-checkpoint';
import { createTikzAgentRunResumeToken } from '@/lib/tikz/agent/run-resume-token';
import {
  getTikzAgentRunStore,
  resetMemoryTikzAgentRunStore,
  TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
} from '@/lib/tikz/agent/run-store';
import { GET, POST } from './route';

const replayBasis: TikzAgentReplayBasis = {
  documentId: 'document-1',
  epoch: 'epoch-1',
  sourceId: 'document-1:tikz',
  revision: 0,
  sourceHash: '1111111111111111',
};

function runCheckpoint(runId: string) {
  return createTikzAgentRunCheckpoint({
    runId,
    contextCheckpoint: compactGeometryConversationContext([
      { role: 'user', content: 'explain the diagram' },
    ], {
      lane: 'tikz',
      basis: {
        lane: 'tikz',
        ...replayBasis,
        attestation: 'server-attested',
      },
    }).checkpoint,
    createdAt: 1_000,
  })!;
}

function replayUrl(runId: string, afterSequence?: number): string {
  const params = new URLSearchParams({
    ...(afterSequence !== undefined ? { afterSequence: String(afterSequence) } : {}),
    documentId: replayBasis.documentId,
    epoch: replayBasis.epoch,
    revision: String(replayBasis.revision),
    sourceId: replayBasis.sourceId,
    sourceHash: replayBasis.sourceHash,
  });
  return `http://localhost/api/tikz/runs/${runId}?${params.toString()}`;
}

describe('GET /api/tikz/runs/[runId]', () => {
  beforeEach(() => resetMemoryTikzAgentRunStore());

  it('replays bounded events and a pending typed proposal after a cursor', async () => {
    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    await resolved.store.checkpointRun(runCheckpoint('tikz-run-replay-1'));
    await resolved.store.appendEvent(tikzAgentEvent('tikz-run-replay-1', 0, {
      type: 'run.started',
      title: 'started',
    }));
    await resolved.store.appendEvent(tikzAgentEvent('tikz-run-replay-1', 1, {
      type: 'context.read',
      title: 'read',
    }));
    await resolved.store.checkpointProposal({
      schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
      runId: 'tikz-run-replay-1',
      transactionId: 'transaction-1',
      transactionAttestation: {
        schemaVersion: 'ai-transaction-attestation/v1',
        transactionId: 'transaction-1',
        algorithm: 'fnv1a64-utf8',
        digest: '0123456789abcdef',
      },
      proposal: { schemaVersion: 'ai-patch-proposal/v1', proposalId: 'proposal-1' },
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceId: 'document-1:tikz',
      beforeRevision: 0,
      beforeSourceHash: '1111111111111111',
      afterRevision: 1,
      afterSourceHash: '2222222222222222',
      createdAt: Date.now(),
    });

    const response = await GET(
      new NextRequest(replayUrl('tikz-run-replay-1', 0), {
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken('tikz-run-replay-1')}`,
        },
      }),
      { params: Promise.resolve({ runId: 'tikz-run-replay-1' }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.schemaVersion).toBe('tikz-agent-run-replay/v2');
    expect(body.basis).toEqual(replayBasis);
    expect(body.events).toEqual([expect.objectContaining({ sequence: 1 })]);
    expect(body.proposal).toEqual(expect.objectContaining({ transactionId: 'transaction-1' }));
    expect(body.proposal).not.toHaveProperty('proposal');
    expect(body.proposal).not.toHaveProperty('transactionAttestation');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns 404 for an expired or unknown run', async () => {
    const response = await GET(
      new NextRequest(replayUrl('tikz-run-missing'), {
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken('tikz-run-missing')}`,
        },
      }),
      { params: Promise.resolve({ runId: 'tikz-run-missing' }) },
    );
    expect(response.status).toBe(404);
  });

  it('fails closed when the caller canvas basis no longer matches the run', async () => {
    const runId = 'tikz-run-stale-basis';
    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    await resolved.store.checkpointRun(runCheckpoint(runId));
    await resolved.store.appendEvent(tikzAgentEvent(runId, 0, {
      type: 'run.started',
      title: 'started',
    }));

    const staleUrl = new URL(replayUrl(runId));
    staleUrl.searchParams.set('sourceHash', '9999999999999999');
    const response = await GET(
      new NextRequest(staleUrl, {
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken(runId)}`,
        },
      }),
      { params: Promise.resolve({ runId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'STALE_GEOMETRY_BASIS',
    });
  });

  it('fails closed when the requested cursor predates the retained event window', async () => {
    const runId = 'tikz-run-expired-window';
    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    await resolved.store.checkpointRun(runCheckpoint(runId));
    for (let sequence = 0; sequence < 70; sequence += 1) {
      await resolved.store.appendEvent(tikzAgentEvent(runId, sequence, {
        type: 'context.read',
        title: `event ${sequence}`,
      }));
    }

    const response = await GET(
      new NextRequest(replayUrl(runId, -1), {
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken(runId)}`,
        },
      }),
      { params: Promise.resolve({ runId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'REPLAY_WINDOW_EXPIRED',
    });
  });

  it('does not expose a pending proposal without its separate recovery capability', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/tikz/runs/tikz-run-replay-1'),
      { params: Promise.resolve({ runId: 'tikz-run-replay-1' }) },
    );
    expect(response.status).toBe(404);
  });

  it('atomically records a browser rejection and consumes the pending proposal', async () => {
    const runId = 'tikz-run-reject-1';
    const transactionId = 'transaction-reject-1';
    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    const checkpoint = {
      schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
      runId,
      transactionId,
      transactionAttestation: {
        schemaVersion: 'ai-transaction-attestation/v1' as const,
        transactionId,
        algorithm: 'fnv1a64-utf8' as const,
        digest: '0123456789abcdef',
      },
      proposal: { schemaVersion: 'ai-patch-proposal/v1', proposalId: 'proposal-reject-1' },
      documentId: 'document-reject-1',
      epoch: 'epoch-1',
      sourceId: 'document-reject-1:tikz',
      beforeRevision: 0,
      beforeSourceHash: '1111111111111111',
      afterRevision: 1,
      afterSourceHash: '2222222222222222',
      createdAt: Date.now(),
    } as const;
    await resolved.store.publishProposal(checkpoint, tikzAgentEvent(runId, 1, {
      type: 'proposal.ready',
      title: 'ready',
    }));

    const response = await POST(
      new NextRequest(`http://localhost/api/tikz/runs/${runId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken(runId)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: 'tikz-agent-proposal-disposition/v1',
          transactionId,
          outcome: 'rejected',
          reason: 'stale GeometryDoc basis',
        }),
      }),
      { params: Promise.resolve({ runId }) },
    );
    expect(response.status).toBe(200);
    const result = await response.json() as { events: Array<{ type: string }> };
    expect(result.events.map((event) => event.type)).toEqual([
      'commit.rejected',
      'run.completed',
    ]);
    expect(await resolved.store.readProposal(runId)).toEqual({ ok: true, value: null });
    expect(await resolved.store.claimProposal(checkpoint)).toEqual({ ok: true, stored: false });
    const replay = await resolved.store.read(runId);
    expect(replay.ok && replay.value?.terminal?.type).toBe('run.completed');
  });

  it('records a committed receipt without falsely claiming GeometryDoc verification', async () => {
    const runId = 'tikz-run-commit-1';
    const transactionId = 'transaction-commit-1';
    const resolved = await getTikzAgentRunStore();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    const transactionAttestation = {
      schemaVersion: 'ai-transaction-attestation/v1' as const,
      transactionId,
      algorithm: 'fnv1a64-utf8' as const,
      digest: '0123456789abcdef',
    };
    const checkpoint = {
      schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
      runId,
      transactionId,
      transactionAttestation,
      proposal: { schemaVersion: 'ai-patch-proposal/v1', proposalId: 'proposal-commit-1' },
      documentId: 'document-commit-1',
      epoch: 'epoch-1',
      sourceId: 'document-commit-1:tikz',
      beforeRevision: 8,
      beforeSourceHash: '1111111111111111',
      afterRevision: 9,
      afterSourceHash: '2222222222222222',
      createdAt: Date.now(),
    } as const;
    await resolved.store.publishProposal(checkpoint, tikzAgentEvent(runId, 1, {
      type: 'proposal.ready',
      title: 'ready',
    }));

    const response = await POST(
      new NextRequest(`http://localhost/api/tikz/runs/${runId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${createTikzAgentRunResumeToken(runId)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: 'tikz-agent-proposal-disposition/v1',
          transactionId,
          outcome: 'committed-unverified',
          afterRevision: 9,
          afterSourceHash: '2222222222222222',
          transactionAttestation,
          reason: 'GeometryDoc projection is still refreshing',
        }),
      }),
      { params: Promise.resolve({ runId }) },
    );
    expect(response.status).toBe(200);
    const result = await response.json() as { events: Array<{ type: string; title: string }> };
    expect(result.events.map((event) => event.type)).toEqual([
      'commit.completed',
      'run.completed',
    ]);
    expect(result.events[1]?.title).toContain('几何投影尚待刷新');
    const replay = await resolved.store.read(runId);
    expect(replay.ok && replay.value?.proposal).toBeUndefined();
    expect(replay.ok && replay.value?.terminal?.outcome).toBe('mutation');
  });
});
