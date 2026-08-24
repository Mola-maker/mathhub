import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { subscribeTicker, prefersReduced } from "./motion";

/* ============================================================
   Scroll system — pinned scene chapters.
   Each <SceneShell> occupies `length` svh of scroll and renders
   a sticky full-viewport stage. Children receive a render-prop
   `progress` (0..1 local to the scene).
   No scroll libraries — one scroll listener + rAF per shell.

   SMOOTHING (animejs.com-grade):
   Raw scroll position is measured on scroll events (passive +
   rAF-throttled), then a per-scene external store eases the
   emitted progress toward raw on the shared ticker with a
   critically-damped lerp (k ≈ 0.14/frame @60fps, frame-rate
   independent). Components read the smoothed value through
   useSyncExternalStore — no setState per frame, no render
   storms; only progress consumers re-render.
   ============================================================ */

/** Scene registry — scene workers may append metadata for nav/progress UI. */
export interface SceneRegistration {
  id: string;
  title: string;
  index: number;
}

const registry: SceneRegistration[] = [];

export function registerScene(id: string, title: string): SceneRegistration {
  const existing = registry.find((s) => s.id === id);
  if (existing) return existing;
  const entry = { id, title, index: registry.length };
  registry.push(entry);
  return entry;
}

export function getScenes(): readonly SceneRegistration[] {
  return registry;
}

/* ---- easing helpers ---- */

/** clamp 0..1 */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** easeOutCubic — the house ease for scene progress. */
export function ease(p: number): number {
  const t = clamp01(p);
  return 1 - Math.pow(1 - t, 3);
}

/** linear map of p through window [from, to] → 0..1 */
export function window01(p: number, from: number, to: number): number {
  if (to <= from) return p >= to ? 1 : 0;
  return clamp01((p - from) / (to - from));
}

/* ---- Smoothed progress store ----
   A tiny external store: raw target comes from scroll measurement,
   the emitted value chases it on the shared ticker. Listeners are
   only notified while the value is actually moving, and the ticker
   subscription is dropped once settled (zero idle cost). */

export interface SmoothProgressStore {
  /** useSyncExternalStore-compatible subscribe. */
  subscribe: (onChange: () => void) => () => void;
  /** Current smoothed value (cached snapshot). */
  getSnapshot: () => number;
  /** Feed the latest raw (unsmoothed) progress target, 0..1. */
  setRaw: (v: number) => void;
}

/** Lerp factor per 60fps frame. 0.12–0.18 is the animejs `sync: 0.9` feel. */
const SMOOTH_K = 0.14;
/** Snap-to-target threshold — also where the ticker disengages. */
const SETTLE_EPS = 0.0005;

export function createSmoothProgressStore(k: number = SMOOTH_K): SmoothProgressStore {
  let raw = 0;
  let value = 0;
  let initialized = false;
  const listeners = new Set<() => void>();
  let stopTicker: (() => void) | null = null;

  const emit = () => {
    listeners.forEach((l) => l());
  };

  const step = (_time: number, dt: number) => {
    // Frame-rate independent: k is defined per 16.67ms frame.
    const f = 1 - Math.pow(1 - k, Math.min(dt, 100) / 16.67);
    const next = value + (raw - value) * f;
    if (Math.abs(raw - next) <= SETTLE_EPS) {
      if (value !== raw) {
        value = raw;
        emit();
      }
      // settled — disengage from the ticker entirely
      stopTicker?.();
      stopTicker = null;
      return;
    }
    value = next;
    emit();
  };

  const pump = () => {
    if (!stopTicker) stopTicker = subscribeTicker(step);
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot: () => value,
    setRaw(v) {
      raw = clamp01(v);
      // First measurement snaps (no sweep from 0 on mid-page load),
      // and reduced-motion users always get instant, unsmoothed values.
      if (!initialized || prefersReduced()) {
        initialized = true;
        if (value !== raw) {
          value = raw;
          emit();
        }
        return;
      }
      if (raw !== value) pump();
    },
  };
}

/* ---- SceneShell ---- */

export interface SceneShellProps {
  id: string;
  title: string;
  /** Scroll length of the chapter in svh. Default 150. */
  length?: number;
  children: (progress: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function SceneShell({
  id,
  title,
  length = 150,
  children,
  className,
  style,
}: SceneShellProps) {
  const outerRef = useRef<HTMLElement | null>(null);
  const storeRef = useRef<SmoothProgressStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createSmoothProgressStore();
  }
  const store = storeRef.current;

  /* Smoothed progress via external store — re-renders only while the
     smoothed value is moving; no React state writes per scroll frame. */
  const progress = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    registerScene(id, title);
    const outer = outerRef.current;
    if (!outer) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = outer.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const total = rect.height - vh;
      store.setRaw(total > 0 ? -rect.top / total : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [id, title, store]);

  return (
    <section
      ref={outerRef}
      id={id}
      className={className}
      style={{ height: `${length}svh`, position: "relative", ...style }}
      data-scene={id}
      data-scene-title={title}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100svh",
          overflow: "hidden",
          /* compositing hints: keep the pinned stage on its own layer
             and isolate its layout/paint from the rest of the page */
          transform: "translateZ(0)",
          contain: "layout paint",
        }}
      >
        {children(progress)}
      </div>
    </section>
  );
}

/* ---- Global scroll ---- */

const globalStore = createSmoothProgressStore();
let globalRefCount = 0;
let detachGlobal: (() => void) | null = null;

function attachGlobalScroll(): () => void {
  let raf = 0;
  const measure = () => {
    raf = 0;
    const doc = document.documentElement;
    const total = doc.scrollHeight - window.innerHeight;
    globalStore.setRaw(total > 0 ? window.scrollY / total : 0);
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  measure();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * 0..1 smoothed progress across the whole document.
 * Same external-store smoothing as SceneShell progress.
 */
export function useGlobalScroll(): number {
  useEffect(() => {
    globalRefCount += 1;
    if (!detachGlobal) detachGlobal = attachGlobalScroll();
    return () => {
      globalRefCount -= 1;
      if (globalRefCount <= 0 && detachGlobal) {
        detachGlobal();
        detachGlobal = null;
        globalRefCount = 0;
      }
    };
  }, []);
  return useSyncExternalStore(
    globalStore.subscribe,
    globalStore.getSnapshot,
    globalStore.getSnapshot,
  );
}
