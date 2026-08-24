import { Fragment, useEffect, useRef, useState } from "react";
import "./Scene1.css";
import { useGeometry, projectToLine, type Point } from "../system/geometry";
import GeometryCanvas from "../system/GeometryCanvas";
import { Frag, TinyLabel, SourceLine } from "../system/fragments";
import {
  useReducedMotion,
  ambient,
  subscribeTicker,
  drawStroke,
  clamp01,
  window01,
  easeInOut3,
  easeOut3,
} from "../system/motion";
import { ease } from "../system/scroll";
import { useLang } from "../system/i18n";
import { subscribeEnergy } from "../system/musicEnergy";

export interface Scene1Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

const VIEW = 10;

type ModeId = "nav" | "basic" | "constrain" | "transform" | "olympic";

const MODES: ModeId[] = ["nav", "basic", "constrain", "transform", "olympic"];

/** Live code render replay — the tiny source each category "runs". These
    are the product's REAL shortcut chords and real TikZ output syntax;
    notation is never translated, so the lines are identical in zh/en. */
const MODE_SOURCE: Record<ModeId, string[]> = {
  nav: ["V  选择 / 拖拽", "H  平移画布"],
  basic: [
    "\\coordinate (M) at ($(A)!0.5!(B)$);",
    "\\draw (A) -- (B) -- (C) -- cycle;",
  ],
  constrain: [
    "\\coordinate (H) at ($(A)!(C)!(B)$);",
    "\\pic[draw] {right angle = C--H--B};",
  ],
  transform: ["S  位似 ×2", "\\coordinate (A') at ($(A)!2!(O)$);"],
  olympic: ["I  反演点", "O  三点圆"],
};

/** Demo captions — each names the real capability it replays. */
const MODE_CAPTION: Record<ModeId, string> = {
  nav: "导航即视角 · navigate the canvas",
  basic: "基础即书写 · primitives are written",
  constrain: "约束即构造 · constraints are constructed",
  transform: "变换即保持 · transforms preserve structure",
  olympic: "竞赛即利器 · olympic tools, one key away",
};

/** New copy local to Scene 1 (central dictionary is integrated later). */
const COPY = {
  en: {
    dismiss: "Dismiss tool overlay",
    modes: "Tool categories",
    mode: {
      nav: "NAVIGATE",
      basic: "BASIC",
      constrain: "CONSTRAIN",
      transform: "TRANSFORM",
      olympic: "OLYMPIC",
    },
  },
  zh: {
    dismiss: "关闭工具浮层",
    modes: "工具类别",
    mode: {
      nav: "导航",
      basic: "基础",
      constrain: "约束",
      transform: "变换",
      olympic: "竞赛",
    },
  },
} as const;

/** Typewriter speed (chars per second) for the live code replay. */
const TYPE_CPS = 24;
/** Time (ms) the mode geometry takes to draw itself after the code types. */
const DRAW_MS = 1200;
/** Overlay exit fade (ms) before the layer unmounts. */
const EXIT_MS = 320;

/* Circle outline expressed as a path so pathLength={1} normalizes
   dash units for drawStroke in every browser. */
function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
}

/** Perpendicular notch (tick mark) at `mid`, across direction `along`.
    Mirrors GeometryCanvas so the overlay's final frame coincides.
    `mid` is applied by the caller — this returns only the notch vector. */
function tickNotch(_mid: Point, along: Point, size = 0.16): Point {
  const len = Math.hypot(along.x, along.y) || 1;
  return { x: (-along.y / len) * size, y: (along.x / len) * size };
}

/**
 * SCENE 1 — Atmospheric opening.
 * Album-cover composition: oversized MATH/HUB anchor lower-left in a
 * field of empty cobalt; one living geometry object drawn on like
 * notation printed on a record sleeve. Typography leads, then hands
 * focal priority to the geometry as progress advances.
 *
 * The mode console (bottom-right) is live: clicking a mode veils the
 * living circumcircle behind a blur, types that mode's source like a
 * replay, then draws its geometry overlay on the same 0..10 space.
 */
export default function Scene1({ progress }: Scene1Props) {
  const reduced = useReducedMotion();
  const { t, lang } = useLang();
  const {
    A,
    B,
    C,
    circumcenter: O,
    circumradius: r,
    derived,
  } = useGeometry();
  const { midAB, midBC, midCA } = derived;

  /* ---- Load-time intro: at scroll 0 the entrance choreography
         still plays — a synthetic progress floor sweeps 0 → 0.16
         over ~1.4s on the shared ticker, then scroll owns progress.
         Under reduced motion the intro state applies instantly. ---- */
  const [intro, setIntro] = useState(0);
  useEffect(() => {
    if (reduced) {
      setIntro(1);
      return;
    }
    const start = performance.now();
    return subscribeTicker((time) => {
      const t = clamp01((time - start) / 1400);
      setIntro((prev) => (prev >= 1 ? prev : t));
    });
  }, [reduced]);

  const p = Math.max(clamp01(progress), intro * 0.16);

  const driftRef = useRef<HTMLDivElement | null>(null);
  const rotRef = useRef<HTMLDivElement | null>(null);
  const breathRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  /* Level-1 ambient drift — 3px over 9s (auto no-op under reduced motion). */
  useEffect(() => ambient(driftRef.current, { drift: 3, duration: 9000 }), []);

  /* Ultra-slow rotation (<1° across ~10s) on the ONE shared ticker. */
  useEffect(() => {
    if (reduced) return;
    const el = rotRef.current;
    if (!el) return;
    return subscribeTicker((time) => {
      const deg = Math.sin((time / 10000) * Math.PI * 2) * 0.4;
      el.style.transform = `rotate(${deg}deg)`;
    });
  }, [reduced]);

  /* ---- Music breathing: geometry scale 1±0.012 and headline
         letter-spacing ±0.01em, amplitude modulated by smoothed music
         energy. Direct DOM writes on the shared ticker (lerped toward
         the energy target); composes with the drift/rotation wrappers.
         No breathing under reduced motion. ---- */
  useEffect(() => {
    if (reduced) return;
    const breathEl = breathRef.current;
    const titleEl = titleRef.current;
    let target = 0;
    let cur = 0;
    const unsubEnergy = subscribeEnergy((e) => {
      target = e;
    });
    const unsubTick = subscribeTicker((time, dt) => {
      const k = 1 - Math.pow(1 - 0.14, dt / 16.67);
      cur += (target - cur) * k;
      const s = Math.sin((time / 2600) * Math.PI * 2);
      if (breathEl) {
        breathEl.style.transform = `scale(${(1 + 0.012 * cur * s).toFixed(4)})`;
      }
      if (titleEl) {
        titleEl.style.letterSpacing = `calc(var(--tracking-wordmark) + ${(
          0.01 *
          cur *
          s
        ).toFixed(4)}em)`;
      }
    });
    return () => {
      unsubEnergy();
      unsubTick();
    };
  }, [reduced]);

  /* ---- Mode console state machine ----
     mode:     which overlay is mounted (null = living field sharp)
     entered:  overlay rise/fade-in class (applied one tick after mount)
     closing:  fade-out in flight; blur lifts, layer unmounts after EXIT_MS
     tokenRef: invalidates a pending unmount when a new mode opens. ---- */
  const [mode, setMode] = useState<ModeId | null>(null);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const tokenRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);

  const openMode = (m: ModeId) => {
    tokenRef.current++;
    setClosing(false);
    setEntered(false);
    setMode(m);
  };

  const dismiss = () => {
    if (!mode || closing) return;
    tokenRef.current++;
    setEntered(false);
    setClosing(true);
  };

  /* Enter on the next ticker frame so the mount transition plays. */
  useEffect(() => {
    if (!mode || closing || entered) return;
    let fired = false;
    return subscribeTicker(() => {
      if (fired) return;
      fired = true;
      setEntered(true);
    });
  }, [mode, closing, entered]);

  /* Unmount the overlay after the exit fade. */
  useEffect(() => {
    if (!closing) return;
    const token = tokenRef.current;
    const start = performance.now();
    return subscribeTicker((time) => {
      if (time - start >= EXIT_MS && tokenRef.current === token) {
        setMode(null);
        setClosing(false);
      }
    });
  }, [closing]);

  /* Escape dismisses the open mode. */
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        tokenRef.current++;
        setEntered(false);
        setClosing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  /* ---- Live code render replay: type the mode's source into the ref'd
         <code> node character-by-character (~24 chars/sec, direct DOM
         writes — no per-frame setState), then draw the geometry overlay
         over ~1.2s via drawStroke windows. Reduced motion: instant. ---- */
  useEffect(() => {
    if (!mode || closing) return;
    const root = overlayRef.current;
    const codeEl = codeRef.current;
    const drawEls = root
      ? Array.from(root.querySelectorAll<SVGElement>("[data-draw]"))
      : [];
    const flashEls = root
      ? Array.from(root.querySelectorAll<SVGElement>("[data-flash]"))
      : [];
    const fadeEls = root
      ? Array.from(root.querySelectorAll<SVGElement>("[data-fade]"))
      : [];
    const full = MODE_SOURCE[mode].join("\n");

    if (reduced) {
      if (codeEl) codeEl.textContent = full;
      drawEls.forEach((el) => {
        el.style.strokeDashoffset = "0";
      });
      flashEls.forEach((el) => {
        el.style.opacity = "1";
      });
      fadeEls.forEach((el) => {
        el.style.opacity = "1";
      });
      return;
    }

    const start = performance.now();
    const typeMs = (full.length / TYPE_CPS) * 1000;
    const n = drawEls.length || 1;

    return subscribeTicker((time) => {
      const el = time - start;

      /* (1) typewriter */
      if (codeEl) {
        const count = Math.min(full.length, Math.floor(el * (TYPE_CPS / 1000)));
        if ((codeEl.textContent ?? "").length !== count) {
          codeEl.textContent = full.slice(0, count);
        }
      }

      /* (2) geometry draws itself once the code is on screen */
      const dt = el - typeMs;
      const t = easeInOut3(clamp01(dt / DRAW_MS));
      drawEls.forEach((d, i) => {
        const from = (i / n) * 0.55;
        const w = drawStroke(t, from, Math.min(1, from + 0.45));
        d.style.strokeDashoffset = String(w.strokeDashoffset);
      });
      fadeEls.forEach((f) => {
        f.style.opacity = String(easeOut3(clamp01(dt / 350)));
      });
      /* constraint tick marks flash while the solver runs, then settle */
      flashEls.forEach((f, i) => {
        const ft = clamp01((dt - i * 120) / 900);
        if (ft <= 0) {
          f.style.opacity = "0";
          return;
        }
        const pulse =
          ft < 1 ? 0.3 + 0.7 * Math.abs(Math.sin(ft * Math.PI * 3)) : 1;
        f.style.opacity = String(pulse);
      });
    });
  }, [mode, closing, reduced]);

  /* ---- Eased entrance helpers (cubic ease-out: fast start, soft settle) ---- */
  const fadeE = (from: number, to: number) => ({
    opacity: easeOut3(window01(p, from, to)),
    willChange: "transform, opacity" as const,
  });
  const riseE = (from: number, to: number, px = 24) => {
    const t = easeOut3(window01(p, from, to));
    return {
      opacity: t,
      transform: `translateY(${(1 - t) * px}px)`,
      willChange: "transform, opacity" as const,
    };
  };

  /* ---- Focal handoff: typography dims to mist, geometry brightens ---- */
  const handoff = easeInOut3(window01(p, 0.3, 0.7));
  const typeOpacity = 1 - 0.58 * handoff;
  const geoOpacity = 0.8 + 0.2 * handoff;

  /* ---- Depth parallax: type recedes faster than the geometry ---- */
  const para = ease(window01(p, 0.15, 1));
  const typeY = -26 * para;
  const geoY = -8 * para;
  const geoScale = 1 + 0.03 * para;

  /* ---- Entrance (first ~14%): construction draws itself, staggered ---- */
  const triDraw = drawStroke(p, 0.02, 0.07); // triangle
  const circDraw = drawStroke(p, 0.05, 0.1); // circumcircle
  const rayDraw = drawStroke(p, 0.08, 0.115); // construction rays
  const tickBCDraw = drawStroke(p, 0.095, 0.12); // midpoint tick on BC
  const tickCADraw = drawStroke(p, 0.1, 0.125); // midpoint tick on CA
  const bisectorIn = fadeE(0.105, 0.13); // dashed perpendicular bisector
  const labelA = fadeE(0.1, 0.125);
  const labelB = fadeE(0.11, 0.135);
  const labelC = fadeE(0.12, 0.145);
  const labelO = fadeE(0.13, 0.15);

  /* Overlay draws the construction, then hands off to the living canvas. */
  const overlayOpacity = 1 - easeInOut3(window01(p, 0.13, 0.16));
  const canvasOpacity = easeInOut3(window01(p, 0.12, 0.16));

  /* Same construction-ray math as GeometryCanvas so the overlay coincides. */
  const ray = (q: Point) => ({
    x1: O.x,
    y1: O.y,
    x2: O.x + (q.x - O.x) * 1.35,
    y2: O.y + (q.y - O.y) * 1.35,
  });
  const rayB = ray(B);
  const rayC = ray(C);
  const triPath = `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`;

  /* Enriched circumcircle furniture — mirrors GeometryCanvas exactly so
     the overlay's final frame matches the living canvas at handoff. */
  const normalBC = tickNotch(midBC, { x: C.x - B.x, y: C.y - B.y });
  const normalCA = tickNotch(midCA, { x: A.x - C.x, y: A.y - C.y });
  const bisDir: Point = { x: midBC.x - O.x, y: midBC.y - O.y };
  const bisector = {
    x1: O.x - bisDir.x * 0.28,
    y1: O.y - bisDir.y * 0.28,
    x2: midBC.x + bisDir.x * 0.32,
    y2: midBC.y + bisDir.y * 0.32,
  };

  /* ---------- Mode overlay geometry (same 0..10 viewBox space) ---------- */

  const modeLabels: Record<ModeId, string> = COPY[lang].mode;

  /* Normalize helper for overlay marks. */
  const unit = (v: Point): Point => {
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };

  /* Thin arrow (shaft + head) from `from` toward `to` — shared by the
     导航 drag arrow. */
  const arrowPaths = (from: Point, to: Point) => {
    const u = unit({ x: to.x - from.x, y: to.y - from.y });
    const px = -u.y;
    const py = u.x;
    const tip: Point = { x: to.x - u.x * 0.14, y: to.y - u.y * 0.14 };
    return {
      shaft: `M ${from.x + u.x * 0.2} ${from.y + u.y * 0.2} L ${tip.x} ${tip.y}`,
      head:
        `M ${tip.x} ${tip.y} L ${tip.x - u.x * 0.24 + px * 0.11} ${tip.y - u.y * 0.24 + py * 0.11} ` +
        `M ${tip.x} ${tip.y} L ${tip.x - u.x * 0.24 - px * 0.11} ${tip.y - u.y * 0.24 - py * 0.11}`,
    };
  };

  /* 导航 — drag arrow on point A (V 选择/拖拽). */
  const navArrow = arrowPaths(A, { x: A.x + 0.62, y: A.y - 0.4 });

  /* 基础 — midpoint M of AB: tick notch + point + label. */
  const nAB = tickNotch(midAB, { x: B.x - A.x, y: B.y - A.y });

  /* 约束 — foot H of the perpendicular from A onto BC ($(A)!(C)!(B)$),
     plus the right-angle square mark between HB and HA. */
  const H = projectToLine(A, B, C);
  const uHB = unit({ x: B.x - H.x, y: B.y - H.y });
  const uHA = unit({ x: A.x - H.x, y: A.y - H.y });
  const ra = 0.24;
  const rightAnglePath =
    `M ${H.x + uHB.x * ra} ${H.y + uHB.y * ra} ` +
    `L ${H.x + uHB.x * ra + uHA.x * ra} ${H.y + uHB.y * ra + uHA.y * ra} ` +
    `L ${H.x + uHA.x * ra} ${H.y + uHA.y * ra}`;

  /* 变换 — 位似 ×2: center O0 placed 1.1 units from A toward the stage
     centre so A′ = O0 + 2·(A − O0) stays near the frame; ray O0 → A → A′. */
  const uToCtr = unit({ x: 5 - A.x, y: 5 - A.y });
  const dilO: Point = { x: A.x + uToCtr.x * 1.1, y: A.y + uToCtr.y * 1.1 };
  const Aprime: Point = {
    x: dilO.x + 2 * (A.x - dilO.x),
    y: dilO.y + 2 * (A.y - dilO.y),
  };

  /* 竞赛 — inversion guide: fixed center Oi, inversion circle, ray
     Oi → P, and the inverse point P′ with OiP · OiP′ = r². */
  const invO: Point = { x: 3.6, y: 5.9 };
  const invR = 1.25;
  const invP: Point = { x: 6.1, y: 4.8 };
  const invOP = { x: invP.x - invO.x, y: invP.y - invO.y };
  const invOPLen = Math.hypot(invOP.x, invOP.y) || 1;
  const invU = { x: invOP.x / invOPLen, y: invOP.y / invOPLen };
  const invPi: Point = {
    x: invO.x + invU.x * ((invR * invR) / invOPLen),
    y: invO.y + invU.y * ((invR * invR) / invOPLen),
  };
  const invRayEnd: Point = {
    x: invO.x + invU.x * invOPLen * 1.18,
    y: invO.y + invU.y * invOPLen * 1.18,
  };

  const veiled = mode !== null && !closing;

  return (
    <div className={lang === "zh" ? "scene-1 scene-1--zh" : "scene-1"}>
      {/* ---------- Living geometry object ---------- */}
      <div
        className="scene-1__geometry"
        style={{
          opacity: geoOpacity,
          transform: `translateY(${geoY}px) scale(${geoScale})`,
        }}
      >
        <div ref={breathRef} className="scene-1__geometry-breathe">
          <div
            className={
              veiled
                ? "scene-1__geometry-field is-veiled"
                : "scene-1__geometry-field"
            }
          >
            <div ref={driftRef} className="scene-1__geometry-drift">
              <div ref={rotRef} className="scene-1__geometry-rot">
                {/* the living object — point A reacts to cursor drag */}
                <div className="scene-1__canvas" style={{ opacity: canvasOpacity }}>
                  <GeometryCanvas variant="hero" interactive />
                </div>

                {/* coincident construction overlay — draws itself on entrance */}
                <svg
                  className="scene-1__construction"
                  viewBox={`0 0 ${VIEW} ${VIEW}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ opacity: overlayOpacity }}
                  aria-hidden="true"
                >
                  <path
                    d={circlePath(O.x, O.y, r)}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    opacity={0.9}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    style={circDraw}
                  />
                  <path
                    d={triPath}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="miter"
                    pathLength={1}
                    style={triDraw}
                  />
                  <path
                    d={`M ${rayB.x1} ${rayB.y1} L ${rayB.x2} ${rayB.y2}`}
                    fill="none"
                    stroke="var(--line-faint)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    style={rayDraw}
                  />
                  <path
                    d={`M ${rayC.x1} ${rayC.y1} L ${rayC.x2} ${rayC.y2}`}
                    fill="none"
                    stroke="var(--line-faint)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    style={rayDraw}
                  />
                  {/* faint dashed perpendicular bisector from O through mid BC */}
                  <line
                    {...bisector}
                    stroke="var(--line-faint)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="2 5"
                    style={bisectorIn}
                  />
                  {/* constraint tick marks at midpoints of BC and CA */}
                  <line
                    x1={midBC.x - normalBC.x}
                    y1={midBC.y - normalBC.y}
                    x2={midBC.x + normalBC.x}
                    y2={midBC.y + normalBC.y}
                    stroke="var(--line-strong)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    style={tickBCDraw}
                  />
                  <line
                    x1={midCA.x - normalCA.x}
                    y1={midCA.y - normalCA.y}
                    x2={midCA.x + normalCA.x}
                    y2={midCA.y + normalCA.y}
                    stroke="var(--line-strong)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    style={tickCADraw}
                  />
                  <text x={A.x + 0.22} y={A.y - 0.18} className="scene-1__glabel" style={labelA}>
                    A
                  </text>
                  <text x={B.x - 0.42} y={B.y + 0.1} className="scene-1__glabel" style={labelB}>
                    B
                  </text>
                  <text x={C.x + 0.28} y={C.y + 0.1} className="scene-1__glabel" style={labelC}>
                    C
                  </text>
                  <text x={O.x + 0.2} y={O.y - 0.14} className="scene-1__glabel" style={labelO}>
                    O
                  </text>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- Mode overlay: code replay + drawing geometry ----------
            Lives outside the veiled field so it stays sharp over the blur. */}
        {mode !== null && (
          <div
            key={mode}
            ref={overlayRef}
            className={
              entered && !closing
                ? "scene-1__mode-overlay is-open"
                : "scene-1__mode-overlay"
            }
            aria-hidden="true"
          >
            <svg
              className="scene-1__mode-svg"
              viewBox={`0 0 ${VIEW} ${VIEW}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {mode === "nav" && (
                <>
                  {/* H 平移画布 — pan frame */}
                  <path
                    data-draw
                    d="M 2.0 1.5 L 7.5 1.5 L 7.5 8.0 L 2.0 8.0 Z"
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* V 选择/拖拽 — drag arrow on point A */}
                  <path
                    data-draw
                    d={navArrow.shaft}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  <path
                    data-draw
                    d={navArrow.head}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={A.x}
                    cy={A.y}
                    r={0.07}
                    fill="var(--paper)"
                  />
                  <text data-fade opacity={0} x={2.18} y={7.36} className="scene-1__glabel">
                    H
                  </text>
                </>
              )}

              {mode === "basic" && (
                <>
                  {/* segment AB redrawn over the veil */}
                  <path
                    data-draw
                    d={`M ${A.x} ${A.y} L ${B.x} ${B.y}`}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* midpoint tick at M ($(A)!0.5!(B)$) */}
                  <line
                    data-draw
                    x1={midAB.x - nAB.x}
                    y1={midAB.y - nAB.y}
                    x2={midAB.x + nAB.x}
                    y2={midAB.y + nAB.y}
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={midAB.x}
                    cy={midAB.y}
                    r={0.07}
                    fill="var(--paper)"
                  />
                  <text
                    data-fade
                    opacity={0}
                    x={midAB.x + nAB.x * 1.9 + 0.12}
                    y={midAB.y + nAB.y * 1.9 - 0.1}
                    className="scene-1__glabel"
                  >
                    M
                  </text>
                </>
              )}

              {mode === "constrain" && (
                <>
                  {/* BC redrawn over the veil — H is its foot point */}
                  <path
                    data-draw
                    d={`M ${B.x} ${B.y} L ${C.x} ${C.y}`}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* right-angle square mark at H ({right angle = C--H--B}) */}
                  <path
                    data-draw
                    d={rightAnglePath}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* dashed perpendicular A → H ($(A)!(C)!(B)$) */}
                  <line
                    data-fade
                    opacity={0}
                    x1={A.x}
                    y1={A.y}
                    x2={H.x}
                    y2={H.y}
                    stroke="var(--line-faint)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="2 5"
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={H.x}
                    cy={H.y}
                    r={0.07}
                    fill="var(--paper)"
                  />
                  <text
                    data-fade
                    opacity={0}
                    x={H.x + uHA.x * 0.42}
                    y={H.y + uHA.y * 0.42 + 0.1}
                    className="scene-1__glabel"
                  >
                    H
                  </text>
                </>
              )}

              {mode === "transform" && (
                <>
                  {/* 位似 ×2 — ray from centre O through A to A′ ($(A)!2!(O)$) */}
                  <path
                    data-draw
                    d={`M ${dilO.x} ${dilO.y} L ${Aprime.x} ${Aprime.y}`}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* ghost of A dilated to A′ */}
                  <path
                    data-draw
                    d={circlePath(Aprime.x, Aprime.y, 0.24)}
                    fill="none"
                    stroke="var(--soft)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={dilO.x}
                    cy={dilO.y}
                    r={0.06}
                    fill="var(--mist)"
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={Aprime.x}
                    cy={Aprime.y}
                    r={0.06}
                    fill="var(--mist)"
                  />
                  <text
                    data-fade
                    opacity={0}
                    x={dilO.x + 0.22}
                    y={dilO.y - 0.12}
                    className="scene-1__glabel"
                  >
                    O
                  </text>
                  <text
                    data-fade
                    opacity={0}
                    x={Aprime.x + 0.3}
                    y={Aprime.y - 0.12}
                    className="scene-1__glabel"
                  >
                    A′
                  </text>
                </>
              )}

              {mode === "olympic" && (
                <>
                  {/* inversion circle (guide) */}
                  <path
                    data-draw
                    d={circlePath(invO.x, invO.y, invR)}
                    fill="none"
                    stroke="var(--paper)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  {/* ray O → P, P′ on the ray with OP · OP′ = r² */}
                  <path
                    data-draw
                    d={`M ${invO.x} ${invO.y} L ${invRayEnd.x} ${invRayEnd.y}`}
                    fill="none"
                    stroke="var(--line-strong)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={invO.x}
                    cy={invO.y}
                    r={0.06}
                    fill="var(--mist)"
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={invPi.x}
                    cy={invPi.y}
                    r={0.07}
                    fill="var(--paper)"
                  />
                  <circle
                    data-fade
                    opacity={0}
                    cx={invP.x}
                    cy={invP.y}
                    r={0.07}
                    fill="var(--paper)"
                  />
                  <text
                    data-fade
                    opacity={0}
                    x={invO.x - 0.34}
                    y={invO.y + 0.06}
                    className="scene-1__glabel"
                  >
                    O
                  </text>
                  <text
                    data-fade
                    opacity={0}
                    x={invPi.x + 0.14}
                    y={invPi.y + 0.4}
                    className="scene-1__glabel"
                  >
                    P′
                  </text>
                  <text
                    data-fade
                    opacity={0}
                    x={invP.x + 0.18}
                    y={invP.y - 0.14}
                    className="scene-1__glabel"
                  >
                    P
                  </text>
                </>
              )}
            </svg>
            <code ref={codeRef} className="scene-1__mode-code" />
            <div className="scene-1__mode-caption">
              <TinyLabel active>{MODE_CAPTION[mode]}</TinyLabel>
            </div>
          </div>
        )}

        <div
          className="scene-1__fig"
          style={{ opacity: mode ? 0 : 1, transition: "opacity 300ms ease" }}
        >
          <div style={fadeE(0.14, 0.22)}>
            <TinyLabel>{t("s1.fig")}</TinyLabel>
          </div>
        </div>
      </div>

      {/* ---------- Typographic anchor (leads, then recedes) ---------- */}
      <div
        className="scene-1__type"
        style={{ opacity: typeOpacity, transform: `translateY(${typeY}px)` }}
      >
        <h1 className="scene-1__title" ref={titleRef}>
          <span className="scene-1__title-line" style={riseE(0, 0.1, 28)}>
            Math
          </span>
          <span className="scene-1__title-line" style={riseE(0.025, 0.125, 28)}>
            Hub
          </span>
        </h1>
        <p className="scene-1__standfirst" style={fadeE(0.07, 0.14)}>
          {t("s1.standfirst")}
        </p>
        <a className="scene-1__cta" href="#scene-2" style={fadeE(0.09, 0.15)}>
          {t("s1.cta")}
        </a>
      </div>

      {/* ---------- Edge fragments: hints of the instrument ---------- */}
      <Frag
        x={82}
        y={15}
        label={t("s1.frag.live")}
        edges={["left"]}
        className="scene-1__frag-coord"
        style={fadeE(0.1, 0.2)}
      >
        <SourceLine>
          A = point({A.x.toFixed(2)}, {A.y.toFixed(2)})
        </SourceLine>
      </Frag>

      {/* author credit — fades in with the CTA beat */}
      <div className="scene-1__credit" style={fadeE(0.09, 0.15)}>
        by molamaker
      </div>

      {/* transparent dismiss surface while a mode is open */}
      {mode !== null && (
        <button
          type="button"
          tabIndex={-1}
          className="scene-1__mode-backdrop"
          aria-label={COPY[lang].dismiss}
          onClick={dismiss}
        />
      )}

      <div
        className="scene-1__modes"
        style={fadeE(0.12, 0.22)}
        role="group"
        aria-label={COPY[lang].modes}
      >
        {MODES.map((m, i) => (
          <Fragment key={m}>
            {i > 0 && <span className="scene-1__modes-sep" />}
            <button
              type="button"
              className={
                mode === m ? "scene-1__mode-btn is-active" : "scene-1__mode-btn"
              }
              aria-pressed={mode === m}
              onClick={() => (mode === m ? dismiss() : openMode(m))}
            >
              {modeLabels[m]}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
