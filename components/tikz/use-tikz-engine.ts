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
import type { TikzCoordinateTransform } from '@/lib/tikz/subset/coordinate-transform';
import type { DeleteMode } from '@/lib/tikz/authoring/delete-transaction';
import {
  planGeometryDocDeletion,
  type GeometryDeleteTarget,
} from '@/lib/tikz/authoring/geometry-delete-plan';
import {
  selectionRefsOf,
  sourceRangesOverlap,
  type SelectionTarget,
} from '@/lib/tikz/authoring/selection-target';
import {
  resolveInspectorSelection,
  type InspectorSelectionResolution,
} from '@/lib/tikz/authoring/selection-resolution';
import {
  buildGeometrySourceMap,
  computeGeometryInvalidation,
  createGeometryDoc,
  compileCanvasConstructionBatchProposal,
  compileCanvasDeleteProposal,
  compileCanvasDragPatchesProposal,
  compileCanvasPointMoveProposal,
  compileCanvasSelectionTransformProposal,
  compileInspectorDirectProposal,
  compileManagedInspectorStyleProposal,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
  type GeometryInvalidationResult,
  type GeometryDoc,
  type GeometryDocReadonly,
  type GeometrySourceMap,
  type GeometryTransactionRequest,
  type GeometryTruthSet,
  type GeometryUtf16SourceChange,
  type CanvasCircleAdoptionIntent,
} from '@/lib/tikz/ir';
import type { ConstructionPlan } from '@/lib/tikz/authoring/construction-ir';
import {
  analyzeSelectionTransformCapability,
  type SelectionTransformCapability,
  type SelectionTransform,
} from '@/lib/tikz/authoring/selection-transform';
import { hashSource } from '@/lib/tikz/semantics/scene-manifest';
import {
  TikzTransactionBroker,
  type SourceHashEvidence,
  type TikzTransactionBrokerResult,
} from '@/lib/tikz/transactions';

const EMPTY_EPHEMERAL_STYLES: Readonly<Record<string, never>> = Object.freeze({});
const LOCAL_SEMANTIC_PLUGIN_DIGEST = TIKZ_PLUGIN_SET_DIGEST;

interface LocalGeometryProjection {
  truths: GeometryTruthSet;
  sourceMap: GeometrySourceMap;
  doc: GeometryDoc;
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
  freePointTransforms: Map<string, TikzCoordinateTransform>;
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
  /** Legacy read-only display projection; may retain the last usable revision. */
  geometryTruth: GeometryDocReadonly<GeometryTruthSet> | null;
  /** Legacy source-map alias paired with geometryTruth; never use for writes. */
  geometrySourceMap: GeometryDocReadonly<GeometrySourceMap> | null;
  /** Current-revision unified read model; never falls back to a stale revision. */
  geometryDoc: GeometryDoc | null;
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
  commitCanvasPointMove(
    sourceStableId: string,
    pointName: string,
    target: { readonly x: number; readonly y: number },
    expectedRevision: number,
  ): { readonly handled: boolean; readonly committed: boolean; readonly message?: string };
  commitCanvasDragPatches(
    mode: 'path-angle' | 'derived-coordinates' | 'selection-transform',
    sourceStableId: string,
    pointName: string,
    patches: readonly TextPatch[],
    expectedRevision: number,
    selectedEntityIds?: readonly string[],
    selectionTransform?: SelectionTransform,
    acknowledgedExternalImpactedEntityIds?: readonly string[],
  ): { readonly handled: true; readonly committed: boolean; readonly message?: string };
  transformSelection(
    transform: SelectionTransform,
    acknowledgedExternalImpactedEntityIds?: readonly string[],
  ): {
    readonly handled: true;
    readonly committed: boolean;
    readonly message?: string;
  };
  selectionTransformCapability(transform: SelectionTransform): SelectionTransformCapability;
  selectAllGeometry(): void;
  commitCanvasConstructionBatch(
    plans: readonly ConstructionPlan[],
    primaryConstructionId: string,
    adoptions: readonly CanvasCircleAdoptionIntent[],
    expectedRevision: number,
  ): {
    readonly handled: true;
    readonly committed: boolean;
    readonly message?: string;
    readonly insertedRange?: { readonly start: number; readonly end: number };
  };
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
        sourceRevision: snapshot.revision,
        stmtIndex: initialFocus.stmtIndex,
        refs: [...(initialFocus.selectionRefs ?? [])],
      }]
      : [...(initialFocus.selectionRefs ?? [])].map((ref) => ({
        kind: 'pending-ref' as const,
        sourceRevision: snapshot.revision,
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
  // The source projection is the replayable semantic identity lane. It must
  // remain a pure function of source + revision because the Broker rebuilds
  // it independently. EntityIdentityRegistry is UI-only continuity state and
  // may never influence GeometryDoc IDs, bindings, or guarded hashes.
  const sourceProjection = useMemo(() => analyze(
    snapshot.source,
    snapshot.revision,
    snapshot.cstTree ?? undefined,
  ), [
    snapshot.revision,
    snapshot.source,
    snapshot.cstTree,
  ]);
  const projection = useMemo(() => {
    const next = sourceProjection;
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
    sourceProjection,
    snapshot.revision,
    snapshot.source,
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
    if (!isUsableSemanticProjection(sourceProjection)) return null;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: sourceProjection,
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
    const sourceMap = buildGeometrySourceMap(truths);
    return {
      truths,
      sourceMap,
      doc: createGeometryDoc(truths, sourceMap),
    };
  }, [
    sourceProjection,
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
        if (
          (target.kind === 'entity' || target.kind === 'statement')
          && target.sourceRevision !== snapshot.revision
        ) {
          const geometryDoc = currentGeometryProjection?.doc;
          if (geometryDoc?.basis.revision !== snapshot.revision) return [target];
          const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
            entity.id === target.semanticEntityId
            || (target.kind === 'entity' && entity.id === target.stableId)
            || (entity.name !== undefined && target.refs.includes(entity.name))
          ));
          changed = true;
          if (matches.length !== 1) return [];
          const entity = matches[0]!;
          const primitive = geometryDoc.rendering.flatMap((truth) => (
            truth.status === 'complete' ? [...truth.primitives] : []
          )).find((candidate) => candidate.entityIds.includes(entity.id));
          const primitiveSourceStableId = primitive?.metadata?.sourceStableId;
          const statementIndex = primitive?.metadata?.statementIndex;
          const binding = (entity.sourceBindingIds ?? []).flatMap((bindingId) => {
            const candidate = geometryDoc.construction.bindings.find((row) => row.id === bindingId);
            return candidate ? [candidate] : [];
          })[0];
          const shared = {
            sourceRevision: snapshot.revision,
            stmtIndex: typeof statementIndex === 'number'
              && Number.isSafeInteger(statementIndex)
              && statementIndex >= 0
              ? statementIndex
              : target.stmtIndex,
            refs: entity.name ? [entity.name] : [...target.refs],
            semanticEntityId: entity.id,
            ...(primitive ? { renderPrimitiveId: primitive.id } : {}),
            sourceBindingIds: [...(entity.sourceBindingIds ?? [])],
            ...(binding
              ? { sourceRange: { ...binding.source.range } }
              : primitive?.sourceRange
                ? { sourceRange: { ...primitive.sourceRange } }
                : {}),
          };
          return target.kind === 'entity'
            ? [{
              kind: 'entity' as const,
              stableId: typeof primitiveSourceStableId === 'string'
                ? primitiveSourceStableId
                : entity.id,
              entityKind: entity.kind === 'point' ? 'point' as const : 'element' as const,
              ...shared,
            }]
            : [{ kind: 'statement' as const, ...shared }];
        }
        if (target.kind === 'pending-ref') {
          const point = scene.points.get(target.ref);
          if (!point) return [target];
          changed = true;
          return [{
            kind: 'entity',
            sourceRevision: snapshot.revision,
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
        const geometryDoc = currentGeometryProjection?.doc;
        if (geometryDoc?.basis.revision === snapshot.revision) {
          const bindings = new Map(
            geometryDoc.construction.bindings.map((binding) => [binding.id, binding]),
          );
          const canonicalEntities = geometryDoc.semantic.ir.entities.flatMap((entity) => {
            const owningBinding = (entity.sourceBindingIds ?? []).flatMap((bindingId) => {
              const binding = bindings.get(bindingId);
              return binding && sourceRangesOverlap(target.range, binding.source.range)
                ? [binding]
                : [];
            })[0];
            if (!owningBinding) return [];
            return [{
              kind: 'entity' as const,
              sourceRevision: snapshot.revision,
              stableId: entity.id,
              stmtIndex: 0,
              entityKind: entity.kind === 'point' ? 'point' as const : 'element' as const,
              refs: entity.name ? [entity.name] : [],
              semanticEntityId: entity.id,
              sourceBindingIds: [...(entity.sourceBindingIds ?? [])],
              sourceRange: { ...owningBinding.source.range },
            }];
          });
          if (canonicalEntities.length > 0) {
            changed = true;
            return canonicalEntities;
          }
        }
        const entities: SelectionTarget[] = [];
        for (const point of scene.points.values()) {
          if (point.internal) continue;
          const statement = statements[point.stmtIndex];
          if (statement && sourceRangesOverlap(target.range, statement.range)) {
            entities.push({
              kind: 'entity',
              sourceRevision: snapshot.revision,
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
              sourceRevision: snapshot.revision,
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
              sourceRevision: snapshot.revision,
              stmtIndex,
              refs: target.refs,
            }]
            : []
        ));
      });
      return changed ? next : current;
    });
  }, [
    currentGeometryProjection,
    selectionTargets,
    semanticProjection,
    snapshot.revision,
  ]);

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
    // Compatibility source replacement is not a Canvas semantic gesture.
    // Real Canvas writes enter through typed proposal compilers below.
    replaceCode(next, 'external');
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
  const commitCanvasPointMove = useCallback((
    sourceStableId: string,
    pointName: string,
    target: { readonly x: number; readonly y: number },
    expectedRevision: number,
  ) => {
    const geometryDoc = currentGeometryProjection?.doc;
    const basis = geometryDoc?.basis;
    if (
      !geometryDoc
      || !basis
      || basis.revision !== expectedRevision
      || expectedRevision !== snapshot.revision
      || !projectionGate.writebackAllowed
    ) {
      return {
        handled: true,
        committed: false,
        message: 'Point drag requires the current GeometryDoc revision.',
      } as const;
    }
    try {
      const proposal = compileCanvasPointMoveProposal({
        source: snapshot.source,
        geometryDoc,
        sourceStableId,
        pointName,
        target,
      });
      if (!proposal) {
        return {
          handled: true,
          committed: false,
          message: 'Point selection could not be decoded by the current writer.',
        } as const;
      }
      const result = transactionBroker.commit(proposal.transaction, {
        hash: basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(basis.kernelHash ? { kernelHash: basis.kernelHash } : {}),
        ...(basis.pluginSetDigest
          ? { pluginSetDigest: basis.pluginSetDigest }
          : {}),
      });
      return {
        handled: true,
        committed: result.ok,
        ...(!result.ok ? { message: result.message } : {}),
      };
    } catch (error) {
      return {
        handled: true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    currentGeometryProjection,
    projectionGate.writebackAllowed,
    snapshot.revision,
    snapshot.source,
    transactionBroker,
  ]);
  const commitCanvasConstructionBatch = useCallback((
    plans: readonly ConstructionPlan[],
    primaryConstructionId: string,
    adoptions: readonly CanvasCircleAdoptionIntent[],
    expectedRevision: number,
  ) => {
    const geometryDoc = currentGeometryProjection?.doc;
    if (
      !geometryDoc
      || geometryDoc.basis.revision !== expectedRevision
      || expectedRevision !== snapshot.revision
      || !projectionGate.writebackAllowed
    ) {
      return {
        handled: true,
        committed: false,
        message: 'Canvas construction requires the current complete GeometryDoc revision.',
      } as const;
    }
    try {
      const proposal = compileCanvasConstructionBatchProposal({
        source: snapshot.source,
        geometryDoc,
        plans,
        primaryConstructionId,
        adoptions,
      });
      const result = transactionBroker.commit(proposal.transaction, {
        hash: geometryDoc.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(geometryDoc.basis.kernelHash
          ? { kernelHash: geometryDoc.basis.kernelHash }
          : {}),
        ...(geometryDoc.basis.pluginSetDigest
          ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
          : {}),
      });
      return result.ok
        ? {
          handled: true,
          committed: true,
          insertedRange: proposal.insertedRange,
        } as const
        : {
          handled: true,
          committed: false,
          message: result.message,
        } as const;
    } catch (error) {
      return {
        handled: true,
        committed: false,
        message: error instanceof Error
          ? error.message
          : 'Canvas construction proposal could not be compiled.',
      } as const;
    }
  }, [
    currentGeometryProjection,
    projectionGate.writebackAllowed,
    snapshot.revision,
    snapshot.source,
    transactionBroker,
  ]);
  const commitCanvasDragPatches = useCallback((
    mode: 'path-angle' | 'derived-coordinates' | 'selection-transform',
    sourceStableId: string,
    pointName: string,
    patches: readonly TextPatch[],
    expectedRevision: number,
    selectedEntityIds?: readonly string[],
    selectionTransform?: SelectionTransform,
    acknowledgedExternalImpactedEntityIds?: readonly string[],
  ) => {
    const geometryDoc = currentGeometryProjection?.doc;
    if (
      !geometryDoc
      || geometryDoc.basis.revision !== expectedRevision
      || expectedRevision !== snapshot.revision
      || !projectionGate.writebackAllowed
    ) {
      return {
        handled: true,
        committed: false,
        message: 'Canvas drag requires the current complete GeometryDoc revision.',
      } as const;
    }
    try {
      const proposal = compileCanvasDragPatchesProposal({
        source: snapshot.source,
        geometryDoc,
        sourceStableId,
        pointName,
        mode,
        patches,
        ...(selectedEntityIds ? { selectedEntityIds } : {}),
        ...(selectionTransform ? { selectionTransform } : {}),
        ...(acknowledgedExternalImpactedEntityIds
          ? { acknowledgedExternalImpactedEntityIds }
          : {}),
      });
      const result = transactionBroker.commit(proposal.transaction, {
        hash: geometryDoc.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(geometryDoc.basis.kernelHash
          ? { kernelHash: geometryDoc.basis.kernelHash }
          : {}),
        ...(geometryDoc.basis.pluginSetDigest
          ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
          : {}),
      });
      return {
        handled: true,
        committed: result.ok,
        ...(!result.ok ? { message: result.message } : {}),
      } as const;
    } catch (error) {
      return {
        handled: true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  }, [
    currentGeometryProjection,
    projectionGate.writebackAllowed,
    snapshot.revision,
    snapshot.source,
    transactionBroker,
  ]);
  const transformSelection = useCallback((
    transform: SelectionTransform,
    acknowledgedExternalImpactedEntityIds?: readonly string[],
  ) => {
    const geometryDoc = currentGeometryProjection?.doc;
    const selectedEntityIds = selectionTargets.flatMap((target) => (
      target.kind !== 'pending-ref'
      && target.kind !== 'source-block'
      && target.sourceRevision === geometryDoc?.basis.revision
      && target.semanticEntityId
        ? [target.semanticEntityId]
        : []
    ));
    if (!geometryDoc || !projectionGate.writebackAllowed) {
      return { handled: true, committed: false, message: '当前语义投影不可写。' } as const;
    }
    try {
      const proposal = compileCanvasSelectionTransformProposal({
        source: snapshot.source,
        geometryDoc,
        selectedEntityIds,
        transform,
        ...(acknowledgedExternalImpactedEntityIds
          ? { acknowledgedExternalImpactedEntityIds }
          : {}),
      });
      const result = transactionBroker.commit(proposal.transaction, {
        hash: geometryDoc.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(geometryDoc.basis.kernelHash
          ? { kernelHash: geometryDoc.basis.kernelHash }
          : {}),
        ...(geometryDoc.basis.pluginSetDigest
          ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
          : {}),
      });
      return {
        handled: true,
        committed: result.ok,
        ...(!result.ok ? { message: result.message } : {}),
      } as const;
    } catch (error) {
      return {
        handled: true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  }, [
    currentGeometryProjection,
    projectionGate.writebackAllowed,
    selectionTargets,
    snapshot.source,
    transactionBroker,
  ]);
  const selectionTransformCapability = useCallback((transform: SelectionTransform) => {
    const geometryDoc = currentGeometryProjection?.doc;
    const selectedEntityIds = selectionTargets.flatMap((target) => (
      target.kind !== 'pending-ref'
      && target.kind !== 'source-block'
      && target.sourceRevision === geometryDoc?.basis.revision
      && target.semanticEntityId
        ? [target.semanticEntityId]
        : []
    ));
    if (!geometryDoc || !projectionGate.writebackAllowed) {
      return {
        status: 'blocked',
        selectedEntityIds: [...new Set(selectedEntityIds)].sort(),
        variableEntityIds: [],
        impactedEntityIds: [],
        externalImpactedEntityIds: [],
        patchCount: 0,
        reason: '当前语义投影不可写。',
      } satisfies SelectionTransformCapability;
    }
    return analyzeSelectionTransformCapability(
      snapshot.source,
      geometryDoc,
      selectedEntityIds,
      transform,
    );
  }, [
    currentGeometryProjection,
    projectionGate.writebackAllowed,
    selectionTargets,
    snapshot.source,
  ]);
  const selectAllGeometry = useCallback(() => {
    const geometryDoc = currentGeometryProjection?.doc;
    if (!geometryDoc) return;
    const renderedEntityIds = new Set(
      geometryDoc.rendering.flatMap((truth) => (
        truth.status === 'complete'
          ? truth.primitives.flatMap((primitive) => primitive.entityIds)
          : []
      )),
    );
    const targets: SelectionTarget[] = geometryDoc.semantic.ir.entities.flatMap((entity) => {
      if (!renderedEntityIds.has(entity.id)) return [];
      const binding = (entity.sourceBindingIds ?? []).flatMap((bindingId) => {
        const candidate = geometryDoc.construction.bindings.find((row) => row.id === bindingId);
        return candidate ? [candidate] : [];
      })[0];
      return [{
        kind: 'entity' as const,
        sourceRevision: geometryDoc.basis.revision,
        stableId: entity.id,
        stmtIndex: 0,
        entityKind: entity.kind === 'point' ? 'point' as const : 'element' as const,
        refs: entity.name ? [entity.name] : [],
        semanticEntityId: entity.id,
        sourceBindingIds: [...(entity.sourceBindingIds ?? [])],
        ...(binding ? { sourceRange: { ...binding.source.range } } : {}),
      }];
    });
    setSelectionTargetsState(targets);
  }, [currentGeometryProjection]);
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
      try {
        const geometryDoc = currentGeometryProjection?.doc;
        if (
          !geometryDoc
          || geometryDoc.basis.revision !== expectedRevision
          || !inspectorSelection.semanticEntityId
        ) {
          throw new TypeError('Direct Inspector edit requires the current GeometryDoc selection.');
        }
        const proposal = compileInspectorDirectProposal({
          source: snapshot.source,
          geometryDoc,
          semanticEntityId: inspectorSelection.semanticEntityId,
          bindingIds: capability.bindingIds,
          patch,
          propertyKind,
        });
        const result = transactionBroker.commit(proposal.transaction, {
          hash: geometryDoc.basis.sourceHash,
          algorithm: 'fnv1a64-utf8',
          source: snapshot.source,
          ...(geometryDoc.basis.kernelHash
            ? { kernelHash: geometryDoc.basis.kernelHash }
            : {}),
          ...(geometryDoc.basis.pluginSetDigest
            ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
            : {}),
        });
        return {
          ok: result.ok,
          code: result.ok ? 'committed' : 'direct-commit-rejected',
          ...(!result.ok ? { message: result.message } : {}),
        } satisfies InspectorSourcePatchResult;
      } catch (error) {
        return {
          ok: false,
          code: 'direct-commit-rejected',
          message: error instanceof Error ? error.message : String(error),
        } satisfies InspectorSourcePatchResult;
      }
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
      const geometryDoc = currentGeometryProjection?.doc;
      const basis = geometryDoc?.basis;
      if (!geometryDoc || !basis || basis.revision !== expectedRevision) {
        return {
          ok: false,
          code: 'managed-recompile-rejected',
          message: 'Managed style edit requires the current GeometryDoc revision.',
        } satisfies InspectorSourcePatchResult;
      }
      const proposal = compileManagedInspectorStyleProposal({
        source: snapshot.source,
        geometryDoc,
        constructionId: capability.managedConstructionId,
        bindingIds: capability.bindingIds,
        bodyPatch: patch,
      });
      const result = transactionBroker.commit(proposal.transaction, {
        hash: basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(basis.kernelHash ? { kernelHash: basis.kernelHash } : {}),
        ...(basis.pluginSetDigest
          ? { pluginSetDigest: basis.pluginSetDigest }
          : {}),
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
    inspectorSelection.semanticEntityId,
    currentGeometryProjection,
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
    // Construction commits can advance the document synchronously before React
    // publishes a new hook snapshot. Read the store here so the new block's
    // revision is not mistaken for a stale selection by an old render closure.
    const currentRevision = document.getSnapshot().revision;
    setSelectionTargetsState(targets
      .filter((target) => target.sourceRevision === currentRevision)
      .map((target) => ({ ...target })));
  }, [document]);

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
          sourceRevision: snapshot.revision,
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
          sourceRevision: snapshot.revision,
          stableId: element.stableId,
          stmtIndex,
          entityKind: 'element',
          refs: element.refs,
        }]);
        return;
      }
      setSelectionTargetsState([{
        kind: 'statement',
        sourceRevision: snapshot.revision,
        stmtIndex,
        refs,
      }]);
      return;
    }
    const geometryDoc = currentGeometryProjection?.doc;
    const canonicalTargets = refs.flatMap((ref): SelectionTarget[] => {
      if (!geometryDoc) return [];
      const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
        entity.id === ref || entity.name === ref
      ));
      if (matches.length !== 1) return [];
      const entity = matches[0]!;
      const primitive = geometryDoc.rendering.flatMap((truth) => (
        truth.status === 'complete' ? [...truth.primitives] : []
      )).find((candidate) => candidate.entityIds.includes(entity.id));
      const statementIndex = primitive?.metadata?.statementIndex;
      if (
        !primitive
        || typeof statementIndex !== 'number'
        || !Number.isSafeInteger(statementIndex)
        || statementIndex < 0
      ) return [];
      const references = entity.parameters?.references;
      const semanticRefs = [
        ...(entity.name ? [entity.name] : []),
        ...(Array.isArray(references)
          ? references.filter((value): value is string => typeof value === 'string')
          : []),
      ];
      const sourceStableId = primitive.metadata?.sourceStableId;
      return [{
        kind: 'entity',
        sourceRevision: snapshot.revision,
        stableId: typeof sourceStableId === 'string' ? sourceStableId : entity.id,
        stmtIndex: statementIndex,
        entityKind: entity.kind === 'point' ? 'point' : 'element',
        refs: [...new Set(semanticRefs.length > 0 ? semanticRefs : [entity.id])],
        semanticEntityId: entity.id,
        renderPrimitiveId: primitive.id,
        sourceBindingIds: entity.sourceBindingIds ?? primitive.sourceBindingIds,
        ...(primitive.sourceRange ? { sourceRange: { ...primitive.sourceRange } } : {}),
      }];
    });
    if (canonicalTargets.length === refs.length) {
      setSelectionTargetsState(canonicalTargets);
      return;
    }
    setSelectionTargetsState(refs.map((ref) => {
      const point = scene?.points.get(ref);
      return point
        ? {
          kind: 'entity' as const,
          sourceRevision: snapshot.revision,
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
  }, [currentGeometryProjection, semanticProjection, snapshot.revision]);

  // Destructive callers must opt into cascade explicitly. The engine boundary
  // itself defaults to the recoverable managed-block policy so a future UI or
  // shortcut cannot accidentally bypass downstream-loss confirmation.
  const deleteSelection = useCallback((mode: DeleteMode = 'block') => {
    if (
      !projectionGate.writebackAllowed
      || !semanticProjection?.scene
      || !semanticProjection.stmts
    ) return false;
    const geometryDoc = currentGeometryProjection?.doc;
    if (!geometryDoc || geometryDoc.basis.revision !== snapshot.revision) {
      return false;
    }
    // Annotate the element type: the branches below return structurally
    // different subsets of GeometryDeleteTarget, which would otherwise infer as
    // a union of array types rather than one array.
    const targets = selectionTargets.flatMap((target): GeometryDeleteTarget[] => {
      if (target.kind === 'entity') {
        return [{
          semanticEntityId: (
            selectionTargets.length === 1
              ? inspectorSelection.semanticEntityId
              : undefined
          ) ?? target.semanticEntityId ?? target.stableId,
          sourceBindingIds: selectionTargets.length === 1
            ? inspectorSelection.sourceBindingIds
            : target.sourceBindingIds,
          sourceRange: selectionTargets.length === 1
            ? inspectorSelection.sourceRange
            : target.sourceRange,
          stmtIndex: (
            selectionTargets.length === 1
              ? inspectorSelection.statementIndex
              : null
          ) ?? target.stmtIndex,
        }];
      }
      if (target.kind === 'statement') {
        return [{
          semanticEntityId: selectionTargets.length === 1
            ? inspectorSelection.semanticEntityId
            : target.semanticEntityId,
          sourceBindingIds: selectionTargets.length === 1
            ? inspectorSelection.sourceBindingIds
            : target.sourceBindingIds,
          sourceRange: selectionTargets.length === 1
            ? inspectorSelection.sourceRange
            : target.sourceRange,
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
        return [{ sourceRange: target.range }];
      }
      return [];
    });
    if (targets.length === 0) return false;
    let committed = false;
    try {
      const plan = planGeometryDocDeletion({
        source: snapshot.source,
        geometryDoc,
        statements: semanticProjection.stmts,
        targets,
        mode,
      });
      const proposal = compileCanvasDeleteProposal({
        source: snapshot.source,
        geometryDoc,
        plan,
      });
      const result = transactionBroker.commit(proposal.transaction, {
        hash: geometryDoc.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        ...(geometryDoc.basis.kernelHash
          ? { kernelHash: geometryDoc.basis.kernelHash }
          : {}),
        ...(geometryDoc.basis.pluginSetDigest
          ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
          : {}),
      });
      committed = result.ok;
    } catch {
      return false;
    }
    if (committed) {
      setSelectionTargetsState([]);
    }
    return committed;
  }, [
    projectionGate.writebackAllowed,
    currentGeometryProjection,
    semanticProjection,
    inspectorSelection.semanticEntityId,
    inspectorSelection.sourceBindingIds,
    inspectorSelection.sourceRange,
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
    freePointTransforms: semanticProjection?.freePointTransforms ?? new Map(),
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
    geometryDoc: currentGeometryProjection?.doc ?? null,
    geometryInvalidation,
    setCode,
    replaceCode,
    applyPatch,
    applySourcePatch,
    applySourcePatches,
    commitCanvasPointMove,
    commitCanvasDragPatches,
    transformSelection,
    selectionTransformCapability,
    selectAllGeometry,
    commitCanvasConstructionBatch,
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
