'use client';

import { useEffect, useState } from 'react';

/** Design tokens read from `:root` CSS variables. Three.js (WebGL) can't read
 *  CSS custom properties directly — it needs concrete numbers/colors. This
 *  hook resolves the globals once on mount and returns a stable object that
 *  HeroScene.tsx can pass to `<color attach="background">` etc.
 *
 *  Single source of truth stays in app/globals.css; this hook only mirrors it. */

export type HeroTokens = {
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  /** Hero entrance: from-x offset in px, staggered by --hero-stagger-ms. */
  heroFromX: number;
  heroStaggerMs: number;
};

const FALLBACK: HeroTokens = {
  bg: '#f6f1e8',
  panel: '#fffaf2',
  ink: '#251f1a',
  muted: '#756a5c',
  rule: 'rgba(92, 75, 52, 0.18)',
  accent: '#c96442',
  heroFromX: -16,
  heroStaggerMs: 60,
};

function readVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function readNumber(el: Element, name: string, fallback: number): number {
  const raw = readVar(el, name);
  if (!raw) return fallback;
  // Accept "16px", "-16px", or "60". Use a permissive parse.
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function useHeroTokens(): HeroTokens {
  const [tokens, setTokens] = useState<HeroTokens>(FALLBACK);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    setTokens({
      bg: readVar(root, '--bg') || FALLBACK.bg,
      panel: readVar(root, '--panel') || FALLBACK.panel,
      ink: readVar(root, '--ink') || FALLBACK.ink,
      muted: readVar(root, '--muted') || FALLBACK.muted,
      rule: readVar(root, '--rule') || FALLBACK.rule,
      accent: readVar(root, '--accent') || FALLBACK.accent,
      heroFromX: readNumber(root, '--hero-from-x', FALLBACK.heroFromX),
      heroStaggerMs: readNumber(root, '--hero-stagger-ms', FALLBACK.heroStaggerMs),
    });
  }, []);

  return tokens;
}