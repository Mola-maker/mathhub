export interface ExactTikzDiagnostic {
  readonly type: 'source-policy';
  readonly severity: 'error';
  readonly rule: string;
  readonly start: number;
  readonly end: number;
  readonly command?: string;
}

export interface ExactTikzAttestation {
  readonly schemaVersion: 'tikz-artifact-attestation/v1';
  readonly jobId: string;
  readonly sourceDigest: string;
  readonly cacheKeyDigest: string;
  readonly artifactDigest: string;
  readonly profile: TikzExactCompilerProfileId;
  readonly visibility: 'public' | 'private';
  readonly renderer: string;
  readonly compilerImageDigest: string;
  readonly profileManifestDigest: string;
  readonly mediaType: 'image/svg+xml';
  readonly svgBytes: number;
  readonly completedAt: number;
}

export interface ExactTikzArtifact {
  readonly svg: string;
  readonly attestation: ExactTikzAttestation;
}

export type ExactTikzJobStatus = 'queued' | 'running';

export class ExactTikzClientError extends Error {
  readonly code: string;
  readonly diagnostics: readonly ExactTikzDiagnostic[];

  constructor(
    message: string,
    code = '',
    diagnostics: readonly ExactTikzDiagnostic[] = [],
  ) {
    super(message);
    this.name = 'ExactTikzClientError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

const JOB_TIMEOUT_MS = 180_000;
const JOB_ID = /^j_[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function isExactTikzAttestation(
  value: unknown,
  expectedJobId: string,
): value is ExactTikzAttestation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ExactTikzAttestation>;
  return record.schemaVersion === 'tikz-artifact-attestation/v1'
    && record.jobId === expectedJobId
    && JOB_ID.test(record.jobId)
    && typeof record.sourceDigest === 'string'
    && SHA256.test(record.sourceDigest)
    && typeof record.cacheKeyDigest === 'string'
    && SHA256.test(record.cacheKeyDigest)
    && expectedJobId === `j_${record.cacheKeyDigest}`
    && typeof record.artifactDigest === 'string'
    && SHA256.test(record.artifactDigest)
    && (
      record.profile === 'tikz-standard-v1'
      || record.profile === 'tikz-luatex-graphdrawing-v1'
    )
    && (record.visibility === 'public' || record.visibility === 'private')
    && typeof record.renderer === 'string'
    && record.renderer.length > 0
    && typeof record.compilerImageDigest === 'string'
    && record.compilerImageDigest.length > 0
    && typeof record.profileManifestDigest === 'string'
    && SHA256.test(record.profileManifestDigest)
    && record.mediaType === 'image/svg+xml'
    && typeof record.svgBytes === 'number'
    && Number.isSafeInteger(record.svgBytes)
    && record.svgBytes > 0
    && typeof record.completedAt === 'number'
    && Number.isSafeInteger(record.completedAt)
    && record.completedAt > 0;
}

export function exactTikzDiagnostics(value: unknown): ExactTikzDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Partial<ExactTikzDiagnostic>;
    if (
      record.type !== 'source-policy'
      || record.severity !== 'error'
      || typeof record.rule !== 'string'
      || !Number.isSafeInteger(record.start)
      || (record.start ?? -1) < 0
      || !Number.isSafeInteger(record.end)
      || (record.end ?? -1) < (record.start ?? 0)
      || (record.command !== undefined && typeof record.command !== 'string')
    ) return [];
    return [record as ExactTikzDiagnostic];
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get('Retry-After')?.trim() ?? '';
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(250, Math.min(5_000, seconds * 1_000));
  }
  return 1_000;
}

export async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface ExactResponsePayload {
  readonly jobId?: unknown;
  readonly status?: unknown;
  readonly profile?: unknown;
  readonly svg?: unknown;
  readonly attestation?: unknown;
  readonly error?: unknown;
  readonly code?: unknown;
  readonly diagnostics?: unknown;
}

/**
 * Submit and poll one isolated exact-render job. The returned artifact is
 * cryptographically rebound to the exact UTF-8 source bytes supplied here.
 */
export async function requestExactTikzArtifact(
  source: string,
  options: {
    readonly signal: AbortSignal;
    readonly onStatus?: (status: ExactTikzJobStatus) => void;
    readonly timeoutMs?: number;
  },
): Promise<ExactTikzArtifact> {
  let response = await fetch('/api/tikz/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: source }),
    signal: options.signal,
  });
  let payload = await response.json() as ExactResponsePayload;
  let profile: ExactTikzAttestation['profile'] = 'tikz-standard-v1';
  if (
    payload.profile === 'tikz-standard-v1'
    || payload.profile === 'tikz-luatex-graphdrawing-v1'
  ) profile = payload.profile;
  const deadline = Date.now() + Math.max(1, options.timeoutMs ?? JOB_TIMEOUT_MS);

  while (
    response.status === 202
    && typeof payload.jobId === 'string'
    && (payload.status === 'queued' || payload.status === 'running')
  ) {
    options.onStatus?.(payload.status);
    if (Date.now() >= deadline) {
      throw new ExactTikzClientError('TikZ 精确渲染任务等待超时', 'EXACT_RENDER_TIMEOUT');
    }
    await wait(retryDelayMs(response), options.signal);
    response = await fetch(
      `/api/tikz/render/${encodeURIComponent(payload.jobId)}?profile=${encodeURIComponent(profile)}`,
      { signal: options.signal, cache: 'no-store' },
    );
    payload = await response.json() as ExactResponsePayload;
    if (
      payload.profile === 'tikz-standard-v1'
      || payload.profile === 'tikz-luatex-graphdrawing-v1'
    ) profile = payload.profile;
  }

  if (
    !response.ok
    || typeof payload.svg !== 'string'
    || typeof payload.jobId !== 'string'
    || !isExactTikzAttestation(payload.attestation, payload.jobId)
  ) {
    throw new ExactTikzClientError(
      typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`,
      typeof payload.code === 'string' ? payload.code : '',
      exactTikzDiagnostics(payload.diagnostics),
    );
  }
  const sourceDigest = await sha256Utf8(source);
  if (payload.attestation.sourceDigest !== sourceDigest) {
    throw new ExactTikzClientError(
      '精确渲染产物与当前 TikZ 源码不匹配',
      'SOURCE_DIGEST_MISMATCH',
    );
  }
  const svgBytes = new TextEncoder().encode(payload.svg).byteLength;
  if (payload.attestation.svgBytes !== svgBytes) {
    throw new ExactTikzClientError(
      '精确渲染产物字节数与编译证明不匹配',
      'ARTIFACT_SIZE_MISMATCH',
    );
  }
  const artifactDigest = await sha256Utf8(payload.svg);
  if (payload.attestation.artifactDigest !== artifactDigest) {
    throw new ExactTikzClientError(
      '精确渲染产物摘要与编译证明不匹配',
      'ARTIFACT_DIGEST_MISMATCH',
    );
  }
  return { svg: payload.svg, attestation: payload.attestation };
}
import type { TikzExactCompilerProfileId } from '@/lib/tikz/exact/profile-selection';
