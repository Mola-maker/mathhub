'use client';

import { useEffect, useRef } from 'react';
import { TikzSceneSvg } from '@/lib/tikz/render/svg-renderer';
import { fitViewport } from '@/lib/tikz/render/viewport';
import type { TikzEngine } from './use-tikz-engine';

export function TikzCanvas({ engine }: { engine: TikzEngine }) {
  const boxRef = useRef<HTMLDivElement>(null);

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
  }, [engine.code, engine.scene, engine.setViewport]);

  return (
    <div ref={boxRef} className="tz-canvas" data-testid="tikz-canvas">
      <svg width="100%" height="100%" role="img" aria-label="TikZ 几何构造画布">
        {engine.scene
          ? (
            <TikzSceneSvg
              scene={engine.scene}
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

