import type { GeometryDoc } from '../ir/geometry-doc';
import type {
  GeometryConstraint,
  GeometryEntity,
  GeometryExpression,
  JsonValue,
} from '../ir/model';
import {
  buildGeometryProofState,
  type GeometryProofClaimInput,
} from '../semantics/geometry-proof-state';
import { requestsGeometryFlowWidget } from './widget-request';
import {
  parseTikzReadOnlyAgentWidget,
  type GeometryFlowWidget,
} from './widget-protocol';

const LINEAR_ENTITY_KINDS = new Set([
  'line',
  'segment',
  'ray',
  'vector',
  'polyline',
]);

interface HostFlowCandidate {
  readonly widget: GeometryFlowWidget;
  readonly claims: readonly {
    readonly stepId: string;
    readonly claim: GeometryProofClaimInput;
  }[];
}

function entityReferences(expression: GeometryExpression | undefined): string[] {
  if (!expression) return [];
  if (expression.kind === 'entity-reference') return [expression.entityId];
  if (expression.kind !== 'operation') return [];
  return expression.arguments.flatMap(entityReferences);
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function explicitlyMentions(problem: string, name: string | undefined): boolean {
  if (!name || name.length > 32) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'u').test(problem);
}

function uniqueNamedEntity(
  entities: readonly GeometryEntity[],
  name: string,
): GeometryEntity | undefined {
  const matches = entities.filter((entity) => entity.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function pointName(
  entitiesById: ReadonlyMap<string, GeometryEntity>,
  entityId: string,
): string {
  return entitiesById.get(entityId)?.name ?? entityId.replace(/^point:/u, '');
}

function relatedLinearEntity(
  entities: readonly GeometryEntity[],
  entitiesById: ReadonlyMap<string, GeometryEntity>,
  leftId: string,
  rightId: string,
): GeometryEntity | undefined {
  const leftName = pointName(entitiesById, leftId);
  const rightName = pointName(entitiesById, rightId);
  const matches = entities.filter((entity) => {
    if (!LINEAR_ENTITY_KINDS.has(entity.kind)) return false;
    const refs = stringArray(entity.parameters?.references);
    return refs.includes(leftName) && refs.includes(rightName);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function relatedRightAngle(
  entities: readonly GeometryEntity[],
  entitiesById: ReadonlyMap<string, GeometryEntity>,
  footId: string,
): GeometryEntity | undefined {
  const footName = pointName(entitiesById, footId);
  const matches = entities.filter((entity) => {
    if (entity.kind !== 'right-angle') return false;
    return stringArray(entity.parameters?.references).includes(footName);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function refs(...groups: readonly (string | undefined)[][]): string[] {
  return [...new Set(groups.flat().filter((value): value is string => Boolean(value)))];
}

function constructionIdsOf(entity: GeometryEntity): string[] {
  const direct = entity.metadata?.constructionId;
  const overlaid = entity.metadata?.managedConstructionIds;
  return refs(
    [typeof direct === 'string' ? direct : undefined],
    Array.isArray(overlaid)
      ? overlaid.filter((value): value is string => typeof value === 'string')
      : [],
  );
}

function constraintConstructionId(constraint: GeometryConstraint): string | null {
  const value = constraint.metadata?.constructionId;
  return typeof value === 'string' ? value : null;
}

function ninePointCircleFlow(
  problem: string,
  entities: readonly GeometryEntity[],
  constraints: readonly GeometryConstraint[],
): HostFlowCandidate | null {
  const circleCandidates = entities.filter((entity) => (
    entity.kind === 'circle'
    && entity.tags?.includes('nine-point-circle')
  ));
  const mentioned = circleCandidates.filter((entity) => explicitlyMentions(problem, entity.name));
  const circle = mentioned.length === 1
    ? mentioned[0]
    : circleCandidates.length === 1
      ? circleCandidates[0]
      : undefined;
  if (!circle) return null;
  const constructionIds = constructionIdsOf(circle);
  if (constructionIds.length !== 1) return null;
  const [constructionId] = constructionIds;
  const members = entities.filter((entity) => (
    constructionIdsOf(entity).includes(constructionId)
  ));
  const byTag = (tag: string) => members.filter((entity) => entity.tags?.includes(tag));
  const sideMidpoints = byTag('side-midpoint');
  const altitudeFeet = byTag('altitude-foot');
  const orthocenters = byTag('orthocenter');
  const vertexMidpoints = byTag('vertex-orthocenter-midpoint');
  const centers = byTag('center').filter((entity) => entity.kind === 'point');
  if (
    sideMidpoints.length !== 3
    || altitudeFeet.length !== 3
    || orthocenters.length !== 1
    || vertexMidpoints.length !== 3
    || centers.length !== 1
  ) return null;

  const memberConstraints = constraints.filter((constraint) => (
    constraintConstructionId(constraint) === constructionId
  ));
  const sideMidpointIds = new Set(sideMidpoints.map((entity) => entity.id));
  const vertexIds = new Set<string>();
  for (const constraint of memberConstraints) {
    if (constraint.kind !== 'midpoint') continue;
    const point = constraint.arguments.find((argument) => argument.role === 'point')?.entityId;
    if (!point || !sideMidpointIds.has(point)) continue;
    for (const argument of constraint.arguments) {
      if (
        (argument.role === 'segment-start' || argument.role === 'segment-end')
        && argument.entityId
      ) {
        vertexIds.add(argument.entityId);
      }
    }
  }
  if (vertexIds.size !== 3) return null;
  const onCirclePoints = new Set(memberConstraints
    .filter((constraint) => (
      constraint.kind === 'on-circle'
      && constraint.arguments.some((argument) => (
        argument.role === 'circle' && argument.entityId === circle.id
      ))
    ))
    .flatMap((constraint) => constraint.arguments
      .filter((argument) => argument.role === 'point')
      .map((argument) => argument.entityId)));
  const ninePointIds = [
    ...sideMidpoints,
    ...altitudeFeet,
    ...vertexMidpoints,
  ].map((entity) => entity.id);
  if (!ninePointIds.every((id) => onCirclePoints.has(id))) return null;

  const center = centers[0]!;
  const orthocenter = orthocenters[0]!;
  const candidate: GeometryFlowWidget = {
    kind: 'geometry-flow',
    title: `${circle.name ?? '九点圆'}的语义构造链`,
    steps: [
      {
        id: 'nine-point-given',
        title: '读取三角形',
        explanation: '读取三个顶点与现有依赖关系；这一步只使用当前 revision 的 GeometryDoc。',
        entityRefs: [...vertexIds],
        provenance: 'semantic-kernel',
        state: 'given',
      },
      {
        id: 'nine-point-side-midpoints',
        title: '构造三边中点',
        explanation: '分别取三条边的中点，它们确定九点圆的一个稳定三点圆表示。',
        constructionToolId: 'midpoint',
        entityRefs: refs([...vertexIds], sideMidpoints.map((entity) => entity.id)),
        provenance: 'semantic-kernel',
        state: 'construction',
      },
      {
        id: 'nine-point-altitude-feet',
        title: '构造三垂足与垂心',
        explanation: '从三个顶点向对边作垂线得到三垂足，并由两条高的交点得到垂心。',
        constructionToolId: 'perpendicular-foot',
        entityRefs: refs(
          altitudeFeet.map((entity) => entity.id),
          [orthocenter.id],
          [...vertexIds],
        ),
        provenance: 'semantic-kernel',
        state: 'deduction',
      },
      {
        id: 'nine-point-circle-goal',
        title: '验证九点共圆',
        explanation: '三个顶点到垂心的中点与前三个中点、三个垂足都由 on-circle 约束关联到同一九点圆。',
        constructionToolId: 'nine-point-circle',
        entityRefs: refs(
          ninePointIds,
          [orthocenter.id, center.id, circle.id],
        ),
        provenance: 'semantic-kernel',
        state: 'goal',
      },
    ],
  };
  const parsed = parseTikzReadOnlyAgentWidget(candidate);
  return parsed?.kind === 'geometry-flow'
    ? {
      widget: parsed,
      claims: [{
        stepId: 'nine-point-circle-goal',
        claim: {
          claimId: 'nine-point-concyclic',
          kind: 'concyclic',
          entityIds: ninePointIds,
        },
      }],
    }
    : null;
}

function simsonLineFlow(
  problem: string,
  entities: readonly GeometryEntity[],
  constraints: readonly GeometryConstraint[],
): HostFlowCandidate | null {
  const lineCandidates = entities.filter((entity) => (
    entity.kind === 'line'
    && entity.tags?.includes('simson-line')
    && entity.tags.includes('collinear-feet')
  ));
  const mentioned = lineCandidates.filter((entity) => explicitlyMentions(problem, entity.name));
  const line = mentioned.length === 1
    ? mentioned[0]
    : lineCandidates.length === 1
      ? lineCandidates[0]
      : undefined;
  if (!line) return null;
  const constructionIds = constructionIdsOf(line);
  if (constructionIds.length !== 1) return null;
  const [constructionId] = constructionIds;
  const members = entities.filter((entity) => constructionIdsOf(entity).includes(constructionId));
  const memberConstraints = constraints.filter((constraint) => (
    constraintConstructionId(constraint) === constructionId
  ));
  const centers = members.filter((entity) => entity.kind === 'point' && entity.tags?.includes('circumcenter'));
  const circles = members.filter((entity) => entity.kind === 'circle' && entity.tags?.includes('circumcircle'));
  const circlePoints = members.filter((entity) => entity.kind === 'point' && entity.tags?.includes('circle-point'));
  const feet = members.filter((entity) => entity.kind === 'point' && entity.tags?.includes('pedal-foot'));
  if (centers.length !== 1 || circles.length !== 1 || circlePoints.length !== 1 || feet.length !== 3) {
    return null;
  }
  const center = centers[0]!;
  const circle = circles[0]!;
  const point = circlePoints[0]!;
  const circleThrough = memberConstraints.find((constraint) => (
    constraint.kind === 'circle-through-three-points'
    && constraint.arguments.some((argument) => argument.role === 'circle' && argument.entityId === circle.id)
    && constraint.arguments.some((argument) => argument.role === 'center' && argument.entityId === center.id)
  ));
  const vertexIds = circleThrough?.arguments
    .filter((argument) => /^point-[123]$/u.test(argument.role))
    .map((argument) => argument.entityId) ?? [];
  const onCircle = memberConstraints.find((constraint) => (
    constraint.kind === 'on-circle'
    && constraint.arguments.some((argument) => argument.role === 'point' && argument.entityId === point.id)
    && constraint.arguments.some((argument) => argument.role === 'circle' && argument.entityId === circle.id)
  ));
  const footIds = new Set(feet.map((entity) => entity.id));
  const footConstraints = memberConstraints.filter((constraint) => (
    constraint.kind === 'perpendicular-foot'
    && constraint.arguments.some((argument) => argument.role === 'point' && argument.entityId === point.id)
    && constraint.arguments.some((argument) => (
      argument.role === 'result'
      && typeof argument.entityId === 'string'
      && footIds.has(argument.entityId)
    ))
  ));
  const collinearConstraint = memberConstraints.find((constraint) => (
    constraint.kind === 'collinear'
    && constraint.arguments.length === 3
    && constraint.arguments.every((argument) => (
      typeof argument.entityId === 'string' && footIds.has(argument.entityId)
    ))
  ));
  if (
    vertexIds.length !== 3
    || new Set(vertexIds).size !== 3
    || !onCircle
    || footConstraints.length !== 3
    || !collinearConstraint
  ) return null;

  const candidate: GeometryFlowWidget = {
    kind: 'geometry-flow',
    title: `${line.name ?? '西姆松线'}的语义推导链`,
    steps: [
      {
        id: 'simson-circumcircle',
        title: '建立三角形外接圆',
        explanation: '由三个不共线顶点确定外接圆与外心；这一步来自当前 GeometryDoc 的 circle-through-three-points 约束。',
        constructionToolId: 'circumcircle',
        entityRefs: refs(vertexIds, [center.id, circle.id]),
        provenance: 'semantic-kernel',
        state: 'given',
      },
      {
        id: 'simson-circle-point',
        title: '取圆上点',
        explanation: '点 P 由 on-circle 约束绑定在该外接圆上，它不是任意自由点。',
        constructionToolId: 'point-on-circle',
        entityRefs: [point.id, circle.id],
        provenance: 'semantic-kernel',
        state: 'construction',
      },
      {
        id: 'simson-pedal-feet',
        title: '向三边作垂足',
        explanation: '从圆上点分别向三条边作垂线，三个 perpendicular-foot 约束确定三个垂足。',
        constructionToolId: 'perpendicular-foot',
        entityRefs: refs(vertexIds, [point.id], feet.map((entity) => entity.id)),
        provenance: 'semantic-kernel',
        state: 'deduction',
      },
      {
        id: 'simson-collinear-goal',
        title: '验证三垂足共线',
        explanation: '三个垂足由同一个 collinear 约束连接，并共同定义最终的西姆松线。',
        constructionToolId: 'simson-line',
        entityRefs: refs(feet.map((entity) => entity.id), [line.id]),
        provenance: 'semantic-kernel',
        state: 'goal',
      },
    ],
  };
  const parsed = parseTikzReadOnlyAgentWidget(candidate);
  return parsed?.kind === 'geometry-flow'
    ? {
      widget: parsed,
      claims: [{
        stepId: 'simson-collinear-goal',
        claim: {
          claimId: 'simson-feet-collinear',
          kind: 'collinear',
          entityIds: feet.map((entity) => entity.id),
        },
      }],
    }
    : null;
}

function midpointAndFootFlow(
  problem: string,
  entities: readonly GeometryEntity[],
): HostFlowCandidate | null {
  const byId = new Map(entities.map((entity) => [entity.id, entity] as const));
  const mentioned = entities.filter((entity) => explicitlyMentions(problem, entity.name));
  const derived = entities.filter((entity) => (
    entity.kind === 'point'
    && entity.definition?.kind === 'operation'
    && (entity.definition.operator === 'midpoint'
      || entity.definition.operator === 'perpendicular-foot')
  ));
  const midpoint = derived.find((entity) => (
    entity.definition?.kind === 'operation'
    && entity.definition.operator === 'midpoint'
    && (explicitlyMentions(problem, entity.name) || mentioned.length === 0)
  ));
  const foot = derived.find((entity) => (
    entity.definition?.kind === 'operation'
    && entity.definition.operator === 'perpendicular-foot'
    && (explicitlyMentions(problem, entity.name) || mentioned.length === 0)
  ));
  if (
    !midpoint
    || midpoint.definition?.kind !== 'operation'
    || !foot
    || foot.definition?.kind !== 'operation'
  ) return null;

  const midpointInputs = entityReferences(midpoint.definition);
  const footInputs = entityReferences(foot.definition);
  if (midpointInputs.length !== 2 || footInputs.length !== 3) return null;
  const [projectedPointId, baseStartId, baseEndId] = footInputs;
  if (!projectedPointId || !baseStartId || !baseEndId) return null;
  const sameBase = new Set(midpointInputs).size === 2
    && midpointInputs.every((id) => id === baseStartId || id === baseEndId);
  if (!sameBase) return null;

  const median = relatedLinearEntity(entities, byId, projectedPointId, midpoint.id);
  const altitude = relatedLinearEntity(entities, byId, projectedPointId, foot.id);
  const rightAngle = relatedRightAngle(entities, byId, foot.id);
  const apexName = pointName(byId, projectedPointId);
  const midpointName = midpoint.name ?? pointName(byId, midpoint.id);
  const footName = foot.name ?? pointName(byId, foot.id);
  const baseNames = midpointInputs.map((id) => pointName(byId, id));

  const candidate: GeometryFlowWidget = {
    kind: 'geometry-flow',
    title: `${midpointName} 与 ${footName} 的几何推导`,
    steps: [
      {
        id: 'given-triangle',
        title: '读取已知图形',
        explanation: `以 ${baseNames.join('、')} 为底边，${apexName} 为顶点；以下步骤只读取当前 GeometryDoc，不修改画板。`,
        entityRefs: refs(midpointInputs, [projectedPointId]),
        provenance: 'semantic-kernel',
        state: 'given',
      },
      {
        id: 'construct-midpoint',
        title: `构造中点 ${midpointName}`,
        explanation: `${midpointName} 由 ${baseNames.join('、')} 的 midpoint 定义确定，因此它是底边中点。`,
        constructionToolId: 'midpoint',
        entityRefs: refs(midpointInputs, [midpoint.id]),
        provenance: 'semantic-kernel',
        state: 'construction',
      },
      {
        id: 'deduce-median',
        title: `连接 ${apexName}${midpointName}`,
        explanation: `连接顶点 ${apexName} 与底边中点 ${midpointName}，得到中线 ${apexName}${midpointName}。`,
        entityRefs: refs([projectedPointId, midpoint.id, median?.id]),
        provenance: 'semantic-kernel',
        state: 'deduction',
      },
      {
        id: 'construct-altitude',
        title: `构造垂足 ${footName} 与高`,
        explanation: `${footName} 的 perpendicular-foot 定义把 ${apexName} 投影到底边 ${baseNames.join('')}；连接 ${apexName}${footName} 得到高，并由直角关系确认垂直。`,
        constructionToolId: 'perpendicular-foot',
        entityRefs: refs(footInputs, [foot.id, altitude?.id, rightAngle?.id]),
        provenance: 'semantic-kernel',
        state: 'goal',
      },
    ],
  };
  const parsed = parseTikzReadOnlyAgentWidget(candidate);
  return parsed?.kind === 'geometry-flow'
    ? {
      widget: parsed,
      claims: [
        {
          stepId: 'construct-midpoint',
          claim: {
            claimId: 'midpoint-definition',
            kind: 'midpoint',
            entityIds: [midpoint.id, ...midpointInputs],
          },
        },
        {
          stepId: 'construct-altitude',
          claim: {
            claimId: 'altitude-perpendicular',
            kind: 'perpendicular',
            entityIds: [projectedPointId, foot.id, baseStartId, baseEndId],
          },
        },
      ],
    }
    : null;
}

/**
 * Build common proof-flow widgets from revision-bound semantic truth.
 * The model may explain the result, but it never invents widget entity IDs.
 */
export function hostGeometryFlowWidget(
  problem: string,
  geometryDoc: GeometryDoc | null | undefined,
): GeometryFlowWidget | null {
  if (!geometryDoc || !requestsGeometryFlowWidget(problem)) return null;
  const entities = geometryDoc.semantic.ir.entities;
  if (entities.length === 0) return null;
  const candidate = ninePointCircleFlow(problem, entities, geometryDoc.semantic.ir.constraints)
    ?? simsonLineFlow(problem, entities, geometryDoc.semantic.ir.constraints)
    ?? midpointAndFootFlow(problem, entities);
  if (!candidate) return null;
  const proofState = buildGeometryProofState(geometryDoc, {
    allowedEntityIds: entities.map((entity) => entity.id),
    focusEntityIds: candidate.widget.steps.flatMap((step) => step.entityRefs ?? []),
    claims: candidate.claims.map((entry) => entry.claim),
    maxFacts: 160,
    maxCandidates: 0,
  });
  const obligationByClaimId = new Map(proofState.obligations.map((obligation) => (
    [obligation.claimId, obligation] as const
  )));
  const claimByStepId = new Map(candidate.claims.map((entry) => (
    [entry.stepId, entry.claim.claimId] as const
  )));
  // These fields are attached by the host after semantic projection.  A model
  // supplied flow is never allowed to choose the document/revision it may
  // focus, reveal, or autoplay against.
  const parsed = parseTikzReadOnlyAgentWidget({
    ...candidate.widget,
    steps: candidate.widget.steps.map((step) => {
      const claimId = claimByStepId.get(step.id);
      const proof = claimId ? obligationByClaimId.get(claimId) : undefined;
      return proof ? { ...step, proof } : step;
    }),
    basis: {
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      revision: geometryDoc.basis.revision,
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
  }, { trustedHostGeometryProof: true });
  return parsed?.kind === 'geometry-flow' ? parsed : null;
}

export const __hostGeometryFlowWidgetTest = {
  entityReferences,
  explicitlyMentions,
  uniqueNamedEntity,
};
