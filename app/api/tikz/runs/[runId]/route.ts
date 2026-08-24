import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { checkRate } from '@/lib/rate-limit';
import { BoundedJsonError, readBoundedJson } from '@/lib/http/read-bounded-json';
import { tikzAgentEvent } from '@/lib/tikz/agent/protocol';
import { getTikzAgentRunStore } from '@/lib/tikz/agent/run-store';
import { verifyTikzAgentRunResumeToken } from '@/lib/tikz/agent/run-resume-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const TRANSACTION_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const MAX_DISPOSITION_BODY_BYTES = 16 * 1024;

function resumeTokenFor(request: NextRequest, runId: string): string | null {
  const authorization = request.headers.get('authorization');
  const resumeToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  return resumeToken && verifyTikzAgentRunResumeToken(runId, resumeToken)
    ? resumeToken
    : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  if (!RUN_ID.test(runId)) {
    return Response.json({ error: 'invalid Agent run id' }, { status: 400 });
  }
  if (!resumeTokenFor(request, runId)) {
    return Response.json({ error: 'Agent run not found or recovery capability invalid' }, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const afterRaw = request.nextUrl.searchParams.get('afterSequence');
  const afterSequence = afterRaw === null ? -1 : Number(afterRaw);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) {
    return Response.json({ error: 'invalid Agent run cursor' }, { status: 400 });
  }

  const rate = await checkRate(`tikz-agent-run:${await clientIp()}`, 60, 60_000);
  if (rate.unavailable) {
    return Response.json({ error: 'Agent RunStore rate limiter unavailable' }, {
      status: 503,
      headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    });
  }
  if (!rate.allowed) {
    return Response.json({ error: 'too many Agent run replay requests' }, {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
        'Cache-Control': 'no-store',
      },
    });
  }

  const storeResult = await getTikzAgentRunStore();
  if (!storeResult.ok) {
    return Response.json({ error: storeResult.message }, {
      status: 503,
      headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    });
  }
  const snapshot = await storeResult.store.read(runId, afterSequence);
  if (!snapshot.ok) {
    return Response.json({ error: snapshot.message }, {
      status: snapshot.code === 'invalid' ? 400 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!snapshot.value) {
    return Response.json({ error: 'Agent run not found or expired' }, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json({
    schemaVersion: 'tikz-agent-run-replay/v1',
    runId,
    events: snapshot.value.events,
    proposal: snapshot.value.proposal ?? null,
    verificationPending: snapshot.value.verificationPending === true,
    terminal: snapshot.value.terminal ?? null,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  if (!RUN_ID.test(runId)) {
    return Response.json({ error: 'invalid Agent run id' }, { status: 400 });
  }
  if (!resumeTokenFor(request, runId)) {
    return Response.json({ error: 'Agent run not found or recovery capability invalid' }, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_DISPOSITION_BODY_BYTES);
  } catch (error) {
    const status = error instanceof BoundedJsonError ? error.status : 400;
    return Response.json({ error: 'invalid Agent proposal disposition' }, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'invalid Agent proposal disposition' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const transactionId = typeof record.transactionId === 'string'
    ? record.transactionId
    : '';
  const outcome = record.outcome;
  const reason = typeof record.reason === 'string'
    ? record.reason.trim().slice(0, 500)
    : '';
  if (
    record.schemaVersion !== 'tikz-agent-proposal-disposition/v1'
    || !TRANSACTION_ID.test(transactionId)
    || (
      outcome !== 'rejected'
      && outcome !== 'cancelled'
      && outcome !== 'committed-unverified'
    )
  ) {
    return Response.json({ error: 'invalid Agent proposal disposition' }, { status: 400 });
  }

  const rate = await checkRate(`tikz-agent-run-disposition:${await clientIp()}`, 30, 60_000);
  if (rate.unavailable) {
    return Response.json({ error: 'Agent RunStore rate limiter unavailable' }, {
      status: 503,
      headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    });
  }
  if (!rate.allowed) {
    return Response.json({ error: 'too many Agent proposal disposition requests' }, {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
        'Cache-Control': 'no-store',
      },
    });
  }

  const storeResult = await getTikzAgentRunStore();
  if (!storeResult.ok) {
    return Response.json({ error: storeResult.message }, {
      status: 503,
      headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    });
  }
  const proposal = await storeResult.store.readProposal(runId);
  if (!proposal.ok) {
    return Response.json({ error: proposal.message }, {
      status: proposal.code === 'invalid' ? 400 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!proposal.value || proposal.value.transactionId !== transactionId) {
    return Response.json({ error: 'pending Agent proposal not found' }, {
      status: 409,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const committedWithoutProjection = outcome === 'committed-unverified';
  if (
    committedWithoutProjection
    && (
      record.afterRevision !== proposal.value.afterRevision
      || record.afterSourceHash !== proposal.value.afterSourceHash
      || JSON.stringify(record.transactionAttestation)
        !== JSON.stringify(proposal.value.transactionAttestation)
    )
  ) {
    return Response.json({ error: 'committed proposal receipt does not match checkpoint' }, {
      status: 409,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const dispositionEvent = tikzAgentEvent(runId, 3_000_000, {
    type: committedWithoutProjection ? 'commit.completed' : 'commit.rejected',
    title: committedWithoutProjection
      ? 'Canvas 与 TikZ 源码已同步更新'
      : outcome === 'cancelled'
        ? '用户取消了本次修改'
        : '浏览器拒绝了本次修改',
    ...(reason ? { detail: reason } : {}),
    outcome: committedWithoutProjection ? 'mutation' : 'unapplied-candidate',
  });
  const terminalEvent = tikzAgentEvent(runId, 3_000_001, {
    type: 'run.completed',
    title: committedWithoutProjection
      ? '提交已完成，最新几何投影尚待刷新'
      : '本轮已完成，画板未改变',
    outcome: committedWithoutProjection ? 'mutation' : 'unapplied-candidate',
  });
  const resolved = await storeResult.store.resolveProposal(
    proposal.value,
    dispositionEvent,
    terminalEvent,
  );
  if (!resolved.ok) {
    return Response.json({ error: resolved.message }, {
      status: resolved.code === 'invalid' ? 400 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!resolved.stored) {
    return Response.json({ error: 'Agent proposal already resolved' }, {
      status: 409,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json({
    schemaVersion: 'tikz-agent-proposal-disposition-result/v1',
    runId,
    events: [dispositionEvent, terminalEvent],
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
