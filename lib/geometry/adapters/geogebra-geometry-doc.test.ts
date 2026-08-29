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
        constraints: { portable: 2, total: 2 },
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
    const vectorBinding = result.geometryDoc.construction.bindings.find((binding) => (
      binding.kind === 'extension' && binding.payload.commandName === 'Vector'
    ));
    expect(vectorBinding?.targets).toEqual([]);
    expect(result.geometryDoc.semantic.ir.entities.some((entity) => entity.name === 'dirPQ'))
      .toBe(false);
    expect(result.semanticSignature.coverage).toMatchObject({
      entities: { portable: 11, total: 11 },
      constraints: { portable: 2, total: 2 },
      relations: { portable: 5 },
    });
  });
});
