import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveProvider: vi.fn(),
  listProviderModels: vi.fn(),
}));

vi.mock('@/lib/provider/settings', () => ({
  CLIENT_PROVIDER: 'relay',
  getEffectiveProvider: mocks.getEffectiveProvider,
}));

vi.mock('@/lib/provider/provider-models', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/provider/provider-models')>(),
  listProviderModels: mocks.listProviderModels,
}));

import { GET } from './route';

const configuredProvider = {
  apiKey: 'test-key',
  baseUrl: 'https://api.molamaker.cn',
  model: 'MiniMax-M3',
  visionModel: '',
  configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEffectiveProvider.mockResolvedValue(configuredProvider);
});

describe('GET /api/tikz/models', () => {
  it('rejects provider names outside the single public relay', async () => {
    const response = await GET(new NextRequest('http://localhost/api/tikz/models?provider=other'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid provider' });
    expect(mocks.getEffectiveProvider).not.toHaveBeenCalled();
  });

  it('returns a clear unconfigured response without contacting the catalog', async () => {
    mocks.getEffectiveProvider.mockResolvedValue({
      ...configuredProvider,
      apiKey: '',
      configured: false,
    });

    const response = await GET(new NextRequest('http://localhost/api/tikz/models'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: 'relay',
      configured: false,
      models: [],
      defaultModel: '',
      source: 'unavailable',
    });
    expect(mocks.listProviderModels).not.toHaveBeenCalled();
  });

  it('preserves the configured fallback and selects it as the usable default', async () => {
    mocks.listProviderModels.mockResolvedValue({
      models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3 (配置默认)' }],
      source: 'configured-fallback',
      error: '暂时无法刷新完整模型目录；正在使用 .env.local 中明确配置的默认模型',
    });

    const response = await GET(new NextRequest('http://localhost/api/tikz/models?provider=relay'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'relay',
      configured: true,
      defaultModel: 'MiniMax-M3',
      source: 'configured-fallback',
      listError: '暂时无法刷新完整模型目录；正在使用 .env.local 中明确配置的默认模型',
      models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3 (配置默认)' }],
    });
    expect(mocks.listProviderModels).toHaveBeenCalledWith('relay', configuredProvider);
  });
});
