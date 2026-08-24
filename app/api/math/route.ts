import { NextRequest } from 'next/server';

import { checkRate } from '@/lib/rate-limit';
import { clientIp } from '@/lib/client-ip';
import {
  getEffectiveProvider,
  CLIENT_PROVIDER,
  type ProviderName,
} from '@/lib/provider/settings';
import { isSafeModelId } from '@/lib/provider/provider-models';
import {
  buildMathDrawingSystemPrompt,
  buildGgbRepairSystemPrompt,
  formatRepairUserContent,
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
import type { CommandFailure } from '@/lib/math/geometry-render/run-script';
import { makeSseStream, streamProvider } from '@/lib/llm/sse-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Provider = ProviderName;
type Message = { role: 'user' | 'assistant'; content: string };
type Mode = 'build' | 'repair' | 'narrate';

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
  if (rate.unavailable) {
    return new Response(JSON.stringify({ error: 'rate limiter unavailable' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      },
    });
  }
  if (!rate.allowed) {
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(rate.resetMs / 1000)) },
    });
  }

  const { provider } = body;
  if (provider !== CLIENT_PROVIDER) {
    return new Response('invalid provider', { status: 400 });
  }

  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) {
    return new Response(JSON.stringify({ error: 'provider not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const model = requestedModel || cfg.model;
  if (!isSafeModelId(model)) {
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

    return makeSseStream(async (send, sendEvent, signal) => {
      sendEvent({ model, mode });
      await streamProvider(
        provider,
        [{ role: 'user', content }],
        send,
        cfg,
        model,
        narratePrompt,
        { signal },
      );
    }, { signal: req.signal });
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

    return makeSseStream(async (send, sendEvent, signal) => {
      sendEvent({ model, mode });
      sendEvent({ ggbLookup: { count: ggbContext.commandNames.length, commands: ggbContext.commandNames } });
      const fullText = await streamProvider(provider, messages, send, cfg, model, prompt, { signal });
      // Pre-flight (hallucinated names → real commands, bare pair names →
      // segments), then reorder so every object is defined before use.
      const pre = preflightFix(parseGgbBlock(fullText));
      const fixed = reorderByDependencies(pre.commands);
      sendEvent({ ggbCommands: { count: fixed.length, commands: fixed, preflightFixes: pre.fixes } });
    }, { signal: req.signal });
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

  return makeSseStream(async (send, sendEvent, signal) => {
    sendEvent({ model, mode });
    sendEvent({ drawingCommand: activeCommand });
    sendEvent({
      ggbLookup: {
        count: ggbContext.commandNames.length,
        commands: ggbContext.commandNames,
        categories: ggbContext.categories,
      },
    });
    const fullText = await streamProvider(provider, messages, send, cfg, model, prompt, { signal });
    // Pre-flight (hallucinated names, bare pair names) + reorder so every
    // object is defined before use — both classes fixed with zero LLM cost.
    const pre = preflightFix(parseGgbBlock(fullText));
    const commands = reorderByDependencies(pre.commands);
    sendEvent({ ggbCommands: { count: commands.length, commands, preflightFixes: pre.fixes } });
  }, { signal: req.signal });
}
