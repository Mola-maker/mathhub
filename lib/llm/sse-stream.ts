import { chatCompletionsUrl } from '@/lib/provider/openai-chat-url';
import { isThinkingModelId } from '@/lib/provider/provider-models';
import {
  extractDeliverableFromReasoning,
  REASONING_MODEL_FALLBACK_MSG,
  TIKZ_INSTEAD_OF_GGB_MSG,
  streamTextInChunks,
} from '@/lib/math/math-response-sanitize';
import { cozeMathUserContent } from '@/lib/math/math-system-prompt';
import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';

export type Message = { role: 'user' | 'assistant' | 'system'; content: string };

export type SendToken = (token: string) => void;
export type SendEvent = (event: Record<string, unknown>) => void;

const MAX_TOKENS = 6144;
const TIMEOUT_MS = 150_000;

export function makeSseStream(gen: (send: SendToken, sendEvent: SendEvent) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SendToken = (token) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ token })}\n\n`)); }
        catch { /* client disconnected */ }
      };
      const sendEvent: SendEvent = (event) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { /* client disconnected */ }
      };
      try {
        await gen(send, sendEvent);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'stream failed';
        try { sendEvent({ error: message }); } catch { /* client gone */ }
      } finally {
        try {
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function readUpstreamError(r: Response): Promise<string> {
  try {
    const text = await r.text();
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
  }
}

export async function streamAnthropic(
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  systemPrompt: string,
): Promise<string> {
  const r = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': cfg.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok || !r.body) {
    const detail = await readUpstreamError(r);
    throw new Error(`Anthropic ${r.status}${detail ? `：${detail}` : ''}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (raw === '[DONE]') continue;
      try {
        const j = JSON.parse(raw) as { type?: string; delta?: { type?: string; text?: string } };
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
          send(j.delta.text);
          full += j.delta.text;
        }
      } catch { /* skip */ }
    }
  }
  if (!full.trim()) throw new Error('Anthropic: empty stream');
  return full;
}

type OpenAIDelta = { content?: string; reasoning_content?: string };

/** Stream an OpenAI-compatible provider, recovering thinking-model output. */
export async function streamOpenAICompatible(
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  provider: ProviderName,
  label: string,
  systemPrompt: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    stream: true,
    max_tokens: MAX_TOKENS,
  };
  if (provider === 'dashscope' && !isThinkingModelId(model)) {
    body.enable_thinking = false;
  }

  const r = await fetch(chatCompletionsUrl(cfg.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok || !r.body) {
    const detail = await readUpstreamError(r);
    throw new Error(`${label} ${r.status}${detail ? `：${detail}` : ''}`);
  }

  const reasoningFallback = provider === 'dashscope' || provider === 'deepseek';
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let sentContent = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (raw === '[DONE]') continue;
      try {
        const j = JSON.parse(raw) as { choices?: Array<{ delta?: OpenAIDelta }> };
        const delta = j.choices?.[0]?.delta;
        if (!delta) continue;
        // Stream content verbatim; the client strips reasoning/TikZ for DISPLAY
        // (assistantDisplayText) and parses the ```geogebra block from the full text.
        if (delta.content) {
          send(delta.content);
          content += delta.content;
          sentContent = true;
        } else if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
        }
      } catch { /* skip */ }
    }
  }

  if (!sentContent && reasoningFallback && reasoning.trim()) {
    const deliverable = extractDeliverableFromReasoning(reasoning);
    if (deliverable.text) {
      await streamTextInChunks(send, deliverable.text);
      return deliverable.text;
    }
    const msg = deliverable.hasTikz ? TIKZ_INSTEAD_OF_GGB_MSG : REASONING_MODEL_FALLBACK_MSG;
    await streamTextInChunks(send, msg);
    return msg;
  }

  if (!content.trim()) throw new Error(`${label}: empty stream`);
  return content;
}

export async function streamCoze(
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  systemPrompt: string,
): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const problem = lastUser?.content ?? '';
  const r = await fetch(`${cfg.baseUrl}/v3/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot_id: cfg.botId,
      user_id: 'math-studio',
      stream: true,
      auto_save_history: false,
      additional_messages: [{ role: 'user', content: cozeMathUserContent(problem, systemPrompt), content_type: 'text' }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok || !r.body) {
    const detail = await readUpstreamError(r);
    throw new Error(`Coze ${r.status}${detail ? `：${detail}` : ''}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const lines = part.split('\n');
      const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (event === 'done') return full;
      if (event !== 'conversation.message.delta' || !dataLine) continue;
      const raw = dataLine.slice(5).trim();
      try {
        const j = JSON.parse(raw) as { role?: string; type?: string; content?: string };
        if (j.role === 'assistant' && j.type === 'answer' && j.content) {
          send(j.content);
          full += j.content;
        }
      } catch { /* skip */ }
    }
  }
  if (!full.trim()) throw new Error('Coze: empty stream');
  return full;
}

export async function streamProvider(
  provider: ProviderName,
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  systemPrompt: string,
): Promise<string> {
  if (cfg.protocol === 'anthropic') return streamAnthropic(messages, send, cfg, model, systemPrompt);
  if (cfg.protocol === 'coze') return streamCoze(messages, send, cfg, systemPrompt);
  const label = provider === 'deepseek' ? 'DeepSeek' : provider === 'dashscope' ? 'DashScope' : 'Anthropic';
  return streamOpenAICompatible(messages, send, cfg, model, provider, label, systemPrompt);
}
