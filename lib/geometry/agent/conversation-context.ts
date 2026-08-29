import type { Message } from '@/lib/llm/sse-stream';

export const GEOMETRY_AGENT_CONTEXT_CHECKPOINT_SCHEMA_VERSION =
  'geometry-agent-context-checkpoint/v1' as const;

export const MAX_GEOMETRY_CONTEXT_MESSAGES = 8;
export const MAX_GEOMETRY_CONTEXT_MESSAGE_CHARS = 3_500;
export const MAX_GEOMETRY_CONTEXT_TOTAL_CHARS = 18_000;

export type GeometryConversationLane = 'tikz' | 'geogebra';

export interface GeometryAgentContextBasis {
  readonly lane: GeometryConversationLane;
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly sourceId?: string;
  /** The service decides whether the basis was independently reconstructed. */
  readonly attestation: 'server-attested' | 'client-declared';
}

export type GeometryAgentContextLoss =
  | 'invalid-message-ignored'
  | 'older-dialogue-dropped'
  | 'message-prose-compacted'
  | 'structured-block-dropped'
  | 'revision-basis-unavailable';

export interface GeometryAgentContextCheckpoint {
  readonly schemaVersion: typeof GEOMETRY_AGENT_CONTEXT_CHECKPOINT_SCHEMA_VERSION;
  readonly lane: GeometryConversationLane;
  /** Conversation text can guide the Agent, but never becomes geometry truth. */
  readonly truthPolicy: 'current-source-projection-only';
  readonly summaryPromotedToTruth: false;
  readonly inputMessageCount: number;
  readonly eligibleMessageCount: number;
  readonly retainedMessageCount: number;
  readonly droppedMessageCount: number;
  readonly inputChars: number;
  readonly retainedChars: number;
  readonly compactedMessageCount: number;
  readonly droppedStructuredBlockCount: number;
  readonly loss: readonly GeometryAgentContextLoss[];
  /** Empty until a durable transcript store is introduced. Never invent one. */
  readonly restoreHandles: readonly string[];
  readonly basis?: GeometryAgentContextBasis;
}

export interface GeometryConversationContext {
  readonly messages: readonly Message[];
  readonly checkpoint: GeometryAgentContextCheckpoint;
}

export interface GeometryConversationContextLimits {
  readonly maxMessages?: number;
  readonly maxMessageChars?: number;
  readonly maxTotalChars?: number;
}

type ConversationMessage = Pick<Message, 'role' | 'content'>;

interface ProtectedRange {
  readonly start: number;
  readonly end: number;
}

interface CompactedContent {
  readonly content: string;
  readonly changed: boolean;
  readonly droppedStructuredBlocks: number;
}

const COMPACTION_MARKER = '\n\n[... earlier conversational prose compacted ...]\n\n';
const STRUCTURED_COMPACTION_MARKER =
  '\n\n[... earlier prose or complete structured blocks omitted ...]\n\n';
const COMPLETE_FENCE = /```[^\r\n`]*\r?\n[\s\S]*?```/gu;

function completeFenceRanges(content: string): ProtectedRange[] {
  return [...content.matchAll(COMPLETE_FENCE)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function containingRange(
  ranges: readonly ProtectedRange[],
  offset: number,
): ProtectedRange | undefined {
  return ranges.find((range) => offset > range.start && offset < range.end);
}

/**
 * Compact prose around fenced protocols without ever retaining half a fence.
 * A complete over-budget block is omitted as a unit; the Agent must recover
 * geometry from the current source projection, not from a damaged transcript.
 */
function compactContent(content: string, limit: number): CompactedContent {
  const normalized = content.trim();
  if (normalized.length <= limit) {
    return { content: normalized, changed: false, droppedStructuredBlocks: 0 };
  }
  if (limit < 128) {
    return {
      content: normalized.slice(-limit),
      changed: true,
      droppedStructuredBlocks: completeFenceRanges(normalized).length,
    };
  }

  const ranges = completeFenceRanges(normalized);
  const marker = ranges.length > 0
    ? STRUCTURED_COMPACTION_MARKER
    : COMPACTION_MARKER;
  const available = Math.max(0, limit - marker.length);
  let headEnd = Math.min(800, Math.floor(available / 3));
  let tailStart = Math.max(headEnd, normalized.length - (available - headEnd));

  const headFence = containingRange(ranges, headEnd);
  if (headFence) headEnd = headFence.start;
  const tailFence = containingRange(ranges, tailStart);
  if (tailFence) tailStart = tailFence.end;

  // Moving a boundary around a protected block only makes the result shorter,
  // but keep a final guard so future marker changes cannot violate the budget.
  const compacted = `${normalized.slice(0, headEnd)}${marker}${normalized.slice(tailStart)}`;
  const droppedStructuredBlocks = ranges.filter((range) => (
    range.start < tailStart && range.end > headEnd
  )).length;
  return {
    content: compacted,
    changed: true,
    droppedStructuredBlocks,
  };
}

function boundedBasisIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function isGeometryAgentContextBasis(
  value: unknown,
  lane?: GeometryConversationLane,
): value is GeometryAgentContextBasis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const basis = value as Partial<GeometryAgentContextBasis>;
  return (basis.lane === 'tikz' || basis.lane === 'geogebra')
    && (lane === undefined || basis.lane === lane)
    && boundedBasisIdentity(basis.documentId)
    && boundedBasisIdentity(basis.epoch)
    && Number.isSafeInteger(basis.revision)
    && (basis.revision ?? -1) >= 0
    && boundedBasisIdentity(basis.sourceHash)
    && (
      basis.sourceId === undefined
      || (
        boundedBasisIdentity(basis.sourceId)
      )
    )
    && (
      basis.attestation === 'server-attested'
      || basis.attestation === 'client-declared'
    );
}

export function isGeometryAgentContextCheckpoint(
  value: unknown,
): value is GeometryAgentContextCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Partial<GeometryAgentContextCheckpoint>;
  const losses: readonly GeometryAgentContextLoss[] = [
    'invalid-message-ignored',
    'older-dialogue-dropped',
    'message-prose-compacted',
    'structured-block-dropped',
    'revision-basis-unavailable',
  ];
  const counts = [
    checkpoint.inputMessageCount,
    checkpoint.eligibleMessageCount,
    checkpoint.retainedMessageCount,
    checkpoint.droppedMessageCount,
    checkpoint.inputChars,
    checkpoint.retainedChars,
    checkpoint.compactedMessageCount,
    checkpoint.droppedStructuredBlockCount,
  ];
  return checkpoint.schemaVersion === GEOMETRY_AGENT_CONTEXT_CHECKPOINT_SCHEMA_VERSION
    && (checkpoint.lane === 'tikz' || checkpoint.lane === 'geogebra')
    && checkpoint.truthPolicy === 'current-source-projection-only'
    && checkpoint.summaryPromotedToTruth === false
    && counts.every((count) => Number.isSafeInteger(count) && (count ?? -1) >= 0)
    && (checkpoint.eligibleMessageCount ?? 0) <= (checkpoint.inputMessageCount ?? -1)
    && (checkpoint.retainedMessageCount ?? 0) <= (checkpoint.eligibleMessageCount ?? -1)
    && checkpoint.droppedMessageCount
      === (checkpoint.eligibleMessageCount ?? -1) - (checkpoint.retainedMessageCount ?? -1)
    && (checkpoint.retainedChars ?? 0) <= (checkpoint.inputChars ?? -1)
    && (checkpoint.compactedMessageCount ?? 0) <= (checkpoint.retainedMessageCount ?? -1)
    && Array.isArray(checkpoint.loss)
    && checkpoint.loss.every((loss) => losses.includes(loss))
    && new Set(checkpoint.loss).size === checkpoint.loss.length
    && checkpoint.loss.includes('invalid-message-ignored')
      === ((checkpoint.eligibleMessageCount ?? -1) < (checkpoint.inputMessageCount ?? -1))
    && checkpoint.loss.includes('older-dialogue-dropped')
      === ((checkpoint.retainedMessageCount ?? -1) < (checkpoint.eligibleMessageCount ?? -1))
    && checkpoint.loss.includes('message-prose-compacted')
      === ((checkpoint.compactedMessageCount ?? 0) > 0)
    && checkpoint.loss.includes('structured-block-dropped')
      === ((checkpoint.droppedStructuredBlockCount ?? 0) > 0)
    && checkpoint.loss.includes('revision-basis-unavailable')
      === (checkpoint.basis === undefined)
    && Array.isArray(checkpoint.restoreHandles)
    && checkpoint.restoreHandles.length <= 16
    && checkpoint.restoreHandles.every((handle) => (
      typeof handle === 'string' && handle.length > 0 && handle.length <= 512
    ))
    && (
      checkpoint.basis === undefined
      || isGeometryAgentContextBasis(checkpoint.basis, checkpoint.lane)
    );
}

function validBasis(
  basis: GeometryAgentContextBasis | undefined,
  lane: GeometryConversationLane,
): GeometryAgentContextBasis | undefined {
  if (
    !isGeometryAgentContextBasis(basis, lane)
  ) return undefined;
  return { ...basis };
}

/**
 * Build a renderer-neutral, auditable conversation checkpoint.
 *
 * This is deliberately extractive rather than abstractive: it never asks a
 * model to summarize geometry, and its receipt explicitly prevents retained
 * prose from being promoted into the semantic kernel.
 */
export function compactGeometryConversationContext(
  input: readonly ConversationMessage[],
  options: GeometryConversationContextLimits & {
    readonly lane: GeometryConversationLane;
    readonly basis?: GeometryAgentContextBasis;
  },
): GeometryConversationContext {
  const maxMessages = Math.max(1, options.maxMessages ?? MAX_GEOMETRY_CONTEXT_MESSAGES);
  const maxMessageChars = Math.max(
    256,
    options.maxMessageChars ?? MAX_GEOMETRY_CONTEXT_MESSAGE_CHARS,
  );
  let remaining = Math.max(
    maxMessageChars,
    options.maxTotalChars ?? MAX_GEOMETRY_CONTEXT_TOTAL_CHARS,
  );
  const eligible = input.flatMap((message, index) => (
    (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && message.content.trim().length > 0
      ? [{ ...message, content: message.content.trim(), inputIndex: index }]
      : []
  ));
  const recent = eligible.slice(-maxMessages);
  const messages: Message[] = [];
  let compactedMessageCount = 0;
  let droppedStructuredBlockCount = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (remaining < 256) break;
    const message = recent[index]!;
    const compacted = compactContent(
      message.content,
      Math.min(maxMessageChars, remaining),
    );
    if (!compacted.content) continue;
    if (compacted.changed) compactedMessageCount += 1;
    droppedStructuredBlockCount += compacted.droppedStructuredBlocks;
    messages.unshift({ role: message.role, content: compacted.content });
    remaining -= compacted.content.length;
  }

  const basis = validBasis(options.basis, options.lane);
  const loss = new Set<GeometryAgentContextLoss>();
  if (eligible.length !== input.length) loss.add('invalid-message-ignored');
  if (messages.length < eligible.length) loss.add('older-dialogue-dropped');
  if (compactedMessageCount > 0) loss.add('message-prose-compacted');
  if (droppedStructuredBlockCount > 0) loss.add('structured-block-dropped');
  if (!basis) loss.add('revision-basis-unavailable');

  return {
    messages,
    checkpoint: {
      schemaVersion: GEOMETRY_AGENT_CONTEXT_CHECKPOINT_SCHEMA_VERSION,
      lane: options.lane,
      truthPolicy: 'current-source-projection-only',
      summaryPromotedToTruth: false,
      inputMessageCount: input.length,
      eligibleMessageCount: eligible.length,
      retainedMessageCount: messages.length,
      droppedMessageCount: Math.max(0, eligible.length - messages.length),
      inputChars: eligible.reduce((sum, message) => sum + message.content.length, 0),
      retainedChars: messages.reduce((sum, message) => sum + message.content.length, 0),
      compactedMessageCount,
      droppedStructuredBlockCount,
      loss: [...loss],
      restoreHandles: [],
      ...(basis ? { basis } : {}),
    },
  };
}
