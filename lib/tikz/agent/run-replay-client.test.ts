import { describe, expect, it, vi } from 'vitest';
import { tikzAgentEvent } from './protocol';
import {
  acknowledgeTikzAgentProposalCommit,
  fetchTikzAgentRunReplay,
  parseTikzAgentRunReplay,
  rejectTikzAgentProposal,
  TikzAgentReplayError,
} from './run-replay-client';

const runId = 'tikz-run-recovery-1';

function replayPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'tikz-agent-run-replay/v1',
    runId,
    events: [
      tikzAgentEvent(runId, 0, { type: 'run.started', title: 'started' }),
      tikzAgentEvent(runId, 1, { type: 'proposal.ready', title: 'proposal' }),
    ],
    proposal: {
      schemaVersion: 'tikz-agent-proposal-checkpoint/v1',
      runId,
      transactionId: 'transaction-1',
      transactionAttestation: {
        schemaVersion: 'ai-transaction-attestation/v1',
        transactionId: 'transaction-1',
        algorithm: 'fnv1a64-utf8',
        digest: '0123456789abcdef',
      },
      // The client must never expose or attempt to compile this body during
      // recovery.  The parser returns only checkpoint identity.
      proposal: { schemaVersion: 'ai-patch-proposal/v1', secret: 'do-not-apply' },
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceId: 'document-1:tikz',
      beforeRevision: 0,
      beforeSourceHash: '1111111111111111',
      afterRevision: 1,
      afterSourceHash: '2222222222222222',
      createdAt: Date.now(),
    },
    ...overrides,
  };
}

describe('TikZ Agent replay client', () => {
  it('accepts only strictly increasing events for the requested run', () => {
    const result = parseTikzAgentRunReplay(replayPayload(), runId, -1);
    expect(result.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(result.lastSequence).toBe(1);
    expect(result.verificationPending).toBe(false);
    expect(result.proposal).toMatchObject({
      runId,
      transactionId: 'transaction-1',
      beforeRevision: 0,
      afterRevision: 1,
    });
    expect(result.proposal).not.toHaveProperty('proposal');
  });

  it('rejects cross-run, duplicate, and out-of-order payloads', () => {
    expect(() => parseTikzAgentRunReplay(
      replayPayload({ runId: 'other-run' }),
      runId,
    )).toThrow(TikzAgentReplayError);
    const duplicate = replayPayload({
      events: [
        tikzAgentEvent(runId, 0, { type: 'run.started', title: 'started' }),
        tikzAgentEvent(runId, 0, { type: 'context.read', title: 'duplicate' }),
      ],
    });
    expect(() => parseTikzAgentRunReplay(duplicate, runId)).toThrow(/ordering/i);
    const outOfOrder = replayPayload({
      events: [
        tikzAgentEvent(runId, 1, { type: 'proposal.ready', title: 'proposal' }),
        tikzAgentEvent(runId, 0, { type: 'run.started', title: 'started' }),
      ],
    });
    expect(() => parseTikzAgentRunReplay(outOfOrder, runId)).toThrow(TikzAgentReplayError);
  });

  it('preserves an explicit verification-pending state for bounded polling', () => {
    const result = parseTikzAgentRunReplay(replayPayload({
      events: [],
      proposal: null,
      verificationPending: true,
    }), runId, 1);
    expect(result.verificationPending).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.terminal).toBeUndefined();
  });

  it('sends the resume capability only as a bearer header and bounds the response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/api/tikz/runs/tikz-run-recovery-1?afterSequence=1');
      expect(String(input)).not.toContain('resume-token-secret');
      expect((init?.headers as Record<string, string>).Authorization)
        .toBe('Bearer resume-token-secret');
      return new Response(JSON.stringify({
        ...replayPayload(),
        events: [tikzAgentEvent(runId, 2, { type: 'run.completed', title: 'done' })],
        proposal: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await fetchTikzAgentRunReplay({
      runId,
      resumeToken: 'resume-token-secret',
      afterSequence: 1,
      fetchImpl,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('run.completed');
  });

  it('fails closed on an oversized response before parsing it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(256 * 1024 + 1) },
    }));
    await expect(fetchTikzAgentRunReplay({
      runId,
      resumeToken: 'resume-token-secret',
      afterSequence: -1,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'too-large' });
  });

  it('resolves a rejected proposal with the capability only in the bearer header', async () => {
    const rejected = tikzAgentEvent(runId, 3_000_000, {
      type: 'commit.rejected',
      title: 'rejected',
      outcome: 'unapplied-candidate',
    });
    const terminal = tikzAgentEvent(runId, 3_000_001, {
      type: 'run.completed',
      title: 'done',
      outcome: 'unapplied-candidate',
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/api/tikz/runs/tikz-run-recovery-1');
      expect(String(input)).not.toContain('resume-token-secret');
      expect((init?.headers as Record<string, string>).Authorization)
        .toBe('Bearer resume-token-secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        schemaVersion: 'tikz-agent-proposal-disposition/v1',
        transactionId: 'transaction-1',
        outcome: 'rejected',
      });
      return new Response(JSON.stringify({
        schemaVersion: 'tikz-agent-proposal-disposition-result/v1',
        runId,
        events: [rejected, terminal],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await rejectTikzAgentProposal({
      runId,
      resumeToken: 'resume-token-secret',
      transactionId: 'transaction-1',
      reason: 'stale basis',
      fetchImpl,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'commit.rejected',
      'run.completed',
    ]);
  });

  it('acknowledges a committed proposal without claiming semantic verification', async () => {
    const completed = tikzAgentEvent(runId, 3_000_000, {
      type: 'commit.completed',
      title: 'committed',
      outcome: 'mutation',
    });
    const terminal = tikzAgentEvent(runId, 3_000_001, {
      type: 'run.completed',
      title: 'projection pending',
      outcome: 'mutation',
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        outcome: 'committed-unverified',
        afterRevision: 1,
        afterSourceHash: '2222222222222222',
      });
      return new Response(JSON.stringify({
        schemaVersion: 'tikz-agent-proposal-disposition-result/v1',
        runId,
        events: [completed, terminal],
      }), { status: 200 });
    });
    const result = await acknowledgeTikzAgentProposalCommit({
      runId,
      resumeToken: 'resume-token-secret',
      transactionId: 'transaction-1',
      afterRevision: 1,
      afterSourceHash: '2222222222222222',
      transactionAttestation: {
        schemaVersion: 'ai-transaction-attestation/v1',
        transactionId: 'transaction-1',
        algorithm: 'fnv1a64-utf8',
        digest: '0123456789abcdef',
      },
      fetchImpl,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'commit.completed',
      'run.completed',
    ]);
  });
});
