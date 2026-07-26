// Entrance reveal — anime.js v4 timeline driving DOM targets and the
// 3D wordmark. Uses the named exports from animejs (no default export in
// v4). Loaded dynamically so the import stays out of the initial bundle.

import type { Group } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

// Local narrowed type — animejs v4 is a named-export module and the full
// `typeof import('animejs')` is too wide for our limited surface.
type AnimeLite = {
  createTimeline: (params?: Record<string, unknown>) => {
    add: (
      target: unknown,
      params: Record<string, unknown>,
      position?: number | string,
    ) => unknown;
    play: () => void;
  };
  animate: (
    target: Element | Element[] | NodeListOf<Element> | string,
    params: Record<string, unknown>,
  ) => unknown;
  utils: { set: (target: Element, styles: Record<string, string>) => void };
};

let cached: AnimeLite | null = null;
async function loadAnime(): Promise<AnimeLite> {
  if (cached) return cached;
  const mod = await import('animejs');
  cached = mod as unknown as AnimeLite;
  return cached;
}

const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DOM_TARGETS = [
  '[data-hb-reveal="kicker"]',
  '[data-hb-reveal="stage"]',
  '[data-hb-reveal="copy"]',
] as const;

export type RevealHandle = {
  /** Resolves when the entrance timeline settles (or immediately under reduced motion). */
  done: () => Promise<void>;
};

/**
 * Play the entrance reveal. Under `prefers-reduced-motion`, this resolves
 * immediately with everything already at its final visible state.
 */
export function playReveal(wordmark: Group): RevealHandle {
  let resolveFn: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  if (PREFERS_REDUCED_MOTION) {
    DOM_TARGETS.forEach((sel) => {
      document.querySelector(sel)?.classList.add('is-revealed');
    });
    wordmark.rotation.set(0, 0, 0);
    wordmark.position.set(0, 0, 0);
    wordmark.scale.set(1, 1, 1);
    wordmark.traverse((obj) => {
      const mat = (obj as unknown as { material?: { opacity?: number } }).material;
      if (mat && 'opacity' in mat) {
        (mat as { opacity?: number }).opacity = 1;
      }
    });
    resolveFn();
    return { done: () => done };
  }

  loadAnime().then((anime) => {
    const tl = anime.createTimeline({
      defaults: { ease: 'out(1.7)', duration: 620 },
    });

    // 3D wordmark — settle from a slightly down-and-scaled start.
    tl.add(wordmark.position, { y: [10, 0], duration: 900, ease: 'out(2.2)' }, 0);
    tl.add(
      wordmark.scale,
      { x: [0.86, 1], y: [0.86, 1], duration: 1100, ease: 'out(2.4)' },
      0,
    );

    // Each wireframe + grid LineSegments2 fades in with its own stagger.
    const lineSegs: LineSegments2[] = [];
    wordmark.traverse((obj) => {
      if ((obj as unknown as { type?: string }).type === 'LineSegments2') {
        lineSegs.push(obj as LineSegments2);
      }
    });
    lineSegs.forEach((seg, i) => {
      const mat = seg.material as LineMaterial;
      mat.transparent = true;
      mat.opacity = 0;
      tl.add(
        mat as unknown as Element,
        { opacity: [0, 0.95], duration: 700 },
        i * 14,
      );
    });

    // DOM targets — fade-up cascade, timed after the wordmark starts settling.
    DOM_TARGETS.forEach((sel, i) => {
      const el = document.querySelector(sel);
      if (!el) return;
      (el as HTMLElement).style.opacity = '0';
      (el as HTMLElement).style.transform = 'translateY(12px)';
      tl.add(
        sel,
        { opacity: [0, 1], translateY: [12, 0], duration: 540 },
        120 + i * 90,
      );
    });

    tl.play();
    setTimeout(() => resolveFn(), 1300);
  });

  return { done: () => done };
}