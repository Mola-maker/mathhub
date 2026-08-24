import { useEffect, useRef } from "react";
import { useGlobalScroll, window01 } from "./scroll";
import {
  easeInOut3,
  prefersReduced,
  subscribeTicker,
  useReducedMotion,
} from "./motion";
import "./Backdrop.css";

/* ============================================================
   Backdrop — the scroll-linked background color journey
   (animejs.com-style chapter tones, "commitment" model).

   Six fixed full-viewport SOLID layers — one per scene/chapter —
   crossfade via OPACITY ONLY. No background-color animation, no
   gradients, no hue drift: the BLUE → IVORY → BLUE journey ladder
   (--journey-1 … --journey-5 in tokens.css, --journey-6 declared
   in Backdrop.css). Chapters 1–2 cobalt, 3–4 ivory, 5–6 back into
   deep blue.

   JOURNEY FLAG: the current chapter is published to
   document.documentElement.dataset.journey ('1'..'6') so tokens.css
   can flip the UI palette to cobalt-ink-on-ivory on chapters 3–4.
   The flag flips DURING a boundary band — as soon as the incoming
   chapter's layer ramp passes ~40% — not at commitment, so the
   foreground palette never lags the lightening/darkening field;
   once the band settles it matches the committed chapter exactly.

   COMMITMENT (the animejs.com section model): once a chapter's
   layer has ramped in it NEVER ramps out — every layer stays
   opaque above the ones below it, so the topmost arrived layer
   fully OWNS the field for its whole chapter. Transitions are
   concentrated in narrow boundary bands (~8% of global progress,
   easeInOut3): scrolling inside a chapter is tonally still,
   crossing a boundary feels like the evening light shifted.

   BREATH: when — and only when — a chapter is fully committed,
   its layer carries a barely-perceptible opacity oscillation
   (0.99 ± 0.015 over ~10s, clamped to [0.98, 1]) via the shared
   ticker, revealing a whisper of the previous chapter's tone
   beneath. Runs on ivory chapters too (ivory-under-ivory is
   invisible — harmless). Disabled under prefers-reduced-motion.

   Drive signal: useGlobalScroll() — the SAME temporally smoothed,
   critically-damped progress the scenes use, so the shift
   inherits the silky lag for free. Under prefers-reduced-motion
   the store snaps raw→value instantly, so the crossfade becomes
   a direct scroll-position mapping with zero temporal easing lag
   (scroll-linked state is allowed under reduced motion).

   Stacking: the layers sit above the body's --cobalt base and
   below all content (see Backdrop.css); pointer-events: none.
   ============================================================ */

/* ---- Chapter geometry — THE constants to edit -----------------
   Mirror of the SceneShell `length` props in App.tsx, in order.
   Scenes 1–5 use the 150svh default; Scene 6 ("Two instruments"
   finale) is a ~120svh shell. If any shell length changes in
   App.tsx, update THIS ONE ARRAY — every boundary derives from
   it below. */
const CHAPTER_SVH = [150, 150, 150, 150, 150, 120] as const;

/** Pinned stage height; scrollable total = shells − one viewport. */
const VIEWPORT_SVH = 100;
const TOTAL_SCROLL_SVH =
  CHAPTER_SVH.reduce((sum, n) => sum + n, 0) - VIEWPORT_SVH; // 770

/* Boundary between chapter k and k+1 = the global progress at
   which chapter k+1's sticky stage fully arrives (cumulative
   shell length ÷ total scroll):
     B = [150, 300, 450, 600, 750] / 770
       ≈ [0.1948, 0.3896, 0.5844, 0.7792, 0.9740]                */
const BOUNDS: number[] = [];
CHAPTER_SVH.slice(0, -1).reduce((acc, n) => {
  BOUNDS.push((acc + n) / TOTAL_SCROLL_SVH);
  return acc + n;
}, 0);

/** Half-width of a boundary transition band: full width = 8% of
    global progress, centered on the boundary. Every chapter's
    middle stays fully committed; only the handoff zone drifts. */
const HALF = 0.04;

/* ---- Breath (committed-chapter micro-oscillation) ---- */
const BREATH_PERIOD_MS = 10_000;
const BREATH_CENTER = 0.99;
const BREATH_AMP = 0.015;
const BREATH_FLOOR = 0.98;

const ramp = (g: number, from: number, to: number) =>
  easeInOut3(window01(g, from, to));

export default function Backdrop() {
  const g = useGlobalScroll();
  const reduced = useReducedMotion();

  /* Opacity ladder. Layer 1 is the base tone (identical to the
     body's --cobalt) and is simply always present; each later
     layer ramps IN across its entry boundary and never leaves. */
  const opacities: number[] = CHAPTER_SVH.map((_, i) => {
    if (i === 0) return 1;
    const B = BOUNDS[i - 1];
    /* The finale (last chapter) is short — its pin occupies only
       ~0.026 of global progress — so its ramp COMPLETES at the
       boundary instead of straddling it: the closing chapter owns
       its deepest tone for its entire pinned life. */
    const isFinal = i === CHAPTER_SVH.length - 1;
    return isFinal
      ? ramp(g, B - 2 * HALF, B)
      : ramp(g, B - HALF, B + HALF);
  });

  /* The committed chapter = the highest layer that is fully in
     while nothing above it is mid-ramp. −1 while any crossfade
     is in flight (no chapter owns the field during a shift). */
  let committed = -1;
  for (let i = opacities.length - 1; i >= 0; i--) {
    const aboveStill =
      i < opacities.length - 1 && opacities[i + 1] > 0 && opacities[i + 1] < 1;
    if (opacities[i] >= 1 && !aboveStill) {
      committed = i;
      break;
    }
  }

  /* The journey chapter = the highest layer whose ramp has passed
     ~40%. Layers ramp in AND out with scroll direction and the
     boundary bands never overlap, so exactly one layer is ever
     mid-ramp: the moment the INCOMING chapter's tone covers 40% of
     the field it also owns the foreground palette — the flip happens
     DURING the band, not at commitment, so departing white text never
     floats over a lightening background. Once the band settles the
     threshold result is identical to the committed chapter. */
  let journey = 1;
  for (let i = opacities.length - 1; i >= 0; i--) {
    if (opacities[i] >= 0.4) {
      journey = i + 1;
      break;
    }
  }

  /* Refs so the breath ticker can write opacity straight to the
     DOM (no per-frame React render) and always restore the exact
     scroll-driven base when a chapter de-commits or breath is
     disabled. React only re-applies a layer's inline opacity when
     its prop value changes, so direct writes are safe between
     renders. */
  const layersRef = useRef<Array<HTMLDivElement | null>>([]);
  const baseRef = useRef<number[]>(opacities);
  const committedRef = useRef(committed);
  baseRef.current = opacities;
  committedRef.current = committed;

  /* Publish the journey to <html data-journey> so tokens.css can
     flip the UI palette (cobalt ink on ivory for chapters 3–4).
     The value follows the 40%-threshold `journey` derived above, so
     the palette flips DURING the boundary band (incoming chapter at
     ~40% coverage) instead of at commitment; after the band settles
     the value is identical to the committed chapter. Runs on mount
     too, so the attribute is correct on the first effect pass. */
  useEffect(() => {
    document.documentElement.dataset.journey = String(journey);
  }, [journey]);

  useEffect(() => {
    if (reduced) return; // no ambient motion at all
    let breathed: HTMLDivElement | null = null;
    const restore = () => {
      if (!breathed) return;
      const i = layersRef.current.indexOf(breathed);
      if (i >= 0) breathed.style.opacity = String(baseRef.current[i]);
      breathed = null;
    };
    const stop = subscribeTicker((time) => {
      if (prefersReduced()) {
        restore();
        return;
      }
      const i = committedRef.current;
      const el = i >= 0 ? layersRef.current[i] : null;
      if (!el) {
        restore();
        return;
      }
      if (breathed && breathed !== el) restore();
      const wave = Math.sin((time / BREATH_PERIOD_MS) * Math.PI * 2);
      const v = Math.min(
        1,
        Math.max(BREATH_FLOOR, BREATH_CENTER + BREATH_AMP * wave),
      );
      el.style.opacity = String(v);
      breathed = el;
    });
    return () => {
      stop();
      restore();
    };
  }, [reduced]);

  return (
    <div className="journey" aria-hidden="true">
      {opacities.map((opacity, i) => (
        <div
          key={i}
          ref={(el) => {
            layersRef.current[i] = el;
          }}
          className={`journey__layer journey__layer--${i + 1}`}
          style={{ opacity }}
        />
      ))}
    </div>
  );
}
