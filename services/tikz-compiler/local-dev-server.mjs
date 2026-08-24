import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compileCacheKeyDigest,
  compilerInputIdentity,
  CompilerError,
  createCompiler,
  TIKZ_CACHE_KEY_VERSION,
  TIKZ_COMPILER_PROFILE,
  validateTikzSource,
} from './compiler-core.mjs';
import { createLocalJobRegistry } from './local-job-registry.mjs';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The native compiler is development-only. Use the isolated ECS worker in production.');
}

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const token = process.env.COMPILER_TOKEN?.trim() || 'local-tikz-compiler-token';
const dvisvgmPath = process.env.DVISVGM_PATH || 'dvisvgm';
const requestedLocalEngine = process.env.TIKZ_LOCAL_TEX_ENGINE?.trim().toLowerCase()
  || 'auto';
const allowedLocalEngines = new Set([
  'auto', 'tectonic', 'xelatex', 'pdflatex', 'lualatex',
]);
if (!allowedLocalEngines.has(requestedLocalEngine)) {
  throw new Error(`Unsupported TIKZ_LOCAL_TEX_ENGINE: ${requestedLocalEngine}`);
}
if (
  TIKZ_COMPILER_PROFILE === 'tikz-luatex-graphdrawing-v1'
  && !['auto', 'lualatex'].includes(requestedLocalEngine)
) {
  throw new Error('The graphdrawing profile requires TIKZ_LOCAL_TEX_ENGINE=lualatex.');
}
if (
  TIKZ_COMPILER_PROFILE === 'tikz-standard-v1'
  && requestedLocalEngine === 'lualatex'
) {
  throw new Error('LuaLaTeX is reserved for the tikz-luatex-graphdrawing-v1 profile.');
}
const localRuntimeLogDirectory = process.env.MIKTEX_LOG_DIR?.trim()
  || join(tmpdir(), 'math-geohub-miktex-logs');
await mkdir(localRuntimeLogDirectory, { recursive: true });
// Keep MiKTeX maintenance logs outside source workspaces and make sandboxed
// local development behave like an ordinary terminal. compiler-core forwards
// this one runtime-specific variable to every TeX/dvisvgm child.
process.env.MIKTEX_LOG_DIR = localRuntimeLogDirectory;

function probeExecutable(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (available, detail = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        available,
        detail: detail.replace(/\s+/gu, ' ').trim().slice(0, 240),
      });
    };
    const capture = (chunk) => {
      if (bytes >= 4_096) return;
      const remaining = 4_096 - bytes;
      const value = chunk.subarray(0, remaining);
      chunks.push(value);
      bytes += value.length;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', () => finish(false, 'not found or not executable'));
    child.once('close', (code) => finish(
      code === 0,
      code === 0
        ? Buffer.concat(chunks).toString('utf8')
        : `version probe exited ${code ?? -1}`,
    ));
    const timer = setTimeout(() => {
      child.kill();
      finish(false, 'version probe timed out');
    }, 5_000);
  });
}

function compilerCommand(engine) {
  if (engine === 'tectonic') return process.env.TECTONIC_PATH?.trim() || 'tectonic';
  if (engine === 'xelatex') return process.env.XELATEX_PATH?.trim() || 'xelatex';
  if (engine === 'pdflatex') return process.env.PDFLATEX_PATH?.trim() || 'pdflatex';
  return process.env.LUALATEX_PATH?.trim() || 'lualatex';
}

const engineOrder = TIKZ_COMPILER_PROFILE === 'tikz-luatex-graphdrawing-v1'
  ? ['lualatex']
  : requestedLocalEngine === 'auto'
    // XeLaTeX is the closest installed fallback to Tectonic's Unicode/XeTeX
    // behavior. pdfLaTeX remains useful for minimal ASCII installations.
    ? ['tectonic', 'xelatex', 'pdflatex']
    : [requestedLocalEngine];
const [compilerRuntimes, dvisvgmRuntime] = await Promise.all([
  Promise.all(engineOrder.map(async (engine) => ({
    engine,
    command: compilerCommand(engine),
    ...await probeExecutable(compilerCommand(engine)),
  }))),
  probeExecutable(dvisvgmPath),
]);
const selectedCompilerRuntime = compilerRuntimes.find((runtime) => runtime.available)
  ?? compilerRuntimes[0];
const selectedEngine = selectedCompilerRuntime?.engine
  ?? (TIKZ_COMPILER_PROFILE === 'tikz-luatex-graphdrawing-v1' ? 'lualatex' : 'tectonic');
const compilerImageDigest = `local-${selectedEngine}-native-dev`;
const profileIdentity = compilerInputIdentity(compilerImageDigest);
const identity = TIKZ_COMPILER_PROFILE === 'tikz-standard-v1'
  && selectedEngine !== 'tectonic'
  ? {
      ...profileIdentity,
      bundleIdentity: `local-${selectedEngine}-dvisvgm@${compilerImageDigest}`,
    }
  : profileIdentity;
const compiler = createCompiler({
  engine: selectedEngine,
  compilerPath: selectedCompilerRuntime?.command ?? compilerCommand(selectedEngine),
  dvisvgmPath,
  // Never let a headless compile wait on MiKTeX's missing-package dialog.
  // A missing package is a deterministic diagnostic; package installation is
  // an explicit product-owner action outside the renderer.
  disablePackageInstaller: /MiKTeX/iu.test(selectedCompilerRuntime?.detail ?? ''),
  // A cold native engine cache can legitimately take longer than the worker's
  // warm-container budget. Keep this below the browser's 180 s job deadline.
  timeoutMs: Number(process.env.COMPILE_TIMEOUT_MS || 150_000),
  maxQueue: 4,
});
const jobs = createLocalJobRegistry();
const unverifiedMiktexGraphdrawing = (
  TIKZ_COMPILER_PROFILE === 'tikz-luatex-graphdrawing-v1'
  && /MiKTeX/iu.test(selectedCompilerRuntime?.detail ?? '')
  && process.env.TIKZ_ALLOW_MIKTEX_GRAPHDRAWING !== '1'
);
const runtimeReady = Boolean(selectedCompilerRuntime?.available)
  && dvisvgmRuntime.available
  && !unverifiedMiktexGraphdrawing;
const missingRuntimeNames = [
  ...(selectedCompilerRuntime?.available
    ? []
    : [`TeX engine (${engineOrder.join(' / ')})`]),
  ...(dvisvgmRuntime.available ? [] : ['dvisvgm']),
  ...(unverifiedMiktexGraphdrawing
    ? ['TeX Live LuaLaTeX（本机 MiKTeX graphdrawing 未通过无交互运行时验证）']
    : []),
];
const localRuntimeMode = `local-${selectedEngine}-native-dev`;

function queuedJob(id, cacheKeyDigest, submittedSourceDigest, visibility) {
  return {
    id,
    status: 'queued',
    cacheKeyVersion: TIKZ_CACHE_KEY_VERSION,
    cacheKeyDigest,
    compilerImageDigest,
    sourceDigest: submittedSourceDigest,
    submittedSourceDigest,
    profile: TIKZ_COMPILER_PROFILE,
    sourcePolicy: identity.sourcePolicy,
    wrapperId: identity.wrapperId,
    wrapperDigest: identity.wrapperDigest,
    bundleIdentity: identity.bundleIdentity,
    profileManifestDigest: identity.profileManifestDigest,
    visibility,
  };
}

function startLocalCompile({ id, cacheKeyDigest, source, submittedSourceDigest, visibility }) {
  const queued = jobs.get(id);
  if (queued) {
    jobs.set(id, {
      ...queued,
      public: { ...queued.public, status: 'running' },
    });
  }
  void compiler.render(source).then((result) => {
    const artifact = Buffer.from(result.svg, 'utf8');
    const artifactDigest = createHash('sha256').update(artifact).digest('hex');
    const completedAt = Date.now();
    const attestation = {
      schemaVersion: 'tikz-artifact-attestation/v1',
      jobId: id,
      cacheKeyVersion: TIKZ_CACHE_KEY_VERSION,
      sourceDigest: submittedSourceDigest,
      submittedSourceDigest,
      executedSourceDigest: result.executedSourceDigest,
      executedDocumentDigest: result.executedDocumentDigest,
      cacheKeyDigest,
      artifactDigest,
      profile: result.profile,
      sourcePolicy: result.sourcePolicy,
      wrapperId: result.wrapperId,
      wrapperDigest: result.wrapperDigest,
      bundleIdentity: identity.bundleIdentity,
      profileManifestDigest: identity.profileManifestDigest,
      visibility,
      renderer: result.renderer,
      compilerImageDigest,
      mediaType: 'image/svg+xml',
      svgBytes: artifact.length,
      completedAt,
    };
    jobs.set(id, {
      public: {
        ...queuedJob(id, cacheKeyDigest, submittedSourceDigest, visibility),
        status: 'succeeded',
        executedSourceDigest: result.executedSourceDigest,
        executedDocumentDigest: result.executedDocumentDigest,
        renderer: result.renderer,
        completedAt,
        svgBytes: artifact.length,
        attestation,
      },
      artifact,
      artifactDigest,
    });
    process.stdout.write(
      `[tikz-local] ${id} succeeded (${artifact.length} bytes)\n`,
    );
  }).catch((error) => {
    jobs.set(id, {
      public: {
        ...queuedJob(id, cacheKeyDigest, submittedSourceDigest, visibility),
        status: 'failed',
        error: error instanceof Error ? error.message : 'TikZ compile failed',
        code: error instanceof CompilerError ? error.code : 'INTERNAL_ERROR',
        diagnostics: error instanceof CompilerError ? error.diagnostics : [],
        completedAt: Date.now(),
      },
      artifact: null,
      artifactDigest: null,
    });
    process.stderr.write(
      `[tikz-local] ${id} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
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
  const supplied = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7)
    : '';
  const left = Buffer.from(token);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 140 * 1024) throw new CompilerError('请求体过大', 413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CompilerError('请求体不是合法 JSON', 400, 'INVALID_JSON');
  }
}

function jobId(pathname) {
  return /^\/v1\/jobs\/(j_[a-f0-9]{64})(?:\/artifact)?$/u.exec(pathname)?.[1] ?? null;
}

async function handle(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    json(response, runtimeReady ? 200 : 503, {
      ok: runtimeReady,
      ready: runtimeReady,
      mode: localRuntimeMode,
      profile: TIKZ_COMPILER_PROFILE,
      profileManifestDigest: identity.profileManifestDigest,
      runtime: {
        requestedEngine: requestedLocalEngine,
        selectedEngine,
        compiler: selectedCompilerRuntime,
        candidates: compilerRuntimes,
        dvisvgm: dvisvgmRuntime,
        logDirectory: localRuntimeLogDirectory,
        graphdrawingRuntimeVerified: !unverifiedMiktexGraphdrawing,
      },
      ...compiler.stats(),
    });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    const body = await readJson(request);
    if (!runtimeReady) {
      throw new CompilerError(
        `本地精准编译运行时不可用：缺少 ${missingRuntimeNames.join('、')}`,
        503,
        'COMPILER_UNAVAILABLE',
      );
    }
    const source = validateTikzSource(body?.source);
    if ((body?.profile ?? TIKZ_COMPILER_PROFILE) !== TIKZ_COMPILER_PROFILE) {
      throw new CompilerError('未知编译 profile', 400, 'INVALID_PROFILE');
    }
    const visibility = body?.visibility === 'public' ? 'public' : 'private';
    const submittedSourceDigest = createHash('sha256').update(source, 'utf8').digest('hex');
    const cacheKeyDigest = compileCacheKeyDigest({
      compilerImageDigest,
      profile: TIKZ_COMPILER_PROFILE,
      visibility,
      submittedSourceDigest,
      ...identity,
    });
    const id = `j_${cacheKeyDigest}`;
    const cached = jobs.getForSubmission(id);
    if (cached) {
      json(response, 200, cached.public);
      return;
    }
    const publicJob = queuedJob(
      id,
      cacheKeyDigest,
      submittedSourceDigest,
      visibility,
    );
    if (!jobs.set(id, { public: publicJob, artifact: null, artifactDigest: null })) {
      throw new CompilerError(
        '本地精确渲染任务已达容量上限，请等待当前任务完成后重试',
        429,
        'LOCAL_JOB_CAPACITY',
      );
    }
    startLocalCompile({
      id,
      cacheKeyDigest,
      source,
      submittedSourceDigest,
      visibility,
    });
    json(response, 202, publicJob);
    return;
  }
  const id = jobId(url.pathname);
  const job = id ? jobs.get(id) : null;
  if (request.method === 'GET' && id && url.pathname.endsWith('/artifact')) {
    if (job && (!job.artifact || !job.artifactDigest)) {
      json(response, 409, { error: 'Artifact is not ready', code: 'JOB_NOT_READY' });
      return;
    }
    if (!job) {
      json(response, 404, { error: '任务不存在', code: 'JOB_NOT_FOUND' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Length': String(job.artifact.length),
      'X-Artifact-SHA256': job.artifactDigest,
      'Cache-Control': 'private, no-store',
    });
    response.end(job.artifact);
    return;
  }
  if (request.method === 'GET' && id) {
    if (!job) {
      json(response, 404, { error: '任务不存在', code: 'JOB_NOT_FOUND' });
      return;
    }
    json(response, 200, job.public);
    return;
  }
  json(response, 404, { error: 'Not found', code: 'NOT_FOUND' });
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof CompilerError ? error.status : 500;
    json(response, status, {
      error: error instanceof Error ? error.message : '精确编译失败',
      code: error instanceof CompilerError ? error.code : 'INTERNAL_ERROR',
      diagnostics: error instanceof CompilerError ? error.diagnostics : [],
    });
  });
});

server.listen(port, host, () => {
  process.stdout.write(
    `Local ${selectedEngine} TikZ compiler listening on http://${host}:${port} (${runtimeReady ? 'ready' : `missing ${missingRuntimeNames.join(', ')}`})\n`,
  );
});
