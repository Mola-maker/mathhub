import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestExactTikzArtifact } from './exact-render-client';

const source = '\\begin{tikzpicture}\n\\draw (0,0)--(1,1);\n\\end{tikzpicture}\n';
const sourceDigest = createHash('sha256').update(source).digest('hex');
const cacheKeyDigest = 'a'.repeat(64);
const jobId = `j_${cacheKeyDigest}`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const artifactDigest = createHash('sha256').update(svg).digest('hex');

function succeeded(
  digest = sourceDigest,
  exactArtifactDigest = artifactDigest,
  svgBytes = Buffer.byteLength(svg),
): Response {
  return Response.json({
    jobId,
    status: 'succeeded',
    svg,
    attestation: {
      schemaVersion: 'tikz-artifact-attestation/v1',
      jobId,
      sourceDigest: digest,
      cacheKeyDigest,
      artifactDigest: exactArtifactDigest,
      profile: 'tikz-standard-v1',
      visibility: 'private',
      renderer: 'tectonic-dvisvgm',
      compilerImageDigest: 'sha256:compiler',
      profileManifestDigest: 'c'.repeat(64),
      mediaType: 'image/svg+xml',
      svgBytes,
      completedAt: 1,
    },
  });
}

describe('requestExactTikzArtifact', () => {
  afterEach(() => vi.restoreAllMocks());

  it('polls one job and binds the result to the submitted UTF-8 source bytes', async () => {
    const onStatus = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(
        { jobId, status: 'queued', profile: 'tikz-standard-v1' },
        { status: 202, headers: { 'Retry-After': '0.001' } },
      ))
      .mockResolvedValueOnce(succeeded());

    await expect(requestExactTikzArtifact(source, {
      signal: new AbortController().signal,
      onStatus,
    })).resolves.toMatchObject({
      svg: expect.stringContaining('<svg'),
      attestation: { sourceDigest, artifactDigest },
    });
    expect(onStatus).toHaveBeenCalledWith('queued');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/tikz/render');
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain(jobId);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0]))
      .toContain('profile=tikz-standard-v1');
  });

  it('rejects an otherwise valid artifact whose source digest belongs to different bytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(succeeded('d'.repeat(64)));
    await expect(requestExactTikzArtifact(source, {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'SOURCE_DIGEST_MISMATCH',
    });
  });

  it('rejects SVG bytes that do not match the artifact attestation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(succeeded(
      sourceDigest,
      'd'.repeat(64),
    ));
    await expect(requestExactTikzArtifact(source, {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'ARTIFACT_DIGEST_MISMATCH',
    });

    vi.mocked(fetch).mockResolvedValueOnce(succeeded(
      sourceDigest,
      artifactDigest,
      Buffer.byteLength(svg) + 1,
    ));
    await expect(requestExactTikzArtifact(source, {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'ARTIFACT_SIZE_MISMATCH',
    });
  });
});
