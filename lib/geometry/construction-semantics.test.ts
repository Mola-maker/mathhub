import { describe, expect, it } from 'vitest';
import {
  inferConstructionSemanticConstraints,
  type ConstructionSemanticTopology,
} from './construction-semantics';

function point(
  name: string,
  extra: Omit<ConstructionSemanticTopology['points'][number], 'id' | 'name'> = {},
): ConstructionSemanticTopology['points'][number] {
  return { id: `point:${name}`, name, ...extra };
}

function segment(
  id: string,
  left: string,
  right: string,
): ConstructionSemanticTopology['segments'][number] {
  return { id: `segment:${id}`, endpointNames: [left, right] };
}

describe('renderer-neutral construction semantics', () => {
  it('recovers tangent, parallel, triangle centers, circle membership and concyclicity', () => {
    const topology: ConstructionSemanticTopology = {
      points: [
        point('O1'),
        point('O2'),
        point('P', { incidentEntityIds: ['circle:c1', 'circle:c2'] }),
        point('Q', { incidentEntityIds: ['circle:c1', 'circle:c2'] }),
        point('U', {
          definition: {
            kind: 'rotate',
            centerName: 'P',
            pointName: 'O1',
            scale: 1,
            angleDegrees: 90,
          },
        }),
        point('V', {
          definition: {
            kind: 'translate',
            pointName: 'U',
            fromName: 'P',
            toName: 'Q',
          },
        }),
        point('M12', {
          definition: { kind: 'midpoint', startName: 'O1', endName: 'O2' },
        }),
        point('M1P', {
          definition: { kind: 'midpoint', startName: 'O1', endName: 'P' },
        }),
        point('R12', {
          definition: {
            kind: 'rotate',
            centerName: 'M12',
            pointName: 'O2',
            scale: 1,
            angleDegrees: 90,
          },
        }),
        point('R1P', {
          definition: {
            kind: 'rotate',
            centerName: 'M1P',
            pointName: 'O1',
            scale: 1,
            angleDegrees: 90,
          },
        }),
        point('C0', { incidentEntityIds: ['segment:bis12', 'segment:bis1P'] }),
        point('D', {
          definition: {
            kind: 'perpendicular-foot',
            pointName: 'O1',
            lineStartName: 'O2',
            lineEndName: 'P',
          },
        }),
        point('E', {
          definition: {
            kind: 'perpendicular-foot',
            pointName: 'O2',
            lineStartName: 'P',
            lineEndName: 'O1',
          },
        }),
        point('H0', { incidentEntityIds: ['segment:alt1', 'segment:alt2'] }),
        point('L', {
          definition: {
            kind: 'rotate',
            centerName: 'C0',
            pointName: 'O1',
            scale: 1,
            angleDegrees: 45,
          },
        }),
      ],
      segments: [
        segment('chord', 'P', 'Q'),
        segment('tangent', 'P', 'U'),
        segment('parallel', 'Q', 'V'),
        segment('bis12', 'M12', 'R12'),
        segment('bis1P', 'M1P', 'R1P'),
        segment('alt1', 'O1', 'D'),
        segment('alt2', 'O2', 'E'),
      ],
      circles: [
        { id: 'circle:c1', centerName: 'O1' },
        { id: 'circle:c2', centerName: 'O2' },
        { id: 'circle:omega', centerName: 'C0', throughName: 'O1' },
      ],
    };

    const constraints = inferConstructionSemanticConstraints(topology);
    const kinds = constraints.map((constraint) => constraint.kind);

    expect(kinds.filter((kind) => kind === 'point-on-circle')).toHaveLength(8);
    expect(kinds).toEqual(expect.arrayContaining([
      'tangent',
      'parallel',
      'circumcenter',
      'orthocenter',
      'concyclic',
    ]));
    expect(constraints).toHaveLength(13);
    expect(constraints.every((constraint) => constraint.evidenceEntityIds.length > 0))
      .toBe(true);
  });

  it('keeps a three-point circle centerless while preserving its members', () => {
    const constraints = inferConstructionSemanticConstraints({
      points: [
        point('A'),
        point('B'),
        point('C'),
        point('R', {
          definition: {
            kind: 'rotate',
            pointName: 'A',
            centerName: 'B',
            scale: 1,
            angleDegrees: 90,
          },
        }),
      ],
      segments: [segment('candidate', 'B', 'R')],
      circles: [{ id: 'circle:omega', memberNames: ['A', 'B', 'C'] }],
    });

    expect(constraints.filter((constraint) => constraint.kind === 'point-on-circle'))
      .toHaveLength(3);
    expect(constraints.some((constraint) => constraint.kind === 'tangent')).toBe(false);
  });

  it('promotes explicit triangle-center definitions and rejects unresolved triples', () => {
    const constraints = inferConstructionSemanticConstraints({
      points: [
        point('A', { sourceBindingIds: ['binding:A'] }),
        point('B', { sourceBindingIds: ['binding:B'] }),
        point('C', { sourceBindingIds: ['binding:C'] }),
        point('O', {
          definition: {
            kind: 'circumcenter',
            vertexNames: ['A', 'B', 'C'],
          },
          sourceBindingIds: ['binding:O'],
        }),
        point('H', {
          definition: {
            kind: 'orthocenter',
            vertexNames: ['C', 'A', 'B'],
          },
          sourceBindingIds: ['binding:H'],
        }),
        point('unresolved', {
          definition: {
            kind: 'circumcenter',
            vertexNames: ['A', 'B', 'Missing'],
          },
        }),
        point('selfReference', {
          definition: {
            kind: 'orthocenter',
            vertexNames: ['selfReference', 'A', 'B'],
          },
        }),
        point('duplicate', {
          definition: {
            kind: 'circumcenter',
            vertexNames: ['A', 'B', 'C'],
          },
        }),
        point('duplicate'),
      ],
      segments: [],
      circles: [{ id: 'circle:omega', memberNames: ['A', 'B', 'C'] }],
    });
    const centers = constraints.filter((constraint) => (
      constraint.kind === 'circumcenter' || constraint.kind === 'orthocenter'
    ));

    expect(centers).toHaveLength(2);
    expect(centers.find((constraint) => constraint.kind === 'circumcenter')?.arguments).toEqual(
      [
        { role: 'center', entityId: 'point:O' },
        { role: 'vertex-1', entityId: 'point:A' },
        { role: 'vertex-2', entityId: 'point:B' },
        { role: 'vertex-3', entityId: 'point:C' },
      ],
    );
    expect(centers.find((constraint) => constraint.kind === 'orthocenter')?.arguments).toEqual(
      [
        { role: 'center', entityId: 'point:H' },
        { role: 'vertex-1', entityId: 'point:A' },
        { role: 'vertex-2', entityId: 'point:B' },
        { role: 'vertex-3', entityId: 'point:C' },
      ],
    );
    expect(centers.find((constraint) => constraint.kind === 'circumcenter')?.evidenceKinds)
      .toEqual(['explicit-circumcenter-command']);
    expect(centers.find((constraint) => constraint.kind === 'orthocenter')?.evidenceKinds)
      .toEqual(['explicit-orthocenter-command']);
    expect(centers.some((constraint) => constraint.arguments.some((argument) => (
      argument.entityId === 'point:unresolved'
      || argument.entityId === 'point:selfReference'
      || argument.entityId === 'point:duplicate'
    )))).toBe(false);
  });
});
