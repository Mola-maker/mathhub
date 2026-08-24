import type { GeometryDoc } from '../ir/geometry-doc';
import type {
  GeometryConstraint,
  GeometryEntity,
  GeometryRelation,
  GeometryRevisionBasis,
} from '../ir/model';

export const GEOMETRY_PROOF_STATE_SCHEMA_VERSION =
  'geometry-proof-state/v1' as const;

export const GEOMETRY_PROOF_CLAIM_KINDS = [
  'coincident',
  'collinear',
  'parallel',
  'perpendicular',
  'equal-distance',
  'midpoint',
  'concyclic',
] as const;

export type GeometryProofClaimKind = typeof GEOMETRY_PROOF_CLAIM_KINDS[number];

export interface GeometryProofClaimInput {
  readonly claimId: string;
  readonly kind: GeometryProofClaimKind;
  /** Resolved semantic point IDs. Repetition is meaningful for line pairs. */
  readonly entityIds: readonly string[];
  readonly tolerance?: number;
}

export interface GeometryProofFact {
  readonly evidenceId: string;
  readonly recordType: 'constraint' | 'relation' | 'definition';
  readonly kind: string;
  readonly entityIds: readonly string[];
  readonly roles: readonly string[];
  readonly strength?: GeometryConstraint['strength'];
}

export type GeometryProofObligationStatus =
  | 'formally-proven'
  | 'numerically-satisfied'
  | 'counterexample'
  | 'unresolved'
  | 'inconsistent';

export interface GeometryProofObligation {
  readonly claimId: string;
  readonly kind: GeometryProofClaimKind;
  readonly entityIds: readonly string[];
  readonly status: GeometryProofObligationStatus;
  readonly evidenceIds: readonly string[];
  readonly tolerance: number;
  readonly residual?: number;
  readonly method?: string;
  readonly numericMethod?: string;
  readonly diagnostic?: string;
}

export const GEOMETRY_PROOF_DEDUCTION_RULES = [
  'direct-required-constraint',
  'direct-source-definition',
  'shared-required-on-circle',
  'midpoint-implies-collinear',
  'perpendicular-foot-implies-perpendicular',
  'circle-definition-implies-equal-distance',
  'point-on-circle-implies-equal-distance',
] as const;

export type GeometryProofDeductionRule =
  typeof GEOMETRY_PROOF_DEDUCTION_RULES[number];

export interface GeometryProofDeduction {
  readonly deductionId: string;
  readonly rule: GeometryProofDeductionRule;
  readonly premiseEvidenceIds: readonly string[];
  readonly conclusionClaimId: string;
  readonly status: 'validated' | 'semantic-numeric-conflict';
}

export interface GeometryProofAuxiliaryCandidate {
  readonly toolId: string;
  readonly currentInputReady: boolean;
  readonly inputKinds: readonly string[];
  readonly outputKeys: readonly string[];
}

export interface GeometryProofState {
  readonly schemaVersion: typeof GEOMETRY_PROOF_STATE_SCHEMA_VERSION;
  readonly basis: Pick<
    GeometryRevisionBasis,
    | 'documentId'
    | 'epoch'
    | 'revision'
    | 'sourceId'
    | 'sourceHash'
    | 'kernelHash'
    | 'projectionHash'
    | 'pluginSetDigest'
  >;
  readonly focusEntityIds: readonly string[];
  readonly facts: readonly GeometryProofFact[];
  readonly obligations: readonly GeometryProofObligation[];
  readonly deductions: readonly GeometryProofDeduction[];
  readonly auxiliaryCandidates: readonly GeometryProofAuxiliaryCandidate[];
  readonly completion: 'formal-proof-complete' | 'open' | 'contradicted';
  readonly semanticStatus: GeometryDoc['semantic']['status'];
  readonly truncated: boolean;
}

export interface GeometryProofCandidateTool {
  readonly toolId: string;
  readonly currentInputReady: boolean;
  readonly inputKinds: readonly string[];
  readonly outputSlots: readonly { readonly key: string }[];
}

export interface GeometryProofStateOptions {
  readonly allowedEntityIds: readonly string[];
  readonly focusEntityIds?: readonly string[];
  readonly claims: readonly GeometryProofClaimInput[];
  readonly candidateTools?: readonly GeometryProofCandidateTool[];
  readonly maxFacts?: number;
  readonly maxCandidates?: number;
}

interface PointPosition {
  readonly x: number;
  readonly y: number;
}

interface NumericClaimResult {
  readonly residual: number;
  readonly method: string;
}

interface FormalClaimEvidence {
  readonly evidenceIds: readonly string[];
  readonly rule: GeometryProofDeductionRule;
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function tolerance(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1e-12, Math.min(1e-2, Math.abs(value)))
    : 1e-7;
}

function validClaimArity(kind: GeometryProofClaimKind, count: number): boolean {
  if (kind === 'coincident') return count >= 2;
  if (kind === 'collinear' || kind === 'equal-distance') return count >= 3;
  if (kind === 'concyclic') return count >= 4;
  if (kind === 'parallel' || kind === 'perpendicular') return count === 4;
  return count === 3;
}

function entityIdsOfConstraint(constraint: GeometryConstraint): string[] {
  return constraint.arguments.flatMap((argument) => (
    argument.entityId ? [argument.entityId] : []
  ));
}

function entityIdsOfRelation(relation: GeometryRelation): string[] {
  return relation.participants.flatMap((participant) => (
    participant.entityId ? [participant.entityId] : []
  ));
}

function factFromConstraint(constraint: GeometryConstraint): GeometryProofFact {
  return {
    evidenceId: constraint.id,
    recordType: 'constraint',
    kind: constraint.kind,
    entityIds: entityIdsOfConstraint(constraint),
    roles: constraint.arguments.map((argument) => argument.role),
    ...(constraint.strength ? { strength: constraint.strength } : {}),
  };
}

function factFromRelation(relation: GeometryRelation): GeometryProofFact {
  return {
    evidenceId: relation.id,
    recordType: 'relation',
    kind: relation.kind,
    entityIds: entityIdsOfRelation(relation),
    roles: relation.participants.map((participant) => participant.role),
  };
}

function factFromEntityDefinition(entity: GeometryEntity): GeometryProofFact | null {
  const definition = entity.definition;
  if (!definition || definition.kind !== 'operation') return null;
  const argumentIds = definition.arguments.flatMap((argument) => (
    argument.kind === 'entity-reference' ? [argument.entityId] : []
  ));
  if (argumentIds.length !== definition.arguments.length) return null;
  const roles = definition.operator === 'midpoint' || definition.operator === 'interpolate'
    ? ['result', 'segment-start', 'segment-end']
    : definition.operator === 'perpendicular-foot'
      ? ['result', 'point', 'reference-start', 'reference-end']
      : ['result', ...argumentIds.map((_, index) => `argument-${index + 1}`)];
  return {
    evidenceId: `definition:${entity.id}`,
    recordType: 'definition',
    kind: definition.operator,
    entityIds: [entity.id, ...argumentIds],
    roles,
    strength: 'required',
  };
}

function sameEntityMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entityId, index) => entityId === sortedRight[index]);
}

function factEntityForRole(fact: GeometryProofFact, role: string): string | undefined {
  const index = fact.roles.indexOf(role);
  return index < 0 ? undefined : fact.entityIds[index];
}

function sameUndirectedSegment(
  left: readonly [string, string],
  right: readonly [string, string],
): boolean {
  return (left[0] === right[0] && left[1] === right[1])
    || (left[0] === right[1] && left[1] === right[0]);
}

function sameLinePair(
  claim: readonly string[],
  first: readonly [string, string],
  second: readonly [string, string],
): boolean {
  if (claim.length !== 4) return false;
  const claimFirst: [string, string] = [claim[0]!, claim[1]!];
  const claimSecond: [string, string] = [claim[2]!, claim[3]!];
  return (
    sameUndirectedSegment(claimFirst, first)
    && sameUndirectedSegment(claimSecond, second)
  ) || (
    sameUndirectedSegment(claimFirst, second)
    && sameUndirectedSegment(claimSecond, first)
  );
}

function pointPosition(entity: GeometryEntity | undefined): PointPosition | null {
  const x = entity?.parameters?.x;
  const y = entity?.parameters?.y;
  return entity?.kind === 'point'
    && typeof x === 'number'
    && Number.isFinite(x)
    && typeof y === 'number'
    && Number.isFinite(y)
    ? { x, y }
    : null;
}

function distance(left: PointPosition, right: PointPosition): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function normalizedScale(points: readonly PointPosition[]): number {
  if (points.length < 2) return 1;
  const first = points[0]!;
  return Math.max(1, ...points.slice(1).map((point) => distance(first, point)));
}

function circleThrough(
  a: PointPosition,
  b: PointPosition,
  c: PointPosition,
): { center: PointPosition; radius: number } | null {
  const denominator = 2 * (
    a.x * (b.y - c.y)
    + b.x * (c.y - a.y)
    + c.x * (a.y - b.y)
  );
  if (Math.abs(denominator) <= 1e-14) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const center = {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y))
      / denominator,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x))
      / denominator,
  };
  const radius = distance(center, a);
  return Number.isFinite(radius) && radius > 0 ? { center, radius } : null;
}

function evaluateNumericClaim(
  kind: GeometryProofClaimKind,
  points: readonly PointPosition[],
): NumericClaimResult | null {
  if (kind === 'coincident' && points.length >= 2) {
    const scale = normalizedScale(points);
    return {
      residual: Math.max(...points.slice(1).map((point) => distance(points[0]!, point))) / scale,
      method: 'normalized-point-spread',
    };
  }
  if (kind === 'collinear' && points.length >= 3) {
    const [a, b] = points;
    if (distance(a!, b!) <= 1e-14) return null;
    const scale = normalizedScale(points);
    return {
      residual: Math.max(...points.slice(2).map((point) => Math.abs(
        (b!.x - a!.x) * (point.y - a!.y)
        - (b!.y - a!.y) * (point.x - a!.x),
      ))) / (scale * scale),
      method: 'normalized-cross-product',
    };
  }
  if ((kind === 'parallel' || kind === 'perpendicular') && points.length === 4) {
    const [a, b, c, d] = points;
    const firstLength = distance(a!, b!);
    const secondLength = distance(c!, d!);
    if (firstLength === 0 || secondLength === 0) return null;
    const numerator = kind === 'parallel'
      ? Math.abs(
        (b!.x - a!.x) * (d!.y - c!.y)
        - (b!.y - a!.y) * (d!.x - c!.x),
      )
      : Math.abs(
        (b!.x - a!.x) * (d!.x - c!.x)
        + (b!.y - a!.y) * (d!.y - c!.y),
      );
    return {
      residual: numerator / (firstLength * secondLength),
      method: kind === 'parallel'
        ? 'normalized-cross-product'
        : 'normalized-dot-product',
    };
  }
  if (kind === 'equal-distance' && points.length >= 3) {
    const [center, ...targets] = points;
    const distances = targets.map((point) => distance(center!, point));
    const scale = Math.max(1, ...distances);
    return {
      residual: (Math.max(...distances) - Math.min(...distances)) / scale,
      method: 'normalized-radius-spread',
    };
  }
  if (kind === 'midpoint' && points.length === 3) {
    const [midpoint, a, b] = points;
    const expected = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    return {
      residual: distance(midpoint!, expected) / Math.max(1, distance(a!, b!)),
      method: 'normalized-midpoint-residual',
    };
  }
  if (kind === 'concyclic' && points.length >= 4) {
    const circle = circleThrough(points[0]!, points[1]!, points[2]!);
    if (!circle) return null;
    return {
      residual: Math.max(...points.slice(3).map((point) => Math.abs(
        distance(circle.center, point) - circle.radius,
      ))) / Math.max(1, circle.radius),
      method: 'normalized-circumcircle-residual',
    };
  }
  return null;
}

function formalEvidence(
  claim: GeometryProofClaimInput,
  entitiesById: ReadonlyMap<string, GeometryEntity>,
  facts: readonly GeometryProofFact[],
): FormalClaimEvidence | null {
  const exactConstraints = facts.filter((fact) => (
    fact.recordType === 'constraint'
    && fact.strength === 'required'
    && fact.kind === claim.kind
    && sameEntityMultiset(fact.entityIds, claim.entityIds)
  ));
  if (exactConstraints.length > 0) {
    return {
      evidenceIds: exactConstraints.map((fact) => fact.evidenceId).sort(),
      rule: 'direct-required-constraint',
    };
  }
  const exactDefinitions = facts.filter((fact) => (
    fact.recordType === 'definition'
    && fact.strength === 'required'
    && fact.kind === claim.kind
    && sameEntityMultiset(fact.entityIds, claim.entityIds)
  ));
  if (exactDefinitions.length > 0) {
    return {
      evidenceIds: exactDefinitions.map((fact) => fact.evidenceId).sort(),
      rule: 'direct-source-definition',
    };
  }

  if (claim.kind === 'collinear') {
    const midpoint = facts.find((fact) => (
      (fact.recordType === 'constraint' || fact.recordType === 'definition')
      && fact.strength === 'required'
      && fact.kind === 'midpoint'
      && sameEntityMultiset(fact.entityIds, claim.entityIds)
    ));
    if (midpoint) {
      return {
        evidenceIds: [midpoint.evidenceId],
        rule: 'midpoint-implies-collinear',
      };
    }
  }

  if (claim.kind === 'perpendicular') {
    const foot = facts.find((fact) => {
      if (
        (fact.recordType !== 'constraint' && fact.recordType !== 'definition')
        || fact.strength !== 'required'
        || fact.kind !== 'perpendicular-foot'
      ) return false;
      const projectedPoint = factEntityForRole(fact, 'point');
      const result = factEntityForRole(fact, 'result');
      const referenceStart = factEntityForRole(fact, 'reference-start');
      const referenceEnd = factEntityForRole(fact, 'reference-end');
      if (!projectedPoint || !result || !referenceStart || !referenceEnd) return false;
      const projectedPosition = pointPosition(entitiesById.get(projectedPoint));
      const resultPosition = pointPosition(entitiesById.get(result));
      const referenceStartPosition = pointPosition(entitiesById.get(referenceStart));
      const referenceEndPosition = pointPosition(entitiesById.get(referenceEnd));
      return Boolean(
        projectedPosition
        && resultPosition
        && referenceStartPosition
        && referenceEndPosition
        && distance(projectedPosition, resultPosition) > 1e-14
        && distance(referenceStartPosition, referenceEndPosition) > 1e-14
        && sameLinePair(
          claim.entityIds,
          [projectedPoint, result],
          [referenceStart, referenceEnd],
        )
      );
    });
    if (foot) {
      return {
        evidenceIds: [foot.evidenceId],
        rule: 'perpendicular-foot-implies-perpendicular',
      };
    }
  }

  if (claim.kind === 'equal-distance') {
    const [claimedCenter, ...claimedTargets] = claim.entityIds;
    const circleDefinitions = facts.filter((fact) => (
      fact.recordType === 'constraint'
      && fact.strength === 'required'
      && fact.kind === 'circle-through-three-points'
      && factEntityForRole(fact, 'center') === claimedCenter
    ));
    for (const definition of circleDefinitions) {
      const circleId = factEntityForRole(definition, 'circle');
      const definedPoints = definition.roles.flatMap((role, index) => (
        role.startsWith('point-') ? [definition.entityIds[index]!] : []
      ));
      if (claimedTargets.every((entityId) => definedPoints.includes(entityId))) {
        return {
          evidenceIds: [definition.evidenceId],
          rule: 'circle-definition-implies-equal-distance',
        };
      }
      if (circleId) {
        const onCircleWitnesses = claimedTargets.map((pointId) => facts.find((fact) => (
          fact.recordType === 'constraint'
          && fact.strength === 'required'
          && fact.kind === 'on-circle'
          && fact.entityIds.includes(pointId)
          && fact.entityIds.includes(circleId)
        )));
        if (onCircleWitnesses.every((fact) => fact !== undefined)) {
          return {
            evidenceIds: [
              definition.evidenceId,
              ...new Set(onCircleWitnesses.map((fact) => fact!.evidenceId)),
            ].sort(),
            rule: 'circle-definition-implies-equal-distance',
          };
        }
      }
    }
    const pointOnCircle = facts.find((fact) => (
      fact.recordType === 'constraint'
      && fact.strength === 'required'
      && fact.kind === 'point-on-circle'
      && factEntityForRole(fact, 'center') === claimedCenter
      && claimedTargets.every((entityId) => fact.entityIds.includes(entityId))
    ));
    if (pointOnCircle) {
      return {
        evidenceIds: [pointOnCircle.evidenceId],
        rule: 'point-on-circle-implies-equal-distance',
      };
    }
  }

  // A shared required on-circle relation is the semantic form produced by
  // managed circle constructions.  Treat it as a formal concyclicity witness
  // only when every claimed point is attached to the same in-scope circle.
  if (claim.kind === 'concyclic') {
    const onCircle = facts.filter((fact) => (
      fact.recordType === 'constraint'
      && fact.strength === 'required'
      && fact.kind === 'on-circle'
    ));
    const circleIds = new Set(onCircle.flatMap((fact) => fact.entityIds.filter((entityId) => (
      entitiesById.get(entityId)?.kind === 'circle'
    ))));
    for (const circleId of [...circleIds].sort()) {
      const witnesses = claim.entityIds.map((pointId) => onCircle.find((fact) => (
        fact.entityIds.includes(pointId) && fact.entityIds.includes(circleId)
      )));
      if (witnesses.every((fact) => fact !== undefined)) {
        return {
          evidenceIds: [...new Set(witnesses.map((fact) => fact!.evidenceId))].sort(),
          rule: 'shared-required-on-circle',
        };
      }
    }
  }
  return null;
}

function obligation(
  claim: GeometryProofClaimInput,
  entitiesById: ReadonlyMap<string, GeometryEntity>,
  facts: readonly GeometryProofFact[],
): GeometryProofObligation {
  const claimTolerance = tolerance(claim.tolerance);
  const evidence = formalEvidence(claim, entitiesById, facts);
  const evidenceIds = evidence?.evidenceIds ?? [];
  const points = claim.entityIds.map((entityId) => pointPosition(entitiesById.get(entityId)));
  if (points.some((point) => point === null)) {
    return {
      claimId: claim.claimId,
      kind: claim.kind,
      entityIds: claim.entityIds,
      status: evidenceIds.length > 0 ? 'formally-proven' : 'unresolved',
      evidenceIds,
      tolerance: claimTolerance,
      ...(evidence ? { method: evidence.rule } : {}),
      ...(evidenceIds.length === 0
        ? { diagnostic: 'Claim requires finite point entities or matching semantic evidence.' }
        : {}),
    };
  }
  const numeric = evaluateNumericClaim(claim.kind, points as PointPosition[]);
  if (!numeric) {
    return {
      claimId: claim.claimId,
      kind: claim.kind,
      entityIds: claim.entityIds,
      status: evidenceIds.length > 0 ? 'formally-proven' : 'unresolved',
      evidenceIds,
      tolerance: claimTolerance,
      ...(evidence ? { method: evidence.rule } : {}),
      ...(evidenceIds.length === 0
        ? { diagnostic: 'Claim is outside the bounded numeric verifier.' }
        : {}),
    };
  }
  const numericallySatisfied = numeric.residual <= claimTolerance;
  return {
    claimId: claim.claimId,
    kind: claim.kind,
    entityIds: claim.entityIds,
    status: evidenceIds.length > 0
      ? numericallySatisfied ? 'formally-proven' : 'inconsistent'
      : numericallySatisfied ? 'numerically-satisfied' : 'counterexample',
    evidenceIds,
    tolerance: claimTolerance,
    residual: numeric.residual,
    method: evidence?.rule ?? numeric.method,
    numericMethod: numeric.method,
    ...(evidenceIds.length > 0 && !numericallySatisfied
      ? { diagnostic: 'Semantic evidence and evaluated geometry disagree.' }
      : {}),
  };
}

/**
 * Build one bounded proof-state observation from a current immutable GeometryDoc.
 * Numeric satisfaction is deliberately not upgraded to a formal proof.
 */
export function buildGeometryProofState(
  geometryDoc: GeometryDoc,
  options: GeometryProofStateOptions,
): GeometryProofState {
  if (options.claims.length === 0 || options.claims.length > 16) {
    throw new TypeError('GeometryProofState requires between one and sixteen claims.');
  }
  const allowed = new Set(options.allowedEntityIds);
  const entitiesById = new Map(geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity]));
  const claimIds = new Set<string>();
  for (const claim of options.claims) {
    if (
      claim.claimId.length === 0
      || claimIds.has(claim.claimId)
      || !validClaimArity(claim.kind, claim.entityIds.length)
      || claim.entityIds.some((entityId) => (
        !allowed.has(entityId)
        || entitiesById.get(entityId)?.kind !== 'point'
      ))
    ) {
      throw new TypeError('GeometryProofState claim is outside the current semantic scope.');
    }
    claimIds.add(claim.claimId);
  }
  const maxFacts = boundedLimit(options.maxFacts, 160, 512);
  const completeFacts = [
    ...geometryDoc.semantic.ir.entities.flatMap((entity) => {
      const fact = factFromEntityDefinition(entity);
      return fact ? [fact] : [];
    }),
    ...geometryDoc.semantic.ir.constraints
      .filter((constraint) => constraint.enabled !== false)
      .map(factFromConstraint),
    ...geometryDoc.semantic.ir.relations.map(factFromRelation),
  ].filter((fact) => (
    fact.entityIds.length > 0
    && fact.entityIds.every((entityId) => allowed.has(entityId))
  ));
  const facts = completeFacts.slice(0, maxFacts);
  const obligations = options.claims.map((claim) => (
    obligation(claim, entitiesById, completeFacts)
  ));
  const deductions: GeometryProofDeduction[] = obligations.flatMap((item) => (
    item.evidenceIds.length > 0 && item.method
      ? [{
        deductionId: `deduction:${item.claimId}:${item.method}`,
        rule: item.method as GeometryProofDeductionRule,
        premiseEvidenceIds: item.evidenceIds,
        conclusionClaimId: item.claimId,
        status: item.status === 'inconsistent'
          ? 'semantic-numeric-conflict' as const
          : 'validated' as const,
      }]
      : []
  ));
  const maxCandidates = boundedLimit(options.maxCandidates, 24, 64);
  const auxiliaryCandidates = [...(options.candidateTools ?? [])]
    .sort((left, right) => (
      Number(right.currentInputReady) - Number(left.currentInputReady)
      || left.toolId.localeCompare(right.toolId)
    ))
    .slice(0, maxCandidates)
    .map((tool) => ({
      toolId: tool.toolId,
      currentInputReady: tool.currentInputReady,
      inputKinds: [...tool.inputKinds],
      outputKeys: tool.outputSlots.map((slot) => slot.key),
    }));
  const contradicted = obligations.some((item) => (
    item.status === 'counterexample' || item.status === 'inconsistent'
  ));
  const formallyComplete = obligations.every((item) => item.status === 'formally-proven');
  return {
    schemaVersion: GEOMETRY_PROOF_STATE_SCHEMA_VERSION,
    basis: {
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      revision: geometryDoc.basis.revision,
      ...(geometryDoc.basis.sourceId ? { sourceId: geometryDoc.basis.sourceId } : {}),
      sourceHash: geometryDoc.basis.sourceHash,
      ...(geometryDoc.basis.kernelHash
        ? { kernelHash: geometryDoc.basis.kernelHash }
        : {}),
      ...(geometryDoc.basis.projectionHash
        ? { projectionHash: geometryDoc.basis.projectionHash }
        : {}),
      ...(geometryDoc.basis.pluginSetDigest
        ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
        : {}),
    },
    focusEntityIds: [...new Set(options.focusEntityIds ?? options.allowedEntityIds)]
      .filter((entityId) => allowed.has(entityId) && entitiesById.has(entityId))
      .sort(),
    facts,
    obligations,
    deductions,
    auxiliaryCandidates,
    completion: contradicted
      ? 'contradicted'
      : formallyComplete ? 'formal-proof-complete' : 'open',
    semanticStatus: geometryDoc.semantic.status,
    truncated: completeFacts.length > facts.length
      || (options.candidateTools?.length ?? 0) > auxiliaryCandidates.length,
  };
}
