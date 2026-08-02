import { NextRequest, NextResponse } from 'next/server';
import { CLIENT_PROVIDER, getEffectiveProvider } from '@/lib/provider/settings';
import { listProviderModels, pickDefaultModel } from '@/lib/provider/provider-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get('provider') ?? CLIENT_PROVIDER).trim();
  if (provider !== CLIENT_PROVIDER) {
    return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
  }

  const cfg = await getEffectiveProvider(CLIENT_PROVIDER);
  if (!cfg.configured) {
    return NextResponse.json({
      provider,
      configured: false,
      models: [],
      defaultModel: '',
      source: 'unavailable',
      error: '请在 .env.local 配置 LLM_RELAY_API_KEY',
    });
  }

  const listed = await listProviderModels(provider, cfg);
  const models = listed.models.sort((a, b) => a.id.localeCompare(b.id));
  const defaultModel = pickDefaultModel(models, cfg.model);

  return NextResponse.json({
    provider,
    configured: true,
    defaultModel,
    source: listed.source,
    listError: listed.error,
    models,
  });
}
