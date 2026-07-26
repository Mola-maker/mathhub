import { NextResponse } from 'next/server';
import { getEffectiveProvider, PROVIDER_NAMES } from '@/lib/provider/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const entries = await Promise.all(
    PROVIDER_NAMES.map(async (name) => {
      const cfg = await getEffectiveProvider(name);
      return { name, configured: cfg.configured, defaultModel: cfg.model };
    }),
  );

  return NextResponse.json({
    available: entries.filter((e) => e.configured).map((e) => e.name),
    providers: Object.fromEntries(
      entries.map((e) => [e.name, { configured: e.configured, defaultModel: e.defaultModel }]),
    ),
  });
}
