import type { Message } from '@/lib/llm/sse-stream';

export const MAX_TIKZ_HISTORY_MESSAGES = 6;
export const MAX_TIKZ_HISTORY_MESSAGE_CHARS = 3_000;
export const MAX_TIKZ_HISTORY_TOTAL_CHARS = 12_000;

type ConversationMessage = Pick<Message, 'role' | 'content'>;

function compactContent(content: string, limit: number): string {
  const normalized = content.trim();
  if (normalized.length <= limit) return normalized;
  if (limit < 96) return normalized.slice(-limit);
  const marker = '\n\n[…较早内容已压缩…]\n\n';
  const headLength = Math.min(720, Math.floor((limit - marker.length) / 3));
  const tailLength = Math.max(0, limit - marker.length - headLength);
  return `${normalized.slice(0, headLength)}${marker}${normalized.slice(-tailLength)}`;
}

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
  const maxMessages = Math.max(1, limits.maxMessages ?? MAX_TIKZ_HISTORY_MESSAGES);
  const maxMessageChars = Math.max(256, limits.maxMessageChars ?? MAX_TIKZ_HISTORY_MESSAGE_CHARS);
  let remaining = Math.max(maxMessageChars, limits.maxTotalChars ?? MAX_TIKZ_HISTORY_TOTAL_CHARS);
  const recent = input
    .filter((message) => (
      (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.trim().length > 0
    ))
    .slice(-maxMessages);
  const result: Message[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (remaining < 256) break;
    const message = recent[index]!;
    const content = compactContent(message.content, Math.min(maxMessageChars, remaining));
    if (!content) continue;
    result.unshift({ role: message.role, content });
    remaining -= content.length;
  }
  return result;
}
