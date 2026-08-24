import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import {
  createProblemConstructionAction,
} from '@/lib/tikz/problems/problem-construction-action.server';
import {
  parseProblemConstructionPrepareInput,
} from '@/lib/tikz/problems/problem-construction-protocol';
import {
  problemInspectionReceiptConfigured,
  verifyProblemInspectionReceipt,
} from '@/lib/tikz/problems/problem-inspection-receipt.server';
import { resolveGeometryProblemReference } from '@/lib/tikz/problems/source-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

async function boundedRequestText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let value = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    value += decoder.decode();
    return value;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const rate = await checkRate(`tikz-problem-construct:${await clientIp()}`, 12, 60_000);
  if (!rate.allowed) {
    return Response.json({ error: 'Problem construction rate limit exceeded.' }, { status: 429 });
  }
  if (!problemInspectionReceiptConfigured()) {
    return Response.json({ error: 'Problem construction actions are not configured.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  let raw: string | null;
  try {
    raw = await boundedRequestText(request);
  } catch {
    return Response.json({ error: 'Problem construction request is not valid UTF-8.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (raw === null) {
    return Response.json({ error: 'Problem construction request is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Problem construction request is invalid JSON.' }, { status: 400 });
  }
  const parsed = parseProblemConstructionPrepareInput(body);
  if (!parsed) {
    return Response.json({ error: 'Problem construction request is invalid.' }, { status: 400 });
  }
  const receipt = verifyProblemInspectionReceipt(parsed.inspectionReceipt);
  if (!receipt) {
    return Response.json({ error: 'Problem inspection receipt is invalid or expired.' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const timeout = AbortSignal.timeout(12_000);
  try {
    const problem = await resolveGeometryProblemReference({
      selector: {
        source: receipt.source,
        id: receipt.sourceId,
        contentHash: receipt.contentHash,
        provider: receipt.provider,
      },
      signal: AbortSignal.any([request.signal, timeout]),
    });
    if (
      !problem
      || problem.title !== receipt.title
      || problem.sourceUrl !== receipt.sourceUrl
      || problem.datasetUrl !== receipt.datasetUrl
      || problem.licenseId !== receipt.licenseId
      || problem.rights.sourceMaterialRights !== receipt.sourceMaterialRights
    ) {
      return Response.json({ error: 'Problem reference changed after inspection.' }, {
        status: 409,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (problem.rights.sourceMaterialRights === 'blocked') {
      return Response.json({ error: 'Problem source material is blocked.' }, {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const action = createProblemConstructionAction(problem, receipt, parsed.basis);
    return Response.json({
      schemaVersion: 'geometry-problem-construction-prepared/v1',
      action,
      attribution: {
        title: problem.title,
        sourceUrl: problem.sourceUrl,
        datasetUrl: problem.datasetUrl,
        licenseId: problem.licenseId,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({
      error: timeout.aborted && !request.signal.aborted
        ? 'Problem construction verification timed out.'
        : request.signal.aborted
          ? 'Problem construction was cancelled.'
          : error instanceof Error
            ? `Problem construction verification failed: ${error.message}`
            : 'Problem construction verification failed.',
    }, {
      status: timeout.aborted && !request.signal.aborted ? 504 : request.signal.aborted ? 499 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
