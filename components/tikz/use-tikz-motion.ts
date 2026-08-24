'use client';

import { animate, type AnimationPlaybackControls } from 'motion';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type RefObject } from 'react';
import type { Scene } from '@/lib/tikz/semantics/scene';

function retainAnimation(
  store: Set<AnimationPlaybackControls>,
  animation: AnimationPlaybackControls,
): void {
  store.add(animation);
  void animation.finished.then(
    () => store.delete(animation),
    () => store.delete(animation),
  );
}

export function useTikzMotion({
  svgRef,
  scene,
  revision,
  selection,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  scene: Scene | null;
  revision: number;
  selection: readonly string[];
}) {
  const shouldReduceMotion = useReducedMotion();
  const previousIdsRef = useRef(new Set<string>());
  const animationsRef = useRef(new Set<AnimationPlaybackControls>());

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = svgRef.current;
      if (!root) return;
      const rendered = [...root.querySelectorAll<SVGGraphicsElement>('[data-tikz-id]')];
      const currentIds = new Set(rendered.flatMap((node) => (
        node.dataset.tikzId ? [node.dataset.tikzId] : []
      )));
      const previousIds = previousIdsRef.current;
      previousIdsRef.current = currentIds;
      if (previousIds.size === 0 || shouldReduceMotion) return;
      const addedIds = new Set([...currentIds].filter((id) => !previousIds.has(id)));
      const targets = rendered.filter((node) => addedIds.has(node.dataset.tikzId ?? ''));
      if (targets.length === 0) return;
      const geometryTargets = targets.filter((node): node is SVGGeometryElement => (
        typeof (node as SVGGeometryElement).getTotalLength === 'function'
        && node.getAttribute('stroke') !== 'none'
        && !node.getAttribute('stroke-dasharray')
      ));
      for (const target of geometryTargets) {
        const length = Math.min(12_000, Math.max(1, target.getTotalLength()));
        target.style.strokeDasharray = String(length);
        target.style.strokeDashoffset = String(length);
        const drawing = animate(
          target,
          { strokeDashoffset: [length, 0] },
          { duration: 0.56, ease: [0.22, 1, 0.36, 1] },
        );
        retainAnimation(animationsRef.current, drawing);
        const clearDrawingStyles = () => {
          target.style.removeProperty('stroke-dasharray');
          target.style.removeProperty('stroke-dashoffset');
        };
        void drawing.finished.then(clearDrawingStyles, clearDrawingStyles);
      }
      // Do not animate the semantic SVG nodes with CSS transform, scale,
      // filter or opacity. CSS transforms override an SVG `transform`
      // attribute, collapsing affine circles/arcs back into unit geometry;
      // opacity animation would likewise override source-authored opacity.
      // Dashed paths, points and labels remain visually stable. Rich entrance
      // motion belongs on a separate editor overlay/ghost layer.
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, scene, shouldReduceMotion, svgRef]);

  useEffect(() => {
    if (selection.length === 0 || shouldReduceMotion) return;
    const frame = requestAnimationFrame(() => {
      const root = svgRef.current;
      if (!root) return;
      // Animate editor chrome, never the semantic document primitives. The
      // latter must remain pixel-comparable with the exact TeX artifact.
      const targets = [...root.querySelectorAll<SVGGraphicsElement>(
        '.tz-selection-halo, .tz-selection-transform-handles',
      )];
      if (targets.length === 0) return;
      const animation = animate(
        targets,
        {
          opacity: [0.58, 1],
          scale: [0.985, 1.012, 1],
        },
        {
          duration: 0.28,
          ease: [0.2, 0.8, 0.2, 1],
        },
      );
      retainAnimation(animationsRef.current, animation);
    });
    return () => cancelAnimationFrame(frame);
  }, [selection, shouldReduceMotion, svgRef]);

  useEffect(() => () => {
    for (const animation of animationsRef.current) animation.stop();
    animationsRef.current.clear();
  }, []);
}
