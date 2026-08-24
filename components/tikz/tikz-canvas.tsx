'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { analyze } from '@/lib/tikz/analyze';
import { hashSource } from '@/lib/tikz/document/source-hash';
import type {
  GeometryRevisionBasis,
  RenderPrimitive,
} from '@/lib/tikz/ir';
import { sourceBindingRangeMap, TIKZ_PLUGIN_SET_DIGEST } from '@/lib/tikz/ir';
import {
  qualifiedManagedEntityReference,
  qualifiedSourceCircleReference,
  type PersistentSourceCircleDefinition,
} from '@/lib/tikz/ir/persistent-entity-reference';
import {
  decodeRenderPrimitives,
  decodedRenderPrimitiveFitPoints,
} from '@/lib/tikz/render/render-primitive-decoder';
import { hitTestRenderPrimitives } from '@/lib/tikz/render/render-primitive-hit-test';
import {
  normalizedScreenRect,
  renderPrimitivesScreenBounds,
  renderPrimitivesInScreenRect,
} from '@/lib/tikz/render/selection-marquee';
import {
  canvasInteractionActive,
  canvasInteractionAcceptsPointer,
  canvasInteractionOwnsPreview,
  canvasInteractionPreviewOwner,
  canvasInteractionReducer,
  createCanvasInteractionSession,
  type CanvasInteractionBasis,
  type CanvasInteractionPreviewOwner,
} from '@/lib/tikz/render/canvas-interaction-session';
import {
  selectionTransformFromGesture,
  selectionTransformHandleLayout,
  selectionTransformPreviewLayout,
  selectionTransformPreviewSvgTransform,
  type SelectionTransformGesture,
  type SelectionTransformHandle,
} from '@/lib/tikz/render/selection-transform-handles';
import { TikzRenderPrimitiveSvg } from '@/lib/tikz/render/render-primitive-svg';
import {
  angleMarkPath,
  DEFAULT_ANGLE_MARK_RADIUS,
} from '@/lib/tikz/render/svg-decoration-primitives';
import { TikzSceneSvg } from '@/lib/tikz/render/svg-renderer';
import type { ScreenFrame } from '@/lib/tikz/render/line-clip';
import {
  cancelActiveToolInteraction,
  createToolInteractionSession,
  toolInteractionPhase,
  finishActiveToolInteraction,
  stepBackActiveToolInteraction,
  toolRegistry,
  type ConstructionPreview,
  type ToolContext,
} from '@/lib/tikz/render/tools';
import type {
  PreviewGeometry,
} from '@/lib/tikz/authoring/preview-ir';
import {
  createDefaultCommandRegistry,
  type DefaultCommandContext,
} from '@/lib/tikz/commands/default-commands';
import { explicitCanvasKeyboardFocusEntry } from '@/lib/tikz/commands/canvas-keyboard-gate';
import {
  fitViewport,
  sceneToScreen,
  screenToScene,
  tikzPresentationScale,
} from '@/lib/tikz/render/viewport';
import { labelSceneFitPoints } from '@/lib/tikz/render/label-layout';
import { BrowserSolverPort } from '@/lib/tikz/solver/browser-solver-port';
import type { Scene } from '@/lib/tikz/semantics/scene';
import type { Pt } from '@/lib/tikz/semantics/calc-eval';
import { flattenCircularArc } from '@/lib/tikz/geometry/circular-arc';
import { flattenEllipticalArc } from '@/lib/tikz/geometry/elliptical-arc';
import { flattenEllipse } from '@/lib/tikz/geometry/ellipse';
import type { TikzEngine } from './use-tikz-engine';
import type { SelectionTarget } from '@/lib/tikz/authoring/selection-target';
import { useExactTikzRender } from './use-exact-tikz-render';
import { TIKZ_MOTION } from './tikz-motion';
import { useTikzMotion } from './use-tikz-motion';
import {
  createTikzAsyncWorkItemId,
  tikzAsyncWorkItemOwnsBasis,
  type TikzAsyncWorkBasis,
  type TikzAsyncWorkItem,
} from '@/lib/tikz/runtime/work-item';

function selectionTargetKey(target: SelectionTarget): string {
  switch (target.kind) {
    case 'entity':
      return `entity:${String(target.sourceRevision)}:${target.semanticEntityId ?? target.stableId}`;
    case 'statement':
      return `statement:${String(target.sourceRevision)}:${String(target.stmtIndex)}`;
    case 'source-block':
      return `source-block:${String(target.sourceRevision)}:${String(target.range.start)}:${String(target.range.end)}`;
    case 'pending-ref':
      return `pending-ref:${String(target.sourceRevision)}:${target.ref}`;
  }
}

function sceneFitPoints(scene: Scene): { x: number; y: number }[] {
  const points = [...scene.points.values()]
    .filter((point) => !point.internal)
    .map((point) => point.position);
  for (const element of scene.elements) {
    if (element.kind === 'polyline') {
      points.push(...element.points);
    } else if (element.kind === 'cubic-bezier') {
      points.push(element.start, element.control1, element.control2, element.end);
    } else if (element.kind === 'circular-arc') {
      points.push(...flattenCircularArc(element, 10));
    } else if (element.kind === 'elliptical-arc') {
      points.push(...flattenEllipticalArc(element, 10));
    } else if (element.kind === 'circle') {
      points.push(
        { x: element.center.x - element.radius, y: element.center.y },
        { x: element.center.x + element.radius, y: element.center.y },
        { x: element.center.x, y: element.center.y - element.radius },
        { x: element.center.x, y: element.center.y + element.radius },
      );
    } else if (element.kind === 'graph-node') {
      points.push(
        { x: element.center.x - element.radius, y: element.center.y },
        { x: element.center.x + element.radius, y: element.center.y },
        { x: element.center.x, y: element.center.y - element.radius },
        { x: element.center.x, y: element.center.y + element.radius },
      );
    } else if (element.kind === 'ellipse') {
      points.push(...flattenEllipse(element, 32));
    } else if (element.kind === 'label') {
      points.push(...labelSceneFitPoints(element.at, element.text, element.anchor));
    } else {
      points.push(element.vertex, element.from, element.to);
    }
  }
  return points;
}

function renderPrimitiveStatementIndex(
  primitive: RenderPrimitive,
): number | null {
  const value = primitive.metadata?.statementIndex;
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function persistentManagedEntityReference(
  bindingIds: readonly string[],
): string | null {
  const prefix = 'binding:managed:';
  const marker = ':record:entity:';
  for (const bindingId of bindingIds) {
    if (!bindingId.startsWith(prefix)) continue;
    const markerIndex = bindingId.indexOf(marker, prefix.length);
    if (markerIndex < 0) continue;
    const constructionId = bindingId.slice(prefix.length, markerIndex);
    const recordId = bindingId.slice(markerIndex + marker.length);
    if (
      !constructionId
      || !recordId
      || constructionId.includes(':ambiguous:')
    ) continue;
    return qualifiedManagedEntityReference(constructionId, recordId);
  }
  return null;
}

function sameGeometryBasis(
  first: GeometryRevisionBasis,
  second: GeometryRevisionBasis,
): boolean {
  return (
    first.documentId === second.documentId
    && first.epoch === second.epoch
    && first.revision === second.revision
    && first.sourceHash === second.sourceHash
    && first.kernelHash === second.kernelHash
    && first.projectionHash === second.projectionHash
    && first.pluginSetDigest === second.pluginSetDigest
    && first.sourceId === second.sourceId
  );
}

function constraintSolveBasis(engine: TikzEngine): TikzAsyncWorkBasis {
  const sourceHash = hashSource(engine.code);
  const geometryBasis = engine.geometryDoc?.basis;
  const semanticBasisCurrent = Boolean(
    geometryBasis
    && geometryBasis.revision === engine.revision
    && geometryBasis.sourceHash === sourceHash,
  );
  return {
    documentId: geometryBasis?.documentId ?? 'mathgeo:local-document',
    epoch: geometryBasis?.epoch ?? 'local-source-only',
    sourceId: geometryBasis?.sourceId ?? 'mathgeo:local-document:tikz',
    revision: engine.revision,
    sourceHash,
    pluginSetDigest: geometryBasis?.pluginSetDigest ?? TIKZ_PLUGIN_SET_DIGEST,
    ...(semanticBasisCurrent && geometryBasis?.kernelHash
      ? { kernelHash: geometryBasis.kernelHash }
      : {}),
    ...(semanticBasisCurrent && geometryBasis?.projectionHash
      ? { projectionHash: geometryBasis.projectionHash }
      : {}),
  };
}

interface OwnedCanvasPreview<T> {
  readonly owner: CanvasInteractionPreviewOwner;
  readonly value: T;
}

export function TikzCanvas({
  engine,
  revealUpTo,
  exactMode = false,
  onSelectionTransformRequest,
}: {
  engine: TikzEngine;
  revealUpTo?: number;
  exactMode?: boolean;
  onSelectionTransformRequest?: (open: boolean) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasKeyboardArmedRef = useRef(false);
  // Source previews are drag-derived only. Creation previews stay in the
  // immutable ConstructionPreview overlay and never reparse a second Scene.
  const [ownedDragPreview, setOwnedDragPreview] = useState<OwnedCanvasPreview<string> | null>(null);
  const [ownedConstructionPreview, setOwnedConstructionPreview] = useState<
    OwnedCanvasPreview<ConstructionPreview> | null
  >(null);
  const previewOwnerRef = useRef<CanvasInteractionPreviewOwner | null>(null);
  const [solverStatus, setSolverStatus] = useState('');
  const [solverItem, setSolverItem] = useState<(
    TikzAsyncWorkItem<'constraint-solve'> & {
      readonly pointName: string;
    }
  ) | null>(null);
  const activeSolverItemIdRef = useRef<string | null>(null);
  const [renderFrame, setRenderFrame] = useState<ScreenFrame>({
    width: 0,
    height: 0,
  });
  const interactionBasis = useMemo<CanvasInteractionBasis>(() => ({
    revision: engine.revision,
    sourceHash: engine.geometryDoc?.basis.sourceHash ?? hashSource(engine.code),
    ...(engine.geometryDoc?.basis.kernelHash
      ? { kernelHash: engine.geometryDoc.basis.kernelHash }
      : {}),
    ...(engine.geometryDoc?.basis.projectionHash
      ? { projectionHash: engine.geometryDoc.basis.projectionHash }
      : {}),
  }), [engine.code, engine.geometryDoc, engine.revision]);
  const [interactionSession, dispatchInteraction] = useReducer(
    canvasInteractionReducer,
    undefined,
    () => createCanvasInteractionSession(interactionBasis, engine.activeTool),
  );
  const dragPreviewCode = ownedDragPreview
    && canvasInteractionOwnsPreview(interactionSession, ownedDragPreview.owner)
    ? ownedDragPreview.value
    : null;
  const constructionPreview = ownedConstructionPreview
    && canvasInteractionOwnsPreview(interactionSession, ownedConstructionPreview.owner)
    ? ownedConstructionPreview.value
    : null;
  const setDragPreviewCode = useCallback((next: string | null) => {
    if (next === null) {
      setOwnedDragPreview(null);
      return;
    }
    const owner = previewOwnerRef.current;
    if (owner) setOwnedDragPreview({ owner, value: next });
  }, []);
  const setConstructionPreview = useCallback((next: ConstructionPreview | null) => {
    if (next === null) {
      setOwnedConstructionPreview(null);
      return;
    }
    const owner = previewOwnerRef.current;
    if (owner) setOwnedConstructionPreview({ owner, value: next });
  }, []);
  useEffect(() => {
    previewOwnerRef.current = canvasInteractionPreviewOwner(interactionSession);
    setOwnedDragPreview((current) => (
      current && !canvasInteractionOwnsPreview(interactionSession, current.owner)
        ? null
        : current
    ));
    setOwnedConstructionPreview((current) => (
      current && !canvasInteractionOwnsPreview(interactionSession, current.owner)
        ? null
        : current
    ));
  }, [interactionSession]);
  const selectionMarquee = interactionSession.phase === 'box-selecting'
    ? interactionSession
    : null;
  const selectionTransformGesture = useMemo<SelectionTransformGesture | null>(() => (
    interactionSession.phase === 'transforming'
      ? {
          pointerId: interactionSession.pointerId,
          handle: interactionSession.handle,
          revision: interactionSession.basis.revision,
          bounds: interactionSession.bounds,
          start: interactionSession.start,
          current: interactionSession.current,
        }
      : null
  ), [interactionSession]);
  const toolSessionRef = useRef(createToolInteractionSession());
  const commandRegistry = useMemo(
    () => createDefaultCommandRegistry(),
    [],
  );
  const solverPort = useMemo(() => new BrowserSolverPort(), []);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const dragPreviewAnalysis = useMemo(
    () => dragPreviewCode ? analyze(dragPreviewCode, engine.revision) : null,
    [dragPreviewCode, engine.revision],
  );
  const emptyScene = useMemo<Scene>(() => ({
    sourceRevision: engine.revision,
    points: new Map(),
    elements: [],
    issues: [],
    graphOrder: [],
  }), [engine.revision]);
  const authoringScene = (
    engine.scene
    ?? (engine.code.trim().length === 0 ? emptyScene : null)
  );
  const displayScene = dragPreviewAnalysis?.scene ?? authoringScene;
  const exactSourceHash = useMemo(() => hashSource(engine.code), [engine.code]);
  const exactBasis = useMemo(() => ({
    documentId: engine.geometryDoc?.basis.documentId ?? 'mathgeo:local-document',
    epoch: engine.geometryDoc?.basis.epoch ?? 'local-source-only',
    sourceId: engine.geometryDoc?.basis.sourceId ?? 'mathgeo:local-document:tikz',
    revision: engine.revision,
    sourceHash: exactSourceHash,
    pluginSetDigest:
      engine.geometryDoc?.basis.pluginSetDigest ?? TIKZ_PLUGIN_SET_DIGEST,
  }), [engine.geometryDoc, engine.revision, exactSourceHash]);
  // Exact TeX is an explicit fidelity lane. Unsupported/opaque statements must
  // not disable interaction with the recognized semantic projection.
  const exact = useExactTikzRender(engine.code, exactBasis, exactMode);
  // A queued or failed compiler must not freeze the semantic canvas. The
  // isolated exact surface becomes read-only only after an attested artifact
  // for the current source is available.
  const useExactRenderer = exactMode && Boolean(exact.imageUrl);
  const interactiveRendering = useMemo(() => {
    const semanticRevision = engine.semanticRevision;
    const truthSet = engine.geometryTruth;
    if (
      semanticRevision === null
      || !truthSet
      || truthSet.semantic.basis.revision !== semanticRevision
    ) return null;
    return truthSet.rendering.find((rendering) => (
      rendering.target === 'interactive-svg'
      && rendering.rendererId === 'mathgeo.interactive-svg'
      && rendering.basis.revision === semanticRevision
      && rendering.renderRevision === semanticRevision
      && sameGeometryBasis(rendering.basis, truthSet.semantic.basis)
    )) ?? null;
  }, [engine.geometryTruth, engine.semanticRevision]);
  const revealedPrimitives = useMemo(() => {
    const primitives = interactiveRendering?.primitives;
    if (!primitives || revealUpTo === undefined) return primitives ?? null;
    return primitives.filter((primitive) => {
      const statementIndex = renderPrimitiveStatementIndex(primitive);
      return statementIndex === null || statementIndex <= revealUpTo;
    });
  }, [interactiveRendering, revealUpTo]);
  // Drag-derived source previews still use the legacy Scene projection until
  // preview transactions also carry a revision-bound truth set. Creation
  // previews never enter this path.
  const usePrimitiveRenderer = dragPreviewAnalysis === null
    && revealedPrimitives !== null;
  const decodedRendering = useMemo(
    () => decodeRenderPrimitives(revealedPrimitives ?? []),
    [revealedPrimitives],
  );
  const selectedTransformPrimitives = useMemo(() => {
    const primitiveIds = new Set(engine.selectionTargets.flatMap((target) => (
      (target.kind === 'entity' || target.kind === 'statement')
      && target.renderPrimitiveId
        ? [target.renderPrimitiveId]
        : []
    )));
    const entityIds = new Set(engine.selectionTargets.flatMap((target) => (
      (target.kind === 'entity' || target.kind === 'statement')
      && target.semanticEntityId
        ? [target.semanticEntityId]
        : []
    )));
    return decodedRendering.primitives.filter((primitive) => (
      primitiveIds.has(primitive.primitiveId)
      || primitive.entityIds.some((entityId) => entityIds.has(entityId))
    ));
  }, [decodedRendering.primitives, engine.selectionTargets]);
  const selectedTransformBounds = useMemo(() => (
    renderPrimitivesScreenBounds(
      selectedTransformPrimitives,
      engine.viewport,
      renderFrame,
    )
  ), [engine.viewport, renderFrame, selectedTransformPrimitives]);
  const selectionHandleCapabilities = useMemo(() => {
    if (!selectedTransformBounds) return null;
    const center = screenToScene(
      selectionTransformHandleLayout(selectedTransformBounds).center,
      engine.viewport,
    );
    return {
      move: engine.selectionTransformCapability({ kind: 'translate', dx: 0, dy: 0 }),
      rotate: engine.selectionTransformCapability({
        kind: 'rotate',
        degrees: 1,
        center,
      }),
      scale: engine.selectionTransformCapability({
        kind: 'scale',
        factor: 1.01,
        center,
      }),
    };
  }, [engine, selectedTransformBounds]);
  const activeSelectionTransformCapability = selectionTransformGesture
    ? selectionTransformGesture.handle === 'move'
      ? selectionHandleCapabilities?.move ?? null
      : selectionTransformGesture.handle === 'rotate'
        ? selectionHandleCapabilities?.rotate ?? null
        : selectionHandleCapabilities?.scale ?? null
    : null;
  const selectionTransformPreviewRendering = useMemo(() => {
    if (
      !selectionTransformGesture
      || activeSelectionTransformCapability?.status !== 'ready'
    ) return null;
    const impacted = new Set(activeSelectionTransformCapability.impactedEntityIds);
    return {
      primitives: decodedRendering.primitives.filter((primitive) => (
        primitive.entityIds.some((entityId) => impacted.has(entityId))
      )),
      issues: [],
    };
  }, [
    activeSelectionTransformCapability,
    decodedRendering.primitives,
    selectionTransformGesture,
  ]);
  const revealedScene = useMemo(() => {
    if (!displayScene || revealUpTo === undefined) return displayScene;
    return {
      ...displayScene,
      points: new Map(
        [...displayScene.points].filter(([, point]) => point.stmtIndex <= revealUpTo),
      ),
      elements: displayScene.elements.filter((element) => element.stmtIndex <= revealUpTo),
      issues: displayScene.issues.filter((issue) => issue.stmtIndex <= revealUpTo),
    };
  }, [displayScene, revealUpTo]);
  const structureSignature = engine.scene
    ? [...engine.scene.points.keys()].join(',')
    : '';
  const fitPointsRef = useRef<readonly { x: number; y: number }[]>([]);
  fitPointsRef.current = usePrimitiveRenderer && revealedPrimitives
    ? decodedRenderPrimitiveFitPoints(decodedRendering.primitives)
    : authoringScene
      ? sceneFitPoints(authoringScene)
      : [];
  const lastStructureSignatureRef = useRef<string | null>(null);

  const fitCurrentScene = useCallback(() => {
    const element = boxRef.current;
    const points = fitPointsRef.current;
    if (!element) return;
    engineRef.current.setViewport(
      fitViewport(
        [...points],
        element.clientWidth,
        element.clientHeight,
        40,
      ),
    );
  }, []);

  useEffect(() => {
    const previousSignature = lastStructureSignatureRef.current;
    const topologyChanged = previousSignature !== structureSignature;
    lastStructureSignatureRef.current = structureSignature;
    const replaceOrigin = (
      engine.lastEditOrigin === 'ai'
      || engine.lastEditOrigin === 'repair'
      || engine.lastEditOrigin === 'external'
    );
    if (topologyChanged || replaceOrigin) fitCurrentScene();
  }, [
    engine.lastEditOrigin,
    engine.revision,
    fitCurrentScene,
    structureSignature,
  ]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setRenderFrame((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measure();
      fitCurrentScene();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitCurrentScene]);

  useEffect(() => {
    const activeSolverItemId = activeSolverItemIdRef.current;
    if (activeSolverItemId) {
      const completedAt = Date.now();
      setSolverItem((current) => current?.itemId === activeSolverItemId
        && (current.status === 'queued' || current.status === 'running')
        ? {
            ...current,
            status: 'cancelled',
            updatedAt: completedAt,
            completedAt,
          }
        : current);
      activeSolverItemIdRef.current = null;
    }
    cancelActiveToolInteraction(toolSessionRef.current);
    previewOwnerRef.current = null;
    setDragPreviewCode(null);
    setConstructionPreview(null);
    setSolverStatus('');
    dispatchInteraction({
      type: 'synchronize',
      basis: interactionBasis,
      toolId: engine.activeTool,
    });
  }, [
    engine.activeTool,
    engine.code,
    interactionBasis,
    setConstructionPreview,
    setDragPreviewCode,
  ]);

  useEffect(() => {
    if (
      !engine.interactiveWritebackSafe
      || engine.semanticProjectionState !== 'current'
    ) return;
    setSolverStatus((current) => (
      current.startsWith('源码结构未完成')
      || current.startsWith('当前源码包含作用域级未知语法')
        ? ''
        : current
    ));
  }, [
    engine.interactiveWritebackSafe,
    engine.semanticProjectionState,
  ]);

  useEffect(() => () => solverPort.dispose(), [solverPort]);

  const toScenePoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return screenToScene({
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    }, engine.viewport);
  }, [engine.viewport]);

  const toClientPoint = useCallback((scenePoint: { x: number; y: number }) => (
    sceneToScreen(scenePoint, engine.viewport)
  ), [engine.viewport]);

  const context = useCallback((): ToolContext | null => {
    if (!authoringScene) return null;
    return {
      session: toolSessionRef.current,
      readOnly: !engine.interactiveWritebackSafe,
      code: engine.code,
      revision: engine.revision,
      scene: authoringScene,
      viewport: engine.viewport,
      freePointRanges: engine.freePointRanges,
      freePointTransforms: engine.freePointTransforms,
      applySourcePatches: engine.applySourcePatches,
      commitCanvasPointMove: engine.commitCanvasPointMove,
      commitCanvasDragPatches: engine.commitCanvasDragPatches,
      commitCanvasConstructionBatch: engine.commitCanvasConstructionBatch,
      solveDerivedDrag: async (pointName, target, sourceRevision, interactionSignal) => {
        const current = engineRef.current;
        if (current.revision !== sourceRevision) {
          throw new DOMException('Stale source revision', 'AbortError');
        }
        const itemId = createTikzAsyncWorkItemId('constraint-solve');
        const capturedBasis = constraintSolveBasis(current);
        const requestedAt = Date.now();
        activeSolverItemIdRef.current = itemId;
        setSolverItem({
          schemaVersion: 'tikz-async-work-item/v1',
          itemId,
          kind: 'constraint-solve',
          basis: capturedBasis,
          status: 'running',
          requestedAt,
          updatedAt: requestedAt,
          pointName,
        });
        const requestController = new AbortController();
        const abortRequest = () => requestController.abort(
          interactionSignal?.reason
            ?? new DOMException('Canvas interaction cancelled', 'AbortError'),
        );
        interactionSignal?.addEventListener('abort', abortRequest, { once: true });
        const timeoutId = globalThis.setTimeout(() => {
          requestController.abort(new DOMException(
            'Constraint solve exceeded 5 seconds',
            'TimeoutError',
          ));
        }, 5_000);
        try {
          const result = await solverPort.solveDerivedDrag({
            source: current.code,
            sourceRevision,
            pointName,
            target,
          }, requestController.signal);
          if (
            requestController.signal.aborted
            || !tikzAsyncWorkItemOwnsBasis(
              activeSolverItemIdRef.current,
              itemId,
              capturedBasis,
              constraintSolveBasis(engineRef.current),
            )
          ) {
            throw new DOMException('Stale source revision', 'AbortError');
          }
          const completedAt = Date.now();
          setSolverItem((workItem) => workItem?.itemId === itemId
            ? {
                ...workItem,
                status: 'ready',
                updatedAt: completedAt,
                completedAt,
              }
            : workItem);
          if (activeSolverItemIdRef.current === itemId) {
            activeSolverItemIdRef.current = null;
          }
          return result;
        } catch (solveError) {
          if (activeSolverItemIdRef.current === itemId) {
            const completedAt = Date.now();
            const timedOut = requestController.signal.reason instanceof DOMException
              && requestController.signal.reason.name === 'TimeoutError';
            const cancelled = !timedOut && (
              requestController.signal.aborted
              || (solveError instanceof DOMException && solveError.name === 'AbortError')
            );
            setSolverItem((workItem) => workItem?.itemId === itemId
              ? {
                  ...workItem,
                  status: cancelled ? 'cancelled' : 'failed',
                  updatedAt: completedAt,
                  completedAt,
                  ...(cancelled
                    ? {}
                    : {
                        errorCode: timedOut
                          ? 'CONSTRAINT_SOLVE_TIMEOUT'
                          : 'CONSTRAINT_SOLVE_FAILED',
                      }),
                }
              : workItem);
            activeSolverItemIdRef.current = null;
          }
          throw solveError;
        } finally {
          globalThis.clearTimeout(timeoutId);
          interactionSignal?.removeEventListener('abort', abortRequest);
        }
      },
      setSolverStatus,
      // The patch lane is reserved for drag-derived source previews. Creation
      // uses setConstructionPreview and remains source-neutral until commit.
      previewPatch: setDragPreviewCode,
      setConstructionPreview,
      hitTestRenderPrimitive: dragPreviewAnalysis
        ? undefined
        : (screen, tolerance) => {
          const hit = hitTestRenderPrimitives(
            screen,
            decodedRendering,
            engine.viewport,
            renderFrame,
            tolerance,
          );
          return hit
            ? {
              kind: hit.kind,
              pointName: hit.pointName,
              sourceStableId: hit.sourceStableId,
              semanticEntityId: hit.entityId,
              renderPrimitiveId: hit.primitiveId,
              sourceBindingIds: hit.sourceBindingIds,
              sourceRange: hit.sourceRange,
              stmtIndex: hit.statementIndex,
              refs: hit.references,
              distance: hit.distance,
            }
            : null;
        },
      hitTestRenderCircle: dragPreviewAnalysis
        ? undefined
        : (screen, tolerance) => {
          let best: {
            stableId: string;
            semanticEntityId: string;
            sourceBindingId: string;
            stmtIndex: number;
            sourceRange?: { start: number; end: number };
            refs: readonly string[];
            centerName: string;
            throughName: string | null;
            center: { x: number; y: number };
            radius: number;
            definition: PersistentSourceCircleDefinition;
          } | null = null;
          let bestDistance = tolerance;
          const sourceReferenceCounts = new Map<string, number>();
          for (const primitive of decodedRendering.primitives) {
            if (primitive.kind !== 'circle' || !primitive.circleDefinition) {
              continue;
            }
            const reference = qualifiedSourceCircleReference(
              primitive.circleDefinition,
            );
            if (!reference) continue;
            sourceReferenceCounts.set(
              reference,
              (sourceReferenceCounts.get(reference) ?? 0) + 1,
            );
          }
          for (const primitive of decodedRendering.primitives) {
            if (primitive.kind !== 'circle') continue;
            const managedReference = persistentManagedEntityReference(
              primitive.sourceBindingIds,
            );
            const sourceReference = primitive.circleDefinition
              ? qualifiedSourceCircleReference(primitive.circleDefinition)
              : null;
            const persistentReference = managedReference ?? sourceReference;
            const centerName = primitive.circleDefinition?.centerName
              ?? (managedReference ? primitive.references[0] : undefined);
            const throughName = primitive.circleDefinition?.kind === 'center-through'
                ? primitive.circleDefinition.throughName
                : managedReference
                  ? primitive.references[1] ?? null
                  : null;
            // Managed records provide reconciled center/through roles. Raw
            // source circles are accepted only when the parser carried an
            // explicit center-through or center-radius definition. Flat Scene
            // refs and revision-local element IDs never enter persisted plans.
            if (
              !persistentReference
              || !centerName
              || !primitive.circleDefinition
              || !primitive.entityIds[0]
              || !primitive.sourceBindingIds[0]
              || (
                !managedReference
                && sourceReferenceCounts.get(persistentReference) !== 1
              )
            ) continue;
            const center = sceneToScreen(primitive.center, engine.viewport);
            const distance = Math.abs(
              Math.hypot(screen.x - center.x, screen.y - center.y)
              - primitive.radius * engine.viewport.scale
            );
            if (distance > bestDistance) continue;
            bestDistance = distance;
            best = {
              stableId: persistentReference,
              semanticEntityId: primitive.entityIds[0],
              sourceBindingId: primitive.sourceBindingIds[0],
              stmtIndex: primitive.statementIndex ?? -1,
              sourceRange: primitive.sourceRange,
              refs: primitive.references,
              centerName,
              throughName,
              center: primitive.center,
              radius: primitive.radius,
              definition: primitive.circleDefinition,
            };
          }
          return best;
        },
      setSelection: engine.setSelection,
      selectionTargets: engine.selectionTargets,
      setSelectionTargets: engine.setSelectionTargets,
      setHoveredStmtIndex: engine.setHoveredStmtIndex,
      setViewport: engine.setViewport,
      toScenePoint,
      toClientPoint,
      promoteInteraction(pointerId, phase) {
        dispatchInteraction({ type: 'promote-tool', pointerId, phase });
      },
      completeInteraction(pointerId) {
        previewOwnerRef.current = null;
        setDragPreviewCode(null);
        setConstructionPreview(null);
        dispatchInteraction({ type: 'finish', pointerId });
      },
      cancelInteraction(pointerId, reason) {
        previewOwnerRef.current = null;
        setDragPreviewCode(null);
        setConstructionPreview(null);
        dispatchInteraction({ type: 'cancel', pointerId, reason });
      },
    };
  }, [
    authoringScene,
    decodedRendering,
    engine,
    dragPreviewAnalysis,
    renderFrame,
    setConstructionPreview,
    setDragPreviewCode,
    solverPort,
    toClientPoint,
    toScenePoint,
  ]);

  const dispatch = useCallback((
    type: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel',
    event: PointerEvent<SVGSVGElement>,
  ) => {
    if (useExactRenderer) return;
    event.currentTarget.focus();
    const tool = toolRegistry.get(engine.activeTool);
    const currentContext = context();
    if (!tool || !currentContext) return;
    const pointerKind = type === 'onPointerDown'
      ? 'pointer-down'
      : type === 'onPointerMove'
        ? 'pointer-move'
        : type === 'onPointerUp'
          ? 'pointer-up'
          : 'pointer-cancel';
    if (!canvasInteractionAcceptsPointer(interactionSession, {
      kind: pointerKind,
      pointerId: event.pointerId,
      toolId: tool.id,
    })) {
      if (canvasInteractionActive(interactionSession)) event.preventDefault();
      return;
    }
    if (
      currentContext.readOnly
      && tool.id !== 'select'
      && tool.id !== 'pan'
    ) {
      setSolverStatus(
        engine.semanticProjectionState === 'stale'
          ? '源码结构未完成：当前画板基于上一个有效版本，仅可查看'
          : '当前源码包含作用域级未知语法：为保护原文，画板暂时只读',
      );
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (type === 'onPointerDown') {
      const continuingConstruction = interactionSession.phase === 'constructing'
        && interactionSession.toolId === tool.id;
      const beginAction = {
        type: 'begin-tool',
        pointerId: event.pointerId,
        start: point,
        toolId: tool.id,
        phase: continuingConstruction
          ? 'constructing'
          : 'pressed',
      } as const;
      const startedSession = canvasInteractionReducer(interactionSession, beginAction);
      previewOwnerRef.current = canvasInteractionPreviewOwner(startedSession);
      dispatchInteraction(beginAction);
    }
    // Pointer ownership and the revision basis are now captured before the
    // mutable compatibility tool can select, capture, preview, solve or write.
    tool[type]?.(event, currentContext);
    const phase = toolInteractionPhase(toolSessionRef.current);
    if (type === 'onPointerDown') {
      if (phase !== 'idle') {
        dispatchInteraction({
          type: 'promote-tool',
          pointerId: event.pointerId,
          phase,
        });
      }
      // A one-click construction may synchronously commit during pointer-down.
      // Record the commit as part of this interaction before the ensuing
      // source revision invalidates its captured basis.
      if (
        phase === 'idle'
        && tool.id !== 'select'
        && tool.id !== 'pan'
      ) {
        dispatchInteraction({
          type: 'promote-tool',
          pointerId: event.pointerId,
          phase: 'committing',
        });
        previewOwnerRef.current = null;
        dispatchInteraction({ type: 'finish', pointerId: event.pointerId });
      }
    } else if (type === 'onPointerMove') {
      dispatchInteraction({ type: 'move', pointerId: event.pointerId, current: point });
    } else if (type === 'onPointerUp') {
      if (phase === 'constructing') {
        // Multi-click constructions keep the same semantic interaction open;
        // only pointer ownership is released between clicks.
        dispatchInteraction({ type: 'move', pointerId: event.pointerId, current: point });
      } else if (phase === 'committing') {
        dispatchInteraction({
          type: 'promote-tool',
          pointerId: event.pointerId,
          phase: 'committing',
        });
      } else {
        previewOwnerRef.current = null;
        dispatchInteraction({ type: 'finish', pointerId: event.pointerId });
      }
    } else {
      previewOwnerRef.current = null;
      dispatchInteraction({
        type: 'cancel',
        pointerId: event.pointerId,
        reason: 'pointer-cancel',
      });
    }
  }, [
    context,
    engine.activeTool,
    engine.semanticProjectionState,
    interactionSession,
    useExactRenderer,
  ]);

  const localPointer = useCallback((event: PointerEvent<SVGSVGElement>): Pt => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const transformPointerDown = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    const handleElement = (event.target as Element | null)?.closest?.('[data-transform-handle]');
    const handle = handleElement?.getAttribute('data-transform-handle') as SelectionTransformHandle | null;
    if (
      !handle
      || !selectedTransformBounds
      || !selectionHandleCapabilities
      || useExactRenderer
      || engine.activeTool !== 'select'
      || event.button !== 0
    ) return false;
    const capability = handle === 'move'
      ? selectionHandleCapabilities.move
      : handle === 'rotate'
        ? selectionHandleCapabilities.rotate
        : selectionHandleCapabilities.scale;
    if (capability.status !== 'ready') {
      if (capability.status === 'warning') {
        onSelectionTransformRequest?.(true);
      }
      setSolverStatus(capability.status === 'warning'
        ? `This transform affects ${capability.externalImpactedEntityIds.length} objects outside the selection. Confirm it in Selection Transform before applying.`
        : capability.reason ?? 'This transform is not writable for the current selection.');
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const point = localPointer(event);
    dispatchInteraction({
      type: 'begin-transform',
      pointerId: event.pointerId,
      handle,
      bounds: selectedTransformBounds,
      start: point,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, [
    engine.activeTool,
    localPointer,
    onSelectionTransformRequest,
    selectionHandleCapabilities,
    selectedTransformBounds,
    useExactRenderer,
  ]);

  const transformPointerMove = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    if (
      !selectionTransformGesture
      || selectionTransformGesture.pointerId !== event.pointerId
    ) return false;
    dispatchInteraction({
      type: 'move',
      pointerId: event.pointerId,
      current: localPointer(event),
    });
    event.preventDefault();
    return true;
  }, [localPointer, selectionTransformGesture]);

  const finishSelectionTransform = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    if (
      !selectionTransformGesture
      || selectionTransformGesture.pointerId !== event.pointerId
    ) return false;
    const gesture = {
      ...selectionTransformGesture,
      current: localPointer(event),
    };
    dispatchInteraction({ type: 'finish', pointerId: event.pointerId });
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
    if (gesture.revision !== engine.revision) {
      setSolverStatus('画板已变化，本次整体变换已取消。');
      return true;
    }
    const transform = selectionTransformFromGesture(
      gesture,
      engine.viewport.scale,
      event.shiftKey,
    );
    const isNoop = transform.kind === 'translate'
      ? Math.hypot(transform.dx, transform.dy) < 1e-6
      : transform.kind === 'rotate'
        ? Math.abs(transform.degrees) < 1e-6
        : transform.kind === 'scale'
          ? Math.abs(transform.factor - 1) < 1e-6
          : false;
    if (isNoop) return true;
    const selectionCenter = screenToScene(
      selectionTransformHandleLayout(gesture.bounds).center,
      engine.viewport,
    );
    const resolvedTransform = transform.kind === 'rotate' || transform.kind === 'scale'
      ? { ...transform, center: selectionCenter }
      : transform;
    const result = engine.transformSelection(resolvedTransform);
    setSolverStatus(result.committed
      ? '整体变换已同步到画板与 TikZ 源码。'
      : result.message ?? '整体变换未应用。');
    return true;
  }, [engine, localPointer, selectionTransformGesture]);

  const marqueePointerDown = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    if (
      useExactRenderer
      || engine.activeTool !== 'select'
      || event.button !== 0
      || !usePrimitiveRenderer
    ) return false;
    const point = localPointer(event);
    if (hitTestRenderPrimitives(point, decodedRendering, engine.viewport, renderFrame, 8)) {
      return false;
    }
    dispatchInteraction({
      type: 'begin-marquee',
      pointerId: event.pointerId,
      start: point,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      baseTargets: engine.selectionTargets,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    return true;
  }, [
    decodedRendering,
    engine.activeTool,
    engine.selectionTargets,
    engine.viewport,
    localPointer,
    renderFrame,
    useExactRenderer,
    usePrimitiveRenderer,
  ]);

  const marqueePointerMove = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    if (!selectionMarquee || selectionMarquee.pointerId !== event.pointerId) return false;
    dispatchInteraction({
      type: 'move',
      pointerId: event.pointerId,
      current: localPointer(event),
    });
    event.preventDefault();
    return true;
  }, [localPointer, selectionMarquee]);

  const finishMarquee = useCallback((event: PointerEvent<SVGSVGElement>): boolean => {
    if (!selectionMarquee || selectionMarquee.pointerId !== event.pointerId) return false;
    const current = localPointer(event);
    const distance = Math.hypot(
      current.x - selectionMarquee.start.x,
      current.y - selectionMarquee.start.y,
    );
    const hits = distance < 4
      ? []
      : renderPrimitivesInScreenRect(
        decodedRendering.primitives,
        normalizedScreenRect(selectionMarquee.start, current),
        engine.viewport,
        renderFrame,
        current.x >= selectionMarquee.start.x ? 'contain' : 'intersect',
      );
    const targets: SelectionTarget[] = hits.flatMap((primitive) => {
      const semanticEntityId = primitive.entityIds[0];
      if (!semanticEntityId || primitive.statementIndex === null) return [];
      return [{
        kind: 'entity' as const,
        sourceRevision: engine.revision,
        stableId: primitive.sourceStableId ?? semanticEntityId,
        stmtIndex: primitive.statementIndex,
        entityKind: primitive.kind === 'point' ? 'point' as const : 'element' as const,
        refs: [...primitive.references],
        semanticEntityId,
        renderPrimitiveId: primitive.primitiveId,
        sourceBindingIds: [...primitive.sourceBindingIds],
        ...(primitive.sourceRange ? { sourceRange: { ...primitive.sourceRange } } : {}),
      }];
    });
    const deduplicated = new Map<string, SelectionTarget>();
    if (selectionMarquee.additive) {
      for (const target of selectionMarquee.baseTargets) {
        deduplicated.set(selectionTargetKey(target), target);
      }
    }
    for (const target of targets) {
      deduplicated.set(selectionTargetKey(target), target);
    }
    engine.setSelectionTargets([...deduplicated.values()]);
    dispatchInteraction({ type: 'finish', pointerId: event.pointerId });
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }, [
    decodedRendering.primitives,
    engine,
    localPointer,
    renderFrame,
    selectionMarquee,
  ]);

  const onKeyDown = useCallback((event: KeyboardEvent<SVGSVGElement>) => {
    if (!canvasKeyboardArmedRef.current) return;
    if (event.key === 'Escape' && canvasInteractionActive(interactionSession)) {
      if (event.currentTarget.hasPointerCapture?.(interactionSession.pointerId)) {
        event.currentTarget.releasePointerCapture(interactionSession.pointerId);
      }
      dispatchInteraction({ type: 'cancel', reason: 'escape' });
      previewOwnerRef.current = null;
      const currentContext = context();
      cancelActiveToolInteraction(toolSessionRef.current, currentContext ?? undefined);
      setDragPreviewCode(null);
      setConstructionPreview(null);
      setSolverStatus('');
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (event.metaKey || event.ctrlKey)
      && event.key.toLocaleLowerCase() === 'k'
    ) {
      // The global palette owns Mod+K. Let the event reach its single
      // window-level dispatcher instead of resolving it with a canvas context.
      return;
    }
    const currentContext = context();
    if (!currentContext || useExactRenderer) return;
    const activeConstruction = (
      toolSessionRef.current.authoring !== null
      || (engine.activeTool !== 'select' && engine.activeTool !== 'pan')
    );
    const commandContext: DefaultCommandContext = {
      activeConstruction,
      hasSelection: engine.selection.length > 0,
      activateTool(toolId) {
        cancelActiveToolInteraction(
          toolSessionRef.current,
          currentContext,
        );
        engine.setActiveTool(toolId);
      },
      finishConstruction() {
        finishActiveToolInteraction(currentContext);
      },
      backConstruction() {
        const steppedBack = stepBackActiveToolInteraction(currentContext);
        if (!steppedBack && toolSessionRef.current.authoring === null) {
          engine.setActiveTool('select');
        }
      },
      deleteSelection() {
        // Keyboard deletion must never bypass the Inspector's managed-block
        // safety policy. External descendants still require the explicit,
        // two-step cascade action in the Inspector.
        engine.deleteSelection('block');
      },
      selectAllGeometry() {
        engine.selectAllGeometry();
      },
    };
    const result = commandRegistry.dispatch({
      shortcut: event.nativeEvent,
      event: event.nativeEvent,
      scope: 'canvas',
      context: commandContext,
    });
    if (result.handled) event.stopPropagation();
  }, [
    commandRegistry,
    context,
    engine,
    interactionSession,
    setConstructionPreview,
    setDragPreviewCode,
    useExactRenderer,
  ]);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      if (useExactRenderer) return;
      const rect = element.getBoundingClientRect();
      const local = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const sceneAnchor = screenToScene(local, engine.viewport);
      const scale = Math.max(
        6,
        Math.min(240, engine.viewport.scale * Math.exp(-event.deltaY * 0.0015)),
      );
      engine.setViewport({
        scale,
        offsetX: local.x - sceneAnchor.x * scale,
        offsetY: local.y + sceneAnchor.y * scale,
      });
      event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [engine, useExactRenderer]);

  const activeTool = toolRegistry.get(engine.activeTool);
  const sourceBindingRanges = useMemo(
    () => sourceBindingRangeMap(engine.geometrySourceMap, engine.revision),
    [engine.geometrySourceMap, engine.revision],
  );
  useTikzMotion({
    svgRef,
    scene: revealedScene ?? null,
    revision: engine.semanticRevision ?? engine.revision,
    selection: engine.selection,
  });

  return (
    <div
      ref={boxRef}
      className="tz-canvas"
      data-testid="tikz-canvas"
      data-solver-item-id={solverItem?.itemId}
      data-solver-item-status={solverItem?.status}
      data-solver-source-revision={solverItem?.basis.revision}
      data-solver-point={solverItem?.pointName}
    >
      <svg
        ref={svgRef}
        tabIndex={0}
        width="100%"
        height="100%"
        role="img"
        aria-label="TikZ 几何构造画布"
        data-interaction-phase={interactionSession.phase}
        data-interaction-id={canvasInteractionActive(interactionSession)
          ? interactionSession.interactionId
          : undefined}
        aria-busy={interactionSession.phase === 'committing'}
        style={{
          cursor: useExactRenderer ? 'default' : activeTool?.cursor ?? 'default',
          touchAction: 'none',
          visibility: useExactRenderer && exact.imageUrl ? 'hidden' : 'visible',
        }}
        onPointerDown={(event) => {
          // Pointer entry is an unambiguous request to operate the Canvas.
          // This also clears the temporary editor-focus safety barrier.
          canvasKeyboardArmedRef.current = true;
          if (!transformPointerDown(event) && !marqueePointerDown(event)) {
            if (engine.activeTool !== 'select' && engine.activeTool !== 'pan') {
              onSelectionTransformRequest?.(false);
            }
            dispatch('onPointerDown', event);
          }
        }}
        onFocus={(event) => {
          if (explicitCanvasKeyboardFocusEntry(event.relatedTarget)) {
            canvasKeyboardArmedRef.current = true;
          }
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            canvasKeyboardArmedRef.current = false;
          }
        }}
        onPointerMove={(event) => {
          if (!transformPointerMove(event) && !marqueePointerMove(event)) {
            dispatch('onPointerMove', event);
          }
        }}
        onPointerUp={(event) => {
          if (!finishSelectionTransform(event) && !finishMarquee(event)) {
            dispatch('onPointerUp', event);
          }
        }}
        onPointerCancel={(event) => {
          if (selectionTransformGesture?.pointerId === event.pointerId) {
            dispatchInteraction({
              type: 'cancel',
              pointerId: event.pointerId,
              reason: 'pointer-cancel',
            });
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          } else if (selectionMarquee?.pointerId === event.pointerId) {
            dispatchInteraction({
              type: 'cancel',
              pointerId: event.pointerId,
              reason: 'pointer-cancel',
            });
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          } else dispatch('onPointerCancel', event);
        }}
        onPointerLeave={() => engine.setHoveredStmtIndex(null)}
        onKeyDown={onKeyDown}
      >
        {usePrimitiveRenderer
          ? (
            <TikzRenderPrimitiveSvg
              rendering={decodedRendering}
              viewport={engine.viewport}
              frame={renderFrame}
              selection={engine.selection}
              selectedRenderPrimitiveIds={
                engine.selectionTargets.flatMap((target) => (
                  (target.kind === 'entity' || target.kind === 'statement')
                  && target.renderPrimitiveId
                    ? [target.renderPrimitiveId]
                    : []
                ))
              }
              selectedSemanticEntityIds={
                engine.selectionTargets.flatMap((target) => (
                  (target.kind === 'entity' || target.kind === 'statement')
                  && target.semanticEntityId
                    ? [target.semanticEntityId]
                    : []
                ))
              }
              selectedStmtIndex={engine.selectedStmtIndex}
              hoveredStmtIndex={engine.hoveredStmtIndex}
            />
          )
          : revealedScene
            ? (
              <TikzSceneSvg
                scene={revealedScene}
                viewport={engine.viewport}
                selection={engine.selection}
                selectedStmtIndex={engine.selectedStmtIndex}
                hoveredStmtIndex={engine.hoveredStmtIndex}
                sourceBindingRanges={sourceBindingRanges}
              />
            )
            : null}
        {constructionPreview && !useExactRenderer
          ? (
            <ConstructionPreviewSvg
              preview={constructionPreview}
              viewport={engine.viewport}
            />
          )
          : null}
        {selectionTransformGesture
          && selectionTransformPreviewRendering
          && !useExactRenderer
          ? (
            <g
              className="tz-selection-transform-preview"
              data-testid="selection-transform-geometry-preview"
              transform={selectionTransformPreviewSvgTransform(selectionTransformGesture)}
              pointerEvents="none"
            >
              <TikzRenderPrimitiveSvg
                rendering={selectionTransformPreviewRendering}
                viewport={engine.viewport}
                frame={renderFrame}
                selectedSemanticEntityIds={activeSelectionTransformCapability?.impactedEntityIds ?? []}
              />
            </g>
          )
          : null}
        {selectionMarquee && !useExactRenderer
          ? (() => {
            const rect = normalizedScreenRect(selectionMarquee.start, selectionMarquee.current);
            return (
            <rect
              className="tz-selection-marquee"
              data-mode={selectionMarquee.current.x >= selectionMarquee.start.x
                ? 'contain'
                : 'intersect'}
                x={rect.left}
                y={rect.top}
                width={rect.right - rect.left}
                height={rect.bottom - rect.top}
                pointerEvents="none"
              />
            );
          })()
          : null}
        {selectedTransformBounds
          && usePrimitiveRenderer
          && !useExactRenderer
          && engine.activeTool === 'select'
          && !selectionMarquee
          ? (
            <SelectionTransformHandlesSvg
              bounds={selectedTransformBounds}
              gesture={selectionTransformGesture}
              capabilities={{
                move: selectionHandleCapabilities?.move.status === 'ready',
                rotate: selectionHandleCapabilities?.rotate.status === 'ready',
                scale: selectionHandleCapabilities?.scale.status === 'ready',
              }}
            />
          )
          : null}
      </svg>
      {exactMode && exact.imageUrl
        ? (
          // The SVG must stay in image-document isolation; do not inline it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="tz-exact-render"
            src={exact.imageUrl}
            alt="TikZ 精确编译预览"
            data-exact-item-id={exact.item?.itemId}
            data-source-revision={exact.item?.basis.revision}
            data-source-digest={exact.attestation?.sourceDigest}
            data-artifact-digest={exact.attestation?.artifactDigest}
            data-job-id={exact.attestation?.jobId}
            data-compiler-profile={exact.attestation?.profile}
          />
        )
        : null}
      {exactMode && exact.error
        ? (
          <button
            type="button"
            className="tz-exact-retry"
            onClick={exact.retry}
          >
            重试精准编译
          </button>
        )
        : null}
      {exactMode && exact.diagnostics.length > 0
        ? (
          <details className="tz-exact-diagnostics">
            <summary>查看精确编译诊断（{exact.diagnostics.length}）</summary>
            <ul>
              {exact.diagnostics.slice(0, 6).map((diagnostic) => (
                <li key={`${diagnostic.rule}:${diagnostic.start}:${diagnostic.end}`}>
                  <code>{diagnostic.command ?? diagnostic.rule}</code>
                  <span>{diagnostic.start}–{diagnostic.end}</span>
                </li>
              ))}
            </ul>
          </details>
        )
        : null}
      <AnimatePresence>
        {exactMode
          ? (
            <motion.div
              key="exact-status"
              className="tz-render-mode"
              role="status"
              data-exact-item-id={exact.item?.itemId}
              data-exact-item-status={exact.item?.status ?? 'idle'}
              data-source-revision={exact.item?.basis.revision}
              data-compiler-profile={exact.item?.profile}
              {...TIKZ_MOTION.status}
              transition={TIKZ_MOTION.spring}
            >
            {exact.loading
              ? `正在请求隔离 TeX 精确渲染 · revision ${exact.item?.basis.revision ?? engine.revision}…`
              : exact.error
                ? `精确渲染失败：${exact.error}`
                : exact.imageUrl
                  ? '精确 TikZ 渲染 · 此模式不可拖拽'
                  : '等待精确渲染…'}
            </motion.div>
          )
          : null}
        {engine.semanticProjectionState === 'stale'
          ? (
            <motion.div
              key="stale-status"
              className="tz-render-mode tz-render-mode--stale"
              role="status"
              {...TIKZ_MOTION.status}
              transition={TIKZ_MOTION.spring}
            >
            源码结构未完成 · 画板只读显示 revision {engine.semanticRevision ?? '—'}
            </motion.div>
          )
          : null}
        {engine.issues.length > 0
          ? (
            <motion.div
              key="issues"
              className="tz-issues"
              data-testid="tikz-issues"
              role="status"
              {...TIKZ_MOTION.panel}
              transition={TIKZ_MOTION.softSpring}
            >
            {engine.issues.slice(0, 3).map((issue, index) => (
              <div key={`${issue.message}:${index}`} className="tz-issue">{issue.message}</div>
            ))}
            </motion.div>
          )
          : null}
        {solverStatus
          ? (
            <motion.div
              key="solver"
              className="tz-solver-status"
              role="status"
              data-work-item-id={solverItem?.itemId}
              data-work-item-status={solverItem?.status}
              data-source-revision={solverItem?.basis.revision}
              {...TIKZ_MOTION.status}
              transition={TIKZ_MOTION.spring}
            >
              <span className="tz-solver-status__pulse" aria-hidden="true" />
              {solverStatus}
            </motion.div>
          )
          : null}
        {useExactRenderer && exact.attestation
          ? (
            <motion.details
              key="attestation"
              className="tz-attestation"
              {...TIKZ_MOTION.panel}
              transition={TIKZ_MOTION.softSpring}
            >
              <summary>
                <span aria-hidden="true">✓</span>
                可验证精确产物
              </summary>
              <dl>
                <div><dt>Source</dt><dd>{exact.attestation.sourceDigest.slice(0, 12)}</dd></div>
                <div><dt>Revision</dt><dd>{exact.item?.basis.revision ?? '—'}</dd></div>
                <div><dt>Item</dt><dd>{exact.item?.itemId.slice(-12) ?? '—'}</dd></div>
                <div><dt>Job</dt><dd>{exact.attestation.jobId.slice(-12)}</dd></div>
                <div><dt>Artifact</dt><dd>{exact.attestation.artifactDigest.slice(0, 12)}</dd></div>
                <div><dt>Cache</dt><dd>{exact.attestation.cacheKeyDigest.slice(0, 12)}</dd></div>
                <div><dt>Compiler</dt><dd>{exact.attestation.compilerImageDigest.slice(-12)}</dd></div>
                <div><dt>Profile</dt><dd>{exact.attestation.profileManifestDigest.slice(0, 12)}</dd></div>
                <div><dt>Visibility</dt><dd>{exact.attestation.visibility}</dd></div>
                <div><dt>Bytes</dt><dd>{exact.attestation.svgBytes}</dd></div>
              </dl>
            </motion.details>
          )
          : null}
      </AnimatePresence>
    </div>
  );
}

function SelectionTransformHandlesSvg({
  bounds,
  gesture,
  capabilities,
}: {
  bounds: NonNullable<ReturnType<typeof renderPrimitivesScreenBounds>>;
  gesture: SelectionTransformGesture | null;
  capabilities: {
    readonly move: boolean;
    readonly rotate: boolean;
    readonly scale: boolean;
  };
}) {
  const preview = gesture
    ? selectionTransformPreviewLayout(gesture)
    : {
      layout: selectionTransformHandleLayout(bounds),
      rotationDegrees: 0,
    };
  const { layout } = preview;
  const width = layout.bounds.right - layout.bounds.left;
  const height = layout.bounds.bottom - layout.bounds.top;
  const transform = preview.rotationDegrees === 0
    ? undefined
    : `rotate(${preview.rotationDegrees} ${layout.center.x} ${layout.center.y})`;
  const scaleHandles = [
    ['scale-nw', layout.corners.nw],
    ['scale-ne', layout.corners.ne],
    ['scale-se', layout.corners.se],
    ['scale-sw', layout.corners.sw],
  ] as const;
  return (
    <g
      className="tz-selection-transform-handles"
      data-writable={capabilities.move || capabilities.rotate || capabilities.scale ? 'true' : 'false'}
      data-transforming={gesture ? 'true' : undefined}
      transform={transform}
    >
      <rect
        className="tz-selection-transform-handles__bounds"
        x={layout.bounds.left}
        y={layout.bounds.top}
        width={width}
        height={height}
        pointerEvents="none"
      />
      <line
        className="tz-selection-transform-handles__stem"
        x1={layout.center.x}
        y1={layout.bounds.top}
        x2={layout.rotation.x}
        y2={layout.rotation.y}
        pointerEvents="none"
      />
      <circle
        className="tz-selection-transform-handle is-rotate"
        data-transform-handle="rotate"
        data-disabled={capabilities.rotate ? undefined : 'true'}
        aria-disabled={!capabilities.rotate}
        data-testid="selection-transform-rotate"
        cx={layout.rotation.x}
        cy={layout.rotation.y}
        r={7}
      />
      {scaleHandles.map(([handle, point]) => (
        <rect
          key={handle}
          className={`tz-selection-transform-handle is-${handle}`}
          data-transform-handle={handle}
          data-disabled={capabilities.scale ? undefined : 'true'}
          aria-disabled={!capabilities.scale}
          data-testid={`selection-transform-${handle}`}
          x={point.x - 6}
          y={point.y - 6}
          width={12}
          height={12}
          rx={3}
        />
      ))}
      <g
        className="tz-selection-transform-handle is-move"
        data-transform-handle="move"
        data-disabled={capabilities.move ? undefined : 'true'}
        aria-disabled={!capabilities.move}
        data-testid="selection-transform-move"
        transform={`translate(${layout.center.x} ${layout.center.y})`}
      >
        <circle r={11} />
        <path d="M -5 0 H 5 M 0 -5 V 5 M -5 0 l 2 -2 M -5 0 l 2 2 M 5 0 l -2 -2 M 5 0 l -2 2 M 0 -5 l -2 2 M 0 -5 l 2 2 M 0 5 l -2 -2 M 0 5 l 2 -2" />
      </g>
    </g>
  );
}

function ConstructionPreviewSvg({
  preview,
  viewport,
}: {
  preview: ConstructionPreview;
  viewport: TikzEngine['viewport'];
}) {
  const anchors = preview.anchors.map((point) => sceneToScreen(point, viewport));
  const pointer = sceneToScreen(preview.candidate ?? preview.pointer, viewport);
  const pathPoints = [...anchors, pointer];
  const path = pathPoints.length > 1
    ? pathPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
    : '';
  const closing = preview.closePath && anchors.length >= 3
    ? `M ${pointer.x} ${pointer.y} L ${anchors[0].x} ${anchors[0].y}`
    : '';
  const previewIR = preview.previewIR;
  const typedGeometries = previewIR?.geometries ?? [];
  const hasTypedGeometry = typedGeometries.length > 0;
  const previewStatus = previewIR?.status ?? (preview.valid ? 'valid' : 'invalid');
  return (
    <motion.g
      className={`tz-construction-preview is-${previewStatus}`}
      data-tool-preview={preview.toolId}
      data-preview-status={previewStatus}
      pointerEvents="none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
    >
      <defs>
        <marker
          id="tz-construction-preview-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            className="tz-construction-preview__arrowhead"
            d="M 0 0 L 8 4 L 0 8 Z"
          />
        </marker>
      </defs>
      {hasTypedGeometry
        ? typedGeometries.map((geometry) => (
          <ConstructionPreviewGeometrySvg
            key={`${previewIR?.planId ?? preview.toolId}:${geometry.id}`}
            geometry={geometry}
            viewport={viewport}
          />
        ))
        : null}
      {!hasTypedGeometry && path
        ? (
          <motion.path
            className="tz-construction-preview__path"
            d={path}
            initial={{ pathLength: 0, opacity: 0.35 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={TIKZ_MOTION.spring}
          />
        )
        : null}
      {!hasTypedGeometry && closing
        ? (
          <motion.path
            className="tz-construction-preview__path"
            d={closing}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={TIKZ_MOTION.spring}
          />
        )
        : null}
      {anchors.map((point, index) => (
        <g key={`${point.x}:${point.y}:${index}`}>
          <circle
            className="tz-construction-preview__anchor"
            cx={point.x}
            cy={point.y}
            r="7"
          />
          <text
            className="tz-construction-preview__index"
            x={point.x + 10}
            y={point.y - 10}
          >
            {index + 1}
          </text>
        </g>
      ))}
      <circle
        className="tz-construction-preview__candidate"
        cx={pointer.x}
        cy={pointer.y}
        r={preview.candidate ? 11 : 7}
      />
      {preview.candidateName
        ? (
          <text
            className="tz-construction-preview__label"
            x={pointer.x + 14}
            y={pointer.y + 4}
          >
            {preview.candidateName}
          </text>
        )
        : null}
    </motion.g>
  );
}

function screenPath(
  points: readonly Pt[],
  viewport: TikzEngine['viewport'],
  close = false,
): string {
  const screenPoints = points.map((point) => sceneToScreen(point, viewport));
  if (screenPoints.length === 0) return '';
  const path = screenPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  return close ? `${path} Z` : path;
}

function ConstructionPreviewGeometrySvg({
  geometry,
  viewport,
}: {
  geometry: PreviewGeometry;
  viewport: TikzEngine['viewport'];
}) {
  switch (geometry.kind) {
    case 'point': {
      const point = sceneToScreen(geometry.point, viewport);
      return (
        <circle
          className="tz-construction-preview__geometry tz-construction-preview__geometry--point"
          data-preview-geometry={geometry.kind}
          cx={point.x}
          cy={point.y}
          r="8"
        />
      );
    }
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return (
        <path
          className="tz-construction-preview__geometry tz-construction-preview__geometry--path"
          data-preview-geometry={geometry.kind}
          d={screenPath([geometry.from, geometry.to], viewport)}
          markerEnd={geometry.kind === 'vector' || geometry.kind === 'ray'
            ? 'url(#tz-construction-preview-arrow)'
            : undefined}
        />
      );
    case 'polyline':
    case 'polygon':
      return (
        <path
          className="tz-construction-preview__geometry tz-construction-preview__geometry--path"
          data-preview-geometry={geometry.kind}
          d={screenPath(geometry.points, viewport, geometry.kind === 'polygon')}
        />
      );
    case 'rectangle':
      return (
        <path
          className="tz-construction-preview__geometry tz-construction-preview__geometry--path"
          data-preview-geometry={geometry.kind}
          d={screenPath(geometry.corners, viewport, true)}
        />
      );
    case 'circle': {
      const center = sceneToScreen(geometry.center, viewport);
      return (
        <circle
          className="tz-construction-preview__geometry tz-construction-preview__geometry--circle"
          data-preview-geometry={geometry.kind}
          cx={center.x}
          cy={center.y}
          r={geometry.radius * viewport.scale}
        />
      );
    }
    case 'label': {
      const at = sceneToScreen(geometry.at, viewport);
      return (
        <text
          className="tz-construction-preview__geometry tz-construction-preview__geometry--label"
          data-preview-geometry={geometry.kind}
          x={at.x + 10}
          y={at.y - 10}
        >
          {geometry.text}
        </text>
      );
    }
    case 'angle': {
      const mark = previewAngleMarkPath(geometry.points, viewport);
      return mark
        ? (
          <path
            className="tz-construction-preview__geometry tz-construction-preview__geometry--angle-mark"
            data-preview-geometry={geometry.kind}
            d={mark}
          />
        )
        : null;
    }
    case 'right-angle': {
      const arms = screenPath(geometry.points, viewport);
      const marker = rightAngleMarkerPath(geometry.points, viewport);
      return (
        <g data-preview-geometry={geometry.kind}>
          <path
            className="tz-construction-preview__geometry tz-construction-preview__geometry--path"
            data-preview-geometry={geometry.kind}
            d={arms}
          />
          {marker
            ? (
              <path
                className="tz-construction-preview__geometry tz-construction-preview__geometry--right-angle"
                data-preview-geometry={geometry.kind}
                d={marker}
              />
            )
            : null}
        </g>
      );
    }
  }
  return null;
}

/**
 * Render an angle preview as the same finite arc mark used by committed
 * TikZ angle primitives.  The construction points remain the semantic
 * definition of the angle; the two defining rays are intentionally not
 * painted into the preview.
 */
function previewAngleMarkPath(
  points: readonly Pt[],
  viewport: TikzEngine['viewport'],
): string | null {
  if (points.length !== 3) return null;
  const [from, vertex, to] = points.map((point) => sceneToScreen(point, viewport));
  const firstLength = Math.hypot(from.x - vertex.x, from.y - vertex.y);
  const secondLength = Math.hypot(to.x - vertex.x, to.y - vertex.y);
  const radius = Math.min(
    DEFAULT_ANGLE_MARK_RADIUS * tikzPresentationScale(viewport),
    firstLength * 0.25,
    secondLength * 0.25,
  );
  if (!(radius > 1e-6)) return null;
  const path = angleMarkPath({
    vertex,
    from,
    to,
    right: false,
    radius,
  });
  return path || null;
}

function rightAngleMarkerPath(
  points: readonly Pt[],
  viewport: TikzEngine['viewport'],
): string | null {
  if (points.length !== 3) return null;
  const [first, vertex, second] = points.map((point) => sceneToScreen(point, viewport));
  const firstLength = Math.hypot(first.x - vertex.x, first.y - vertex.y);
  const secondLength = Math.hypot(second.x - vertex.x, second.y - vertex.y);
  if (firstLength <= 1e-6 || secondLength <= 1e-6) return null;
  const size = Math.min(
    DEFAULT_ANGLE_MARK_RADIUS * tikzPresentationScale(viewport),
    firstLength * 0.28,
    secondLength * 0.28,
  );
  const firstUnit = {
    x: (first.x - vertex.x) / firstLength,
    y: (first.y - vertex.y) / firstLength,
  };
  const secondUnit = {
    x: (second.x - vertex.x) / secondLength,
    y: (second.y - vertex.y) / secondLength,
  };
  const firstCorner = {
    x: vertex.x + firstUnit.x * size,
    y: vertex.y + firstUnit.y * size,
  };
  const secondCorner = {
    x: vertex.x + secondUnit.x * size,
    y: vertex.y + secondUnit.y * size,
  };
  const farCorner = {
    x: firstCorner.x + secondUnit.x * size,
    y: firstCorner.y + secondUnit.y * size,
  };
  return [
    `M ${firstCorner.x} ${firstCorner.y}`,
    `L ${farCorner.x} ${farCorner.y}`,
    `L ${secondCorner.x} ${secondCorner.y}`,
  ].join(' ');
}
