import { createHash } from 'node:crypto';

const MAX_SOURCE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const JOB_ID = /^j_[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CACHE_KEY_VERSION = 'tikz-cache-key/v2' as const;
const COMPILER_PROFILE = 'tikz-standard-v1' as const;
const SOURCE_POLICY = 'tikz-untrusted-no-io/v1' as const;
const WRAPPER_ID = 'tikz-standalone-dvisvgm/v1' as const;

export interface CompilerPolicyDiagnostic {
  type: 'source-policy';
  severity: 'error';
  policy: typeof SOURCE_POLICY;
  rule: string;
  start: number;
  end: number;
  command?: string;
}

export interface CompilerArtifactAttestation {
  schemaVersion: 'tikz-artifact-attestation/v1';
  jobId: string;
  cacheKeyVersion: typeof CACHE_KEY_VERSION;
  sourceDigest: string;
  submittedSourceDigest: string;
  executedSourceDigest: string;
  executedDocumentDigest: string;
  cacheKeyDigest: string;
  artifactDigest: string;
  profile: typeof COMPILER_PROFILE;
  sourcePolicy: typeof SOURCE_POLICY;
  wrapperId: typeof WRAPPER_ID;
  wrapperDigest: string;
  bundleIdentity: string;
  visibility: 'public' | 'private';
  renderer: string;
  compilerImageDigest: string;
  mediaType: 'image/svg+xml';
  svgBytes: number;
  completedAt: number;
}

export interface CompilerJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  cacheKeyVersion?: typeof CACHE_KEY_VERSION;
  cacheKeyDigest?: string;
  compilerImageDigest?: string;
  sourceDigest?: string;
  submittedSourceDigest?: string;
  executedSourceDigest?: string;
  executedDocumentDigest?: string;
  profile?: typeof COMPILER_PROFILE;
  sourcePolicy?: typeof SOURCE_POLICY;
  wrapperId?: typeof WRAPPER_ID;
  wrapperDigest?: string;
  bundleIdentity?: string;
  visibility?: 'public' | 'private';
  renderer?: string;
  artifactUrl?: string | null;
  attestation?: CompilerArtifactAttestation | null;
  error?: string;
  errorCode?: string;
  diagnostics?: CompilerPolicyDiagnostic[];
}

interface CompilerResponse extends Partial<CompilerJob> {
  svg?: unknown;
  error?: string;
  code?: unknown;
}

export class TikzCompileError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly code = 'COMPILE_FAILED',
    readonly diagnostics: CompilerPolicyDiagnostic[] = [],
  ) {
    super(message);
    this.name = 'TikzCompileError';
  }
}

function sourcePolicyDiagnostic(
  rule: string,
  start: number,
  end: number,
): CompilerPolicyDiagnostic {
  return {
    type: 'source-policy',
    severity: 'error',
    policy: SOURCE_POLICY,
    rule,
    start,
    end,
  };
}

function sourceWithoutComments(source: string): string {
  let view = '';
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset];
    if (character === '\\' && offset + 1 < source.length) {
      view += character + source[offset + 1];
      offset += 2;
      continue;
    }
    if (character === '%') {
      view += ' ';
      offset += 1;
      while (
        offset < source.length
        && source[offset] !== '\r'
        && source[offset] !== '\n'
      ) {
        view += ' ';
        offset += 1;
      }
      continue;
    }
    view += character;
    offset += 1;
  }
  return view;
}

function validateSource(source: string): string {
  if (typeof source !== 'string') {
    throw new TikzCompileError('source must be a string', 400, 'INVALID_SOURCE');
  }
  if (source.startsWith('\uFEFF')) {
    throw new TikzCompileError(
      'UTF-8 BOM is not allowed in TikZ source',
      400,
      'SOURCE_BOM_NOT_ALLOWED',
      [sourcePolicyDiagnostic('utf8-bom', 0, 1)],
    );
  }
  if (Buffer.from(source, 'utf8').toString('utf8') !== source) {
    throw new TikzCompileError(
      'TikZ source must contain only valid Unicode scalar values',
      400,
      'INVALID_UTF8_SOURCE',
    );
  }
  if (!/\S/u.test(source)) {
    throw new TikzCompileError('TikZ 源码为空', 400, 'EMPTY_SOURCE');
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new TikzCompileError(
      'TikZ 源码超过 128KB 上限',
      413,
      'SOURCE_TOO_LARGE',
    );
  }
  const structuralView = sourceWithoutComments(source);
  const begins = [...structuralView.matchAll(/\\begin\{tikzpicture\}/g)];
  const ends = [...structuralView.matchAll(/\\end\{tikzpicture\}/g)];
  if (
    begins.length !== 1
    || ends.length !== 1
    || (begins[0].index ?? -1) >= (ends[0].index ?? -1)
  ) {
    throw new TikzCompileError(
      '源码必须包含完整的 tikzpicture 环境',
      400,
      'INVALID_DOCUMENT',
    );
  }
  return source;
}

function compilerConfig(): { url: string; token: string } {
  const configuredUrl = process.env.TIKZ_COMPILER_URL?.trim();
  const configuredToken = process.env.TIKZ_COMPILER_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  const url = configuredUrl || (isProduction ? '' : 'http://127.0.0.1:8787');
  const token = (
    configuredToken
    || (isProduction ? '' : 'local-tikz-compiler-token')
  );

  if (!url || !token) {
    throw new TikzCompileError(
      'TikZ 精确编译服务未配置，请设置 TIKZ_COMPILER_URL 和 TIKZ_COMPILER_TOKEN',
      503,
      'COMPILER_NOT_CONFIGURED',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TikzCompileError(
      'TIKZ_COMPILER_URL 不是合法 URL',
      500,
      'COMPILER_CONFIG_INVALID',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TikzCompileError(
      'TIKZ_COMPILER_URL 只允许 http 或 https',
      500,
      'COMPILER_CONFIG_INVALID',
    );
  }
  return { url: parsed.toString().replace(/\/+$/, ''), token };
}

/**
 * The browser renders this SVG in an isolated <img>. Local fragment references
 * are required by dvisvgm glyphs; active content and external references are not.
 */
export function sanitizeCompiledSvg(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(
      /<(?:iframe|object|embed|image)\b[\s\S]*?<\/(?:iframe|object|embed|image)\s*>/gi,
      '',
    )
    .replace(/<(?:iframe|object|embed|image)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(
      /\s+(href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi,
      (
        _attribute,
        name: string,
        _quoted,
        doubleValue: string,
        singleValue: string,
      ) => {
        const value = doubleValue ?? singleValue ?? '';
        return value.startsWith('#') ? ` ${name}="${value}"` : '';
      },
    )
    .replace(/url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/gi, 'none');
}

async function readPayload(response: Response): Promise<CompilerResponse> {
  try {
    return await response.json() as CompilerResponse;
  } catch {
    return {};
  }
}

function readPolicyDiagnostics(value: unknown): CompilerPolicyDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const diagnostic = entry as Partial<CompilerPolicyDiagnostic>;
    if (
      diagnostic.type !== 'source-policy'
      || diagnostic.severity !== 'error'
      || diagnostic.policy !== SOURCE_POLICY
      || typeof diagnostic.rule !== 'string'
      || typeof diagnostic.start !== 'number'
      || !Number.isSafeInteger(diagnostic.start)
      || diagnostic.start < 0
      || typeof diagnostic.end !== 'number'
      || !Number.isSafeInteger(diagnostic.end)
      || diagnostic.end < diagnostic.start
      || (
        diagnostic.command !== undefined
        && typeof diagnostic.command !== 'string'
      )
    ) return [];
    return [diagnostic as CompilerPolicyDiagnostic];
  });
}

type CacheIdentity = Pick<
  CompilerArtifactAttestation,
  | 'cacheKeyVersion'
  | 'compilerImageDigest'
  | 'profile'
  | 'visibility'
  | 'submittedSourceDigest'
  | 'sourcePolicy'
  | 'wrapperId'
  | 'wrapperDigest'
  | 'bundleIdentity'
>;

function expectedBundleIdentity(compilerImageDigest: string): string {
  return `tectonic-only-cached@${compilerImageDigest}`;
}

function recomputeCacheKey(value: Partial<CacheIdentity>): string {
  if (
    value.cacheKeyVersion !== CACHE_KEY_VERSION
    || typeof value.compilerImageDigest !== 'string'
    || value.profile !== COMPILER_PROFILE
    || (value.visibility !== 'public' && value.visibility !== 'private')
    || typeof value.submittedSourceDigest !== 'string'
    || value.sourcePolicy !== SOURCE_POLICY
    || value.wrapperId !== WRAPPER_ID
    || typeof value.wrapperDigest !== 'string'
    || typeof value.bundleIdentity !== 'string'
  ) return '';
  return createHash('sha256')
    .update([
      value.cacheKeyVersion,
      value.compilerImageDigest,
      value.profile,
      value.visibility,
      value.submittedSourceDigest,
      value.sourcePolicy,
      value.wrapperId,
      value.wrapperDigest,
      value.bundleIdentity,
    ].join('\0'), 'utf8')
    .digest('hex');
}

function validJobIdentity(
  value: unknown,
  expectedJobId?: string,
  expectedSubmittedSourceDigest?: string,
): value is CompilerJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<CompilerJob>;
  const recomputedCacheKey = recomputeCacheKey(job);
  return typeof job.id === 'string'
    && JOB_ID.test(job.id)
    && (expectedJobId === undefined || job.id === expectedJobId)
    && typeof job.cacheKeyDigest === 'string'
    && SHA256.test(job.cacheKeyDigest)
    && job.cacheKeyDigest === recomputedCacheKey
    && job.id === `j_${job.cacheKeyDigest}`
    && typeof job.sourceDigest === 'string'
    && SHA256.test(job.sourceDigest)
    && typeof job.submittedSourceDigest === 'string'
    && job.sourceDigest === job.submittedSourceDigest
    && (
      expectedSubmittedSourceDigest === undefined
      || job.submittedSourceDigest === expectedSubmittedSourceDigest
    )
    && (
      job.executedSourceDigest === undefined
      || job.executedSourceDigest === job.submittedSourceDigest
    )
    && (
      job.executedDocumentDigest === undefined
      || SHA256.test(job.executedDocumentDigest)
    )
    && typeof job.compilerImageDigest === 'string'
    && job.compilerImageDigest.length > 0
    && job.bundleIdentity
      === expectedBundleIdentity(job.compilerImageDigest)
    && job.cacheKeyVersion === CACHE_KEY_VERSION
    && job.profile === COMPILER_PROFILE
    && (job.visibility === 'public' || job.visibility === 'private')
    && job.sourcePolicy === SOURCE_POLICY
    && job.wrapperId === WRAPPER_ID
    && typeof job.wrapperDigest === 'string'
    && SHA256.test(job.wrapperDigest);
}

function validAttestation(
  value: unknown,
  expectedJobId: string,
): value is CompilerArtifactAttestation {
  if (!value || typeof value !== 'object') return false;
  const attestation = value as Partial<CompilerArtifactAttestation>;
  const recomputedCacheKey = recomputeCacheKey(attestation);
  return (
    attestation.schemaVersion === 'tikz-artifact-attestation/v1'
    && attestation.jobId === expectedJobId
    && attestation.cacheKeyVersion === CACHE_KEY_VERSION
    && typeof attestation.sourceDigest === 'string'
    && SHA256.test(attestation.sourceDigest)
    && typeof attestation.submittedSourceDigest === 'string'
    && attestation.sourceDigest === attestation.submittedSourceDigest
    && typeof attestation.executedSourceDigest === 'string'
    && attestation.executedSourceDigest === attestation.submittedSourceDigest
    && typeof attestation.executedDocumentDigest === 'string'
    && SHA256.test(attestation.executedDocumentDigest)
    && typeof attestation.cacheKeyDigest === 'string'
    && SHA256.test(attestation.cacheKeyDigest)
    && attestation.cacheKeyDigest === recomputedCacheKey
    && expectedJobId === `j_${attestation.cacheKeyDigest}`
    && typeof attestation.artifactDigest === 'string'
    && SHA256.test(attestation.artifactDigest)
    && attestation.profile === COMPILER_PROFILE
    && (attestation.visibility === 'public' || attestation.visibility === 'private')
    && attestation.sourcePolicy === SOURCE_POLICY
    && attestation.wrapperId === WRAPPER_ID
    && typeof attestation.wrapperDigest === 'string'
    && SHA256.test(attestation.wrapperDigest)
    && typeof attestation.bundleIdentity === 'string'
    && typeof attestation.renderer === 'string'
    && attestation.renderer.length > 0
    && typeof attestation.compilerImageDigest === 'string'
    && attestation.compilerImageDigest.length > 0
    && attestation.bundleIdentity
      === expectedBundleIdentity(attestation.compilerImageDigest)
    && attestation.mediaType === 'image/svg+xml'
    && typeof attestation.svgBytes === 'number'
    && Number.isSafeInteger(attestation.svgBytes)
    && attestation.svgBytes > 0
    && typeof attestation.completedAt === 'number'
    && Number.isSafeInteger(attestation.completedAt)
    && attestation.completedAt > 0
  );
}

function assertAttestedSuccess(job: CompilerJob): CompilerArtifactAttestation {
  if (
    job.status !== 'succeeded'
    || !validJobIdentity(job, job.id)
    || !validAttestation(job.attestation, job.id)
    || job.sourceDigest !== job.attestation.sourceDigest
    || job.submittedSourceDigest !== job.attestation.submittedSourceDigest
    || job.executedSourceDigest !== job.attestation.executedSourceDigest
    || job.executedDocumentDigest !== job.attestation.executedDocumentDigest
    || job.cacheKeyVersion !== job.attestation.cacheKeyVersion
    || job.cacheKeyDigest !== job.attestation.cacheKeyDigest
    || job.compilerImageDigest !== job.attestation.compilerImageDigest
    || job.profile !== job.attestation.profile
    || job.sourcePolicy !== job.attestation.sourcePolicy
    || job.wrapperId !== job.attestation.wrapperId
    || job.wrapperDigest !== job.attestation.wrapperDigest
    || job.bundleIdentity !== job.attestation.bundleIdentity
  ) {
    throw new TikzCompileError(
      '精确编译任务缺少可验证的产物证明',
      502,
      'INVALID_ARTIFACT_ATTESTATION',
    );
  }
  return job.attestation;
}

async function compilerFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const { url, token } = compilerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TikzCompileError(
        'TikZ 精确编译请求超时，请稍后重试',
        504,
        'COMPILER_TIMEOUT',
      );
    }
    throw new TikzCompileError(
      'TikZ 精确编译服务不可用，请确认独立 compiler 服务已启动',
      503,
      'COMPILER_UNAVAILABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function compilerError(
  response: Response,
  payload: CompilerResponse,
): TikzCompileError {
  return new TikzCompileError(
    typeof payload.error === 'string'
      ? payload.error
      : `精确编译返回 HTTP ${response.status}`,
    response.status,
    typeof payload.errorCode === 'string'
      ? payload.errorCode
      : typeof payload.code === 'string'
        ? payload.code
        : 'COMPILER_REJECTED',
    readPolicyDiagnostics(payload.diagnostics),
  );
}

export async function createTikzCompileJob(
  source: string,
): Promise<CompilerJob> {
  const submittedSource = validateSource(source);
  const expectedSubmittedSourceDigest = createHash('sha256')
    .update(submittedSource, 'utf8')
    .digest('hex');
  const response = await compilerFetch('/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: submittedSource,
      profile: COMPILER_PROFILE,
      visibility: 'private',
    }),
  });
  const payload = await readPayload(response);
  if (
    !response.ok
    || !validJobIdentity(
      payload,
      undefined,
      expectedSubmittedSourceDigest,
    )
    || !['queued', 'running', 'succeeded', 'failed'].includes(payload.status ?? '')
  ) {
    throw compilerError(response, payload);
  }
  const job = payload as CompilerJob;
  if (job.status === 'succeeded') assertAttestedSuccess(job);
  return job;
}

export async function getTikzCompileJob(jobId: string): Promise<CompilerJob> {
  if (!JOB_ID.test(jobId)) {
    throw new TikzCompileError('非法编译任务 ID', 400, 'INVALID_JOB_ID');
  }
  const response = await compilerFetch(`/v1/jobs/${jobId}`, { method: 'GET' });
  const payload = await readPayload(response);
  if (
    !response.ok
    || !validJobIdentity(payload, jobId)
    || !['queued', 'running', 'succeeded', 'failed'].includes(payload.status ?? '')
  ) {
    throw compilerError(response, payload);
  }
  const job = payload as CompilerJob;
  if (job.status === 'succeeded') assertAttestedSuccess(job);
  return job;
}

export async function fetchTikzCompileArtifact(
  jobId: string,
  attestation: CompilerArtifactAttestation,
): Promise<string> {
  if (!JOB_ID.test(jobId)) {
    throw new TikzCompileError('非法编译任务 ID', 400, 'INVALID_JOB_ID');
  }
  if (!validAttestation(attestation, jobId)) {
    throw new TikzCompileError(
      '精确编译产物证明无效',
      502,
      'INVALID_ARTIFACT_ATTESTATION',
    );
  }
  const response = await compilerFetch(
    `/v1/jobs/${jobId}/artifact`,
    { method: 'GET' },
  );
  if (!response.ok) {
    throw compilerError(response, await readPayload(response));
  }
  const responseDigest = response.headers.get('X-Artifact-SHA256');
  if (responseDigest !== attestation.artifactDigest) {
    throw new TikzCompileError(
      '精确编译产物响应摘要与证明不一致',
      502,
      'ARTIFACT_HEADER_MISMATCH',
    );
  }
  const artifact = Buffer.from(await response.arrayBuffer());
  const observedDigest = createHash('sha256').update(artifact).digest('hex');
  if (observedDigest !== attestation.artifactDigest) {
    throw new TikzCompileError(
      '精确编译产物内容完整性验证失败',
      502,
      'ARTIFACT_DIGEST_MISMATCH',
    );
  }
  if (artifact.byteLength !== attestation.svgBytes) {
    throw new TikzCompileError(
      '精确编译产物字节数与证明不一致',
      502,
      'ARTIFACT_SIZE_MISMATCH',
    );
  }
  const decoded = artifact.toString('utf8');
  if (!decoded.includes('<svg')) {
    throw new TikzCompileError(
      '精确编译服务未生成 SVG',
      502,
      'INVALID_COMPILER_RESPONSE',
    );
  }
  if (sanitizeCompiledSvg(decoded) !== decoded) {
    throw new TikzCompileError(
      '精确编译产物包含未在 Worker 边界移除的主动内容',
      502,
      'UNSAFE_COMPILER_ARTIFACT',
    );
  }
  return decoded;
}

export async function compileTikzToSvg(source: string): Promise<string> {
  let job = await createTikzCompileJob(source);
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() >= deadline) {
      throw new TikzCompileError(
        'TikZ 精确编译任务等待超时',
        504,
        'JOB_TIMEOUT',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = await getTikzCompileJob(job.id);
  }
  if (job.status === 'failed') {
    throw new TikzCompileError(
      job.error || 'TikZ 精确编译失败',
      422,
      job.errorCode || 'COMPILE_FAILED',
    );
  }
  return fetchTikzCompileArtifact(job.id, assertAttestedSuccess(job));
}
