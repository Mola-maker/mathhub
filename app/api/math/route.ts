import { NextRequest } from 'next/server';

import { checkRate } from '@/lib/rate-limit';
import { clientIp } from '@/lib/client-ip';
import {
  getEffectiveProvider,
  PROVIDER_NAMES,
  type EffectiveProvider,
  type ProviderName,
} from '@/lib/provider/settings';
import { chatCompletionsUrl } from '@/lib/provider/openai-chat-url';
import { isSafeModelId, isThinkingModelId } from '@/lib/provider/provider-models';
import {
  buildMathDrawingSystemPrompt,
  buildGgbRepairSystemPrompt,
  formatRepairUserContent,
  cozeMathUserContent,
} from '@/lib/math/math-system-prompt';
import { augmentUserMessageForModel } from '@/lib/math/geogebra-chat';
import { parseGgbBlock } from '@/lib/math/geogebra-commands';
import { reorderByDependencies } from '@/lib/math/geometry-render/reorder';
import { preflightFix } from '@/lib/math/geometry-render/preflight';
import {
  parseStudioInput,
  isDrawingCommand,
  commandUsesContinuationCanvas,
  type DrawingCommand,
} from '@/lib/math/math-drawing/commands';
import {
  isContinuationRequest,
  extractLastGgbCommandsFromHistory,
} from '@/lib/math/math-continuation';
import {
  extractDeliverableFromReasoning,
  REASONING_MODEL_FALLBACK_MSG,
  TIKZ_INSTEAD_OF_GGB_MSG,
  streamTextInChunks,
} from '@/lib/math/math-response-sanitize';
import type { CommandFailure } from '@/lib/math/geometry-render/run-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Provider = ProviderName;
type Message = { role: 'user' | 'assistant'; content: string };
type Mode = 'build' | 'repair' | 'narrate';

const MAX_TOKENS = 6144;
const TIMEOUT_MS = 150_000;

type SendToken = (token: string) => void;
type SendEvent = (event: Record<string, unknown>) => void;

function makeSseStream(gen: (send: SendToken, sendEvent: SendEvent) => Promise<void>): Response {
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

function resolveDrawingCommand(raw: string | undefined, problemText: string): DrawingCommand {
  if (raw && isDrawingCommand(raw)) return raw;
  const parsed = parseStudioInput(problemText);
  if (parsed.kind === 'drawing' || parsed.kind === 'plain') return parsed.command;
  return 'draw';
}

function buildApiMessages(problem: string, history: Message[], drawingCommand: DrawingCommand): Message[] {
  const hist = (Array.isArray(history) ? history : []).slice(-16);
  const augmented = hist.map((m) => {
    if (m.role !== 'user') return m;
    const parsed = parseStudioInput(m.content);
    const cmd = parsed.kind === 'meta' ? 'draw' : parsed.command;
    const text = parsed.kind === 'meta' ? m.content : (parsed.body || m.content);
    return { role: m.role, content: augmentUserMessageForModel(text, cmd) };
  });
  const trimmed = problem.trim();
  const last = augmented[augmented.length - 1];
  if (trimmed && (!last || last.role !== 'user' || !last.content.includes(trimmed.slice(0, 60)))) {
    augmented.push({ role: 'user', content: augmentUserMessageForModel(trimmed, drawingCommand) });
  }
  return augmented;
}

async function streamAnthropic(
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
async function streamOpenAICompatible(
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  provider: Provider,
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

async function streamCoze(
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

async function streamProvider(
  provider: Provider,
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

export async function POST(req: NextRequest) {
  let body: {
    mode?: Mode;
    problem?: string;
    history?: Message[];
    drawingCommand?: string;
    previousGgbCommands?: string[];
    commands?: string[];
    /** construction-step protocol lines for narrate mode */
    steps?: string[];
    failures?: CommandFailure[];
    /** live canvas snapshot lines ("A: point @ (1, 2)") for state-aware repair */
    canvasState?: string[];
    provider: Provider;
    model?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const mode: Mode = body.mode === 'repair' ? 'repair' : body.mode === 'narrate' ? 'narrate' : 'build';

  // Build is the user action (20/min). Repairs are bounded (≤2) follow-ups to a
  // build that already passed the limit, so they get a roomier separate bucket.
  const ip = await clientIp();
  const rate = mode === 'repair'
    ? await checkRate(`math-repair:${ip}`, 40, 60_000)
    : await checkRate(`math:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(rate.resetMs / 1000)) },
    });
  }

  const { provider } = body;
  if (!PROVIDER_NAMES.includes(provider)) {
    return new Response('invalid provider', { status: 400 });
  }

  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) {
    return new Response(JSON.stringify({ error: 'provider not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const model = provider === 'coze' ? cfg.botId : (requestedModel || cfg.model);
  if (provider !== 'coze' && !isSafeModelId(model)) {
    return new Response(JSON.stringify({ error: 'invalid model' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const history = Array.isArray(body.history) ? body.history : [];

  // ── NARRATE: worded 讲解 of the construction protocol ────────────────────
  if (mode === 'narrate') {
    const steps = Array.isArray(body.steps)
      ? body.steps.filter((x) => typeof x === 'string' && x.trim()).slice(0, 60)
      : [];
    const problem = (body.problem ?? '').trim();
    if (steps.length === 0) return new Response('steps required', { status: 400 });

    const narratePrompt =
      'You are the Math Studio explainer. Given a geometry problem and the exact ' +
      'compass-and-straightedge construction protocol that was used to draw its figure, write a clear, ' +
      'rigorous walkthrough in Chinese (中文), formatted as Markdown with KaTeX math ($...$). Structure: ' +
      '一、作图思路 (why the construction works, 2-4 sentences); 二、作图步骤 (each protocol step restated ' +
      'precisely with the geometric fact it relies on); 三、关键结论 (what the figure now demonstrates, with ' +
      'the relevant theorems named). Never output code blocks or GeoGebra commands — prose and math only.';
    const content = `题目：\n${problem || '（未提供题面，按作图本身讲解）'}\n\n作图步骤：\n${steps.join('\n')}`;

    return makeSseStream(async (send, sendEvent) => {
      sendEvent({ model: provider === 'coze' ? `coze:${cfg.botId}` : model, mode });
      await streamProvider(provider, [{ role: 'user', content }], send, cfg, model, narratePrompt);
    });
  }

  // ── REPAIR ───────────────────────────────────────────────────────────────
  if (mode === 'repair') {
    const commands = Array.isArray(body.commands)
      ? body.commands.filter((c) => typeof c === 'string' && c.trim())
      : [];
    const failures = Array.isArray(body.failures)
      ? body.failures.filter((f) => f && typeof f.cmd === 'string' && typeof f.error === 'string')
      : [];
    if (commands.length === 0 || failures.length === 0) {
      return new Response('commands and failures required for repair', { status: 400 });
    }
    const drawingCommand = resolveDrawingCommand(body.drawingCommand, body.problem ?? '');
    const { prompt, ggbContext } = buildGgbRepairSystemPrompt(
      (body.problem ?? commands.join('\n')).trim(),
      drawingCommand,
    );
    const canvasState = Array.isArray(body.canvasState)
      ? body.canvasState.filter((l) => typeof l === 'string' && l.trim()).slice(0, 48)
      : undefined;
    const messages: Message[] = [{ role: 'user', content: formatRepairUserContent(commands, failures, canvasState) }];

    return makeSseStream(async (send, sendEvent) => {
      sendEvent({ model: provider === 'coze' ? `coze:${cfg.botId}` : model, mode });
      sendEvent({ ggbLookup: { count: ggbContext.commandNames.length, commands: ggbContext.commandNames } });
      const fullText = await streamProvider(provider, messages, send, cfg, model, prompt);
      // Pre-flight (hallucinated names → real commands, bare pair names →
      // segments), then reorder so every object is defined before use.
      const pre = preflightFix(parseGgbBlock(fullText));
      const fixed = reorderByDependencies(pre.commands);
      sendEvent({ ggbCommands: { count: fixed.length, commands: fixed, preflightFixes: pre.fixes } });
    });
  }

  // ── BUILD ────────────────────────────────────────────────────────────────
  const drawingCommand = resolveDrawingCommand(body.drawingCommand, body.problem ?? '');
  let problemText = (body.problem ?? '').trim();
  if (!problemText) {
    if (drawingCommand === 'continue') problemText = '请完善并补全当前画布上的几何作图。';
    else return new Response('problem required', { status: 400 });
  }

  const continueDrawing = commandUsesContinuationCanvas(drawingCommand)
    || isContinuationRequest(problemText, history.slice(0, -1));
  const previousFromClient = Array.isArray(body.previousGgbCommands)
    ? body.previousGgbCommands.filter((c) => typeof c === 'string' && c.trim())
    : [];
  const previousGgbCommands = previousFromClient.length > 0
    ? previousFromClient
    : (continueDrawing ? extractLastGgbCommandsFromHistory(history.slice(0, -1)) : []);

  const lookupText = [problemText, ...history.filter((m) => m.role === 'user').map((m) => m.content)].join('\n');
  const { prompt, ggbContext, drawingCommand: activeCommand } = buildMathDrawingSystemPrompt(lookupText, {
    drawingCommand,
    previousGgbCommands,
  });
  const messages = buildApiMessages(problemText, history, activeCommand);

  return makeSseStream(async (send, sendEvent) => {
    sendEvent({ model: provider === 'coze' ? `coze:${cfg.botId}` : model, mode });
    sendEvent({ drawingCommand: activeCommand });
    sendEvent({
      ggbLookup: {
        count: ggbContext.commandNames.length,
        commands: ggbContext.commandNames,
        categories: ggbContext.categories,
      },
    });
    const fullText = await streamProvider(provider, messages, send, cfg, model, prompt);
    // Pre-flight (hallucinated names, bare pair names) + reorder so every
    // object is defined before use — both classes fixed with zero LLM cost.
    const pre = preflightFix(parseGgbBlock(fullText));
    const commands = reorderByDependencies(pre.commands);
    sendEvent({ ggbCommands: { count: commands.length, commands, preflightFixes: pre.fixes } });
  });
}
