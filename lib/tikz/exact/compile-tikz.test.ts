import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import exactProfile from '@/lib/tikz/syntax/exact-profile.json';
import {
  compileTikzToSvg,
  createTikzCompileJob,
  fetchTikzCompileArtifact,
  getTikzCompileJob,
  sanitizeCompiledSvg,
  type CompilerArtifactAttestation,
} from './compile-tikz';

// Digests are taken over SOURCE exactly as submitted. The exact entry point may
// reject source but may not trim, canonicalize or rewrite it, so a fixture that
// hashed a trimmed variant would assert a normalization the contract forbids.
const SOURCE = String.raw`
  \begin{tikzpicture}
  \draw (0,0) -- (1,1);
  \end{tikzpicture}
`;
const ARTIFACT = '<svg><path d="M0 0"/></svg>';
const PROFILE = 'tikz-standard-v1' as const;
const VISIBILITY = 'private' as const;
const COMPILER_IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

// The cache key binds the full execution identity, not just the source: compiler
// image, source policy, wrapper and bundle identity all participate, so a
// different sandbox or wrapper can never serve a cached artifact.
const CACHE_KEY_VERSION = 'tikz-cache-key/v3' as const;
const SOURCE_POLICY = 'tikz-untrusted-no-io/v1' as const;
const WRAPPER_ID = 'tikz-standalone-dvisvgm/v1' as const;
const WRAPPER_DIGEST = digest('tikz-standalone-dvisvgm-wrapper');
const BUNDLE_IDENTITY = `tectonic-only-cached@${COMPILER_IMAGE_DIGEST}`;
const PROFILE_MANIFEST_DIGEST = digest(JSON.stringify(exactProfile));

function cacheKeyFor(submittedSourceDigest: string): string {
  return digest([
    CACHE_KEY_VERSION,
    COMPILER_IMAGE_DIGEST,
    PROFILE,
    VISIBILITY,
    submittedSourceDigest,
    SOURCE_POLICY,
    WRAPPER_ID,
    WRAPPER_DIGEST,
    BUNDLE_IDENTITY,
    PROFILE_MANIFEST_DIGEST,
  ].join('\0'));
}

function attestationFor(
  sourceDigest: string,
  artifact = ARTIFACT,
): CompilerArtifactAttestation {
  const cacheKeyDigest = cacheKeyFor(sourceDigest);
  return {
    schemaVersion: 'tikz-artifact-attestation/v1',
    jobId: `j_${cacheKeyDigest}`,
    cacheKeyVersion: CACHE_KEY_VERSION,
    sourceDigest,
    submittedSourceDigest: sourceDigest,
    executedSourceDigest: sourceDigest,
    executedDocumentDigest: digest(`document:${sourceDigest}`),
    cacheKeyDigest,
    artifactDigest: digest(artifact),
    profile: PROFILE,
    sourcePolicy: SOURCE_POLICY,
    wrapperId: WRAPPER_ID,
    wrapperDigest: WRAPPER_DIGEST,
    bundleIdentity: BUNDLE_IDENTITY,
    profileManifestDigest: PROFILE_MANIFEST_DIGEST,
    visibility: VISIBILITY,
    renderer: 'tectonic-dvisvgm',
    compilerImageDigest: COMPILER_IMAGE_DIGEST,
    mediaType: 'image/svg+xml',
    svgBytes: Buffer.byteLength(artifact, 'utf8'),
    completedAt: 1,
  };
}

function localXelatexAttestation(sourceDigest: string): CompilerArtifactAttestation {
  const compilerImageDigest = 'local-xelatex-native-dev';
  const bundleIdentity = `local-xelatex-dvisvgm@${compilerImageDigest}`;
  const cacheKeyDigest = digest([
    CACHE_KEY_VERSION,
    compilerImageDigest,
    PROFILE,
    VISIBILITY,
    sourceDigest,
    SOURCE_POLICY,
    WRAPPER_ID,
    WRAPPER_DIGEST,
    bundleIdentity,
    PROFILE_MANIFEST_DIGEST,
  ].join('\0'));
  return {
    ...attestationFor(sourceDigest),
    jobId: `j_${cacheKeyDigest}`,
    cacheKeyDigest,
    bundleIdentity,
    renderer: 'xelatex-xdv-dvisvgm-local-dev',
    compilerImageDigest,
  };
}

// A job must advertise the same execution identity as its attestation; the
// client recomputes the cache key from these fields before trusting an artifact.
function jobFor(attestation: CompilerArtifactAttestation) {
  return {
    id: attestation.jobId,
    cacheKeyVersion: attestation.cacheKeyVersion,
    cacheKeyDigest: attestation.cacheKeyDigest,
    sourceDigest: attestation.sourceDigest,
    submittedSourceDigest: attestation.submittedSourceDigest,
    executedSourceDigest: attestation.executedSourceDigest,
    executedDocumentDigest: attestation.executedDocumentDigest,
    profile: attestation.profile,
    sourcePolicy: attestation.sourcePolicy,
    wrapperId: attestation.wrapperId,
    wrapperDigest: attestation.wrapperDigest,
    bundleIdentity: attestation.bundleIdentity,
    profileManifestDigest: attestation.profileManifestDigest,
    visibility: attestation.visibility,
    renderer: attestation.renderer,
    compilerImageDigest: attestation.compilerImageDigest,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('compileTikzToSvg', () => {
  it('does not send Lua graph drawing source to the standard compiler', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    vi.stubEnv('TIKZ_GRAPHDRAWING_COMPILER_URL', '');
    vi.stubEnv('TIKZ_GRAPHDRAWING_COMPILER_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createTikzCompileJob(String.raw`
      \begin{tikzpicture}
      \graph [spring layout] { a -- b -- c -- a };
      \end{tikzpicture}
    `)).rejects.toMatchObject({
      status: 503,
      code: 'GRAPHDRAWING_COMPILER_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits Lua layout source only to the configured companion profile', async () => {
    vi.stubEnv(
      'TIKZ_GRAPHDRAWING_COMPILER_URL',
      'http://graph-compiler.internal/',
    );
    vi.stubEnv('TIKZ_GRAPHDRAWING_COMPILER_TOKEN', 'graph-token');
    const fetchMock = vi.fn(async () => Response.json(
      { error: 'fixture stop', code: 'FIXTURE_STOP' },
      { status: 422 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createTikzCompileJob(String.raw`
      \begin{tikzpicture}
      \graph [layered layout] { a -> b };
      \end{tikzpicture}
    `)).rejects.toMatchObject({ code: 'FIXTURE_STOP' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://graph-compiler.internal/v1/jobs');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer graph-token',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      profile: 'tikz-luatex-graphdrawing-v1',
    });
  });

  it('通过内部 job API 创建任务并读取隔离 artifact', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal/');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const sourceDigest = digest(SOURCE);
    const attestation = attestationFor(sourceDigest);
    const { jobId, artifactDigest } = attestation;
    const fetchMock = vi.fn(async (
      url: string | URL | Request,
      _init?: RequestInit,
    ) => (
      String(url).endsWith('/artifact')
        ? new Response(ARTIFACT, {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml',
            'X-Artifact-SHA256': artifactDigest,
          },
        })
        : new Response(JSON.stringify({
          ...jobFor(attestation),
          status: 'succeeded',
          attestation,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(compileTikzToSvg(SOURCE)).resolves.toContain('<path');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://compiler.internal/v1/jobs');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      source: SOURCE,
      profile: 'tikz-standard-v1',
      visibility: 'private',
    });
    expect(fetchMock.mock.calls[1][0])
      .toBe(`http://compiler.internal/v1/jobs/${jobId}/artifact`);
  });

  it('accepts an honestly identified XeLaTeX fallback only in local development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://127.0.0.1:8788');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const attestation = localXelatexAttestation(digest(SOURCE));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...jobFor(attestation),
      status: 'succeeded',
      attestation,
    })));

    await expect(createTikzCompileJob(SOURCE)).resolves.toMatchObject({
      status: 'succeeded',
      renderer: 'xelatex-xdv-dvisvgm-local-dev',
      bundleIdentity: 'local-xelatex-dvisvgm@local-xelatex-native-dev',
    });
  });

  it('rejects the local XeLaTeX fallback identity in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TIKZ_COMPILER_URL', 'https://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const attestation = localXelatexAttestation(digest(SOURCE));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...jobFor(attestation),
      status: 'succeeded',
      attestation,
    })));

    await expect(createTikzCompileJob(SOURCE)).rejects.toMatchObject({
      code: 'INVALID_JOB_IDENTITY',
    });
  });

  it('保留编译服务的状态码与错误码', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: '队列已满', errorCode: 'QUEUE_FULL' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(compileTikzToSvg(SOURCE)).rejects.toMatchObject({
      message: '队列已满',
      status: 429,
      code: 'QUEUE_FULL',
    });
  });
  it('拒绝与请求源码不一致的任务响应', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const attestation = attestationFor(digest(SOURCE));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: attestation.jobId,
      status: 'queued',
      sourceDigest: '0'.repeat(64),
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(createTikzCompileJob(SOURCE)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_JOB_IDENTITY',
    });
  });

  it('拒绝状态接口返回另一个任务 ID', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const requested = `j_${'1'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: `j_${'2'.repeat(64)}`,
      status: 'running',
      sourceDigest: digest(SOURCE),
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(getTikzCompileJob(requested)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_JOB_IDENTITY',
    });
  });

  it.each([
    {
      name: 'header',
      body: ARTIFACT,
      headerDigest: '0'.repeat(64),
      mutate: (value: CompilerArtifactAttestation) => value,
      code: 'ARTIFACT_HEADER_MISMATCH',
    },
    {
      name: 'content',
      body: '<svg><path d="M1 1"/></svg>',
      headerDigest: digest(ARTIFACT),
      mutate: (value: CompilerArtifactAttestation) => value,
      code: 'ARTIFACT_DIGEST_MISMATCH',
    },
    {
      name: 'size',
      body: ARTIFACT,
      headerDigest: digest(ARTIFACT),
      mutate: (value: CompilerArtifactAttestation) => ({
        ...value,
        svgBytes: value.svgBytes + 1,
      }),
      code: 'ARTIFACT_SIZE_MISMATCH',
    },
  ])('拒绝 $name 不匹配的 artifact', async ({
    body,
    headerDigest,
    mutate,
    code,
  }) => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const original = attestationFor(digest(SOURCE));
    const attestation = mutate(original);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'X-Artifact-SHA256': headerDigest,
      },
    })));

    await expect(fetchTikzCompileArtifact(
      attestation.jobId,
      attestation,
    )).rejects.toMatchObject({ code });
  });

  it('拒绝会被 Web 边界再次清理的未规范化 artifact', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const unsafe = '<svg onload="bad()"><path /></svg>';
    const attestation = attestationFor(digest(SOURCE), unsafe);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(unsafe, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'X-Artifact-SHA256': attestation.artifactDigest,
      },
    })));

    await expect(fetchTikzCompileArtifact(
      attestation.jobId,
      attestation,
    )).rejects.toMatchObject({ code: 'UNSAFE_COMPILER_ARTIFACT' });
  });

  it('拒绝输入字段改变但 cache key 未重算的证明', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const original = attestationFor(digest(SOURCE));
    const stale = {
      ...original,
      visibility: 'public' as const,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTikzCompileArtifact(
      stale.jobId,
      stale,
    )).rejects.toMatchObject({ code: 'INVALID_ARTIFACT_ATTESTATION' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects an oversized compiler JSON response before parsing it', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(300 * 1024), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(createTikzCompileJob(SOURCE)).rejects.toMatchObject({
      code: 'COMPILER_RESPONSE_TOO_LARGE',
    });
  });

  it('rejects an oversized artifact before buffering its body', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const attestation = attestationFor(digest(SOURCE));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ARTIFACT, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Length': String(4 * 1024 * 1024 + 1),
        'X-Artifact-SHA256': attestation.artifactDigest,
      },
    })));

    await expect(fetchTikzCompileArtifact(
      attestation.jobId,
      attestation,
    )).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
  });

  it('propagates caller cancellation to the compiler request', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    })));
    const controller = new AbortController();
    const request = createTikzCompileJob(SOURCE, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({
      code: 'COMPILER_REQUEST_ABORTED',
      status: 499,
    });
  });
});

describe('sanitizeCompiledSvg', () => {
  it('移除主动内容和外部链接，同时保留 dvisvgm 本地 glyph 引用', () => {
    const clean = sanitizeCompiledSvg(
      '<svg onload="bad()"><script>bad()</script><foreignObject>bad</foreignObject>'
      + '<a href="https://evil.example"><path /></a><use xlink:href="#glyph0"/></svg>',
    );
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<foreignObject');
    expect(clean).not.toContain('https://evil.example');
    expect(clean).toContain('xlink:href="#glyph0"');
    expect(clean).toContain('<path');
  });
});
