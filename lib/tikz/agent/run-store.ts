import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import {
  isTikzAgentEvent,
  type TikzAgentEvent,
} from './protocol';
import type { AiTransactionAttestation } from '../transactions/transaction-attestation';
import { isSourceHashAlgorithm } from '../document/source-hash';
import {
  createTikzAgentRunBasisTransition,
  isTikzAgentRunBasisTransition,
  isTikzAgentRunCheckpoint,
  sameTikzAgentRunBasis,
  type TikzAgentRunBasisTransition,
  type TikzAgentRunCheckpoint,
} from './run-checkpoint';

export const TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION =
  'tikz-agent-proposal-checkpoint/v1' as const;

export interface TikzAgentProposalCheckpoint {
  readonly schemaVersion: typeof TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION;
  readonly runId: string;
  readonly transactionId: string;
  readonly transactionAttestation: AiTransactionAttestation;
  /** Bounded typed proposal required to rebuild the transaction after reconnect. */
  readonly proposal: unknown;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly beforeRevision: number;
  readonly beforeSourceHash: string;
  readonly afterRevision: number;
  readonly afterSourceHash: string;
  readonly createdAt: number;
}

export interface TikzAgentRunSnapshot {
  readonly runId: string;
  readonly events: readonly TikzAgentEvent[];
  readonly runCheckpoint?: TikzAgentRunCheckpoint;
  readonly basisTransition?: TikzAgentRunBasisTransition;
  /** First event still retained before applying the caller's cursor. */
  readonly earliestSequence?: number;
  readonly proposal?: TikzAgentProposalCheckpoint;
  readonly verificationPending?: boolean;
  readonly terminal?: TikzAgentEvent;
}

export type TikzAgentStoreWriteResult =
  | { readonly ok: true; readonly stored: boolean }
  | { readonly ok: false; readonly code: 'unavailable' | 'invalid'; readonly message: string };

export type TikzAgentStoreReadResult<T> =
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly code: 'unavailable' | 'invalid'; readonly message: string };

export interface TikzAgentRunStore {
  /** Idempotently binds a run to one immutable source/context checkpoint. */
  checkpointRun(checkpoint: TikzAgentRunCheckpoint): Promise<TikzAgentStoreWriteResult>;
  appendEvent(event: TikzAgentEvent): Promise<TikzAgentStoreWriteResult>;
  checkpointProposal(
    checkpoint: TikzAgentProposalCheckpoint,
  ): Promise<TikzAgentStoreWriteResult>;
  /** Atomically publishes the durable proposal checkpoint and its ready event. */
  publishProposal(
    checkpoint: TikzAgentProposalCheckpoint,
    event: TikzAgentEvent,
  ): Promise<TikzAgentStoreWriteResult>;
  /** One-shot CAS before the post-commit verification model turn. */
  claimProposal(
    checkpoint: TikzAgentProposalCheckpoint,
  ): Promise<TikzAgentStoreWriteResult>;
  readProposal(runId: string): Promise<TikzAgentStoreReadResult<TikzAgentProposalCheckpoint>>;
  complete(event: TikzAgentEvent): Promise<TikzAgentStoreWriteResult>;
  /** Atomically appends one final observation and closes the run. */
  completeWithEvent(
    event: TikzAgentEvent,
    terminal: TikzAgentEvent,
  ): Promise<TikzAgentStoreWriteResult>;
  /** Atomically consumes a pending proposal and records its host-observed disposition. */
  resolveProposal(
    checkpoint: TikzAgentProposalCheckpoint,
    event: TikzAgentEvent,
    terminal: TikzAgentEvent,
  ): Promise<TikzAgentStoreWriteResult>;
  read(runId: string, afterSequence?: number): Promise<TikzAgentStoreReadResult<TikzAgentRunSnapshot>>;
}

const MAX_EVENTS_PER_RUN = 64;
const MAX_EVENT_BYTES = 8 * 1024;
const MAX_MEMORY_RUNS = 500;
const RUN_TTL_MS = 30 * 60_000;
const PROPOSAL_TTL_MS = 5 * 60_000;
const encoder = new TextEncoder();

type MemoryRun = {
  events: TikzAgentEvent[];
  runCheckpoint?: TikzAgentRunCheckpoint;
  basisTransition?: TikzAgentRunBasisTransition;
  proposal?: TikzAgentProposalCheckpoint;
  verificationClaimed?: boolean;
  terminal?: TikzAgentEvent;
  expiresAt: number;
};

function validId(value: string): boolean {
  return value.length > 0
    && value.length <= 256
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function validOpaqueId(value: string): boolean {
  return value.length > 0
    && value.length <= 256
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validAttestationDigest(
  algorithm: unknown,
  digest: unknown,
): boolean {
  if (!isSourceHashAlgorithm(algorithm) || typeof digest !== 'string') return false;
  return algorithm === 'fnv1a64-utf8'
    ? /^[0-9a-f]{16}$/u.test(digest)
    : /^[0-9a-f]{64}$/u.test(digest);
}

function validCheckpoint(value: TikzAgentProposalCheckpoint): boolean {
  try {
    const attestation = value.transactionAttestation as unknown;
    const attestationRecord = attestation && typeof attestation === 'object'
      ? attestation as Record<string, unknown>
      : null;
    return value.schemaVersion === TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION
      && validId(value.runId)
      // Transaction and document identifiers are opaque protocol values. They
      // are never interpolated into Redis keys (runId is SHA-256 namespaced),
      // so accepting bounded Unicode here keeps RunStore validation aligned
      // with the proposal compilers instead of rejecting otherwise-valid model
      // intent ids after compilation.
      && validOpaqueId(value.transactionId)
      && validOpaqueId(value.documentId)
      && validOpaqueId(value.epoch)
      && validOpaqueId(value.sourceId)
      && Number.isSafeInteger(value.beforeRevision)
      && value.beforeRevision >= 0
      && value.afterRevision === value.beforeRevision + 1
      && value.beforeSourceHash.length > 0
      && value.beforeSourceHash.length <= 256
      && value.afterSourceHash.length > 0
      && value.afterSourceHash.length <= 256
      && value.proposal !== undefined
      && value.proposal !== null
      && encoder.encode(JSON.stringify(value.proposal)).byteLength <= 48 * 1024
      && Number.isSafeInteger(value.createdAt)
      && value.createdAt > 0
      && attestationRecord?.schemaVersion === 'ai-transaction-attestation/v1'
      && attestationRecord.transactionId === value.transactionId
      && validAttestationDigest(
        attestationRecord.algorithm,
        attestationRecord.digest,
      );
  } catch {
    return false;
  }
}

function boundedRunCheckpoint(value: TikzAgentRunCheckpoint): boolean {
  try {
    return isTikzAgentRunCheckpoint(value)
      && validId(value.runId)
      && encoder.encode(JSON.stringify(value)).byteLength <= 16 * 1024;
  } catch {
    return false;
  }
}

function transitionForProposal(
  proposal: TikzAgentProposalCheckpoint,
  runCheckpoint?: TikzAgentRunCheckpoint,
): TikzAgentRunBasisTransition | null {
  const transition = createTikzAgentRunBasisTransition({
    runId: proposal.runId,
    transactionId: proposal.transactionId,
    documentId: proposal.documentId,
    epoch: proposal.epoch,
    sourceId: proposal.sourceId,
    beforeRevision: proposal.beforeRevision,
    beforeSourceHash: proposal.beforeSourceHash,
    afterRevision: proposal.afterRevision,
    afterSourceHash: proposal.afterSourceHash,
    pluginSetDigest: runCheckpoint?.basis.pluginSetDigest,
    createdAt: proposal.createdAt,
  });
  if (
    !transition
    || (
      runCheckpoint
      && !sameTikzAgentRunBasis(runCheckpoint.basis, transition.before)
    )
  ) return null;
  return transition;
}

function boundedBasisTransition(value: TikzAgentRunBasisTransition): boolean {
  try {
    return isTikzAgentRunBasisTransition(value)
      && encoder.encode(JSON.stringify(value)).byteLength <= 4 * 1024;
  } catch {
    return false;
  }
}

function terminalEvent(event: TikzAgentEvent): boolean {
  return event.type === 'run.completed' || event.type === 'run.failed';
}

function proposalReadyEvent(event: TikzAgentEvent): boolean {
  return event.type === 'proposal.ready';
}

function boundedEvent(event: TikzAgentEvent): boolean {
  return isTikzAgentEvent(event)
    && validId(event.runId)
    && event.eventId === `${event.runId}:${event.sequence}`
    && encoder.encode(JSON.stringify(event)).byteLength <= MAX_EVENT_BYTES;
}

export function createMemoryTikzAgentRunStore(
  now: () => number = Date.now,
): TikzAgentRunStore & { reset(): void } {
  const runs = new Map<string, MemoryRun>();

  const prune = () => {
    const timestamp = now();
    for (const [runId, run] of runs) {
      if (run.expiresAt <= timestamp) runs.delete(runId);
    }
    if (runs.size <= MAX_MEMORY_RUNS) return;
    const overflow = runs.size - MAX_MEMORY_RUNS;
    for (const runId of [...runs.entries()]
      .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
      .slice(0, overflow)
      .map(([runId]) => runId)) {
      runs.delete(runId);
    }
  };

  const current = (runId: string): MemoryRun => {
    prune();
    const existing = runs.get(runId);
    if (existing) return existing;
    const created: MemoryRun = { events: [], expiresAt: now() + RUN_TTL_MS };
    runs.set(runId, created);
    prune();
    return created;
  };

  const append = (run: MemoryRun, event: TikzAgentEvent) => {
    if (run.events.some((existing) => existing.eventId === event.eventId)) return false;
    if (run.terminal || run.events.some((existing) => existing.sequence >= event.sequence)) {
      return false;
    }
    run.events.push(event);
    if (run.events.length > MAX_EVENTS_PER_RUN) {
      run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
    }
    run.expiresAt = now() + RUN_TTL_MS;
    return true;
  };

  return {
    async checkpointRun(checkpoint) {
      if (!boundedRunCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid Agent run checkpoint' };
      }
      const run = current(checkpoint.runId);
      if (run.runCheckpoint) {
        return {
          ok: true,
          stored: JSON.stringify(run.runCheckpoint) === JSON.stringify(checkpoint),
        };
      }
      if (
        run.events.length > 0
        || run.proposal
        || run.basisTransition
        || run.verificationClaimed
        || run.terminal
      ) {
        return { ok: true, stored: false };
      }
      run.runCheckpoint = structuredClone(checkpoint);
      run.expiresAt = now() + RUN_TTL_MS;
      return { ok: true, stored: true };
    },
    async appendEvent(event) {
      if (!boundedEvent(event) || terminalEvent(event)) {
        return { ok: false, code: 'invalid', message: 'invalid non-terminal agent event' };
      }
      return { ok: true, stored: append(current(event.runId), event) };
    },
    async checkpointProposal(checkpoint) {
      if (!validCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid proposal checkpoint' };
      }
      const run = current(checkpoint.runId);
      const transition = transitionForProposal(checkpoint, run.runCheckpoint);
      if (!transition || !boundedBasisTransition(transition)) {
        return { ok: false, code: 'invalid', message: 'proposal basis transition is invalid' };
      }
      if (run.terminal || run.verificationClaimed) return { ok: true, stored: false };
      if (run.proposal && run.proposal.createdAt + PROPOSAL_TTL_MS <= now()) {
        run.proposal = undefined;
      }
      if (run.proposal) {
        return {
          ok: true,
          stored: JSON.stringify(run.proposal) === JSON.stringify(checkpoint)
            && JSON.stringify(run.basisTransition) === JSON.stringify(transition),
        };
      }
      if (
        run.basisTransition
        && JSON.stringify(run.basisTransition) !== JSON.stringify(transition)
      ) return { ok: true, stored: false };
      run.proposal = checkpoint;
      run.basisTransition = transition;
      run.expiresAt = Math.max(run.expiresAt, now() + PROPOSAL_TTL_MS);
      return { ok: true, stored: true };
    },
    async publishProposal(checkpoint, event) {
      if (
        !validCheckpoint(checkpoint)
        || !boundedEvent(event)
        || !proposalReadyEvent(event)
        || checkpoint.runId !== event.runId
      ) {
        return { ok: false, code: 'invalid', message: 'invalid proposal publication' };
      }
      const run = current(checkpoint.runId);
      const transition = transitionForProposal(checkpoint, run.runCheckpoint);
      if (!transition || !boundedBasisTransition(transition)) {
        return { ok: false, code: 'invalid', message: 'proposal basis transition is invalid' };
      }
      if (run.terminal || run.verificationClaimed) return { ok: true, stored: false };
      if (run.proposal && run.proposal.createdAt + PROPOSAL_TTL_MS <= now()) {
        run.proposal = undefined;
      }
      const serializedCheckpoint = JSON.stringify(checkpoint);
      const serializedTransition = JSON.stringify(transition);
      if (run.proposal && JSON.stringify(run.proposal) !== serializedCheckpoint) {
        return { ok: true, stored: false };
      }
      if (run.basisTransition && JSON.stringify(run.basisTransition) !== serializedTransition) {
        return { ok: true, stored: false };
      }
      const existingEvent = run.events.find((candidate) => candidate.eventId === event.eventId);
      if (existingEvent) {
        return {
          ok: true,
          stored: JSON.stringify(existingEvent) === JSON.stringify(event)
            && !!run.proposal
            && JSON.stringify(run.proposal) === serializedCheckpoint,
        };
      }
      if (run.events.some((candidate) => candidate.sequence >= event.sequence)) {
        return { ok: true, stored: false };
      }
      run.proposal = checkpoint;
      run.basisTransition = transition;
      run.events.push(event);
      if (run.events.length > MAX_EVENTS_PER_RUN) {
        run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
      }
      run.expiresAt = Math.max(run.expiresAt, now() + RUN_TTL_MS);
      return { ok: true, stored: true };
    },
    async claimProposal(checkpoint) {
      if (!validCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid proposal claim' };
      }
      const run = current(checkpoint.runId);
      if (run.terminal || run.verificationClaimed || !run.proposal) {
        return { ok: true, stored: false };
      }
      if (JSON.stringify(run.proposal) !== JSON.stringify(checkpoint)) {
        return { ok: true, stored: false };
      }
      run.verificationClaimed = true;
      run.expiresAt = now() + RUN_TTL_MS;
      return { ok: true, stored: true };
    },
    async readProposal(runId) {
      if (!validId(runId)) {
        return { ok: false, code: 'invalid', message: 'invalid run id' };
      }
      prune();
      const run = runs.get(runId);
      if (
        !run?.proposal
        || run.terminal
        || run.verificationClaimed
        || run.proposal.createdAt + PROPOSAL_TTL_MS <= now()
      ) {
        return { ok: true, value: null };
      }
      return { ok: true, value: structuredClone(run.proposal) };
    },
    async complete(event) {
      if (!boundedEvent(event) || !terminalEvent(event)) {
        return { ok: false, code: 'invalid', message: 'invalid terminal agent event' };
      }
      const run = current(event.runId);
      if (run.terminal) return { ok: true, stored: false };
      if (run.events.some((existing) => existing.sequence >= event.sequence)) {
        return { ok: true, stored: false };
      }
      run.events.push(event);
      if (run.events.length > MAX_EVENTS_PER_RUN) run.events.shift();
      run.terminal = event;
      run.expiresAt = now() + RUN_TTL_MS;
      return { ok: true, stored: true };
    },
    async completeWithEvent(event, terminal) {
      if (
        !boundedEvent(event)
        || terminalEvent(event)
        || !boundedEvent(terminal)
        || !terminalEvent(terminal)
        || event.runId !== terminal.runId
        || event.sequence >= terminal.sequence
      ) {
        return { ok: false, code: 'invalid', message: 'invalid final agent event batch' };
      }
      const run = current(event.runId);
      if (run.terminal) return { ok: true, stored: false };
      if (run.events.some((existing) => existing.sequence >= event.sequence)) {
        return { ok: true, stored: false };
      }
      run.events.push(event, terminal);
      if (run.events.length > MAX_EVENTS_PER_RUN) {
        run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
      }
      run.terminal = terminal;
      run.expiresAt = now() + RUN_TTL_MS;
      return { ok: true, stored: true };
    },
    async resolveProposal(checkpoint, event, terminal) {
      if (
        !validCheckpoint(checkpoint)
        || !boundedEvent(event)
        || (event.type !== 'commit.rejected' && event.type !== 'commit.completed')
        || !boundedEvent(terminal)
        || !terminalEvent(terminal)
        || checkpoint.runId !== event.runId
        || event.runId !== terminal.runId
        || event.sequence >= terminal.sequence
      ) {
        return { ok: false, code: 'invalid', message: 'invalid proposal disposition' };
      }
      const run = current(checkpoint.runId);
      if (
        run.terminal
        || run.verificationClaimed
        || !run.proposal
        || JSON.stringify(run.proposal) !== JSON.stringify(checkpoint)
        || run.events.some((existing) => existing.sequence >= event.sequence)
      ) {
        return { ok: true, stored: false };
      }
      run.verificationClaimed = true;
      run.events.push(event, terminal);
      if (run.events.length > MAX_EVENTS_PER_RUN) {
        run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
      }
      run.terminal = terminal;
      run.expiresAt = now() + RUN_TTL_MS;
      return { ok: true, stored: true };
    },
    async read(runId, afterSequence = -1) {
      if (!validId(runId) || !Number.isSafeInteger(afterSequence) || afterSequence < -1) {
        return { ok: false, code: 'invalid', message: 'invalid run cursor' };
      }
      prune();
      const run = runs.get(runId);
      if (!run) return { ok: true, value: null };
      const proposal = !run.terminal
        && !run.verificationClaimed
        && run.proposal
        && run.proposal.createdAt + PROPOSAL_TTL_MS > now()
        ? run.proposal
        : undefined;
      return {
        ok: true,
        value: {
          runId,
          ...(run.runCheckpoint
            ? { runCheckpoint: structuredClone(run.runCheckpoint) }
            : {}),
          ...(run.basisTransition
            ? { basisTransition: structuredClone(run.basisTransition) }
            : {}),
          ...(run.events[0]
            ? { earliestSequence: run.events[0].sequence }
            : {}),
          events: structuredClone(
            run.events.filter((event) => event.sequence > afterSequence),
          ),
          ...(proposal ? { proposal: structuredClone(proposal) } : {}),
          ...(run.verificationClaimed && !run.terminal
            ? { verificationPending: true }
            : {}),
          ...(run.terminal ? { terminal: structuredClone(run.terminal) } : {}),
        },
      };
    },
    reset() {
      runs.clear();
    },
  };
}

const APPEND_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
local last = redis.call('GET', KEYS[3])
if last and tonumber(ARGV[2]) <= tonumber(last) then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], -${MAX_EVENTS_PER_RUN}, -1)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
return 1
`;

const RUN_CHECKPOINT_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then
  if existing == ARGV[1] then
    return 1
  end
  return 0
end
if redis.call('EXISTS', KEYS[2]) == 1
  or redis.call('LLEN', KEYS[3]) > 0
  or redis.call('EXISTS', KEYS[4]) == 1
  or redis.call('EXISTS', KEYS[5]) == 1
  or redis.call('EXISTS', KEYS[6]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`;

const CHECKPOINT_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then
  return 0
end
local existing = redis.call('GET', KEYS[1])
local existingTransition = redis.call('GET', KEYS[4])
if existingTransition and existingTransition ~= ARGV[3] then
  return 0
end
if existing then
  if existing == ARGV[1] then
    if not existingTransition then
      redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
    end
    return 1
  end
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
if not existingTransition then
  redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
end
return 1
`;

const CLAIM_PROPOSAL_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then
  return 0
end
local existing = redis.call('GET', KEYS[1])
if not existing or existing ~= ARGV[1] then
  return 0
end
local claimed = redis.call('SET', KEYS[3], '1', 'EX', ARGV[2], 'NX')
if claimed then
  return 1
end
return 0
`;

const READ_PROPOSAL_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then
  return false
end
return redis.call('GET', KEYS[1])
`;

const PUBLISH_PROPOSAL_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 or redis.call('EXISTS', KEYS[5]) == 1 then
  return 0
end
local existing = redis.call('GET', KEYS[2])
local existingTransition = redis.call('GET', KEYS[6])
if existing and existing ~= ARGV[1] then
  return 0
end
if existingTransition and existingTransition ~= ARGV[6] then
  return 0
end
local last = redis.call('GET', KEYS[4])
if last and tonumber(ARGV[3]) <= tonumber(last) then
  local lastEvent = redis.call('LINDEX', KEYS[1], -1)
  if existing == ARGV[1] and existingTransition == ARGV[6] and lastEvent == ARGV[2] then
    return 1
  end
  return 0
end
if not existing then
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[5])
end
if not existingTransition then
  redis.call('SET', KEYS[6], ARGV[6], 'EX', ARGV[7])
end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('LTRIM', KEYS[1], -${MAX_EVENTS_PER_RUN}, -1)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
return 1
`;

const READ_SNAPSHOT_SCRIPT = `
local events = redis.call('LRANGE', KEYS[1], 0, -1)
local terminal = redis.call('GET', KEYS[3])
local proposal = false
if not terminal and redis.call('EXISTS', KEYS[4]) == 0 then
  proposal = redis.call('GET', KEYS[2])
end
local verificationPending = false
if not terminal and redis.call('EXISTS', KEYS[4]) == 1 then
  verificationPending = true
end
local runCheckpoint = redis.call('GET', KEYS[5])
local basisTransition = redis.call('GET', KEYS[6])
return {
  events,
  proposal,
  terminal or false,
  verificationPending,
  runCheckpoint or false,
  basisTransition or false
}
`;

const COMPLETE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
local last = redis.call('GET', KEYS[3])
if last and tonumber(ARGV[2]) <= tonumber(last) then
  return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], -${MAX_EVENTS_PER_RUN}, -1)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
return 1
`;

const COMPLETE_WITH_EVENT_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
local last = redis.call('GET', KEYS[3])
if last and tonumber(ARGV[2]) <= tonumber(last) then
  return 0
end
if tonumber(ARGV[4]) <= tonumber(ARGV[2]) then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[1], ARGV[3])
redis.call('LTRIM', KEYS[1], -${MAX_EVENTS_PER_RUN}, -1)
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[5])
return 1
`;

const RESOLVE_PROPOSAL_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 or redis.call('EXISTS', KEYS[5]) == 1 then
  return 0
end
local proposal = redis.call('GET', KEYS[2])
if not proposal or proposal ~= ARGV[1] then
  return 0
end
local last = redis.call('GET', KEYS[4])
if last and tonumber(ARGV[3]) <= tonumber(last) then
  return 0
end
if tonumber(ARGV[5]) <= tonumber(ARGV[3]) then
  return 0
end
redis.call('SET', KEYS[5], '1', 'EX', ARGV[6])
redis.call('RPUSH', KEYS[1], ARGV[2], ARGV[4])
redis.call('LTRIM', KEYS[1], -${MAX_EVENTS_PER_RUN}, -1)
redis.call('EXPIRE', KEYS[1], ARGV[6])
redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[6])
redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[6])
return 1
`;

function redisKey(prefix: string, runId: string, suffix: string): string {
  const digest = createHash('sha256').update(runId).digest('hex');
  return `${prefix}:${digest}:${suffix}`;
}

/**
 * Create a RunStore around an already-connected Redis client.
 *
 * Keeping this constructor exported lets integration tests and worker
 * processes exercise the same atomic Lua-backed implementation without
 * reaching through the process-global connection singleton.
 */
export function createRedisTikzAgentRunStore(
  client: RedisClientType,
  prefix: string,
): TikzAgentRunStore {
  const eventsKey = (runId: string) => redisKey(prefix, runId, 'events');
  const proposalKey = (runId: string) => redisKey(prefix, runId, 'proposal');
  const terminalKey = (runId: string) => redisKey(prefix, runId, 'terminal');
  const sequenceKey = (runId: string) => redisKey(prefix, runId, 'sequence');
  const claimKey = (runId: string) => redisKey(prefix, runId, 'verification-claim');
  const runCheckpointKey = (runId: string) => redisKey(prefix, runId, 'run-checkpoint');
  const basisTransitionKey = (runId: string) => redisKey(prefix, runId, 'basis-transition');
  const ttlSeconds = Math.ceil(RUN_TTL_MS / 1_000);
  const proposalTtlSeconds = Math.ceil(PROPOSAL_TTL_MS / 1_000);

  const unavailable = (error: unknown): TikzAgentStoreWriteResult => ({
    ok: false,
    code: 'unavailable',
    message: error instanceof Error ? error.message : 'agent run store unavailable',
  });

  const storedRunCheckpoint = async (
    runId: string,
  ): Promise<TikzAgentRunCheckpoint | undefined> => {
    const raw = await client.get(runCheckpointKey(runId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!isTikzAgentRunCheckpoint(parsed)) {
      throw new TypeError('stored Agent run checkpoint is invalid');
    }
    return parsed;
  };

  return {
    async checkpointRun(checkpoint) {
      if (!boundedRunCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid Agent run checkpoint' };
      }
      try {
        const stored = Number(await client.eval(RUN_CHECKPOINT_SCRIPT, {
          keys: [
            runCheckpointKey(checkpoint.runId),
            terminalKey(checkpoint.runId),
            eventsKey(checkpoint.runId),
            proposalKey(checkpoint.runId),
            claimKey(checkpoint.runId),
            basisTransitionKey(checkpoint.runId),
          ],
          arguments: [JSON.stringify(checkpoint), String(ttlSeconds)],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async appendEvent(event) {
      if (!boundedEvent(event) || terminalEvent(event)) {
        return { ok: false, code: 'invalid', message: 'invalid non-terminal agent event' };
      }
      try {
        const serialized = JSON.stringify(event);
        const stored = Number(await client.eval(APPEND_SCRIPT, {
          keys: [
            eventsKey(event.runId),
            terminalKey(event.runId),
            sequenceKey(event.runId),
          ],
          arguments: [serialized, String(event.sequence), String(ttlSeconds)],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async checkpointProposal(checkpoint) {
      if (!validCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid proposal checkpoint' };
      }
      try {
        const transition = transitionForProposal(
          checkpoint,
          await storedRunCheckpoint(checkpoint.runId),
        );
        if (!transition || !boundedBasisTransition(transition)) {
          return { ok: false, code: 'invalid', message: 'proposal basis transition is invalid' };
        }
        const stored = Number(await client.eval(CHECKPOINT_SCRIPT, {
          keys: [
            proposalKey(checkpoint.runId),
            terminalKey(checkpoint.runId),
            claimKey(checkpoint.runId),
            basisTransitionKey(checkpoint.runId),
          ],
          arguments: [
            JSON.stringify(checkpoint),
            String(proposalTtlSeconds),
            JSON.stringify(transition),
            String(ttlSeconds),
          ],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async publishProposal(checkpoint, event) {
      if (
        !validCheckpoint(checkpoint)
        || !boundedEvent(event)
        || !proposalReadyEvent(event)
        || checkpoint.runId !== event.runId
      ) {
        return { ok: false, code: 'invalid', message: 'invalid proposal publication' };
      }
      try {
        const transition = transitionForProposal(
          checkpoint,
          await storedRunCheckpoint(checkpoint.runId),
        );
        if (!transition || !boundedBasisTransition(transition)) {
          return { ok: false, code: 'invalid', message: 'proposal basis transition is invalid' };
        }
        const stored = Number(await client.eval(PUBLISH_PROPOSAL_SCRIPT, {
          keys: [
            eventsKey(event.runId),
            proposalKey(event.runId),
            terminalKey(event.runId),
            sequenceKey(event.runId),
            claimKey(event.runId),
            basisTransitionKey(event.runId),
          ],
          arguments: [
            JSON.stringify(checkpoint),
            JSON.stringify(event),
            String(event.sequence),
            String(ttlSeconds),
            String(proposalTtlSeconds),
            JSON.stringify(transition),
            String(ttlSeconds),
          ],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async claimProposal(checkpoint) {
      if (!validCheckpoint(checkpoint)) {
        return { ok: false, code: 'invalid', message: 'invalid proposal claim' };
      }
      try {
        const stored = Number(await client.eval(CLAIM_PROPOSAL_SCRIPT, {
          keys: [
            proposalKey(checkpoint.runId),
            terminalKey(checkpoint.runId),
            claimKey(checkpoint.runId),
          ],
          arguments: [JSON.stringify(checkpoint), String(ttlSeconds)],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async readProposal(runId) {
      if (!validId(runId)) {
        return { ok: false, code: 'invalid', message: 'invalid run id' };
      }
      try {
        const raw = await client.eval(READ_PROPOSAL_SCRIPT, {
          keys: [proposalKey(runId), terminalKey(runId), claimKey(runId)],
          arguments: [],
        }) as string | null;
        if (!raw) return { ok: true, value: null };
        const parsed = JSON.parse(raw) as TikzAgentProposalCheckpoint;
        return validCheckpoint(parsed)
          ? { ok: true, value: parsed }
          : { ok: false, code: 'invalid', message: 'stored proposal checkpoint is invalid' };
      } catch (error) {
        return {
          ok: false,
          code: 'unavailable',
          message: error instanceof Error ? error.message : 'agent run store unavailable',
        };
      }
    },
    async complete(event) {
      if (!boundedEvent(event) || !terminalEvent(event)) {
        return { ok: false, code: 'invalid', message: 'invalid terminal agent event' };
      }
      try {
        const stored = Number(await client.eval(COMPLETE_SCRIPT, {
          keys: [
            eventsKey(event.runId),
            terminalKey(event.runId),
            sequenceKey(event.runId),
          ],
          arguments: [
            JSON.stringify(event),
            String(event.sequence),
            String(ttlSeconds),
          ],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async completeWithEvent(event, terminal) {
      if (
        !boundedEvent(event)
        || terminalEvent(event)
        || !boundedEvent(terminal)
        || !terminalEvent(terminal)
        || event.runId !== terminal.runId
        || event.sequence >= terminal.sequence
      ) {
        return { ok: false, code: 'invalid', message: 'invalid final agent event batch' };
      }
      try {
        const stored = Number(await client.eval(COMPLETE_WITH_EVENT_SCRIPT, {
          keys: [
            eventsKey(event.runId),
            terminalKey(event.runId),
            sequenceKey(event.runId),
          ],
          arguments: [
            JSON.stringify(event),
            String(event.sequence),
            JSON.stringify(terminal),
            String(terminal.sequence),
            String(ttlSeconds),
          ],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async resolveProposal(checkpoint, event, terminal) {
      if (
        !validCheckpoint(checkpoint)
        || !boundedEvent(event)
        || (event.type !== 'commit.rejected' && event.type !== 'commit.completed')
        || !boundedEvent(terminal)
        || !terminalEvent(terminal)
        || checkpoint.runId !== event.runId
        || event.runId !== terminal.runId
        || event.sequence >= terminal.sequence
      ) {
        return { ok: false, code: 'invalid', message: 'invalid proposal disposition' };
      }
      try {
        const stored = Number(await client.eval(RESOLVE_PROPOSAL_SCRIPT, {
          keys: [
            eventsKey(event.runId),
            proposalKey(event.runId),
            terminalKey(event.runId),
            sequenceKey(event.runId),
            claimKey(event.runId),
          ],
          arguments: [
            JSON.stringify(checkpoint),
            JSON.stringify(event),
            String(event.sequence),
            JSON.stringify(terminal),
            String(terminal.sequence),
            String(ttlSeconds),
          ],
        }));
        return { ok: true, stored: stored === 1 };
      } catch (error) {
        return unavailable(error);
      }
    },
    async read(runId, afterSequence = -1) {
      if (!validId(runId) || !Number.isSafeInteger(afterSequence) || afterSequence < -1) {
        return { ok: false, code: 'invalid', message: 'invalid run cursor' };
      }
      try {
        const [
          rawEvents,
          rawProposal,
          rawTerminal,
          rawVerificationPending,
          rawRunCheckpoint,
          rawBasisTransition,
        ] = await client.eval(
          READ_SNAPSHOT_SCRIPT,
          {
            keys: [
              eventsKey(runId),
              proposalKey(runId),
              terminalKey(runId),
              claimKey(runId),
              runCheckpointKey(runId),
              basisTransitionKey(runId),
            ],
            arguments: [],
          },
        ) as [
          string[],
          string | null,
          string | null,
          number | null,
          string | null,
          string | null,
        ];
        if (
          rawEvents.length === 0
          && !rawProposal
          && !rawTerminal
          && !rawVerificationPending
          && !rawRunCheckpoint
          && !rawBasisTransition
        ) {
          return { ok: true, value: null };
        }
        let parsedEvents: TikzAgentEvent[];
        let proposal: TikzAgentProposalCheckpoint | undefined;
        let terminal: TikzAgentEvent | undefined;
        let parsedRunCheckpoint: unknown;
        let parsedBasisTransition: unknown;
        try {
          parsedEvents = rawEvents.map((raw) => JSON.parse(raw) as TikzAgentEvent);
          proposal = rawProposal
            ? JSON.parse(rawProposal) as TikzAgentProposalCheckpoint
            : undefined;
          terminal = rawTerminal
            ? JSON.parse(rawTerminal) as TikzAgentEvent
            : undefined;
          parsedRunCheckpoint = rawRunCheckpoint
            ? JSON.parse(rawRunCheckpoint) as unknown
            : undefined;
          parsedBasisTransition = rawBasisTransition
            ? JSON.parse(rawBasisTransition) as unknown
            : undefined;
        } catch {
          return { ok: false, code: 'invalid', message: 'stored Agent run JSON is invalid' };
        }
        if (parsedEvents.some((event, index) => (
          !boundedEvent(event)
          || event.runId !== runId
          || (index > 0 && event.sequence <= parsedEvents[index - 1]!.sequence)
        ))) {
          return { ok: false, code: 'invalid', message: 'stored Agent event sequence is invalid' };
        }
        if (proposal !== undefined && (!validCheckpoint(proposal) || proposal.runId !== runId)) {
          return { ok: false, code: 'invalid', message: 'stored proposal checkpoint is invalid' };
        }
        if (
          terminal !== undefined
          && (!boundedEvent(terminal) || !terminalEvent(terminal) || terminal.runId !== runId)
        ) {
          return { ok: false, code: 'invalid', message: 'stored terminal Agent event is invalid' };
        }
        if (parsedRunCheckpoint !== undefined) {
          if (
            !isTikzAgentRunCheckpoint(parsedRunCheckpoint)
            || parsedRunCheckpoint.runId !== runId
          ) {
            return { ok: false, code: 'invalid', message: 'stored Agent run checkpoint is invalid' };
          }
        }
        const runCheckpoint = parsedRunCheckpoint;
        if (parsedBasisTransition !== undefined) {
          if (
            !isTikzAgentRunBasisTransition(parsedBasisTransition)
            || parsedBasisTransition.runId !== runId
            || (
              runCheckpoint !== undefined
              && !sameTikzAgentRunBasis(runCheckpoint.basis, parsedBasisTransition.before)
            )
          ) {
            return { ok: false, code: 'invalid', message: 'stored Agent basis transition is invalid' };
          }
        }
        const basisTransition = parsedBasisTransition;
        if (proposal && basisTransition) {
          const expectedTransition = transitionForProposal(proposal, runCheckpoint);
          if (
            !expectedTransition
            || JSON.stringify(expectedTransition) !== JSON.stringify(basisTransition)
          ) {
            return { ok: false, code: 'invalid', message: 'stored proposal transition is inconsistent' };
          }
        }
        const retainedTerminal = terminal
          ? parsedEvents.find((event) => event.eventId === terminal?.eventId)
          : undefined;
        if (
          retainedTerminal
          && JSON.stringify(retainedTerminal) !== JSON.stringify(terminal)
        ) {
          return { ok: false, code: 'invalid', message: 'stored terminal event is inconsistent' };
        }
        const events = parsedEvents.filter((event) => event.sequence > afterSequence);
        return {
          ok: true,
          value: {
            runId,
            events,
            ...(runCheckpoint ? { runCheckpoint } : {}),
            ...(basisTransition ? { basisTransition } : {}),
            ...(parsedEvents[0]
              ? { earliestSequence: parsedEvents[0].sequence }
              : {}),
            ...(proposal && validCheckpoint(proposal) ? { proposal } : {}),
            ...(rawVerificationPending ? { verificationPending: true } : {}),
            ...(terminal && isTikzAgentEvent(terminal) ? { terminal } : {}),
          },
        };
      } catch (error) {
        return {
          ok: false,
          code: 'unavailable',
          message: error instanceof Error ? error.message : 'agent run store unavailable',
        };
      }
    },
  };
}

const memoryStore = createMemoryTikzAgentRunStore();
let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<RedisClientType> | null = null;
let redisStore: TikzAgentRunStore | null = null;

async function connectedRedisStore(url: string): Promise<TikzAgentRunStore> {
  if (redisStore && redisClient?.isReady) return redisStore;
  if (redisClient && !redisClient.isReady && !redisConnectPromise) {
    redisClient.destroy();
    redisClient = null;
    redisStore = null;
  }
  if (!redisConnectPromise) {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_500,
        reconnectStrategy: false,
      },
    });
    client.on('error', () => undefined);
    redisClient = client;
    redisConnectPromise = client.connect()
      .then(() => client)
      .catch((error: unknown) => {
        redisConnectPromise = null;
        redisClient = null;
        client.destroy();
        throw error;
      });
  }
  const pending = redisConnectPromise;
  const client = await pending;
  if (redisConnectPromise === pending) redisConnectPromise = null;
  const prefix = (process.env.AGENT_RUN_REDIS_PREFIX || 'math-geohub:agent-run')
    .replace(/[^A-Za-z0-9:_-]/gu, '')
    .slice(0, 80) || 'math-geohub:agent-run';
  redisStore ??= createRedisTikzAgentRunStore(client, prefix);
  return redisStore;
}

export async function getTikzAgentRunStore(): Promise<
  | { readonly ok: true; readonly store: TikzAgentRunStore }
  | { readonly ok: false; readonly message: string }
> {
  const url = (
    process.env.AGENT_RUN_REDIS_URL
    || process.env.RATE_LIMIT_REDIS_URL
    || ''
  ).trim();
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, message: 'shared Agent RunStore is not configured' };
    }
    return { ok: true, store: memoryStore };
  }
  try {
    return { ok: true, store: await connectedRedisStore(url) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Agent RunStore unavailable',
    };
  }
}

export function resetMemoryTikzAgentRunStore(): void {
  memoryStore.reset();
}
