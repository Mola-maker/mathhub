import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';
import { chatCompletionsUrl } from '@/lib/provider/openai-chat-url';
import { isThinkingModelId } from '@/lib/provider/provider-models';

export type ModelProbeResult = {
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
};

async function probeAnthropic(cfg: EffectiveProvider, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  try {
    const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const ms = Date.now() - start;
    if (r.ok) return { ok: true, ms, status: r.status };
    return { ok: false, ms, status: r.status, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function probeOpenAICompatible(
  cfg: EffectiveProvider,
  model: string,
  provider: ProviderName,
): Promise<ModelProbeResult> {
  const start = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  };
  if (provider === 'dashscope' && !isThinkingModelId(model)) {
    body.enable_thinking = false;
  }
  try {
    const r = await fetch(chatCompletionsUrl(cfg.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const ms = Date.now() - start;
    if (r.ok) return { ok: true, ms, status: r.status };
    let detail = '';
    try {
      const j = await r.json() as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch { /* ignore */ }
    return { ok: false, ms, status: r.status, error: detail || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function probeCoze(cfg: EffectiveProvider): Promise<ModelProbeResult> {
  const start = Date.now();
  try {
    const r = await fetch(`${cfg.baseUrl}/v3/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: cfg.botId,
        user_id: 'math-studio-probe',
        stream: false,
        auto_save_history: false,
        additional_messages: [{
          role: 'user',
          content: 'ping',
          content_type: 'text',
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const ms = Date.now() - start;
    if (r.ok) return { ok: true, ms, status: r.status };
    return { ok: false, ms, status: r.status, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export async function probeProviderModel(
  provider: ProviderName,
  cfg: EffectiveProvider,
  model: string,
): Promise<ModelProbeResult> {
  if (!cfg.apiKey) return { ok: false, ms: 0, error: 'no api key' };
  if (cfg.protocol === 'anthropic') return probeAnthropic(cfg, model);
  if (cfg.protocol === 'coze') return probeCoze(cfg);
  return probeOpenAICompatible(cfg, model, provider);
}

/** Probe many models with bounded concurrency (cap list length for load time). */
export async function probeModelCatalog(
  provider: ProviderName,
  cfg: EffectiveProvider,
  modelIds: string[],
  concurrency = 3,
  maxProbe = 24,
): Promise<Record<string, ModelProbeResult>> {
  const ids = modelIds.slice(0, maxProbe);
  const out: Record<string, ModelProbeResult> = {};
  const queue = [...ids];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      out[id] = await probeProviderModel(provider, cfg, id);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length || 1) }, () => worker()),
  );
  return out;
}
