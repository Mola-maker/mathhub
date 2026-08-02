import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import {
  createTikzCompileJob,
  fetchTikzCompileArtifact,
  TikzCompileError,
} from '@/lib/tikz/exact/compile-tikz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const ip = await clientIp();
  const rate = await checkRate(`tikz-render:${ip}`, 30, 60_000);
  if (rate.unavailable) {
    return NextResponse.json(
      { error: '限流服务暂时不可用，请稍后重试' },
      {
        status: 503,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
      },
    );
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { error: '精确渲染请求过于频繁，请稍后重试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
        },
      },
    );
  }

  let code = '';
  try {
    const body = await req.json() as { code?: unknown };
    code = typeof body.code === 'string' ? body.code : '';
  } catch {
    return NextResponse.json(
      { error: '请求体不是合法 JSON' },
      { status: 400 },
    );
  }

  try {
    const job = await createTikzCompileJob(code);
    if (job.status === 'failed') {
      throw new TikzCompileError(
        job.error || 'TikZ 精确编译失败',
        422,
        job.errorCode || 'COMPILE_FAILED',
      );
    }
    if (job.status !== 'succeeded') {
      return NextResponse.json(
        { jobId: job.id, status: job.status },
        {
          status: 202,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '1',
          },
        },
      );
    }
    if (!job.attestation) {
      throw new TikzCompileError(
        '精确编译任务缺少产物证明',
        502,
        'INVALID_ARTIFACT_ATTESTATION',
      );
    }
    const svg = await fetchTikzCompileArtifact(job.id, job.attestation);
    return NextResponse.json(
      {
        jobId: job.id,
        status: 'succeeded',
        svg,
        renderer: job.renderer,
        attestation: job.attestation,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const status = error instanceof TikzCompileError ? error.status : 500;
    const code = error instanceof TikzCompileError
      ? error.code
      : 'INTERNAL_ERROR';
    const message = error instanceof Error
      ? error.message
      : 'TikZ 精确渲染失败';
    return NextResponse.json({ error: message, code }, { status });
  }
}
