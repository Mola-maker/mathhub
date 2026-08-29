import { describe, expect, it } from 'vitest';
import { projectGeogebraCommandsToGeometryDoc } from './geogebra-geometry-doc';

const identity = { documentId: 'math-studio', epoch: 'epoch-1', revision: 3 } as const;

describe('projectGeogebraCommandsToGeometryDoc', () => {
  it('projects command dependencies, constraints and styles into a revision-bound GeometryDoc', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: [
        'A=(0,0)',
        'B=(6,0)',
        'C=(1,4)',
        'AB=Segment(A,B)',
        'M=Midpoint(A,B)',
        'alt=PerpendicularLine(C,AB)',
        'omega=Circle(M,A)',
        'SetColor(omega,"purple")',
        'ShowLabel(M,true)',
      ],
    });

    expect(result.geometryDoc.basis).toMatchObject({
      documentId: 'math-studio',
      epoch: 'epoch-1',
      revision: 3,
      sourceId: 'math-studio:geogebra',
    });
    expect(result.geometryDoc.semantic.ir.entities.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(['A', 'B', 'C', 'AB', 'M', 'alt', 'omega']),
    );
    expect(result.geometryDoc.semantic.ir.constraints.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['midpoint', 'perpendicular']),
    );
    expect(result.geometryDoc.semantic.ir.styles).toHaveLength(2);
    expect(result.geometryDoc.construction.bindings.every((binding) => (
      result.source.slice(binding.source.range.start, binding.source.range.end)
        === binding.source.verbatim
    ))).toBe(true);
    expect(result.geometryDoc.sourceMap.entries).toHaveLength(
      result.geometryDoc.construction.bindings.length,
    );
    expect(result.geometryDoc.semantic.status).toBe('complete');
    expect(result.semanticSignature).toMatchObject({
      schemaVersion: 'geometry-semantic-signature/v1',
      sourceLanguage: 'geogebra-command',
      comparable: true,
      coverage: {
        entities: { portable: 7, total: 7 },
        constraints: { portable: 3, total: 3 },
      },
    });
  });

  it('retains unsupported commands as opaque source instead of fabricating entities', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: ['A=(0,0)', 'Solve(x^2=1)'],
    });

    expect(result.opaqueCommandCount).toBe(1);
    expect(result.geometryDoc.semantic.status).toBe('partial');
    expect(result.geometryDoc.construction.opaqueNodes[0]?.source.verbatim).toBe('Solve(x^2=1)');
    expect(result.geometryDoc.semantic.ir.entities).toHaveLength(1);
    expect(result.semanticSignature.comparable).toBe(false);
  });

  it('infers tangent and parallel constraints from rotation and vector translation', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: [
        'O1=(0,0)',
        'O2=(3,0)',
        'c1=Circle(O1,3)',
        'c2=Circle(O2,3)',
        'P=Intersect(c1,c2,1)',
        'Q=Intersect(c1,c2,2)',
        'chord=Segment(P,Q)',
        'U=Rotate(O1,90°,P)',
        'tangentSegment=Segment(P,U)',
        'dirPQ=Vector(P,Q)',
        'V=Translate(U,dirPQ)',
        'parallelSegment=Segment(Q,V)',
      ],
    });

    expect(result.opaqueCommandCount).toBe(0);
    expect(result.geometryDoc.semantic.status).toBe('complete');
    expect(result.geometryDoc.semantic.ir.constraints.map((item) => item.kind))
      .toEqual(expect.arrayContaining(['tangent', 'parallel']));
    const circleMemberships = result.geometryDoc.semantic.ir.constraints
      .filter((constraint) => constraint.kind === 'point-on-circle');
    expect(circleMemberships).toHaveLength(4);
    expect(circleMemberships.some((constraint) => constraint.arguments.some((argument) => (
      argument.role === 'point' && argument.entityId === 'ggb:entity:U'
    )))).toBe(false);
    const vectorBinding = result.geometryDoc.construction.bindings.find((binding) => (
      binding.kind === 'extension' && binding.payload.commandName === 'Vector'
    ));
    expect(vectorBinding?.targets).toHaveLength(1);
    expect(vectorBinding?.targets[0]?.recordType).toBe('constraint');
    expect(result.geometryDoc.semantic.ir.entities.some((entity) => entity.name === 'dirPQ'))
      .toBe(false);
    expect(result.semanticSignature.coverage).toMatchObject({
      entities: { portable: 11, total: 11 },
      constraints: { portable: 6, total: 6 },
      relations: { portable: 5 },
    });
  });

  it('treats three-point circles as member evidence without inventing a center', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: [
        'A=(0,0)',
        'B=(4,0)',
        'C=(1,3)',
        'omega=Circle(A,B,C)',
        'partial=Circle(A,B,Missing)',
        'R=Rotate(A,90°,B)',
        'candidate=Segment(B,R)',
      ],
    });
    const constraints = result.geometryDoc.semantic.ir.constraints;
    const memberIds = constraints
      .filter((constraint) => constraint.kind === 'point-on-circle')
      .map((constraint) => constraint.arguments.find((argument) => argument.role === 'point')?.entityId)
      .sort();

    expect(memberIds).toEqual(['ggb:entity:A', 'ggb:entity:B', 'ggb:entity:C']);
    expect(constraints.some((constraint) => constraint.kind === 'tangent')).toBe(false);
  });

  it('projects native triangle-center and circumcircle commands fail-closed', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: [
        'A=(0,0)',
        'B=(5,0)',
        'C=(1,3)',
        'O=Circumcenter(A,B,C)',
        'H=Orthocenter(A,B,C)',
        'omega=Circumcircle(A,B,C)',
        'unresolvedCenter=Circumcenter(A,B,Missing)',
        'unresolvedCircle=Circumcircle(A,B,Missing)',
        'lineAB=Line(A,B)',
        'wrongTypeCenter=Orthocenter(A,B,lineAB)',
        'duplicateVertexCircle=Circumcircle(A,B,A)',
        'selfReference=Circumcenter(selfReference,B,C)',
        'ambiguousPoint=(2,2)',
        'ambiguousPoint=(3,3)',
        'ambiguousInputCenter=Orthocenter(A,B,ambiguousPoint)',
        'duplicateOutputCenter=(2,1)',
        'duplicateOutputCenter=Circumcenter(A,B,C)',
      ],
    });
    const constraints = result.geometryDoc.semantic.ir.constraints;
    const centers = constraints.filter((constraint) => (
      constraint.kind === 'circumcenter' || constraint.kind === 'orthocenter'
    ));
    const memberships = constraints.filter((constraint) => (
      constraint.kind === 'point-on-circle'
    ));

    expect(result.opaqueCommandCount).toBe(0);
    expect(centers).toHaveLength(2);
    expect(centers.find((constraint) => constraint.kind === 'circumcenter')?.arguments).toEqual(
      [
        { role: 'center', entityId: 'ggb:entity:O' },
        { role: 'vertex-1', entityId: 'ggb:entity:A' },
        { role: 'vertex-2', entityId: 'ggb:entity:B' },
        { role: 'vertex-3', entityId: 'ggb:entity:C' },
      ],
    );
    expect(centers.find((constraint) => constraint.kind === 'orthocenter')?.arguments).toEqual(
      [
        { role: 'center', entityId: 'ggb:entity:H' },
        { role: 'vertex-1', entityId: 'ggb:entity:A' },
        { role: 'vertex-2', entityId: 'ggb:entity:B' },
        { role: 'vertex-3', entityId: 'ggb:entity:C' },
      ],
    );
    expect(memberships).toHaveLength(3);
    expect(memberships.map((constraint) => constraint.arguments.find((argument) => (
      argument.role === 'point'
    ))?.entityId).sort()).toEqual([
      'ggb:entity:A',
      'ggb:entity:B',
      'ggb:entity:C',
    ]);
    expect(memberships.every((constraint) => constraint.arguments.some((argument) => (
      argument.role === 'circle' && argument.entityId === 'ggb:entity:omega'
    )))).toBe(true);
    expect(constraints.some((constraint) => constraint.arguments.some((argument) => (
      argument.entityId === 'ggb:entity:unresolvedCenter'
      || argument.entityId === 'ggb:entity:unresolvedCircle'
      || argument.entityId === 'ggb:entity:wrongTypeCenter'
      || argument.entityId === 'ggb:entity:duplicateVertexCircle'
      || argument.entityId === 'ggb:entity:selfReference'
      || argument.entityId === 'ggb:entity:ambiguousInputCenter'
      || argument.entityId === 'ggb:entity:duplicateOutputCenter'
    )))).toBe(false);
    expect(result.geometryDoc.semantic.ir.entities.find((entity) => entity.name === 'O'))
      .toMatchObject({ kind: 'point', dimension: 0 });
    expect(result.geometryDoc.semantic.ir.entities.find((entity) => entity.name === 'H'))
      .toMatchObject({ kind: 'point', dimension: 0 });
    expect(result.geometryDoc.semantic.ir.entities.find((entity) => entity.name === 'omega'))
      .toMatchObject({ kind: 'circle', dimension: 1 });
    const relationKindFor = (entityId: string): string | undefined => (
      result.geometryDoc.semantic.ir.relations.find((relation) => (
        relation.participants.some((argument) => (
          argument.role === 'result' && argument.entityId === entityId
        ))
      ))?.kind
    );
    expect(relationKindFor('ggb:entity:O')).toBe('center-definition');
    expect(relationKindFor('ggb:entity:H')).toBe('center-definition');
    expect(relationKindFor('ggb:entity:omega')).toBe('circle-definition');
    expect(result.semanticSignature.coverage.constraints).toEqual({ portable: 5, total: 5 });
  });

  it('recovers triangle centers and cyclic structure from ordinary commands', () => {
    const result = projectGeogebraCommandsToGeometryDoc({
      identity,
      commands: [
        'O1=(0,0)',
        'O2=(3,0)',
        'c1=Circle(O1,3)',
        'c2=Circle(O2,3)',
        'P=Intersect(c1,c2,1)',
        'Q=Intersect(c1,c2,2)',
        'chord=Segment(P,Q)',
        'U=Rotate(O1,90°,P)',
        'tangentSegment=Segment(P,U)',
        'dirPQ=Vector(P,Q)',
        'V=Translate(U,dirPQ)',
        'parallelSegment=Segment(Q,V)',
        'M12=Midpoint(O1,O2)',
        'M1P=Midpoint(O1,P)',
        'R12=Rotate(O2,90°,M12)',
        'R1P=Rotate(O1,90°,M1P)',
        'bis12=Segment(M12,R12)',
        'bis1P=Segment(M1P,R1P)',
        'C0=Intersect(bis12,bis1P)',
        'D=Foot(O1,O2,P)',
        'E=Foot(O2,P,O1)',
        'alt1=Segment(O1,D)',
        'alt2=Segment(O2,E)',
        'H0=Intersect(alt1,alt2)',
        'omega=Circle(C0,O1)',
        'L=Rotate(O1,45°,C0)',
        'cyclicChord=Segment(O1,L)',
      ],
    });

    expect(result.opaqueCommandCount).toBe(0);
    expect(result.geometryDoc.semantic.ir.constraints.map((constraint) => constraint.kind))
      .toEqual(expect.arrayContaining([
        'circumcenter',
        'orthocenter',
        'point-on-circle',
        'concyclic',
      ]));
    const circleMemberships = result.geometryDoc.semantic.ir.constraints
      .filter((constraint) => constraint.kind === 'point-on-circle');
    expect(circleMemberships).toHaveLength(8);
    for (const derivedPointName of ['U', 'R12', 'R1P']) {
      expect(circleMemberships.some((constraint) => constraint.arguments.some((argument) => (
        argument.role === 'point' && argument.entityId === `ggb:entity:${derivedPointName}`
      )))).toBe(false);
    }
    expect(result.semanticSignature.coverage).toMatchObject({
      entities: { portable: 26, total: 26 },
      constraints: { portable: 17, total: 17 },
      relations: { portable: 12 },
    });
  });
});
