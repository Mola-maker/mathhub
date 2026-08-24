import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveProvider } from './settings';
import { listProviderModels, pickDefaultModel } from './provider-models';
import { resetProviderTransportHealth } from './transport-health';

function provider(
  baseUrl: string,
  model = '',
): EffectiveProvider {
  return {
    apiKey: 'test-key',
    baseUrl,
    model,
    visionModel: '',
    configured: true,
  };
}

afterEach(() => {
  resetProviderTransportHealth();
  vi.unstubAllGlobals();
});

describe('provider model catalog fallbacks', () => {
  it('keeps the explicitly configured safe model usable when the live catalog is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(listProviderModels(
      'relay',
      provider('https://fallback-network.example', 'MiniMax-M3'),
    )).resolves.toEqual({
      models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3 (配置默认)' }],
      source: 'configured-fallback',
      error: '暂时无法刷新完整模型目录；正在使用 .env.local 中明确配置的默认模型',
    });
  });

  it('stops repeating slow catalog probes while the relay transport is cooling down', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const cfg = provider('https://catalog-cooldown.example', 'MiniMax-M3');

    await listProviderModels('relay', cfg);
    await listProviderModels('relay', cfg);
    await listProviderModels('relay', cfg);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the configured fallback when the upstream returns an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [] })));

    const result = await listProviderModels(
      'relay',
      provider('https://fallback-empty.example/v1', 'gpt-5.6-sol'),
    );

    expect(result.source).toBe('configured-fallback');
    expect(result.models.map((row) => row.id)).toEqual(['gpt-5.6-sol']);
  });

  it.each(['', 'bad model id', '<script>']) (
    'does not invent or expose an unsafe configured fallback: %j',
    async (configuredModel) => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      const result = await listProviderModels(
        'relay',
        provider(`https://no-fallback-${encodeURIComponent(configuredModel)}.example`, configuredModel),
      );

      expect(result).toMatchObject({ models: [], source: 'unavailable' });
    },
  );

  it('prefers the live canonical model ID with case-insensitive configured matching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      data: [
        { id: 'MiniMax-M3', owned_by: 'minimax' },
        { id: 'text-embedding-3-large', owned_by: 'openai' },
      ],
    })));

    const result = await listProviderModels(
      'relay',
      provider('https://live-canonical.example', 'Minimax-M3'),
    );

    expect(result.source).toBe('api');
    expect(result.models).toEqual([{
      id: 'MiniMax-M3',
      label: 'MiniMax-M3',
      ownedBy: 'minimax',
    }]);
    expect(pickDefaultModel(result.models, 'Minimax-M3')).toBe('MiniMax-M3');
  });
});
