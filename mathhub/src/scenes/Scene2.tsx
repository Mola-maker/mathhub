import { useEffect, useRef, useState } from "react";
import "./Scene2.css";
import {
  useGeometry,
  type ConstructionFigure,
  type Point,
} from "../system/geometry";
import GeometryCanvas from "../system/GeometryCanvas";
import { Frag, SourceLine, TinyLabel } from "../system/fragments";
import {
  clamp01,
  easeInOut3,
  subscribeTicker,
  useReducedMotion,
  window01,
} from "../system/motion";
import { useLang } from "../system/i18n";

export interface Scene2Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

/* ============================================================
   SCENE 2 — "Gesture becomes source"
   The emotional centerpiece: dragging the primary handle rewrites
   the source line in place. One focal point — the hero geometry.
   The source fragment is a narrow, secondary editorial strip
   synchronized to the gesture.

   The construction itself is switchable: five REAL GeoGebra
   constructions (circumcircle / rectangle / pentagon / ellipse /
   homothety) share the same draggable handles. Switching cross-fades
   the canvas (opacity/scale) and swaps the source with the same
   flash emphasis a drag produces.

   Choreography (scene-local progress, smoothed — windows sit a
     touch early to absorb the ~150–300ms smoothing lag):
     0.02 – 0.22   hero canvas rises in (dominant)
     0.08 – 0.25   fig. caption fades in
     0.15 – 0.32   hint ring + "drag A" fades in at point A
     0.24 – 0.44   source fragment strip rises in (secondary)
     0.28 – 0.68   scripted demo: the figure's primary handle travels
                   a short path via setA on the shared ticker —
                   easeInOut3 applied PER SEGMENT so each leg
                   accelerates and settles physically (skipped for a
                   figure once the user drags that figure, or under
                   reduced motion)
     0.58 – 0.72   hint ring fades out
   ============================================================ */

const FIGURES: ConstructionFigure[] = [
  "circumcircle",
  "rectangle",
  "pentagon",
  "ellipse",
  "homothety",
];

/* New copy local to Scene 2 (central dictionary is integrated later).
   Tab labels + per-figure drag hints. */
const COPY = {
  en: {
    switchLabel: "Construction",
    tabs: {
      circumcircle: "CIRCLE",
      rectangle: "RECT",
      pentagon: "PENT",
      ellipse: "ELLIPSE",
      homothety: "HOMOTH",
    },
    hint: {
      circumcircle: "drag A",
      rectangle: "drag A or C",
      pentagon: "drag A",
      ellipse: "drag F1",
      homothety: "drag A",
    },
  },
  zh: {
    switchLabel: "构造",
    tabs: {
      circumcircle: "外接圆",
      rectangle: "矩形",
      pentagon: "五边形",
      ellipse: "椭圆",
      homothety: "位似",
    },
    hint: {
      circumcircle: "拖动 A",
      rectangle: "拖动 A 或 C",
      pentagon: "拖动 A",
      ellipse: "拖动 F1",
      homothety: "拖动 A",
    },
  },
} as const;

/* Short scripted paths for the primary handle (viewBox space 0..10),
   one per figure, each starting at the provider's default A =
   (5.10, 1.90). The circumcircle path is the original Scene-2 beat,
   unchanged. */
const SCRIPT_PATHS: Record<ConstructionFigure, Point[]> = {
  circumcircle: [
    { x: 5.1, y: 1.9 },
    { x: 6.3, y: 2.4 },
    { x: 5.9, y: 3.5 },
    { x: 4.7, y: 3.1 },
    { x: 5.1, y: 2.3 },
  ],
  rectangle: [
    { x: 5.1, y: 1.9 },
    { x: 4.1, y: 2.5 },
    { x: 3.5, y: 3.3 },
    { x: 4.7, y: 2.9 },
    { x: 5.1, y: 2.2 },
  ],
  pentagon: [
    { x: 5.1, y: 1.9 },
    { x: 8.3, y: 4.7 },
    { x: 6.7, y: 8.2 },
    { x: 7.2, y: 2.7 },
    { x: 5.6, y: 2.0 },
  ],
  ellipse: [
    { x: 5.1, y: 1.9 },
    { x: 4.4, y: 2.8 },
    { x: 3.7, y: 3.5 },
    { x: 4.6, y: 2.9 },
    { x: 5.2, y: 2.2 },
  ],
  homothety: [
    { x: 5.1, y: 1.9 },
    { x: 6.0, y: 2.6 },
    { x: 5.4, y: 3.3 },
    { x: 4.6, y: 2.7 },
    { x: 5.0, y: 2.2 },
  ],
};

/* Per-segment easing: the global parameter t advances linearly
   across keyframes, but each leg eases in and out on its own
   (easeInOut3) — continuous position with physical, weighted
   motion instead of one flat global ease over the whole path. */
function pointOnPath(path: Point[], t: number): Point {
  const n = path.length - 1;
  const f = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = easeInOut3(f - i);
  const p = path[i];
  const q = path[i + 1];
  return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
}

/** Cross-fade midpoint (ms): the figure swaps while fully faded. */
const SWAP_MS = 190;

export default function Scene2({ progress }: Scene2Props) {
  const { A, C, setA, sourceLines, lastTransaction, figure, setFigure } =
    useGeometry();
  const { lang, t } = useLang();
  const reduced = useReducedMotion();

  const p = clamp01(progress);

  /* ---- user interaction latch, PER FIGURE: once the user grabs the
        canvas, the scripted demo and the hint retire for THAT figure
        only — switching to another figure still demos until dragged. ---- */
  const draggedFigures = useRef<Set<ConstructionFigure>>(new Set());
  const [, bumpDrag] = useState(0);
  const progressRef = useRef(p);
  progressRef.current = p;
  const figureRef = useRef(figure);
  figureRef.current = figure;

  const userDragged = draggedFigures.current.has(figure);

  const onCanvasPointerDown = () => {
    draggedFigures.current.add(figureRef.current);
    bumpDrag((k) => k + 1);
  };

  /* ---- figure cross-fade: context figure switches instantly (source
        lines + tabs follow at once); the canvas fades out, swaps at
        the midpoint, fades back. Instant under reduced motion. ---- */
  const [shownFigure, setShownFigure] = useState<ConstructionFigure>(figure);
  const [swapping, setSwapping] = useState(false);
  useEffect(() => {
    if (figure === shownFigure) return;
    if (reduced) {
      setShownFigure(figure);
      return;
    }
    setSwapping(true);
    const id = setTimeout(() => {
      setShownFigure(figure);
      setSwapping(false);
    }, SWAP_MS);
    return () => clearTimeout(id);
  }, [figure, shownFigure, reduced]);

  /* ---- scripted demo: scroll-scrubbed path for the primary handle,
        driven on the shared ticker. Skipped entirely under reduced
        motion (interactivity is untouched). ---- */
  const lastSent = useRef<Point>(SCRIPT_PATHS.circumcircle[0]);
  useEffect(() => {
    if (reduced) return;
    const unsub = subscribeTicker(() => {
      const f = figureRef.current;
      if (draggedFigures.current.has(f)) return;
      const w = window01(progressRef.current, 0.28, 0.68);
      if (w <= 0 || w >= 1) return;
      const next = pointOnPath(SCRIPT_PATHS[f], w);
      const prev = lastSent.current;
      if (Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y) < 0.004) return;
      lastSent.current = next;
      setA(next);
    });
    return unsub;
  }, [reduced, setA]);

  /* ---- source line flash: lines rest in mist; when one changes, a
        paper overlay fades out over it (opacity-only emphasis).
        Throttled so continuous motion keeps it lit. A figure switch
        bypasses the throttle — the swap itself is the event. ---- */
  const aLine = sourceLines[1];
  const prevLines = useRef(sourceLines);
  const prevFigure = useRef(figure);
  const lastFlashAt = useRef(0);
  const [flash, setFlash] = useState<{
    index: number;
    text: string;
    token: number;
  } | null>(null);
  useEffect(() => {
    const prev = prevLines.current;
    const changed: number[] = [];
    const n = Math.max(prev.length, sourceLines.length);
    for (let i = 0; i < n; i++) {
      if (prev[i] !== sourceLines[i]) changed.push(i);
    }
    const figureSwitched = prevFigure.current !== figure;
    prevFigure.current = figure;
    if (!changed.length) return;
    prevLines.current = sourceLines;
    /* Prefer the primary live line (index 1) — it carries the gesture. */
    const index = changed.includes(1) ? 1 : changed[0];
    const now = performance.now();
    if (figureSwitched || now - lastFlashAt.current > 400) {
      lastFlashAt.current = now;
      setFlash({ index, text: sourceLines[index], token: now });
    }
  }, [sourceLines, figure]);

  /* ---- progress-driven beats ---- */
  const canvasT = window01(p, 0.02, 0.22);
  const captionT = window01(p, 0.08, 0.25);
  const sourceT = window01(p, 0.24, 0.44);
  const hintT = window01(p, 0.15, 0.32) * (1 - window01(p, 0.58, 0.72));
  const hintOpacity = userDragged ? 0 : hintT;

  /* Overlay positions: the canvas wrapper is a square and the SVG
     meets it exactly, so viewBox 0..10 maps linearly to 0..100%. */
  const ax = A.x * 10;
  const ay = A.y * 10;

  /* Transaction trace anchors to the handle that actually moved. */
  const txPoint = lastTransaction === "Δ C" ? C : A;
  const txX = txPoint.x * 10;
  const txY = txPoint.y * 10;

  return (
    <div className="scene-2" data-progress={p.toFixed(3)}>
      {/* dominant object: the living geometry */}
      <div
        className="scene-2__canvas"
        onPointerDownCapture={onCanvasPointerDown}
        style={{
          opacity: canvasT,
          transform: `translateY(calc(-50% + ${(1 - canvasT) * 28}px))`,
        }}
      >
        <div
          className={
            swapping
              ? "scene-2__figure-fade is-swapping"
              : "scene-2__figure-fade"
          }
        >
          <GeometryCanvas
            variant="hero"
            construction="circumcircle"
            figure={shownFigure}
            interactive
            className="scene-2__svg"
          />

          {/* pulsing hint ring at the primary handle (transform + opacity only) */}
          <div
            className="scene-2__hint"
            style={{ left: `${ax}%`, top: `${ay}%`, opacity: hintOpacity }}
            aria-hidden="true"
          >
            <svg className="scene-2__hint-ring" viewBox="0 0 56 56">
              <circle
                cx="28"
                cy="28"
                r="22"
                fill="none"
                stroke="var(--paper)"
                strokeWidth="1"
              />
            </svg>
            <TinyLabel className="scene-2__hint-label">
              {COPY[lang].hint[figure]}
            </TinyLabel>
          </div>

          {/* transient transaction trace near the gesture point */}
          {lastTransaction && (
            <div
              className="scene-2__tx"
              style={{ left: `${txX}%`, top: `${txY}%` }}
              aria-hidden="true"
            >
              <TinyLabel active>{lastTransaction}</TinyLabel>
            </div>
          )}
        </div>
      </div>

      {/* secondary: the synchronized source fragment + figure switcher */}
      <Frag
        x={70}
        y={33}
        label={t("s2.frag.source")}
        edges={["top", "left"]}
        className="scene-2__source"
        style={{
          opacity: sourceT,
          transform: `translateY(${(1 - sourceT) * 18}px)`,
        }}
      >
        <div
          className="scene-2__figtabs"
          role="group"
          aria-label={COPY[lang].switchLabel}
        >
          {FIGURES.map((f) => (
            <button
              key={f}
              type="button"
              className={
                f === figure
                  ? "scene-2__figtab is-active"
                  : "scene-2__figtab"
              }
              aria-pressed={f === figure}
              onClick={() => setFigure(f)}
            >
              {COPY[lang].tabs[f]}
            </button>
          ))}
        </div>

        <div className="scene-2__lines">
          <SourceLine dim>{sourceLines[0]}</SourceLine>
          <SourceLine dim>
            <span
              className="scene-2__delta"
              style={{ opacity: lastTransaction === "Δ A" ? 1 : 0 }}
              aria-hidden="true"
            >
              Δ&nbsp;
            </span>
            {aLine}
          </SourceLine>
          <SourceLine dim>{sourceLines[2]}</SourceLine>

          {/* paper → mist emphasis on the changed line */}
          {flash && (
            <span
              key={flash.token}
              className="scene-2__line-flash"
              style={{
                top: `calc(${flash.index} * 11.5px * 1.7)`,
                paddingLeft: flash.index === 1 ? "2ch" : 0,
              }}
              aria-hidden="true"
            >
              {flash.text}
            </span>
          )}
        </div>
      </Frag>

      {/* quiet editorial caption */}
      <TinyLabel className="scene-2__caption" style={{ opacity: captionT }}>
        {t("s2.fig")}
      </TinyLabel>
    </div>
  );
}
