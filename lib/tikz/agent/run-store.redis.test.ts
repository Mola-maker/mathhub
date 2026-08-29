import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tikzAgentEvent } from './protocol';
import { compactGeometryConversationContext } from '@/lib/geometry/agent/conversation-context';
import { createTikzAgentRunCheckpoint } from './run-checkpoint';
import {
  createRedisTikzAgentRunStore,
  TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
  type TikzAgentProposalCheckpoint,
  type TikzAgentRunStore,
} from './run-store';

/**
 * This file intentionally has no in-memory fallback. Set TEST_REDIS_URL to
 * run the contract against a real Redis server; without it Vitest reports
 * the contract cases as skipped instead of giving a false green integration
 * result.
 */
const testRedisUrl = process.env.TEST_REDIS_URL?.trim();
const redisTest = testRedisUrl ? it : it.skip;

const testPrefix = `math-geohub:test-run-store:${process.pid}:${Date.now()}:${Math.random()
  .toString(36)
  .slice(2, 10)}`;
let client: RedisClientType | undefined;
let store: TikzAgentRunStore | undefined;
let runCounter = 0;

function nextRunId(label: string): string {
  runCounter += 1;
  return `redis-contract-${label}-${process.pid}-${Date.now()}-${runCounter}`;
}

function getStore(): TikzAgentRunStore {
  if (!store) throw new Error('Redis contract store was not initialized');
  return store;
}

function proposalCheckpoint(
  runId: string,
  proposalId: string,
): TikzAgentProposalCheckpoint {
  const transactionId = `${runId}-transaction-${proposalId}`;
  return {
    schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
    runId,
    transactionId,
    transactionAttestation: {
      schemaVersion: 'ai-transaction-attestation/v1',
      transactionId,
      algorithm: 'fnv1a64-utf8',
      digest: '0123456789abcdef',
    },
    proposal: {
      schemaVersion: 'ai-patch-proposal/v1',
      proposalId,
    },
    documentId: `${runId}-document`,
    epoch: 'epoch-1',
    sourceId: `${runId}-document:tikz`,
    beforeRevision: 3,
    beforeSourceHash: '1111111111111111',
    afterRevision: 4,
    afterSourceHash: '2222222222222222',
    createdAt: Date.now(),
  };
}

function readyEvent(runId: string) {
  return tikzAgentEvent(runId, 1, {
    type: 'proposal.ready' as const,
    title: 'proposal ready',
  });
}

function durableRunCheckpoint(runId: string) {
  const documentId = `${runId}-document`;
  return createTikzAgentRunCheckpoint({
    runId,
    contextCheckpoint: compactGeometryConversationContext([
      { role: 'user', content: 'construct the geometry' },
    ], {
      lane: 'tikz',
      basis: {
        lane: 'tikz',
        documentId,
        epoch: 'epoch-1',
        sourceId: `${documentId}:tikz`,
        revision: 3,
        sourceHash: '1111111111111111',
        attestation: 'server-attested',
      },
    }).checkpoint,
    createdAt: 1_000,
  })!;
}

describe('TikzAgentRunStore Redis integration contract', () => {
  beforeAll(async () => {
    if (!testRedisUrl) return;
    client = createClient({
      url: testRedisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_500,
        reconnectStrategy: false,
      },
    }) as RedisClientType;
    client.on('error', () => undefined);
    await client.connect();
    store = createRedisTikzAgentRunStore(client, testPrefix);
  });

  afterAll(async () => {
    if (!client) return;
    if (client.isReady) {
      const keys: string[] = [];
      for await (const batch of client.scanIterator({
        MATCH: `${testPrefix}:*`,
        COUNT: 100,
      })) {
        for (const key of batch) keys.push(key);
      }
      for (const key of keys) await client.del(key);
    }
    if (client.isOpen) await client.quit();
  });

  redisTest(
    'matches the memory lifecycle contract: publish, replay, claim, terminal, and suppression',
    async () => {
      const runId = nextRunId('lifecycle');
      const runStore = getStore();
      const started = tikzAgentEvent(runId, 0, {
        type: 'run.started',
        title: 'started',
      });
      const checkpoint = proposalCheckpoint(runId, 'proposal-lifecycle');
      const ready = readyEvent(runId);
      const terminal = tikzAgentEvent(runId, 2, {
        type: 'run.completed',
        title: 'verified',
        outcome: 'mutation',
      });

      expect(await runStore.checkpointRun(durableRunCheckpoint(runId))).toEqual({
        ok: true,
        stored: true,
      });
      expect(await runStore.appendEvent(started)).toEqual({ ok: true, stored: true });
      expect(await runStore.publishProposal(checkpoint, ready)).toEqual({
        ok: true,
        stored: true,
      });
      expect(await runStore.publishProposal(checkpoint, ready)).toEqual({
        ok: true,
        stored: true,
      });

      const replayBeforeClaim = await runStore.read(runId);
      expect(replayBeforeClaim.ok).toBe(true);
      if (replayBeforeClaim.ok) {
        expect(replayBeforeClaim.value?.events.map((event) => event.type)).toEqual([
          'run.started',
          'proposal.ready',
        ]);
        expect(replayBeforeClaim.value?.proposal?.transactionId).toBe(
          checkpoint.transactionId,
        );
        expect(replayBeforeClaim.value?.runCheckpoint?.basis.revision).toBe(3);
        expect(replayBeforeClaim.value?.basisTransition?.after.revision).toBe(4);
        expect(replayBeforeClaim.value?.earliestSequence).toBe(0);
      }

      expect(await runStore.claimProposal(checkpoint)).toEqual({ ok: true, stored: true });
      expect(await runStore.claimProposal(checkpoint)).toEqual({ ok: true, stored: false });
      expect(await runStore.readProposal(runId)).toEqual({ ok: true, value: null });
      const replayWhileVerifying = await runStore.read(runId);
      expect(replayWhileVerifying.ok && replayWhileVerifying.value?.verificationPending)
        .toBe(true);
      expect(await runStore.complete(terminal)).toEqual({ ok: true, stored: true });
      expect(await runStore.appendEvent(tikzAgentEvent(runId, 3, {
        type: 'context.read',
        title: 'late event',
      }))).toEqual({ ok: true, stored: false });

      const replayAfterTerminal = await runStore.read(runId);
      expect(replayAfterTerminal.ok).toBe(true);
      if (replayAfterTerminal.ok) {
        expect(replayAfterTerminal.value?.terminal?.eventId).toBe(terminal.eventId);
        expect(replayAfterTerminal.value?.proposal).toBeUndefined();
      }
    },
  );

  redisTest(
    'keeps proposal publication and event sequence atomic under competing writers',
    async () => {
      const runId = nextRunId('race');
      const runStore = getStore();
      expect(await runStore.appendEvent(tikzAgentEvent(runId, 0, {
        type: 'run.started',
        title: 'started',
      }))).toEqual({ ok: true, stored: true });

      const contenders = Array.from({ length: 24 }, (_, index) => {
        const proposal = proposalCheckpoint(runId, `proposal-race-${index}`);
        return runStore.publishProposal(
          proposal,
          readyEvent(runId),
        );
      });
      const results = await Promise.all(contenders);
      const successful = results.filter((result) => result.ok && result.stored);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(successful).toHaveLength(1);

      const replay = await runStore.read(runId);
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.value?.events.filter((event) => event.type === 'proposal.ready'))
          .toHaveLength(1);
        expect(replay.value?.proposal?.proposal).toMatchObject({
          schemaVersion: 'ai-patch-proposal/v1',
        });
      }

      const appendRunId = nextRunId('append-race');
      const appendResults = await Promise.all(
        Array.from({ length: 24 }, (_, index) => runStore.appendEvent(
          tikzAgentEvent(appendRunId, 0, {
            type: 'run.started',
            title: `competing writer ${index}`,
          }),
        )),
      );
      expect(appendResults.filter((result) => result.ok && result.stored)).toHaveLength(1);
      const appendReplay = await runStore.read(appendRunId);
      expect(appendReplay.ok && appendReplay.value?.events).toHaveLength(1);
    },
  );

  redisTest(
    'atomically records the final observation together with the terminal event',
    async () => {
      const runId = nextRunId('final-batch');
      const runStore = getStore();
      const started = tikzAgentEvent(runId, 0, {
        type: 'run.started',
        title: 'started',
      });
      const verified = tikzAgentEvent(runId, 1, {
        type: 'commit.verified',
        title: 'commit verified',
      });
      const terminal = tikzAgentEvent(runId, 2, {
        type: 'run.completed',
        title: 'completed',
        outcome: 'mutation',
      });

      expect(await runStore.appendEvent(started)).toEqual({ ok: true, stored: true });
      expect(await runStore.completeWithEvent(verified, terminal)).toEqual({
        ok: true,
        stored: true,
      });
      expect(await runStore.completeWithEvent(verified, terminal)).toEqual({
        ok: true,
        stored: false,
      });

      const replay = await runStore.read(runId);
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.value?.events.map((event) => event.type)).toEqual([
          'run.started',
          'commit.verified',
          'run.completed',
        ]);
        expect(replay.value?.terminal?.eventId).toBe(terminal.eventId);
      }
    },
  );

  redisTest(
    'atomically resolves one pending proposal disposition under competing writers',
    async () => {
      const runId = nextRunId('disposition-race');
      const runStore = getStore();
      const pending = proposalCheckpoint(runId, 'proposal-disposition');
      await runStore.publishProposal(pending, readyEvent(runId));
      const contenders = Array.from({ length: 16 }, (_, index) => {
        const disposition = tikzAgentEvent(runId, 3_000_000, {
          type: index % 2 === 0 ? 'commit.rejected' : 'commit.completed',
          title: `disposition ${index}`,
          outcome: index % 2 === 0 ? 'unapplied-candidate' : 'mutation',
        });
        const terminal = tikzAgentEvent(runId, 3_000_001, {
          type: 'run.completed',
          title: `terminal ${index}`,
          outcome: index % 2 === 0 ? 'unapplied-candidate' : 'mutation',
        });
        return runStore.resolveProposal(pending, disposition, terminal);
      });
      const results = await Promise.all(contenders);
      expect(results.filter((result) => result.ok && result.stored)).toHaveLength(1);
      expect(await runStore.readProposal(runId)).toEqual({ ok: true, value: null });
      const replay = await runStore.read(runId);
      expect(replay.ok && replay.value?.events.slice(-2).map((event) => event.type))
        .toEqual([expect.stringMatching(/^commit\./u), 'run.completed']);
    },
  );
});
