import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveProvider: vi.fn(),
}));

vi.mock('@/lib/provider/settings', () => ({
  CLIENT_PROVIDER: 'relay',
  getEffectiveProvider: mocks.getEffectiveProvider,
  relayBaseUrl: () => 'https://api.molamaker.cn',
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tikz/providers', () => {
  it('advertises the relay only when its API key is configured', async () => {
    mocks.getEffectiveProvider.mockResolvedValue({
      apiKey: 'test-key',
      baseUrl: 'https://api.molamaker.cn',
      model: 'MiniMax-M3',
      visionModel: '',
      configured: true,
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      available: ['relay'],
      providers: {
        relay: {
          name: 'relay',
          configured: true,
          visionConfigured: false,
          endpoint: 'https://api.molamaker.cn',
        },
      },
    });
  });

  it('does not expose an unsafe visual model as configured', async () => {
    mocks.getEffectiveProvider.mockResolvedValue({
      apiKey: 'test-key',
      baseUrl: 'https://api.molamaker.cn',
      model: '',
      visionModel: 'bad model id',
      configured: true,
    });

    const payload = await (await GET()).json();

    expect(payload.providers.relay.visionConfigured).toBe(false);
  });
});
