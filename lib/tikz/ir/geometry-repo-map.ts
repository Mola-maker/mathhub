import { dependencyPairs } from './invalidation';
import type {
  GeometryEntity,
  GeometryExpression,
  SemanticTruth,
} from './model';

export const GEOMETRY_REPO_MAP_SCHEMA_VERSION = 'geometry-repo-map/v1' as const;

export interface GeometryRepoMapEntry {
  readonly entityId: string;
  readonly score: number;
  readonly distance: number;
  readonly reasons: readonly string[];
  readonly evidenceRecordIds: readonly string[];
}

export interface GeometryRepoMap {
  readonly schemaVersion: typeof GEOMETRY_REPO_MAP_SCHEMA_VERSION;
  readonly requestedRefs: readonly string[];
  readonly resolvedEntityIds: readonly string[];
  readonly unresolvedRefs: readonly string[];
  readonly ambiguousRefs: readonly string[];
  readonly depth: number;
  readonly entries: readonly GeometryRepoMapEntry[];
  readonly candidateCount: number;
  readonly truncated: boolean;
}

export interface GeometryRepoMapOptions {
  readonly focusRefs?: readonly string[];
  readonly depth?: number;
  readonly maxEntries?: number;
  readonly maxCandidates?: number;
}

export const GEOMETRY_RELATION_EXPLANATION_SCHEMA_VERSION =
  'geometry-relation-explanation/v1' as const;

export interface GeometryRelationPathStep {
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly weight: number;
  readonly reasons: readonly string[];
  readonly evidenceRecordIds: readonly string[];
}

export interface GeometryRelationExplanation {
  readonly schemaVersion: typeof GEOMETRY_RELATION_EXPLANATION_SCHEMA_VERSION;
  readonly fromRef: string;
  readonly toRef: string;
  readonly status: 'connected' | 'disconnected' | 'unresolved' | 'ambiguous';
  readonly fromEntityId?: string;
  readonly toEntityId?: string;
  readonly ambiguousRefs: readonly string[];
  readonly unresolvedRefs: readonly string[];
  readonly path: readonly GeometryRelationPathStep[];
  readonly visitedCount: number;
  readonly truncated: boolean;
}

export interface GeometryRelationExplanationOptions {
  readonly fromRef: string;
  readonly toRef: string;
  readonly maxHops?: number;
  readonly maxVisited?: number;
  readonly allowedEntityIds?: readonly string[];
}

interface SemanticEdge {
  readonly to: string;
  weight: number;
  readonly reasons: Set<string>;
  readonly evidenceRecordIds: Set<string>;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function expressionEntityIds(expression: GeometryExpression | undefined): string[] {
  if (!expression) return [];
  if (expression.kind === 'entity-reference') return [expression.entityId];
  if (expression.kind === 'operation') {
    return expression.arguments.flatMap(expressionEntityIds);
  }
  return [];
}

function aliasIndex(entities: readonly GeometryEntity[]) {
  const aliases = new Map<string, Set<string>>();
  const add = (alias: string, entityId: string) => {
    const ids = aliases.get(alias) ?? new Set<string>();
    ids.add(entityId);
    aliases.set(alias, ids);
  };
  for (const entity of entities) {
    add(entity.id, entity.id);
    if (!entity.name) continue;
    add(entity.name, entity.id);
    add(`${entity.kind}:${entity.name}`, entity.id);
    if (entity.kind === 'point') add(`point:${entity.name}`, entity.id);
  }
  return aliases;
}

function parameterReferenceIds(
  entity: GeometryEntity,
  aliases: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  if (!Array.isArray(entity.parameters?.references)) return [];
  return entity.parameters.references.flatMap((reference) => {
    if (typeof reference !== 'string') return [];
    const ids = aliases.get(reference);
    return ids?.size === 1 ? [...ids] : [];
  });
}

function addDirectedEdge(
  adjacency: Map<string, Map<string, SemanticEdge>>,
  entityIds: ReadonlySet<string>,
  from: string,
  to: string,
  weight: number,
  reason: string,
  evidenceRecordId: string,
) {
  if (from === to || !entityIds.has(from) || !entityIds.has(to)) return;
  const neighbors = adjacency.get(from) ?? new Map<string, SemanticEdge>();
  const existing = neighbors.get(to);
  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    existing.reasons.add(reason);
    existing.evidenceRecordIds.add(evidenceRecordId);
  } else {
    neighbors.set(to, {
      to,
      weight,
      reasons: new Set([reason]),
      evidenceRecordIds: new Set([evidenceRecordId]),
    });
  }
  adjacency.set(from, neighbors);
}

function addBidirectionalEdge(
  adjacency: Map<string, Map<string, SemanticEdge>>,
  entityIds: ReadonlySet<string>,
  left: string,
  right: string,
  weight: number,
  reason: string,
  evidenceRecordId: string,
) {
  addDirectedEdge(adjacency, entityIds, left, right, weight, reason, evidenceRecordId);
  addDirectedEdge(adjacency, entityIds, right, left, weight, reason, evidenceRecordId);
}

function semanticAdjacency(semantic: SemanticTruth) {
  const entities = semantic.ir.entities;
  const entityIds = new Set(entities.map((entity) => entity.id));
  const aliases = aliasIndex(entities);
  const adjacency = new Map<string, Map<string, SemanticEdge>>();

  for (const entity of entities) {
    const references = [...new Set([
      ...expressionEntityIds(entity.definition),
      ...parameterReferenceIds(entity, aliases),
    ])];
    for (const reference of references) {
      addDirectedEdge(
        adjacency,
        entityIds,
        entity.id,
        reference,
        1.35,
        'definition-input',
        entity.id,
      );
      addDirectedEdge(
        adjacency,
        entityIds,
        reference,
        entity.id,
        1.05,
        'defined-dependent',
        entity.id,
      );
    }
  }

  for (const constraint of semantic.ir.constraints) {
    const participants = [...new Set(constraint.arguments.flatMap((argument) => (
      argument.entityId && entityIds.has(argument.entityId) ? [argument.entityId] : []
    )))];
    const weight = constraint.strength === 'required' ? 1.45 : 1.2;
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        addBidirectionalEdge(
          adjacency,
          entityIds,
          participants[left]!,
          participants[right]!,
          weight,
          `constraint:${constraint.kind}`,
          constraint.id,
        );
      }
    }
  }

  for (const relation of semantic.ir.relations) {
    const participants = [...new Set(relation.participants.flatMap((participant) => (
      participant.entityId && entityIds.has(participant.entityId)
        ? [participant.entityId]
        : []
    )))];
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        addBidirectionalEdge(
          adjacency,
          entityIds,
          participants[left]!,
          participants[right]!,
          0.8,
          `relation:${relation.kind}`,
          relation.id,
        );
      }
    }
    for (const pair of dependencyPairs(relation)) {
      addDirectedEdge(
        adjacency,
        entityIds,
        pair.dependent,
        pair.dependency,
        1.4,
        'dependency-input',
        relation.id,
      );
      addDirectedEdge(
        adjacency,
        entityIds,
        pair.dependency,
        pair.dependent,
        1.1,
        'dependent-output',
        relation.id,
      );
    }
  }
  return { aliases, adjacency };
}

function roundedScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resolveEntityReference(
  reference: string,
  entities: readonly GeometryEntity[],
  aliases: ReadonlyMap<string, ReadonlySet<string>>,
): { status: 'resolved'; entityId: string }
  | { status: 'unresolved' | 'ambiguous' } {
  const exact = entities.find((entity) => entity.id === reference);
  if (exact) return { status: 'resolved', entityId: exact.id };
  const ids = aliases.get(reference);
  if (!ids || ids.size === 0) return { status: 'unresolved' };
  if (ids.size > 1) return { status: 'ambiguous' };
  return { status: 'resolved', entityId: [...ids][0]! };
}

/**
 * Explain one deterministic semantic path. The path is evidence only and
 * never grants source-read or source-write authority.
 */
export function explainGeometryRelation(
  semantic: SemanticTruth,
  options: GeometryRelationExplanationOptions,
): GeometryRelationExplanation {
  const maxHops = boundedInteger(options.maxHops, 8, 1, 24);
  const maxVisited = boundedInteger(options.maxVisited, 512, 2, 4096);
  const allowed = options.allowedEntityIds
    ? new Set(options.allowedEntityIds)
    : null;
  const entities = allowed
    ? semantic.ir.entities.filter((entity) => allowed.has(entity.id))
    : semantic.ir.entities;
  const filteredSemantic: SemanticTruth = allowed
    ? {
        ...semantic,
        ir: { ...semantic.ir, entities },
      }
    : semantic;
  const { aliases, adjacency } = semanticAdjacency(filteredSemantic);
  const from = resolveEntityReference(options.fromRef, entities, aliases);
  const to = resolveEntityReference(options.toRef, entities, aliases);
  const ambiguousRefs = [
    ...(from.status === 'ambiguous' ? [options.fromRef] : []),
    ...(to.status === 'ambiguous' ? [options.toRef] : []),
  ];
  const unresolvedRefs = [
    ...(from.status === 'unresolved' ? [options.fromRef] : []),
    ...(to.status === 'unresolved' ? [options.toRef] : []),
  ];
  if (ambiguousRefs.length > 0 || unresolvedRefs.length > 0) {
    return {
      schemaVersion: GEOMETRY_RELATION_EXPLANATION_SCHEMA_VERSION,
      fromRef: options.fromRef,
      toRef: options.toRef,
      status: ambiguousRefs.length > 0 ? 'ambiguous' : 'unresolved',
      ambiguousRefs,
      unresolvedRefs,
      path: [],
      visitedCount: 0,
      truncated: false,
    };
  }
  if (from.status !== 'resolved' || to.status !== 'resolved') {
    throw new TypeError('Resolved relation references lost their entity identity.');
  }
  const fromEntityId = from.entityId;
  const toEntityId = to.entityId;
  if (fromEntityId === toEntityId) {
    return {
      schemaVersion: GEOMETRY_RELATION_EXPLANATION_SCHEMA_VERSION,
      fromRef: options.fromRef,
      toRef: options.toRef,
      status: 'connected',
      fromEntityId,
      toEntityId,
      ambiguousRefs: [],
      unresolvedRefs: [],
      path: [],
      visitedCount: 1,
      truncated: false,
    };
  }

  const queue: Array<{ entityId: string; depth: number }> = [
    { entityId: fromEntityId, depth: 0 },
  ];
  const visited = new Set([fromEntityId]);
  const previous = new Map<string, GeometryRelationPathStep>();
  let truncated = false;
  while (queue.length > 0 && !visited.has(toEntityId)) {
    const current = queue.shift()!;
    if (current.depth >= maxHops) continue;
    const neighbors = [...(adjacency.get(current.entityId)?.values() ?? [])]
      .sort((left, right) => right.weight - left.weight || left.to.localeCompare(right.to));
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;
      if (visited.size >= maxVisited) {
        truncated = true;
        break;
      }
      visited.add(edge.to);
      previous.set(edge.to, {
        fromEntityId: current.entityId,
        toEntityId: edge.to,
        weight: edge.weight,
        reasons: [...edge.reasons].sort(),
        evidenceRecordIds: [...edge.evidenceRecordIds].sort(),
      });
      queue.push({ entityId: edge.to, depth: current.depth + 1 });
      if (edge.to === toEntityId) break;
    }
    if (truncated) break;
  }

  const path: GeometryRelationPathStep[] = [];
  if (visited.has(toEntityId)) {
    let cursor = toEntityId;
    while (cursor !== fromEntityId) {
      const step = previous.get(cursor);
      if (!step) break;
      path.push(step);
      cursor = step.fromEntityId;
    }
    path.reverse();
  }
  return {
    schemaVersion: GEOMETRY_RELATION_EXPLANATION_SCHEMA_VERSION,
    fromRef: options.fromRef,
    toRef: options.toRef,
    status: path.length > 0 ? 'connected' : 'disconnected',
    fromEntityId,
    toEntityId,
    ambiguousRefs: [],
    unresolvedRefs: [],
    path,
    visitedCount: visited.size,
    truncated,
  };
}

/**
 * Build a deterministic, personalized semantic repo map for model retrieval.
 * Scores order context only. They never grant read or write authority.
 */
export function buildGeometryRepoMap(
  semantic: SemanticTruth,
  options: GeometryRepoMapOptions = {},
): GeometryRepoMap {
  const requestedRefs = [...new Set(
    (options.focusRefs ?? []).map((value) => value.trim()).filter(Boolean),
  )];
  const depth = boundedInteger(options.depth, 2, 0, 12);
  const maxEntries = boundedInteger(options.maxEntries, 160, 1, 512);
  const maxCandidates = boundedInteger(
    options.maxCandidates,
    Math.max(512, maxEntries * 8),
    maxEntries,
    4096,
  );
  const { aliases, adjacency } = semanticAdjacency(semantic);
  const exactEntityIds = new Set(semantic.ir.entities.map((entity) => entity.id));
  const resolvedEntityIds: string[] = [];
  const unresolvedRefs: string[] = [];
  const ambiguousRefs: string[] = [];
  for (const reference of requestedRefs) {
    if (exactEntityIds.has(reference)) {
      resolvedEntityIds.push(reference);
      continue;
    }
    const ids = aliases.get(reference);
    if (!ids || ids.size === 0) {
      unresolvedRefs.push(reference);
    } else if (ids.size > 1) {
      ambiguousRefs.push(reference);
    } else {
      resolvedEntityIds.push(...ids);
    }
  }
  const seeds = [...new Set(resolvedEntityIds)];
  if (seeds.length === 0) {
    return {
      schemaVersion: GEOMETRY_REPO_MAP_SCHEMA_VERSION,
      requestedRefs,
      resolvedEntityIds: [],
      unresolvedRefs,
      ambiguousRefs,
      depth,
      entries: [],
      candidateCount: 0,
      truncated: false,
    };
  }

  const distance = new Map<string, number>(
    seeds.map((entityId) => [entityId, 0]),
  );
  const queue = [...seeds].sort();
  let candidateLimitReached = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = distance.get(current)!;
    if (currentDistance >= depth) continue;
    const neighbors = [...(adjacency.get(current)?.keys() ?? [])].sort();
    for (const neighbor of neighbors) {
      if (distance.has(neighbor)) continue;
      if (distance.size >= maxCandidates) {
        candidateLimitReached = true;
        break;
      }
      distance.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
    queue.sort((left, right) => (
      (distance.get(left)! - distance.get(right)!) || left.localeCompare(right)
    ));
    if (candidateLimitReached) break;
  }

  const candidates = [...distance.keys()].sort();
  const candidateSet = new Set(candidates);
  const teleport = new Map(candidates.map((entityId) => [
    entityId,
    seeds.includes(entityId) ? 1 / seeds.length : 0,
  ]));
  let scores = new Map(teleport);
  const damping = 0.85;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const next = new Map(candidates.map((entityId) => [
      entityId,
      (1 - damping) * (teleport.get(entityId) ?? 0),
    ]));
    for (const entityId of candidates) {
      const outgoing = [...(adjacency.get(entityId)?.values() ?? [])]
        .filter((edge) => candidateSet.has(edge.to));
      const totalWeight = outgoing.reduce((sum, edge) => sum + edge.weight, 0);
      if (totalWeight === 0) {
        for (const seed of seeds) {
          next.set(seed, (next.get(seed) ?? 0) + damping * (scores.get(entityId) ?? 0) / seeds.length);
        }
        continue;
      }
      for (const edge of outgoing) {
        next.set(
          edge.to,
          (next.get(edge.to) ?? 0)
            + damping * (scores.get(entityId) ?? 0) * edge.weight / totalWeight,
        );
      }
    }
    scores = next;
  }

  const entries = candidates.map((entityId): GeometryRepoMapEntry => {
    const incident = [...(adjacency.get(entityId)?.values() ?? [])]
      .filter((edge) => candidateSet.has(edge.to));
    const entityDistance = distance.get(entityId)!;
    const seed = seeds.includes(entityId);
    const reasons = new Set<string>(seed ? ['explicit-focus'] : []);
    const evidenceRecordIds = new Set<string>();
    for (const edge of incident) {
      edge.reasons.forEach((reason) => reasons.add(reason));
      edge.evidenceRecordIds.forEach((recordId) => evidenceRecordIds.add(recordId));
    }
    return {
      entityId,
      score: roundedScore(
        (scores.get(entityId) ?? 0)
          + 0.25 / (entityDistance + 1)
          + (seed ? 1 : 0),
      ),
      distance: entityDistance,
      reasons: [...reasons].sort().slice(0, 12),
      evidenceRecordIds: [...evidenceRecordIds].sort().slice(0, 24),
    };
  }).sort((left, right) => (
    right.score - left.score
      || left.distance - right.distance
      || left.entityId.localeCompare(right.entityId)
  ));

  return {
    schemaVersion: GEOMETRY_REPO_MAP_SCHEMA_VERSION,
    requestedRefs,
    resolvedEntityIds: seeds,
    unresolvedRefs,
    ambiguousRefs,
    depth,
    entries: entries.slice(0, maxEntries),
    candidateCount: entries.length,
    truncated: candidateLimitReached || entries.length > maxEntries,
  };
}
