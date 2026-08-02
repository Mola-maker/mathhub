'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { analyze, type Analysis, type AnalysisIssue } from '@/lib/tikz/analyze';
import {
  minimalTextPatch,
  StudioDocument,
  type SourceEditOrigin,
  type TextPatch,
} from '@/lib/tikz/document/studio-document';
import { EntityIdentityRegistry } from '@/lib/tikz/document/entity-identity';
import {
  isUsableSemanticProjection,
  resolveProjectionGate,
  type ProjectionWritebackBlockedReason,
  type SemanticProjectionState,
} from '@/lib/tikz/document/projection-gate';
import { CM_TO_PX, type Viewport } from '@/lib/tikz/render/viewport';
import type { Scene } from '@/lib/tikz/semantics/scene';
import type { SourceRange, Statement } from '@/lib/tikz/subset/ast';
import {
  planDeletion,
  type DeleteMode,
} from '@/lib/tikz/authoring/delete-transaction';
import {
  selectionRefsOf,
  sourceRangesOverlap,
  type SelectionTarget,
} from '@/lib/tikz/authoring/selection-target';
import {
  resolveInspectorSelection,
  type InspectorSelectionResolution,
} from '@/lib/tikz/authoring/selection-resolution';
import { managedStyleRecompilePatches } from '@/lib/tikz/authoring/managed-construction-recompile';
import {
  buildGeometrySourceMap,
  computeGeometryInvalidation,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_SEMANTIC_ADAPTER_ID,
  TIKZ_SEMANTIC_ADAPTER_VERSION,
  type GeometryInvalidationResult,
  type GeometrySourceMap,
  type GeometryTransactionRequest,
  type GeometryTruthSet,
  type GeometryUtf16SourceChange,
} from '@/lib/tikz/ir';
import { hashSource } from '@/lib/tikz/semantics/scene-manifest';
import {
  TikzTransactionBroker,
  type SourceHashEvidence,
  type TikzTransactionBrokerResult,
} from '@/lib/tikz/transactions';

const EMPTY_EPHEMERAL_STYLES: Readonly<Record<string, never>> = Object.freeze({});
const LOCAL_SEMANTIC_PLUGIN_DIGEST =
  `${TIKZ_SEMANTIC_ADAPTER_ID}@${TIKZ_SEMANTIC_ADAPTER_VERSION}`;

interface LocalGeometryProjection {
  truths: GeometryTruthSet;
  sourceMap: GeometrySourceMap;
}

export interface InspectorSourcePatchResult {
  ok: boolean;
  code:
    | 'committed'
    | 'projection-writeback-blocked'
    | 'direct-commit-rejected'
    | 'managed-property-requires-semantic-recompile'
    | 'managed-recompile-rejected'
    | 'source-binding-read-only';
  message?: string;
}

export interface TikzEngine {
  document: StudioDocument;
  code: string;
  revision: number;
  lastEditOrigin: SourceEditOrigin | null;
  interactiveWritebackSafe: boolean;
  writebackBlockedReason: ProjectionWritebackBlockedReason | null;
  semanticProjectionState: SemanticProjectionState;
  semanticRevision: number | null;
  projection: Analysis;
  scene: Scene | null;
  stmts: Statement[] | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
  /** Stable deletion/edit identity. `selection` below is display-only refs. */
  selectionTargets: readonly SelectionTarget[];
  selection: string[];
  /** Revision-bound semantic/render/source resolution for the inspector. */
  inspectorSelection: InspectorSelectionResolution;
  selectedStmtIndex: number | null;
  hoveredStmtIndex: number | null;
  activeTool: string;
  viewport: Viewport;
  ephemeralStyles: Readonly<Record<string, never>>;
  /** Current usable revision-bound semantic/construction/render truth set. */
  geometryTruth: GeometryTruthSet | null;
  geometrySourceMap: GeometrySourceMap | null;
  /**
   * Conservative changed-range → dependency-subgraph plan. `fullReproject`
   * remains authoritative when opaque syntax or revision gaps are present.
   */
  geometryInvalidation: GeometryInvalidationResult | null;
  setCode(next: string): void;
  replaceCode(next: string, origin: SourceEditOrigin): boolean;
  applyPatch(next: string): void;
  applySourcePatch(
    patch: TextPatch,
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ): boolean;
  applySourcePatches(
    patches: readonly TextPatch[],
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ): boolean;
  applyInspectorSourcePatch(
    patch: TextPatch,
    propertyKind: 'style' | 'semantic',
    origin?: SourceEditOrigin,
    expectedRevision?: number,
  ): InspectorSourcePatchResult;
  commitSourceTransaction(
    request: GeometryTransactionRequest,
    evidence: SourceHashEvidence,
  ): TikzTransactionBrokerResult;
  deleteSelection(mode?: DeleteMode): boolean;
  setSelection(refs: string[], stmtIndex?: number | null): void;
  setSelectionTargets(targets: readonly SelectionTarget[]): void;
  setHoveredStmtIndex(stmtIndex: number | null): void;
  setActiveTool(id: string): void;
  setViewport(viewport: Viewport): void;
}

export function useTikzEngine(
  initialCode: string,
  initialFocus: {
    selectionRefs?: readonly string[];
    stmtIndex?: number | null;
  } = {},
): TikzEngine {
  const [document] = useState(() => new StudioDocument(initialCode));
  const [transactionBroker] = useState(
    () => new TikzTransactionBroker(document),
  );
  const [identityRegistry] = useState(() => new EntityIdentityRegistry());
  const lastUsableProjectionRef = useRef<Analysis | null>(null);
  const lastGeometryProjectionRef = useRef<LocalGeometryProjection | null>(null);
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const [selectionTargets, setSelectionTargetsState] = useState<SelectionTarget[]>(
    () => initialFocus.stmtIndex !== null && initialFocus.stmtIndex !== undefined
      ? [{
        kind: 'statement',
        stmtIndex: initialFocus.stmtIndex,
        refs: [...(initialFocus.selectionRefs ?? [])],
      }]
      : [...(initialFocus.selectionRefs ?? [])].map((ref) => ({
        kind: 'pending-ref' as const,
        sourceRevision: 0,
        ref,
      })),
  );
  const [hoveredStmtIndex, setHoveredStmtIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [viewport, setViewport] = useState<Viewport>({
    scale: CM_TO_PX,
    offsetX: 260,
    offsetY: 220,
  });
  const projection = useMemo(() => {
    const next = analyze(
      snapshot.source,
      snapshot.revision,
      snapshot.cstTree ?? undefined,
    );
    if (!next.scene || !next.stmts) return next;
    return {
      ...next,
      scene: identityRegistry.reconcile(
        next.scene,
        next.stmts,
        snapshot.source,
        snapshot.revision,
        document.getTransactionsSince(0),
      ),
    };
  }, [
    document,
    identityRegistry,
    snapshot.revision,
    snapshot.source,
    snapshot.cstTree,
  ]);
  const projectionGate = resolveProjectionGate(
    projection,
    lastUsableProjectionRef.current,
  );
  const semanticProjection = projectionGate.semantic;
  const selection = useMemo(
    () => selectionRefsOf(selectionTargets),
    [selectionTargets],
  );
  const currentSourceHash = useMemo(
    () => hashSource(snapshot.source),
    [snapshot.source],
  );
  const currentGeometryProjection = useMemo<LocalGeometryProjection | null>(() => {
    if (!isUsableSemanticProjection(projection)) return null;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: projection,
      source: snapshot.source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: snapshot.documentId,
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        sourceHash: currentSourceHash,
        sourceId: `${snapshot.documentId}:tikz`,
        pluginSetDigest: LOCAL_SEMANTIC_PLUGIN_DIGEST,
      },
    });
    return {
      truths,
      sourceMap: buildGeometrySourceMap(truths),
    };
  }, [
    projection,
    currentSourceHash,
    snapshot.documentId,
    snapshot.epoch,
    snapshot.revision,
    snapshot.source,
  ]);
  const geometryChanges = useMemo<readonly GeometryUtf16SourceChange[]>(() => {
    const transaction = snapshot.lastTransaction;
    if (!transaction) return [];
    const sourceId = `${snapshot.documentId}:tikz`;
    return transaction.patches.map((patch, index) => ({
      sourceId,
      previousRange: { start: patch.from, end: patch.to },
      currentRange: transaction.changedRangesAfter[index]
        ? { ...transaction.changedRangesAfter[index] }
        : { start: patch.from, end: patch.from + patch.insert.length },
    }));
  }, [
    snapshot.documentId,
    snapshot.lastTransaction,
  ]);
  const geometryInvalidation = useMemo<GeometryInvalidationResult | null>(() => {
    const previous = lastGeometryProjectionRef.current;
    const current = currentGeometryProjection;
    if (
      !previous
      || !current
      || previous.truths.semantic.basis.revision
        === current.truths.semantic.basis.revision
    ) return null;
    return computeGeometryInvalidation({
      changes: geometryChanges,
      previous: {
        ir: previous.truths.semantic.ir,
        sourceMap: previous.sourceMap,
        opaqueNodes: previous.truths.construction.opaqueNodes,
      },
      current: {
        ir: current.truths.semantic.ir,
        sourceMap: current.sourceMap,
        opaqueNodes: current.truths.construction.opaqueNodes,
      },
    });
  }, [currentGeometryProjection, geometryChanges]);
  const activeGeometryProjection =
    currentGeometryProjection ?? lastGeometryProjectionRef.current;
  const inspectorSelection = useMemo(() => resolveInspectorSelection({
    targets: selectionTargets,
    truth: activeGeometryProjection?.truths ?? null,
    statements: semanticProjection?.stmts,
    statementRevision: semanticProjection?.sourceRevision ?? null,
    currentBasis: {
      documentId: snapshot.documentId,
      epoch: snapshot.epoch,
      revision: snapshot.revision,
      sourceHash: currentSourceHash,
      sourceId: `${snapshot.documentId}:tikz`,
      pluginSetDigest: LOCAL_SEMANTIC_PLUGIN_DIGEST,
    },
    sourceRevision: snapshot.revision,
  }), [
    activeGeometryProjection,
    currentSourceHash,
    selectionTargets,
    semanticProjection?.sourceRevision,
    semanticProjection?.stmts,
    snapshot.documentId,
    snapshot.epoch,
    snapshot.revision,
  ]);
  useEffect(() => {
    const target = inspectorSelection.target;
    if (
      inspectorSelection.state !== 'single'
      || !target
      || (target.kind !== 'entity' && target.kind !== 'statement')
      || inspectorSelection.statementIndex === null
      || !inspectorSelection.renderPrimitiveId
    ) return;
    setSelectionTargetsState((current) => {
      if (current.length !== 1 || current[0]?.kind !== target.kind) {
        return current;
      }
      const refs = [...inspectorSelection.refs];
      const sourceBindingIds = [...inspectorSelection.sourceBindingIds];
      const next: SelectionTarget = target.kind === 'entity'
        ? {
          ...target,
          stableId: inspectorSelection.sourceStableId ?? target.stableId,
          stmtIndex: inspectorSelection.statementIndex!,
          refs,
          semanticEntityId: inspectorSelection.semanticEntityId,
          renderPrimitiveId: inspectorSelection.renderPrimitiveId,
          sourceBindingIds,
          sourceRange: inspectorSelection.sourceRange,
        }
        : {
          ...target,
          stmtIndex: inspectorSelection.statementIndex!,
          refs,
          semanticEntityId: inspectorSelection.semanticEntityId,
          renderPrimitiveId: inspectorSelection.renderPrimitiveId,
          sourceBindingIds,
          sourceRange: inspectorSelection.sourceRange,
        };
      const previous = current[0];
      if (
        previous.kind !== 'entity'
        && previous.kind !== 'statement'
      ) return current;
      const previousBindings = (
        previous.sourceBindingIds ?? []
      );
      const sameBindings = (
        previousBindings.length === sourceBindingIds.length
        && previousBindings.every((id, index) => id === sourceBindingIds[index])
      );
      const sameRange = (
        previous.sourceRange?.start === inspectorSelection.sourceRange?.start
        && previous.sourceRange?.end === inspectorSelection.sourceRange?.end
      );
      const sameIdentity = (
        previous.kind === next.kind
        && previous.stmtIndex === next.stmtIndex
        && previous.refs.length === next.refs.length
        && previous.refs.every((ref, index) => ref === next.refs[index])
        && previous.semanticEntityId === next.semanticEntityId
        && previous.renderPrimitiveId === next.renderPrimitiveId
        && (
          previous.kind !== 'entity'
          || next.kind !== 'entity'
          || previous.stableId === next.stableId
        )
      );
      return sameBindings && sameRange && sameIdentity ? current : [next];
    });
  }, [inspectorSelection]);
  useEffect(() => {
    if (isUsableSemanticProjection(projection)) {
      lastUsableProjectionRef.current = projection;
    }
  }, [projection]);
  useEffect(() => {
    if (currentGeometryProjection) {
      lastGeometryProjectionRef.current = currentGeometryProjection;
    }
  }, [currentGeometryProjection]);

  useEffect(() => {
    const scene = semanticProjection?.scene;
    const statements = semanticProjection?.stmts;
    if (!scene || !statements) return;
    setSelectionTargetsState((current) => {
      let changed = false;
      const next = current.flatMap<SelectionTarget>((target) => {
        if (target.kind === 'pending-ref') {
          const point = scene.points.get(target.ref);
          if (!point) return [target];
          changed = true;
          return [{
            kind: 'entity',
            stableId: point.stableId,
            stmtIndex: point.stmtIndex,
            entityKind: 'point',
            refs: [point.name],
          }];
        }
        if (
          target.kind !== 'source-block'
          || target.sourceRevision !== snapshot.revision
        ) return [target];
        const entities: SelectionTarget[] = [];
        for (const point of scene.points.values()) {
          if (point.internal) continue;
          const statement = statements[point.stmtIndex];
          if (statement && sourceRangesOverlap(target.range, statement.range)) {
            entities.push({
              kind: 'entity',
              stableId: point.stableId,
              stmtIndex: point.stmtIndex,
              entityKind: 'point',
              refs: [point.name],
            });
          }
        }
        for (const element of scene.elements) {
          const statement = statements[element.stmtIndex];
          if (statement && sourceRangesOverlap(target.range, statement.range)) {
            entities.push({
              kind: 'entity',
              stableId: element.stableId,
              stmtIndex: element.stmtIndex,
              entityKind: 'element',
              refs: element.refs,
            });
          }
        }
        changed = true;
        if (entities.length > 0) return entities;
        return statements.flatMap((statement, stmtIndex) => (
          sourceRangesOverlap(target.range, statement.range)
            ? [{
              kind: 'statement' as const,
              stmtIndex,
              refs: target.refs,
            }]
            : []
        ));
      });
      return changed ? next : current;
    });
  }, [semanticProjection, snapshot.revision]);

  useEffect(() => {
    const origin = snapshot.lastTransaction?.origin;
    if (
      origin === 'ai'
      || origin === 'repair'
      || origin === 'external'
      || origin === 'keyboard'
    ) {
      setSelectionTargetsState([]);
    }
  }, [
    snapshot.lastTransaction?.toRevision,
    snapshot.lastTransaction?.origin,
  ]);

  const replaceCode = useCallback((next: string, origin: SourceEditOrigin) => {
    if (
      (origin === 'canvas' || origin === 'style')
      && !projectionGate.writebackAllowed
    ) return false;
    const before = document.getSnapshot();
    const patch = minimalTextPatch(before.source, next);
    if (!patch) return true;
    return transactionBroker.commitPatches({
      patches: [patch],
      origin,
      expectedRevision: before.revision,
    }).ok;
  }, [document, projectionGate.writebackAllowed, transactionBroker]);

  const setCode = useCallback((next: string) => {
    replaceCode(next, 'external');
  }, [replaceCode]);

  const applyPatch = useCallback((next: string) => {
    replaceCode(next, 'canvas');
  }, [replaceCode]);

  const applySourcePatch = useCallback((
    patch: TextPatch,
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ) => {
    if (
      (origin === 'canvas' || origin === 'style')
      && !projectionGate.writebackAllowed
    ) return false;
    return transactionBroker.commitPatches({
      patches: [patch],
      origin,
      expectedRevision,
    }).ok;
  }, [projectionGate.writebackAllowed, transactionBroker]);
  const applySourcePatches = useCallback((
    patches: readonly TextPatch[],
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ) => {
    if (
      (origin === 'canvas' || origin === 'style')
      && !projectionGate.writebackAllowed
    ) return false;
    return transactionBroker.commitPatches({
      patches,
      origin,
      expectedRevision,
    }).ok;
  }, [projectionGate.writebackAllowed, transactionBroker]);
  const applyInspectorSourcePatch = useCallback((
    patch: TextPatch,
    propertyKind: 'style' | 'semantic',
    origin: SourceEditOrigin = 'style',
    expectedRevision = snapshot.revision,
  ) => {
    if (
      (origin === 'canvas' || origin === 'style')
      && !projectionGate.writebackAllowed
    ) {
      return {
        ok: false,
        code: 'projection-writeback-blocked',
        message: '当前语义投影不可写。',
      } satisfies InspectorSourcePatchResult;
    }
    const capability = inspectorSelection.writeCapability;
    if (capability.mode === 'direct') {
      const result = transactionBroker.commitPatches({
        patches: [patch],
        origin,
        expectedRevision,
      });
      return {
        ok: result.ok,
        code: result.ok ? 'committed' : 'direct-commit-rejected',
        ...(!result.ok ? { message: result.message } : {}),
      } satisfies InspectorSourcePatchResult;
    }
    if (
      capability.mode !== 'managed-recompile'
      || propertyKind !== 'style'
      || !capability.managedConstructionId
      || expectedRevision !== snapshot.revision
    ) {
      return {
        ok: false,
        code: capability.mode === 'managed-recompile'
          ? 'managed-property-requires-semantic-recompile'
          : 'source-binding-read-only',
        message: capability.reason
          ?? (
            propertyKind === 'semantic'
              ? '该语义属性需要重编译受管构造记录。'
              : '当前 source binding 为只读。'
          ),
      } satisfies InspectorSourcePatchResult;
    }
    try {
      const patches = managedStyleRecompilePatches(
        snapshot.source,
        capability.managedConstructionId,
        patch,
      );
      const result = transactionBroker.commitPatches({
        patches,
        origin,
        expectedRevision,
      });
      return {
        ok: result.ok,
        code: result.ok ? 'committed' : 'managed-recompile-rejected',
        ...(!result.ok ? { message: result.message } : {}),
      } satisfies InspectorSourcePatchResult;
    } catch (error) {
      return {
        ok: false,
        code: 'managed-recompile-rejected',
        message: error instanceof Error ? error.message : String(error),
      } satisfies InspectorSourcePatchResult;
    }
  }, [
    inspectorSelection.writeCapability,
    projectionGate.writebackAllowed,
    snapshot.revision,
    snapshot.source,
    transactionBroker,
  ]);

  const commitSourceTransaction = useCallback((
    request: GeometryTransactionRequest,
    evidence: SourceHashEvidence,
  ): TikzTransactionBrokerResult => {
    if (
      (request.origin === 'canvas' || request.origin === 'ai')
      && !projectionGate.writebackAllowed
    ) {
      const current = document.getSnapshot();
      return {
        ok: false,
        status: 'conflict',
        transactionId: request.transactionId,
        code: 'semantic-projection-stale',
        message: '当前源码结构未完成，语义投影为只读旧版本',
        expectedRevision: request.expectedRevision,
        currentRevision: current.revision,
      };
    }
    return transactionBroker.commit(request, evidence);
  }, [document, projectionGate.writebackAllowed, transactionBroker]);

  const selectTargets = useCallback((targets: readonly SelectionTarget[]) => {
    setSelectionTargetsState(targets.map((target) => ({ ...target })));
  }, []);

  const select = useCallback((refs: string[], stmtIndex: number | null = null) => {
    if (refs.length === 0) {
      setSelectionTargetsState([]);
      return;
    }
    const scene = semanticProjection?.scene;
    if (stmtIndex !== null) {
      const point = refs.length === 1 ? scene?.points.get(refs[0]) : null;
      if (point?.stmtIndex === stmtIndex) {
        setSelectionTargetsState([{
          kind: 'entity',
          stableId: point.stableId,
          stmtIndex,
          entityKind: 'point',
          refs: [point.name],
        }]);
        return;
      }
      const element = scene?.elements.find((candidate) => (
        candidate.stmtIndex === stmtIndex
        && refs.every((ref) => candidate.refs.includes(ref))
      ));
      if (element) {
        setSelectionTargetsState([{
          kind: 'entity',
          stableId: element.stableId,
          stmtIndex,
          entityKind: 'element',
          refs: element.refs,
        }]);
        return;
      }
      setSelectionTargetsState([{
        kind: 'statement',
        stmtIndex,
        refs,
      }]);
      return;
    }
    setSelectionTargetsState(refs.map((ref) => {
      const point = scene?.points.get(ref);
      return point
        ? {
          kind: 'entity' as const,
          stableId: point.stableId,
          stmtIndex: point.stmtIndex,
          entityKind: 'point' as const,
          refs: [point.name],
        }
        : {
          kind: 'pending-ref' as const,
          sourceRevision: snapshot.revision,
          ref,
        };
    }));
  }, [semanticProjection, snapshot.revision]);

  // Destructive callers must opt into cascade explicitly. The engine boundary
  // itself defaults to the recoverable managed-block policy so a future UI or
  // shortcut cannot accidentally bypass downstream-loss confirmation.
  const deleteSelection = useCallback((mode: DeleteMode = 'block') => {
    if (
      !projectionGate.writebackAllowed
      || !semanticProjection?.scene
      || !semanticProjection.stmts
    ) return false;
    const targets = selectionTargets.flatMap((target) => {
      if (target.kind === 'entity') {
        return [{
          stableId: (
            selectionTargets.length === 1
              ? inspectorSelection.sourceStableId
              : undefined
          ) ?? target.stableId,
          stmtIndex: (
            selectionTargets.length === 1
              ? inspectorSelection.statementIndex
              : null
          ) ?? target.stmtIndex,
        }];
      }
      if (target.kind === 'statement') {
        return [{
          stmtIndex: (
            selectionTargets.length === 1
              ? inspectorSelection.statementIndex
              : null
          ) ?? target.stmtIndex,
        }];
      }
      if (
        target.kind === 'source-block'
        && target.sourceRevision === snapshot.revision
      ) {
        return semanticProjection.stmts.flatMap((statement, stmtIndex) => (
          sourceRangesOverlap(target.range, statement.range)
            ? [{ stmtIndex }]
            : []
        ));
      }
      return [];
    });
    const uniqueTargets = [...new Map(
      targets.map((target) => [
        `${'stableId' in target ? target.stableId : ''}:${target.stmtIndex ?? ''}`,
        target,
      ]),
    ).values()];
    if (uniqueTargets.length === 0) return false;
    const plan = planDeletion({
      source: snapshot.source,
      scene: semanticProjection.scene,
      statements: semanticProjection.stmts,
      targets: uniqueTargets,
      mode,
    });
    if (!plan.canApply || plan.patches.length === 0) return false;
    const committed = transactionBroker.commitPatches({
      patches: plan.patches,
      origin: 'canvas',
      expectedRevision: snapshot.revision,
    }).ok;
    if (committed) {
      setSelectionTargetsState([]);
    }
    return committed;
  }, [
    projectionGate.writebackAllowed,
    semanticProjection,
    inspectorSelection.sourceStableId,
    inspectorSelection.statementIndex,
    selectionTargets,
    snapshot.revision,
    snapshot.source,
    transactionBroker,
  ]);

  return {
    document,
    code: snapshot.source,
    revision: snapshot.revision,
    lastEditOrigin: snapshot.lastTransaction?.origin ?? null,
    interactiveWritebackSafe: projectionGate.writebackAllowed,
    writebackBlockedReason: projectionGate.writebackReason,
    semanticProjectionState: projectionGate.state,
    semanticRevision: projectionGate.semanticRevision,
    projection,
    scene: semanticProjection?.scene ?? null,
    stmts: semanticProjection?.stmts ?? null,
    issues: projection.issues,
    freePointRanges: semanticProjection?.freePointRanges ?? new Map(),
    selectionTargets,
    selection,
    inspectorSelection,
    selectedStmtIndex: inspectorSelection.statementIndex,
    hoveredStmtIndex,
    activeTool,
    viewport,
    ephemeralStyles: EMPTY_EPHEMERAL_STYLES,
    geometryTruth: activeGeometryProjection?.truths ?? null,
    geometrySourceMap: activeGeometryProjection?.sourceMap ?? null,
    geometryInvalidation,
    setCode,
    replaceCode,
    applyPatch,
    applySourcePatch,
    applySourcePatches,
    applyInspectorSourcePatch,
    commitSourceTransaction,
    deleteSelection,
    setSelection: select,
    setSelectionTargets: selectTargets,
    setHoveredStmtIndex,
    setActiveTool,
    setViewport,
  };
}
