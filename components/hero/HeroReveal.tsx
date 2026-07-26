'use client';

import { useEffect, useRef } from 'react';
import { useHeroTokens } from './useHeroTokens';
import { buildEntrance, type EntranceTarget } from './revealTarget';

export type HeroRevealProps = {
  /** Targets (selector + variant) to animate inside this root. */
  targets: EntranceTarget[];
  /** Optional: delay ms before the timeline runs after intersection. */
  delayMs?: number;
  /** Render the children; the wrapper ref is what gets measured. */
  children: React.ReactNode;
};

/** Client component that wires IntersectionObserver → anime.js timeline.
 *  Wraps any DOM hero section. The wrapper element receives the `ref`. */
export function HeroReveal({ targets, delayMs = 0, children }: HeroRevealProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tokens = useHeroTokens();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const builder = buildEntrance({ root, targets, tokens });

    let cleanup: (() => void) | null = null;
    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            cleanup = await builder();
            return;
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      cleanup?.();
    };
    // tokens is recomputed on mount only; targets identity matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, delayMs]);

  return <div ref={rootRef}>{children}</div>;
}