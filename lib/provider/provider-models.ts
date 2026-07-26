import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';
import { DASHSCOPE_MODEL_CATALOG } from '@/lib/provider/dashscope-models';

export type ProviderModelEntry = {
  id: string;
  label: string;
  ownedBy?: string;
};

const CHAT_SKIP = /embed|embedding|whisper|tts|dall-e|davinci|moderation|realtime|transcribe|speech|ocr|image|vision-pro|inpaint|sora|flux|wanx|text-to-|audio-/i;

/** Heuristic: keep chat / reasoning models, drop embeddings & media APIs. */
export function isLikelyChatModel(id: string): boolean {
  const s = id.trim();
  if (!s || s.length > 128) return false;
  if (CHAT_SKIP.test(s)) return false;
  return /^[a-zA-Z0-9._\-:/]+$/.test(s);
}

function modelsListUrl(baseUrl: string): string {
  let b = (baseUrl || '').trim().replace(/\/+$/, '');
  b = b.replace(/\/chat\/completions$/, '');
  if (/\/v1$/.test(b)) return `${b}/models`;
  return `${b}/v1/models`;
}

async function fetchOpenAICompatibleModels(cfg: EffectiveProvider): Promise<ProviderModelEntry[]> {
  const r = await fetch(modelsListUrl(cfg.baseUrl), {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`models HTTP ${r.status}`);
  const j = await r.json() as { data?: Array<{ id?: string; owned_by?: string }> };
  const rows = j.data ?? [];
  return rows
    .map((row) => ({
      id: String(row.id ?? '').trim(),
      label: String(row.id ?? '').trim(),
      ownedBy: row.owned_by,
    }))
    .filter((m) => m.id && isLikelyChatModel(m.id));
}

async function fetchAnthropicModels(cfg: EffectiveProvider): Promise<ProviderModelEntry[]> {
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const r = await fetch(`${base}/v1/models`, {
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`models HTTP ${r.status}`);
  const j = await r.json() as { data?: Array<{ id?: string; display_name?: string }> };
  return (j.data ?? [])
    .map((row) => ({
      id: String(row.id ?? '').trim(),
      label: String(row.display_name ?? row.id ?? '').trim(),
    }))
    .filter((m) => m.id && isLikelyChatModel(m.id));
}

function staticFallback(name: ProviderName, cfg: EffectiveProvider): ProviderModelEntry[] {
  switch (name) {
    case 'anthropic':
      return [
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
        { id: cfg.model, label: cfg.model },
      ].filter((m, i, a) => m.id && a.findIndex((x) => x.id === m.id) === i);
    case 'deepseek':
      return [
        { id: 'deepseek-chat', label: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
        { id: cfg.model, label: cfg.model },
      ].filter((m, i, a) => m.id && a.findIndex((x) => x.id === m.id) === i);
    case 'dashscope':
      return [
        ...DASHSCOPE_MODEL_CATALOG.map((m) => ({ id: m.id, label: m.label })),
        ...(cfg.model ? [{ id: cfg.model, label: `${cfg.model} (configured)` }] : []),
      ].filter((m, i, a) => m.id && a.findIndex((x) => x.id === m.id) === i);
    case 'coze':
      return cfg.botId
        ? [{ id: cfg.botId, label: `Coze Bot ${cfg.botId.slice(0, 8)}…` }]
        : [];
    default:
      return [];
  }
}

/** Fetch model ids from the provider API; fall back to a small static list. */
export async function listProviderModels(
  name: ProviderName,
  cfg: EffectiveProvider,
): Promise<{ models: ProviderModelEntry[]; source: 'api' | 'fallback'; error?: string }> {
  if (!cfg.configured) {
    return { models: [], source: 'fallback', error: 'not configured' };
  }
  try {
    if (cfg.protocol === 'coze') {
      const models = staticFallback('coze', cfg);
      return { models, source: 'api' };
    }
    if (cfg.protocol === 'anthropic') {
      const models = await fetchAnthropicModels(cfg);
      if (models.length) return { models: dedupeModels(models), source: 'api' };
    } else {
      const models = await fetchOpenAICompatibleModels(cfg);
      if (models.length) return { models: dedupeModels(models), source: 'api' };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return {
      models: dedupeModels(staticFallback(name, cfg)),
      source: 'fallback',
      error: msg,
    };
  }
  return {
    models: dedupeModels(staticFallback(name, cfg)),
    source: 'fallback',
    error: 'empty model list',
  };
}

function dedupeModels(models: ProviderModelEntry[]): ProviderModelEntry[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (!m.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/** Prefer configured default, then first probe-ok, else first entry. */
export function pickDefaultModel(
  models: ProviderModelEntry[],
  configured: string,
  probe: Record<string, { ok: boolean }>,
): string {
  const cfg = configured.trim();
  if (cfg && models.some((m) => m.id === cfg) && probe[cfg]?.ok !== false) return cfg;
  const ok = models.find((m) => probe[m.id]?.ok);
  if (ok) return ok.id;
  return models[0]?.id ?? cfg;
}

export function isThinkingModelId(id: string): boolean {
  return /qwq|r1|reasoner|thinking|qwen3-/i.test(id);
}

export function isSafeModelId(id: string): boolean {
  return !!id && id.length <= 128 && /^[a-zA-Z0-9._\-:/]+$/.test(id);
}
