import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import {
  buildGeometryAiContext,
  type GeometryAiContextOptions,
} from './ai-context';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';
import { buildGeometrySourceMap } from './source-map';
import { createGeometryDoc } from './geometry-doc';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  createPrimitiveConstructionPlan,
} from '../authoring/construction-catalog';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';

function managedCircle(
  constructionId: string,
  center: { readonly name: string; readonly x: number; readonly y: number },
  through: { readonly name: string; readonly x: number; readonly y: number },
) {
  const plan = createPrimitiveConstructionPlan('circle', {
    anchors: [
      {
        name: center.name,
        position: { x: center.x, y: center.y },
        existing: true,
      },
      {
        name: through.name,
        position: { x: through.x, y: through.y },
        existing: true,
      },
    ],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => constructionId,
  });
  return compileNewManagedConstructionPlan(plan).lines.join('\n');
}

function contextFor(
  source: string,
  focusRefs: readonly string[],
  options: GeometryAiContextOptions = {},
) {
  const analysis = analyze(source, 3);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    hashAlgorithm: 'sha256-utf8',
    basis: {
      documentId: 'document-1',
      epoch: 'epoch-1',
      revision: 3,
      sourceHash: 'source-hash',
      sourceId: 'document-1:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return buildGeometryAiContext(
    createGeometryDoc(truths, buildGeometrySourceMap(truths)),
    { focusRefs, ...options },
  );
}

describe('Geometry AI context write policy', () => {
  it('connects path parameter references into the focus closure', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (2,0);
\draw (A) -- (B);
\end{tikzpicture}`;
    const context = contextFor(source, ['A']);

    expect(context.focus.closureEntityIds).toEqual(expect.arrayContaining([
      'point:A',
      'point:B',
    ]));
    expect(context.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'polyline' }),
    ]));
  });

  it('publishes static graph nodes and directed topology without granting a source writer', () => {
    const source = String.raw`\begin{tikzpicture}
\graph [nodes={draw,circle}, grow right=2cm] { A -> B -- C -!- D };
\end{tikzpicture}`;
    const context = contextFor(source, ['A']);
    expect(context.entities.filter((entity) => entity.kind === 'graph-node')).toHaveLength(4);
    expect(context.relations.filter((relation) => relation.kind === 'graph-edge')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          directed: true,
          properties: expect.objectContaining({ connector: '->', visible: true }),
        }),
        expect.objectContaining({
          directed: false,
          properties: expect.objectContaining({ connector: '--', visible: true }),
        }),
        expect.objectContaining({
          directed: false,
          properties: expect.objectContaining({ connector: '-!-', visible: false }),
        }),
      ]),
    );
    const graphNodeA = context.entities.find((entity) => (
      entity.kind === 'graph-node' && entity.name === 'A'
    ));
    expect(graphNodeA).toBeDefined();
    expect(graphNodeA?.parameters).toMatchObject({
      layoutIntent: 'standard',
      layoutFidelity: 'deterministic-preview',
      exactCompilerRequired: false,
    });
    expect(context.construction.sourceBindings
      .filter((binding) => binding.targets.some((target) => target.id === graphNodeA?.id))
      .map((binding) => binding.writable)).toEqual([false]);
  });

  it('tells AI when graphdrawing coordinates are preview-only and exact-compiler authoritative', () => {
    const context = contextFor(String.raw`\begin{tikzpicture}
\graph [layered layout] { A -> { B, C } };
\end{tikzpicture}`, []);
    const nodes = context.entities.filter((entity) => entity.kind === 'graph-node');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      parameters: {
        layoutIntent: 'layered',
        layoutAlgorithm: 'layered layout',
        layoutFidelity: 'deterministic-preview',
        exactCompilerRequired: true,
      },
      tags: expect.arrayContaining(['layout:layered', 'exact-compiler-authoritative']),
    });
  });

  it('publishes official chain-group entry and exit topology to AI context', () => {
    const source = String.raw`\begin{tikzpicture}
\graph { A -> { B -> C, D -> E } -> F };
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const graphNodes = context.entities.filter((entity) => entity.kind === 'graph-node');
    const namesById = new Map(graphNodes.map((entity) => [entity.id, entity.name] as const));
    expect(graphNodes).toHaveLength(6);
    expect(context.relations
      .filter((relation) => relation.kind === 'graph-edge')
      .map((relation) => relation.participants.map((participant) => namesById.get(participant.entityId))))
      .toEqual(expect.arrayContaining([
        ['A', 'B'],
        ['A', 'D'],
        ['B', 'C'],
        ['D', 'E'],
        ['C', 'F'],
        ['E', 'F'],
      ]));
  });

  it('publishes deterministic adapter-derived kernel and projection identities', () => {
    const source = String.raw`\begin{tikzpicture}\coordinate (A) at (0,0);\end{tikzpicture}`;
    const first = contextFor(source, ['A']);
    const second = contextFor(source, ['A']);

    expect(first.basis.kernelHash).toEqual(expect.any(String));
    expect(first.basis.projectionHash).toEqual(expect.any(String));
    expect(second.basis.kernelHash).toBe(first.basis.kernelHash);
    expect(second.basis.projectionHash).toBe(first.basis.projectionHash);
  });

  it('distinguishes named and anonymous polyline endpoints in world geometry', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xshift=2cm]
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{scope}
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const polyline = context.entities.find((entity) => entity.kind === 'polyline');

    expect(polyline?.parameters?.points).toEqual([
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(polyline?.parameters?.pointOrigins).toEqual([
      { kind: 'named', name: 'A' },
      { kind: 'literal' },
    ]);
  });

  it('publishes general affine world geometry and its source CTM to AI', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xslant=1]
  \coordinate (A) at (1,2);
  \draw (A) -- (2,3);
\end{scope}
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const point = context.entities.find((entity) => entity.name === 'A');
    const polyline = context.entities.find((entity) => entity.kind === 'polyline');

    expect(point?.parameters).toMatchObject({
      x: 3,
      y: 2,
      coordinateTransform: { a: 1, b: 0, c: 1, d: 1, e: 0, f: 0 },
    });
    expect(polyline?.parameters).toMatchObject({
      points: [{ x: 3, y: 2 }, { x: 5, y: 3 }],
      coordinateTransform: { a: 1, b: 0, c: 1, d: 1, e: 0, f: 0 },
    });
  });

  it('explains an affine source circle to AI as its world-space ellipse', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xslant=1]
  \draw (0,0) circle (1);
\end{scope}
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const ellipse = context.entities.find((entity) => entity.kind === 'ellipse');

    expect(ellipse?.parameters).toMatchObject({
      sourceShapeKind: 'circle',
      coordinateTransform: { a: 1, b: 0, c: 1, d: 1, e: 0, f: 0 },
      sourceEllipseParameters: {
        sourceKind: 'circle',
        coordinateTransformSimilarity: false,
      },
    });
    expect(ellipse?.parameters?.xRadius).toBeCloseTo((1 + Math.sqrt(5)) / 2, 12);
    expect(ellipse?.parameters?.yRadius).toBeCloseTo((Math.sqrt(5) - 1) / 2, 12);
    expect(ellipse?.parameters?.rotationDegrees).toBeCloseTo(31.717474411461, 11);
  });

  it('explains an affine source arc as a world elliptical arc with source provenance', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xslant=1]
  \draw (1,0) arc (0:90:1);
\end{scope}
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const arc = context.entities.find((entity) => entity.kind === 'elliptical-arc');

    expect(arc?.parameters).toMatchObject({
      center: { x: 0, y: 0 },
      axisX: { x: 1, y: 0 },
      axisY: { x: 1, y: 1 },
      start: { x: 1, y: 0 },
      end: { x: 1, y: 1 },
      sourceShapeKind: 'circular-arc',
      coordinateTransform: { a: 1, b: 0, c: 1, d: 1, e: 0, f: 0 },
      sourceArcParameters: {
        sourceKind: 'circular-arc',
        coordinateTransformSimilarity: false,
      },
    });
  });

  it('projects midpoint and perpendicular-foot constructions as authoritative definitions', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1.2,2.8);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (H) at ($(A)!(C)!(B)$);
\end{tikzpicture}`;
    const context = contextFor(source, []);
    const byName = new Map(context.entities.map((entity) => [entity.name, entity]));

    expect(byName.get('M')?.definition).toEqual({
      kind: 'operation',
      operator: 'midpoint',
      arguments: [
        { kind: 'entity-reference', entityId: 'point:A' },
        { kind: 'entity-reference', entityId: 'point:B' },
      ],
      parameters: { t: 0.5 },
    });
    expect(byName.get('H')?.definition).toEqual({
      kind: 'operation',
      operator: 'perpendicular-foot',
      arguments: [
        { kind: 'entity-reference', entityId: 'point:C' },
        { kind: 'entity-reference', entityId: 'point:A' },
        { kind: 'entity-reference', entityId: 'point:B' },
      ],
    });
  });

  it('keeps GeometryDoc identities replayable across UI-only identity reconciliation', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\draw (A) circle (1);
\end{tikzpicture}`;
    const analysis = analyze(source, 3);
    if (!analysis.scene) throw new TypeError('Expected a complete scene.');
    const uiAnalysis = {
      ...analysis,
      scene: {
        ...analysis.scene,
        points: new Map([...analysis.scene.points].map(([name, point]) => ([
          name,
          { ...point, stableId: `tz_runtime_${name}` },
        ] as const))),
        elements: analysis.scene.elements.map((element, index) => ({
          ...element,
          stableId: `tz_runtime_element_${index}`,
        })),
      },
    };
    const basis = {
      documentId: 'document-1',
      epoch: 'epoch-1',
      revision: 3,
      sourceHash: 'source-hash',
      sourceId: 'document-1:tikz',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    };
    const canonical = projectTikzAnalysisToGeometryTruth({
      analysis,
      source,
      hashAlgorithm: 'sha256-utf8',
      basis,
    });
    const reconciled = projectTikzAnalysisToGeometryTruth({
      analysis: uiAnalysis,
      source,
      hashAlgorithm: 'sha256-utf8',
      basis,
    });

    expect(reconciled.semantic.basis.kernelHash).toBe(
      canonical.semantic.basis.kernelHash,
    );
    expect(reconciled.semantic.basis.projectionHash).toBe(
      canonical.semantic.basis.projectionHash,
    );
    expect(reconciled.semantic.ir.entities.map((entity) => entity.id)).toEqual(
      canonical.semantic.ir.entities.map((entity) => entity.id),
    );
    expect(reconciled.construction.bindings.map((binding) => binding.id)).toEqual(
      canonical.construction.bindings.map((binding) => binding.id),
    );
  });

  it('marks one-circle intents ready for an authorized directly adoptable raw circle', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\draw (O) circle (1);
\end{tikzpicture}`;
    const discovery = contextFor(source, []);
    const circleId = discovery.entities.find((entity) => entity.kind === 'circle')?.id;
    expect(circleId).toEqual(expect.any(String));
    const context = contextFor(source, circleId ? [circleId] : []);

    const toolIds = context.construction.intentTools.map((tool) => tool.toolId);
    expect(toolIds).toContain('point-on-circle');
    expect(toolIds).toContain('tangent-at-point');
    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'point-on-circle'
    ))?.currentInputReady).toBe(true);
    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'radical-axis'
    ))?.currentInputReady).toBe(false);
  });

  it('marks radical-axis ready for two distinct directly adoptable raw circles', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\coordinate (A) at (1,0);
\coordinate (P) at (3,0);
\coordinate (Q) at (4,0);
\draw (O) circle through (A);
\draw (P) circle through (Q);
\end{tikzpicture}`;
    const discovery = contextFor(source, []);
    const circleIds = discovery.entities
      .filter((entity) => entity.kind === 'circle')
      .map((entity) => entity.id);
    expect(circleIds).toHaveLength(2);
    const context = contextFor(source, circleIds);

    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'radical-axis'
    ))?.currentInputReady).toBe(true);
  });

  it('keeps the Catalog contract but marks a calculated raw circle unavailable', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\draw ($(O)+(1,0)$) circle (2);
\end{tikzpicture}`;
    const discovery = contextFor(source, []);
    const circleId = discovery.entities.find((entity) => entity.kind === 'circle')?.id;
    expect(circleId).toEqual(expect.any(String));
    const context = contextFor(source, circleId ? [circleId] : []);

    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'point-on-circle'
    ))).toMatchObject({ currentInputReady: false });
  });


  it('空源码公开 full-document 插入策略和唯一授权入口', () => {
    const context = contextFor('', []);
    const documentBinding = context.construction.sourceBindings.find(
      (binding) => binding.id === 'binding:document:tikzpicture-body-end',
    );

    expect(documentBinding).toMatchObject({
      range: { start: 0, end: 0 },
      writable: true,
      insertionPolicy: 'full-document',
      verbatim: '',
    });
    expect(context.construction.authorizedBindingIds).toEqual([
      'binding:document:tikzpicture-body-end',
    ]);
    expect(documentBinding?.createCapabilityFingerprint).toEqual(expect.any(String));
    expect(context.construction.constructionCatalogDigest).toBe(
      CONSTRUCTION_CATALOG_DIGEST,
    );
    expect(context.construction.authorizationScopeFingerprint).toEqual(
      expect.any(String),
    );
    expect(context.construction.intentTools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolId: 'midpoint',
        inputKinds: ['point', 'point'],
        parameterSchema: 'none',
        outputSlots: [{
          key: 'midpoint',
          produces: 'point',
          roles: ['midpoint'],
        }],
      }),
    ]));
  });

  it('非空源码只授权焦点闭包和 body 插入入口', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\end{tikzpicture}`;
    const context = contextFor(source, ['A']);
    const documentBinding = context.construction.sourceBindings.find(
      (binding) => binding.id === 'binding:document:tikzpicture-body-end',
    );
    const aBinding = context.construction.sourceBindings.find(
      (binding) => binding.entityIds.some((entityId) => (
        context.focus.closureEntityIds.includes(entityId)
      )),
    );

    expect(documentBinding?.insertionPolicy).toBe('tikzpicture-body');
    expect(aBinding?.verbatim).toContain('\\coordinate (A)');
    expect(context.construction.authorizedBindingIds).toContain(
      'binding:document:tikzpicture-body-end',
    );
    expect(context.construction.authorizedBindingIds).toContain(aBinding?.id);
    expect(context.construction.authorizedBindingIds).not.toContain(
      context.construction.sourceBindings.find((binding) => (
        binding.verbatim?.includes('\\coordinate (B)')
      ))?.id,
    );
  });
  it('exposes ordered lossless style syntax to the AI context', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\draw[red,postaction={decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}},red] (A) -- (B);
\end{tikzpicture}`;
    const context = contextFor(source, ['A', 'B']);
    const optionSequence = context.styles
      .find((style) => style.metadata?.optionSequence)
      ?.metadata?.optionSequence;

    expect(optionSequence).toMatchObject({
      schema: 'tikz-option-sequence/v1',
      ordered: true,
      balanced: true,
    });
    expect(JSON.stringify(optionSequence)).toContain('postaction');
  });

  it('bounds style presentation metadata before provider serialization', () => {
    const huge = 'x'.repeat(2_000);
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\draw[postaction={${huge}},red] (A) -- (B);
\end{tikzpicture}`;
    const context = contextFor(source, ['A', 'B']);
    const serialized = JSON.stringify(context.styles);

    expect(serialized.length).toBeLessThan(huge.length);
    expect(serialized).toContain('valueTruncated');
  });

  it('enforces a total provider-facing style character budget', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\draw[red,thick,dashed,postaction={decorate}] (A) -- (B);
\end{tikzpicture}`;
    const context = contextFor(source, ['A', 'B'], {
      maxStyleContextChars: 32,
    });

    expect(context.styles).toHaveLength(0);
    expect(context.truncation.omitted.styles).toBeGreaterThan(0);
  });

  it('counts one managed circle once when reporting direct input readiness', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\coordinate (A) at (1,0);
${managedCircle(
  'circle-one',
  { name: 'O', x: 0, y: 0 },
  { name: 'A', x: 1, y: 0 },
)}
\end{tikzpicture}`;
    const discovery = contextFor(source, []);
    const circleId = discovery.entities.find((entity) => entity.kind === 'circle')?.id;
    expect(circleId).toEqual(expect.any(String));
    const context = contextFor(source, circleId ? [circleId] : []);
    const toolIds = context.construction.intentTools.map((tool) => tool.toolId);

    expect(toolIds).toContain('point-on-circle');
    expect(toolIds).toContain('tangent-at-point');
    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'point-on-circle'
    ))?.currentInputReady).toBe(true);
    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'radical-axis'
    ))?.currentInputReady).toBe(false);
  });

  it('marks two-circle intents ready only for two distinct managed circles', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\coordinate (A) at (1,0);
\coordinate (P) at (3,0);
\coordinate (Q) at (4,0);
${managedCircle(
  'circle-one',
  { name: 'O', x: 0, y: 0 },
  { name: 'A', x: 1, y: 0 },
)}
${managedCircle(
  'circle-two',
  { name: 'P', x: 3, y: 0 },
  { name: 'Q', x: 4, y: 0 },
)}
\end{tikzpicture}`;
    const discovery = contextFor(source, []);
    const circleIds = discovery.entities
      .filter((entity) => entity.kind === 'circle')
      .map((entity) => entity.id);
    expect(circleIds).toHaveLength(2);
    const context = contextFor(source, circleIds);

    expect(context.construction.intentTools.find((tool) => (
      tool.toolId === 'radical-axis'
    ))?.currentInputReady).toBe(true);
  });
});
