import { NextResponse } from 'next/server';
import { CLIENT_PROVIDER, getEffectiveProvider, relayBaseUrl } from '@/lib/provider/settings';
import { isSafeModelId } from '@/lib/provider/provider-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = await getEffectiveProvider(CLIENT_PROVIDER);
  const entry = {
    name: CLIENT_PROVIDER,
    configured: cfg.configured,
    visionConfigured: isSafeModelId(cfg.visionModel),
    endpoint: relayBaseUrl(),
  };

  return NextResponse.json({
    available: entry.configured ? [CLIENT_PROVIDER] : [],
    providers: { [CLIENT_PROVIDER]: entry },
  });
}
