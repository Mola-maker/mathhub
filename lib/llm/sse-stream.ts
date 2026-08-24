import { chatCompletionsUrl } from '@/lib/provider/openai-chat-url';
import {
  extractDeliverableFromReasoning,
  REASONING_MODEL_FALLBACK_MSG,
  TIKZ_INSTEAD_OF_GGB_MSG,
  streamTextInChunks,
} from '@/lib/math/math-response-sanitize';
import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';
import {
  providerTransportGate,
  recordProviderTransportFailure,
  recordProviderTransportSuccess,
} from '@/lib/provider/transport-health';
import { extractAiPatchProposal } from '@/lib/tikz/server/extract-ai-patch';

export type Message = { role: 'user' | 'assistant' | 'system'; content: string };

export interface ProviderTokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheMissTokens?: number;
}

export type SendToken = (token: string) => void;
export type SendEvent = (event: Record<string, unknown>) => void;

export interface SseStreamOptions {
  readonly signal?: AbortSignal;
  readonly maxEventBytes?: number;
  readonly maxTotalBytes?: number;
}

const MAX_TOKENS = 6144;
const TIMEOUT_MS = 150_000;
export const MAX_SSE_EVENT_BYTES = 60 * 1024;
export const MAX_SSE_TOTAL_BYTES = 512 * 1024;
const MAX_UPSTREAM_BYTES = 512 * 1024;
const MAX_UPSTREAM_LINE_CHARS = 64 * 1024;
const MAX_REASONING_CHARS = 128 * 1024;
const MAX_UPSTREAM_ERROR_BYTES = 8 * 1024;
export const EMPTY_VISIBLE_MODEL_OUTPUT =
  '模型未返回可展示的最终答复；内部推理不会被执行或写入画板，请重试。';
const TIKZ_REASONING_FALLBACK_MSG =
  '思考型模型只输出了内部推理，未生成 TikZ 代码。请从 api.molamaker.cn 的实时模型列表中改用可输出正文的模型，或重试并要求返回 ```tikz 代码块。';
const TIKZ_PATCH_REASONING_FALLBACK_MSG =
  '思考型模型没有生成可验证的 ```tikz-patch 提案，请重试或改用能输出正文的模型。';

type ReasoningTarget = 'geogebra' | 'tikz' | 'tikz-patch' | 'tikz-agent';

async function waitForProviderRetry(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, 180);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function extractTikzDeliverable(reasoning: string): string {
  const fenced = /```(?:tikz|latex|tex)\s*[\s\S]*?```/i.exec(reasoning)?.[0];
  if (fenced) {
    return fenced.replace(/^```(?:latex|tex)/i, '```tikz');
  }
  const bare = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/i.exec(
    reasoning,
  )?.[0];
  return bare ? `\`\`\`tikz\n${bare}\n\`\`\`` : '';
}

function extractTikzPatchDeliverable(reasoning: string): string {
  const extracted = extractAiPatchProposal(reasoning);
  return extracted.proposal
    ? `\`\`\`tikz-patch\n${JSON.stringify(extracted.proposal, null, 2)}\n\`\`\``
    : '';
}

export function makeSseStream(
  gen: (send: SendToken, sendEvent: SendEvent, signal: AbortSignal) => Promise<void>,
  options: SseStreamOptions = {},
): Response {
  const enc = new TextEncoder();
  const runController = new AbortController();
  const maxEventBytes = Math.max(1024, options.maxEventBytes ?? MAX_SSE_EVENT_BYTES);
  const maxTotalBytes = Math.max(maxEventBytes, options.maxTotalBytes ?? MAX_SSE_TOTAL_BYTES);
  let canceled = false;
  let totalBytes = 0;
  const abortFromCaller = () => runController.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string, enforceBudget = true) => {
        if (canceled || runController.signal.aborted) {
          throw new DOMException('SSE stream was canceled', 'AbortError');
        }
        const bytes = enc.encode(frame);
        if (enforceBudget && bytes.byteLength > maxEventBytes) {
          throw new RangeError(`SSE event exceeded ${maxEventBytes} byte limit`);
        }
        if (enforceBudget && totalBytes + bytes.byteLength > maxTotalBytes) {
          throw new RangeError(`SSE stream exceeded ${maxTotalBytes} byte limit`);
        }
        totalBytes += bytes.byteLength;
        controller.enqueue(bytes);
        if ((controller.desiredSize ?? 0) < -maxEventBytes) {
          throw new RangeError('SSE consumer fell behind the bounded queue');
        }
      };
      const send: SendToken = (token) => {
        enqueue(`data: ${JSON.stringify({ token })}\n\n`);
      };
      const sendEvent: SendEvent = (event) => {
        enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        await gen(send, sendEvent, runController.signal);
      } catch (e) {
        if (!runController.signal.aborted && !canceled) {
          const message = (e instanceof Error ? e.message : 'stream failed').slice(0, 400);
          try {
            enqueue(`data: ${JSON.stringify({ error: message })}\n\n`, false);
          } catch {
            runController.abort(e);
          }
        }
      } finally {
        options.signal?.removeEventListener('abort', abortFromCaller);
        // An aborted signal makes enqueue reject by design. Closing must be a
        // separate cleanup step; otherwise the thrown terminal-frame attempt
        // leaves response.text()/the browser reader hanging indefinitely.
        try {
          if (!canceled && !runController.signal.aborted) {
            enqueue('data: [DONE]\n\n', false);
          }
        } catch { /* terminal frame is best-effort */ }
        try {
          controller.close();
        } catch { /* already closed */ }
      }
    },
    cancel(reason) {
      canceled = true;
      runController.abort(reason);
      options.signal?.removeEventListener('abort', abortFromCaller);
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: MAX_SSE_EVENT_BYTES }));
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function readUpstreamError(r: Response): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remaining = MAX_UPSTREAM_ERROR_BYTES - total;
      if (remaining <= 0) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      const value = chunk.value.byteLength > remaining
        ? chunk.value.slice(0, remaining)
        : chunk.value;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (chunk.value.byteLength > remaining) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    text += decoder.decode();
    if (!text) return '';
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
      return (msg || text).slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  } finally {
    reader.releaseLock();
  }
}

type OpenAIContent = string | Array<{ type?: string; text?: string }>;
type OpenAIDelta = {
  content?: OpenAIContent;
  reasoning_content?: string;
  reasoning?: string;
};

function openAIContentText(content: OpenAIContent | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function finiteUsage(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Stream an OpenAI-compatible provider, recovering thinking-model output. */
export async function streamOpenAICompatible(
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  provider: ProviderName,
  label: string,
  systemPrompt: string,
  reasoningTarget: ReasoningTarget = 'geogebra',
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxTokens?: number;
    onUsage?: (usage: ProviderTokenUsage) => void;
  } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: Math.max(1, Math.min(MAX_TOKENS, options.maxTokens ?? MAX_TOKENS)),
  };
  void provider;

  const requestSignal = options.signal
    ? AbortSignal.any([
      options.signal,
      AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_MS, options.timeoutMs ?? TIMEOUT_MS))),
    ])
    : AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_MS, options.timeoutMs ?? TIMEOUT_MS)));
  const requestInit: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: requestSignal,
  };
  const initialGate = providerTransportGate(cfg.baseUrl);
  if (initialGate.status === 'open') {
    throw new Error(
      `${label} 上游连接暂不可用；连续传输失败后已暂停重试，约 ${Math.ceil(initialGate.retryAfterMs / 1_000)} 秒后自动恢复探测。`,
    );
  }
  let r: Response;
  try {
    r = await fetch(chatCompletionsUrl(cfg.baseUrl), requestInit);
    recordProviderTransportSuccess(cfg.baseUrl);
  } catch (error) {
    if (requestSignal.aborted) {
      if (!options.signal?.aborted) recordProviderTransportFailure(cfg.baseUrl);
      throw error;
    }
    recordProviderTransportFailure(cfg.baseUrl);
    await waitForProviderRetry(requestSignal);
    try {
      r = await fetch(chatCompletionsUrl(cfg.baseUrl), requestInit);
      recordProviderTransportSuccess(cfg.baseUrl);
    } catch (retryError) {
      if (requestSignal.aborted) {
        if (!options.signal?.aborted) recordProviderTransportFailure(cfg.baseUrl);
        throw retryError;
      }
      recordProviderTransportFailure(cfg.baseUrl);
      throw new Error(
        `${label} 上游连接失败：模型服务不可达，或当前服务器网络不允许访问该地址。`,
        { cause: retryError },
      );
    }
  }
  if (!r.ok || !r.body) {
    const detail = await readUpstreamError(r);
    throw new Error(`${label} ${r.status}${detail ? `：${detail}` : ''}`);
  }

  // The relay can expose thinking models under arbitrary ids, so reasoning-only
  // recovery must not depend on the old provider name.
  const reasoningFallback = true;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const contentChunks: string[] = [];
  const reasoningChunks: string[] = [];
  let contentChars = 0;
  let reasoningChars = 0;
  let upstreamBytes = 0;
  let sentContent = false;
  let finishReason = '';

  const processPayload = (rawPayload: string) => {
    const raw = rawPayload.trim();
    if (!raw || raw === '[DONE]') return;
    let parsed: {
      type?: string;
      delta?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      choices?: Array<{
        delta?: OpenAIDelta;
        message?: OpenAIDelta;
        text?: string;
        finish_reason?: string | null;
      }>;
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      // Ignore keep-alives and non-JSON relay metadata.
      return;
    }
    const usage = parsed.usage;
    if (usage) {
      options.onUsage?.({
        ...(finiteUsage(usage.prompt_tokens) ? { promptTokens: usage.prompt_tokens } : {}),
        ...(finiteUsage(usage.completion_tokens) ? { completionTokens: usage.completion_tokens } : {}),
        ...(finiteUsage(usage.total_tokens) ? { totalTokens: usage.total_tokens } : {}),
        ...(finiteUsage(usage.prompt_cache_hit_tokens)
          ? { cacheReadTokens: usage.prompt_cache_hit_tokens }
          : finiteUsage(usage.prompt_tokens_details?.cached_tokens)
            ? { cacheReadTokens: usage.prompt_tokens_details?.cached_tokens }
            : {}),
        ...(finiteUsage(usage.prompt_cache_miss_tokens)
          ? { cacheMissTokens: usage.prompt_cache_miss_tokens }
          : {}),
      });
    }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta ?? choice?.message;
    const isFinalMessageSnapshot = !choice?.delta && Boolean(choice?.message);
    const outputTextDelta =
      parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string'
        ? parsed.delta
        : '';
    const upstreamText = openAIContentText(delta?.content) || choice?.text || outputTextDelta;
    let text = upstreamText;
    if (isFinalMessageSnapshot && contentChars > 0 && upstreamText) {
      const content = contentChunks.join('');
      // Some OpenAI-compatible relays stream normal deltas and then send a
      // final `message.content` snapshot containing the complete answer.
      // Treat that frame as reconciliation, not as one more delta.
      if (upstreamText === content || content.endsWith(upstreamText)) {
        text = '';
      } else if (upstreamText.startsWith(content)) {
        text = upstreamText.slice(content.length);
      }
    }
    if (text) {
      if (contentChars + text.length > MAX_UPSTREAM_BYTES) {
        throw new RangeError('Provider visible output exceeded its bounded payload.');
      }
      send(text);
      contentChunks.push(text);
      contentChars += text.length;
      sentContent = true;
    } else {
      const reasoningText = delta?.reasoning_content || delta?.reasoning;
      if (reasoningText) {
        if (reasoningChars + reasoningText.length > MAX_REASONING_CHARS) {
          throw new RangeError('Provider reasoning output exceeded its bounded payload.');
        }
        reasoningChunks.push(reasoningText);
        reasoningChars += reasoningText.length;
      }
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  };

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (trimmed.startsWith('data:')) {
      processPayload(trimmed.slice(5));
    } else if (trimmed.startsWith('{')) {
      // Some OpenAI-compatible relays return one JSON object despite stream=true.
      processPayload(trimmed);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      upstreamBytes += value.byteLength;
      if (upstreamBytes > MAX_UPSTREAM_BYTES) {
        throw new RangeError('Provider stream exceeded its byte budget.');
      }
      buf += dec.decode(value, { stream: true });
      if (buf.length > MAX_UPSTREAM_LINE_CHARS && !/[\r\n]/u.test(buf)) {
        throw new RangeError('Provider stream contained an oversized line.');
      }
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      lines.forEach(processLine);
    }
    buf += dec.decode();
    if (buf.trim()) processLine(buf);
  } finally {
    if (!options.signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const content = contentChunks.join('');
  const reasoning = reasoningChunks.join('');

  if (!sentContent && reasoningFallback && reasoning.trim()) {
    if (reasoningTarget === 'tikz-agent') {
      // `reasoning_content` is an internal model channel, never an action or
      // final-answer channel. Tentative actions here have no write authority.
      const recovered = EMPTY_VISIBLE_MODEL_OUTPUT;
      return recovered;
    }
    if (reasoningTarget === 'tikz-patch') {
      const patch = extractTikzPatchDeliverable(reasoning);
      const recovered = patch || TIKZ_PATCH_REASONING_FALLBACK_MSG;
      await streamTextInChunks(send, recovered);
      return recovered;
    }
    if (reasoningTarget === 'tikz') {
      const tikz = extractTikzDeliverable(reasoning);
      const recovered = tikz || TIKZ_REASONING_FALLBACK_MSG;
      await streamTextInChunks(send, recovered);
      return recovered;
    }
    const deliverable = extractDeliverableFromReasoning(reasoning);
    if (deliverable.text) {
      await streamTextInChunks(send, deliverable.text);
      return deliverable.text;
    }
    const msg = deliverable.hasTikz ? TIKZ_INSTEAD_OF_GGB_MSG : REASONING_MODEL_FALLBACK_MSG;
    await streamTextInChunks(send, msg);
    return msg;
  }

  if (!content.trim()) {
    throw new Error(`${label}: empty stream${finishReason ? ` (${finishReason})` : ''}`);
  }
  return content;
}

export async function streamProvider(
  provider: ProviderName,
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  systemPrompt: string,
  options: {
    reasoningTarget?: ReasoningTarget;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxTokens?: number;
    onUsage?: (usage: ProviderTokenUsage) => void;
  } = {},
): Promise<string> {
  return streamOpenAICompatible(
    messages,
    send,
    cfg,
    model,
    provider,
    'api.molamaker.cn',
    systemPrompt,
    options.reasoningTarget,
    options,
  );
}
