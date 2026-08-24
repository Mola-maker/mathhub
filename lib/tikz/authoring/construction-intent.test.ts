import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { hashSource } from '../document/source-hash';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from './construction-catalog';
import { constructionAuthorizationScopeFingerprint } from './construction-authorization';
import {
  compileConstructionIntent,
  type ConstructionIntent,
} from './construction-intent';
import { evaluateConstructionPlan } from './construction-eval';
import { compileConstructionPlan } from './construction-ir';
import { compileAiConstructionIntentProposal } from '../ir/ai-construction-intent-proposal';

const DOCUMENT_ID = 'intent-document';
const EPOCH = 'intent-epoch';
function geometryDocFor(source: string) {
  const basis = {
    documentId: DOCUMENT_ID,
    epoch: EPOCH,
    revision: 0,
    sourceHash: hashSource(source),
    sourceId: `${DOCUMENT_ID}:tikz`,
    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
  };
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, 0),
    source,
    basis,
    hashAlgorithm: 'fnv1a64-utf8',
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function baseIntent(source: string): ConstructionIntent {
  const geometryDoc = geometryDocFor(source);
  const insertion = geometryDoc.construction.bindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  const fingerprint = insertion?.metadata?.capabilityFingerprint;
  if (typeof fingerprint !== 'string') throw new TypeError('Missing insertion capability.');
  const authorizedBindingIds = ['binding:document:tikzpicture-body-end'];
  return {
    schemaVersion: 'construction-intent/v1',
    intentId: 'intent-create-1',
    idempotencyKey: 'intent-create-1',
    basis: {
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      revision: geometryDoc.basis.revision,
      sourceId: geometryDoc.basis.sourceId!,
      sourceHash: geometryDoc.basis.sourceHash,
      hashAlgorithm: 'fnv1a64-utf8',
      kernelHash: geometryDoc.basis.kernelHash!,
      projectionHash: geometryDoc.basis.projectionHash!,
      pluginSetDigest: geometryDoc.basis.pluginSetDigest!,
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    },
    operation: 'create',
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint,
      scopeFingerprint: constructionAuthorizationScopeFingerprint({
        basis: geometryDoc.basis,
        authorizedBindingIds,
        createCapabilityFingerprint: fingerprint,
      }),
    },
    toolId: 'point',
    bindingIds: [],
    requestedNames: { point: 'P' },
    parameters: { x: 1, y: 2 },
  };
}

function bindingIdForPoint(
  geometryDoc: ReturnType<typeof geometryDocFor>,
  name: string,
): string {
  const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.kind === 'point' && candidate.name === name
  ));
  const entries = entity
    ? geometryDoc.sourceMap.entries.filter((entry) => entry.entityIds.includes(entity.id))
    : [];
  if (entries.length !== 1) throw new TypeError(`Point ${name} has no unique binding.`);
  return entries[0]!.bindingId;
}

function bindingIdForCircle(
  geometryDoc: ReturnType<typeof geometryDocFor>,
): string {
  const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.kind === 'circle'
  ));
  const entry = entity
    ? geometryDoc.sourceMap.entries.find((candidate) => (
      candidate.entityIds.includes(entity.id)
    ))
    : undefined;
  if (!entry) throw new TypeError('Circle has no unique binding.');
  return entry.bindingId;
}

describe('construction-intent/v1', () => {
  it('compiles a closed free-point intent through the trusted Catalog', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const intent = baseIntent(source);

    const result = compileConstructionIntent({
      source,
      geometryDoc,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      intent,
    });

    expect(result.plan).toMatchObject({ kind: 'primitive', primitive: { kind: 'point' } });
    expect(result.plan.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'point', name: 'P' }),
    ]));
  });

  it('resolves ordered point inputs from the current GeometryDoc rather than caller coordinates', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const bindingIds = [
      bindingIdForPoint(geometryDoc, 'A'),
      bindingIdForPoint(geometryDoc, 'B'),
    ];
    const base = baseIntent(source);
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'midpoint',
      bindingIds,
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: ['binding:document:tikzpicture-body-end', ...bindingIds],
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: {},
    };

    const result = compileConstructionIntent({
      source,
      geometryDoc,
      allowedBindingIds: ['binding:document:tikzpicture-body-end', ...bindingIds],
      intent,
    });

    expect(result.plan).toMatchObject({ kind: 'midpoint', a: 'A', b: 'B' });
  });

  it('compiles the nine-point circle as one trusted composite intent', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (6,0);\n\\coordinate (C) at (2,4);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const bindingIds = ['A', 'B', 'C'].map((name) => bindingIdForPoint(geometryDoc, name));
    const allowedBindingIds = ['binding:document:tikzpicture-body-end', ...bindingIds];
    const base = baseIntent(source);
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'nine-point-circle',
      bindingIds,
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: {},
    };

    const result = compileConstructionIntent({ source, geometryDoc, allowedBindingIds, intent });
    expect(result.plan).toMatchObject({
      kind: 'nine-point-circle',
      a: 'A', b: 'B', c: 'C',
    });
    if (result.plan.kind !== 'nine-point-circle') {
      throw new TypeError('Expected nine-point circle plan.');
    }
    expect(result.plan.outputs).toHaveLength(12);
    expect(result.plan.constraints.filter((constraint) => constraint.kind === 'on-circle'))
      .toHaveLength(9);

    const evaluated = evaluateConstructionPlan(result.plan, new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 6, y: 0 }],
      ['C', { x: 2, y: 4 }],
    ]));
    expect(evaluated.status).toBe('valid');
    const circle = evaluated.geometries.find((geometry) => geometry.kind === 'circle');
    expect(circle).toMatchObject({ kind: 'circle' });
    if (!circle || circle.kind !== 'circle') throw new TypeError('Expected evaluated nine-point circle.');
    const incidenceNames = [
      result.plan.midpointBC, result.plan.midpointCA, result.plan.midpointAB,
      result.plan.footA, result.plan.footB, result.plan.footC,
      result.plan.vertexMidpointA,
      result.plan.vertexMidpointB,
      result.plan.vertexMidpointC,
    ];
    for (const name of incidenceNames) {
      const point = evaluated.points.get(name);
      expect(point, name).toBeDefined();
      expect(Math.hypot(point!.x - circle.center.x, point!.y - circle.center.y))
        .toBeCloseTo(circle.radius, 8);
    }

    const proposal = compileAiConstructionIntentProposal(intent, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        ...(typeof binding.metadata?.capabilityFingerprint === 'string'
          ? { createCapabilityFingerprint: binding.metadata.capabilityFingerprint }
          : {}),
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(proposal.ok, proposal.ok ? undefined : JSON.stringify(proposal.errors)).toBe(true);
    if (proposal.ok) {
      expect(proposal.transaction.operations).toHaveLength(1);
      expect(proposal.transaction.metadata?.constructionIntentProof).toBeDefined();
    }
  });

  it('compiles and evaluates one atomic Simson-line intent', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (6,0);\n\\coordinate (C) at (1.5,4);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const bindingIds = ['A', 'B', 'C'].map((name) => bindingIdForPoint(geometryDoc, name));
    const allowedBindingIds = ['binding:document:tikzpicture-body-end', ...bindingIds];
    const base = baseIntent(source);
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'simson-line',
      bindingIds,
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: {},
    };

    const result = compileConstructionIntent({ source, geometryDoc, allowedBindingIds, intent });
    expect(result.plan.kind).toBe('simson-line');
    if (result.plan.kind !== 'simson-line') throw new TypeError('Expected Simson plan.');
    const compiledSource = compileConstructionPlan(result.plan).lines.join('\n');
    expect(compiledSource).toContain('!137.5:');
    expect(compiledSource).toContain('!(');
    const evaluated = evaluateConstructionPlan(result.plan, new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 6, y: 0 }],
      ['C', { x: 1.5, y: 4 }],
    ]));
    expect(evaluated.status).toBe('valid');
    const ab = evaluated.points.get(result.plan.footAB)!;
    const bc = evaluated.points.get(result.plan.footBC)!;
    const ca = evaluated.points.get(result.plan.footCA)!;
    const cross = (bc.x - ab.x) * (ca.y - ab.y) - (bc.y - ab.y) * (ca.x - ab.x);
    expect(Math.abs(cross)).toBeLessThan(1e-7);

    const proposal = compileAiConstructionIntentProposal(intent, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        ...(typeof binding.metadata?.capabilityFingerprint === 'string'
          ? { createCapabilityFingerprint: binding.metadata.capabilityFingerprint }
          : {}),
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(proposal.ok).toBe(true);
    if (proposal.ok) {
      expect(proposal.transaction.operations).toHaveLength(1);
      expect(proposal.transaction.metadata?.constructionIntentProof).toBeTruthy();
    }
  });

  it('rejects a Simson-line intent for collinear triangle vertices without emitting a proposal', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n\\coordinate (C) at (4,0);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const bindingIds = ['A', 'B', 'C'].map((name) => bindingIdForPoint(geometryDoc, name));
    const allowedBindingIds = ['binding:document:tikzpicture-body-end', ...bindingIds];
    const base = baseIntent(source);
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'simson-line',
      bindingIds,
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: {},
    };
    expect(() => compileConstructionIntent({ source, geometryDoc, allowedBindingIds, intent }))
      .toThrow(/Simson|西姆松|共线/i);
  });

  it('keeps the composite nine-point circle valid for a right triangle', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'nine-point-circle')!;
    let next = 0;
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 4, y: 0 }, existing: true },
        { name: 'C', position: { x: 0, y: 3 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}${++next}`,
      nextConstructionId: () => 'nine-point-right-triangle',
    });
    expect(evaluateConstructionPlan(plan, new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 4, y: 0 }],
      ['C', { x: 0, y: 3 }],
    ]))).toMatchObject({ status: 'valid', diagnostics: [] });
  });

  it('keeps all nine incidence points finite for an obtuse triangle', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'nine-point-circle')!;
    let next = 0;
    const sourcePoints = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 6, y: 0 }],
      ['C', { x: 1, y: 1 }],
    ]);
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [...sourcePoints].map(([name, position]) => ({ name, position, existing: true })),
      nextName: (prefix) => `${prefix}${++next}`,
      nextConstructionId: () => 'nine-point-obtuse-triangle',
    });
    const evaluated = evaluateConstructionPlan(plan, sourcePoints);
    expect(evaluated).toMatchObject({ status: 'valid', diagnostics: [] });
    expect(plan.outputs.slice(0, 11).every((output) => evaluated.points.has(output.ref)))
      .toBe(true);
  });

  it('compiles and evaluates one trusted interior Fermat construction', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (6,0);\n\\coordinate (C) at (2,4);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const bindingIds = ['A', 'B', 'C'].map((name) => bindingIdForPoint(geometryDoc, name));
    const allowedBindingIds = ['binding:document:tikzpicture-body-end', ...bindingIds];
    const base = baseIntent(source);
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'fermat-point',
      bindingIds,
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: {},
    };
    const result = compileConstructionIntent({ source, geometryDoc, allowedBindingIds, intent });
    expect(result.plan).toMatchObject({
      kind: 'fermat-point',
      a: 'A', b: 'B', c: 'C',
      resultSource: result.plan.kind === 'fermat-point' ? result.plan.torricelli : undefined,
    });
    const evaluated = evaluateConstructionPlan(result.plan, new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 6, y: 0 }],
      ['C', { x: 2, y: 4 }],
    ]));
    expect(evaluated).toMatchObject({ status: 'valid', diagnostics: [] });
    if (result.plan.kind !== 'fermat-point') throw new TypeError('Expected Fermat plan.');
    const fermat = evaluated.points.get(result.plan.result)!;
    const rays = ['A', 'B', 'C'].map((name) => {
      const point = evaluated.points.get(name)!;
      const length = Math.hypot(point.x - fermat.x, point.y - fermat.y);
      return { x: (point.x - fermat.x) / length, y: (point.y - fermat.y) / length };
    });
    for (const [first, second] of [[rays[0], rays[1]], [rays[1], rays[2]], [rays[2], rays[0]]] as const) {
      expect(first.x * second.x + first.y * second.y).toBeCloseTo(-0.5, 8);
    }
  });

  it('uses the >=120-degree vertex branch instead of fabricating an interior Fermat point', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'fermat-point')!;
    let next = 0;
    const sourcePoints = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 4, y: 0 }],
      ['C', { x: -1, y: 0.2 }],
    ]);
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [...sourcePoints].map(([name, position]) => ({ name, position, existing: true })),
      nextName: (prefix) => `${prefix}${++next}`,
      nextConstructionId: () => 'fermat-vertex-branch',
    });
    expect(plan).toMatchObject({ kind: 'fermat-point', resultSource: 'A' });
    const evaluated = evaluateConstructionPlan(plan, sourcePoints);
    expect(evaluated).toMatchObject({ status: 'valid', diagnostics: [] });
    if (plan.kind !== 'fermat-point') throw new TypeError('Expected Fermat plan.');
    expect(evaluated.points.get(plan.result)).toEqual(sourcePoints.get('A'));
  });

  it('derives a raw-circle adoption and managed plan from one closed intent', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (O) at (0,0);\n\\draw (O) circle (2);\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const circleBindingId = bindingIdForCircle(geometryDoc);
    const base = baseIntent(source);
    const allowedBindingIds = [
      'binding:document:tikzpicture-body-end',
      circleBindingId,
    ];
    const intent: ConstructionIntent = {
      ...base,
      toolId: 'point-on-circle',
      bindingIds: [circleBindingId],
      capability: {
        ...base.capability,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: base.capability.fingerprint,
        }),
      },
      requestedNames: {},
      parameters: { angleDegrees: 45 },
    };

    const result = compileConstructionIntent({
      source,
      geometryDoc,
      allowedBindingIds,
      intent,
    });

    expect(result.plan).toMatchObject({ kind: 'point-on-circle' });
    expect(result.adoptions).toEqual([
      expect.objectContaining({
        sourceBindingId: circleBindingId,
        managedEntityId: 'circle',
        definition: { kind: 'center-radius', centerName: 'O', radius: 2 },
      }),
    ]);
    expect(result.plan.inputs[0]?.ref).toBe(
      `managed:${result.adoptions[0]!.constructionId}:circle`,
    );
    const evaluated = evaluateConstructionPlan(result.plan, new Map([
      ['O', { x: 0, y: 0 }],
    ]));
    expect(evaluated).toMatchObject({ status: 'valid', diagnostics: [] });
    expect(evaluated.points.get(result.plan.result)).toEqual({
      x: expect.closeTo(Math.SQRT2, 10),
      y: expect.closeTo(Math.SQRT2, 10),
    });
  });

  it.each([
    ['catalog digest', (intent: ConstructionIntent) => ({
      ...intent,
      basis: { ...intent.basis, constructionCatalogDigest: 'stale-catalog' },
    })],
    ['capability fingerprint', (intent: ConstructionIntent) => ({
      ...intent,
      capability: { ...intent.capability, fingerprint: 'stale-capability' },
    })],
    ['authorization scope', (intent: ConstructionIntent) => ({
      ...intent,
      capability: { ...intent.capability, scopeFingerprint: 'stale-scope' },
    })],
    ['open parameters', (intent: ConstructionIntent) => ({
      ...intent,
      parameters: { ...intent.parameters, injected: true },
    })],
    ['undeclared name', (intent: ConstructionIntent) => ({
      ...intent,
      requestedNames: { ...intent.requestedNames, injected: 'X' },
    })],
  ])('rejects stale or open %s input', (_label, mutate) => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const geometryDoc = geometryDocFor(source);
    const intent = mutate(baseIntent(source));

    expect(() => compileConstructionIntent({
      source,
      geometryDoc,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      intent,
    })).toThrow();
  });
});
