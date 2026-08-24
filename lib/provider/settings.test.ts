import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_PROVIDER, getEffectiveProvider, PROVIDER_NAMES, relayBaseUrl } from './settings';

const ENV_KEYS = [
  'LLM_RELAY_API_KEY',
  'LLM_RELAY_MODEL',
  'LLM_RELAY_VISION_MODEL',
];

beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('api.molamaker.cn relay settings', () => {
  it('公开 provider 只有 relay', () => {
    expect(CLIENT_PROVIDER).toBe('relay');
    expect(PROVIDER_NAMES).toEqual(['relay']);
  });

  it('固定使用 api.molamaker.cn，不接受环境变量替换上游', () => {
    expect(relayBaseUrl()).toBe('https://api.molamaker.cn');
    vi.stubEnv('LLM_RELAY_BASE_URL', 'https://relay.example.com/');
    expect(relayBaseUrl()).toBe('https://api.molamaker.cn');
  });

  it('只读取 relay key 和可选默认模型', async () => {
    vi.stubEnv('LLM_RELAY_API_KEY', 'relay-key');
    vi.stubEnv('LLM_RELAY_MODEL', 'model-a');
    vi.stubEnv('LLM_RELAY_VISION_MODEL', 'vision-a');
    const provider = await getEffectiveProvider('relay');
    expect(provider).toMatchObject({
      apiKey: 'relay-key',
      baseUrl: 'https://api.molamaker.cn',
      model: 'model-a',
      visionModel: 'vision-a',
      configured: true,
    });
  });

  it('未配置 key 时不可用', async () => {
    expect((await getEffectiveProvider('relay')).configured).toBe(false);
  });
});
