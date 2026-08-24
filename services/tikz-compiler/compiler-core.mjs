import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_QUEUE = 16;
const DEFAULT_CACHE_ENTRIES = 128;
export const TIKZ_CACHE_KEY_VERSION = 'tikz-cache-key/v3';
export const TIKZ_SOURCE_POLICY = 'tikz-untrusted-no-io/v1';
const SUPPORTED_COMPILER_PROFILES = new Set([
  'tikz-standard-v1',
  'tikz-luatex-graphdrawing-v1',
]);
const configuredProfile = process.env.TIKZ_COMPILER_PROFILE?.trim()
  || 'tikz-standard-v1';
if (!SUPPORTED_COMPILER_PROFILES.has(configuredProfile)) {
  throw new Error(`Unsupported TIKZ_COMPILER_PROFILE: ${configuredProfile}`);
}
export const TIKZ_COMPILER_PROFILE = configuredProfile;
const PROFILE_FILE = configuredProfile === 'tikz-luatex-graphdrawing-v1'
  ? 'luatex-graphdrawing-profile.json'
  : 'exact-profile.json';
const PACKAGED_EXACT_PROFILE_URL = new URL(`./${PROFILE_FILE}`, import.meta.url);
const EXACT_PROFILE_URL = existsSync(PACKAGED_EXACT_PROFILE_URL)
  ? PACKAGED_EXACT_PROFILE_URL
  : new URL(`../../lib/tikz/syntax/${PROFILE_FILE}`, import.meta.url);
const EXACT_PROFILE = JSON.parse(readFileSync(EXACT_PROFILE_URL, 'utf8'));
const isGraphDrawingProfile = configuredProfile
  === 'tikz-luatex-graphdrawing-v1';
if (
  EXACT_PROFILE.schemaVersion !== 'tikz-exact-profile/v2'
  || EXACT_PROFILE.profile !== TIKZ_COMPILER_PROFILE
  || EXACT_PROFILE.sourcePolicy !== TIKZ_SOURCE_POLICY
  || typeof EXACT_PROFILE.wrapperId !== 'string'
  || typeof EXACT_PROFILE.bundleIdentityPrefix !== 'string'
  || EXACT_PROFILE.driverPolicy !== 'dvisvgm-paths-exact/v1'
  || EXACT_PROFILE.maxSvgBytes !== 4 * 1024 * 1024
  || (
    isGraphDrawingProfile
      ? (
          EXACT_PROFILE.runtimeCapabilities?.texEngine !== 'lualatex'
          || EXACT_PROFILE.runtimeCapabilities?.executionMode
            !== 'immutable-tree-no-network'
          || EXACT_PROFILE.runtimeCapabilities?.luaExecution !== true
          || EXACT_PROFILE.runtimeCapabilities?.graphDrawing !== 'enabled'
          || !Array.isArray(EXACT_PROFILE.wrapperGraphDrawingLibraries)
        )
      : (
          EXACT_PROFILE.runtimeCapabilities?.texEngine !== 'tectonic'
          || EXACT_PROFILE.runtimeCapabilities?.executionMode !== 'only-cached'
          || EXACT_PROFILE.runtimeCapabilities?.luaExecution !== false
          || EXACT_PROFILE.runtimeCapabilities?.graphDrawing !== 'syntax-only'
          || EXACT_PROFILE.requiredCompanionProfiles?.luaGraphDrawing
            !== 'tikz-luatex-graphdrawing-v1'
        )
  )
  || !Array.isArray(EXACT_PROFILE.wrapperLibraries)
) {
  throw new Error('Invalid TikZ exact profile manifest');
}
export const TIKZ_WRAPPER_ID = EXACT_PROFILE.wrapperId;
const MAX_SVG_BYTES = EXACT_PROFILE.maxSvgBytes;
export const TIKZ_EXACT_PROFILE_MANIFEST_DIGEST = createHash('sha256')
  .update(JSON.stringify(EXACT_PROFILE), 'utf8')
  .digest('hex');
const TIKZ_LIBRARIES = EXACT_PROFILE.wrapperLibraries.join(',');
const GRAPH_DRAWING_LIBRARIES = (
  EXACT_PROFILE.wrapperGraphDrawingLibraries ?? []
).join(',');

const DOCUMENT_PREFIX = [
  '\\documentclass[border=2pt]{standalone}',
  '\\def\\pgfsysdriver{pgfsys-dvisvgm.def}',
  '\\usepackage{iftex}',
  '\\ifPDFTeX\\else',
  '\\usepackage{fontspec}',
  '\\IfFontExistsTF{Noto Sans CJK SC}{\\setmainfont{Noto Sans CJK SC}}{\\IfFontExistsTF{Microsoft YaHei}{\\setmainfont{Microsoft YaHei}}{}}',
  '\\fi',
  '\\usepackage{tikz}',
  '\\usepackage{amsmath}',
  `\\usetikzlibrary{${TIKZ_LIBRARIES}}`,
  ...(GRAPH_DRAWING_LIBRARIES
    ? [`\\usegdlibrary{${GRAPH_DRAWING_LIBRARIES}}`]
    : []),
  '\\begin{document}',
].join('\n') + '\n';
const DOCUMENT_SUFFIX = '\n\\end{document}';
const WRAPPER_TEMPLATE = `${DOCUMENT_PREFIX}<tikz-source:utf8>${DOCUMENT_SUFFIX}`;
export const TIKZ_WRAPPER_DIGEST = createHash('sha256')
  .update(WRAPPER_TEMPLATE, 'utf8')
  .digest('hex');

// Macro definitions and TikZ library loads are intentionally allowed. The
// isolated engine profile blocks only control sequences that can escape the
// source envelope, perform explicit I/O, or construct a blocked control word.
const BLOCKED_TEX_COMMAND = /\\(documentclass|usepackage|RequirePackage|input|include|includeonly|InputIfFileExists|IfFileExists|openin|closein|openout|closeout|read|readline|write|write18|special|catcode|csname|scantokens|newread|newwrite|everyjob|everypar|shipout|directlua|latelua|luafunction|luaescapestring|pdfobj|pdfannot|pdfstartlink|pdfendlink|pdfxform|pdfrefxform|pdfextension)\b/;
const GRAPHIC_ELEMENT = /<(?:path|circle|line|polyline|polygon|rect|text|use)\b/i;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class CompilerError extends Error {
  constructor(message, status = 422, code = 'COMPILE_FAILED', diagnostics = []) {
    super(message);
    this.name = 'CompilerError';
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function sourcePolicyDiagnostic(rule, start, end, command) {
  return {
    type: 'source-policy',
    severity: 'error',
    policy: TIKZ_SOURCE_POLICY,
    rule,
    start,
    end,
    ...(command ? { command } : {}),
  };
}

function sourceWithoutComments(source) {
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

export function validateTikzSource(source) {
  if (typeof source !== 'string') {
    throw new CompilerError('source 必须是字符串', 400, 'INVALID_SOURCE');
  }
  if (source.startsWith('\uFEFF')) {
    throw new CompilerError(
      'UTF-8 BOM is not allowed in TikZ source',
      400,
      'SOURCE_BOM_NOT_ALLOWED',
      [sourcePolicyDiagnostic('utf8-bom', 0, 1)],
    );
  }
  if (Buffer.from(source, 'utf8').toString('utf8') !== source) {
    throw new CompilerError(
      'TikZ source must contain only valid Unicode scalar values',
      400,
      'INVALID_UTF8_SOURCE',
    );
  }
  if (!/\S/u.test(source)) {
    throw new CompilerError('TikZ 源码为空', 400, 'EMPTY_SOURCE');
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new CompilerError(
      'TikZ 源码超过 128KB 上限',
      413,
      'SOURCE_TOO_LARGE',
    );
  }
  const policyView = sourceWithoutComments(source);
  const begins = [...policyView.matchAll(/\\begin\{tikzpicture\}/g)];
  const ends = [...policyView.matchAll(/\\end\{tikzpicture\}/g)];
  if (
    begins.length !== 1
    || ends.length !== 1
    || (begins[0].index ?? -1) >= (ends[0].index ?? -1)
  ) {
    throw new CompilerError(
      '源码必须且只能包含一个完整的 tikzpicture 环境',
      400,
      'INVALID_DOCUMENT',
    );
  }
  const blocked = BLOCKED_TEX_COMMAND.exec(policyView);
  if (blocked) {
    const command = `\\${blocked[1]}`;
    const start = blocked.index;
    throw new CompilerError(
      `${command} is blocked by compiler source policy ${TIKZ_SOURCE_POLICY}`,
      400,
      'SOURCE_POLICY_VIOLATION',
      [sourcePolicyDiagnostic(
        'blocked-control-sequence',
        start,
        start + blocked[0].length,
        command,
      )],
    );
  }
  // Source bytes are part of the compile attestation. Never trim here: the Web
  // tier verifies the compiler receipt against the exact CodeMirror snapshot.
  return source;
}

export function wrapTikzDocument(source) {
  return `${DOCUMENT_PREFIX}${source}${DOCUMENT_SUFFIX}`;
}

export function compilerInputIdentity(compilerImageDigest) {
  return {
    profile: TIKZ_COMPILER_PROFILE,
    sourcePolicy: TIKZ_SOURCE_POLICY,
    wrapperId: TIKZ_WRAPPER_ID,
    wrapperDigest: TIKZ_WRAPPER_DIGEST,
    profileManifestDigest: TIKZ_EXACT_PROFILE_MANIFEST_DIGEST,
    // The bundle prefix is profile-specific and the immutable Worker image
    // digest pins the actual package tree used for this artifact.
    bundleIdentity: `${EXACT_PROFILE.bundleIdentityPrefix}@${compilerImageDigest}`,
  };
}

export function compileCacheKeyDigest({
  compilerImageDigest,
  profile,
  visibility,
  submittedSourceDigest,
  sourcePolicy,
  wrapperId,
  wrapperDigest,
  bundleIdentity,
  profileManifestDigest,
}) {
  return createHash('sha256')
    .update([
      TIKZ_CACHE_KEY_VERSION,
      compilerImageDigest,
      profile,
      visibility,
      submittedSourceDigest,
      sourcePolicy,
      wrapperId,
      wrapperDigest,
      bundleIdentity,
      profileManifestDigest,
    ].join('\0'), 'utf8')
    .digest('hex');
}

export function sanitizeCompiledSvg(svg) {
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
      (_attribute, name, _quoted, doubleValue, singleValue) => {
        const value = doubleValue ?? singleValue ?? '';
        return value.startsWith('#') ? ` ${name}="${value}"` : '';
      },
    )
    .replace(/url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/gi, 'none');
}

function compactLog(chunks) {
  const log = Buffer.concat(chunks).toString('utf8').trim();
  // TeX loads packages before it reports the source error. Retaining only the
  // beginning preserved banners and discarded the actionable final lines.
  // Keep a bounded head for engine identity and a larger tail for diagnostics.
  if (log.length > 2_000) {
    return `${log.slice(0, 700)}\n...\n${log.slice(-1_300)}`;
  }
  return log.length > 2_000 ? `${log.slice(0, 2_000)}…` : log;
}

function killProcessGroup(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      // MiKTeX starts helper processes (for example miktex-makefmt and
      // miktex-luahbtex). Killing only the launcher leaks those descendants
      // after a timeout and eventually exhausts a long-running dev server.
      // taskkill receives a numeric PID directly (never through a shell) and
      // /T tears down the complete process tree before the job is rejected.
      const taskkill = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'taskkill.exe',
      );
      const result = spawnSync(
        taskkill,
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      if (result.status !== 0) child.kill('SIGKILL');
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    child.kill('SIGKILL');
  }
}

async function runProcess(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const childEnvironment = Object.fromEntries(
      Object.entries({
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
        FONTCONFIG_FILE: process.env.FONTCONFIG_FILE,
        LANG: process.env.LANG ?? 'C.UTF-8',
        LC_ALL: process.env.LC_ALL,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        // MiKTeX writes a per-process log even for --version and otherwise
        // exits non-zero when a sandboxed/dev host cannot write its default
        // AppData log directory. The local server binds this to a private temp
        // directory; production TeX Live simply ignores it.
        MIKTEX_LOG_DIR: process.env.MIKTEX_LOG_DIR,
        SOURCE_DATE_EPOCH: '0',
      }).filter((entry) => typeof entry[1] === 'string'),
    );
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const capture = (target) => (chunk) => {
      if (outputBytes >= MAX_LOG_BYTES) return;
      const remaining = MAX_LOG_BYTES - outputBytes;
      const captured = chunk.subarray(0, remaining);
      target.push(captured);
      outputBytes += captured.length;
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessGroup(child);
      const partialLog = [compactLog(stdout), compactLog(stderr)]
        .filter(Boolean)
        .join('\n');
      rejectRun(new CompilerError(
        partialLog
          ? `TikZ 精确编译超时。编译器停止前日志：${partialLog}`
          : 'TikZ 精确编译超时，请简化代码后重试',
        504,
        'COMPILE_TIMEOUT',
      ));
    }, options.timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(new CompilerError(
        `无法启动编译器：${error.message}`,
        503,
        'COMPILER_UNAVAILABLE',
      ));
    });

    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        exitCode: exitCode ?? -1,
        signal,
        stdout: compactLog(stdout),
        stderr: compactLog(stderr),
      });
    });
  });
}

function safeMessage(result, fallback) {
  // TeX engines commonly report real compilation diagnostics on stdout while
  // MiKTeX writes host-maintenance notices to stderr. Showing stderr alone hid
  // the actionable `input.tex:<line>` error behind "check for updates" and
  // made a valid retry path look like an environment outage.
  return [result.stdout, result.stderr].filter(Boolean).join('\n') || fallback;
}

export function createCompiler(options = {}) {
  const requestedEngine = options.engine
    ?? EXACT_PROFILE.runtimeCapabilities.texEngine;
  const engine = ['pdflatex', 'xelatex', 'lualatex', 'tectonic']
    .includes(requestedEngine)
    ? requestedEngine
    : EXACT_PROFILE.runtimeCapabilities.texEngine;
  const compilerPath = options.compilerPath ?? (
    engine === 'lualatex'
      ? options.lualatexPath ?? process.env.LUALATEX_PATH ?? 'lualatex'
      : engine === 'xelatex'
        ? options.xelatexPath
          ?? process.env.XELATEX_PATH
          // Preserve the old test/dev option while callers migrate to the
          // engine-neutral compilerPath field.
          ?? options.tectonicPath
          ?? 'xelatex'
        : engine === 'pdflatex'
          ? options.pdflatexPath
            ?? process.env.PDFLATEX_PATH
            ?? options.tectonicPath
            ?? 'pdflatex'
          : options.tectonicPath ?? process.env.TECTONIC_PATH ?? 'tectonic'
  );
  const dvisvgmPath = (
    options.dvisvgmPath
    ?? process.env.DVISVGM_PATH
    ?? 'dvisvgm'
  );
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? process.env.COMPILE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const maxQueue = positiveInteger(
    options.maxQueue ?? process.env.MAX_QUEUE_DEPTH,
    DEFAULT_MAX_QUEUE,
  );
  const maxCacheEntries = positiveInteger(
    options.maxCacheEntries ?? process.env.MAX_CACHE_ENTRIES,
    DEFAULT_CACHE_ENTRIES,
  );
  const disablePackageInstaller = options.disablePackageInstaller === true;
  const execute = options.execute ?? runProcess;
  const cache = new Map();
  const inFlight = new Map();
  let queueTail = Promise.resolve();
  let queueDepth = 0;

  function cacheSet(key, value) {
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, value);
  }

  async function compileOne(executedSource, executedSourceDigest) {
    const tempRoot = resolve(tmpdir());
    const workRoot = await mkdtemp(resolve(tempRoot, 'math-geohub-tikz-'));
    const resolvedWorkRoot = resolve(workRoot);
    if (!resolvedWorkRoot.startsWith(`${tempRoot}${sep}`)) {
      throw new CompilerError('临时目录越界', 500, 'TEMP_DIR_INVALID');
    }

    try {
      const executedDocument = wrapTikzDocument(executedSource);
      const executedDocumentDigest = createHash('sha256')
        .update(executedDocument, 'utf8')
        .digest('hex');
      await writeFile(
        join(workRoot, 'input.tex'),
        executedDocument,
        'utf8',
      );
      const deadline = performance.now() + timeoutMs;
      const remainingMs = () => (
        Math.max(1, Math.round(deadline - performance.now()))
      );

      const compileStarted = performance.now();
      const compileResult = await execute(
        compilerPath,
        engine === 'pdflatex' || engine === 'lualatex'
          ? [
              ...(disablePackageInstaller ? ['--disable-installer'] : []),
              engine === 'pdflatex'
                ? '-output-format=dvi'
                : '--output-format=dvi',
              '--no-shell-escape',
              '--halt-on-error',
              '--interaction=nonstopmode',
              '--file-line-error',
              'input.tex',
            ]
          : engine === 'xelatex'
            ? [
              ...(disablePackageInstaller ? ['--disable-installer'] : []),
              '-no-pdf',
              '--no-shell-escape',
              '--halt-on-error',
              '--interaction=nonstopmode',
              '--file-line-error',
              'input.tex',
            ]
            : [
              '-X',
              'compile',
              'input.tex',
              '--outdir',
              '.',
              '--outfmt',
              'xdv',
              '--untrusted',
              '--only-cached',
            ],
        { cwd: workRoot, timeoutMs: remainingMs() },
      );
      const compileMs = Math.round(performance.now() - compileStarted);
      if (compileResult.exitCode !== 0) {
        throw new CompilerError(
          `TikZ 编译失败：${safeMessage(
            compileResult,
            `${engine} 返回非零状态`,
          )}`,
          422,
          engine === 'pdflatex'
            ? 'PDFLATEX_FAILED'
            : engine === 'xelatex'
              ? 'XELATEX_FAILED'
              : engine === 'lualatex'
                ? 'LUALATEX_FAILED'
                : 'TECTONIC_FAILED',
        );
      }

      const convertStarted = performance.now();
      const convertResult = await execute(
        dvisvgmPath,
        engine === 'pdflatex' || engine === 'lualatex'
          ? ['--no-fonts', '--exact', '--page=1', '--output=output.svg', 'input.dvi']
          : engine === 'xelatex'
            ? ['--no-fonts', '--exact', '--page=1', '--output=output.svg', 'input.xdv']
            : [
                '--no-mktexmf', '--no-fonts', '--exact', '--page=1',
                '--output=output.svg', 'input.xdv',
              ],
        { cwd: workRoot, timeoutMs: remainingMs() },
      );
      const convertMs = Math.round(performance.now() - convertStarted);
      if (convertResult.exitCode !== 0) {
        throw new CompilerError(
          `SVG 转换失败：${safeMessage(
            convertResult,
            'dvisvgm 返回非零状态',
          )}`,
          422,
          'DVISVGM_FAILED',
        );
      }

      const svgBuffer = await readFile(join(workRoot, 'output.svg'));
      if (svgBuffer.length > MAX_SVG_BYTES) {
        throw new CompilerError(
          '编译生成的 SVG 超过 4MB 上限',
          422,
          'SVG_TOO_LARGE',
        );
      }
      const svg = sanitizeCompiledSvg(svgBuffer.toString('utf8'));
      if (!svg.includes('<svg') || !GRAPHIC_ELEMENT.test(svg)) {
        throw new CompilerError(
          '编译器没有生成有效 SVG',
          422,
          'INVALID_SVG',
        );
      }
      return {
        svg,
        renderer: engine === 'pdflatex'
          ? 'pdflatex-dvi-dvisvgm-local-dev'
          : engine === 'xelatex'
            ? 'xelatex-xdv-dvisvgm-local-dev'
            : engine === 'lualatex'
              ? 'lualatex-dvi-dvisvgm'
              : 'tectonic-dvisvgm',
        sourceHash: executedSourceDigest,
        executedSourceDigest,
        executedDocumentDigest,
        profile: TIKZ_COMPILER_PROFILE,
        sourcePolicy: TIKZ_SOURCE_POLICY,
        wrapperId: TIKZ_WRAPPER_ID,
        wrapperDigest: TIKZ_WRAPPER_DIGEST,
        cacheHit: false,
        compileMs,
        convertMs,
      };
    } finally {
      try {
        await rm(workRoot, {
          recursive: true,
          force: true,
          // MiKTeX can hold its log file briefly after the process exits on
          // Windows. Retrying cleanup must not turn a valid compile into EBUSY.
          maxRetries: 5,
          retryDelay: 120,
        });
      } catch (error) {
        if (
          process.platform !== 'win32'
          || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)
        ) throw error;
        // The compile result is already fully resident and attested. Schedule
        // a longer bounded cleanup after MiKTeX releases its log/font handles;
        // do not report a successful render as failed because of teardown.
        const cleanup = setTimeout(() => {
          void rm(workRoot, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 500,
          }).catch(() => undefined);
        }, 1_500);
        cleanup.unref?.();
      }
    }
  }

  async function render(source) {
    const executedSource = validateTikzSource(source);
    const executedSourceDigest = createHash('sha256')
      .update(executedSource, 'utf8')
      .digest('hex');
    const cached = cache.get(executedSourceDigest);
    if (cached) return { ...cached, cacheHit: true };
    const active = inFlight.get(executedSourceDigest);
    if (active) return active;
    if (queueDepth >= maxQueue) {
      throw new CompilerError(
        'TikZ 编译队列已满，请稍后重试',
        429,
        'QUEUE_FULL',
      );
    }

    queueDepth += 1;
    const job = queueTail.then(
      () => compileOne(executedSource, executedSourceDigest),
    );
    queueTail = job.then(() => undefined, () => undefined);
    inFlight.set(executedSourceDigest, job);

    try {
      const result = await job;
      cacheSet(executedSourceDigest, result);
      return result;
    } finally {
      queueDepth -= 1;
      inFlight.delete(executedSourceDigest);
    }
  }

  return {
    render,
    stats: () => ({
      queueDepth,
      cacheEntries: cache.size,
      inFlight: inFlight.size,
    }),
  };
}
