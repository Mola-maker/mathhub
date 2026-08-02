'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { analyze } from '@/lib/tikz/analyze';
import type {
  GeometryRevisionBasis,
  RenderPrimitive,
} from '@/lib/tikz/ir';
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
import { fitViewport, sceneToScreen, screenToScene } from '@/lib/tikz/render/viewport';
import { BrowserSolverPort } from '@/lib/tikz/solver/browser-solver-port';
import type { Scene } from '@/lib/tikz/semantics/scene';
import type { Pt } from '@/lib/tikz/semantics/calc-eval';
import type { TikzEngine } from './use-tikz-engine';
import { useExactTikzRender } from './use-exact-tikz-render';
import { TIKZ_MOTION } from './tikz-motion';
import { useTikzMotion } from './use-tikz-motion';

function sceneFitPoints(scene: Scene): { x: number; y: number }[] {
  const points = [...scene.points.values()]
    .filter((point) => !point.internal)
    .map((point) => point.position);
  for (const element of scene.elements) {
    if (element.kind === 'polyline') {
      points.push(...element.points);
    } else if (element.kind === 'circle') {
      points.push(
        { x: element.center.x - element.radius, y: element.center.y },
        { x: element.center.x + element.radius, y: element.center.y },
        { x: element.center.x, y: element.center.y - element.radius },
        { x: element.center.x, y: element.center.y + element.radius },
      );
    } else if (element.kind === 'label') {
      points.push(element.at);
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

export function TikzCanvas({
  engine,
  revealUpTo,
  exactMode = false,
}: {
  engine: TikzEngine;
  revealUpTo?: number;
  exactMode?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Source previews are drag-derived only. Creation previews stay in the
  // immutable ConstructionPreview overlay and never reparse a second Scene.
  const [dragPreviewCode, setDragPreviewCode] = useState<string | null>(null);
  const [constructionPreview, setConstructionPreview] = useState<ConstructionPreview | null>(null);
  const [solverStatus, setSolverStatus] = useState('');
  const [renderFrame, setRenderFrame] = useState<ScreenFrame>({
    width: 0,
    height: 0,
  });
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
  // Exact TeX is an explicit fidelity lane. Unsupported/opaque statements must
  // not disable interaction with the recognized semantic projection.
  const useExactRenderer = exactMode;
  const exact = useExactTikzRender(engine.code, useExactRenderer);
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
    cancelActiveToolInteraction(toolSessionRef.current);
    setDragPreviewCode(null);
    setConstructionPreview(null);
    setSolverStatus('');
  }, [engine.activeTool, engine.code]);

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
      applySourcePatches: engine.applySourcePatches,
      solveDerivedDrag: async (pointName, target, sourceRevision) => {
        const current = engineRef.current;
        if (current.revision !== sourceRevision) {
          throw new DOMException('Stale source revision', 'AbortError');
        }
        const result = await solverPort.solveDerivedDrag({
          source: current.code,
          sourceRevision,
          pointName,
          target,
        });
        if (engineRef.current.revision !== sourceRevision) {
          throw new DOMException('Stale source revision', 'AbortError');
        }
        return result;
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
      setSelectionTargets: engine.setSelectionTargets,
      setHoveredStmtIndex: engine.setHoveredStmtIndex,
      setViewport: engine.setViewport,
      toScenePoint,
      toClientPoint,
    };
  }, [
    authoringScene,
    decodedRendering,
    engine,
    dragPreviewAnalysis,
    renderFrame,
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
    tool[type]?.(event, currentContext);
  }, [
    context,
    engine.activeTool,
    engine.semanticProjectionState,
    useExactRenderer,
  ]);

  const onKeyDown = useCallback((event: KeyboardEvent<SVGSVGElement>) => {
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
        const managedSelection = engine.inspectorSelection.sourceBindingIds.some(
          (bindingId) => bindingId.startsWith('binding:managed:'),
        );
        // Keyboard deletion must never bypass the Inspector's managed-block
        // safety policy. External descendants still require the explicit,
        // two-step cascade action in the Inspector.
        engine.deleteSelection(managedSelection ? 'block' : 'cascade');
      },
    };
    const result = commandRegistry.dispatch({
      shortcut: event.nativeEvent,
      event: event.nativeEvent,
      scope: 'canvas',
      context: commandContext,
    });
    if (result.handled) event.stopPropagation();
  }, [commandRegistry, context, engine, useExactRenderer]);

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
  const sourceBindingRanges = useMemo(() => {
    const ranges = new Map<string, { start: number; end: number }>();
    if (!engine.scene || !engine.stmts) return ranges;
    for (const point of engine.scene.points.values()) {
      const range = engine.stmts[point.stmtIndex]?.range;
      if (range) ranges.set(`binding:${point.stableId}`, range);
    }
    for (const element of engine.scene.elements) {
      const range = engine.stmts[element.stmtIndex]?.range;
      if (range) ranges.set(`binding:${element.stableId}`, range);
    }
    return ranges;
  }, [engine.scene, engine.stmts]);
  useTikzMotion({
    svgRef,
    scene: revealedScene ?? null,
    revision: engine.semanticRevision ?? engine.revision,
    selection: engine.selection,
  });

  return (
    <div ref={boxRef} className="tz-canvas" data-testid="tikz-canvas">
      <svg
        ref={svgRef}
        tabIndex={0}
        width="100%"
        height="100%"
        role="img"
        aria-label="TikZ 几何构造画布"
        style={{
          cursor: useExactRenderer ? 'default' : activeTool?.cursor ?? 'default',
          touchAction: 'none',
          visibility: useExactRenderer && exact.imageUrl ? 'hidden' : 'visible',
        }}
        onPointerDown={(event) => dispatch('onPointerDown', event)}
        onPointerMove={(event) => dispatch('onPointerMove', event)}
        onPointerUp={(event) => dispatch('onPointerUp', event)}
        onPointerCancel={(event) => dispatch('onPointerCancel', event)}
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
                engine.inspectorSelection.renderPrimitiveId
                  ? [engine.inspectorSelection.renderPrimitiveId]
                  : []
              }
              selectedSemanticEntityIds={
                engine.inspectorSelection.semanticEntityId
                  ? [engine.inspectorSelection.semanticEntityId]
                  : []
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
      </svg>
      {useExactRenderer && exact.imageUrl
        ? (
          // The SVG must stay in image-document isolation; do not inline it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="tz-exact-render"
            src={exact.imageUrl}
            alt="TikZ 精确编译预览"
          />
        )
        : null}
      <AnimatePresence>
        {useExactRenderer
          ? (
            <motion.div
              key="exact-status"
              className="tz-render-mode"
              role="status"
              {...TIKZ_MOTION.status}
              transition={TIKZ_MOTION.spring}
            >
            {exact.loading
              ? '正在请求隔离 TeX 精确渲染…'
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
                <div><dt>Artifact</dt><dd>{exact.attestation.artifactDigest.slice(0, 12)}</dd></div>
                <div><dt>Cache</dt><dd>{exact.attestation.cacheKeyDigest.slice(0, 12)}</dd></div>
                <div><dt>Compiler</dt><dd>{exact.attestation.compilerImageDigest.slice(-12)}</dd></div>
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
    DEFAULT_ANGLE_MARK_RADIUS,
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
  const size = Math.min(14, firstLength * 0.28, secondLength * 0.28);
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
