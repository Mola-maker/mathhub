export type ProviderName = 'relay';

export const CLIENT_PROVIDER: ProviderName = 'relay';
export const PROVIDER_NAMES: ProviderName[] = [CLIENT_PROVIDER];
const RELAY_BASE_URL = 'https://api.molamaker.cn';

export interface EffectiveProvider {
  apiKey: string;
  baseUrl: string;
  model: string;
  configured: boolean;
}

/** The only allowed upstream for both public studios. */
export function relayBaseUrl(): string {
  return RELAY_BASE_URL;
}

function relayCredentials(name: ProviderName): {
  apiKey: string;
  model?: string;
} {
  void name;
  return {
    apiKey: process.env.LLM_RELAY_API_KEY ?? '',
    model: process.env.LLM_RELAY_MODEL,
  };
}

export async function getEffectiveProvider(
  name: ProviderName,
): Promise<EffectiveProvider> {
  const env = relayCredentials(name);
  const apiKey = env.apiKey.trim();
  const model = env.model?.trim() || '';
  return {
    apiKey,
    baseUrl: relayBaseUrl(),
    model,
    configured: Boolean(apiKey),
  };
}
