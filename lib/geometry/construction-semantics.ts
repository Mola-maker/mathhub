/**
 * Renderer-neutral semantic recovery from an explicit construction topology.
 *
 * Source adapters remain responsible for lossless parsing and entity identity.
 * This module only consumes named construction facts that both TikZ and
 * GeoGebra can prove from their source graphs; it never inspects coordinates.
 */

export type ConstructionPointDefinition =
  | {
    readonly kind: 'midpoint';
    readonly startName: string;
    readonly endName: string;
  }
  | {
    readonly kind: 'perpendicular-foot';
    readonly pointName: string;
    readonly lineStartName: string;
    readonly lineEndName: string;
  }
  | {
    readonly kind: 'rotate';
    readonly centerName: string;
    readonly pointName: string;
    readonly scale: number;
    readonly angleDegrees: number;
  }
  | {
    readonly kind: 'translate';
    readonly pointName: string;
    readonly fromName: string;
    readonly toName: string;
  };

export interface ConstructionTopologyPoint {
  readonly id: string;
  readonly name: string;
  readonly definition?: ConstructionPointDefinition;
  /** Real semantic curve IDs that the source proves contain this point. */
  readonly incidentEntityIds?: readonly string[];
  readonly sourceBindingIds?: readonly string[];
}

export interface ConstructionTopologySegment {
  readonly id: string;
  readonly endpointNames: readonly [string, string];
  readonly sourceBindingIds?: readonly string[];
}

export interface ConstructionTopologyCircle {
  readonly id: string;
  /** Absent for centerless source forms such as a three-point circle. */
  readonly centerName?: string;
  readonly throughName?: string;
  /** Source-declared members, including overloads without an explicit center. */
  readonly memberNames?: readonly string[];
  readonly sourceBindingIds?: readonly string[];
}

export interface ConstructionSemanticTopology {
  readonly points: readonly ConstructionTopologyPoint[];
  readonly segments: readonly ConstructionTopologySegment[];
  readonly circles: readonly ConstructionTopologyCircle[];
}

export interface InferredConstructionSemanticArgument {
  readonly role: string;
  readonly entityId: string;
}

export interface InferredConstructionSemanticConstraint {
  readonly kind:
    | 'tangent'
    | 'parallel'
    | 'circumcenter'
    | 'orthocenter'
    | 'point-on-circle'
    | 'concyclic';
  readonly arguments: readonly InferredConstructionSemanticArgument[];
  readonly semanticKey: string;
  readonly sourceBindingIds: readonly string[];
  readonly evidenceEntityIds: readonly string[];
  readonly evidenceKinds: readonly string[];
}

interface TriangleCenterEvidence {
  readonly kind: 'circumcenter' | 'orthocenter';
  readonly center: ConstructionTopologyPoint;
  readonly vertexNames: readonly [string, string, string];
  readonly sourceBindingIds: readonly string[];
  readonly evidenceEntityIds: readonly string[];
  readonly evidenceKind: string;
}

interface PerpendicularBisectorEvidence {
  readonly segment: ConstructionTopologySegment;
  readonly sideNames: readonly [string, string];
  readonly sourceBindingIds: readonly string[];
  readonly evidenceEntityIds: readonly string[];
}

interface AltitudeEvidence {
  readonly segment: ConstructionTopologySegment;
  readonly apexName: string;
  readonly triangleNames: readonly [string, string, string];
  readonly sourceBindingIds: readonly string[];
  readonly evidenceEntityIds: readonly string[];
}

const EPSILON = 1e-9;
const SYMMETRIC_KINDS = new Set(['tangent', 'parallel', 'concyclic']);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function bindingsOf(
  ...records: Array<{ readonly sourceBindingIds?: readonly string[] } | undefined>
): string[] {
  return unique(records.flatMap((record) => record?.sourceBindingIds ?? []));
}

function sortedPair(left: string, right: string): readonly [string, string] {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
}

function sortedTriple(values: readonly string[]): readonly [string, string, string] | null {
  const result = unique(values);
  return result.length === 3
    ? [result[0]!, result[1]!, result[2]!]
    : null;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isQuarterTurn(angleDegrees: number): boolean {
  const normalized = ((angleDegrees % 180) + 180) % 180;
  return Math.abs(normalized - 90) <= EPSILON;
}

function semanticKey(
  kind: InferredConstructionSemanticConstraint['kind'],
  arguments_: readonly InferredConstructionSemanticArgument[],
): string {
  const ids = arguments_.map((argument) => argument.entityId);
  if (SYMMETRIC_KINDS.has(kind)) ids.sort((left, right) => left.localeCompare(right));
  return `${kind}:${ids.join('\u0000')}`;
}

function perpendicularBisectorEvidence(
  segment: ConstructionTopologySegment,
  pointsByName: ReadonlyMap<string, ConstructionTopologyPoint>,
): PerpendicularBisectorEvidence | null {
  for (const [midpointName, directionName] of [
    [segment.endpointNames[0], segment.endpointNames[1]],
    [segment.endpointNames[1], segment.endpointNames[0]],
  ] as const) {
    const midpoint = pointsByName.get(midpointName);
    const direction = pointsByName.get(directionName);
    const midpointDefinition = midpoint?.definition;
    const rotation = direction?.definition;
    if (
      midpointDefinition?.kind !== 'midpoint'
      || rotation?.kind !== 'rotate'
      || rotation.centerName !== midpointName
      || Math.abs(rotation.scale) <= EPSILON
      || !isQuarterTurn(rotation.angleDegrees)
    ) continue;
    const sideNames = sortedPair(
      midpointDefinition.startName,
      midpointDefinition.endName,
    );
    if (!sideNames.includes(rotation.pointName)) continue;
    return {
      segment,
      sideNames,
      sourceBindingIds: bindingsOf(segment, midpoint, direction),
      evidenceEntityIds: unique([segment.id, midpoint!.id, direction!.id]),
    };
  }
  return null;
}

function altitudeEvidence(
  segment: ConstructionTopologySegment,
  pointsByName: ReadonlyMap<string, ConstructionTopologyPoint>,
): AltitudeEvidence | null {
  for (const [apexName, footName] of [
    [segment.endpointNames[0], segment.endpointNames[1]],
    [segment.endpointNames[1], segment.endpointNames[0]],
  ] as const) {
    const apex = pointsByName.get(apexName);
    const foot = pointsByName.get(footName);
    const definition = foot?.definition;
    if (
      !apex
      || definition?.kind !== 'perpendicular-foot'
      || definition.pointName !== apexName
    ) continue;
    const triangleNames = sortedTriple([
      apexName,
      definition.lineStartName,
      definition.lineEndName,
    ]);
    if (!triangleNames) continue;
    return {
      segment,
      apexName,
      triangleNames,
      sourceBindingIds: bindingsOf(segment, apex, foot),
      evidenceEntityIds: unique([segment.id, apex.id, foot.id]),
    };
  }
  return null;
}

function triangleCenterEvidence(
  topology: ConstructionSemanticTopology,
  pointsByName: ReadonlyMap<string, ConstructionTopologyPoint>,
  segmentsById: ReadonlyMap<string, ConstructionTopologySegment>,
): TriangleCenterEvidence[] {
  const result: TriangleCenterEvidence[] = [];
  for (const center of topology.points) {
    const incidentSegments = unique(center.incidentEntityIds ?? [])
      .flatMap((id) => segmentsById.get(id) ?? []);
    const bisectors = incidentSegments.flatMap((segment) => {
      const evidence = perpendicularBisectorEvidence(segment, pointsByName);
      return evidence ? [evidence] : [];
    });
    for (let left = 0; left < bisectors.length; left += 1) {
      for (let right = left + 1; right < bisectors.length; right += 1) {
        const first = bisectors[left]!;
        const second = bisectors[right]!;
        const vertexNames = sortedTriple([...first.sideNames, ...second.sideNames]);
        if (!vertexNames || sameNames(first.sideNames, second.sideNames)) continue;
        result.push({
          kind: 'circumcenter',
          center,
          vertexNames,
          sourceBindingIds: unique([
            ...bindingsOf(center),
            ...first.sourceBindingIds,
            ...second.sourceBindingIds,
          ]),
          evidenceEntityIds: unique([
            center.id,
            ...first.evidenceEntityIds,
            ...second.evidenceEntityIds,
          ]),
          evidenceKind: 'perpendicular-bisector-intersection',
        });
      }
    }

    const altitudes = incidentSegments.flatMap((segment) => {
      const evidence = altitudeEvidence(segment, pointsByName);
      return evidence ? [evidence] : [];
    });
    for (let left = 0; left < altitudes.length; left += 1) {
      for (let right = left + 1; right < altitudes.length; right += 1) {
        const first = altitudes[left]!;
        const second = altitudes[right]!;
        if (
          first.apexName === second.apexName
          || !sameNames(first.triangleNames, second.triangleNames)
        ) continue;
        result.push({
          kind: 'orthocenter',
          center,
          vertexNames: first.triangleNames,
          sourceBindingIds: unique([
            ...bindingsOf(center),
            ...first.sourceBindingIds,
            ...second.sourceBindingIds,
          ]),
          evidenceEntityIds: unique([
            center.id,
            ...first.evidenceEntityIds,
            ...second.evidenceEntityIds,
          ]),
          evidenceKind: 'altitude-intersection',
        });
      }
    }
  }
  return result;
}

export function inferConstructionSemanticConstraints(
  topology: ConstructionSemanticTopology,
): InferredConstructionSemanticConstraint[] {
  const pointsByName = new Map(topology.points.map((point) => [point.name, point] as const));
  const segmentsById = new Map(topology.segments.map((segment) => [segment.id, segment] as const));
  const circlesById = new Map(topology.circles.map((circle) => [circle.id, circle] as const));
  const segmentsByEndpoints = new Map<string, ConstructionTopologySegment[]>();
  for (const segment of topology.segments) {
    const key = sortedPair(...segment.endpointNames).join('\u0000');
    segmentsByEndpoints.set(key, [...(segmentsByEndpoints.get(key) ?? []), segment]);
  }

  const facts = new Map<string, InferredConstructionSemanticConstraint>();
  const addFact = (input: Omit<InferredConstructionSemanticConstraint, 'semanticKey'>): void => {
    const key = semanticKey(input.kind, input.arguments);
    const previous = facts.get(key);
    facts.set(key, previous
      ? {
          ...previous,
          sourceBindingIds: unique([...previous.sourceBindingIds, ...input.sourceBindingIds]),
          evidenceEntityIds: unique([...previous.evidenceEntityIds, ...input.evidenceEntityIds]),
          evidenceKinds: unique([...previous.evidenceKinds, ...input.evidenceKinds]),
        }
      : { ...input, semanticKey: key });
  };

  const centerEvidence = triangleCenterEvidence(topology, pointsByName, segmentsById);
  for (const evidence of centerEvidence) {
    const vertexIds = evidence.vertexNames.map((name) => pointsByName.get(name)?.id);
    if (vertexIds.some((id) => !id)) continue;
    addFact({
      kind: evidence.kind,
      arguments: [
        { role: 'center', entityId: evidence.center.id },
        ...(vertexIds as string[]).map((entityId, index) => ({
          role: `vertex-${index + 1}`,
          entityId,
        })),
      ],
      sourceBindingIds: evidence.sourceBindingIds,
      evidenceEntityIds: evidence.evidenceEntityIds,
      evidenceKinds: [evidence.evidenceKind],
    });
  }

  const membership = new Map<string, Map<string, string[]>>();
  const addMembership = (
    circle: ConstructionTopologyCircle,
    pointName: string,
    sourceBindingIds: readonly string[],
  ): boolean => {
    if (!pointsByName.has(pointName)) return false;
    const byPoint = membership.get(circle.id) ?? new Map<string, string[]>();
    const previous = byPoint.get(pointName);
    byPoint.set(pointName, unique([...(previous ?? []), ...sourceBindingIds]));
    membership.set(circle.id, byPoint);
    return previous === undefined;
  };

  for (const circle of topology.circles) {
    const declaredMembers = unique([
      ...(circle.memberNames ?? []),
      ...(circle.throughName ? [circle.throughName] : []),
    ]);
    for (const pointName of declaredMembers) {
      addMembership(circle, pointName, bindingsOf(circle, pointsByName.get(pointName)));
    }
  }
  for (const point of topology.points) {
    for (const entityId of unique(point.incidentEntityIds ?? [])) {
      const circle = circlesById.get(entityId);
      if (circle) addMembership(circle, point.name, bindingsOf(point, circle));
    }
  }
  for (const evidence of centerEvidence.filter((item) => item.kind === 'circumcenter')) {
    for (const circle of topology.circles) {
      if (
        circle.centerName !== evidence.center.name
        || !circle.throughName
        || !evidence.vertexNames.includes(circle.throughName)
      ) continue;
      for (const vertexName of evidence.vertexNames) {
        addMembership(circle, vertexName, unique([
          ...evidence.sourceBindingIds,
          ...bindingsOf(circle, pointsByName.get(vertexName)),
        ]));
      }
    }
  }

  let membershipChanged = true;
  while (membershipChanged) {
    membershipChanged = false;
    for (const point of topology.points) {
      const rotation = point.definition;
      if (
        rotation?.kind !== 'rotate'
        || Math.abs(Math.abs(rotation.scale) - 1) > EPSILON
      ) continue;
      for (const circle of topology.circles) {
        if (
          circle.centerName !== rotation.centerName
          || !membership.get(circle.id)?.has(rotation.pointName)
        ) continue;
        membershipChanged = addMembership(circle, point.name, bindingsOf(
          point,
          pointsByName.get(rotation.pointName),
          circle,
        )) || membershipChanged;
      }
    }
  }

  for (const segment of topology.segments) {
    for (const [touchName, directionName] of [
      [segment.endpointNames[0], segment.endpointNames[1]],
      [segment.endpointNames[1], segment.endpointNames[0]],
    ] as const) {
      const touch = pointsByName.get(touchName);
      const direction = pointsByName.get(directionName);
      const rotation = direction?.definition;
      if (
        !touch
        || rotation?.kind !== 'rotate'
        || rotation.centerName !== touchName
        || Math.abs(rotation.scale) <= EPSILON
        || !isQuarterTurn(rotation.angleDegrees)
      ) continue;
      const circles = topology.circles.filter((circle) => (
        circle.centerName === rotation.pointName
        && membership.get(circle.id)?.has(touchName)
      ));
      if (circles.length !== 1) continue;
      const circle = circles[0]!;
      addFact({
        kind: 'tangent',
        arguments: [
          { role: 'line', entityId: segment.id },
          { role: 'touch-point', entityId: touch.id },
          { role: 'circle', entityId: circle.id },
        ],
        sourceBindingIds: bindingsOf(segment, touch, direction, circle),
        evidenceEntityIds: unique([segment.id, touch.id, direction.id, circle.id]),
        evidenceKinds: ['quarter-turn-radius'],
      });
    }

    for (const [throughName, translatedName] of [
      [segment.endpointNames[0], segment.endpointNames[1]],
      [segment.endpointNames[1], segment.endpointNames[0]],
    ] as const) {
      const translated = pointsByName.get(translatedName);
      const definition = translated?.definition;
      if (definition?.kind !== 'translate' || definition.toName !== throughName) continue;
      const referenceKey = sortedPair(definition.fromName, definition.pointName).join('\u0000');
      const references = (segmentsByEndpoints.get(referenceKey) ?? [])
        .filter((candidate) => candidate.id !== segment.id);
      if (references.length !== 1) continue;
      const reference = references[0]!;
      addFact({
        kind: 'parallel',
        arguments: [
          { role: 'line', entityId: segment.id },
          { role: 'reference', entityId: reference.id },
        ],
        sourceBindingIds: bindingsOf(segment, translated, reference),
        evidenceEntityIds: unique([segment.id, translated.id, reference.id]),
        evidenceKinds: ['vector-translation'],
      });
    }
  }

  for (const circle of topology.circles) {
    const byPoint = membership.get(circle.id) ?? new Map<string, string[]>();
    const pointNames = [...byPoint.keys()].sort((left, right) => left.localeCompare(right));
    for (const pointName of pointNames) {
      const point = pointsByName.get(pointName)!;
      addFact({
        kind: 'point-on-circle',
        arguments: [
          { role: 'point', entityId: point.id },
          { role: 'circle', entityId: circle.id },
        ],
        sourceBindingIds: unique([
          ...(byPoint.get(pointName) ?? []),
          ...bindingsOf(point, circle),
        ]),
        evidenceEntityIds: unique([point.id, circle.id]),
        evidenceKinds: ['circle-membership'],
      });
    }
    if (pointNames.length < 4) continue;
    const points = pointNames.map((name) => pointsByName.get(name)!);
    addFact({
      kind: 'concyclic',
      arguments: points.map((point, index) => ({
        role: `point-${index + 1}`,
        entityId: point.id,
      })),
      sourceBindingIds: unique([
        ...bindingsOf(circle),
        ...pointNames.flatMap((name) => byPoint.get(name) ?? []),
      ]),
      evidenceEntityIds: unique([circle.id, ...points.map((point) => point.id)]),
      evidenceKinds: ['shared-circle-membership'],
    });
  }

  return [...facts.values()].sort((left, right) => (
    left.semanticKey.localeCompare(right.semanticKey)
  ));
}
