import type { TextPatch } from '../document/source-transaction';
import type { GeometryDoc } from '../ir/geometry-doc';
import { buildDependencyGraph } from '../ir/invalidation';
import type { GeometryEntity, SourceRange } from '../ir/model';
import type { Statement } from '../subset/ast';
import {
  expandManagedConstructionDeletions,
  statementDeletionPatches,
  type DeletionDependencyGraph,
  type DeleteMode,
  type DeletePlan,
  type DeletePreviewItem,
} from './delete-transaction';

export type GeometryDeleteTarget =
  | string
  | {
    readonly semanticEntityId?: string | null;
    readonly sourceBindingIds?: readonly string[];
    readonly sourceRange?: SourceRange | null;
    readonly stmtIndex?: number | null;
  };

export interface GeometryDocDeletePlanInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  /** Lossless CST statements are used only to map authorized owners to ranges. */
  readonly statements: readonly Statement[];
  readonly targets: GeometryDeleteTarget | readonly GeometryDeleteTarget[];
  readonly mode: DeleteMode;
}

export class GeometryDeletePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryDeletePlanError';
  }
}

function overlaps(left: SourceRange, right: SourceRange): boolean {
  return left.start < right.end && left.end > right.start;
}

/**
 * A TextPatch addresses source as {from,to} while a SourceRange uses
 * {start,end}. Comparing a patch as if it were a range reads undefined offsets,
 * so managed-block expansion would never fire and owned entities would be left
 * behind as dangling references.
 */
function patchRange(patch: TextPatch): SourceRange {
  return { start: patch.from, end: patch.to };
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function referencesOf(entity: GeometryEntity): string[] {
  const value = entity.parameters?.references;
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function addDependency(
  dependencies: Map<string, Set<string>>,
  dependents: Map<string, Set<string>>,
  dependent: string,
  dependency: string,
): void {
  if (dependent === dependency) return;
  const reads = dependencies.get(dependent) ?? new Set<string>();
  reads.add(dependency);
  dependencies.set(dependent, reads);
  const downstream = dependents.get(dependency) ?? new Set<string>();
  downstream.add(dependent);
  dependents.set(dependency, downstream);
}

function semanticDependencyGraph(doc: GeometryDoc) {
  const graph = buildDependencyGraph(doc.semantic.ir.relations);
  const entities = doc.semantic.ir.entities;
  const entityIds = new Set(entities.map((entity) => entity.id));
  const idsByName = new Map<string, string | null>();
  for (const entity of entities) {
    if (!entity.name) continue;
    idsByName.set(
      entity.name,
      idsByName.has(entity.name) ? null : entity.id,
    );
  }
  const resolve = (reference: string): string | null => {
    if (entityIds.has(reference)) return reference;
    return idsByName.get(reference) ?? null;
  };

  for (const entity of entities) {
    for (const reference of referencesOf(entity)) {
      const dependency = resolve(reference);
      if (dependency) {
        addDependency(graph.dependencies, graph.dependents, entity.id, dependency);
      }
    }
  }

  // Raw point-on-circle syntax historically exposed center/through arguments
  // but not the host circle ID. Bind the dependency only when the current
  // GeometryDoc identifies one unique circle with the same direct definition.
  for (const constraint of doc.semantic.ir.constraints) {
    if (constraint.kind !== 'point-on-circle') continue;
    const pointId = constraint.arguments.find((argument) => (
      argument.role === 'point'
    ))?.entityId;
    const explicitCircleId = constraint.arguments.find((argument) => (
      argument.role === 'circle'
    ))?.entityId;
    if (!pointId || !entityIds.has(pointId)) continue;
    if (explicitCircleId && entityIds.has(explicitCircleId)) {
      addDependency(
        graph.dependencies,
        graph.dependents,
        pointId,
        explicitCircleId,
      );
      continue;
    }
    const centerId = constraint.arguments.find((argument) => (
      argument.role === 'center'
    ))?.entityId;
    const throughId = constraint.arguments.find((argument) => (
      argument.role === 'through'
    ))?.entityId;
    const centerName = centerId
      ? doc.semantic.ir.entities.find((entity) => entity.id === centerId)?.name
      : undefined;
    const throughName = throughId
      ? doc.semantic.ir.entities.find((entity) => entity.id === throughId)?.name
      : undefined;
    const constrainedRadius = typeof constraint.parameters?.radius === 'number'
      && Number.isFinite(constraint.parameters.radius)
      ? constraint.parameters.radius
      : null;
    if (!centerName) continue;
    const candidates = entities.filter((entity) => {
      if (entity.kind !== 'circle') return false;
      const definition = entity.parameters?.circleDefinition;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        return false;
      }
      const record = definition as Record<string, unknown>;
      if (record.centerName !== centerName) return false;
      return throughName
        ? record.kind === 'center-through' && record.throughName === throughName
        : record.kind === 'center-radius'
          && constrainedRadius !== null
          && typeof entity.parameters?.radius === 'number'
          && Number.isFinite(entity.parameters.radius)
          && Math.abs(entity.parameters.radius - constrainedRadius) <= 1e-9;
    });
    if (candidates.length === 1) {
      addDependency(
        graph.dependencies,
        graph.dependents,
        pointId,
        candidates[0]!.id,
      );
    }
  }
  return graph;
}

function descendantClosure(
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
  seeds: Iterable<string>,
): Set<string> {
  const result = new Set<string>();
  const queue = [...seeds].sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (result.has(dependent)) continue;
      result.add(dependent);
      queue.push(dependent);
      queue.sort();
    }
  }
  return result;
}

function semanticPlanGraph(
  doc: GeometryDoc,
  ownerStatements: (entityId: string) => number[],
  statements: readonly Statement[],
  graph: ReturnType<typeof semanticDependencyGraph>,
): DeletionDependencyGraph {
  const nodes = new Map(doc.semantic.ir.entities.map((entity) => {
    const owners = ownerStatements(entity.id);
    const stmtIndex = owners.length === 1 ? owners[0]! : null;
    const kind = entity.kind === 'point'
      ? 'point' as const
      : entity.kind === 'named-path'
        ? 'path' as const
        : 'element' as const;
    return [entity.id, {
      id: entity.id,
      stableId: entity.id,
      kind,
      name: entity.name ?? null,
      stmtIndex,
      range: stmtIndex === null ? null : statements[stmtIndex]?.range ?? null,
      refs: referencesOf(entity),
      dependencies: sorted(graph.dependencies.get(entity.id) ?? []),
      dependents: sorted(graph.dependents.get(entity.id) ?? []),
    }] as const;
  }));
  const byStableId = new Map(
    [...nodes.keys()].map((entityId) => [entityId, [entityId]] as const),
  );
  const byStmtIndex = new Map<number, string>();
  for (const node of nodes.values()) {
    if (node.stmtIndex !== null && !byStmtIndex.has(node.stmtIndex)) {
      byStmtIndex.set(node.stmtIndex, node.id);
    }
  }
  const ancestors = new Map([...nodes.keys()].map((entityId) => [
    entityId,
    sorted(descendantClosure(graph.dependencies, [entityId])),
  ] as const));
  const descendants = new Map([...nodes.keys()].map((entityId) => [
    entityId,
    sorted(descendantClosure(graph.dependents, [entityId])),
  ] as const));
  return { nodes, byStableId, byStmtIndex, ancestors, descendants };
}

/**
 * GeometryDoc owns target identity, ownership and dependency closure. The CST
 * contributes ranges only after that closure is fixed; no Scene graph is
 * consulted and whole managed-block expansion is folded back into the entity
 * closure before a plan is returned.
 */
export function planGeometryDocDeletion(
  input: GeometryDocDeletePlanInput,
): DeletePlan {
  if (input.mode === 'detach') {
    throw new GeometryDeletePlanError(
      'GeometryDoc deletion does not permit detach until typed upstream rewrites exist.',
    );
  }
  const sourceId = input.geometryDoc.basis.sourceId;
  const sourceDocument = input.geometryDoc.construction.sources.find((source) => (
    source.sourceId === sourceId
  ));
  if (
    !sourceId
    || !sourceDocument
    || sourceDocument.text !== input.source
    || sourceDocument.revision !== input.geometryDoc.basis.revision
    || sourceDocument.hash !== input.geometryDoc.basis.sourceHash
    || input.geometryDoc.semantic.status !== 'complete'
  ) {
    throw new GeometryDeletePlanError(
      'GeometryDoc deletion requires one complete current source projection.',
    );
  }

  const entitiesById = new Map(
    input.geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity] as const),
  );
  const statementRanges = input.statements.map((statement) => statement.range);
  // Ownership is narrower than association. sourceMap.entityIds also contains
  // constraint/relation participants, including external inputs; only an
  // explicit entity target defines source that may be deleted with that entity.
  const owningEntries = input.geometryDoc.sourceMap.entries.filter((entry) => (
    entry.sourceId === sourceId
    && entry.semanticTargets.some((target) => target.recordType === 'entity')
  ));
  const ownedEntityIds = (entry: typeof owningEntries[number]): string[] => (
    entry.semanticTargets.flatMap((target) => (
      target.recordType === 'entity' ? [target.id] : []
    ))
  );
  const ownerStatements = (entityId: string): number[] => sortedNumbers(
    owningEntries
      .filter((entry) => ownedEntityIds(entry).includes(entityId))
      .flatMap((entry) => statementRanges.flatMap((range, stmtIndex) => (
        overlaps(entry.range, range) ? [stmtIndex] : []
      ))),
  );
  const entitiesOwnedByStatements = (statementIndices: ReadonlySet<number>): Set<string> => (
    new Set(owningEntries.flatMap((entry) => {
      const ownsSelectedStatement = statementRanges.some((range, stmtIndex) => (
        statementIndices.has(stmtIndex) && overlaps(entry.range, range)
      ));
      if (!ownsSelectedStatement) return [];
      return ownedEntityIds(entry);
    }).filter((entityId) => entitiesById.has(entityId)))
  );

  const requested = Array.isArray(input.targets) ? input.targets : [input.targets];
  const rootEntityIds = new Set<string>();
  for (const target of requested) {
    const candidates = new Set<string>();
    if (typeof target === 'string') {
      if (entitiesById.has(target)) candidates.add(target);
      const named = input.geometryDoc.semantic.ir.entities.filter((entity) => (
        entity.name === target
      ));
      if (named.length === 1) candidates.add(named[0]!.id);
    } else {
      const range = target.sourceRange
        ?? (target.stmtIndex !== null && target.stmtIndex !== undefined
          ? input.statements[target.stmtIndex]?.range
          : undefined);
      if (target.semanticEntityId && entitiesById.has(target.semanticEntityId)) {
        const explicitEntityId = target.semanticEntityId;
        const bindingIds = target.sourceBindingIds ?? [];
        if (
          bindingIds.length > 0
          && !input.geometryDoc.sourceMap.entries.some((entry) => (
            bindingIds.includes(entry.bindingId)
            && entry.entityIds.includes(explicitEntityId)
          ))
        ) {
          throw new GeometryDeletePlanError(
            `Selected entity ${explicitEntityId} is not attested by its source bindings.`,
          );
        }
        if (
          range
          && !owningEntries.some((entry) => (
            ownedEntityIds(entry).includes(explicitEntityId)
            && overlaps(entry.range, range)
          ))
        ) {
          throw new GeometryDeletePlanError(
            `Selected entity ${explicitEntityId} is not owned by the selected source range.`,
          );
        }
        candidates.add(explicitEntityId);
      } else {
        for (const bindingId of target.sourceBindingIds ?? []) {
          for (const entry of input.geometryDoc.sourceMap.entries) {
            if (entry.bindingId !== bindingId) continue;
            for (const entityId of ownedEntityIds(entry)) {
              if (entitiesById.has(entityId)) candidates.add(entityId);
            }
          }
        }
        if (range) {
          for (const entry of owningEntries) {
            if (!overlaps(entry.range, range)) continue;
            for (const entityId of ownedEntityIds(entry)) {
              if (entitiesById.has(entityId)) candidates.add(entityId);
            }
          }
        }
      }
    }
    if (candidates.size !== 1) {
      throw new GeometryDeletePlanError(
        `Delete target must resolve to one GeometryDoc entity; found ${candidates.size}.`,
      );
    }
    rootEntityIds.add([...candidates][0]!);
  }
  if (rootEntityIds.size === 0) {
    throw new GeometryDeletePlanError('GeometryDoc deletion has no semantic roots.');
  }

  const rootStatementIndices = new Set<number>();
  for (const entityId of rootEntityIds) {
    const owners = ownerStatements(entityId);
    if (owners.length === 0) {
      throw new GeometryDeletePlanError(
        `Semantic entity ${entityId} has no direct source owner.`,
      );
    }
    owners.forEach((stmtIndex) => rootStatementIndices.add(stmtIndex));
  }
  const sourceRootEntityIds = entitiesOwnedByStatements(rootStatementIndices);
  rootEntityIds.forEach((entityId) => sourceRootEntityIds.add(entityId));
  const dependencyGraph = semanticDependencyGraph(input.geometryDoc);
  const downstream = descendantClosure(
    dependencyGraph.dependents,
    sourceRootEntityIds,
  );

  const affectedEntityIds = new Set(sourceRootEntityIds);
  if (input.mode === 'block') {
    const externalDependents = [...downstream].filter((entityId) => (
      !sourceRootEntityIds.has(entityId)
    ));
    if (externalDependents.length > 0) {
      throw new GeometryDeletePlanError(
        `GeometryDoc deletion is blocked by ${externalDependents.length} dependent entities.`,
      );
    }
  } else {
    downstream.forEach((entityId) => affectedEntityIds.add(entityId));
    let changed = true;
    while (changed) {
      changed = false;
      const ownedStatements = new Set<number>();
      for (const entityId of affectedEntityIds) {
        const owners = ownerStatements(entityId);
        if (owners.length === 0) {
          throw new GeometryDeletePlanError(
            `Dependent entity ${entityId} has no direct source owner.`,
          );
        }
        owners.forEach((stmtIndex) => ownedStatements.add(stmtIndex));
      }
      for (const peer of entitiesOwnedByStatements(ownedStatements)) {
        if (!affectedEntityIds.has(peer)) {
          affectedEntityIds.add(peer);
          changed = true;
        }
      }
      for (const dependent of descendantClosure(
        dependencyGraph.dependents,
        affectedEntityIds,
      )) {
        if (!affectedEntityIds.has(dependent)) {
          affectedEntityIds.add(dependent);
          changed = true;
        }
      }
    }
  }

  let expectedStatementIndices: number[] = [];
  let patches: DeletePlan['patches'] = [];
  let diagnostics: DeletePlan['diagnostics'] = [];
  while (true) {
    for (const entityId of affectedEntityIds) {
      if (ownerStatements(entityId).length === 0) {
        throw new GeometryDeletePlanError(
          `Affected entity ${entityId} has no direct source owner.`,
        );
      }
    }
    expectedStatementIndices = sortedNumbers(
      [...affectedEntityIds].flatMap(ownerStatements),
    );
    const sourcePatchResult = statementDeletionPatches(
      input.source,
      input.statements,
      expectedStatementIndices,
    );
    if (sourcePatchResult.diagnostics.some((diagnostic) => (
      diagnostic.severity === 'error'
    ))) {
      throw new GeometryDeletePlanError(
        'GeometryDoc deletion could not map its semantic closure to safe source ranges.',
      );
    }
    const expanded = expandManagedConstructionDeletions(
      input.source,
      sourcePatchResult.patches,
    ).sort((left, right) => left.from - right.from || left.to - right.to);
    if (
      expanded.length === 0
      || expanded.some((patch, index) => (
        patch.insert !== ''
        || patch.from < 0
        || patch.to <= patch.from
        || patch.to > input.source.length
        || (index > 0 && patch.from < expanded[index - 1]!.to)
      ))
    ) {
      throw new GeometryDeletePlanError(
        'GeometryDoc deletion produced empty, overlapping, or invalid source patches.',
      );
    }
    let changed = false;
    for (const entry of owningEntries) {
      if (!expanded.some((patch) => overlaps(patchRange(patch), entry.range))) continue;
      for (const entityId of ownedEntityIds(entry)) {
        if (!entitiesById.has(entityId) || affectedEntityIds.has(entityId)) continue;
        affectedEntityIds.add(entityId);
        changed = true;
      }
    }
    const patchDependents = descendantClosure(
      dependencyGraph.dependents,
      affectedEntityIds,
    );
    const externalDependents = [...patchDependents].filter((entityId) => (
      !affectedEntityIds.has(entityId)
    ));
    if (input.mode === 'block' && externalDependents.length > 0) {
      throw new GeometryDeletePlanError(
        `GeometryDoc deletion is blocked by ${externalDependents.length} dependent entities.`,
      );
    }
    if (input.mode === 'cascade') {
      for (const entityId of externalDependents) {
        affectedEntityIds.add(entityId);
        changed = true;
      }
    }
    if (!changed) {
      patches = expanded;
      diagnostics = sourcePatchResult.diagnostics;
      break;
    }
  }

  const roots = sorted(rootEntityIds);
  const affected = sorted(affectedEntityIds);
  const graph = semanticPlanGraph(
    input.geometryDoc,
    ownerStatements,
    input.statements,
    dependencyGraph,
  );
  const preview: DeletePreviewItem[] = affected.flatMap((entityId) => {
    const node = graph.nodes.get(entityId);
    return node ? [{
      nodeId: entityId,
      stableId: node.stableId,
      kind: node.kind,
      name: node.name,
      stmtIndex: node.stmtIndex,
      range: node.range,
      action: 'delete' as const,
      dependencies: node.dependencies,
      dependents: node.dependents,
    }] : [];
  });
  return {
    mode: input.mode,
    graph,
    requested: roots,
    resolved: roots.flatMap((entityId) => {
      const node = graph.nodes.get(entityId);
      return node ? [{ target: entityId, node }] : [];
    }),
    rootNodeIds: roots,
    sourceRootNodeIds: sorted(sourceRootEntityIds),
    affectedNodeIds: affected,
    removedNodeIds: affected,
    detachedNodeIds: [],
    blockedNodeIds: [],
    removedStatementIndices: expectedStatementIndices,
    detachedStatementIndices: [],
    patches,
    diagnostics,
    preview,
    canApply: true,
  };
}
