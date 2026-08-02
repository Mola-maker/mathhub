import { chatCompletionsUrl } from '@/lib/provider/openai-chat-url';
import {
  extractDeliverableFromReasoning,
  REASONING_MODEL_FALLBACK_MSG,
  TIKZ_INSTEAD_OF_GGB_MSG,
  streamTextInChunks,
} from '@/lib/math/math-response-sanitize';
import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';
import { extractAiPatchProposal } from '@/lib/tikz/server/extract-ai-patch';

export type Message = { role: 'user' | 'assistant' | 'system'; content: string };

export type SendToken = (token: string) => void;
export type SendEvent = (event: Record<string, unknown>) => void;

const MAX_TOKENS = 6144;
const TIMEOUT_MS = 150_000;
const TIKZ_REASONING_FALLBACK_MSG =
  '思考型模型只输出了内部推理，未生成 TikZ 代码。请从 api.molamaker.cn 的实时模型列表中改用可输出正文的模型，或重试并要求返回 ```tikz 代码块。';
const TIKZ_PATCH_REASONING_FALLBACK_MSG =
  '思考型模型没有生成可验证的 ```tikz-patch 提案，请重试或改用能输出正文的模型。';

type ReasoningTarget = 'geogebra' | 'tikz' | 'tikz-patch';

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
  void provider;

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

  // The relay can expose thinking models under arbitrary ids, so reasoning-only
  // recovery must not depend on the old provider name.
  const reasoningFallback = true;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let sentContent = false;
  let finishReason = '';

  const processPayload = (rawPayload: string) => {
    const raw = rawPayload.trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        delta?: string;
        choices?: Array<{
          delta?: OpenAIDelta;
          message?: OpenAIDelta;
          text?: string;
          finish_reason?: string | null;
        }>;
      };
      const choice = parsed.choices?.[0];
      const delta = choice?.delta ?? choice?.message;
      const isFinalMessageSnapshot = !choice?.delta && Boolean(choice?.message);
      const outputTextDelta =
        parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string'
          ? parsed.delta
          : '';
      const upstreamText = openAIContentText(delta?.content) || choice?.text || outputTextDelta;
      let text = upstreamText;
      if (isFinalMessageSnapshot && content && upstreamText) {
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
        send(text);
        content += text;
        sentContent = true;
      } else {
        const reasoningText = delta?.reasoning_content || delta?.reasoning;
        if (reasoningText) reasoning += reasoningText;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    } catch {
      // Ignore keep-alives and non-JSON relay metadata.
    }
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

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    lines.forEach(processLine);
  }
  buf += dec.decode();
  if (buf.trim()) processLine(buf);

  if (!sentContent && reasoningFallback && reasoning.trim()) {
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
  options: { reasoningTarget?: ReasoningTarget } = {},
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
  );
}
