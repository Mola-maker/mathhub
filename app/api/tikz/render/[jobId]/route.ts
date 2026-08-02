import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import {
  fetchTikzCompileArtifact,
  getTikzCompileJob,
  TikzCompileError,
} from '@/lib/tikz/exact/compile-tikz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const ip = await clientIp();
  const rate = await checkRate(`tikz-render-status:${ip}`, 180, 60_000);
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
      { error: '精确渲染状态查询过于频繁，请稍后重试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
        },
      },
    );
  }

  try {
    const { jobId } = await context.params;
    const job = await getTikzCompileJob(jobId);
    if (job.status === 'failed') {
      return NextResponse.json(
        {
          jobId: job.id,
          status: 'failed',
          error: job.error || 'TikZ 精确编译失败',
          code: job.errorCode || 'COMPILE_FAILED',
        },
        { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
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
        renderer: job.renderer || 'tectonic-dvisvgm',
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
