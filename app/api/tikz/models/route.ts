import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveProvider, PROVIDER_NAMES, type ProviderName } from '@/lib/provider/settings';
import { listProviderModels, pickDefaultModel } from '@/lib/provider/provider-models';
import { probeModelCatalog } from '@/lib/provider/model-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get('provider') ?? '').trim() as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) {
    return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
  }

  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) {
    return NextResponse.json({
      provider,
      configured: false,
      models: [],
      defaultModel: '',
      probe: {},
      source: 'fallback',
      error: 'provider not configured',
    });
  }

  const listed = await listProviderModels(provider, cfg);
  const ids = listed.models.map((model) => model.id);
  const probe = await probeModelCatalog(provider, cfg, ids, 3, 24);
  const defaultModel = pickDefaultModel(listed.models, cfg.model, probe);
  const models = listed.models
    .map((model) => ({
      ...model,
      probe: probe[model.id] ?? { ok: false, ms: 0, error: 'not probed' },
    }))
    .sort((a, b) => {
      const aOrder = a.probe.ok ? 0 : 1;
      const bOrder = b.probe.ok ? 0 : 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.id.localeCompare(b.id);
    });

  return NextResponse.json({
    provider,
    configured: true,
    defaultModel,
    source: listed.source,
    listError: listed.error,
    models,
    probe,
  });
}

