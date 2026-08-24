import type {
  ConstructionPlan,
  ConstructionPlanKind,
  PrimitiveKind,
} from './construction-ir';

export const CONSTRUCTION_PLAN_FOOTPRINT_ABI_VERSION =
  'construction-plan-footprint/v1' as const;

export interface ConstructionPlanFootprintIssue {
  readonly path: 'inputs' | 'entities' | 'constraints' | 'relations' | 'outputs';
  readonly message: string;
}

type SemanticRecords = Pick<
  ConstructionPlan,
  'inputs' | 'entities' | 'constraints' | 'relations' | 'outputs'
>;

const input = (id: string, role: string, ref: string) => ({ id, role, ref });
const point = (name: string, tags: readonly string[]) => ({
  recordType: 'entity' as const,
  id: `entity-${name}`,
  name,
  kind: 'point' as const,
  tags,
});
const line = (
  name: string,
  from: string,
  to: string,
  kind: 'line' | 'segment' = 'line',
  tags?: readonly string[],
) => ({
  recordType: 'entity' as const,
  id: `entity-${name}`,
  name,
  kind,
  from,
  to,
  ...(tags ? { tags } : {}),
});
const dependency = (from: string, refs: readonly string[]) => refs.map((to, index) => ({
  recordType: 'relation' as const,
  id: `depends-${from}-${index + 1}`,
  kind: 'depends-on' as const,
  from,
  to,
  directed: true,
}));
const output = (
  ref: string,
  role: string,
  kind: ConstructionPlan['outputs'][number]['kind'] = 'derived-point',
) => ({
  recordType: 'output' as const,
  id: `output-${ref}`,
  role,
  ref,
  kind,
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function primitiveReferences(plan: Extract<ConstructionPlan, { kind: 'primitive' }>): readonly string[] {
  switch (plan.primitive.kind) {
    case 'point': return [];
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray': return [plan.primitive.from, plan.primitive.to];
    case 'polyline':
    case 'polygon': return plan.primitive.vertices;
    case 'rectangle': return plan.primitive.corners;
    case 'circle': return [plan.primitive.center, plan.primitive.through];
    case 'label': return [plan.primitive.at];
    case 'angle':
    case 'right-angle': return plan.primitive.points;
  }
}

function primitiveRoles(kind: PrimitiveKind): readonly string[] {
  switch (kind) {
    case 'point': return [];
    case 'segment':
    case 'vector':
    case 'line': return ['from', 'to'];
    case 'ray': return ['origin', 'direction'];
    case 'polyline':
    case 'polygon': return [];
    case 'rectangle': return ['first-corner', 'opposite-corner'];
    case 'circle': return ['center', 'through'];
    case 'label': return ['at'];
    case 'angle':
    case 'right-angle': return ['arm-a', 'vertex', 'arm-b'];
  }
}

function primitiveRecords(
  plan: Extract<ConstructionPlan, { kind: 'primitive' }>,
): SemanticRecords {
  const primitive = plan.primitive;
  const refs = primitiveReferences(plan);
  const entityName = primitive.kind === 'point' ? primitive.name : plan.id;
  const entityId = `entity-${entityName}`;
  const entityReference = primitive.kind === 'point' ? primitive.name : entityId;
  const roles = primitiveRoles(primitive.kind);
  const inputs = primitive.kind === 'polyline' || primitive.kind === 'polygon'
    ? refs.map((ref, index) => input(`vertex-${index + 1}`, 'vertex', ref))
    : refs.flatMap((ref, index) => (
      roles[index] ? [input(`input-${index + 1}`, roles[index]!, ref)] : []
    ));
  const base = {
    recordType: 'entity' as const,
    id: entityId,
    name: entityName,
    tags: ['canvas-authored', 'primitive'],
  };
  const entity = (() => {
    switch (primitive.kind) {
      case 'point': return {
        ...base,
        kind: primitive.kind,
        position: primitive.position,
        tags: ['canvas-authored', 'primitive', 'free'],
      };
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray': return { ...base, kind: primitive.kind, from: primitive.from, to: primitive.to };
      case 'polyline':
      case 'polygon': return { ...base, kind: primitive.kind, vertices: primitive.vertices };
      case 'rectangle': return { ...base, kind: primitive.kind, corners: primitive.corners };
      case 'circle': return {
        ...base,
        kind: primitive.kind,
        center: primitive.center,
        through: primitive.through,
      };
      case 'label': return { ...base, kind: primitive.kind, at: primitive.at, text: primitive.text };
      case 'angle':
      case 'right-angle': return { ...base, kind: primitive.kind, points: primitive.points };
    }
  })();
  return {
    inputs,
    entities: [entity],
    constraints: [],
    relations: primitive.kind === 'point' ? [] : dependency(entityReference, refs),
    outputs: [{
      recordType: 'output',
      id: `output-${plan.id}`,
      role: primitive.kind,
      ref: entityReference,
      kind: primitive.kind,
    }],
  };
}

function expectedSemanticRecords(plan: ConstructionPlan): SemanticRecords {
  switch (plan.kind) {
    case 'primitive': return primitiveRecords(plan);
    case 'rectangle-by-opposite-corners': {
      const edgeIds = [
        `line-${plan.first}-${plan.second}`,
        `line-${plan.second}-${plan.opposite}`,
        `line-${plan.opposite}-${plan.fourth}`,
        `line-${plan.fourth}-${plan.first}`,
      ] as const;
      return {
        inputs: [
          input('first', 'first-corner', plan.first),
          input('opposite', 'opposite-corner', plan.opposite),
        ],
        entities: [
          point(plan.second, ['derived', 'rectangle-corner']),
          point(plan.fourth, ['derived', 'rectangle-corner']),
          line(edgeIds[0], plan.first, plan.second),
          line(edgeIds[1], plan.second, plan.opposite),
          line(edgeIds[2], plan.opposite, plan.fourth),
          line(edgeIds[3], plan.fourth, plan.first),
          {
            recordType: 'entity',
            id: `entity-${plan.id}-boundary`,
            name: `${plan.id}-boundary`,
            kind: 'polygon',
            vertices: [plan.first, plan.second, plan.opposite, plan.fourth],
            tags: ['rectangle-boundary', 'derived'],
          },
          {
            recordType: 'entity',
            id: `entity-${plan.id}`,
            name: plan.id,
            kind: 'rectangle',
            corners: [plan.first, plan.opposite],
            tags: ['rectangle', 'derived'],
          },
        ],
        constraints: [
          {
            recordType: 'constraint',
            id: `parallel-${edgeIds[0]}-${edgeIds[2]}`,
            kind: 'parallel',
            line: edgeIds[0],
            reference: edgeIds[2],
          },
          {
            recordType: 'constraint',
            id: `parallel-${edgeIds[1]}-${edgeIds[3]}`,
            kind: 'parallel',
            line: edgeIds[1],
            reference: edgeIds[3],
          },
          {
            recordType: 'constraint',
            id: `perpendicular-${edgeIds[0]}-${edgeIds[1]}`,
            kind: 'perpendicular',
            line: edgeIds[0],
            reference: edgeIds[1],
          },
        ],
        relations: [
          ...dependency(plan.second, [plan.first, plan.opposite]),
          ...dependency(plan.fourth, [plan.first, plan.opposite]),
          ...dependency(`entity-${plan.id}`, [plan.first, plan.opposite]),
          ...dependency(`entity-${plan.id}-boundary`, [`entity-${plan.id}`]),
        ],
        outputs: [
          output(plan.second, 'second-corner'),
          output(plan.fourth, 'fourth-corner'),
          {
            recordType: 'output',
            id: `output-${plan.id}`,
            role: 'rectangle',
            ref: `entity-${plan.id}`,
            kind: 'rectangle',
          },
        ],
      };
    }
    case 'midpoint': return {
      inputs: [input('a', 'segment-start', plan.a), input('b', 'segment-end', plan.b)],
      entities: [point(plan.result, ['derived', 'midpoint'])],
      constraints: [{
        recordType: 'constraint',
        id: `midpoint-${plan.result}-${plan.a}-${plan.b}`,
        kind: 'midpoint', point: plan.result, a: plan.a, b: plan.b,
      }],
      relations: dependency(plan.result, [plan.a, plan.b]),
      outputs: [output(plan.result, 'midpoint')],
    };
    case 'perpendicular-foot': return {
      inputs: [
        input('point', 'projected-point', plan.point),
        input('line-start', 'reference-start', plan.lineStart),
        input('line-end', 'reference-end', plan.lineEnd),
      ],
      entities: [point(plan.result, ['derived', 'perpendicular-foot'])],
      constraints: [{
        recordType: 'constraint',
        id: `perpendicular-foot-${plan.result}-${plan.lineStart}-${plan.lineEnd}`,
        kind: 'perpendicular-foot', point: plan.point,
        lineStart: plan.lineStart, lineEnd: plan.lineEnd, result: plan.result,
      }],
      relations: dependency(plan.result, [plan.point, plan.lineStart, plan.lineEnd]),
      outputs: [output(plan.result, 'foot')],
    };
    case 'point-on-circle': return {
      inputs: [input('circle', 'circle', plan.circle.id!)],
      entities: [point(plan.result, ['derived', 'on-circle'])],
      constraints: [{
        recordType: 'constraint', id: `constraint-${plan.result}`,
        kind: 'on-circle', point: plan.result, circle: plan.circle.id!,
      }],
      relations: [{
        recordType: 'relation', id: `depends-${plan.result}`,
        kind: 'depends-on', from: plan.result, to: plan.circle.id!, directed: true,
      }],
      outputs: [output(plan.result, 'point')],
    };
    case 'parallel-line':
    case 'perpendicular-line': {
      const reference = `line-${plan.referenceStart}-${plan.referenceEnd}`;
      const resultLine = `line-${plan.result}`;
      return {
        inputs: [
          input('through', 'through-point', plan.through),
          input('reference-start', 'reference-start', plan.referenceStart),
          input('reference-end', 'reference-end', plan.referenceEnd),
        ],
        entities: [
          point(plan.result, ['derived', 'direction']),
          {
            recordType: 'entity', id: resultLine, name: resultLine,
            kind: 'line', from: plan.through, to: plan.result,
          },
          line(reference, plan.referenceStart, plan.referenceEnd),
        ],
        constraints: [{
          recordType: 'constraint', id: `constraint-${plan.result}`,
          kind: plan.kind === 'parallel-line' ? 'parallel' : 'perpendicular',
          line: resultLine, reference,
        }],
        relations: [
          ...[plan.referenceStart, plan.referenceEnd].map((ref, index) => ({
            recordType: 'relation' as const,
            id: `depends-${plan.result}-${index + 1}`,
            kind: 'depends-on' as const,
            from: plan.result, to: ref, directed: true,
          })),
          ...dependency(reference, [plan.referenceStart, plan.referenceEnd]),
        ],
        outputs: [output(plan.result, 'direction-point')],
      };
    }
    case 'perpendicular-bisector': return {
      inputs: [input('a', 'segment-start', plan.a), input('b', 'segment-end', plan.b)],
      entities: [
        point(plan.midpoint, ['derived', 'midpoint']),
        point(plan.result, ['derived', 'direction']),
        line(plan.line, plan.midpoint, plan.result),
      ],
      constraints: [
        {
          recordType: 'constraint', id: `midpoint-${plan.midpoint}-${plan.a}-${plan.b}`,
          kind: 'midpoint', point: plan.midpoint, a: plan.a, b: plan.b,
        },
        {
          recordType: 'constraint', id: `perpendicular-bisector-${plan.line}`,
          kind: 'perpendicular-bisector', line: plan.line,
          midpoint: plan.midpoint, a: plan.a, b: plan.b,
        },
      ],
      relations: [
        ...dependency(plan.midpoint, [plan.a, plan.b]),
        ...dependency(plan.result, [plan.midpoint, plan.a, plan.b]),
        ...dependency(plan.line, [plan.midpoint, plan.result]),
      ],
      outputs: [
        output(plan.midpoint, 'midpoint'),
        output(plan.result, 'direction-point'),
        output(plan.line, 'perpendicular-bisector', 'line'),
      ],
    };
    case 'angle-bisector': return {
      inputs: [
        input('arm-a', 'first-arm', plan.armA),
        input('vertex', 'vertex', plan.vertex),
        input('arm-b', 'second-arm', plan.armB),
      ],
      entities: [
        point(plan.result, ['derived', 'angle-bisector']),
        line(plan.line, plan.vertex, plan.result),
      ],
      constraints: [{
        recordType: 'constraint', id: `angle-bisector-${plan.line}`,
        kind: 'angle-bisector', line: plan.line,
        armA: plan.armA, vertex: plan.vertex, armB: plan.armB,
      }],
      relations: [
        ...dependency(plan.result, [plan.armA, plan.vertex, plan.armB]),
        ...dependency(plan.line, [plan.vertex, plan.result]),
      ],
      outputs: [
        output(plan.result, 'bisector-direction'),
        output(plan.line, 'angle-bisector', 'line'),
      ],
    };
    case 'circumcircle': return {
      inputs: [
        input('a', 'first-point', plan.a),
        input('b', 'second-point', plan.b),
        input('c', 'third-point', plan.c),
      ],
      entities: [
        point(plan.center, ['derived', 'circumcenter']),
        {
          recordType: 'entity', id: plan.circle, name: plan.circle,
          kind: 'circle', center: plan.center, through: plan.a,
          tags: ['derived', 'circumcircle'],
        },
      ],
      constraints: [{
        recordType: 'constraint', id: `circle-through-${plan.a}-${plan.b}-${plan.c}`,
        kind: 'circle-through-three-points', circle: plan.circle,
        center: plan.center, points: [plan.a, plan.b, plan.c],
      }],
      relations: [
        ...dependency(plan.center, [plan.a, plan.b, plan.c]),
        ...dependency(plan.circle, [plan.center, plan.a, plan.b, plan.c]),
      ],
      outputs: [
        output(plan.center, 'circumcenter'),
        output(plan.circle, 'circumcircle', 'circle'),
      ],
    };
    case 'nine-point-circle': return {
      inputs: [
        input('a', 'triangle-vertex', plan.a),
        input('b', 'triangle-vertex', plan.b),
        input('c', 'triangle-vertex', plan.c),
      ],
      entities: [
        point(plan.midpointBC, ['derived', 'nine-point-circle', 'side-midpoint']),
        point(plan.midpointCA, ['derived', 'nine-point-circle', 'side-midpoint']),
        point(plan.midpointAB, ['derived', 'nine-point-circle', 'side-midpoint']),
        point(plan.footA, ['derived', 'nine-point-circle', 'altitude-foot']),
        point(plan.footB, ['derived', 'nine-point-circle', 'altitude-foot']),
        point(plan.footC, ['derived', 'nine-point-circle', 'altitude-foot']),
        point(plan.orthocenter, ['derived', 'nine-point-circle', 'orthocenter']),
        point(plan.vertexMidpointA, ['derived', 'nine-point-circle', 'vertex-orthocenter-midpoint']),
        point(plan.vertexMidpointB, ['derived', 'nine-point-circle', 'vertex-orthocenter-midpoint']),
        point(plan.vertexMidpointC, ['derived', 'nine-point-circle', 'vertex-orthocenter-midpoint']),
        point(plan.center, ['derived', 'nine-point-circle', 'center']),
        {
          recordType: 'entity', id: plan.circle, name: plan.circle,
          kind: 'circle', center: plan.center, through: plan.midpointBC,
          tags: ['derived', 'nine-point-circle', 'through-nine-points'],
        },
      ],
      constraints: [
        { recordType: 'constraint', id: `midpoint-${plan.midpointBC}`, kind: 'midpoint', point: plan.midpointBC, a: plan.b, b: plan.c },
        { recordType: 'constraint', id: `midpoint-${plan.midpointCA}`, kind: 'midpoint', point: plan.midpointCA, a: plan.c, b: plan.a },
        { recordType: 'constraint', id: `midpoint-${plan.midpointAB}`, kind: 'midpoint', point: plan.midpointAB, a: plan.a, b: plan.b },
        { recordType: 'constraint', id: `foot-${plan.footA}`, kind: 'perpendicular-foot', point: plan.a, lineStart: plan.b, lineEnd: plan.c, result: plan.footA },
        { recordType: 'constraint', id: `foot-${plan.footB}`, kind: 'perpendicular-foot', point: plan.b, lineStart: plan.c, lineEnd: plan.a, result: plan.footB },
        { recordType: 'constraint', id: `foot-${plan.footC}`, kind: 'perpendicular-foot', point: plan.c, lineStart: plan.a, lineEnd: plan.b, result: plan.footC },
        { recordType: 'constraint', id: `midpoint-${plan.vertexMidpointA}`, kind: 'midpoint', point: plan.vertexMidpointA, a: plan.a, b: plan.orthocenter },
        { recordType: 'constraint', id: `midpoint-${plan.vertexMidpointB}`, kind: 'midpoint', point: plan.vertexMidpointB, a: plan.b, b: plan.orthocenter },
        { recordType: 'constraint', id: `midpoint-${plan.vertexMidpointC}`, kind: 'midpoint', point: plan.vertexMidpointC, a: plan.c, b: plan.orthocenter },
        {
          recordType: 'constraint',
          id: `circle-through-${plan.midpointBC}-${plan.midpointCA}-${plan.midpointAB}`,
          kind: 'circle-through-three-points', circle: plan.circle, center: plan.center,
          points: [plan.midpointBC, plan.midpointCA, plan.midpointAB],
        },
        ...[
          plan.midpointBC, plan.midpointCA, plan.midpointAB,
          plan.footA, plan.footB, plan.footC,
          plan.vertexMidpointA, plan.vertexMidpointB, plan.vertexMidpointC,
        ].map((pointRef) => ({
          recordType: 'constraint' as const,
          id: `on-circle-${pointRef}-${plan.circle}`,
          kind: 'on-circle' as const,
          point: pointRef,
          circle: plan.circle,
        })),
      ],
      relations: [
        ...dependency(plan.midpointBC, [plan.b, plan.c]),
        ...dependency(plan.midpointCA, [plan.c, plan.a]),
        ...dependency(plan.midpointAB, [plan.a, plan.b]),
        ...dependency(plan.footA, [plan.a, plan.b, plan.c]),
        ...dependency(plan.footB, [plan.a, plan.b, plan.c]),
        ...dependency(plan.footC, [plan.a, plan.b, plan.c]),
        ...dependency(plan.orthocenter, [plan.a, plan.footA, plan.b, plan.footB]),
        ...dependency(plan.vertexMidpointA, [plan.a, plan.orthocenter]),
        ...dependency(plan.vertexMidpointB, [plan.b, plan.orthocenter]),
        ...dependency(plan.vertexMidpointC, [plan.c, plan.orthocenter]),
        ...dependency(plan.center, [plan.midpointBC, plan.midpointCA, plan.midpointAB]),
        ...dependency(plan.circle, [plan.center, plan.midpointBC, plan.midpointCA, plan.midpointAB, plan.footA, plan.footB, plan.footC, plan.vertexMidpointA, plan.vertexMidpointB, plan.vertexMidpointC]),
      ],
      outputs: [
        output(plan.midpointBC, 'side-midpoint-bc'),
        output(plan.midpointCA, 'side-midpoint-ca'),
        output(plan.midpointAB, 'side-midpoint-ab'),
        output(plan.footA, 'altitude-foot-a'),
        output(plan.footB, 'altitude-foot-b'),
        output(plan.footC, 'altitude-foot-c'),
        output(plan.orthocenter, 'orthocenter'),
        output(plan.vertexMidpointA, 'vertex-orthocenter-midpoint-a'),
        output(plan.vertexMidpointB, 'vertex-orthocenter-midpoint-b'),
        output(plan.vertexMidpointC, 'vertex-orthocenter-midpoint-c'),
        output(plan.center, 'nine-point-center'),
        output(plan.circle, 'nine-point-circle', 'circle'),
      ],
    };
    case 'simson-line': return {
      inputs: [
        input('a', 'triangle-vertex', plan.a),
        input('b', 'triangle-vertex', plan.b),
        input('c', 'triangle-vertex', plan.c),
      ],
      entities: [
        point(plan.center, ['derived', 'simson-line', 'circumcenter']),
        {
          recordType: 'entity', id: plan.circle, name: plan.circle,
          kind: 'circle', center: plan.center, through: plan.a,
          tags: ['derived', 'simson-line', 'circumcircle'],
        },
        point(plan.point, ['derived', 'simson-line', 'circle-point']),
        point(plan.footAB, ['derived', 'simson-line', 'pedal-foot']),
        point(plan.footBC, ['derived', 'simson-line', 'pedal-foot']),
        point(plan.footCA, ['derived', 'simson-line', 'pedal-foot']),
        line(plan.line, plan.footAB, plan.footCA, 'line', ['derived', 'simson-line', 'collinear-feet']),
      ],
      constraints: [
        {
          recordType: 'constraint', id: `circle-through-${plan.a}-${plan.b}-${plan.c}`,
          kind: 'circle-through-three-points', circle: plan.circle,
          center: plan.center, points: [plan.a, plan.b, plan.c],
        },
        { recordType: 'constraint', id: `on-circle-${plan.point}`, kind: 'on-circle', point: plan.point, circle: plan.circle },
        { recordType: 'constraint', id: `rotation-${plan.point}`, kind: 'rotation', source: plan.a, center: plan.center, result: plan.point, angleDegrees: plan.angleDegrees },
        { recordType: 'constraint', id: `foot-${plan.footAB}`, kind: 'perpendicular-foot', point: plan.point, lineStart: plan.a, lineEnd: plan.b, result: plan.footAB },
        { recordType: 'constraint', id: `foot-${plan.footBC}`, kind: 'perpendicular-foot', point: plan.point, lineStart: plan.b, lineEnd: plan.c, result: plan.footBC },
        { recordType: 'constraint', id: `foot-${plan.footCA}`, kind: 'perpendicular-foot', point: plan.point, lineStart: plan.c, lineEnd: plan.a, result: plan.footCA },
        { recordType: 'constraint', id: `collinear-${plan.footAB}-${plan.footBC}-${plan.footCA}`, kind: 'collinear', points: [plan.footAB, plan.footBC, plan.footCA] },
      ],
      relations: [
        ...dependency(plan.center, [plan.a, plan.b, plan.c]),
        ...dependency(plan.circle, [plan.center, plan.a, plan.b, plan.c]),
        ...dependency(plan.point, [plan.circle, plan.center, plan.a]),
        ...dependency(plan.footAB, [plan.point, plan.a, plan.b]),
        ...dependency(plan.footBC, [plan.point, plan.b, plan.c]),
        ...dependency(plan.footCA, [plan.point, plan.c, plan.a]),
        ...dependency(plan.line, [plan.footAB, plan.footBC, plan.footCA]),
      ],
      outputs: [
        output(plan.center, 'circumcenter'),
        output(plan.circle, 'circumcircle', 'circle'),
        output(plan.point, 'circumcircle-point'),
        output(plan.footAB, 'pedal-foot-ab'),
        output(plan.footBC, 'pedal-foot-bc'),
        output(plan.footCA, 'pedal-foot-ca'),
        output(plan.line, 'simson-line', 'derived-line'),
      ],
    };
    case 'fermat-point': return {
      inputs: [
        input('a', 'triangle-vertex', plan.a),
        input('b', 'triangle-vertex', plan.b),
        input('c', 'triangle-vertex', plan.c),
      ],
      entities: [
        point(plan.equilateralAB, ['derived', 'fermat-point', 'equilateral-vertex']),
        point(plan.equilateralAC, ['derived', 'fermat-point', 'equilateral-vertex']),
        point(plan.torricelli, ['derived', 'fermat-point', 'torricelli-candidate']),
        point(plan.result, ['derived', 'fermat-point', plan.resultSource === plan.torricelli ? 'interior-branch' : 'vertex-branch']),
        line(plan.line1, plan.c, plan.equilateralAB),
        line(plan.line2, plan.b, plan.equilateralAC),
        {
          recordType: 'entity', id: plan.triangleAB, name: plan.triangleAB,
          kind: 'polygon', vertices: [plan.a, plan.b, plan.equilateralAB],
          tags: ['fermat-point', 'equilateral-auxiliary'],
        },
        {
          recordType: 'entity', id: plan.triangleAC, name: plan.triangleAC,
          kind: 'polygon', vertices: [plan.a, plan.c, plan.equilateralAC],
          tags: ['fermat-point', 'equilateral-auxiliary'],
        },
        { recordType: 'entity', id: plan.rayA, name: plan.rayA, kind: 'segment', from: plan.result, to: plan.a, tags: ['fermat-point', 'distance-ray'] },
        { recordType: 'entity', id: plan.rayB, name: plan.rayB, kind: 'segment', from: plan.result, to: plan.b, tags: ['fermat-point', 'distance-ray'] },
        { recordType: 'entity', id: plan.rayC, name: plan.rayC, kind: 'segment', from: plan.result, to: plan.c, tags: ['fermat-point', 'distance-ray'] },
      ],
      constraints: [
        { recordType: 'constraint', id: `rotation-${plan.equilateralAB}`, kind: 'rotation', source: plan.b, center: plan.a, result: plan.equilateralAB, angleDegrees: plan.rotationABDegrees },
        { recordType: 'constraint', id: `rotation-${plan.equilateralAC}`, kind: 'rotation', source: plan.c, center: plan.a, result: plan.equilateralAC, angleDegrees: plan.rotationACDegrees },
        { recordType: 'constraint', id: `intersection-${plan.torricelli}`, kind: 'line-intersection', point: plan.torricelli, line1: plan.line1, line2: plan.line2, domain: 'line' },
        { recordType: 'constraint', id: `branch-${plan.result}`, kind: 'midpoint', point: plan.result, a: plan.resultSource, b: plan.resultSource },
      ],
      relations: [
        ...dependency(plan.equilateralAB, [plan.a, plan.b]),
        ...dependency(plan.equilateralAC, [plan.a, plan.c]),
        ...dependency(plan.line1, [plan.c, plan.equilateralAB]),
        ...dependency(plan.line2, [plan.b, plan.equilateralAC]),
        ...dependency(plan.torricelli, [plan.line1, plan.line2]),
        ...dependency(plan.result, [plan.resultSource]),
        ...dependency(plan.triangleAB, [plan.a, plan.b, plan.equilateralAB]),
        ...dependency(plan.triangleAC, [plan.a, plan.c, plan.equilateralAC]),
        ...dependency(plan.rayA, [plan.result, plan.a]),
        ...dependency(plan.rayB, [plan.result, plan.b]),
        ...dependency(plan.rayC, [plan.result, plan.c]),
      ],
      outputs: [
        output(plan.equilateralAB, 'equilateral-vertex-ab'),
        output(plan.equilateralAC, 'equilateral-vertex-ac'),
        output(plan.result, plan.resultSource === plan.a ? 'fermat-vertex-a' : plan.resultSource === plan.b ? 'fermat-vertex-b' : plan.resultSource === plan.c ? 'fermat-vertex-c' : 'fermat-point'),
        output(plan.triangleAB, 'equilateral-triangle-ab', 'polygon'),
        output(plan.triangleAC, 'equilateral-triangle-ac', 'polygon'),
        output(plan.rayA, 'fermat-ray-a', 'segment'),
        output(plan.rayB, 'fermat-ray-b', 'segment'),
        output(plan.rayC, 'fermat-ray-c', 'segment'),
      ],
    };
    case 'tangent-at-point': return {
      inputs: [
        input('circle', 'circle', plan.circle.id!),
        input('circle-center', 'circle-center', plan.circle.center),
      ],
      entities: [
        point(plan.touch, ['derived', 'on-circle', 'tangent-touch']),
        point(plan.result, ['derived', 'tangent-direction']),
        line(plan.line, plan.touch, plan.result),
      ],
      constraints: [
        {
          recordType: 'constraint', id: `on-circle-${plan.touch}`,
          kind: 'on-circle', point: plan.touch, circle: plan.circle.id!,
        },
        {
          recordType: 'constraint', id: `tangent-${plan.line}`,
          kind: 'tangent-at-point', line: plan.line, touch: plan.touch,
          circle: plan.circle.id!, center: plan.circle.center,
        },
      ],
      relations: [
        ...dependency(plan.touch, [plan.circle.id!]),
        ...dependency(plan.result, [plan.touch, plan.circle.center]),
        ...dependency(plan.line, [plan.touch, plan.result]),
      ],
      outputs: [
        output(plan.touch, 'tangent-touch-point'),
        output(plan.result, 'tangent-direction'),
        output(plan.line, 'tangent-line', 'line'),
      ],
    };
    case 'reflect-point': return {
      inputs: [input('point', 'point', plan.point), input('center', 'center', plan.center)],
      entities: [point(plan.result, ['derived', 'reflection'])],
      constraints: [{
        recordType: 'constraint', id: `point-reflection-${plan.result}`,
        kind: 'point-reflection', source: plan.point,
        center: plan.center, result: plan.result,
      }],
      relations: dependency(plan.result, [plan.point, plan.center]),
      outputs: [output(plan.result, 'reflected-point')],
    };
    case 'reflect-line': return {
      inputs: [
        input('point', 'point', plan.point),
        input('line-a', 'axis-start', plan.lineStart),
        input('line-b', 'axis-end', plan.lineEnd),
      ],
      entities: [
        point(plan.foot, ['derived', 'projection']),
        point(plan.result, ['derived', 'reflection']),
      ],
      constraints: [{
        recordType: 'constraint', id: `line-reflection-${plan.result}`,
        kind: 'line-reflection', source: plan.point,
        axisStart: plan.lineStart, axisEnd: plan.lineEnd,
        foot: plan.foot, result: plan.result,
      }],
      relations: [
        ...dependency(plan.foot, [plan.point, plan.lineStart, plan.lineEnd]),
        ...dependency(plan.result, [plan.point, plan.foot, plan.lineStart, plan.lineEnd]),
      ],
      outputs: [output(plan.foot, 'projection-foot'), output(plan.result, 'reflected-point')],
    };
    case 'rotate-90': return {
      inputs: [input('point', 'point', plan.point), input('center', 'center', plan.center)],
      entities: [point(plan.result, ['derived', 'rotation'])],
      constraints: [{
        recordType: 'constraint', id: `rotation-${plan.result}`,
        kind: 'rotation', source: plan.point, center: plan.center,
        result: plan.result, angleDegrees: 90,
      }],
      relations: dependency(plan.result, [plan.point, plan.center]),
      outputs: [output(plan.result, 'rotated-point')],
    };
    case 'homothety-2': return {
      inputs: [input('point', 'point', plan.point), input('center', 'center', plan.center)],
      entities: [point(plan.result, ['derived', 'homothety'])],
      constraints: [{
        recordType: 'constraint', id: `homothety-${plan.result}`,
        kind: 'homothety', source: plan.point, center: plan.center,
        result: plan.result, scale: 2,
      }],
      relations: dependency(plan.result, [plan.point, plan.center]),
      outputs: [output(plan.result, 'homothetic-point')],
    };
    case 'inversion-point': return {
      inputs: [
        input('point', 'point', plan.point),
        input('center', 'center', plan.center),
        input('radius-point', 'radius-point', plan.radiusPoint),
      ],
      entities: [
        point(plan.result, ['derived', 'inversion']),
        line(plan.guide, plan.point, plan.result, 'segment', ['construction-guide', 'inversion']),
      ],
      constraints: [{
        recordType: 'constraint', id: `constraint-${plan.result}`,
        kind: 'inversion', point: plan.point, center: plan.center,
        radius: plan.radiusPoint, result: plan.result,
      }],
      relations: [
        ...dependency(plan.result, [plan.point, plan.center, plan.radiusPoint]),
        ...dependency(plan.guide, [plan.point, plan.result]),
      ],
      outputs: [
        output(plan.result, 'inverted-point'),
        output(plan.guide, 'inversion-guide', 'segment'),
      ],
    };
    case 'radical-axis': return {
      inputs: [
        input('circle-1', 'first-circle', plan.circle1.id!),
        input('circle-2', 'second-circle', plan.circle2.id!),
      ],
      entities: [
        point(plan.result, ['derived', 'radical-axis', 'equal-power-point']),
        point(plan.direction, ['derived', 'radical-axis-direction']),
        line(plan.line, plan.result, plan.direction),
      ],
      constraints: [{
        recordType: 'constraint', id: `radical-axis-${plan.line}`,
        kind: 'radical-axis', line: plan.line, point: plan.result,
        circle1: plan.circle1.id!, circle2: plan.circle2.id!,
      }],
      relations: [
        ...dependency(plan.result, [plan.circle1.id!, plan.circle2.id!]),
        ...dependency(plan.direction, [plan.result, plan.circle1.id!, plan.circle2.id!]),
        ...dependency(plan.line, [plan.result, plan.direction, plan.circle1.id!, plan.circle2.id!]),
      ],
      outputs: [
        output(plan.result, 'radical-axis-point'),
        output(plan.direction, 'radical-axis-direction'),
        output(plan.line, 'radical-axis-line', 'line'),
      ],
    };
    case 'cyclic-quadrilateral': return {
      inputs: [
        input('a', 'vertex', plan.a), input('b', 'vertex', plan.b),
        input('c', 'vertex', plan.c), input('direction', 'secant-direction', plan.direction),
      ],
      entities: [
        point(plan.center, ['derived', 'circumcenter']),
        point(plan.result, ['derived', 'on-circle']),
        {
          recordType: 'entity', id: `entity-${plan.circle}`, name: plan.circle,
          kind: 'circle', center: plan.center, through: plan.a,
          tags: ['derived', 'circumcircle', 'through-three-points'],
        },
        line(plan.secant, plan.a, plan.direction),
        {
          recordType: 'entity', id: `entity-${plan.polygon}`, name: plan.polygon,
          kind: 'polygon', vertices: [plan.a, plan.b, plan.result, plan.c],
        },
      ],
      constraints: [
        {
          recordType: 'constraint', id: `constraint-${plan.circle}`,
          kind: 'circle-through-three-points', circle: plan.circle,
          center: plan.center, points: [plan.a, plan.b, plan.c],
        },
        {
          recordType: 'constraint', id: `constraint-${plan.result}-other-intersection`,
          kind: 'line-circle-other-intersection', point: plan.result,
          line: plan.secant, circle: plan.circle, excludePoint: plan.a,
          domain: 'line', selector: 'exclude-known-point',
        },
        {
          recordType: 'constraint', id: `constraint-${plan.result}`,
          kind: 'cyclic', points: [plan.a, plan.b, plan.c, plan.result],
        },
      ],
      relations: [
        ...dependency(plan.center, [plan.a, plan.b, plan.c]),
        ...dependency(plan.circle, [plan.center, plan.a, plan.b, plan.c]),
        ...dependency(plan.secant, [plan.a, plan.direction]),
        ...dependency(plan.result, [plan.secant, plan.circle, plan.a]),
        ...dependency(plan.polygon, [plan.a, plan.b, plan.result, plan.c]),
      ],
      outputs: [
        output(plan.center, 'circumcenter'),
        output(plan.result, 'fourth-vertex'),
        output(plan.circle, 'circumcircle', 'circle'),
        output(plan.secant, 'secant-line', 'line'),
        output(plan.polygon, 'cyclic-quadrilateral', 'polygon'),
      ],
    };
    case 'complete-quadrilateral': return {
      inputs: [
        input('a', 'vertex', plan.a), input('b', 'vertex', plan.b),
        input('c', 'vertex', plan.c), input('d', 'vertex', plan.d),
      ],
      entities: [
        point(plan.firstIntersection, ['derived', 'intersection']),
        point(plan.secondIntersection, ['derived', 'intersection']),
        line(plan.lineAB, plan.a, plan.b),
        line(plan.lineBC, plan.b, plan.c),
        line(plan.lineCD, plan.c, plan.d),
        line(plan.lineDA, plan.d, plan.a),
        line(
          plan.diagonal,
          plan.firstIntersection,
          plan.secondIntersection,
          'segment',
          ['derived', 'diagonal'],
        ),
      ],
      constraints: [
        {
          recordType: 'constraint', id: `constraint-${plan.firstIntersection}-line-intersection`,
          kind: 'line-intersection', point: plan.firstIntersection,
          line1: plan.lineAB, line2: plan.lineCD, domain: 'line',
        },
        {
          recordType: 'constraint', id: `constraint-${plan.secondIntersection}-line-intersection`,
          kind: 'line-intersection', point: plan.secondIntersection,
          line1: plan.lineBC, line2: plan.lineDA, domain: 'line',
        },
        {
          recordType: 'constraint', id: `constraint-${plan.firstIntersection}`,
          kind: 'complete-quadrilateral', points: [plan.a, plan.b, plan.c, plan.d],
        },
      ],
      relations: [
        ...dependency(plan.lineAB, [plan.a, plan.b]),
        ...dependency(plan.lineBC, [plan.b, plan.c]),
        ...dependency(plan.lineCD, [plan.c, plan.d]),
        ...dependency(plan.lineDA, [plan.d, plan.a]),
        ...dependency(plan.firstIntersection, [plan.lineAB, plan.lineCD]),
        ...dependency(plan.secondIntersection, [plan.lineBC, plan.lineDA]),
        ...dependency(plan.diagonal, [plan.firstIntersection, plan.secondIntersection]),
      ],
      outputs: [
        output(plan.firstIntersection, 'opposite-intersection-1'),
        output(plan.secondIntersection, 'opposite-intersection-2'),
        output(plan.lineAB, 'side-line-ab', 'line'),
        output(plan.lineBC, 'side-line-bc', 'line'),
        output(plan.lineCD, 'side-line-cd', 'line'),
        output(plan.lineDA, 'side-line-da', 'line'),
        output(plan.diagonal, 'diagonal-segment', 'segment'),
      ],
    };
  }
}

const RECORD_FIELDS = [
  'inputs', 'entities', 'constraints', 'relations', 'outputs',
] as const satisfies readonly (keyof SemanticRecords)[];

export function validateConstructionPlanSemanticFootprint(
  plan: ConstructionPlan,
): readonly ConstructionPlanFootprintIssue[] {
  const expected = expectedSemanticRecords(plan);
  return RECORD_FIELDS.flatMap((path) => (
    canonicalJson(plan[path]) === canonicalJson(expected[path])
      ? []
      : [{
        path,
        message: `${plan.kind} ${path} do not match the canonical catalog footprint`,
      }]
  ));
}

export function assertConstructionPlanSemanticFootprint(
  plan: ConstructionPlan,
): void {
  const issues = validateConstructionPlanSemanticFootprint(plan);
  if (issues.length > 0) {
    throw new TypeError(
      `Invalid ${plan.kind} semantic footprint: ${issues[0]!.path}: ${issues[0]!.message}`,
    );
  }
}

export const CONSTRUCTION_PLAN_FOOTPRINT_KINDS: readonly ConstructionPlanKind[] = [
  'primitive',
  'rectangle-by-opposite-corners',
  'midpoint',
  'perpendicular-foot',
  'point-on-circle',
  'parallel-line',
  'perpendicular-line',
  'perpendicular-bisector',
  'angle-bisector',
  'circumcircle',
  'nine-point-circle',
  'simson-line',
  'fermat-point',
  'tangent-at-point',
  'reflect-point',
  'reflect-line',
  'rotate-90',
  'homothety-2',
  'inversion-point',
  'radical-axis',
  'cyclic-quadrilateral',
  'complete-quadrilateral',
];
