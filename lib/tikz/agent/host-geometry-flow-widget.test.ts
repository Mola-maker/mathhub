import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import {
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from '../authoring/construction-catalog';
import { compileConstructionPlan } from '../authoring/construction-ir';
import type { AuthoringAnchor } from '../authoring/source-builder';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import { projectTikzAnalysisToGeometryTruth, TIKZ_PLUGIN_SET_DIGEST } from '../ir/tikz-adapter';
import { hashSource } from '../semantics/scene-manifest';
import { hostGeometryFlowWidget } from './host-geometry-flow-widget';

function docFor(source: string) {
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, 0),
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'host-flow-test',
      epoch: 'epoch-1',
      revision: 0,
      sourceHash: hashSource(source),
      sourceId: 'host-flow-test:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

const SOURCE = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1.2,2.8);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (H) at ($(A)!(C)!(B)$);
\draw (A) -- (B) -- (C) -- cycle;
\draw (C) -- (M);
\draw (C) -- (H);
\pic [draw] {right angle = A--H--C};
\end{tikzpicture}`;

function ninePointSource(): string {
  const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'nine-point-circle');
  if (!spec) throw new TypeError('Nine-point circle tool is unavailable.');
  let ordinal = 0;
  const anchor = (name: string, x: number, y: number): AuthoringAnchor => ({
    name,
    position: { x, y },
    existing: true,
  });
  const plan = createCatalogConstructionPlan(spec, {
    anchors: [anchor('A', 0, 0), anchor('B', 6, 0), anchor('C', 2, 4)],
    nextName: (prefix) => `${prefix}${++ordinal}`,
    nextConstructionId: () => 'host-flow-nine-point',
  });
  return [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (6,0);',
    '\\coordinate (C) at (2,4);',
    ...compileConstructionPlan(plan).lines,
    '\\end{tikzpicture}',
  ].join('\n');
}

function simsonSource(): string {
  const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'simson-line');
  if (!spec) throw new TypeError('Simson line tool is unavailable.');
  let ordinal = 0;
  const anchor = (name: string, x: number, y: number): AuthoringAnchor => ({
    name,
    position: { x, y },
    existing: true,
  });
  const plan = createCatalogConstructionPlan(spec, {
    anchors: [anchor('A', 0, 0), anchor('B', 6, 0), anchor('C', 2, 4)],
    nextName: (prefix) => `${prefix}${++ordinal}`,
    nextConstructionId: () => 'host-flow-simson',
  });
  return [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (6,0);',
    '\\coordinate (C) at (2,4);',
    ...compileConstructionPlan(plan).lines,
    '\\end{tikzpicture}',
  ].join('\n');
}

describe('hostGeometryFlowWidget', () => {
  it('builds a canonical four-stage midpoint/altitude flow without TikZ source', () => {
    const widget = hostGeometryFlowWidget(
      '把中点 M 到中线 CM、垂足 H 到高 CH 的推导拆成四步动态几何流程图，只读，不修改画板。',
      docFor(SOURCE),
    );

    expect(widget?.kind).toBe('geometry-flow');
    expect(widget?.basis).toMatchObject({
      documentId: 'host-flow-test',
      epoch: 'epoch-1',
      revision: 0,
      sourceHash: hashSource(SOURCE),
    });
    expect(widget?.steps).toHaveLength(4);
    expect(widget?.steps.map((step) => step.state)).toEqual([
      'given', 'construction', 'deduction', 'goal',
    ]);
    expect(widget?.steps[1]).toMatchObject({
      constructionToolId: 'midpoint',
      entityRefs: expect.arrayContaining(['point:A', 'point:B', 'point:M']),
    });
    expect(widget?.steps[3]).toMatchObject({
      constructionToolId: 'perpendicular-foot',
      entityRefs: expect.arrayContaining(['point:A', 'point:B', 'point:C', 'point:H']),
      proof: { status: 'numerically-satisfied', evidenceIds: [] },
    });
    expect(JSON.stringify(widget)).not.toContain('\\draw');
    expect(widget?.steps.every((step) => step.tikz === undefined)).toBe(true);
  });

  it('fails closed when the requested semantic definitions are unavailable', () => {
    const source = String.raw`\begin{tikzpicture}\coordinate (A) at (0,0);\end{tikzpicture}`;
    expect(hostGeometryFlowWidget('生成四步动态几何流程图', docFor(source))).toBeNull();
  });

  it('projects an existing managed nine-point circle into four semantic stages', () => {
    const widget = hostGeometryFlowWidget(
      '解释九点圆的构造步骤和推导过程',
      docFor(ninePointSource()),
    );
    expect(widget).toMatchObject({
      kind: 'geometry-flow',
      steps: [
        { id: 'nine-point-given', provenance: 'semantic-kernel' },
        {
          id: 'nine-point-side-midpoints',
          constructionToolId: 'midpoint',
          provenance: 'semantic-kernel',
        },
        {
          id: 'nine-point-altitude-feet',
          constructionToolId: 'perpendicular-foot',
          provenance: 'semantic-kernel',
        },
        {
          id: 'nine-point-circle-goal',
          constructionToolId: 'nine-point-circle',
          provenance: 'semantic-kernel',
          proof: { status: 'formally-proven' },
        },
      ],
    });
    expect(widget?.steps[3]?.entityRefs).toHaveLength(12);
    expect(widget?.steps[3]?.proof?.evidenceIds).toHaveLength(9);
    expect(JSON.stringify(widget)).not.toContain('\\draw');
  });

  it('does not generate a widget for an ordinary explanation request', () => {
    expect(hostGeometryFlowWidget('解释中点 M。', docFor(SOURCE))).toBeNull();
  });

  it('reconstructs a Simson-line proof flow only from attested constraints', () => {
    const widget = hostGeometryFlowWidget(
      '把西姆松线的构造和共线推导拆成动态流程图',
      docFor(simsonSource()),
    );
    expect(widget).toMatchObject({
      kind: 'geometry-flow',
      steps: [
        { id: 'simson-circumcircle', constructionToolId: 'circumcircle' },
        { id: 'simson-circle-point', constructionToolId: 'point-on-circle' },
        { id: 'simson-pedal-feet', constructionToolId: 'perpendicular-foot' },
        {
          id: 'simson-collinear-goal',
          constructionToolId: 'simson-line',
          proof: { status: 'formally-proven' },
        },
      ],
    });
    expect(widget?.steps[3]?.entityRefs).toHaveLength(4);
    expect(JSON.stringify(widget)).not.toContain('\\draw');
  });
});
