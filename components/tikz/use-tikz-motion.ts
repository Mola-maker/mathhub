'use client';

import { animate, type AnimationPlaybackControls } from 'motion';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type RefObject } from 'react';
import type { Scene } from '@/lib/tikz/semantics/scene';

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
  const animationsRef = useRef<AnimationPlaybackControls[]>([]);

  useEffect(() => {
    const currentIds = new Set<string>();
    for (const point of scene?.points.values() ?? []) {
      if (!point.internal) currentIds.add(point.stableId);
    }
    for (const element of scene?.elements ?? []) currentIds.add(element.stableId);
    const previousIds = previousIdsRef.current;
    previousIdsRef.current = currentIds;
    if (previousIds.size === 0 || shouldReduceMotion) return;

    const addedIds = new Set([...currentIds].filter((id) => !previousIds.has(id)));
    if (addedIds.size === 0) return;
    const frame = requestAnimationFrame(() => {
      const root = svgRef.current;
      if (!root) return;
      const targets = [...root.querySelectorAll<SVGGraphicsElement>('[data-tikz-id]')]
        .filter((node) => addedIds.has(node.dataset.tikzId ?? ''));
      if (targets.length === 0) return;
      const animation = animate(
        targets,
        {
          opacity: [0.16, 1],
          scale: [0.972, 1],
          filter: ['blur(2px)', 'blur(0px)'],
        },
        {
          duration: 0.32,
          ease: [0.22, 1, 0.36, 1],
        },
      );
      animationsRef.current.push(animation);
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, scene, shouldReduceMotion, svgRef]);

  useEffect(() => {
    if (selection.length === 0 || shouldReduceMotion) return;
    const frame = requestAnimationFrame(() => {
      const root = svgRef.current;
      if (!root) return;
      const targets = [...root.querySelectorAll<SVGGraphicsElement>('[data-selected="true"]')];
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
      animationsRef.current.push(animation);
    });
    return () => cancelAnimationFrame(frame);
  }, [selection, shouldReduceMotion, svgRef]);

  useEffect(() => () => {
    for (const animation of animationsRef.current) animation.stop();
    animationsRef.current = [];
  }, []);
}
