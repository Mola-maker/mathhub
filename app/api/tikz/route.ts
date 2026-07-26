import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { makeSseStream, streamProvider, type Message } from '@/lib/llm/sse-stream';
import { getEffectiveProvider, PROVIDER_NAMES, type ProviderName } from '@/lib/provider/settings';
import { checkRate } from '@/lib/rate-limit';
import { buildTikzRepairPrompt, buildTikzSystemPrompt } from '@/lib/tikz/prompt/tikz-system-prompt';
import { detectPreviewOnly, extractTikzBlock, sanitizeTikz } from '@/lib/tikz/server/extract-tikz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TikzRequest {
  mode?: 'build' | 'repair';
  problem?: string;
  history?: Array<{ role?: string; content?: string }>;
  provider?: string;
  model?: string;
  tikzCode?: string;
  failures?: string[];
  sceneSnapshot?: string;
  contextRefs?: string[];
}

const MAX_PROBLEM_LENGTH = 12_000;
const MAX_CODE_LENGTH = 128_000;
const MAX_FAILURES = 24;

function jsonError(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

function normalizedHistory(history: TikzRequest['history']): Message[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-8)
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content!.slice(0, MAX_PROBLEM_LENGTH),
    }));
}

function emitCode(full: string, sendEvent: (event: Record<string, unknown>) => void): void {
  const raw = extractTikzBlock(full);
  if (!raw) {
    sendEvent({ error: '模型输出中未找到 ```tikz 代码块，请重试或换个说法' });
    return;
  }
  const { code, stripped } = sanitizeTikz(raw);
  sendEvent({
    tikzCode: code,
    previewOnly: detectPreviewOnly(code),
    stripped,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: TikzRequest;
  try {
    body = (await req.json()) as TikzRequest;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  if (body.mode !== 'build' && body.mode !== 'repair') {
    return jsonError('mode 必须是 build 或 repair', 400);
  }

  const provider = (body.provider ?? 'anthropic') as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) return jsonError('未知 provider', 400);

  const ip = await clientIp();
  const rate = await checkRate(`math-tikz:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return jsonError('请求太频繁，请稍后再试', 429, {
      'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
    });
  }

  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) return jsonError(`provider ${provider} 未配置密钥`, 400);
  const model = body.model?.trim() || cfg.model;

  if (body.mode === 'repair') {
    if (typeof body.tikzCode !== 'string' || !Array.isArray(body.failures)) {
      return jsonError('repair 缺少 tikzCode/failures', 400);
    }
    if (!body.tikzCode.trim() || body.tikzCode.length > MAX_CODE_LENGTH) {
      return jsonError('tikzCode 为空或过长', 400);
    }
    const failures = body.failures
      .filter((failure): failure is string => typeof failure === 'string')
      .slice(0, MAX_FAILURES)
      .map((failure) => failure.slice(0, 2_000));
    if (failures.length === 0) return jsonError('repair 缺少有效 failures', 400);

    const system = buildTikzRepairPrompt(
      body.tikzCode,
      failures,
      typeof body.sceneSnapshot === 'string' ? body.sceneSnapshot.slice(0, MAX_CODE_LENGTH) : '',
    );
    const messages: Message[] = [{ role: 'user', content: '请修复上面的代码。' }];
    return makeSseStream(async (send, sendEvent) => {
      sendEvent({ model });
      const full = await streamProvider(provider, messages, send, cfg, model, system);
      emitCode(full, sendEvent);
    });
  }

  const problem = body.problem?.trim();
  if (!problem) return jsonError('缺少 problem', 400);
  if (problem.length > MAX_PROBLEM_LENGTH) return jsonError('problem 过长', 400);
  if (body.tikzCode && body.tikzCode.length > MAX_CODE_LENGTH) {
    return jsonError('tikzCode 过长', 400);
  }

  const system = buildTikzSystemPrompt(problem, {
    previousCode: typeof body.tikzCode === 'string' ? body.tikzCode : undefined,
  });
  const messages: Message[] = [
    ...normalizedHistory(body.history),
    { role: 'user', content: problem },
  ];
  return makeSseStream(async (send, sendEvent) => {
    sendEvent({ model });
    const full = await streamProvider(provider, messages, send, cfg, model, system);
    emitCode(full, sendEvent);
  });
}

