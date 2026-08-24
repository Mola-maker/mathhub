import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import {
  parseProblemInspectionReferenceInput,
} from '@/lib/tikz/problems/problem-inspection-protocol';
import {
  createProblemInspectionReceipt,
  problemInspectionReceiptConfigured,
} from '@/lib/tikz/problems/problem-inspection-receipt.server';
import {
  resolveGeometryProblemReference,
} from '@/lib/tikz/problems/source-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

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
  const rate = await checkRate(`tikz-problem-prepare:${await clientIp()}`, 20, 60_000);
  if (!rate.allowed) {
    return Response.json({ error: 'Problem inspection rate limit exceeded.' }, { status: 429 });
  }
  if (!problemInspectionReceiptConfigured()) {
    return Response.json({
      error: 'Problem inspection receipts are not configured.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  let raw: string | null;
  try {
    raw = await boundedRequestText(request);
  } catch {
    return Response.json({ error: 'Problem inspection request is not valid UTF-8.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (raw === null) {
    return Response.json({ error: 'Problem inspection request is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Problem inspection request is invalid JSON.' }, { status: 400 });
  }
  const selector = parseProblemInspectionReferenceInput(body);
  if (!selector) {
    return Response.json({ error: 'Problem inspection reference is invalid.' }, { status: 400 });
  }
  const timeout = AbortSignal.timeout(12_000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const problem = await resolveGeometryProblemReference({ selector, signal });
    if (!problem) {
      return Response.json({
        error: 'Problem reference changed or could not be re-attested.',
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    if (problem.rights.sourceMaterialRights === 'blocked') {
      return Response.json({
        error: 'Problem source material is blocked by the source catalog.',
      }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    const receipt = createProblemInspectionReceipt(problem);
    return Response.json({
      schemaVersion: 'geometry-problem-inspection-prepared/v1',
      receipt,
      statementPreview: problem.statement.slice(0, 800),
      attribution: {
        title: problem.title,
        sourceUrl: problem.sourceUrl,
        datasetUrl: problem.datasetUrl,
        licenseId: problem.licenseId,
      },
      rightsWarning: problem.rights.notice,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (timeout.aborted && !request.signal.aborted) {
      return Response.json({
        error: 'Problem reference verification timed out.',
      }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({
      error: request.signal.aborted
        ? 'Problem inspection was cancelled.'
        : error instanceof Error
          ? `Problem reference verification failed: ${error.message}`
          : 'Problem reference verification failed.',
    }, {
      status: request.signal.aborted ? 499 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
