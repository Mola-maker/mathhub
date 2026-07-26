// Pure factory: given a set of DOM targets + tokens, build an anime.js entrance
// timeline. Kept as a pure function (no React imports) so it can be unit-tested
// in isolation and reused by any hero variant.
//
// anime.js v4 ESM. We import lazily inside the builder so the module itself
// stays SSR-safe (the wrapper `useEffect` in HeroReveal calls `buildEntrance`).

import type { HeroTokens } from './useHeroTokens';

export type EntranceTarget = {
  /** CSS selector relative to the hero root (e.g. '.hero__title', '[data-hero-line]'). */
  selector: string;
  /** Per-target animation: 'fade-up' | 'fade' | 'draw' (SVG stroke). */
  variant?: 'fade-up' | 'fade' | 'draw';
};

export type EntranceOptions = {
  /** Selector scope root — the hero container. */
  root: HTMLElement;
  targets: EntranceTarget[];
  tokens: HeroTokens;
  /** Optional override for the inter-line stagger (ms). Defaults to tokens.heroStaggerMs. */
  staggerMs?: number;
};

/** anime.js v4 module shape we use. Import via dynamic import to keep SSR clean. */
type AnimeModule = {
  animate: (
    target: Element | Element[] | NodeListOf<Element> | string,
    params: Record<string, unknown>,
  ) => unknown;
  createTimeline: (params?: Record<string, unknown>) => {
    add: (target: string | Element | Element[], params: Record<string, unknown>) => unknown;
    play: () => void;
    pause: () => void;
    revert: () => void;
  };
  utils: {
    set: (target: Element, styles: Record<string, string>) => void;
    get: (target: Element, attr: string) => string;
  };
};

let _anime: AnimeModule | null = null;
async function loadAnime(): Promise<AnimeModule> {
  if (_anime) return _anime;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('animejs');
  _anime = mod.default ?? mod;
  return _anime!;
}

const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function buildEntrance(opts: EntranceOptions) {
  const { root, targets, tokens } = opts;
  const staggerMs = opts.staggerMs ?? tokens.heroStaggerMs;

  // We return a thunk so callers can await inside useEffect (SSR-safe).
  return async (): Promise<() => void> => {
    if (PREFERS_REDUCED_MOTION || staggerMs <= 0) {
      // Reduced motion: just make everything visible instantly, no animation.
      for (const t of targets) {
        const el = root.querySelector(t.selector) as HTMLElement | null;
        if (!el) continue;
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
      return () => {
        /* nothing to clean up */
      };
    }

    const anime = await loadAnime();

    const timeline = anime.createTimeline({
      defaults: { ease: 'out(1.7)', duration: 520 },
    });

    for (const t of targets) {
      const el = root.querySelector(t.selector) as HTMLElement | null;
      if (!el) continue;

      // Initial state: hide so the timeline starts from a known snapshot.
      anime.utils.set(el, { opacity: '0' });

      const variant = t.variant ?? 'fade-up';
      if (variant === 'fade-up') {
        anime.utils.set(el, { translateX: `${tokens.heroFromX}px` });
        timeline.add(el, {
          opacity: [0, 1],
          translateX: [`${tokens.heroFromX}px`, '0px'],
        });
      } else if (variant === 'fade') {
        timeline.add(el, { opacity: [0, 1] });
      } else if (variant === 'draw' && el.tagName.toLowerCase() === 'path') {
        // SVG path draw-on
        const len =
          Number(el.getAttribute('data-len')) ||
          (el as unknown as SVGGeometryElement).getTotalLength?.() ||
          100;
        anime.utils.set(el, { strokeDasharray: `${len} ${len}`, strokeDashoffset: `${len}` });
        timeline.add(el, { strokeDashoffset: [len, 0] });
      }
    }

    timeline.play();

    // Return a cleanup function the caller should invoke on unmount.
    return () => {
      try {
        timeline.revert();
      } catch {
        /* timeline may already be torn down — safe to ignore */
      }
    };
  };
}