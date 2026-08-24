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
  PROBLEM_ADMISSION_LEDGER_SCHEMA,
  admitProblemArtifact,
  createProblemAdmissionHostContext,
  validateProblemAdmissionLedgerEntry,
  type ProblemAdmissionLedgerEntry,
} from './problem-admission-policy';

const SOURCE_URL = 'https://mathnet.mit.edu/explorer.html?p=canary';
const DATASET_URL = 'https://huggingface.co/datasets/ShadenA/MathNet';
const STATEMENT = 'Construct the nine-point circle of triangle ABC.';
const STATEMENT_SHA256 = createHash('sha256').update(STATEMENT, 'utf8').digest('hex');

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
    source: 'mathnet' as const,
    sourceId: 'mathnet:admission-canary',
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
      text: STATEMENT,
      bytes: new TextEncoder().encode(STATEMENT).byteLength,
      sha256: STATEMENT_SHA256,
      taint: PROBLEM_EXTERNAL_TAINT,
    },
    assets: [],
  } satisfies ProblemArtifactManifest;
  const candidate = { ...base, ...overrides, contentDigest: '0'.repeat(64) } as ProblemArtifactManifest;
  return { ...candidate, contentDigest: canonicalProblemArtifactSha256(candidate) };
}

function taskFor(value: ProblemArtifactManifest): ProblemTask {
  const candidate: ProblemTask = {
    schemaVersion: 'ProblemTask/v1' as const,
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
  return { ...candidate, contentDigest: canonicalProblemTaskSha256(candidate) };
}

function ledgerFor(
  value: ProblemArtifactManifest,
  overrides: Partial<ProblemAdmissionLedgerEntry> = {},
): ProblemAdmissionLedgerEntry {
  return {
    schemaVersion: PROBLEM_ADMISSION_LEDGER_SCHEMA,
    source: value.source,
    sourceId: value.sourceId,
    contentDigest: value.contentDigest,
    taskContentDigest: taskFor(value).contentDigest,
    reviewer: 'geometry-rights@example.test',
    decidedAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-09-15T00:00:00.000Z',
    evidence: [{ url: DATASET_URL, sha256: 'a'.repeat(64) }],
    lanes: {
      reference: 'allowed',
      evaluation: 'allowed',
      redistribution: 'allowed',
      commercial: 'allowed',
      training: 'allowed',
    },
    ...overrides,
  };
}

describe('host-only problem admission policy', () => {
  it('admits a pure reference while retaining taint and read-only status', () => {
    const value = manifest();
    const result = admitProblemArtifact({
      lane: 'reference',
      manifest: value,
      task: taskFor(value),
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value)],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      source: 'mathnet',
      tainted: true,
      readOnly: true,
      writable: false,
      writeAuthority: 'none',
    });
  });

  it.each(['evaluation', 'training'] as const)(
    'does not let an allowed-looking MathNet manifest enter %s without an exact ledger allowance',
    (lane) => {
      const value = manifest();
      const result = admitProblemArtifact({
        lane,
        manifest: value,
        task: taskFor(value),
        hostContext: createProblemAdmissionHostContext({ now: '2026-08-16T00:00:00.000Z' }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('ledger-required');
    },
  );

  it('requires exact source, sourceId, digest, and lane matching in the ledger', () => {
    const value = manifest();
    const task = taskFor(value);
    const allowed = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value)],
      }),
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.ledgerEntry?.contentDigest).toBe(value.contentDigest);

    const wrongDigest = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value, { contentDigest: 'f'.repeat(64) })],
      }),
    });
    expect(wrongDigest.ok).toBe(false);
    if (!wrongDigest.ok) expect(wrongDigest.errors[0].code).toBe('ledger-no-match');

    const blockedLane = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value, { lanes: { ...ledgerFor(value).lanes, evaluation: 'blocked' } })],
      }),
    });
    expect(blockedLane.ok).toBe(false);
    if (!blockedLane.ok) expect(blockedLane.errors[0].code).toBe('ledger-blocked');

    const authorizedTask = taskFor(value);
    const differentTaskCandidate: ProblemTask = {
      ...authorizedTask,
      taskId: `${value.sourceId}:different-task`,
    };
    const differentTask: ProblemTask = {
      ...differentTaskCandidate,
      contentDigest: canonicalProblemTaskSha256(differentTaskCandidate),
    };
    const reusedLedger = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task: differentTask,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value)],
      }),
    });
    expect(reusedLedger.ok).toBe(false);
    if (!reusedLedger.ok) expect(reusedLedger.errors[0].code).toBe('ledger-no-match');
  });

  it('returns an independent deeply frozen receipt snapshot', () => {
    const value = manifest();
    const task = taskFor(value);
    const result = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value)],
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.rights)).toBe(true);
    expect(Object.isFrozen(result.manifest.statement)).toBe(true);
    expect(Object.isFrozen(result.task)).toBe(true);
    expect(Object.isFrozen(result.task.goal)).toBe(true);
    expect(Object.isFrozen(result.ledgerEntry)).toBe(true);

    (value.rights.dataset as unknown as { decision: string }).decision = 'prohibited';
    (task.goal as unknown as { text: string }).text = 'Caller mutation must not change the receipt.';
    expect(result.manifest.rights.dataset.decision).toBe('allowed');
    expect(result.task.goal.text).toBe('Construct the nine-point circle.');
  });

  it('rejects malformed or expired review evidence instead of trusting display fields', () => {
    const value = manifest();
    const task = taskFor(value);
    const cases: Array<{ name: string; entry: ProblemAdmissionLedgerEntry; code: string }> = [
      { name: 'tampered reviewer', entry: ledgerFor(value, { reviewer: '' }), code: 'ledger-invalid' },
      { name: 'tampered evidence', entry: ledgerFor(value, { evidence: [{ url: DATASET_URL, sha256: 'short' }] }), code: 'ledger-invalid' },
      { name: 'expired review', entry: ledgerFor(value, { expiresAt: '2026-08-15T23:59:59.000Z' }), code: 'ledger-expired' },
    ];
    for (const testCase of cases) {
      const result = admitProblemArtifact({
        lane: 'evaluation',
        manifest: value,
        task,
        hostContext: createProblemAdmissionHostContext({
          now: '2026-08-16T00:00:00.000Z',
          ledger: [testCase.entry],
        }),
      });
      expect(result.ok, testCase.name).toBe(false);
      if (!result.ok) expect(result.errors[0].code, testCase.name).toBe(testCase.code);
    }
  });

  it('rejects future decisions and lets the newest exact block override an older allow', () => {
    const value = manifest();
    const task = taskFor(value);
    const future = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value, {
          decidedAt: '2026-08-17T00:00:00.000Z',
          expiresAt: '2026-09-17T00:00:00.000Z',
        })],
      }),
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0].code).toBe('ledger-invalid');

    const newestBlock = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [
          ledgerFor(value, { decidedAt: '2026-08-14T00:00:00.000Z' }),
          ledgerFor(value, {
            decidedAt: '2026-08-15T00:00:00.000Z',
            lanes: { ...ledgerFor(value).lanes, evaluation: 'blocked' },
          }),
        ],
      }),
    });
    expect(newestBlock.ok).toBe(false);
    if (!newestBlock.ok) expect(newestBlock.errors[0].code).toBe('ledger-blocked');

    const ambiguousNewest = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task,
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [
          ledgerFor(value, {
            decidedAt: '2026-08-15T00:00:00.000Z',
            lanes: { ...ledgerFor(value).lanes, evaluation: 'allowed' },
          }),
          ledgerFor(value, {
            decidedAt: '2026-08-15T00:00:00.000Z',
            lanes: { ...ledgerFor(value).lanes, evaluation: 'blocked' },
          }),
        ],
      }),
    });
    expect(ambiguousNewest.ok).toBe(false);
    if (!ambiguousNewest.ok) expect(ambiguousNewest.errors[0].code).toBe('ledger-invalid');
  });

  it('does not admit a prohibited asset even when the source ledger allows evaluation', () => {
    const value = manifest({
      assets: [{
        assetId: 'diagram-1',
        role: 'problem-diagram',
        providerPathOrUrl: 'images/diagram.png',
        sha256: 'd'.repeat(64),
        bytes: 1_024,
        mediaType: 'image/png',
        width: 64,
        height: 64,
        alt: 'Geometry diagram',
        rightsDecision: 'prohibited',
      }],
    });
    const result = admitProblemArtifact({
      lane: 'evaluation',
      manifest: value,
      task: taskFor(value),
      hostContext: createProblemAdmissionHostContext({
        now: '2026-08-16T00:00:00.000Z',
        ledger: [ledgerFor(value)],
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('manifest-blocked');
  });

  it('rejects an unknown manifest source with a structured source error', () => {
    const value = manifest({ source: 'not-in-catalog' as never, sourceId: 'not-in-catalog:1' });
    const result = admitProblemArtifact({
      lane: 'reference',
      manifest: value,
      task: taskFor(value),
      hostContext: createProblemAdmissionHostContext(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'source-unknown')).toBe(true);
  });

  it('requires restricted opt-in and never upgrades FormalGeo blocked commercial/training lanes', () => {
    const value = manifest({
      source: 'formalgeo',
      sourceId: 'formalgeo:admission-canary',
      provenance: {
        sourceUrl: 'https://github.com/FormalGeo/FormalGeo',
        datasetUrl: 'https://github.com/FormalGeo/FormalGeo',
        evidence: [{ kind: 'source', url: 'https://github.com/FormalGeo/FormalGeo' }],
      },
    });
    const task = taskFor(value);
    const withoutOptIn = admitProblemArtifact({
      lane: 'commercial', manifest: value, task,
      hostContext: createProblemAdmissionHostContext({ ledger: [ledgerFor(value)] }),
    });
    expect(withoutOptIn.ok).toBe(false);
    if (!withoutOptIn.ok) expect(withoutOptIn.errors[0].code).toBe('restricted-opt-in-required');

    const withOptIn = admitProblemArtifact({
      lane: 'commercial', manifest: value, task,
      hostContext: createProblemAdmissionHostContext({ restrictedOptIn: true, ledger: [ledgerFor(value)] }),
    });
    expect(withOptIn.ok).toBe(false);
    if (!withOptIn.ok) expect(withOptIn.errors[0].code).toBe('catalog-blocked');

    const training = admitProblemArtifact({
      lane: 'training', manifest: value, task,
      hostContext: createProblemAdmissionHostContext({ restrictedOptIn: true, ledger: [ledgerFor(value)] }),
    });
    expect(training.ok).toBe(false);
    if (!training.ok) expect(training.errors[0].code).toBe('catalog-blocked');
  });

  it('does not accept a plain JSON-shaped context as a host capability', () => {
    const value = manifest();
    const result = admitProblemArtifact({
      lane: 'reference',
      manifest: value,
      task: taskFor(value),
      hostContext: { ledger: [], restrictedOptIn: false, now: '2026-08-16T00:00:00.000Z' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('host-context-required');
  });

  it('validates the ledger schema independently before admission', () => {
    const value = manifest();
    expect(validateProblemAdmissionLedgerEntry(ledgerFor(value))).toMatchObject({ ok: true });
    const { taskContentDigest: _taskContentDigest, ...legacyLedger } = ledgerFor(value);
    expect(validateProblemAdmissionLedgerEntry(legacyLedger)).toMatchObject({ ok: false });
    const { schemaVersion: _schemaVersion, ...withoutSchema } = ledgerFor(value);
    expect(validateProblemAdmissionLedgerEntry(withoutSchema)).toMatchObject({ ok: false });
    expect(validateProblemAdmissionLedgerEntry({
      ...ledgerFor(value),
      lanes: { ...ledgerFor(value).lanes, evaluation: 'maybe' },
    })).toMatchObject({ ok: false });
  });
});
