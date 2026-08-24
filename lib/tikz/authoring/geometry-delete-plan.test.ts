import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import { hashSource } from '../semantics/scene-manifest';
import { planGeometryDocDeletion } from './geometry-delete-plan';
import { createPrimitiveConstructionPlan } from './construction-catalog';
import { compileNewManagedConstructionPlan } from './construction-ir-v3';

// analyze() projects a scene only for a complete tikzpicture document.
const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

function fixture(source: string) {
  const analysis = analyze(source, 0);
  if (!analysis.scene || !analysis.stmts) {
    throw new TypeError('fixture requires a complete interactive projection');
  }
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'doc',
      epoch: 'epoch',
      revision: 0,
      sourceHash: hashSource(source),
      sourceId: 'doc:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return {
    analysis,
    geometryDoc: createGeometryDoc(truths, buildGeometrySourceMap(truths)),
  };
}

describe('planGeometryDocDeletion', () => {
  const source = wrap([
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (2,0);',
    '\\draw (A) -- (B);',
  ].join('\n'));

  it('blocks deletion from the GeometryDoc dependency graph', () => {
    const { analysis, geometryDoc } = fixture(source);
    expect(() => planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts!,
      targets: 'point:A',
      mode: 'block',
    })).toThrow(/dependent entities/);
  });

  it('uses GeometryDoc closure while CST supplies source ranges only', () => {
    const { analysis, geometryDoc } = fixture(source);
    const plan = planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts!,
      targets: 'point:A',
      mode: 'cascade',
    });

    expect(plan.rootNodeIds).toEqual(['point:A']);
    expect(plan.affectedNodeIds).toContain('point:A');
    expect(plan.affectedNodeIds).toContain('element:2:0');
    expect(plan.removedStatementIndices).toEqual([0, 2]);
    expect(plan.patches).toHaveLength(2);
    expect(plan.patches.some((patch) => source.slice(patch.from, patch.to).includes('(B) at')))
      .toBe(false);
  });

  it('rejects a stale GeometryDoc even when Scene still has matching coordinates', () => {
    const { analysis, geometryDoc } = fixture(source);
    expect(() => planGeometryDocDeletion({
      source: `${source}% changed`,
      geometryDoc,
      statements: analysis.stmts!,
      targets: 'point:A',
      mode: 'cascade',
    })).toThrow(/complete current source projection/);
  });

  it('treats managed relation inputs as dependencies, never as source owners', () => {
    const segment = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'segment-a-b-delete-closure',
    });
    const managedSource = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      ...compileNewManagedConstructionPlan(segment).lines,
    ].join('\n'));
    const { analysis, geometryDoc } = fixture(managedSource);

    expect(() => planGeometryDocDeletion({
      source: managedSource,
      geometryDoc,
      statements: analysis.stmts!,
      targets: 'point:A',
      mode: 'block',
    })).toThrow(/dependent entities/);

    const cascade = planGeometryDocDeletion({
      source: managedSource,
      geometryDoc,
      statements: analysis.stmts!,
      targets: 'point:A',
      mode: 'cascade',
    });
    expect(cascade.removedNodeIds).toContain('point:A');
    expect(cascade.removedNodeIds).not.toContain('point:B');
    expect(cascade.patches.some((patch) => (
      managedSource.slice(patch.from, patch.to).includes('segment-a-b-delete-closure')
    ))).toBe(true);
    expect(cascade.patches.some((patch) => (
      managedSource.slice(patch.from, patch.to).includes('coordinate (B) at')
    ))).toBe(false);
  });
});
