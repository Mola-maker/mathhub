'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { analyze } from '@/lib/tikz/analyze';
import { TikzSceneSvg } from '@/lib/tikz/render/svg-renderer';
import { toolRegistry, type ToolContext } from '@/lib/tikz/render/tools';
import { fitViewport, sceneToScreen, screenToScene } from '@/lib/tikz/render/viewport';
import type { TikzEngine } from './use-tikz-engine';

export function TikzCanvas({ engine }: { engine: TikzEngine }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const previewAnalysis = useMemo(
    () => previewCode ? analyze(previewCode) : null,
    [previewCode],
  );
  const displayScene = previewAnalysis?.scene ?? engine.scene;
  const structureSignature = engine.scene
    ? [...engine.scene.points.keys()].join(',')
    : '';

  useEffect(() => {
    const element = boxRef.current;
    const scene = engine.scene;
    if (!element || !scene) return;

    const fit = () => {
      const points = [...scene.points.values()].map((point) => point.position);
      engine.setViewport(fitViewport(points, element.clientWidth, element.clientHeight, 40));
    };
    fit();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  // Refit only when the construction topology changes. Coordinate-only patches
  // (dragging) deliberately preserve the user's current viewport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureSignature, engine.setViewport]);

  useEffect(() => {
    setPreviewCode(null);
  }, [engine.code]);

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
    if (!engine.scene) return null;
    return {
      code: engine.code,
      scene: engine.scene,
      viewport: engine.viewport,
      freePointRanges: engine.freePointRanges,
      applyPatch: engine.applyPatch,
      previewPatch: setPreviewCode,
      setSelection: engine.setSelection,
      toScenePoint,
      toClientPoint,
    };
  }, [engine, toClientPoint, toScenePoint]);

  const dispatch = useCallback((
    type: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel',
    event: PointerEvent<SVGSVGElement>,
  ) => {
    const tool = toolRegistry.get(engine.activeTool);
    const currentContext = context();
    if (!tool || !currentContext) return;
    tool[type]?.(event, currentContext);
  }, [context, engine.activeTool]);

  const activeTool = toolRegistry.get(engine.activeTool);

  return (
    <div ref={boxRef} className="tz-canvas" data-testid="tikz-canvas">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        role="img"
        aria-label="TikZ 几何构造画布"
        style={{ cursor: activeTool?.cursor ?? 'default', touchAction: 'none' }}
        onPointerDown={(event) => dispatch('onPointerDown', event)}
        onPointerMove={(event) => dispatch('onPointerMove', event)}
        onPointerUp={(event) => dispatch('onPointerUp', event)}
        onPointerCancel={(event) => dispatch('onPointerCancel', event)}
      >
        {displayScene
          ? (
            <TikzSceneSvg
              scene={displayScene}
              viewport={engine.viewport}
              selection={engine.selection}
            />
          )
          : null}
      </svg>
      {engine.issues.length > 0
        ? (
          <div className="tz-issues" data-testid="tikz-issues" role="status">
            {engine.issues.slice(0, 3).map((issue, index) => (
              <div key={`${issue.message}:${index}`} className="tz-issue">{issue.message}</div>
            ))}
          </div>
        )
        : null}
    </div>
  );
}
