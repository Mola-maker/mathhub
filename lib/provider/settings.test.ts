import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEffectiveProvider, relayBaseUrl } from './settings';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'LLM_RELAY_API_KEY', 'LLM_RELAY_BASE_URL', 'DEEPSEEK_API_KEY', 'COZE_API_KEY', 'COZE_BOT_ID'];
beforeEach(() => { for (const k of ENV_KEYS) vi.stubEnv(k, ''); delete process.env.ANTHROPIC_BASE_URL; delete process.env.LLM_RELAY_BASE_URL; });
afterEach(() => { vi.unstubAllEnvs(); });

describe('relay defaults', () => {
  it('relayBaseUrl 默认 api.molamaker.cn，可被 LLM_RELAY_BASE_URL 覆盖', () => {
    expect(relayBaseUrl()).toBe('https://api.molamaker.cn');
    vi.stubEnv('LLM_RELAY_BASE_URL', 'https://relay.example.com/');
    expect(relayBaseUrl()).toBe('https://relay.example.com');
  });

  it('anthropic 默认走中转站且协议为 openai-compatible', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const p = await getEffectiveProvider('anthropic');
    expect(p.baseUrl).toBe('https://api.molamaker.cn');
    expect(p.protocol).toBe('openai-compatible');
  });

  it('baseUrl 指回 api.anthropic.com 时协议为 anthropic 原生', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    const p = await getEffectiveProvider('anthropic');
    expect(p.protocol).toBe('anthropic');
  });

  it('共享 LLM_RELAY_API_KEY 兜底，具体 key 优先', async () => {
    vi.stubEnv('LLM_RELAY_API_KEY', 'relay-key');
    expect((await getEffectiveProvider('deepseek')).apiKey).toBe('relay-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'ds-key');
    expect((await getEffectiveProvider('deepseek')).apiKey).toBe('ds-key');
  });

  it('coze 协议保持 coze、默认直连 api.coze.cn', async () => {
    vi.stubEnv('COZE_API_KEY', 'k'); vi.stubEnv('COZE_BOT_ID', 'b');
    const p = await getEffectiveProvider('coze');
    expect(p.protocol).toBe('coze');
    expect(p.baseUrl).toBe('https://api.coze.cn');
  });
});
