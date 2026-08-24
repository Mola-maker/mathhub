import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import {
  buildGeometrySourceMap,
  createGeometryDoc,
  type GeometryDoc,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir';
import { hashSource } from '../document/source-hash';
import { buildGeometryProofPlanArtifact } from '../semantics/geometry-proof-plan';
import {
  buildGeometryProofState,
  type GeometryProofClaimInput,
} from '../semantics/geometry-proof-state';

const fixturePath = path.join(
  process.cwd(),
  'lib',
  'tikz',
  '__fixtures__',
  'evaluation',
  'mathnet-nine-point-cyclic.tikz',
);

function createMathNetCanaryDoc(): GeometryDoc {
  const source = readFileSync(fixturePath, 'utf8');
  const analysis = analyze(source, 0);
  expect(analysis.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    basis: {
      documentId: 'mathnet-nine-point-cyclic',
      epoch: 'fixture',
      revision: 0,
      sourceId: 'mathnet-nine-point-cyclic:tikz',
      sourceHash: hashSource(source),
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
    hashAlgorithm: 'fnv1a64-utf8',
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function entityIdByName(doc: GeometryDoc, name: string): string {
  const entity = doc.semantic.ir.entities.find((candidate) => candidate.name === name);
  if (!entity) throw new Error(`Missing MathNet canary entity ${name}.`);
  return entity.id;
}

describe('MathNet nine-point cyclic geometry canary', () => {
  it('projects the independently authored Olympiad base diagram into one current GeometryDoc', () => {
    const source = readFileSync(fixturePath, 'utf8');
    const doc = createMathNetCanaryDoc();
    expect(doc.semantic.status).toBe('complete');
    const names = new Set(doc.semantic.ir.entities.map((entity) => entity.name));
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'Mab', 'Mbc', 'Mca', 'O', 'H', 'N']) {
      expect(names.has(name)).toBe(true);
    }
    expect(doc.semantic.ir.entities.some((entity) => entity.kind === 'circle')).toBe(true);
    expect(doc.rendering.flatMap((rendering) => rendering.primitives).length)
      .toBeGreaterThanOrEqual(18);
    expect(doc.construction.sources[0]?.text).toBe(source);
  });

  it('turns raw TikZ calc definitions into revision-bound formal proof premises', () => {
    const doc = createMathNetCanaryDoc();
    const id = (name: string) => entityIdByName(doc, name);
    const claims: GeometryProofClaimInput[] = [
      {
        claimId: 'mab-on-ab',
        kind: 'collinear',
        entityIds: [id('A'), id('Mab'), id('B')],
      },
      {
        claimId: 'ad-perpendicular-bc',
        kind: 'perpendicular',
        entityIds: [id('A'), id('D'), id('B'), id('C')],
      },
      {
        claimId: 'n-midpoint-oh',
        kind: 'midpoint',
        entityIds: [id('N'), id('O'), id('H')],
      },
    ];
    const proofState = buildGeometryProofState(doc, {
      allowedEntityIds: doc.semantic.ir.entities.map((entity) => entity.id),
      focusEntityIds: claims.flatMap((claim) => claim.entityIds),
      claims,
    });

    expect(proofState.completion).toBe('formal-proof-complete');
    expect(proofState.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        claimId: 'mab-on-ab',
        status: 'formally-proven',
        method: 'midpoint-implies-collinear',
      }),
      expect.objectContaining({
        claimId: 'ad-perpendicular-bc',
        status: 'formally-proven',
        method: 'perpendicular-foot-implies-perpendicular',
      }),
      expect.objectContaining({
        claimId: 'n-midpoint-oh',
        status: 'formally-proven',
        method: 'direct-source-definition',
      }),
    ]));
    expect(proofState.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceId: `definition:${id('Mab')}`,
        recordType: 'definition',
        kind: 'midpoint',
      }),
      expect.objectContaining({
        evidenceId: `definition:${id('D')}`,
        recordType: 'definition',
        kind: 'perpendicular-foot',
      }),
    ]));

    const proofPlan = buildGeometryProofPlanArtifact(proofState, {
      observationCallId: 'call:mathnet-nine-point',
      runId: 'run:mathnet-nine-point',
    });
    expect(proofPlan.authoritativeForWrite).toBe(true);
    expect(proofPlan.owner).toEqual({
      observationCallId: 'call:mathnet-nine-point',
      runId: 'run:mathnet-nine-point',
    });
    expect(proofPlan.basis).toEqual(proofState.basis);
    expect(proofPlan.goals.every((goal) => goal.status === 'formally-proven')).toBe(true);
  });
});
