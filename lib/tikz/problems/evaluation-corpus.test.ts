import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GEOMETRY_EVALUATION_CORPUS,
  GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION,
} from './evaluation-corpus';

describe('geometry evaluation corpus', () => {
  it('stores provenance and capability gates without copying problem bodies', () => {
    const ids = new Set<string>();

    for (const entry of GEOMETRY_EVALUATION_CORPUS) {
      expect(entry.schemaVersion).toBe(GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION);
      expect(ids.has(entry.caseId)).toBe(false);
      ids.add(entry.caseId);

      if (entry.source.disposition === 'research-reference-only') {
        expect(entry.source.recordId).toMatch(/^[a-z]+:/);
        expect(entry.source.admission).toBe('not-admitted');
        expect(entry.source.attributionMode).toBe('gateway-record');
        expect(entry.source).not.toHaveProperty('contentHash');
        expect(entry.source).not.toHaveProperty('contentDigest');
      } else {
        expect(entry.source.contentDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(entry.source.contentDigestAlgorithm).toBe('sha256');
        expect(entry.source.manifestSchema).toBe('ProblemArtifactManifest/v1');
        expect(entry.source.taskSchema).toBe('ProblemTask/v1');
      }
      expect(entry).not.toHaveProperty('statement');
      expect(entry).not.toHaveProperty('solution');

      const fixtureBase = path.join(
        process.cwd(),
        'lib',
        'tikz',
        '__fixtures__',
        entry.localFixture.fixturePath,
      );
      expect(existsSync(`${fixtureBase}.tikz`)).toBe(true);
      expect(existsSync(`${fixtureBase}.json`)).toBe(true);
      expect(entry.localFixture.authorship).toBe('independently-authored');
      expect(createHash('sha256').update(readFileSync(`${fixtureBase}.tikz`)).digest('hex'))
        .toBe(entry.localFixture.sourceSha256);
      expect(createHash('sha256').update(readFileSync(`${fixtureBase}.json`)).digest('hex'))
        .toBe(entry.localFixture.expectationsSha256);

      expect(entry.turns.length).toBeGreaterThanOrEqual(2);
      for (const turn of entry.turns) {
        expect(turn.instruction.trim().length).toBeGreaterThan(0);
        expect(turn.expectedCapabilities.length).toBeGreaterThan(0);
        expect(turn.invariants.length).toBeGreaterThan(0);
        expect(turn.invariants.every((invariant) => (
          typeof invariant === 'object'
          && invariant !== null
          && typeof invariant.kind === 'string'
        ))).toBe(true);
        expect(turn.invariants).not.toContainEqual(expect.any(String));
      }
    }
  });

  it('covers read, create, follow-up editing and dependency-preserving transforms', () => {
    const lanes = new Set(GEOMETRY_EVALUATION_CORPUS.flatMap((entry) => (
      entry.turns.map((turn) => turn.lane)
    )));

    expect(lanes).toEqual(new Set([
      'answer-only',
      'construct',
      'modify-existing',
      'transform-selection',
      'verify-rendering',
    ]));
  });

  it('uses only closed machine-checkable invariant kinds', () => {
    const allowed = new Set([
      'source-unchanged',
      'agent-terminal',
      'grounding-resolves',
      'single-broker-commit',
      'proposal-schema',
      'semantic-entity-delta',
      'post-commit-basis-current',
      'binding-scoped-write',
      'semantic-style-changed',
      'label-entity-delta',
      'selection-transform-attested',
      'geometry-position-changed',
      'semantic-relations-preserved',
      'external-impact-acknowledged',
      'render-artifacts-attested',
      'render-read-only',
    ]);
    const invariants = GEOMETRY_EVALUATION_CORPUS.flatMap((entry) => (
      entry.turns.flatMap((turn) => turn.invariants)
    ));
    expect(invariants.every((invariant) => allowed.has(invariant.kind))).toBe(true);
  });
});
