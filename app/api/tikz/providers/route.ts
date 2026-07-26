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
    available: entries.filter((entry) => entry.configured).map((entry) => entry.name),
    providers: Object.fromEntries(
      entries.map((entry) => [
        entry.name,
        { configured: entry.configured, defaultModel: entry.defaultModel },
      ]),
    ),
  });
}

