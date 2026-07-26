export type ProviderName = 'anthropic' | 'deepseek' | 'coze' | 'dashscope';

export const PROVIDER_NAMES: ProviderName[] = [
  'anthropic',
  'deepseek',
  'coze',
  'dashscope',
];

export interface EffectiveProvider {
  apiKey: string;
  baseUrl: string;
  model: string;
  botId: string;
  configured: boolean;
  protocol: 'anthropic' | 'openai-compatible' | 'coze';
}

/** Relay base URL, read at call time so tests can stub env. */
export function relayBaseUrl(): string {
  return (process.env.LLM_RELAY_BASE_URL?.trim() || 'https://api.molamaker.cn').replace(/\/+$/, '');
}

const PROVIDER_DEFAULTS: Record<
  ProviderName,
  { baseUrl: string; model: string; botId: string }
> = {
  anthropic: {
    baseUrl: '',
    model: 'claude-sonnet-4-6',
    botId: '',
  },
  deepseek: {
    baseUrl: '',
    model: 'deepseek-chat',
    botId: '',
  },
  coze: { baseUrl: 'https://api.coze.cn', model: '', botId: '' },
  dashscope: {
    baseUrl: '',
    model: 'qwen-plus',
    botId: '',
  },
};

function envFallback(name: ProviderName): {
  apiKey: string;
  botId: string;
  baseUrl?: string;
  model?: string;
} {
  switch (name) {
    case 'anthropic':
      return {
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.LLM_RELAY_API_KEY || '',
        botId: '',
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        model: process.env.ANTHROPIC_MODEL,
      };
    case 'deepseek':
      return {
        apiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_RELAY_API_KEY || '',
        botId: '',
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
      };
    case 'dashscope':
      return {
        apiKey: process.env.DASHSCOPE_API_KEY || process.env.LLM_RELAY_API_KEY || '',
        botId: '',
        baseUrl: process.env.DASHSCOPE_BASE_URL,
        model: process.env.DASHSCOPE_MODEL,
      };
    case 'coze':
      return {
        apiKey: process.env.COZE_API_KEY || process.env.LLM_RELAY_API_KEY || '',
        botId: process.env.COZE_BOT_ID ?? '',
        baseUrl: process.env.COZE_BASE_URL,
      };
  }
}

export async function getEffectiveProvider(
  name: ProviderName,
): Promise<EffectiveProvider> {
  const env = envFallback(name);
  const defaults = PROVIDER_DEFAULTS[name];
  const apiKey = env.apiKey.trim();
  const botId = env.botId.trim();
  const isRelayed = name !== 'coze';
  const baseUrl = env.baseUrl?.trim() || (isRelayed ? relayBaseUrl() : defaults.baseUrl);
  const model = env.model?.trim() || defaults.model;
  const configured = name === 'coze' ? Boolean(apiKey && botId) : Boolean(apiKey);
  const protocol: EffectiveProvider['protocol'] =
    name === 'coze' ? 'coze' : baseUrl.includes('api.anthropic.com') ? 'anthropic' : 'openai-compatible';
  return { apiKey, baseUrl, model, botId, configured, protocol };
}
