import { useEffect, useRef, useState, type ReactNode } from "react";
import "./Scene3.css";
import { Frag, TinyLabel, SourceLine, KeyHint } from "../system/fragments";
import GeometryCanvas from "../system/GeometryCanvas";
import { useLang, type I18nKey } from "../system/i18n";
import {
  fadeIn,
  drawStroke,
  window01,
  clamp01,
  easeOut3,
  easeInOut3,
  useReducedMotion,
  subscribeTicker,
} from "../system/motion";

export interface Scene3Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

/* ============================================================
   SCENE 3 — "Multiple entry points" · BLUEPRINT DECOMPOSED (deep)
   The ivory-white chapter (journey 3): five REAL interaction
   paths — ⌘K olympiad command deck, fail-closed AI proposal,
   tool-chord layer, constraint-preserving derived drag, and the
   TikZ single-source-of-truth — drawn as an exploded blueprint.

   Decomposition depth: every fragment splits into 2–3 sub-parts
   (tagged a/b/c in hairline squares with dashed micro-leaders).
   Within each fragment's entrance window the sub-parts stagger
   in sequence — tag pops → leader draws → body rises → the
   fragment annotation fades last — all via easeOut3 sub-windows.

   Color discipline: this scene consumes ONLY the semantic tokens
   --fg / --fg-dim / --fg-hi / --line-ui (ivory = cobalt ink when
   html[data-journey='3']). Legacy --paper/--mist/--line-* are
   remapped onto the semantic vars scoped to .scene-3 (see CSS) so
   shared primitives (fragments.css, GeometryCanvas) follow suit
   without editing files owned by other workers. Fallbacks keep
   the scene intact while the tokens layer is being integrated.
   ============================================================ */

/* Blueprint annotation + REAL content copy — NEW strings live
   locally because i18n.tsx is owned by a later integration step.
   Vocabulary is taken verbatim from the real MathHub studios:
   real shortcuts (⌘K / M / B / I), real TikZ managed-block lines,
   real fail-closed AI and constraint-drag status strings. */
const COPY = {
  en: {
    command: "竞赛命令面板 · olympiad deck",
    ai: "提案校验 · fail-closed AI",
    keys: "31 个工具和弦 · tool chords",
    canvas: "约束保持拖动 · derived drag",
    source: "唯一真源 · single truth",
    cmdPlaceholder: "search inversion, quadrilateral, perpendicular…",
    cmdResult: "inversion point",
    aiPrompt: "Circumcircle of ABC, mark circumcenter O",
    aiCheck: "proposal check · fail-closed",
    chord: ["midpoint", "perp. bisector", "inversion"] as const,
    dragDoing: "holding constraints · dragging I…",
    dragDone: "constraints kept",
  },
  zh: {
    command: "竞赛命令面板 · olympiad deck",
    ai: "提案校验 · fail-closed AI",
    keys: "31 个工具和弦 · tool chords",
    canvas: "约束保持拖动 · derived drag",
    source: "唯一真源 · single truth",
    cmdPlaceholder: "搜索反演、四边形、垂线、inversion…",
    cmdResult: "反演点",
    aiPrompt: "作三角形 ABC 的外接圆并标出外心",
    aiCheck: "提案校验 · fail-closed",
    chord: ["中点", "中垂线", "反演点"] as const,
    dragDoing: "正在保持约束拖动 I…",
    dragDone: "约束已保持",
  },
} as const;

type FragKey = "command" | "ai" | "keys" | "canvas" | "source";

interface FragSpec {
  key: FragKey;
  labelKey: I18nKey; // dictionary key for the fragment metadata label
  x: number; // % of stage
  y: number;
  s: number; // entrance window start (progress)
  e: number; // entrance window end
  rise: number; // entrance translateY px (parallax depth 10–40)
  fromX: number; // entrance translateX px (some left, some right)
  subs: number; // decomposition depth (2–3 sub-parts)
}

/* Entrance windows redistributed evenly across progress 0.10–0.74
   (5 windows of 0.128). Positions rebalanced after the toolbar
   removal: nothing enters the top ~76px floating-header zone,
   and nothing collides at 1440×900 or 1280×800 (verified by
   reasoning — see Scene3.css header note). */
const FRAGS: FragSpec[] = [
  { key: "command", labelKey: "s3.frag.command", x: 60, y: 14, s: 0.1, e: 0.228, rise: 14, fromX: 16, subs: 3 },
  { key: "ai", labelKey: "s3.frag.ai", x: 66, y: 40, s: 0.228, e: 0.356, rise: 22, fromX: 18, subs: 2 },
  { key: "keys", labelKey: "s3.frag.keys", x: 12, y: 50, s: 0.356, e: 0.484, rise: 12, fromX: -12, subs: 3 },
  { key: "canvas", labelKey: "s3.frag.canvas", x: 38, y: 28, s: 0.484, e: 0.612, rise: 38, fromX: 0, subs: 2 },
  { key: "source", labelKey: "s3.frag.source", x: 52, y: 64, s: 0.612, e: 0.74, rise: 26, fromX: 14, subs: 2 },
];

/** Settled (non-focal) opacity — reads as dim ink next to a focal part. */
const SETTLED = 0.55;
const RELAX = 0.06; // progress span over which a fragment relaxes after entry
const ANNO_LAG = 0.04; // annotations trail their fragment's window by this

/* ---- Sub-beat choreography ----
   Within a fragment window q ∈ 0..1: head (label + index tag) pops
   first; each sub-part j then runs tag pop → micro-leader draw →
   body rise on easeOut3 sub-windows; the part annotation fades in
   the window's last stretch (see annoMotion). */

function headBeat(q: number): number {
  return easeOut3(window01(q, 0, 0.14));
}

/** Stagger base of sub-part j within its fragment window. */
function subBase(j: number, n: number): number {
  return 0.06 + j * (0.58 / n);
}

function subBeats(q: number, j: number, n: number) {
  const b = subBase(j, n);
  return {
    tag: easeOut3(window01(q, b, b + 0.12)),
    lead: easeOut3(window01(q, b + 0.05, b + 0.2)),
    body: easeOut3(window01(q, b + 0.12, b + 0.38)),
  };
}

function fragMotion(p: number, spec: FragSpec) {
  /* Wrapper ramp — easeOut3 parallax arrival; visibility rides the
     head beat so hairline Frag edges pop with the label/index tag.
     Focal-discipline settle — easeInOut3 so the opacity handoff
     between consecutive fragments breathes instead of snapping. */
  const q = window01(clamp01(p), spec.s, spec.e);
  const tIn = easeOut3(q);
  const head = headBeat(q);
  const relax = easeInOut3(
    window01(clamp01(p), spec.e, Math.min(1, spec.e + RELAX)),
  );
  const opacity = head * (1 - (1 - SETTLED) * relax);
  const dx = (1 - tIn) * spec.fromX;
  const dy = (1 - tIn) * spec.rise;
  return {
    q,
    opacity,
    transform: `translate(${dx}px, ${dy}px)`,
    willChange: "transform, opacity",
    bright: p >= spec.s && p <= spec.e + RELAX && head > 0,
  };
}

/** Annotation entrance — the fragment's own window shifted +ANNO_LAG;
    the annotation is the LAST sub-beat (final 30% of the shifted
    window, easeOut3), then the same focal settle so leader + label
    read as part of their fragment. Small 8px rise, hairline-quiet. */
function annoMotion(p: number, spec: FragSpec) {
  const s = Math.min(1, spec.s + ANNO_LAG);
  const e = Math.min(1, spec.e + ANNO_LAG);
  const q = window01(clamp01(p), s, e);
  const tIn = easeOut3(window01(q, 0.7, 1));
  const relax = easeInOut3(
    window01(clamp01(p), e, Math.min(1, e + RELAX)),
  );
  const opacity = tIn < 1 ? tIn : 1 - (1 - SETTLED) * relax;
  return {
    opacity,
    transform: `translateY(${(1 - tIn) * 8}px)`,
    willChange: "transform, opacity",
  } as const;
}

/* Registration anchors (viewBox 0..100 space) — one per fragment,
   nudged into each fragment's interior. Crosshair "+" marks sit here. */
const ANCHORS: [number, number][] = [
  [63, 22], // command
  [69, 48], // ai
  [15, 58], // keys
  [44, 42], // canvas
  [56, 71], // source
];

/* Leader-line endpoints = annotation label position (viewBox %).
   `end: true` right-aligns the label so its text ends at the leader
   tip. All y ≥ 14% → nothing enters the top 76px zone at ≥800px tall;
   horizontal extents checked at 1280px (narrowest target). */
const LEADERS: Record<FragKey, { x: number; y: number; end?: true }> = {
  command: { x: 74, y: 26 },
  ai: { x: 79, y: 54 },
  keys: { x: 9, y: 70 },
  canvas: { x: 31, y: 35, end: true },
  source: { x: 66, y: 77 },
};

/* Index-tag corner per fragment — the corner nearest the leader exit,
   straddling the fragment's hairline edge like a blueprint part tag. */
const INDEX_CORNER: Record<FragKey, "tl" | "tr" | "bl" | "br"> = {
  command: "tr",
  ai: "br",
  keys: "bl",
  canvas: "tl",
  source: "br",
};

/* Dashed construction path through the registration anchors. */
const CONSTRUCTION_D = "M 63 22 L 69 48 L 15 58 L 44 42 L 56 71";

/* ---- REAL content constants (verified product vocabulary) ---- */

/** Tool chords shown in the KEYS fragment — real single-key tools. */
const CHORD_KEYS = ["M", "B", "I"] as const;

/** Real TikZ managed-block tail — the source fragment types these
    two lines once per scene visit (20 chars/s, ticker-driven). */
const SRC_LINES = [
  "\\coordinate (M) at ($(A)!0.5!(B)$);",
  "% @mathgeo end",
] as const;
const SRC_TOTAL = SRC_LINES[0].length + SRC_LINES[1].length;

/* Mini-canvas drag replay path (148px box): press near the incircle
   touch point, drag down-left along a quadratic arc, release. */
const DRAG_P0 = { x: 92, y: 44 };
const DRAG_Q = { x: 78, y: 52 };
const DRAG_P1 = { x: 58, y: 80 };
const DRAG_D = `M ${DRAG_P0.x} ${DRAG_P0.y} Q ${DRAG_Q.x} ${DRAG_Q.y} ${DRAG_P1.x} ${DRAG_P1.y}`;

/* ============================================================
   Sub — one decomposed sub-part: lettered tag in a hairline
   square, dashed micro-leader, and the body itself. Each runs
   its own 3-beat stagger inside the fragment window.
   ============================================================ */
function Sub({
  letter,
  q,
  j,
  n,
  className,
  children,
}: {
  letter: string;
  q: number;
  j: number;
  n: number;
  className?: string;
  children: ReactNode;
}) {
  const b = subBeats(q, j, n);
  return (
    <div className={["scene-3__sub", className].filter(Boolean).join(" ")}>
      <span
        className="scene-3__subtag"
        aria-hidden="true"
        style={{
          opacity: b.tag,
          transform: `scale(${0.6 + 0.4 * b.tag})`,
          willChange: "transform, opacity",
        }}
      >
        {letter}
      </span>
      <span
        className="scene-3__sublead"
        aria-hidden="true"
        style={{
          opacity: b.lead,
          transform: `scaleX(${b.lead})`,
          willChange: "transform, opacity",
        }}
      />
      <div
        className="scene-3__subbody"
        style={{
          opacity: b.body,
          transform: `translateY(${(1 - b.body) * 10}px)`,
          willChange: "transform, opacity",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function Scene3({ progress }: Scene3Props) {
  const p = clamp01(progress);
  const { t, lang } = useLang();
  const copy = COPY[lang];
  const reduced = useReducedMotion();

  /* ---- Source typewriter: 2 real TikZ lines, 20 chars/s on the
     shared ticker, ONCE per scene visit. typedOnceRef guards
     against replay on progress ticks; reduced motion → instant. */
  const [typed, setTyped] = useState(0);
  const pRef = useRef(p);
  pRef.current = p;
  const typedOnceRef = useRef(false);
  useEffect(() => {
    if (reduced) {
      typedOnceRef.current = true;
      setTyped(SRC_TOTAL);
      return;
    }
    if (typedOnceRef.current) return;
    let acc = 0;
    let started = false;
    let done = false;
    const unsub = subscribeTicker((_time, dt) => {
      if (done) return;
      if (!started) {
        // arm when the source fragment's window begins
        if (pRef.current >= FRAGS[4].s) {
          started = true;
          typedOnceRef.current = true;
        } else {
          return;
        }
      }
      acc += dt * 0.02; // 20 characters per second
      const n = Math.min(SRC_TOTAL, Math.floor(acc));
      setTyped(n);
      if (n >= SRC_TOTAL) {
        done = true;
        unsub();
      }
    });
    return unsub;
  }, [reduced]);

  const src1 = SRC_LINES[0].slice(0, Math.min(typed, SRC_LINES[0].length));
  const src2 = SRC_LINES[1].slice(
    0,
    Math.max(0, typed - SRC_LINES[0].length),
  );

  const m = FRAGS.map((spec) => fragMotion(p, spec));
  const am = FRAGS.map((spec) => annoMotion(p, spec));

  /* ---- CANVAS mini: cursor-dot drag gesture replay, driven by the
     canvas fragment's window q (scrubs with scroll like every other
     beat). Press → quadratic-arc drag → release; the dashed drag
     path ghosts in while the gesture runs, then dissolves; the
     status chip crossfades 拖动中 → 约束已保持 at the end. */
  const qc = m[3].q;
  const cursorOp = window01(qc, 0.3, 0.38);
  const press = window01(qc, 0.38, 0.46) - window01(qc, 0.78, 0.88);
  const dragT = easeInOut3(window01(qc, 0.46, 0.78));
  const cx =
    (1 - dragT) * (1 - dragT) * DRAG_P0.x +
    2 * (1 - dragT) * dragT * DRAG_Q.x +
    dragT * dragT * DRAG_P1.x;
  const cy =
    (1 - dragT) * (1 - dragT) * DRAG_P0.y +
    2 * (1 - dragT) * dragT * DRAG_Q.y +
    dragT * dragT * DRAG_P1.y;
  const cursorScale = 1 - 0.28 * press;
  const dragPathOp =
    window01(qc, 0.46, 0.56) * (1 - window01(qc, 0.8, 0.92));
  const keptW = window01(qc, 0.84, 0.96);

  /* ---- KEYS chips: sequential keypress pulse — scale 0.92→1 +
     brighten, one pulse per chip inside its own sub-beat. */
  const chipPulse = (j: number) => {
    const b = subBase(j, FRAGS[2].subs);
    return easeOut3(window01(m[2].q, b + 0.12, b + 0.3));
  };

  /* Index tag — sits inside the Frag so it inherits the fragment's
     own entrance transform/opacity (zero extra choreography). */
  const indexTag = (i: number) => (
    <span
      className={`scene-3__index scene-3__index--${INDEX_CORNER[FRAGS[i].key]}`}
      aria-hidden="true"
    >
      {String(i + 1).padStart(2, "0")}
    </span>
  );

  return (
    <div className="scene-3" data-progress={p.toFixed(3)}>
      {/* ---- Chapter header ---- */}
      <div className="scene-3__header" style={fadeIn(p, 0.02, 0.1)}>
        <TinyLabel active={p > 0.04 && p < 0.16}>{t("s3.kicker")}</TinyLabel>
        <h2 className="scene-3__headline">
          {t("s3.headline.a")}
          <br />
          {t("s3.headline.b")}
        </h2>
        <p className="scene-3__sub">{t("s3.sub")}</p>
      </div>

      {/* ---- Blueprint construction system (drawn late) ----
          A solid hairline draws on first (drawStroke), then crossfades
          into the dashed blueprint path — dasharray can't share an
          element with drawStroke's inline dash pattern. Crosshair
          registration marks pop in staggered at the anchors. */}
      <svg
        className="scene-3__align"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={CONSTRUCTION_D}
          fill="none"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          style={{
            stroke: "var(--line-ui-soft)",
            ...drawStroke(p, 0.74, 0.92),
            opacity: 1 - window01(p, 0.9, 0.96),
          }}
        />
        <path
          d={CONSTRUCTION_D}
          fill="none"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="2.6 3.2"
          style={{ stroke: "var(--line-ui-soft)", ...fadeIn(p, 0.9, 0.96) }}
        />
        {ANCHORS.map(([cx, cy], i) => (
          <g
            key={i}
            style={{
              stroke: "var(--line-ui, rgba(245, 244, 238, 0.25))",
              ...fadeIn(p, 0.76 + i * 0.02, 0.82 + i * 0.02),
            }}
          >
            <line
              x1={cx - 0.9}
              y1={cy}
              x2={cx + 0.9}
              y2={cy}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={cx}
              y1={cy - 1.4}
              x2={cx}
              y2={cy + 1.4}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>

      {/* ---- Dashed leader lines: fragment anchor → annotation ---- */}
      <svg
        className="scene-3__leaders"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {FRAGS.map((spec, i) => {
          const [x1, y1] = ANCHORS[i];
          const tip = LEADERS[spec.key];
          return (
            <line
              key={spec.key}
              x1={x1}
              y1={y1}
              x2={tip.x}
              y2={tip.y}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2.2 2.2"
              style={{
                stroke: "var(--line-ui, rgba(245, 244, 238, 0.25))",
                opacity: am[i].opacity,
              }}
            />
          );
        })}
      </svg>

      {/* ---- Part annotations (bilingual, local COPY) ---- */}
      {FRAGS.map((spec, i) => {
        const tip = LEADERS[spec.key];
        return (
          <span
            key={spec.key}
            className={`scene-3__anno${tip.end ? " scene-3__anno--end" : ""}`}
            style={{
              left: `${tip.x}%`,
              top: `${tip.y}%`,
              opacity: am[i].opacity,
              transform: tip.end
                ? `translateX(-100%) ${am[i].transform}`
                : am[i].transform,
              willChange: am[i].willChange,
            }}
          >
            {copy[spec.key]}
          </span>
        );
      })}

      {/* ---- Persistent geometry echo (low opacity, never competes) ---- */}
      <div
        className="scene-3__echo"
        style={{ opacity: 0.14 * window01(p, 0.06, 0.18) }}
      >
        <GeometryCanvas
          variant="dock"
          interactive={false}
          construction="altitudes"
        />
      </div>

      {/* ---- Blueprint title block (free bottom-left corner) ---- */}
      <div
        className="scene-3__titleblock"
        aria-hidden="true"
        style={fadeIn(p, 0.84, 0.94)}
      >
        <span>MATHHUB · ENTRY SYSTEMS</span>
        <span>FIG 03 · SCALE 1:1</span>
      </div>

      {/* ---- 01 · Command palette fragment — REAL ⌘K deck ----
          a/ trigger chord chip · b/ real search placeholder ·
          c/ result row 反演点 I */}
      <Frag x={FRAGS[0].x} y={FRAGS[0].y} edges={["top"]} className="scene-3__frag--command" style={{ opacity: m[0].opacity, transform: m[0].transform, willChange: m[0].willChange }}>
        {indexTag(0)}
        <TinyLabel active={m[0].bright} className="scene-3__fraglabel">
          {t(FRAGS[0].labelKey)}
        </TinyLabel>
        <Sub letter="a" q={m[0].q} j={0} n={FRAGS[0].subs}>
          <KeyHint keys={["⌘", "K"]} />
        </Sub>
        <Sub letter="b" q={m[0].q} j={1} n={FRAGS[0].subs}>
          <span className="scene-3__cmdplaceholder">
            {copy.cmdPlaceholder}
          </span>
        </Sub>
        <Sub letter="c" q={m[0].q} j={2} n={FRAGS[0].subs}>
          <span className="scene-3__cmdresult">
            <span className="scene-3__cmdresultname">{copy.cmdResult}</span>
            <KeyHint keys={["I"]} />
          </span>
        </Sub>
      </Frag>

      {/* ---- 02 · AI fragment — REAL construction prompt ----
          a/ prompt line (real placeholder) · b/ fail-closed check */}
      <Frag x={FRAGS[1].x} y={FRAGS[1].y} edges={["left"]} className="scene-3__frag--ai" style={{ opacity: m[1].opacity, transform: m[1].transform, willChange: m[1].willChange }}>
        {indexTag(1)}
        <TinyLabel active={m[1].bright} className="scene-3__fraglabel">
          {t(FRAGS[1].labelKey)}
        </TinyLabel>
        <Sub letter="a" q={m[1].q} j={0} n={FRAGS[1].subs}>
          <span className="scene-3__prompt">
            <span className="scene-3__promptmark" aria-hidden="true">
              ›
            </span>
            <span className="scene-3__prompttext">{copy.aiPrompt}</span>
            <span className="scene-3__caret" aria-hidden="true" />
          </span>
        </Sub>
        <Sub letter="b" q={m[1].q} j={1} n={FRAGS[1].subs}>
          <span className="scene-3__aistatus">{copy.aiCheck}</span>
        </Sub>
      </Frag>

      {/* ---- 03 · Tool-chord fragment — REAL chords M / B / I ----
          a/ M 中点 · b/ B 中垂线 · c/ I 反演点， each with a
          sequential keypress pulse (scale 0.92→1 + brighten). */}
      <Frag x={FRAGS[2].x} y={FRAGS[2].y} edges={["bottom"]} className="scene-3__frag--keys" style={{ opacity: m[2].opacity, transform: m[2].transform, willChange: m[2].willChange }}>
        {indexTag(2)}
        <TinyLabel active={m[2].bright} className="scene-3__fraglabel">
          {t(FRAGS[2].labelKey)}
        </TinyLabel>
        {CHORD_KEYS.map((k, j) => {
          const pulse = chipPulse(j);
          return (
            <Sub
              key={k}
              letter={["a", "b", "c"][j]}
              q={m[2].q}
              j={j}
              n={FRAGS[2].subs}
              className="scene-3__chordrow"
            >
              <span
                className="scene-3__chippulse"
                style={{
                  opacity: 0.45 + 0.55 * pulse,
                  transform: `scale(${0.92 + 0.08 * pulse})`,
                  willChange: "transform, opacity",
                }}
              >
                <KeyHint keys={[k]} />
                <span className="scene-3__chordname">{copy.chord[j]}</span>
              </span>
            </Sub>
          );
        })}
      </Frag>

      {/* ---- 04 · Canvas fragment — constraint-preserving drag ----
          a/ incircle miniature + cursor-dot drag replay ·
          b/ drag status chip (约束已保持) */}
      <Frag x={FRAGS[3].x} y={FRAGS[3].y} edges={["top", "left"]} className="scene-3__frag--canvas" style={{ opacity: m[3].opacity, transform: m[3].transform, willChange: m[3].willChange }}>
        {indexTag(3)}
        <TinyLabel active={m[3].bright} className="scene-3__fraglabel">
          {t(FRAGS[3].labelKey)}
        </TinyLabel>
        <Sub letter="a" q={m[3].q} j={0} n={FRAGS[3].subs}>
          <div className="scene-3__minicanvas">
            <GeometryCanvas
              variant="dock"
              interactive={false}
              construction="incircle"
            />
            <svg
              className="scene-3__dragpath"
              viewBox="0 0 148 148"
              aria-hidden="true"
              style={{ opacity: dragPathOp }}
            >
              <path
                d={DRAG_D}
                fill="none"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 3"
              />
            </svg>
            <span
              className="scene-3__cursor"
              aria-hidden="true"
              style={{
                opacity: cursorOp,
                transform: `translate(${cx}px, ${cy}px) scale(${cursorScale})`,
                willChange: "transform, opacity",
              }}
            />
          </div>
        </Sub>
        <Sub letter="b" q={m[3].q} j={1} n={FRAGS[3].subs}>
          <span className="scene-3__dragstatus">
            <span
              className="scene-3__dragstatusline"
              style={{ opacity: 1 - keptW }}
            >
              {copy.dragDoing}
            </span>
            <span
              className="scene-3__dragstatusline scene-3__dragstatusline--done"
              style={{ opacity: keptW }}
            >
              {copy.dragDone}
            </span>
          </span>
        </Sub>
      </Frag>

      {/* ---- 05 · Source fragment — TikZ single truth ----
          a/ real \coordinate midpoint line · b/ % @mathgeo end,
          typewriter once per visit. */}
      <Frag x={FRAGS[4].x} y={FRAGS[4].y} edges={["left"]} className="scene-3__frag--source" style={{ opacity: m[4].opacity, transform: m[4].transform, willChange: m[4].willChange }}>
        {indexTag(4)}
        <TinyLabel active={m[4].bright} className="scene-3__fraglabel">
          {t(FRAGS[4].labelKey)}
        </TinyLabel>
        <Sub letter="a" q={m[4].q} j={0} n={FRAGS[4].subs}>
          <SourceLine>{src1 || " "}</SourceLine>
        </Sub>
        <Sub letter="b" q={m[4].q} j={1} n={FRAGS[4].subs}>
          <SourceLine dim>
            {src2}
            <span className="scene-3__textcaret" aria-hidden="true" />
          </SourceLine>
        </Sub>
      </Frag>
    </div>
  );
}
