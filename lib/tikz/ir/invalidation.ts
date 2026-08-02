import type {
  ConstructionBinding,
  GeometryConstraint,
  GeometryIR,
  GeometryRelation,
  GeometryStyle,
  OpaqueConstructionNode,
  SourceRange,
} from './model';
import type {
  GeometrySourceMap,
  GeometrySourceMapEntry,
} from './source-map';

/**
 * A CodeMirror change expressed in the source coordinate system used by the
 * kernel: zero-based UTF-16 code-unit offsets and half-open ranges.
 *
 * Insertions have an empty `previousRange`; deletions have an empty
 * `currentRange`.
 */
export interface GeometryUtf16SourceChange {
  sourceId: string;
  previousRange: SourceRange;
  currentRange: SourceRange;
}

export interface GeometryInvalidationSnapshot {
  ir: GeometryIR;
  sourceMap: GeometrySourceMap;
  opaqueNodes?: readonly OpaqueConstructionNode[];
}

export interface GeometryInvalidationInput {
  changes: readonly GeometryUtf16SourceChange[];
  previous: GeometryInvalidationSnapshot;
  current: GeometryInvalidationSnapshot;
  /**
   * Extra normalized dependency relations supplied by a semantic plugin.
   * Previous/current IR relations are always included as a conservative union.
   */
  dependencyRelations?: readonly GeometryRelation[];
  maxDependencyNodes?: number;
}

export type GeometryFullReprojectReasonCode =
  | 'basis-mismatch'
  | 'plugin-set-changed'
  | 'revision-regressed'
  | 'revision-gap'
  | 'invalid-source-range'
  | 'unmapped-source-change'
  | 'opaque-barrier'
  | 'dependency-closure-limit';

export interface GeometryFullReprojectReason {
  code: GeometryFullReprojectReasonCode;
  message: string;
  changeIndex?: number;
  sourceId?: string;
  opaqueNodeIds?: readonly string[];
  limit?: number;
}

export interface GeometryOpaqueBarrierHit {
  side: 'previous' | 'current';
  nodeId: string;
  sourceId: string;
  range: SourceRange;
  impact: OpaqueConstructionNode['impact'];
  reason: OpaqueConstructionNode['reason'];
}

export interface GeometryOpaqueBarrier {
  active: boolean;
  requiresFullReproject: boolean;
  hits: readonly GeometryOpaqueBarrierHit[];
}

export interface GeometryInvalidationResult {
  /** Source bindings directly touched, added, removed, or remapped. */
  changedBindingIds: readonly string[];
  /** Direct semantic changes plus dependency descendants. */
  changedEntityIds: readonly string[];
  changedConstraintIds: readonly string[];
  changedRelationIds: readonly string[];
  /** Renderer-neutral primitive IDs invalidated by the affected semantics. */
  changedRenderIds: readonly string[];
  /** Entities read by the affected entities. Seeds are excluded. */
  dependencyAncestorIds: readonly string[];
  /** Entities depending on affected entities. Seeds are excluded. */
  dependencyDescendantIds: readonly string[];
  /** Direct entity seeds plus ancestor and descendant closures. */
  dependencyClosureIds: readonly string[];
  opaqueBarrier: GeometryOpaqueBarrier;
  fullReproject: boolean;
  fullReprojectReason: GeometryFullReprojectReason | null;
  fallbackReasons: readonly GeometryFullReprojectReason[];
}

interface DependencyGraph {
  dependencies: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
}

interface TraversalResult {
  ids: Set<string>;
  truncated: boolean;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function validRange(range: SourceRange): boolean {
  return Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end >= range.start;
}

/**
 * Conservative intersection: a zero-width insertion at a binding boundary
 * touches both adjacent bindings because it may change how the CST groups them.
 */
function rangesTouch(a: SourceRange, b: SourceRange): boolean {
  if (a.start === a.end) return b.start <= a.start && a.start <= b.end;
  if (b.start === b.end) return a.start <= b.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
        .join(',')}}`;
    }
    case 'undefined':
      return 'undefined';
    default:
      return JSON.stringify(String(value));
  }
}

function changedRecordIds<T extends { id: string }>(
  previous: readonly T[],
  current: readonly T[],
  signature: (value: T) => string = stableSerialize,
): Set<string> {
  const before = new Map(previous.map((value) => [value.id, value]));
  const after = new Map(current.map((value) => [value.id, value]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changed = new Set<string>();
  for (const id of ids) {
    const left = before.get(id);
    const right = after.get(id);
    if (!left || !right || signature(left) !== signature(right)) changed.add(id);
  }
  return changed;
}

/**
 * Snapshot revision/hash and absolute CST offsets change after unrelated edits.
 * They are excluded here; content, targets and writable semantics determine
 * whether the binding itself changed.
 */
function bindingSignature(binding: ConstructionBinding): string {
  const common = {
    id: binding.id,
    kind: binding.kind,
    role: binding.role,
    targets: binding.targets,
    writable: binding.writable,
    sourceId: binding.source.document.sourceId,
    verbatim: binding.source.verbatim,
    sliceHash: binding.source.sliceHash,
  };
  if (binding.kind === 'tikz-cst') {
    return stableSerialize({
      ...common,
      languageId: binding.languageId,
      cstNodeType: binding.cstNodeType,
    });
  }
  if (binding.kind === 'source-range') {
    return stableSerialize({
      ...common,
      syntaxNodeType: binding.syntaxNodeType,
      syntaxPath: binding.syntaxPath,
    });
  }
  return stableSerialize({
    ...common,
    namespace: binding.namespace,
    bindingType: binding.bindingType,
    payload: binding.payload,
  });
}

function sourceMapEntrySignature(entry: GeometrySourceMapEntry): string {
  return stableSerialize({
    bindingId: entry.bindingId,
    sourceId: entry.sourceId,
    writable: entry.writable,
    semanticTargets: entry.semanticTargets,
    entityIds: entry.entityIds,
    renderTargets: entry.renderTargets.map((target) => ({
      rendererId: target.rendererId,
      target: target.target,
      primitiveIds: target.primitiveIds,
    })),
  });
}

function changedSourceMapBindingIds(
  previous: GeometrySourceMap,
  current: GeometrySourceMap,
): Set<string> {
  const before = new Map(previous.entries.map((entry) => [entry.id, entry]));
  const after = new Map(current.entries.map((entry) => [entry.id, entry]));
  const changed = new Set<string>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(id);
    const right = after.get(id);
    if (
      !left
      || !right
      || sourceMapEntrySignature(left) !== sourceMapEntrySignature(right)
    ) {
      if (left) changed.add(left.bindingId);
      if (right) changed.add(right.bindingId);
    }
  }
  return changed;
}

function entriesByBindingId(
  sourceMap: GeometrySourceMap,
): Map<string, GeometrySourceMapEntry[]> {
  const values = new Map<string, GeometrySourceMapEntry[]>();
  for (const entry of sourceMap.entries) {
    const entries = values.get(entry.bindingId) ?? [];
    entries.push(entry);
    values.set(entry.bindingId, entries);
  }
  return values;
}

function recordMaps(snapshot: GeometryInvalidationSnapshot): {
  constraints: Map<string, GeometryConstraint>;
  relations: Map<string, GeometryRelation>;
  styles: Map<string, GeometryStyle>;
} {
  return {
    constraints: new Map(snapshot.ir.constraints.map((value) => [value.id, value])),
    relations: new Map(snapshot.ir.relations.map((value) => [value.id, value])),
    styles: new Map(snapshot.ir.styles.map((value) => [value.id, value])),
  };
}

function entityIdsOfConstraint(value: GeometryConstraint | undefined): string[] {
  return value?.arguments.flatMap((argument) =>
    argument.entityId ? [argument.entityId] : []) ?? [];
}

function entityIdsOfRelation(value: GeometryRelation | undefined): string[] {
  return value?.participants.flatMap((participant) =>
    participant.entityId ? [participant.entityId] : []) ?? [];
}

function entityIdsOfStyle(value: GeometryStyle | undefined): string[] {
  return value?.selector.entityIds ? [...value.selector.entityIds] : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function dependencyPairs(
  relation: GeometryRelation,
): Array<{ dependent: string; dependency: string }> {
  const participants = relation.participants.flatMap((participant) => (
    typeof participant.entityId === 'string'
      ? [{ role: participant.role, entityId: participant.entityId }]
      : []
  ));
  const explicitDependencies = participants
    .filter((participant) => participant.role === 'dependency')
    .map((participant) => participant.entityId);
  const explicitDependents = participants
    .filter((participant) => participant.role === 'dependent')
    .map((participant) => participant.entityId);
  if (explicitDependencies.length > 0 && explicitDependents.length > 0) {
    return explicitDependents.flatMap((dependent) =>
      explicitDependencies.map((dependency) => ({ dependent, dependency })));
  }

  const propertyDependencies = stringArray(relation.properties?.dependencies);
  const propertyDependents = stringArray(relation.properties?.dependents);
  if (propertyDependencies.length > 0 && propertyDependents.length > 0) {
    return propertyDependents.flatMap((dependent) =>
      propertyDependencies.map((dependency) => ({ dependent, dependency })));
  }

  const inputCountValue = relation.properties?.inputs;
  const inputCount = typeof inputCountValue === 'number'
    && Number.isInteger(inputCountValue)
    && inputCountValue > 0
    && inputCountValue < participants.length
    ? inputCountValue
    : null;
  if (relation.kind === 'construction-dependency' && inputCount !== null) {
    const dependencies = participants.slice(0, inputCount).map(({ entityId }) => entityId);
    const dependents = participants.slice(inputCount).map(({ entityId }) => entityId);
    return dependents.flatMap((dependent) =>
      dependencies.map((dependency) => ({ dependent, dependency })));
  }
  return [];
}

function buildDependencyGraph(relations: readonly GeometryRelation[]): DependencyGraph {
  const graph: DependencyGraph = {
    dependencies: new Map(),
    dependents: new Map(),
  };
  for (const relation of relations) {
    for (const { dependent, dependency } of dependencyPairs(relation)) {
      const dependencies = graph.dependencies.get(dependent) ?? new Set<string>();
      dependencies.add(dependency);
      graph.dependencies.set(dependent, dependencies);

      const dependents = graph.dependents.get(dependency) ?? new Set<string>();
      dependents.add(dependent);
      graph.dependents.set(dependency, dependents);
    }
  }
  return graph;
}

function traverse(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  seeds: ReadonlySet<string>,
  maxNodes: number,
): TraversalResult {
  const visited = new Set(seeds);
  const result = new Set<string>();
  const queue = sorted([...seeds].flatMap((seed) => [...(edges.get(seed) ?? [])]));
  let truncated = visited.size > maxNodes;
  while (queue.length > 0 && !truncated) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    if (visited.size >= maxNodes) {
      truncated = true;
      break;
    }
    visited.add(current);
    result.add(current);
    for (const next of edges.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
    queue.sort();
  }
  return { ids: result, truncated };
}

function opaqueHits(
  changes: readonly GeometryUtf16SourceChange[],
  snapshot: GeometryInvalidationSnapshot,
  side: 'previous' | 'current',
): GeometryOpaqueBarrierHit[] {
  const hits: GeometryOpaqueBarrierHit[] = [];
  const nodes = snapshot.opaqueNodes ?? [];
  changes.forEach((change) => {
    const changedRange = side === 'previous'
      ? change.previousRange
      : change.currentRange;
    if (!validRange(changedRange)) return;
    for (const node of nodes) {
      if (
        node.source.document.sourceId === change.sourceId
        && rangesTouch(node.source.range, changedRange)
      ) {
        hits.push({
          side,
          nodeId: node.id,
          sourceId: change.sourceId,
          range: { ...node.source.range },
          impact: node.impact,
          reason: node.reason,
        });
      }
    }
  });
  return hits;
}

function uniqueOpaqueHits(
  values: readonly GeometryOpaqueBarrierHit[],
): GeometryOpaqueBarrierHit[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.side}:${value.sourceId}:${value.nodeId}:${value.range.start}:${value.range.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId)
    || a.range.start - b.range.start
    || a.range.end - b.range.end
    || a.nodeId.localeCompare(b.nodeId)
    || a.side.localeCompare(b.side));
}

function uniqueReasons(
  values: readonly GeometryFullReprojectReason[],
): GeometryFullReprojectReason[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stableSerialize(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Computes a conservative invalidation plan without mutating either snapshot.
 *
 * Ancestors are returned as the semantic read closure. Descendants are added to
 * changed entities because their derived values and render primitives may have
 * changed. Any opaque or unmapped edit requests a full re-projection.
 */
export function computeGeometryInvalidation(
  input: GeometryInvalidationInput,
): GeometryInvalidationResult {
  const { previous, current } = input;
  const fallbackReasons: GeometryFullReprojectReason[] = [];
  const previousBasis = previous.sourceMap.basis;
  const currentBasis = current.sourceMap.basis;
  if (
    previousBasis.documentId !== currentBasis.documentId
    || previousBasis.epoch !== currentBasis.epoch
    || (
      previousBasis.sourceId !== undefined
      && currentBasis.sourceId !== undefined
      && previousBasis.sourceId !== currentBasis.sourceId
    )
  ) {
    fallbackReasons.push({
      code: 'basis-mismatch',
      message: 'Previous and current source maps do not share a source identity',
    });
  }
  if (previousBasis.pluginSetDigest !== currentBasis.pluginSetDigest) {
    fallbackReasons.push({
      code: 'plugin-set-changed',
      message: 'The semantic plugin set changed between projections',
    });
  }
  if (currentBasis.revision < previousBasis.revision) {
    fallbackReasons.push({
      code: 'revision-regressed',
      message: 'Current source-map revision is older than the previous revision',
    });
  }
  if (currentBasis.revision > previousBasis.revision + 1) {
    fallbackReasons.push({
      code: 'revision-gap',
      message: 'Incremental source changes do not cover every intervening revision',
    });
  }
  if (
    currentBasis.revision === previousBasis.revision
    && currentBasis.sourceHash !== previousBasis.sourceHash
  ) {
    fallbackReasons.push({
      code: 'basis-mismatch',
      message: 'Equal revisions carry different source hashes',
    });
  }

  input.changes.forEach((change, changeIndex) => {
    if (
      !change.sourceId
      || !validRange(change.previousRange)
      || !validRange(change.currentRange)
    ) {
      fallbackReasons.push({
        code: 'invalid-source-range',
        message: 'Changed source ranges must be valid UTF-16 half-open ranges',
        changeIndex,
        sourceId: change.sourceId,
      });
    }
  });

  const previousEntriesByBinding = entriesByBindingId(previous.sourceMap);
  const currentEntriesByBinding = entriesByBindingId(current.sourceMap);
  const changedBindingIds = changedRecordIds(
    previous.ir.sourceBindings,
    current.ir.sourceBindings,
    bindingSignature,
  );
  for (const id of changedSourceMapBindingIds(previous.sourceMap, current.sourceMap)) {
    changedBindingIds.add(id);
  }

  const changedEntitySeeds = changedRecordIds(
    previous.ir.entities,
    current.ir.entities,
  );
  const changedConstraintIds = changedRecordIds(
    previous.ir.constraints,
    current.ir.constraints,
  );
  const changedRelationIds = changedRecordIds(
    previous.ir.relations,
    current.ir.relations,
  );
  const changedStyleIds = changedRecordIds(
    previous.ir.styles,
    current.ir.styles,
  );
  const changedRenderIds = new Set<string>();

  const previousRecords = recordMaps(previous);
  const currentRecords = recordMaps(current);
  const collectEntry = (entry: GeometrySourceMapEntry): void => {
    changedBindingIds.add(entry.bindingId);
    for (const entityId of entry.entityIds) changedEntitySeeds.add(entityId);
    for (const target of entry.semanticTargets) {
      if (target.recordType === 'entity') changedEntitySeeds.add(target.id);
      if (target.recordType === 'constraint') changedConstraintIds.add(target.id);
      if (target.recordType === 'relation') changedRelationIds.add(target.id);
      if (target.recordType === 'style') changedStyleIds.add(target.id);
    }
    for (const renderTarget of entry.renderTargets) {
      for (const id of renderTarget.primitiveIds) changedRenderIds.add(id);
    }
  };

  const touchedChanges = new Set<number>();
  input.changes.forEach((change, changeIndex) => {
    if (!validRange(change.previousRange) || !validRange(change.currentRange)) return;
    for (const entry of previous.sourceMap.entries) {
      if (
        entry.sourceId === change.sourceId
        && rangesTouch(entry.range, change.previousRange)
      ) {
        touchedChanges.add(changeIndex);
        collectEntry(entry);
      }
    }
    for (const entry of current.sourceMap.entries) {
      if (
        entry.sourceId === change.sourceId
        && rangesTouch(entry.range, change.currentRange)
      ) {
        touchedChanges.add(changeIndex);
        collectEntry(entry);
      }
    }
  });

  for (const bindingId of changedBindingIds) {
    for (const entry of previousEntriesByBinding.get(bindingId) ?? []) collectEntry(entry);
    for (const entry of currentEntriesByBinding.get(bindingId) ?? []) collectEntry(entry);
  }

  const barriers = uniqueOpaqueHits([
    ...opaqueHits(input.changes, previous, 'previous'),
    ...opaqueHits(input.changes, current, 'current'),
  ]);
  if (barriers.length > 0) {
    const nodeIds = sorted(barriers.map((barrier) => barrier.nodeId));
    fallbackReasons.push({
      code: 'opaque-barrier',
      message: 'A changed range intersects source whose semantics are opaque',
      opaqueNodeIds: nodeIds,
    });
    input.changes.forEach((change, changeIndex) => {
      if (barriers.some((barrier) =>
        barrier.sourceId === change.sourceId
        && rangesTouch(
          barrier.range,
          barrier.side === 'previous'
            ? change.previousRange
            : change.currentRange,
        ))) touchedChanges.add(changeIndex);
    });
  }

  input.changes.forEach((change, changeIndex) => {
    if (
      validRange(change.previousRange)
      && validRange(change.currentRange)
      && !touchedChanges.has(changeIndex)
    ) {
      fallbackReasons.push({
        code: 'unmapped-source-change',
        message: 'A changed source range has no source-map or opaque coverage',
        changeIndex,
        sourceId: change.sourceId,
      });
    }
  });

  const addConstraintEntities = (id: string): void => {
    for (const entityId of entityIdsOfConstraint(previousRecords.constraints.get(id))) {
      changedEntitySeeds.add(entityId);
    }
    for (const entityId of entityIdsOfConstraint(currentRecords.constraints.get(id))) {
      changedEntitySeeds.add(entityId);
    }
  };
  const addRelationEntities = (id: string): void => {
    for (const entityId of entityIdsOfRelation(previousRecords.relations.get(id))) {
      changedEntitySeeds.add(entityId);
    }
    for (const entityId of entityIdsOfRelation(currentRecords.relations.get(id))) {
      changedEntitySeeds.add(entityId);
    }
  };
  const addStyleEntities = (id: string): void => {
    for (const entityId of entityIdsOfStyle(previousRecords.styles.get(id))) {
      changedEntitySeeds.add(entityId);
    }
    for (const entityId of entityIdsOfStyle(currentRecords.styles.get(id))) {
      changedEntitySeeds.add(entityId);
    }
  };
  for (const id of changedConstraintIds) addConstraintEntities(id);
  for (const id of changedRelationIds) addRelationEntities(id);
  for (const id of changedStyleIds) addStyleEntities(id);

  const dependencyRelations = [
    ...previous.ir.relations,
    ...current.ir.relations,
    ...(input.dependencyRelations ?? []),
  ];
  const dependencyGraph = buildDependencyGraph(dependencyRelations);
  const maxDependencyNodes = typeof input.maxDependencyNodes === 'number'
    && Number.isFinite(input.maxDependencyNodes)
    ? Math.max(0, Math.floor(input.maxDependencyNodes))
    : 4_096;
  const ancestors = traverse(
    dependencyGraph.dependencies,
    changedEntitySeeds,
    maxDependencyNodes,
  );
  const descendants = traverse(
    dependencyGraph.dependents,
    changedEntitySeeds,
    maxDependencyNodes,
  );
  const closure = sorted([
    ...changedEntitySeeds,
    ...ancestors.ids,
    ...descendants.ids,
  ]);
  if (
    ancestors.truncated
    || descendants.truncated
    || closure.length > maxDependencyNodes
  ) {
    fallbackReasons.push({
      code: 'dependency-closure-limit',
      message: 'Dependency closure exceeded the configured incremental limit',
      limit: maxDependencyNodes,
    });
  }

  const changedEntityIds = new Set([
    ...changedEntitySeeds,
    ...descendants.ids,
  ]);
  const allConstraints = [
    ...previous.ir.constraints,
    ...current.ir.constraints,
  ];
  for (const constraint of allConstraints) {
    if (entityIdsOfConstraint(constraint).some((id) => changedEntityIds.has(id))) {
      changedConstraintIds.add(constraint.id);
    }
  }
  const allRelations = [
    ...previous.ir.relations,
    ...current.ir.relations,
    ...(input.dependencyRelations ?? []),
  ];
  for (const relation of allRelations) {
    if (entityIdsOfRelation(relation).some((id) => changedEntityIds.has(id))) {
      changedRelationIds.add(relation.id);
    }
  }

  const collectAffectedRenderIds = (sourceMap: GeometrySourceMap): void => {
    for (const entry of sourceMap.entries) {
      const affectedTarget = entry.semanticTargets.some((target) => (
        (target.recordType === 'entity' && changedEntityIds.has(target.id))
        || (
          target.recordType === 'constraint'
          && changedConstraintIds.has(target.id)
        )
        || (
          target.recordType === 'relation'
          && changedRelationIds.has(target.id)
        )
        || (target.recordType === 'style' && changedStyleIds.has(target.id))
      ));
      if (
        !affectedTarget
        && !entry.entityIds.some((id) => changedEntityIds.has(id))
      ) continue;
      for (const renderTarget of entry.renderTargets) {
        for (const id of renderTarget.primitiveIds) changedRenderIds.add(id);
      }
    }
  };
  collectAffectedRenderIds(previous.sourceMap);
  collectAffectedRenderIds(current.sourceMap);

  const reasons = uniqueReasons(fallbackReasons);
  return {
    changedBindingIds: sorted(changedBindingIds),
    changedEntityIds: sorted(changedEntityIds),
    changedConstraintIds: sorted(changedConstraintIds),
    changedRelationIds: sorted(changedRelationIds),
    changedRenderIds: sorted(changedRenderIds),
    dependencyAncestorIds: sorted(ancestors.ids),
    dependencyDescendantIds: sorted(descendants.ids),
    dependencyClosureIds: closure.slice(0, maxDependencyNodes),
    opaqueBarrier: {
      active: barriers.length > 0,
      requiresFullReproject: barriers.length > 0,
      hits: barriers,
    },
    fullReproject: reasons.length > 0,
    fullReprojectReason: reasons[0] ?? null,
    fallbackReasons: reasons,
  };
}
