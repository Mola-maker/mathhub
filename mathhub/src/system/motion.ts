import { useEffect, useState } from "react";
import { animate, type AnimationParams, type TargetsParam } from "animejs";
import { clamp01, window01 } from "./scroll";

/* ============================================================
   Motion system — anime.js v4 wrappers + progress-driven styles.
   Hard rules: transform & opacity only. Respect reduced motion.
   ============================================================ */

/* ---- Reduced motion ---- */

/**
 * Cheap non-hook check for prefers-reduced-motion. Use inside
 * event handlers, tickers, and one-shot helpers where a hook
 * isn't available. `ambient()` already consults this.
 */
export function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ---- Shared rAF ticker ----
   One loop for the whole app; subscribers get (time, delta) in ms. */

type TickCallback = (time: number, delta: number) => void;

const subscribers = new Set<TickCallback>();
let rafId = 0;
let lastTime = 0;

function tickLoop(time: number) {
  const delta = lastTime ? time - lastTime : 16.7;
  lastTime = time;
  subscribers.forEach((cb) => cb(time, delta));
  rafId = subscribers.size ? requestAnimationFrame(tickLoop) : 0;
}

export function subscribeTicker(cb: TickCallback): () => void {
  subscribers.add(cb);
  if (!rafId) {
    lastTime = 0;
    rafId = requestAnimationFrame(tickLoop);
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

/* ---- Level-1 ambient loops ---- */

export interface AmbientOptions extends Partial<AnimationParams> {
  /** drift amplitude in px (2–5 recommended). Default 3. */
  drift?: number;
  /** loop duration in ms (4000–12000 recommended). Default 8000. */
  duration?: number;
}

/**
 * Subtle infinite drift loop. Returns a stop/cleanup function.
 * No-op (returns a noop cleanup) when the user prefers reduced motion.
 *
 * usage:
 *   useEffect(() => ambient(ref.current, { drift: 3, duration: 9000 }), []);
 */
export function ambient(
  targets: TargetsParam | null | undefined,
  opts: AmbientOptions = {},
): () => void {
  const { drift = 3, duration = 8000, ...rest } = opts;
  if (prefersReduced() || !targets) return () => {};

  const instance = animate(targets, {
    translateX: [0, drift],
    translateY: [0, -drift * 0.6],
    duration,
    ease: "inOutSine",
    alternate: true,
    loop: true,
    ...rest,
  } as AnimationParams);
  return () => instance.cancel();
}

/* ---- Refined easings (animejs inOut(3)-class cubics) ---- */

/** Cubic ease-in-out — the animejs signature feel. */
export function easeInOut3(p: number): number {
  const t = clamp01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Cubic ease-out (same curve as the house `ease` in scroll.tsx). */
export function easeOut3(p: number): number {
  const t = clamp01(p);
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Blend a linear ramp toward the cubic in-out curve.
 * k = 0 → linear, k = 1 → full easeInOut3. Default 0.5.
 * Pure helper for softening progress windows without a ticker.
 */
export function smooth01(p: number, k = 0.5): number {
  const t = clamp01(p);
  const kk = clamp01(k);
  return t + (easeInOut3(t) - t) * kk;
}

/* ---- Progress-driven style helpers (0..1 → inline style) ----
   All map a scene-local progress window [from, to] to a style object.
   These are pure functions — cheap enough to call every render.
   Every output carries `willChange: 'transform, opacity'` so the
   compositor keeps animated fragments on their own layer. */

/** Fade: opacity 0→1 as p crosses [from, to]. */
export function fadeIn(
  p: number,
  from = 0,
  to = 1,
): { opacity: number; willChange: "transform, opacity" } {
  return {
    opacity: window01(clamp01(p), from, to),
    willChange: "transform, opacity",
  };
}

/** Rise: fade in while translating up `px` pixels (default 24). */
export function riseIn(
  p: number,
  from = 0,
  to = 1,
  px = 24,
): { opacity: number; transform: string; willChange: "transform, opacity" } {
  const t = window01(clamp01(p), from, to);
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * px}px)`,
    willChange: "transform, opacity",
  };
}

/**
 * SVG draw-on: pair with `pathLength={1}` on the element so
 * dash units are normalized. p in [from, to] draws 0%→100%.
 */
export function drawStroke(
  p: number,
  from = 0,
  to = 1,
): { strokeDasharray: number; strokeDashoffset: number } {
  const t = window01(clamp01(p), from, to);
  return { strokeDasharray: 1, strokeDashoffset: 1 - t };
}

export { clamp01, window01 };
