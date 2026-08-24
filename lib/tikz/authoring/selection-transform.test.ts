import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { applyTextPatches } from '../document/source-transaction';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import { hashSource } from '../semantics/scene-manifest';
import {
  analyzeSelectionTransformCapability,
  planSelectionTransform,
} from './selection-transform';

const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

function fixture(source: string) {
  const analysis = analyze(source, 0);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'selection-transform-doc',
      epoch: 'epoch',
      revision: 0,
      sourceHash: hashSource(source),
      sourceId: 'selection-transform-doc:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

describe('selection transforms', () => {
  it('translates and uniformly scales rectangle corners but rejects axis-changing rewrites', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,2);',
      '\\draw (A) rectangle (B);',
    ].join('\n'));
    const doc = fixture(source);
    const rectangle = doc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polygon'
      && entity.parameters?.sourcePathOperator === 'rectangle'
    ));
    if (!rectangle) throw new Error('rectangle fixture missing');

    const translated = planSelectionTransform(source, doc, [rectangle.id], {
      kind: 'translate', dx: 1, dy: -1,
    });
    const translatedSource = applyTextPatches(source, translated.patches);
    expect(translatedSource).toContain('\\coordinate (A) at (1,-1);');
    expect(translatedSource).toContain('\\coordinate (B) at (5,1);');

    const scaled = planSelectionTransform(source, doc, [rectangle.id], {
      kind: 'scale', factor: 2, center: 'selection',
    });
    const scaledSource = applyTextPatches(source, scaled.patches);
    expect(scaledSource).toContain('\\coordinate (A) at (-2,-1);');
    expect(scaledSource).toContain('\\coordinate (B) at (6,3);');

    expect(() => planSelectionTransform(source, doc, [rectangle.id], {
      kind: 'rotate', degrees: 30, center: 'selection',
    })).toThrow(/rectangle|polygon|图元/iu);
    expect(() => planSelectionTransform(source, doc, [rectangle.id], {
      kind: 'reflect',
      lineStart: { x: 0, y: 0 },
      lineEnd: { x: 1, y: 1 },
    })).toThrow(/rectangle|polygon|图元/iu);
  });

  it('projects an ellipse and rewrites both radius slots for uniform scale', () => {
    const source = wrap([
      '\\coordinate (O) at (1,2);',
      '\\draw (O) ellipse (2 and 1);',
    ].join('\n'));
    const doc = fixture(source);
    const ellipse = doc.semantic.ir.entities.find((entity) => entity.kind === 'ellipse');
    expect(ellipse).toMatchObject({
      parameters: { center: { x: 1, y: 2 }, xRadius: 2, yRadius: 1 },
    });
    if (!ellipse) return;

    const translated = planSelectionTransform(source, doc, [ellipse.id], {
      kind: 'translate', dx: 3, dy: -1,
    });
    expect(applyTextPatches(source, translated.patches)).toContain('\\coordinate (O) at (4,1);');
    const scaled = planSelectionTransform(source, doc, [ellipse.id], {
      kind: 'scale', factor: 2, center: 'selection',
    });
    expect(scaled.parameterWrites).toEqual([
      expect.objectContaining({ kind: 'ellipse-x-radius', sourceValue: 2, targetValue: 4 }),
      expect.objectContaining({ kind: 'ellipse-y-radius', sourceValue: 1, targetValue: 2 }),
    ]);
    expect(applyTextPatches(source, scaled.patches)).toContain('ellipse (4 and 2)');
    expect(() => planSelectionTransform(source, doc, [ellipse.id], {
      kind: 'rotate', degrees: 30, center: 'selection',
    })).toThrow(/椭圆|ellipse/iu);
  });

  it('rotates an ellipse only through an attested path-local rotation slot', () => {
    const source = wrap([
      '\\coordinate (O) at (1,2);',
      '\\draw[rotate=10] (O) ellipse (2 and 1);',
    ].join('\n'));
    const doc = fixture(source);
    const ellipse = doc.semantic.ir.entities.find((entity) => entity.kind === 'ellipse');
    if (!ellipse) throw new Error('ellipse fixture missing');

    const rotated = planSelectionTransform(source, doc, [ellipse.id], {
      kind: 'rotate', degrees: 30, center: 'selection',
    });
    expect(rotated.parameterWrites).toEqual([
      expect.objectContaining({
        kind: 'ellipse-rotation',
        sourceValue: 10,
        targetValue: 40,
        targetWorldRotationDegrees: 40,
      }),
    ]);
    expect(applyTextPatches(source, rotated.patches))
      .toContain('\\draw[rotate=40] (O) ellipse (2 and 1);');
  });

  it('translates the free-point dependency closure of one selected segment', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (Z) at (9,9);',
      '\\draw (A) -- (B);',
    ].join('\n'));
    const doc = fixture(source);
    const segment = doc.semantic.ir.entities.find((entity) => entity.kind === 'polyline');
    expect(segment).toBeDefined();
    if (!segment) return;

    const plan = planSelectionTransform(source, doc, [segment.id], {
      kind: 'translate',
      dx: 2,
      dy: -1,
    });
    const next = applyTextPatches(source, plan.patches);

    expect(plan.variableEntityIds).toEqual(['point:A', 'point:B']);
    expect(plan.externalImpactedEntityIds).toEqual([]);
    expect(next).toContain('\\coordinate (A) at (2,-1);');
    expect(next).toContain('\\coordinate (B) at (6,-1);');
    expect(next).toContain('\\coordinate (Z) at (9,9);');
  });

  it('reports selection-external dependents before committing', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (C) at (2,3);',
      '\\draw (A) -- (B);',
      '\\draw (A) -- (C);',
    ].join('\n'));
    const doc = fixture(source);
    const segments = doc.semantic.ir.entities.filter((entity) => entity.kind === 'polyline');
    const capability = analyzeSelectionTransformCapability(source, doc, [segments[0]!.id], {
      kind: 'translate', dx: 1, dy: 0,
    });

    expect(capability.status).toBe('warning');
    expect(capability.variableEntityIds).toEqual(['point:A', 'point:B']);
    expect(capability.externalImpactedEntityIds).toContain(segments[1]!.id);
  });

  it('rotates a selected edge around the selection centroid', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      '\\draw (A) -- (B);',
    ].join('\n'));
    const doc = fixture(source);
    const segment = doc.semantic.ir.entities.find((entity) => entity.kind === 'polyline')!;
    const plan = planSelectionTransform(source, doc, [segment.id], {
      kind: 'rotate',
      degrees: 90,
      center: 'selection',
    });
    const next = applyTextPatches(source, plan.patches);

    expect(next).toContain('\\coordinate (A) at (1,-1);');
    expect(next).toContain('\\coordinate (B) at (1,1);');
  });

  it('uses the visible definition bounds rather than the driver centroid as the selection pivot', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (C) at (0,1);',
      '\\draw (A) -- (B) -- (C) -- cycle;',
    ].join('\n'));
    const doc = fixture(source);
    const triangle = doc.semantic.ir.entities.find((entity) => entity.kind === 'polygon')!;
    const plan = planSelectionTransform(source, doc, [triangle.id], {
      kind: 'rotate',
      degrees: 180,
      center: 'selection',
    });
    const next = applyTextPatches(source, plan.patches);

    expect(plan.transform).toMatchObject({ center: { x: 2, y: 0.5 } });
    expect(next).toContain('\\coordinate (A) at (4,1);');
    expect(next).toContain('\\coordinate (B) at (0,1);');
    expect(next).toContain('\\coordinate (C) at (4,0);');
  });

  it('translates a selected circular arc through its current-point definition', () => {
    const source = wrap([
      '\\coordinate (A) at (2,0);',
      '\\draw (A) arc (0:90:2);',
    ].join('\n'));
    const doc = fixture(source);
    const arc = doc.semantic.ir.entities.find((entity) => entity.kind === 'circular-arc')!;
    const plan = planSelectionTransform(source, doc, [arc.id], {
      kind: 'translate', dx: 1, dy: 2,
    });
    expect(applyTextPatches(source, plan.patches)).toContain('\\coordinate (A) at (3,2);');
  });

  it('translates an affine elliptical arc but blocks unproven angle-changing writes', () => {
    const source = wrap([
      '\\begin{scope}[xslant=1]',
      '\\coordinate (A) at (1,0);',
      '\\draw (A) arc (0:90:1);',
      '\\end{scope}',
    ].join('\n'));
    const doc = fixture(source);
    const arc = doc.semantic.ir.entities.find((entity) => entity.kind === 'elliptical-arc')!;
    const translated = planSelectionTransform(source, doc, [arc.id], {
      kind: 'translate', dx: 1, dy: 0,
    });
    expect(applyTextPatches(source, translated.patches))
      .toContain('\\coordinate (A) at (2,0);');
    expect(() => planSelectionTransform(source, doc, [arc.id], {
      kind: 'rotate', degrees: 30, center: 'selection',
    })).toThrow(/elliptical-arc/u);
  });

  it('rotates an arc through its start point and both angle slots', () => {
    const source = wrap([
      '\\coordinate (A) at (2,0);',
      '\\draw (A) arc (0:90:2);',
    ].join('\n'));
    const doc = fixture(source);
    const arc = doc.semantic.ir.entities.find((entity) => entity.kind === 'circular-arc')!;
    const plan = planSelectionTransform(source, doc, [arc.id], {
      kind: 'rotate', degrees: 30, center: 'selection',
    });
    const next = applyTextPatches(source, plan.patches);

    expect(plan.parameterWrites).toEqual([
      expect.objectContaining({
        kind: 'arc-start-angle', sourceValue: 0, targetValue: 30,
      }),
      expect.objectContaining({
        kind: 'arc-end-angle', sourceValue: 90, targetValue: 120,
      }),
    ]);
    expect(next).toContain('arc (30:120:2)');
  });

  it('scales and reflects an arc through complete angle/radius slots', () => {
    const source = wrap([
      '\\coordinate (A) at (2,0);',
      '\\draw (A) arc[start angle=0,end angle=90,radius=2];',
    ].join('\n'));
    const doc = fixture(source);
    const arc = doc.semantic.ir.entities.find((entity) => entity.kind === 'circular-arc')!;
    const scale = planSelectionTransform(source, doc, [arc.id], {
      kind: 'scale', factor: 2, center: 'selection',
    });
    const reflected = planSelectionTransform(source, doc, [arc.id], {
      kind: 'reflect', lineStart: { x: 0, y: 0 }, lineEnd: { x: 1, y: 0 },
    });

    expect(scale.parameterWrites).toEqual([
      expect.objectContaining({
        kind: 'arc-radius', sourceValue: 2, targetValue: 4,
      }),
    ]);
    expect(applyTextPatches(source, scale.patches)).toContain('radius=4');
    expect(reflected.parameterWrites).toEqual([
      expect.objectContaining({ kind: 'arc-start-angle', targetValue: 0 }),
      expect.objectContaining({ kind: 'arc-end-angle', targetValue: -90 }),
    ]);
    expect(applyTextPatches(source, reflected.patches))
      .toContain('start angle=0,end angle=-90,radius=2');
  });

  it('scales a center-radius circle through its center driver and literal radius slot', () => {
    const source = wrap([
      '\\coordinate (O) at (0,0);',
      '\\draw (O) circle (2);',
    ].join('\n'));
    const doc = fixture(source);
    const circle = doc.semantic.ir.entities.find((entity) => entity.kind === 'circle')!;

    const plan = planSelectionTransform(source, doc, [circle.id], {
      kind: 'scale', factor: 2, center: 'selection',
    });
    const next = applyTextPatches(source, plan.patches);

    expect(plan.parameterWrites).toEqual([expect.objectContaining({
      kind: 'circle-radius',
      semanticEntityId: circle.id,
      sourceValue: 2,
      targetValue: 4,
      targetWorldRadius: 4,
      insert: '(4)',
    })]);
    expect(next).toContain('\\draw (O) circle (4);');
  });

  it('rejects cubic Bezier transforms instead of moving only its named start point', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\draw (A) .. controls (1,2) and (3,2) .. (4,0);',
    ].join('\n'));
    const doc = fixture(source);
    const curve = doc.semantic.ir.entities.find((entity) => entity.kind === 'cubic-bezier')!;

    const capability = analyzeSelectionTransformCapability(source, doc, [curve.id], {
      kind: 'translate', dx: 1, dy: 0,
    });

    expect(capability.status).toBe('blocked');
    expect(capability.reason).toMatch(/cubic-bezier/);
  });

  it('transforms a cubic Bezier when all four roles are named writable points', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (C1) at (1,2);',
      '\\coordinate (C2) at (3,2);',
      '\\coordinate (B) at (4,0);',
      '\\draw (A) .. controls (C1) and (C2) .. (B);',
    ].join('\n'));
    const doc = fixture(source);
    const curve = doc.semantic.ir.entities.find((entity) => entity.kind === 'cubic-bezier')!;

    expect(curve.parameters?.pointOrigins).toEqual([
      { kind: 'named', name: 'A' },
      { kind: 'named', name: 'C1' },
      { kind: 'named', name: 'C2' },
      { kind: 'named', name: 'B' },
    ]);
    const plan = planSelectionTransform(source, doc, [curve.id], {
      kind: 'rotate', degrees: 90, center: 'selection',
    });
    const next = applyTextPatches(source, plan.patches);

    expect(plan.variableEntityIds).toEqual(['point:A', 'point:B', 'point:C1', 'point:C2']);
    expect(plan.transform).toMatchObject({ center: { x: 2, y: 1 } });
    expect(next).toContain('\\coordinate (A) at (3,-1);');
    expect(next).toContain('\\coordinate (C1) at (1,0);');
    expect(next).toContain('\\coordinate (C2) at (1,2);');
    expect(next).toContain('\\coordinate (B) at (3,3);');
  });

  it('blocks a partial cubic transform when only one referenced point is selected', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (C1) at (1,2);',
      '\\coordinate (C2) at (3,2);',
      '\\coordinate (B) at (4,0);',
      '\\draw (A) .. controls (C1) and (C2) .. (B);',
    ].join('\n'));
    const doc = fixture(source);
    const capability = analyzeSelectionTransformCapability(source, doc, ['point:A'], {
      kind: 'translate', dx: 1, dy: 0,
    });

    expect(capability.status).toBe('blocked');
    expect(capability.reason).toMatch(/partially update dependent cubic-bezier/);
  });
});
