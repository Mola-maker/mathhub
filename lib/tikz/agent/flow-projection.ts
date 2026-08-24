import type { GeometryDoc } from '../ir/geometry-doc';

export interface GeometryFlowProjection {
  readonly entityIds: readonly string[];
  readonly unresolvedRefs: readonly string[];
  /** Last source statement needed to reveal every resolved proof-step entity. */
  readonly revealThroughStatementIndex: number | null;
}

/**
 * Resolve a read-only proof-flow step against one revision-bound GeometryDoc.
 * Names must be unique; ambiguous or stale model output never broadens focus.
 */
export function projectGeometryFlowEntityRefs(
  geometryDoc: GeometryDoc | null | undefined,
  refs: readonly string[],
): GeometryFlowProjection {
  if (!geometryDoc) {
    return {
      entityIds: [],
      unresolvedRefs: [...new Set(refs)],
      revealThroughStatementIndex: null,
    };
  }
  const entityIds: string[] = [];
  const unresolvedRefs: string[] = [];
  for (const ref of [...new Set(refs)]) {
    const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
      entity.id === ref || entity.name === ref
    ));
    if (matches.length !== 1) {
      unresolvedRefs.push(ref);
      continue;
    }
    entityIds.push(matches[0]!.id);
  }
  const entitySet = new Set(entityIds);
  const statementIndices = geometryDoc.rendering.flatMap((truth) => (
    truth.status !== 'complete'
      ? []
      : truth.primitives.flatMap((primitive) => {
        if (!primitive.entityIds.some((id) => entitySet.has(id))) return [];
        const value = primitive.metadata?.statementIndex;
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? [value]
          : [];
      })
  ));
  return {
    entityIds: [...new Set(entityIds)].sort(),
    unresolvedRefs,
    revealThroughStatementIndex: statementIndices.length > 0
      ? Math.max(...statementIndices)
      : null,
  };
}
