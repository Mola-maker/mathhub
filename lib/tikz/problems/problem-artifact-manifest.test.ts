import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PROBLEM_EXTERNAL_TAINT,
  canonicalProblemArtifactDigestMaterial,
  canonicalProblemArtifactSha256,
  canonicalProblemTaskSha256,
  type ProblemArtifactManifest,
  type ProblemRightsSnapshot,
  type ProblemTask,
  validateProblemArtifactManifest,
  validateProblemTask,
} from './problem-artifact-manifest';

const SOURCE_URL = 'https://mathnet.mit.edu/explorer.html?p=canary';
const DATASET_URL = 'https://huggingface.co/datasets/ShadenA/MathNet';
const DIGEST = 'a'.repeat(64);
const STATEMENT = 'Construct the nine-point circle of triangle ABC.';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function rights(overrides: Partial<ProblemRightsSnapshot> = {}): ProblemRightsSnapshot {
  return {
    dataset: { decision: 'allowed', licenseId: 'CC-BY-4.0' },
    code: { decision: 'allowed', licenseId: 'MIT' },
    sourceMaterial: { decision: 'allowed', licenseId: 'CC-BY-4.0' },
    redistribution: 'allowed',
    commercial: 'allowed',
    training: 'allowed',
    redistributable: true,
    commercialReady: true,
    trainingReady: true,
    ...overrides,
  } as ProblemRightsSnapshot;
}

function manifest(overrides: Partial<ProblemArtifactManifest> = {}): ProblemArtifactManifest {
  const base = {
    schemaVersion: 'ProblemArtifactManifest/v1' as const,
    source: 'mathnet',
    sourceId: 'mathnet:canary-001',
    provider: {
      datasetId: 'ShadenA/MathNet',
      revision: 'a'.repeat(40),
      config: 'all',
      split: 'train',
      rowId: 1,
    },
    provenance: {
      sourceUrl: SOURCE_URL,
      datasetUrl: DATASET_URL,
      evidence: [
        { kind: 'source' as const, url: SOURCE_URL },
        { kind: 'dataset' as const, url: DATASET_URL },
      ],
    },
    rights: rights(),
    contentDigestAlgorithm: 'sha256' as const,
    contentDigest: DIGEST,
    retrievedAt: '2026-08-16T00:00:00.000Z',
    taint: PROBLEM_EXTERNAL_TAINT,
    statement: {
      kind: 'inline' as const,
      text: STATEMENT,
      bytes: new TextEncoder().encode(STATEMENT).byteLength,
      sha256: sha256(STATEMENT),
      taint: PROBLEM_EXTERNAL_TAINT,
    },
    assets: [],
  } satisfies ProblemArtifactManifest;
  const candidate = { ...base, ...overrides, contentDigest: DIGEST } as ProblemArtifactManifest;
  return { ...candidate, contentDigest: canonicalProblemArtifactSha256(candidate) };
}

function multimodalManifest(): ProblemArtifactManifest {
  return manifest({
    solution: {
      kind: 'reference',
      url: SOURCE_URL,
      bytes: 1_024,
      sha256: 'c'.repeat(64),
      taint: PROBLEM_EXTERNAL_TAINT,
    },
    assets: [{
      assetId: 'diagram-1',
      role: 'diagram',
      providerPathOrUrl: 'images/canary.png',
      sha256: 'd'.repeat(64),
      bytes: 42_000,
      mediaType: 'image/png',
      width: 800,
      height: 600,
      alt: 'A triangle diagram',
      rightsDecision: 'allowed',
      rightsEvidenceUrl: DATASET_URL,
    }],
  });
}

describe('ProblemArtifactManifest/v1', () => {
  it('accepts a legal pure-text canary and attests its canonical SHA-256', () => {
    const value = manifest();
    expect(validateProblemArtifactManifest(value)).toEqual({ ok: true, value });
    expect(canonicalProblemArtifactSha256(value)).toBe(value.contentDigest);
    expect(createHash('sha256').update(canonicalProblemArtifactDigestMaterial(value), 'utf8').digest('hex')).toBe(value.contentDigest);
  });

  it('accepts a legal multimodal canary with a same-origin provider asset', () => {
    const value = multimodalManifest();
    expect(validateProblemArtifactManifest(value)).toEqual({ ok: true, value });
  });

  it.each(['main', 'latest', 'master', 'release-2026', 'unpinned-live-viewer'])('rejects mutable provider revision %s', (revision) => {
    const value = manifest({ provider: { ...manifest().provider, revision } });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'unpinned-revision')).toBe(true);
  });

  it('rejects self-authorized/private provenance and encoded traversal paths', () => {
    const privateOrigin = manifest({
      provenance: {
        sourceUrl: 'https://127.0.0.1/problem',
        datasetUrl: 'https://127.0.0.1/dataset',
        evidence: [{ kind: 'source', url: 'https://127.0.0.1/evidence' }],
      },
    });
    expect(validateProblemArtifactManifest(privateOrigin).ok).toBe(false);

    const traversal = manifest({
      assets: [{
        assetId: 'diagram-traversal',
        role: 'diagram',
        providerPathOrUrl: 'images/%2e%2e/private.png',
        sha256: 'f'.repeat(64),
        bytes: 10,
        mediaType: 'image/png',
        width: 20,
        height: 20,
        alt: 'unsafe traversal',
        rightsDecision: 'review-required',
      }],
    });
    expect(validateProblemArtifactManifest(traversal).ok).toBe(false);

    const privateAsset = manifest({
      assets: [{
        assetId: 'diagram-private',
        role: 'diagram',
        providerPathOrUrl: 'https://127.0.0.1/assets/diagram.png',
        sha256: 'f'.repeat(64),
        bytes: 10,
        mediaType: 'image/png',
        width: 20,
        height: 20,
        alt: 'private asset',
        rightsDecision: 'review-required',
      }],
    });
    expect(validateProblemArtifactManifest(privateAsset).ok).toBe(false);

    const encodedAbsoluteTraversal = manifest({
      assets: [{
        assetId: 'diagram-encoded-absolute',
        role: 'diagram',
        providerPathOrUrl: 'https://huggingface.co/datasets/ShadenA/MathNet/%2e%2e/private.png',
        sha256: 'f'.repeat(64),
        bytes: 10,
        mediaType: 'image/png',
        width: 20,
        height: 20,
        alt: 'encoded absolute traversal',
        rightsDecision: 'review-required',
      }],
    });
    expect(validateProblemArtifactManifest(encodedAbsoluteTraversal).ok).toBe(false);
  });

  it('rejects FNV/short digests even when all other provenance is valid', () => {
    const value = { ...manifest(), contentDigest: '0123456789abcdef' } as ProblemArtifactManifest;
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'sha256')).toBe(true);
  });

  it('rejects an inline text digest that does not match the embedded UTF-8 bytes', () => {
    const value = manifest({
      statement: { ...manifest().statement, sha256: 'b'.repeat(64) },
    });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'digest-mismatch')).toBe(true);
  });

  it('rejects oversized text and asset collections before they enter a prompt/eval lane', () => {
    const value = manifest({
      statement: {
        kind: 'inline',
        text: 'x'.repeat(128 * 1024 + 1),
        bytes: 128 * 1024 + 1,
        sha256: 'e'.repeat(64),
        taint: PROBLEM_EXTERNAL_TAINT,
      },
    });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'byte-budget')).toBe(true);
  });

  it('rejects an image without rights evidence and unsafe media type', () => {
    const value = manifest({
      assets: [{
        assetId: 'diagram-unsafe',
        role: 'diagram',
        providerPathOrUrl: 'images/diagram.svg',
        sha256: 'f'.repeat(64),
        bytes: 10,
        mediaType: 'image/svg+xml' as never,
        width: 20,
        height: 20,
        alt: 'unsafe',
        rightsDecision: 'allowed',
      }],
    });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'media-type')).toBe(true);
      expect(result.errors.some((error) => error.code === 'rights-evidence')).toBe(true);
    }
  });

  it('does not allow a license string to upgrade unknown/review-required rights', () => {
    const value = manifest({
      rights: rights({
        dataset: { decision: 'review-required', licenseId: 'CC-BY-4.0' },
        redistribution: 'allowed',
        redistributable: true,
      }),
    });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'rights-escalation')).toBe(true);
  });

  it('keeps all external statement, solution, and task text explicitly tainted', () => {
    const value = manifest({
      statement: { ...manifest().statement, taint: 'trusted-local' as never },
    });
    const result = validateProblemArtifactManifest(value);
    expect(result.ok).toBe(false);

    const taskCandidate: ProblemTask = {
      schemaVersion: 'ProblemTask/v1' as const,
      taskId: 'nine-point-canary',
      artifact: { source: value.source, sourceId: value.sourceId, contentDigest: value.contentDigest },
      contentDigestAlgorithm: 'sha256' as const,
      contentDigest: '0'.repeat(64),
      facts: [{ id: 'f1', text: 'ABC is a non-degenerate triangle.', taint: PROBLEM_EXTERNAL_TAINT }],
      goal: { text: 'Construct the nine-point circle.', taint: PROBLEM_EXTERNAL_TAINT },
      expectedRelations: [{ type: 'passes-through', subject: 'nine-point-circle', object: 'orthocenter-midpoint' }],
      renderExpectations: [{ kind: 'entity', target: 'nine-point-circle', description: 'Circle is visible', required: true }],
      tolerances: { coordinate: 0.001, pixel: 2 },
      split: 'canary',
      leakageGroup: 'mathnet:nine-point-circle',
      taint: PROBLEM_EXTERNAL_TAINT,
    };
    const task: ProblemTask = {
      ...taskCandidate,
      contentDigest: canonicalProblemTaskSha256(taskCandidate),
    };
    expect(validateProblemTask(task, value)).toEqual({ ok: true, value: task });
    expect(validateProblemTask({ ...task, taint: 'trusted-local' }, value).ok).toBe(false);
    expect(validateProblemTask({
      ...task,
      goal: { ...task.goal, text: 'A substituted evaluation goal.' },
    }, value).ok).toBe(false);
    expect(validateProblemTask({
      ...task,
      artifact: { ...task.artifact, source: 'unknown-source', sourceId: 'unknown-source:1' },
    }).ok).toBe(false);
  });
});
