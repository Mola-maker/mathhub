import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PROBLEM_EXTERNAL_TAINT,
  canonicalProblemArtifactSha256,
  canonicalProblemTaskSha256,
  type ProblemArtifactManifest,
  type ProblemRightsSnapshot,
  type ProblemTask,
} from './problem-artifact-manifest';
import {
  createProblemCorpusEntry,
  createProblemCorpusRegistry,
  problemCorpusIdentitySha256,
} from './problem-corpus-registry';
import {
  PROBLEM_ADMISSION_LEDGER_SCHEMA,
  admitProblemArtifact,
  createProblemAdmissionHostContext,
  type AdmittedProblemArtifact,
  type ProblemAdmissionResult,
  type ProblemAdmissionLedgerEntry,
} from './problem-admission-policy';

const SOURCE_URL = 'https://mathnet.mit.edu/explorer.html?p=corpus-canary';
const DATASET_URL = 'https://huggingface.co/datasets/ShadenA/MathNet';

function rights(): ProblemRightsSnapshot {
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
  };
}

function manifest(
  sourceId = 'mathnet:corpus-canary-001',
  overrides: Partial<ProblemArtifactManifest> = {},
): ProblemArtifactManifest {
  const statement = 'Construct the nine-point circle of triangle ABC.';
  const base = {
    schemaVersion: 'ProblemArtifactManifest/v1' as const,
    source: 'mathnet' as const,
    sourceId,
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
    contentDigest: '0'.repeat(64),
    retrievedAt: '2026-08-16T00:00:00.000Z',
    taint: PROBLEM_EXTERNAL_TAINT,
    statement: {
      kind: 'inline' as const,
      text: statement,
      bytes: new TextEncoder().encode(statement).byteLength,
      sha256: createHash('sha256').update(statement, 'utf8').digest('hex'),
      taint: PROBLEM_EXTERNAL_TAINT,
    },
    assets: [],
  } satisfies ProblemArtifactManifest;
  const candidate = {
    ...base,
    ...overrides,
    contentDigest: '0'.repeat(64),
  } as ProblemArtifactManifest;
  return { ...candidate, contentDigest: canonicalProblemArtifactSha256(candidate) };
}

function taskFor(
  value: ProblemArtifactManifest,
  overrides: Partial<ProblemTask> = {},
): ProblemTask {
  const base = {
    schemaVersion: 'ProblemTask/v1',
    taskId: `${value.sourceId}:task`,
    artifact: {
      source: value.source,
      sourceId: value.sourceId,
      contentDigest: value.contentDigest,
    },
    contentDigestAlgorithm: 'sha256' as const,
    contentDigest: '0'.repeat(64),
    facts: [{ id: 'f1', text: 'ABC is a non-degenerate triangle.', taint: PROBLEM_EXTERNAL_TAINT }],
    goal: { text: 'Construct the nine-point circle.', taint: PROBLEM_EXTERNAL_TAINT },
    expectedRelations: [{ type: 'contains', subject: 'nine-point-circle', object: 'triangle-ABC' }],
    renderExpectations: [{ kind: 'entity', target: 'nine-point-circle', description: 'Circle is visible', required: true }],
    tolerances: { coordinate: 0.001, pixel: 2 },
    split: 'canary',
    leakageGroup: `${value.sourceId}:group`,
    taint: PROBLEM_EXTERNAL_TAINT,
  };
  const candidate = { ...base, ...overrides, contentDigest: '0'.repeat(64) } as ProblemTask;
  return { ...candidate, contentDigest: canonicalProblemTaskSha256(candidate) };
}

function ledgerFor(
  value: ProblemArtifactManifest,
  task = taskFor(value),
): ProblemAdmissionLedgerEntry {
  return {
    schemaVersion: PROBLEM_ADMISSION_LEDGER_SCHEMA,
    source: value.source,
    sourceId: value.sourceId,
    contentDigest: value.contentDigest,
    taskContentDigest: task.contentDigest,
    reviewer: 'geometry-rights@example.test',
    decidedAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-09-15T00:00:00.000Z',
    evidence: [{ url: DATASET_URL, sha256: 'a'.repeat(64) }],
    lanes: {
      reference: 'allowed',
      evaluation: 'allowed',
      redistribution: 'blocked',
      commercial: 'blocked',
      training: 'blocked',
    },
  };
}

function forgedAdmission(
  value: ProblemArtifactManifest,
  task: ProblemTask,
  overrides: Record<string, unknown> = {},
): ProblemAdmissionResult {
  return {
    ok: true,
    lane: 'evaluation',
    source: value.source,
    sourceId: value.sourceId,
    contentDigest: value.contentDigest,
    manifest: value,
    task,
    tainted: true,
    readOnly: true,
    writable: false,
    writeAuthority: 'none',
    ...overrides,
  } as ProblemAdmissionResult;
}

function admitted(
  value = manifest(),
  task = taskFor(value),
): AdmittedProblemArtifact {
  const result = admitProblemArtifact({
    lane: 'evaluation',
    manifest: value,
    task,
    hostContext: createProblemAdmissionHostContext({
      now: '2026-08-16T00:00:00.000Z',
      ledger: [ledgerFor(value, task)],
    }),
  });
  if (!result.ok) throw new Error(`Test admission failed: ${result.errors[0]?.code ?? 'unknown'}`);
  return result;
}

describe('ProblemCorpusRegistry/v1', () => {
  it('accepts only an evaluation admission and emits immutable SHA-256 identity/reference', () => {
    const value = manifest();
    const task = taskFor(value);
    const result = createProblemCorpusEntry(admitted(value, task));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.reference).toMatchObject({
      schemaVersion: 'AdmittedProblemReference/v1',
      lane: 'evaluation',
      taint: PROBLEM_EXTERNAL_TAINT,
      tainted: true,
      readOnly: true,
      writable: false,
      writeAuthority: 'none',
    });
    expect(result.entry.identity).toBe(problemCorpusIdentitySha256({
      source: value.source,
      sourceId: value.sourceId,
      contentDigest: value.contentDigest,
      taskId: task.taskId,
      taskContentDigest: task.contentDigest,
      split: task.split,
      leakageGroup: task.leakageGroup,
      task,
    }));
    expect(Object.isFrozen(result.entry)).toBe(true);
    expect(Object.isFrozen(result.entry.manifest)).toBe(true);
    expect(Object.isFrozen(result.entry.task)).toBe(true);
    expect(Object.isFrozen(result.reference)).toBe(true);
  });

  it('creates an atomic frozen batch with references paired one-to-one with entries', () => {
    const first = manifest();
    const second = manifest('mathnet:corpus-canary-002');
    const result = createProblemCorpusRegistry([
      admitted(first),
      admitted(second),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.schemaVersion).toBe('ProblemCorpusRegistry/v1');
    expect(result.registry.entries).toHaveLength(2);
    expect(result.registry.references.map((entry) => entry.identity)).toEqual(
      result.registry.entries.map((entry) => entry.identity),
    );
    expect(Object.isFrozen(result.registry)).toBe(true);
    expect(Object.isFrozen(result.registry.entries)).toBe(true);
    expect(Object.isFrozen(result.registry.references)).toBe(true);
  });

  it('rejects search-reference-only and unpinned live records', () => {
    const value = manifest();
    const referenceOnly = {
      ...value,
      admission: 'search-reference-only',
      contentDigest: '0'.repeat(64),
    } as unknown as ProblemArtifactManifest;
    const liveProvider = {
      ...value,
      provider: { ...value.provider, revision: null, revisionStatus: 'unpinned-live-viewer' },
      contentDigest: '0'.repeat(64),
    } as unknown as ProblemArtifactManifest;

    const first = createProblemCorpusEntry(forgedAdmission(referenceOnly, taskFor(value)));
    const second = createProblemCorpusEntry(forgedAdmission(liveProvider, taskFor(value)));
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!first.ok) expect(first.errors.some((error) => error.code === 'not-admitted')).toBe(true);
    if (!second.ok) expect(second.errors.some((error) => error.code === 'not-admitted')).toBe(true);
  });

  it('rejects non-evaluation, rejected, and forged mutability/taint invariants', () => {
    const value = manifest();
    const receipt = admitted(value);
    const cases = [
      { ...receipt, lane: 'reference' },
      { ...receipt, ok: false },
      { ...receipt, readOnly: false },
      { ...receipt, writable: true },
      { ...receipt, writeAuthority: 'document' },
      { ...receipt, tainted: false },
      forgedAdmission(value, { ...taskFor(value), taint: 'trusted-local' } as unknown as ProblemTask),
    ];
    for (const candidate of cases) {
      const result = createProblemCorpusEntry(candidate);
      expect(result.ok).toBe(false);
    }
  });

  it('revalidates manifest/task and rejects identity drift or unknown source', () => {
    const value = manifest();
    const task = taskFor(value);
    const driftedManifest = { ...value, sourceId: 'mathnet:drifted' } as ProblemArtifactManifest;
    const driftedTask = { ...task, artifact: { ...task.artifact, sourceId: 'mathnet:other' } } as ProblemTask;
    const unknown = manifest('unknown-source:1', { source: 'unknown-source' as never });

    expect(createProblemCorpusEntry({ ...admitted(value, task), sourceId: 'mathnet:drifted' }).ok).toBe(false);
    expect(createProblemCorpusEntry(forgedAdmission(driftedManifest, taskFor(value))).ok).toBe(false);
    expect(createProblemCorpusEntry(forgedAdmission(value, driftedTask)).ok).toBe(false);
    const unknownResult = createProblemCorpusEntry(forgedAdmission(unknown, taskFor(value)));
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) expect(unknownResult.errors.some((error) => error.code === 'not-admitted')).toBe(true);
    expect(createProblemCorpusEntry({ invalid: true }).ok).toBe(false);
  });

  it('rejects task tampering after a host receipt was issued', () => {
    const value = manifest();
    const sourceTask = taskFor(value);
    const receipt = admitted(value, sourceTask);
    expect(() => {
      (receipt.task.goal as unknown as { text: string }).text = 'A tampered evaluation goal.';
    }).toThrow(TypeError);
    (sourceTask.goal as unknown as { text: string }).text = 'Caller mutation must not change the receipt.';
    expect(receipt.task.goal.text).toBe('Construct the nine-point circle.');

    const result = createProblemCorpusEntry(receipt);
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate sourceId, contentDigest, and taskId', () => {
    const first = manifest();
    const sameSource = taskFor(first, { taskId: 'different-task-id' });
    const sourceResult = createProblemCorpusRegistry([
      admitted(first),
      admitted(first, sameSource),
    ]);
    expect(sourceResult.ok).toBe(false);
    if (!sourceResult.ok) {
      expect(sourceResult.errors.some((error) => error.code === 'duplicate-source-id')).toBe(true);
      expect(sourceResult.errors.some((error) => error.code === 'duplicate-content-digest')).toBe(true);
    }

    const second = manifest('mathnet:corpus-canary-002');
    const sameTask = taskFor(second, { taskId: taskFor(first).taskId });
    const taskResult = createProblemCorpusRegistry([
      admitted(first),
      admitted(second, sameTask),
    ]);
    expect(taskResult.ok).toBe(false);
    if (!taskResult.ok) expect(taskResult.errors.some((error) => error.code === 'duplicate-task-id')).toBe(true);

  });

  it('rejects leakageGroup crossing splits while allowing independently split groups', () => {
    const first = manifest();
    const second = manifest('mathnet:corpus-canary-002');
    const sameGroup = 'mathnet:duplicate-problem-family';
    const train = taskFor(first, { split: 'train', leakageGroup: sameGroup });
    const test = taskFor(second, { split: 'test', leakageGroup: sameGroup });
    const conflict = createProblemCorpusRegistry([admitted(first, train), admitted(second, test)]);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.errors.some((error) => error.code === 'split-leakage-conflict')).toBe(true);

    const independent = createProblemCorpusRegistry([
      admitted(first, train),
      admitted(second, taskFor(second, { split: 'test', leakageGroup: 'mathnet:independent-family' })),
    ]);
    expect(independent.ok).toBe(true);
  });
});
