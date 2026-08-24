import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import {
  geometryProblemReferenceRecord,
  searchGeometryProblemSources,
} from '@/lib/tikz/problems/source-gateway';
import { GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS } from '@/lib/tikz/problems/source-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const rate = await checkRate(`tikz-problems:${await clientIp()}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json({ error: 'Problem search rate limit exceeded.' }, { status: 429 });
  }
  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 240) ?? '';
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 12);
  const timeout = AbortSignal.timeout(12_000);
  try {
    const result = await searchGeometryProblemSources({
      query,
      offset,
      limit,
      signal: AbortSignal.any([request.signal, timeout]),
    });
    return Response.json({
      schemaVersion: 'geometry-problem-search/v2',
      query,
      records: result.records.map(geometryProblemReferenceRecord),
      sourceStatus: result.sourceStatus,
    }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (timeout.aborted && !request.signal.aborted) {
      const detail = error instanceof Error ? error.message : 'upstream timeout';
      return Response.json({
        schemaVersion: 'geometry-problem-search/v2',
        query,
        degraded: true,
        records: [],
        sourceStatus: GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS.map((descriptor) => ({
          id: descriptor.id,
          enabled: false,
          accessMode: descriptor.accessMode,
          sourceMaterialRights: descriptor.sourceMaterialRights,
          detail: descriptor.accessMode === 'live-search'
            ? detail
            : 'not attempted after upstream timeout',
        })),
      }, {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return Response.json({
      error: request.signal.aborted
        ? 'Problem source search was cancelled.'
        : 'Problem source search failed.',
    }, { status: request.signal.aborted ? 499 : 502 });
  }
}
