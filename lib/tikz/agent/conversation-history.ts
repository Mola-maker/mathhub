import type { Message } from '@/lib/llm/sse-stream';
import { compactGeometryConversationContext } from '@/lib/geometry/agent/conversation-context';

export const MAX_TIKZ_HISTORY_MESSAGES = 6;
export const MAX_TIKZ_HISTORY_MESSAGE_CHARS = 3_000;
export const MAX_TIKZ_HISTORY_TOTAL_CHARS = 12_000;

type ConversationMessage = Pick<Message, 'role' | 'content'>;

/**
 * Keep the recent dialogue useful without replaying whole long-form geometry
 * explanations on every turn. The newest intent and the actionable tail of an
 * assistant clarification are retained; UI artifacts are removed before this
 * helper is called.
 */
export function compactTikzConversationHistory(
  input: readonly ConversationMessage[],
  limits: {
    readonly maxMessages?: number;
    readonly maxMessageChars?: number;
    readonly maxTotalChars?: number;
  } = {},
): Message[] {
  return [...compactGeometryConversationContext(input, {
    lane: 'tikz',
    maxMessages: limits.maxMessages ?? MAX_TIKZ_HISTORY_MESSAGES,
    maxMessageChars: limits.maxMessageChars ?? MAX_TIKZ_HISTORY_MESSAGE_CHARS,
    maxTotalChars: limits.maxTotalChars ?? MAX_TIKZ_HISTORY_TOTAL_CHARS,
  }).messages];
}
