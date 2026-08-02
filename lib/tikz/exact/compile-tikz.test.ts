import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileTikzToSvg,
  createTikzCompileJob,
  fetchTikzCompileArtifact,
  getTikzCompileJob,
  sanitizeCompiledSvg,
  type CompilerArtifactAttestation,
} from './compile-tikz';

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

function attestationFor(
  sourceDigest: string,
  artifact = ARTIFACT,
): CompilerArtifactAttestation {
  const cacheKeyDigest = digest(
    `${COMPILER_IMAGE_DIGEST}\0${PROFILE}\0${VISIBILITY}\0${sourceDigest}`,
  );
  return {
    schemaVersion: 'tikz-artifact-attestation/v1',
    jobId: `j_${cacheKeyDigest}`,
    sourceDigest,
    cacheKeyDigest,
    artifactDigest: digest(artifact),
    profile: PROFILE,
    visibility: VISIBILITY,
    renderer: 'tectonic-dvisvgm',
    compilerImageDigest: COMPILER_IMAGE_DIGEST,
    mediaType: 'image/svg+xml',
    svgBytes: Buffer.byteLength(artifact, 'utf8'),
    completedAt: 1,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('compileTikzToSvg', () => {
  it('通过内部 job API 创建任务并读取隔离 artifact', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal/');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const sourceDigest = digest(SOURCE.trim());
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
          id: jobId,
          status: 'succeeded',
          sourceDigest,
          renderer: 'tectonic-dvisvgm',
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
      source: SOURCE.trim(),
      profile: 'tikz-standard-v1',
      visibility: 'private',
    });
    expect(fetchMock.mock.calls[1][0])
      .toBe(`http://compiler.internal/v1/jobs/${jobId}/artifact`);
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
    const attestation = attestationFor(digest(SOURCE.trim()));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: attestation.jobId,
      status: 'queued',
      sourceDigest: '0'.repeat(64),
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(createTikzCompileJob(SOURCE)).rejects.toMatchObject({
      code: 'COMPILER_REJECTED',
    });
  });

  it('拒绝状态接口返回另一个任务 ID', async () => {
    vi.stubEnv('TIKZ_COMPILER_URL', 'http://compiler.internal');
    vi.stubEnv('TIKZ_COMPILER_TOKEN', 'test-token');
    const requested = `j_${'1'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: `j_${'2'.repeat(64)}`,
      status: 'running',
      sourceDigest: digest(SOURCE.trim()),
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(getTikzCompileJob(requested)).rejects.toMatchObject({
      code: 'COMPILER_REJECTED',
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
    const original = attestationFor(digest(SOURCE.trim()));
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
    const attestation = attestationFor(digest(SOURCE.trim()), unsafe);
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
    const original = attestationFor(digest(SOURCE.trim()));
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
