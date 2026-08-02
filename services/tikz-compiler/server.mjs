import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createArtifactStore } from './artifact-store.mjs';
import {
  compileCacheKeyDigest,
  compilerInputIdentity,
  CompilerError,
  TIKZ_CACHE_KEY_VERSION,
  TIKZ_COMPILER_PROFILE,
  validateTikzSource,
} from './compiler-core.mjs';
import { RedisJobStore } from './job-store.mjs';
import {
  compilerRedisPrefix,
  compilerWorkerImageDigest,
} from './provenance.mjs';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const token = process.env.COMPILER_TOKEN?.trim() ?? '';
const compilerImageDigest = compilerWorkerImageDigest();
const inputIdentity = compilerInputIdentity(compilerImageDigest);
const maxBodyBytes = 140 * 1024;
const jobStore = await new RedisJobStore({
  prefix: compilerRedisPrefix(compilerImageDigest),
}).connect();
const artifactStore = createArtifactStore();
let shuttingDown = false;

if (!token) {
  throw new Error('COMPILER_TOKEN is required');
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function authorized(request) {
  const header = request.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      throw new CompilerError('请求体超过大小限制', 413, 'BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(chunks));
  } catch {
    throw new CompilerError(
      'Request body must be valid UTF-8',
      400,
      'INVALID_UTF8_JSON',
    );
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new CompilerError('请求体不是合法 JSON', 400, 'INVALID_JSON');
  }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    cacheKeyVersion: job.cacheKeyVersion,
    cacheKeyDigest: job.cacheKeyDigest,
    compilerImageDigest: job.compilerImageDigest,
    sourceDigest: job.sourceDigest,
    submittedSourceDigest: job.submittedSourceDigest,
    executedSourceDigest: job.executedSourceDigest,
    executedDocumentDigest: job.executedDocumentDigest,
    profile: job.profile,
    sourcePolicy: job.sourcePolicy,
    wrapperId: job.wrapperId,
    wrapperDigest: job.wrapperDigest,
    bundleIdentity: job.bundleIdentity,
    visibility: job.visibility,
    attempt: job.attempt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    artifactUrl: job.artifactUrl ?? null,
    renderer: job.renderer,
    compileMs: job.compileMs,
    convertMs: job.convertMs,
    svgBytes: job.svgBytes,
    attestation: job.attestation ?? null,
    error: job.error,
    errorCode: job.errorCode,
    diagnostics: job.diagnostics,
  };
}

function jobIdFrom(pathname) {
  const match = /^\/v1\/jobs\/(j_[a-f0-9]{64})(?:\/artifact)?$/.exec(pathname);
  return match?.[1] ?? null;
}

async function handle(request, response) {
  const requestUrl = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );

  if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
    try {
      const redis = await jobStore.ping();
      json(response, 200, { ok: redis, redis, ...(await jobStore.stats()) });
    } catch {
      json(response, 503, { ok: false, redis: false });
    }
    return;
  }

  if (!authorized(request)) {
    json(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/v1/jobs') {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      json(response, 415, {
        error: 'Content-Type 必须为 application/json',
        code: 'UNSUPPORTED_MEDIA',
      });
      return;
    }

    const body = await readJson(request);
    const source = validateTikzSource(body?.source);
    const profile = body?.profile ?? TIKZ_COMPILER_PROFILE;
    if (profile !== TIKZ_COMPILER_PROFILE) {
      throw new CompilerError('未知的编译 profile', 400, 'INVALID_PROFILE');
    }
    const visibility = body?.visibility === 'public' ? 'public' : 'private';
    const submittedSourceDigest = createHash('sha256')
      .update(source, 'utf8')
      .digest('hex');
    const cacheKeyDigest = compileCacheKeyDigest({
      compilerImageDigest,
      profile,
      visibility,
      submittedSourceDigest,
      ...inputIdentity,
    });
    const jobId = `j_${cacheKeyDigest}`;
    const { job, created } = await jobStore.createJob({
      jobId,
      sourceDigest: submittedSourceDigest,
      submittedSourceDigest,
      cacheKeyVersion: TIKZ_CACHE_KEY_VERSION,
      cacheKeyDigest,
      compilerImageDigest,
      source,
      profile,
      visibility,
      ...inputIdentity,
    });
    const status = job.status === 'queued' || job.status === 'running' ? 202 : 200;
    json(
      response,
      status,
      { ...publicJob(job), created },
      status === 202 ? { 'Retry-After': '1' } : {},
    );
    return;
  }

  const jobId = jobIdFrom(requestUrl.pathname);
  if (request.method === 'GET' && jobId && requestUrl.pathname.endsWith('/artifact')) {
    const job = await jobStore.getJob(jobId);
    if (!job) {
      json(response, 404, {
        error: '编译任务不存在或已过期',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }
    if (job.status !== 'succeeded' || !job.artifactKey) {
      json(response, 409, {
        error: '编译产物尚未就绪',
        code: 'ARTIFACT_NOT_READY',
      });
      return;
    }
    const svg = await artifactStore.get(job.artifactKey);
    const artifactDigest = job.attestation?.artifactDigest;
    if (
      typeof artifactDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(artifactDigest)
    ) {
      throw new CompilerError(
        '编译产物缺少完整性证明',
        500,
        'ARTIFACT_ATTESTATION_MISSING',
      );
    }
    const observedDigest = createHash('sha256').update(svg).digest('hex');
    if (observedDigest !== artifactDigest) {
      throw new CompilerError(
        '编译产物完整性验证失败',
        502,
        'ARTIFACT_DIGEST_MISMATCH',
      );
    }
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Length': String(svg.length),
      'Cache-Control': job.visibility === 'public'
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      'Content-Digest': `sha-256=:${Buffer.from(artifactDigest, 'hex').toString('base64')}:`,
      ETag: `"sha256:${artifactDigest}"`,
      'X-Artifact-SHA256': artifactDigest,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(svg);
    return;
  }

  if (request.method === 'GET' && jobId) {
    const job = await jobStore.getJob(jobId);
    if (!job) {
      json(response, 404, {
        error: '编译任务不存在或已过期',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }
    const status = job.status === 'queued' || job.status === 'running' ? 202 : 200;
    json(
      response,
      status,
      publicJob(job),
      status === 202 ? { 'Retry-After': '1' } : {},
    );
    return;
  }

  json(response, 404, { error: 'Not found', code: 'NOT_FOUND' });
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof CompilerError ? error.status : 500;
    const code = error instanceof CompilerError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : 'TikZ 编译服务失败';
    const diagnostics = error instanceof CompilerError
      && Array.isArray(error.diagnostics)
      && error.diagnostics.length > 0
      ? { diagnostics: error.diagnostics }
      : {};
    json(
      response,
      status,
      { error: message, code, ...diagnostics },
      status === 429 ? { 'Retry-After': '2' } : {},
    );
  });
});

server.listen(port, host, () => {
  process.stdout.write(`tikz-compiler-api listening on http://${host}:${port}\n`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolve) => server.close(resolve));
  await jobStore.close();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
