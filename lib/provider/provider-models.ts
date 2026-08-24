import type { EffectiveProvider, ProviderName } from '@/lib/provider/settings';
import {
  providerTransportGate,
  recordProviderTransportFailure,
  recordProviderTransportSuccess,
} from '@/lib/provider/transport-health';

export type ProviderModelEntry = {
  id: string;
  label: string;
  ownedBy?: string;
};

export type ProviderModelSource =
  | 'api'
  | 'cache'
  | 'stale-cache'
  | 'configured-fallback'
  | 'unavailable';

type CatalogCacheEntry = {
  models: ProviderModelEntry[];
  fetchedAt: number;
};

type ProviderModelRuntime = typeof globalThis & {
  __mathGeoHubProviderModels?: {
    cache: Map<string, CatalogCacheEntry>;
    inFlight: Map<string, Promise<ProviderModelEntry[]>>;
  };
};

const CHAT_SKIP = /embed|embedding|whisper|tts|dall-e|davinci|moderation|realtime|transcribe|speech|ocr|image|vision-pro|inpaint|sora|flux|wanx|text-to-|audio-/i;
const CATALOG_TTL_MS = 5 * 60 * 1_000;
const CATALOG_STALE_TTL_MS = 24 * 60 * 60 * 1_000;
const providerModelRuntime = globalThis as ProviderModelRuntime;
const catalogState = providerModelRuntime.__mathGeoHubProviderModels ?? {
  cache: new Map<string, CatalogCacheEntry>(),
  inFlight: new Map<string, Promise<ProviderModelEntry[]>>(),
};
providerModelRuntime.__mathGeoHubProviderModels = catalogState;

/** Heuristic: keep chat / reasoning models, drop embeddings and media APIs. */
export function isLikelyChatModel(id: string): boolean {
  const value = id.trim();
  if (!value || value.length > 128) return false;
  if (CHAT_SKIP.test(value)) return false;
  return /^[a-zA-Z0-9._\-:/]+$/.test(value);
}

function modelsListUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/, '');
  return /\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`;
}

async function fetchRelayModels(cfg: EffectiveProvider): Promise<ProviderModelEntry[]> {
  const gate = providerTransportGate(cfg.baseUrl);
  if (gate.status === 'open') {
    throw new Error(`relay transport cooling down for ${gate.retryAfterMs}ms`);
  }
  let response: Response;
  try {
    response = await fetch(modelsListUrl(cfg.baseUrl), {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    recordProviderTransportFailure(cfg.baseUrl);
    throw error;
  }
  recordProviderTransportSuccess(cfg.baseUrl);
  if (!response.ok) throw new Error(`models HTTP ${response.status}`);

  const body = await response.json() as {
    data?: Array<{ id?: string; owned_by?: string }>;
  };
  return (body.data ?? [])
    .map((row) => ({
      id: String(row.id ?? '').trim(),
      label: String(row.id ?? '').trim(),
      ownedBy: row.owned_by,
    }))
    .filter((model) => model.id && isLikelyChatModel(model.id));
}

function dedupeModels(models: ProviderModelEntry[]): ProviderModelEntry[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function cloneModels(models: ProviderModelEntry[]): ProviderModelEntry[] {
  return models.map((model) => ({ ...model }));
}

function configuredFallbackModel(cfg: EffectiveProvider): ProviderModelEntry[] {
  const id = cfg.model.trim();
  if (!isSafeModelId(id)) return [];
  return [{ id, label: `${id} (配置默认)` }];
}

function unavailableCatalogResult(
  cfg: EffectiveProvider,
): { models: ProviderModelEntry[]; source: ProviderModelSource; error: string } {
  const fallback = configuredFallbackModel(cfg);
  if (fallback.length) {
    return {
      models: fallback,
      source: 'configured-fallback',
      error: '暂时无法刷新完整模型目录；正在使用 .env.local 中明确配置的默认模型',
    };
  }
  return {
    models: [],
    source: 'unavailable',
    error: '上游模型目录暂不可用，请稍后重试',
  };
}

function fetchCatalog(cacheKey: string, cfg: EffectiveProvider): Promise<ProviderModelEntry[]> {
  const pending = catalogState.inFlight.get(cacheKey);
  if (pending) return pending;

  const request = fetchRelayModels(cfg)
    .then(dedupeModels)
    .finally(() => {
      catalogState.inFlight.delete(cacheKey);
    });
  catalogState.inFlight.set(cacheKey, request);
  return request;
}

/** Fetch the live catalog from api.molamaker.cn; never invent fallback models. */
export async function listProviderModels(
  name: ProviderName,
  cfg: EffectiveProvider,
): Promise<{ models: ProviderModelEntry[]; source: ProviderModelSource; error?: string }> {
  if (!cfg.configured) {
    return { models: [], source: 'unavailable', error: 'not configured' };
  }

  const cacheKey = `${name}:${cfg.baseUrl}`;
  const now = Date.now();
  const cached = catalogState.cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < CATALOG_TTL_MS) {
    return { models: cloneModels(cached.models), source: 'cache' };
  }

  try {
    const models = await fetchCatalog(cacheKey, cfg);
    if (models.length) {
      catalogState.cache.set(cacheKey, {
        models: cloneModels(models),
        fetchedAt: Date.now(),
      });
      return { models: cloneModels(models), source: 'api' };
    }
    if (cached && now - cached.fetchedAt < CATALOG_STALE_TTL_MS) {
      return {
        models: cloneModels(cached.models),
        source: 'stale-cache',
        error: '上游模型目录暂不可用，正在使用最近一次成功目录',
      };
    }
    return unavailableCatalogResult(cfg);
  } catch {
    if (cached && now - cached.fetchedAt < CATALOG_STALE_TTL_MS) {
      return {
        models: cloneModels(cached.models),
        source: 'stale-cache',
        error: '上游模型目录暂不可用，正在使用最近一次成功目录',
      };
    }
    return unavailableCatalogResult(cfg);
  }
}

/** Prefer the configured relay default when present, preserving the upstream ID. */
export function pickDefaultModel(
  models: ProviderModelEntry[],
  configured: string,
  probe: Record<string, { ok: boolean }> = {},
): string {
  void probe;
  const preferred = configured.trim();
  if (preferred) {
    const matched = models.find(
      (model) => model.id.localeCompare(preferred, undefined, { sensitivity: 'accent' }) === 0,
    );
    if (matched) return matched.id;
  }
  return models[0]?.id ?? '';
}

export function isThinkingModelId(id: string): boolean {
  return /qwq|r1|reasoner|thinking|qwen3-/i.test(id);
}

export function isSafeModelId(id: string): boolean {
  return !!id && id.length <= 128 && /^[a-zA-Z0-9._\-:/]+$/.test(id);
}
