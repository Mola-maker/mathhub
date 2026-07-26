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
}

const PROVIDER_DEFAULTS: Record<
  ProviderName,
  { baseUrl: string; model: string; botId: string }
> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    botId: '',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    botId: '',
  },
  coze: { baseUrl: 'https://api.coze.cn', model: '', botId: '' },
  dashscope: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
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
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        botId: '',
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        model: process.env.ANTHROPIC_MODEL,
      };
    case 'deepseek':
      return {
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        botId: '',
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
      };
    case 'dashscope':
      return {
        apiKey: process.env.DASHSCOPE_API_KEY ?? '',
        botId: '',
        baseUrl: process.env.DASHSCOPE_BASE_URL,
        model: process.env.DASHSCOPE_MODEL,
      };
    case 'coze':
      return {
        apiKey: process.env.COZE_API_KEY ?? '',
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
  const baseUrl = env.baseUrl?.trim() || defaults.baseUrl;
  const model = env.model?.trim() || defaults.model;
  const configured = name === 'coze' ? Boolean(apiKey && botId) : Boolean(apiKey);
  return { apiKey, baseUrl, model, botId, configured };
}
