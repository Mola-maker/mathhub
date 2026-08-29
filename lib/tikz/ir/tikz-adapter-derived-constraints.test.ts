import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { buildGeometrySemanticSignature } from '@/lib/geometry/semantic-signature';
import {
  createPrimitiveConstructionPlan,
} from '../authoring/construction-catalog';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import { createGeometryDoc } from './geometry-doc';
import {
  buildGeometrySourceMap,
  sourceMapEntriesForSemanticRecord,
} from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

function geometryDoc(source: string) {
  const analysis = analyze(source, 0);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: 'derived-constraint-test',
      epoch: 'epoch-1',
      revision: 0,
      sourceId: 'derived-constraint-test:tikz',
      sourceHash: 'fixture-source-hash',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function managedCircleSource(): string {
  const plan = createPrimitiveConstructionPlan('circle', {
    anchors: [
      { name: 'O', position: { x: 0, y: 0 }, existing: true },
      { name: 'A', position: { x: 2, y: 0 }, existing: true },
    ],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => 'managed-circle',
  });
  return compileNewManagedConstructionPlan(plan).lines.join('\n');
}

describe('TikZ derived coordinate semantic constraints', () => {
  it('projects ordinary calc midpoint and perpendicular-foot coordinates', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1,3);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (D) at ($(B)!(C)!(A)$);
\end{tikzpicture}`;
    const constraints = geometryDoc(source).semantic.ir.constraints;

    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'midpoint',
        arguments: [
          expect.objectContaining({ entityId: 'point:M' }),
          expect.objectContaining({ entityId: 'point:A' }),
          expect.objectContaining({ entityId: 'point:B' }),
        ],
      }),
      expect.objectContaining({
        kind: 'perpendicular-foot',
        arguments: [
          expect.objectContaining({ entityId: 'point:D' }),
          expect.objectContaining({ entityId: 'point:C' }),
          expect.objectContaining({ entityId: 'point:B' }),
          expect.objectContaining({ entityId: 'point:A' }),
        ],
      }),
    ]));
  });

  it('promotes a two-endpoint path to portable segment incidence', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\draw (A) -- (B);
\end{tikzpicture}`;
    const relations = geometryDoc(source).semantic.ir.relations;

    expect(relations).toContainEqual(expect.objectContaining({
      kind: 'incidence',
      directed: true,
      participants: [
        expect.objectContaining({ role: 'result' }),
        expect.objectContaining({ role: 'input', entityId: 'point:A' }),
        expect.objectContaining({ role: 'input', entityId: 'point:B' }),
      ],
    }));
  });

  it('binds named intersections to their real path geometry', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O1) at (0,0);
\coordinate (O2) at (3,0);
\draw[name path=c1] (O1) circle[radius=3];
\draw[name path=c2] (O2) circle[radius=3];
\path[name intersections={of=c1 and c2}]
  (intersection-1) coordinate (P)
  (intersection-2) coordinate (Q);
\draw (P) -- (Q);
\end{tikzpicture}`;
    const document = geometryDoc(source);
    const circles = document.semantic.ir.entities.filter((entity) => entity.kind === 'circle');
    const circleIds = new Set(circles.map((entity) => entity.id));
    const intersections = document.semantic.ir.relations.filter(
      (relation) => relation.kind === 'intersection',
    );

    expect(circles).toHaveLength(2);
    expect(intersections).toHaveLength(2);
    expect(intersections.map((relation) => relation.participants[0]?.entityId).sort())
      .toEqual(['point:P', 'point:Q']);
    for (const relation of intersections) {
      expect(relation.directed).toBe(true);
      expect(relation.participants.slice(1).map((participant) => participant.entityId))
        .toEqual(expect.arrayContaining([...circleIds]));
    }

    const namedPathHelpers = document.semantic.ir.entities.filter(
      (entity) => entity.tags?.includes('named-path'),
    );
    expect(namedPathHelpers).toHaveLength(2);
    expect(namedPathHelpers.every((entity) => entity.tags?.includes('construction-helper')))
      .toBe(true);

    const signature = buildGeometrySemanticSignature(document);
    expect(signature.coverage.entities).toEqual({ portable: 7, total: 7 });
    expect(signature.coverage.relations.portable).toBe(3);
    expect(signature.canonical.entities).toHaveLength(7);
  });

  it('infers tangent and parallel constraints from rotation and translation constructions', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O1) at (0,0);
\coordinate (O2) at (3,0);
\draw[name path=c1] (O1) circle[radius=3];
\draw[name path=c2] (O2) circle[radius=3];
\path[name intersections={of=c1 and c2}]
  (intersection-1) coordinate (P)
  (intersection-2) coordinate (Q);
\draw (P) -- (Q);
\coordinate (U) at ($(P)!1!90:(O1)$);
\draw (P) -- (U);
\coordinate (V) at ($(U)+(Q)-(P)$);
\draw (Q) -- (V);
\end{tikzpicture}`;
    const document = geometryDoc(source);
    const tangent = document.semantic.ir.constraints.find((item) => item.kind === 'tangent');
    const parallel = document.semantic.ir.constraints.find((item) => item.kind === 'parallel');

    expect(tangent?.arguments).toHaveLength(3);
    expect(tangent?.arguments[1]?.entityId).toBe('point:P');
    expect(tangent?.arguments[2]?.entityId).toMatch(/^element:/u);
    const firstCircleId = tangent?.arguments[2]?.entityId;
    const firstCircleBinding = document.construction.bindings.find((binding) => (
      binding.targets.some((target) => (
        target.recordType === 'entity' && target.id === firstCircleId
      ))
    ));
    expect(firstCircleBinding?.targets).toHaveLength(1);
    expect(firstCircleBinding?.writable).toBe(true);
    const firstCircleOwnership = document.sourceMap.entries.filter((entry) => (
      firstCircleId ? entry.entityIds.includes(firstCircleId) : false
    ));
    expect(firstCircleOwnership).toHaveLength(1);
    expect(firstCircleOwnership[0]?.bindingId).toBe(firstCircleBinding?.id);
    expect(sourceMapEntriesForSemanticRecord(document.sourceMap, {
      recordType: 'constraint',
      id: tangent!.id,
    }).length).toBeGreaterThan(0);
    expect(parallel?.arguments).toHaveLength(2);
    expect(parallel?.arguments.every((argument) => argument.entityId?.startsWith('element:')))
      .toBe(true);
    const circleMemberships = document.semantic.ir.constraints
      .filter((constraint) => constraint.kind === 'point-on-circle');
    expect(circleMemberships).toHaveLength(4);
    expect(circleMemberships.some((constraint) => constraint.arguments.some((argument) => (
      argument.role === 'point' && argument.entityId === 'point:U'
    )))).toBe(false);

    const signature = buildGeometrySemanticSignature(document);
    expect(signature.coverage.entities).toEqual({ portable: 11, total: 11 });
    expect(signature.coverage.constraints).toEqual({ portable: 6, total: 6 });
    expect(signature.coverage.relations.portable).toBe(5);
  });

  it('keeps ordinary circle facts that use a managed circle as evidence', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O) at (0,0);
\coordinate (A) at (2,0);
${managedCircleSource()}
\coordinate (L) at ($(O)!1!45:(A)$);
\end{tikzpicture}`;
    const document = geometryDoc(source);
    const membership = document.semantic.ir.constraints.find((constraint) => (
      constraint.kind === 'point-on-circle'
      && constraint.arguments.some((argument) => (
        argument.role === 'point' && argument.entityId === 'point:L'
      ))
    ));

    expect(membership).toBeDefined();
    expect(sourceMapEntriesForSemanticRecord(document.sourceMap, {
      recordType: 'constraint',
      id: membership!.id,
    }).length).toBeGreaterThan(0);
  });

  it('recovers triangle centers and cyclic structure from source topology', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (O1) at (0,0);
\coordinate (O2) at (3,0);
\draw[name path=c1] (O1) circle[radius=3];
\draw[name path=c2] (O2) circle[radius=3];
\path[name intersections={of=c1 and c2}]
  (intersection-1) coordinate (P)
  (intersection-2) coordinate (Q);
\draw (P) -- (Q);
\coordinate (U) at ($(P)!1!90:(O1)$);
\draw (P) -- (U);
\coordinate (V) at ($(U)+(Q)-(P)$);
\draw (Q) -- (V);
\coordinate (M12) at ($(O1)!0.5!(O2)$);
\coordinate (M1P) at ($(O1)!0.5!(P)$);
\coordinate (R12) at ($(M12)!1!90:(O2)$);
\coordinate (R1P) at ($(M1P)!1!90:(O1)$);
\draw[name path=bis12] (M12) -- (R12);
\draw[name path=bis1P] (M1P) -- (R1P);
\path[name intersections={of=bis12 and bis1P}]
  (intersection-1) coordinate (C0);
\coordinate (D) at ($(O2)!(O1)!(P)$);
\coordinate (E) at ($(P)!(O2)!(O1)$);
\draw[name path=alt1] (O1) -- (D);
\draw[name path=alt2] (O2) -- (E);
\path[name intersections={of=alt1 and alt2}]
  (intersection-1) coordinate (H0);
\draw[name path=omega] (C0) circle through (O1);
\coordinate (L) at ($(C0)!1!45:(O1)$);
\draw (O1) -- (L);
\end{tikzpicture}`;
    const document = geometryDoc(source);
    const kinds = document.semantic.ir.constraints.map((constraint) => constraint.kind);

    expect(kinds).toEqual(expect.arrayContaining([
      'circumcenter',
      'orthocenter',
      'point-on-circle',
      'concyclic',
    ]));
    const circleMemberships = document.semantic.ir.constraints
      .filter((constraint) => constraint.kind === 'point-on-circle');
    expect(circleMemberships).toHaveLength(8);
    for (const derivedPointName of ['U', 'R12', 'R1P']) {
      expect(circleMemberships.some((constraint) => constraint.arguments.some((argument) => (
        argument.role === 'point' && argument.entityId === `point:${derivedPointName}`
      )))).toBe(false);
    }
    const signature = buildGeometrySemanticSignature(document);
    expect(signature.coverage.entities).toEqual({ portable: 26, total: 26 });
    expect(signature.coverage.constraints).toEqual({ portable: 17, total: 17 });
    expect(signature.coverage.relations.portable).toBe(12);
  });
});
