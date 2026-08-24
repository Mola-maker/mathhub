import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import type { GeometryEntity, SemanticTruth } from './model';
import {
  buildGeometryRepoMap,
  explainGeometryRelation,
} from './geometry-repo-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

function competitionSemanticTruth(): SemanticTruth {
  const source = readFileSync(
    path.join(
      process.cwd(),
      'lib/tikz/__fixtures__/competition/nine-point-circle.tikz',
    ),
    'utf8',
  );
  return projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, 7),
    source,
    hashAlgorithm: 'sha256-utf8',
    basis: {
      documentId: 'competition-document',
      epoch: 'competition-epoch',
      revision: 7,
      sourceHash: 'competition-source-hash',
      sourceId: 'competition-document:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  }).semantic;
}

function rankSignature(semantic: SemanticTruth) {
  return buildGeometryRepoMap(semantic, {
    focusRefs: ['A'],
    depth: 5,
    maxEntries: 32,
  }).entries.map((entry) => ({
    entityId: entry.entityId,
    score: entry.score,
    distance: entry.distance,
    reasons: entry.reasons,
    evidenceRecordIds: entry.evidenceRecordIds,
  }));
}

describe('GeometryRepoMap', () => {
  it('retrieves a bounded competition-geometry neighborhood with evidence', () => {
    const semantic = competitionSemanticTruth();
    const map = buildGeometryRepoMap(semantic, {
      focusRefs: ['A'],
      depth: 5,
      maxEntries: 32,
    });

    expect(map.schemaVersion).toBe('geometry-repo-map/v1');
    expect(map.resolvedEntityIds).toEqual(['point:A']);
    expect(map.entries[0]).toMatchObject({
      entityId: 'point:A',
      distance: 0,
      reasons: expect.arrayContaining(['explicit-focus']),
    });
    expect(map.entries.map((entry) => entry.entityId)).toEqual(expect.arrayContaining([
      'point:B',
      'point:C',
      'point:Mab',
      'point:Mac',
      'point:N',
    ]));
    expect(map.entries.some((entry) => (
      entry.entityId !== 'point:A' && entry.evidenceRecordIds.length > 0
    ))).toBe(true);
  });

  it('is deterministic when semantic records arrive in a different order', () => {
    const semantic = competitionSemanticTruth();
    const reversed: SemanticTruth = {
      ...semantic,
      ir: {
        ...semantic.ir,
        entities: [...semantic.ir.entities].reverse(),
        constraints: [...semantic.ir.constraints].reverse(),
        relations: [...semantic.ir.relations].reverse(),
        styles: [...semantic.ir.styles].reverse(),
      },
    };

    expect(rankSignature(reversed)).toEqual(rankSignature(semantic));
  });

  it('enforces the entry budget without dropping the explicit focus', () => {
    const map = buildGeometryRepoMap(competitionSemanticTruth(), {
      focusRefs: ['A'],
      depth: 5,
      maxEntries: 4,
    });

    expect(map.entries).toHaveLength(4);
    expect(map.entries[0]?.entityId).toBe('point:A');
    expect(map.candidateCount).toBeGreaterThan(4);
    expect(map.truncated).toBe(true);
  });

  it('fails closed for ambiguous aliases while exact entity ids still resolve', () => {
    const semantic = competitionSemanticTruth();
    const pointA = semantic.ir.entities.find((entity) => entity.id === 'point:A');
    expect(pointA).toBeDefined();
    const duplicate: GeometryEntity = {
      ...pointA!,
      id: 'point:A-duplicate',
      name: 'A',
    };
    const ambiguous: SemanticTruth = {
      ...semantic,
      ir: {
        ...semantic.ir,
        entities: [...semantic.ir.entities, duplicate],
      },
    };

    const byAlias = buildGeometryRepoMap(ambiguous, { focusRefs: ['A'] });
    expect(byAlias.ambiguousRefs).toEqual(['A']);
    expect(byAlias.resolvedEntityIds).toEqual([]);
    expect(byAlias.entries).toEqual([]);

    const byId = buildGeometryRepoMap(ambiguous, { focusRefs: ['point:A'] });
    expect(byId.ambiguousRefs).toEqual([]);
    expect(byId.resolvedEntityIds).toEqual(['point:A']);
    expect(byId.entries[0]?.entityId).toBe('point:A');
  });

  it('explains a deterministic evidence path through a competition construction', () => {
    const semantic = competitionSemanticTruth();
    const first = explainGeometryRelation(semantic, {
      fromRef: 'A',
      toRef: 'N',
      maxHops: 8,
    });
    const second = explainGeometryRelation(semantic, {
      fromRef: 'A',
      toRef: 'N',
      maxHops: 8,
    });

    expect(first.status).toBe('connected');
    expect(first.path.length).toBeGreaterThan(0);
    expect(first.path.flatMap((step) => step.evidenceRecordIds).length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});
