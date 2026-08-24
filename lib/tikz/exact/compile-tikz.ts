import { createHash } from 'node:crypto';
import {
  isTikzExactCompilerProfileId,
  selectTikzExactCompilerProfile,
  tikzExactCompilerProfile,
  type TikzExactCompilerProfile,
  type TikzExactCompilerProfileId,
} from './compiler-profile';

const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_COMPILER_JSON_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const JOB_ID = /^j_[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CACHE_KEY_VERSION = 'tikz-cache-key/v3' as const;
const SOURCE_POLICY = 'tikz-untrusted-no-io/v1' as const;

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
  profile: TikzExactCompilerProfileId;
  sourcePolicy: typeof SOURCE_POLICY;
  wrapperId: string;
  wrapperDigest: string;
  bundleIdentity: string;
  profileManifestDigest: string;
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
  profile?: TikzExactCompilerProfileId;
  sourcePolicy?: typeof SOURCE_POLICY;
  wrapperId?: string;
  wrapperDigest?: string;
  bundleIdentity?: string;
  profileManifestDigest?: string;
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

function compilerConfig(
  profile: TikzExactCompilerProfileId,
): { url: string; token: string } {
  const graphDrawing = profile === 'tikz-luatex-graphdrawing-v1';
  const urlVariable = graphDrawing
    ? 'TIKZ_GRAPHDRAWING_COMPILER_URL'
    : 'TIKZ_COMPILER_URL';
  const tokenVariable = graphDrawing
    ? 'TIKZ_GRAPHDRAWING_COMPILER_TOKEN'
    : 'TIKZ_COMPILER_TOKEN';
  const configuredUrl = process.env[urlVariable]?.trim();
  const configuredToken = process.env[tokenVariable]?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  // The native development compiler is intentionally the standard Tectonic
  // profile. Never route Lua graph drawing to it implicitly.
  const url = configuredUrl || (
    !graphDrawing && !isProduction ? 'http://127.0.0.1:8787' : ''
  );
  const token = (
    configuredToken
    || (!graphDrawing && !isProduction ? 'local-tikz-compiler-token' : '')
  );

  if (!url || !token) {
    if (graphDrawing) {
      throw new TikzCompileError(
        '当前源码需要 LuaTeX graph drawing 编译通道；请配置独立的 TIKZ_GRAPHDRAWING_COMPILER_URL 和 TIKZ_GRAPHDRAWING_COMPILER_TOKEN',
        503,
        'GRAPHDRAWING_COMPILER_NOT_CONFIGURED',
      );
    }
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
      `${urlVariable} 不是合法 URL`,
      500,
      'COMPILER_CONFIG_INVALID',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TikzCompileError(
      `${urlVariable} 只允许 http 或 https`,
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

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  errorCode: string,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (
    Number.isFinite(declaredLength)
    && declaredLength >= 0
    && declaredLength > maxBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new TikzCompileError(
      `Compiler response exceeds ${maxBytes} byte limit`,
      502,
      errorCode,
    );
  }

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TikzCompileError(
          `Compiler response exceeds ${maxBytes} byte limit`,
          502,
          errorCode,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function readPayload(response: Response): Promise<CompilerResponse> {
  const bytes = await readResponseBytes(
    response,
    MAX_COMPILER_JSON_BYTES,
    'COMPILER_RESPONSE_TOO_LARGE',
  );
  try {
    return JSON.parse(bytes.toString('utf8')) as CompilerResponse;
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
  | 'profileManifestDigest'
>;

function expectedBundleIdentity(
  profile: TikzExactCompilerProfile,
  compilerImageDigest: string,
): string {
  return `${profile.bundleIdentityPrefix}@${compilerImageDigest}`;
}

function recomputeCacheKey(
  value: Partial<CacheIdentity>,
  expectedProfile: TikzExactCompilerProfile,
): string {
  if (
    value.cacheKeyVersion !== CACHE_KEY_VERSION
    || typeof value.compilerImageDigest !== 'string'
    || value.profile !== expectedProfile.id
    || (value.visibility !== 'public' && value.visibility !== 'private')
    || typeof value.submittedSourceDigest !== 'string'
    || value.sourcePolicy !== SOURCE_POLICY
    || value.wrapperId !== expectedProfile.wrapperId
    || typeof value.wrapperDigest !== 'string'
    || typeof value.bundleIdentity !== 'string'
    || value.profileManifestDigest !== expectedProfile.manifestDigest
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
      value.profileManifestDigest,
    ].join('\0'), 'utf8')
    .digest('hex');
}

function validJobIdentity(
  value: unknown,
  expectedProfileId: TikzExactCompilerProfileId,
  expectedJobId?: string,
  expectedSubmittedSourceDigest?: string,
): value is CompilerJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<CompilerJob>;
  const expectedProfile = tikzExactCompilerProfile(expectedProfileId);
  const recomputedCacheKey = recomputeCacheKey(job, expectedProfile);
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
      === expectedBundleIdentity(expectedProfile, job.compilerImageDigest)
    && job.profileManifestDigest === expectedProfile.manifestDigest
    && job.cacheKeyVersion === CACHE_KEY_VERSION
    && job.profile === expectedProfile.id
    && (job.visibility === 'public' || job.visibility === 'private')
    && job.sourcePolicy === SOURCE_POLICY
    && job.wrapperId === expectedProfile.wrapperId
    && typeof job.wrapperDigest === 'string'
    && SHA256.test(job.wrapperDigest);
}

function validAttestation(
  value: unknown,
  expectedJobId: string,
  expectedProfileId: TikzExactCompilerProfileId,
): value is CompilerArtifactAttestation {
  if (!value || typeof value !== 'object') return false;
  const attestation = value as Partial<CompilerArtifactAttestation>;
  const expectedProfile = tikzExactCompilerProfile(expectedProfileId);
  const recomputedCacheKey = recomputeCacheKey(attestation, expectedProfile);
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
    && attestation.profile === expectedProfile.id
    && (attestation.visibility === 'public' || attestation.visibility === 'private')
    && attestation.sourcePolicy === SOURCE_POLICY
    && attestation.wrapperId === expectedProfile.wrapperId
    && typeof attestation.wrapperDigest === 'string'
    && SHA256.test(attestation.wrapperDigest)
    && typeof attestation.bundleIdentity === 'string'
    && attestation.profileManifestDigest === expectedProfile.manifestDigest
    && typeof attestation.renderer === 'string'
    && attestation.renderer.length > 0
    && typeof attestation.compilerImageDigest === 'string'
    && attestation.compilerImageDigest.length > 0
    && attestation.bundleIdentity
      === expectedBundleIdentity(expectedProfile, attestation.compilerImageDigest)
    && attestation.mediaType === 'image/svg+xml'
    && typeof attestation.svgBytes === 'number'
    && Number.isSafeInteger(attestation.svgBytes)
    && attestation.svgBytes > 0
    && attestation.svgBytes <= expectedProfile.maxSvgBytes
    && typeof attestation.completedAt === 'number'
    && Number.isSafeInteger(attestation.completedAt)
    && attestation.completedAt > 0
  );
}

function assertAttestedSuccess(job: CompilerJob): CompilerArtifactAttestation {
  if (!isTikzExactCompilerProfileId(job.profile)) {
    throw new TikzCompileError(
      '精确编译任务没有受支持的 profile',
      502,
      'INVALID_ARTIFACT_ATTESTATION',
    );
  }
  if (
    job.status !== 'succeeded'
    || !validJobIdentity(job, job.profile, job.id)
    || !validAttestation(job.attestation, job.id, job.profile)
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
    || job.profileManifestDigest !== job.attestation.profileManifestDigest
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
  profile: TikzExactCompilerProfileId,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const { url, token } = compilerConfig(profile);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const callerSignal = init.signal ?? undefined;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

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
    if (
      error instanceof Error && error.name === 'AbortError'
      || (
        typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'AbortError'
      )
    ) {
      if (callerSignal?.aborted) {
        throw new TikzCompileError(
          'TikZ exact compile request was cancelled',
          499,
          'COMPILER_REQUEST_ABORTED',
        );
      }
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
    callerSignal?.removeEventListener('abort', abortFromCaller);
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
  signal?: AbortSignal,
): Promise<CompilerJob> {
  const submittedSource = validateSource(source);
  const selection = selectTikzExactCompilerProfile(submittedSource);
  const profile = selection.profile;
  const expectedSubmittedSourceDigest = createHash('sha256')
    .update(submittedSource, 'utf8')
    .digest('hex');
  const response = await compilerFetch(profile, '/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: submittedSource,
      profile,
      visibility: 'private',
    }),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw compilerError(response, payload);
  }
  if (
    !validJobIdentity(
      payload,
      profile,
      undefined,
      expectedSubmittedSourceDigest,
    )
    || !['queued', 'running', 'succeeded', 'failed'].includes(payload.status ?? '')
  ) {
    throw new TikzCompileError(
      '精确编译任务身份与当前编译 profile 不一致，请重启或更新 compiler 服务',
      502,
      'INVALID_JOB_IDENTITY',
    );
  }
  const job = payload as CompilerJob;
  if (job.status === 'succeeded') assertAttestedSuccess(job);
  return job;
}

export async function getTikzCompileJob(
  jobId: string,
  signal?: AbortSignal,
  profile: TikzExactCompilerProfileId = 'tikz-standard-v1',
): Promise<CompilerJob> {
  if (!JOB_ID.test(jobId)) {
    throw new TikzCompileError('非法编译任务 ID', 400, 'INVALID_JOB_ID');
  }
  const response = await compilerFetch(profile, `/v1/jobs/${jobId}`, {
    method: 'GET',
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw compilerError(response, payload);
  }
  if (
    !validJobIdentity(payload, profile, jobId)
    || !['queued', 'running', 'succeeded', 'failed'].includes(payload.status ?? '')
  ) {
    throw new TikzCompileError(
      '精确编译任务身份与当前编译 profile 不一致，请重启或更新 compiler 服务',
      502,
      'INVALID_JOB_IDENTITY',
    );
  }
  const job = payload as CompilerJob;
  if (job.status === 'succeeded') assertAttestedSuccess(job);
  return job;
}

export async function fetchTikzCompileArtifact(
  jobId: string,
  attestation: CompilerArtifactAttestation,
  signal?: AbortSignal,
): Promise<string> {
  if (!JOB_ID.test(jobId)) {
    throw new TikzCompileError('非法编译任务 ID', 400, 'INVALID_JOB_ID');
  }
  if (
    !isTikzExactCompilerProfileId(attestation.profile)
    || !validAttestation(attestation, jobId, attestation.profile)
  ) {
    throw new TikzCompileError(
      '精确编译产物证明无效',
      502,
      'INVALID_ARTIFACT_ATTESTATION',
    );
  }
  const response = await compilerFetch(
    attestation.profile,
    `/v1/jobs/${jobId}/artifact`,
    { method: 'GET', signal },
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
  const artifact = await readResponseBytes(
    response,
    tikzExactCompilerProfile(attestation.profile).maxSvgBytes,
    'ARTIFACT_TOO_LARGE',
  );
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

export async function compileTikzToSvg(
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  let job = await createTikzCompileJob(source, signal);
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() >= deadline) {
      throw new TikzCompileError(
        'TikZ 精确编译任务等待超时',
        504,
        'JOB_TIMEOUT',
      );
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new TikzCompileError(
          'TikZ exact compile request was cancelled',
          499,
          'COMPILER_REQUEST_ABORTED',
        ));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 250);
      if (signal?.aborted) {
        abort();
      } else {
        signal?.addEventListener('abort', abort, { once: true });
      }
    });
    job = await getTikzCompileJob(
      job.id,
      signal,
      job.profile ?? 'tikz-standard-v1',
    );
  }
  if (job.status === 'failed') {
    throw new TikzCompileError(
      job.error || 'TikZ 精确编译失败',
      422,
      job.errorCode || 'COMPILE_FAILED',
    );
  }
  return fetchTikzCompileArtifact(job.id, assertAttestedSuccess(job), signal);
}
