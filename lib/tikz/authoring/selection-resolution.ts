import type {
  ConstructionBinding,
  GeometryEntity,
  GeometryRevisionBasis,
  GeometryTruthSet,
  RenderPrimitive,
  SourceRange,
} from '../ir/model';
import type { Statement } from '../subset/ast';
import {
  selectionRefsOf,
  sourceRangesOverlap,
  type SelectionTarget,
} from './selection-target';

export type InspectorSelectionState = 'none' | 'single' | 'multiple';
export type InspectorWriteMode =
  | 'direct'
  | 'managed-recompile'
  | 'read-only';

export interface InspectorWriteCapability {
  readonly mode: InspectorWriteMode;
  readonly bindingIds: readonly string[];
  readonly managedConstructionId?: string;
  readonly reason?: string;
}

/**
 * One revision-bound selection projection shared by the inspector, source
 * editor and canvas. It keeps semantic, rendering and construction identity
 * separate instead of reducing every selection to a legacy statement index.
 */
export interface InspectorSelectionResolution {
  readonly state: InspectorSelectionState;
  readonly key: string;
  readonly target: SelectionTarget | null;
  readonly refs: readonly string[];
  readonly sourceStableId?: string;
  readonly semanticEntityId?: string;
  readonly semanticEntity: GeometryEntity | null;
  readonly renderPrimitiveId?: string;
  readonly renderPrimitive: RenderPrimitive | null;
  readonly sourceBindingIds: readonly string[];
  readonly sourceRange?: SourceRange;
  readonly statementIndex: number | null;
  readonly statement: Statement | null;
  readonly statementRangeValidated: boolean;
  readonly semanticKind?: string;
  readonly label: string;
  readonly writeCapability: InspectorWriteCapability;
}

function sourceRangeKey(range: SourceRange | undefined): string {
  return range ? `${range.start}:${range.end}` : '-';
}

function targetKey(target: SelectionTarget): string {
  switch (target.kind) {
    case 'entity':
      return [
        'entity',
        target.stableId,
        target.semanticEntityId ?? '-',
        target.renderPrimitiveId ?? '-',
        sourceRangeKey(target.sourceRange),
      ].join(':');
    case 'statement':
      return [
        'statement',
        target.stmtIndex,
        target.semanticEntityId ?? '-',
        target.renderPrimitiveId ?? '-',
        sourceRangeKey(target.sourceRange),
      ].join(':');
    case 'source-block':
      return [
        'source-block',
        target.sourceRevision,
        sourceRangeKey(target.range),
      ].join(':');
    case 'pending-ref':
      return `pending-ref:${target.sourceRevision}:${target.ref}`;
  }
}

function metadataString(
  primitive: RenderPrimitive,
  key: string,
): string | undefined {
  const value = primitive.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function metadataStatementIndex(
  primitive: RenderPrimitive | null,
): number | null {
  const value = primitive?.metadata?.statementIndex;
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function exactRange(first: SourceRange, second: SourceRange): boolean {
  return first.start === second.start && first.end === second.end;
}

function statementResolution(
  statements: readonly Statement[] | null | undefined,
  requestedIndex: number | null,
  sourceRange: SourceRange | undefined,
): {
  statementIndex: number | null;
  statement: Statement | null;
  statementRangeValidated: boolean;
} {
  if (!statements) {
    return {
      statementIndex: null,
      statement: null,
      statementRangeValidated: false,
    };
  }

  if (sourceRange) {
    const indexed = requestedIndex === null
      ? undefined
      : statements[requestedIndex];
    if (indexed && exactRange(indexed.range, sourceRange)) {
      return {
        statementIndex: requestedIndex,
        statement: indexed,
        statementRangeValidated: true,
      };
    }
    const exactIndex = statements.findIndex((statement) => (
      exactRange(statement.range, sourceRange)
    ));
    if (exactIndex >= 0) {
      return {
        statementIndex: exactIndex,
        statement: statements[exactIndex]!,
        statementRangeValidated: true,
      };
    }
    return {
      statementIndex: null,
      statement: null,
      statementRangeValidated: false,
    };
  }

  if (requestedIndex !== null && statements[requestedIndex]) {
    return {
      statementIndex: requestedIndex,
      statement: statements[requestedIndex]!,
      statementRangeValidated: true,
    };
  }
  return {
    statementIndex: null,
    statement: null,
    statementRangeValidated: false,
  };
}

function emptyResolution(
  state: Extract<InspectorSelectionState, 'none' | 'multiple'>,
  targets: readonly SelectionTarget[],
): InspectorSelectionResolution {
  const refs = selectionRefsOf(targets);
  return {
    state,
    key: state === 'none'
      ? 'selection:none'
      : `selection:multiple:${targets.map(targetKey).join('|')}`,
    target: null,
    refs,
    semanticEntity: null,
    renderPrimitive: null,
    sourceBindingIds: [],
    statementIndex: null,
    statement: null,
    statementRangeValidated: false,
    label: state === 'none' ? '未选择' : `${targets.length} 个对象`,
    writeCapability: {
      mode: 'read-only',
      bindingIds: [],
      reason: state === 'none' ? 'no-selection' : 'multi-selection-unresolved',
    },
  };
}

function sameCurrentBasis(
  truth: GeometryTruthSet | null,
  basis: GeometryRevisionBasis,
): truth is GeometryTruthSet {
  if (!truth) return false;
  const actual = truth.semantic.basis;
  return (
    actual.documentId === basis.documentId
    && actual.epoch === basis.epoch
    && actual.revision === basis.revision
    && actual.sourceHash === basis.sourceHash
    && actual.sourceId === basis.sourceId
    && actual.pluginSetDigest === basis.pluginSetDigest
  );
}

function primitiveByUniqueSourceBinding(
  primitives: readonly RenderPrimitive[],
  targetBindingIds: readonly string[],
  truth: GeometryTruthSet | null,
): RenderPrimitive | null {
  if (!truth || targetBindingIds.length === 0) return null;
  const bindingsById = new Map(
    truth.construction.bindings.map((binding) => [binding.id, binding] as const),
  );
  // A block-level managed binding may target many records and therefore cannot
  // identify a single painted primitive. Only bindings with one entity target
  // are admissible recovery keys.
  const uniqueEntityBindingIds = new Set(targetBindingIds.filter((id) => {
    const binding = bindingsById.get(id);
    return (
      binding?.targets.length === 1
      && binding.targets[0]?.recordType === 'entity'
    );
  }));
  if (uniqueEntityBindingIds.size === 0) return null;
  const candidates = primitives.flatMap((primitive) => {
    const score = primitive.sourceBindingIds?.filter(
      (id) => uniqueEntityBindingIds.has(id),
    ).length ?? 0;
    return score > 0 ? [{ primitive, score }] : [];
  }).sort((first, second) => second.score - first.score);
  if (candidates.length === 0) return null;
  if (
    candidates.length > 1
    && candidates[0]!.score === candidates[1]!.score
  ) return null;
  return candidates[0]!.primitive;
}

function bindingMetadataString(
  binding: ConstructionBinding,
  key: string,
): string | undefined {
  const value = binding.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function writeCapabilityOf(
  sourceBindingIds: readonly string[],
  truth: GeometryTruthSet | null,
  basis: GeometryRevisionBasis,
): InspectorWriteCapability {
  if (!sameCurrentBasis(truth, basis)) {
    return {
      mode: 'read-only',
      bindingIds: sourceBindingIds,
      reason: 'stale-or-mismatched-construction-truth',
    };
  }
  if (sourceBindingIds.length === 0) {
    return {
      mode: 'read-only',
      bindingIds: [],
      reason: 'selection-has-no-source-binding',
    };
  }
  const byId = new Map(
    truth.construction.bindings.map((binding) => [binding.id, binding] as const),
  );
  const bindings = sourceBindingIds.flatMap((id) => {
    const binding = byId.get(id);
    return binding ? [binding] : [];
  });
  if (bindings.length !== sourceBindingIds.length) {
    return {
      mode: 'read-only',
      bindingIds: sourceBindingIds,
      reason: 'unresolved-source-binding',
    };
  }
  const sourceAttested = bindings.every((binding) => (
    binding.source.document.sourceId === basis.sourceId
    && binding.source.document.revision === basis.revision
    && binding.source.document.hash === basis.sourceHash
  ));
  if (!sourceAttested) {
    return {
      mode: 'read-only',
      bindingIds: sourceBindingIds,
      reason: 'source-binding-basis-mismatch',
    };
  }
  if (bindings.every((binding) => binding.writable)) {
    return {
      mode: 'direct',
      bindingIds: sourceBindingIds,
    };
  }
  const managedIds = new Set(bindings.flatMap((binding) => {
    const id = (
      bindingMetadataString(binding, 'managedConstructionId')
      ?? bindingMetadataString(binding, 'constructionId')
    );
    return id ? [id] : [];
  }));
  const managedOnly = bindings.every((binding) => (
    !binding.writable
    && bindingMetadataString(binding, 'writePolicy')
      === 'managed-recompile-only'
  ));
  if (managedOnly && managedIds.size === 1) {
    return {
      mode: 'managed-recompile',
      bindingIds: sourceBindingIds,
      managedConstructionId: [...managedIds][0],
    };
  }
  return {
    mode: 'read-only',
    bindingIds: sourceBindingIds,
    reason: 'source-binding-is-not-writable',
  };
}

export function resolveInspectorSelection({
  targets,
  truth,
  statements,
  statementRevision,
  currentBasis,
  sourceRevision,
}: {
  targets: readonly SelectionTarget[];
  truth: GeometryTruthSet | null;
  statements: readonly Statement[] | null | undefined;
  statementRevision: number | null;
  currentBasis: GeometryRevisionBasis;
  sourceRevision: number;
}): InspectorSelectionResolution {
  if (targets.length === 0) return emptyResolution('none', targets);
  if (targets.length !== 1) return emptyResolution('multiple', targets);

  const target = targets[0]!;
  const refs = selectionRefsOf(targets);
  const currentTruth = sameCurrentBasis(truth, currentBasis) ? truth : null;
  const primitives = currentTruth?.rendering.flatMap(
    (rendering) => rendering.primitives,
  ) ?? [];
  const targetSemanticEntityId = (
    target.kind === 'entity' || target.kind === 'statement'
  )
    ? target.semanticEntityId
    : undefined;
  const targetRenderPrimitiveId = (
    target.kind === 'entity' || target.kind === 'statement'
  )
    ? target.renderPrimitiveId
    : undefined;
  const targetStableId = target.kind === 'entity'
    ? target.stableId
    : undefined;
  const targetSourceBindingIds = (
    target.kind === 'entity' || target.kind === 'statement'
  )
    ? target.sourceBindingIds ?? []
    : [];
  const renderPrimitive = (
    primitives.find((primitive) => primitive.id === targetRenderPrimitiveId)
    ?? primitives.find((primitive) => (
      targetStableId !== undefined
      && metadataString(primitive, 'sourceStableId') === targetStableId
    ))
    ?? primitives.find((primitive) => (
      targetSemanticEntityId !== undefined
      && primitive.entityIds.includes(targetSemanticEntityId)
    ))
    ?? primitiveByUniqueSourceBinding(
      primitives,
      targetSourceBindingIds,
      currentTruth,
    )
    ?? null
  );
  const semanticEntityId = (
    renderPrimitive?.entityIds[0]
    ?? targetSemanticEntityId
    ?? targetStableId
  );
  const semanticEntity = semanticEntityId
    ? currentTruth?.semantic.ir.entities.find(
      (entity) => entity.id === semanticEntityId,
    ) ?? null
    : null;
  const sourceRange = (() => {
    if (target.kind === 'source-block') {
      return target.sourceRevision === sourceRevision
        ? target.range
        : undefined;
    }
    if (target.kind === 'entity' || target.kind === 'statement') {
      // Entity/statement ranges are not revision tagged. Once the current
      // primitive cannot be re-attested, retaining an old range could point at
      // a different statement after a managed whole-block replacement.
      return renderPrimitive?.sourceRange;
    }
    return undefined;
  })();
  const requestedStatementIndex = (() => {
    if (target.kind === 'entity' || target.kind === 'statement') {
      return metadataStatementIndex(renderPrimitive) ?? target.stmtIndex;
    }
    if (
      target.kind === 'source-block'
      && target.sourceRevision === sourceRevision
      && statements
    ) {
      const matches = statements.flatMap((statement, index) => (
        sourceRangesOverlap(target.range, statement.range) ? [index] : []
      ));
      return matches.length === 1 ? matches[0]! : null;
    }
    return metadataStatementIndex(renderPrimitive);
  })();
  const resolvedStatement = statementResolution(
    statementRevision === sourceRevision ? statements : null,
    requestedStatementIndex,
    sourceRange,
  );
  const currentBindingIds = [
    ...(renderPrimitive?.sourceBindingIds ?? []),
    ...(semanticEntity?.sourceBindingIds ?? []),
  ];
  const sourceBindingIds = [...new Set(
    currentBindingIds.length > 0
      ? currentBindingIds
      : (
        target.kind === 'entity' || target.kind === 'statement'
          ? target.sourceBindingIds ?? []
          : []
      ),
  )];
  const semanticKind = semanticEntity?.kind ?? renderPrimitive?.kind;
  const semanticLabel = semanticEntity?.name
    ?? (
      semanticKind && refs.length > 0
        ? `${semanticKind} · ${refs.join('–')}`
        : semanticKind
    );

  return {
    state: 'single',
    key: [
      'selection:single',
      targetKey(target),
      semanticEntityId ?? '-',
      renderPrimitive?.id ?? '-',
      sourceRangeKey(sourceRange),
      currentTruth?.semantic.basis.revision ?? 'stale',
    ].join(':'),
    target,
    refs,
    sourceStableId:
      renderPrimitive
        ? metadataString(renderPrimitive, 'sourceStableId')
        : targetStableId,
    semanticEntityId,
    semanticEntity,
    renderPrimitiveId: renderPrimitive?.id ?? targetRenderPrimitiveId,
    renderPrimitive,
    sourceBindingIds,
    sourceRange,
    statementIndex: resolvedStatement.statementIndex,
    statement: resolvedStatement.statement,
    statementRangeValidated: resolvedStatement.statementRangeValidated,
    semanticKind,
    label: semanticLabel ?? (refs.length > 0 ? refs.join(', ') : '源码对象'),
    writeCapability: writeCapabilityOf(
      sourceBindingIds,
      currentTruth,
      currentBasis,
    ),
  };
}
