import {
  isTikzAgentEvent,
  type TikzAgentEvent,
} from './protocol';

/**
 * The replay endpoint is deliberately a read-only recovery lane.  Keep this
 * module free of React and transaction imports so the browser can validate an
 * untrusted response before it reaches the Agent run reducer.
 */

export const MAX_TIKZ_AGENT_REPLAY_BYTES = 256 * 1024;
export const MAX_TIKZ_AGENT_REPLAY_EVENTS = 64;

export interface TikzAgentReplayProposalSummary {
  readonly schemaVersion: 'tikz-agent-proposal-checkpoint/v1';
  readonly runId: string;
  readonly transactionId: string;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly beforeRevision: number;
  readonly beforeSourceHash: string;
  readonly afterRevision: number;
  readonly afterSourceHash: string;
}

export interface TikzAgentReplayResult {
  readonly schemaVersion: 'tikz-agent-run-replay/v1';
  readonly runId: string;
  /** Events are validated, bounded, run-scoped, and strictly increasing. */
  readonly events: readonly TikzAgentEvent[];
  /**
   * Only checkpoint identity is exposed to the client.  The typed proposal
   * body is intentionally discarded: reconnect must never turn into an
   * implicit transaction submission path.
   */
  readonly proposal?: TikzAgentReplayProposalSummary;
  readonly verificationPending: boolean;
  readonly terminal?: TikzAgentEvent;
  readonly lastSequence: number;
}

export interface TikzAgentProposalDispositionResult {
  readonly schemaVersion: 'tikz-agent-proposal-disposition-result/v1';
  readonly runId: string;
  readonly events: readonly [TikzAgentEvent, TikzAgentEvent];
}

export class TikzAgentReplayError extends Error {
  readonly code: 'invalid' | 'http' | 'too-large';
  readonly status?: number;

  constructor(
    code: TikzAgentReplayError['code'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'TikzAgentReplayError';
    this.code = code;
    this.status = status;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function boundedRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseProposalSummary(
  value: unknown,
  expectedRunId: string,
): TikzAgentReplayProposalSummary | undefined {
  if (!record(value)) return undefined;
  if (
    value.schemaVersion !== 'tikz-agent-proposal-checkpoint/v1'
    || value.runId !== expectedRunId
    || !boundedText(value.transactionId)
    || !boundedText(value.documentId)
    || !boundedText(value.epoch)
    || !boundedText(value.sourceId)
    || !boundedRevision(value.beforeRevision)
    || !boundedRevision(value.afterRevision)
    || value.afterRevision !== value.beforeRevision + 1
    || !boundedText(value.beforeSourceHash)
    || !boundedText(value.afterSourceHash)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 'tikz-agent-proposal-checkpoint/v1',
    runId: expectedRunId,
    transactionId: value.transactionId,
    documentId: value.documentId,
    epoch: value.epoch,
    sourceId: value.sourceId,
    beforeRevision: value.beforeRevision,
    beforeSourceHash: value.beforeSourceHash,
    afterRevision: value.afterRevision,
    afterSourceHash: value.afterSourceHash,
  };
}

function parseReplay(
  value: unknown,
  expectedRunId: string,
  afterSequence: number,
): TikzAgentReplayResult {
  if (!record(value) || value.schemaVersion !== 'tikz-agent-run-replay/v1') {
    throw new TikzAgentReplayError('invalid', 'Agent replay payload schema is invalid');
  }
  if (value.runId !== expectedRunId) {
    throw new TikzAgentReplayError('invalid', 'Agent replay run identity does not match');
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_TIKZ_AGENT_REPLAY_EVENTS) {
    throw new TikzAgentReplayError('invalid', 'Agent replay event batch is invalid or too large');
  }

  const events: TikzAgentEvent[] = [];
  const eventIds = new Set<string>();
  let lastSequence = afterSequence;
  for (const candidate of value.events) {
    if (
      !isTikzAgentEvent(candidate)
      || candidate.runId !== expectedRunId
      || candidate.eventId !== `${expectedRunId}:${candidate.sequence}`
      || candidate.sequence <= afterSequence
      || candidate.sequence <= lastSequence
      || eventIds.has(candidate.eventId)
    ) {
      throw new TikzAgentReplayError('invalid', 'Agent replay event ordering is invalid');
    }
    eventIds.add(candidate.eventId);
    events.push(candidate);
    lastSequence = candidate.sequence;
  }

  let terminal: TikzAgentEvent | undefined;
  if (value.terminal !== null && value.terminal !== undefined) {
    if (
      !isTikzAgentEvent(value.terminal)
      || value.terminal.runId !== expectedRunId
      || (value.terminal.type !== 'run.completed' && value.terminal.type !== 'run.failed')
    ) {
      throw new TikzAgentReplayError('invalid', 'Agent replay terminal event is invalid');
    }
    terminal = value.terminal;
    if (terminal.sequence > afterSequence && !eventIds.has(terminal.eventId)) {
      if (terminal.sequence <= lastSequence) {
        throw new TikzAgentReplayError('invalid', 'Agent replay terminal ordering is invalid');
      }
      events.push(terminal);
      eventIds.add(terminal.eventId);
      lastSequence = terminal.sequence;
    }
  }

  const proposal = parseProposalSummary(value.proposal, expectedRunId);
  if (
    value.verificationPending !== undefined
    && typeof value.verificationPending !== 'boolean'
  ) {
    throw new TikzAgentReplayError('invalid', 'Agent replay verification state is invalid');
  }
  return {
    schemaVersion: 'tikz-agent-run-replay/v1',
    runId: expectedRunId,
    events,
    ...(proposal ? { proposal } : {}),
    verificationPending: value.verificationPending === true,
    ...(terminal ? { terminal } : {}),
    lastSequence,
  };
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
      throw new TikzAgentReplayError('too-large', 'Agent replay response exceeds the safety limit');
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new TikzAgentReplayError('too-large', 'Agent replay response exceeds the safety limit');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new TikzAgentReplayError('too-large', 'Agent replay response exceeds the safety limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function fetchTikzAgentRunReplay(options: {
  readonly runId: string;
  readonly resumeToken: string;
  readonly afterSequence: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TikzAgentReplayResult> {
  const { runId, resumeToken, afterSequence, signal } = options;
  if (!boundedText(runId) || !boundedText(resumeToken, 512)) {
    throw new TikzAgentReplayError('invalid', 'Agent replay identity is invalid');
  }
  if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) {
    throw new TikzAgentReplayError('invalid', 'Agent replay cursor is invalid');
  }
  // The capability is sent only as an Authorization header.  In particular,
  // never put it in a query string, URL, history entry, or diagnostic string.
  const url = `/api/tikz/runs/${encodeURIComponent(runId)}?afterSequence=${afterSequence}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${resumeToken}`,
      Accept: 'application/json',
    },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TikzAgentReplayError('http', `Agent replay request failed (${response.status})`, response.status);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(response, MAX_TIKZ_AGENT_REPLAY_BYTES)) as unknown;
  } catch (error) {
    if (error instanceof TikzAgentReplayError) throw error;
    throw new TikzAgentReplayError('invalid', 'Agent replay response is not valid JSON');
  }
  return parseReplay(payload, runId, afterSequence);
}

async function resolveTikzAgentProposal(options: {
  readonly runId: string;
  readonly resumeToken: string;
  readonly transactionId: string;
  readonly outcome: 'rejected' | 'committed-unverified';
  readonly reason?: string;
  readonly afterRevision?: number;
  readonly afterSourceHash?: string;
  readonly transactionAttestation?: unknown;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TikzAgentProposalDispositionResult> {
  const { runId, resumeToken, transactionId, signal } = options;
  if (
    !boundedText(runId)
    || !boundedText(resumeToken, 512)
    || !boundedText(transactionId)
    || (
      options.outcome === 'committed-unverified'
      && (
        !boundedRevision(options.afterRevision)
        || !boundedText(options.afterSourceHash)
        || !record(options.transactionAttestation)
      )
    )
  ) {
    throw new TikzAgentReplayError('invalid', 'Agent proposal disposition identity is invalid');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`/api/tikz/runs/${encodeURIComponent(runId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resumeToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    body: JSON.stringify({
      schemaVersion: 'tikz-agent-proposal-disposition/v1',
      transactionId,
      outcome: options.outcome,
      ...(options.reason ? { reason: options.reason.slice(0, 500) } : {}),
      ...(options.outcome === 'committed-unverified'
        ? {
          afterRevision: options.afterRevision,
          afterSourceHash: options.afterSourceHash,
          transactionAttestation: options.transactionAttestation,
        }
        : {}),
    }),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TikzAgentReplayError(
      'http',
      `Agent proposal disposition failed (${response.status})`,
      response.status,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(response, 32 * 1024)) as unknown;
  } catch (error) {
    if (error instanceof TikzAgentReplayError) throw error;
    throw new TikzAgentReplayError('invalid', 'Agent proposal disposition is not valid JSON');
  }
  if (
    !record(payload)
    || payload.schemaVersion !== 'tikz-agent-proposal-disposition-result/v1'
    || payload.runId !== runId
    || !Array.isArray(payload.events)
    || payload.events.length !== 2
    || !isTikzAgentEvent(payload.events[0])
    || !isTikzAgentEvent(payload.events[1])
    || payload.events[0].runId !== runId
    || payload.events[0].type !== (
      options.outcome === 'committed-unverified' ? 'commit.completed' : 'commit.rejected'
    )
    || payload.events[1].runId !== runId
    || payload.events[1].type !== 'run.completed'
    || payload.events[0].sequence >= payload.events[1].sequence
  ) {
    throw new TikzAgentReplayError('invalid', 'Agent proposal disposition response is invalid');
  }
  return {
    schemaVersion: 'tikz-agent-proposal-disposition-result/v1',
    runId,
    events: [payload.events[0], payload.events[1]],
  };
}

export function rejectTikzAgentProposal(options: {
  readonly runId: string;
  readonly resumeToken: string;
  readonly transactionId: string;
  readonly reason?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TikzAgentProposalDispositionResult> {
  return resolveTikzAgentProposal({ ...options, outcome: 'rejected' });
}

export function acknowledgeTikzAgentProposalCommit(options: {
  readonly runId: string;
  readonly resumeToken: string;
  readonly transactionId: string;
  readonly afterRevision: number;
  readonly afterSourceHash: string;
  readonly transactionAttestation: unknown;
  readonly reason?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TikzAgentProposalDispositionResult> {
  return resolveTikzAgentProposal({ ...options, outcome: 'committed-unverified' });
}

export function parseTikzAgentRunReplay(
  value: unknown,
  expectedRunId: string,
  afterSequence = -1,
): TikzAgentReplayResult {
  if (!boundedText(expectedRunId) || !Number.isSafeInteger(afterSequence) || afterSequence < -1) {
    throw new TikzAgentReplayError('invalid', 'Agent replay identity or cursor is invalid');
  }
  return parseReplay(value, expectedRunId, afterSequence);
}
