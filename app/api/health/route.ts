import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEEP_TIMEOUT_MS = 1_500;

async function compilerHealth(): Promise<boolean> {
  const baseUrl = process.env.TIKZ_COMPILER_URL?.trim();
  if (!baseUrl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/healthz`,
      { cache: 'no-store', signal: controller.signal },
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const deep = request.nextUrl.searchParams.get('deep') === '1';
  const payload = {
    ok: true,
    service: 'math-geohub-web',
    ...(deep ? { compiler: await compilerHealth() } : {}),
  };
  return NextResponse.json(payload, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
