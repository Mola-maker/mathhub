import { useEffect } from "react";
import "./Scene4.css";
import GeometryCanvas from "../system/GeometryCanvas";
import { Frag, TinyLabel, SourceLine, KeyHint } from "../system/fragments";
import {
  ambient,
  drawStroke,
  easeInOut3,
  easeOut3,
  fadeIn,
  riseIn,
  window01,
  clamp01,
  useReducedMotion,
} from "../system/motion";
import { useLang, type I18nKey } from "../system/i18n";

/* ============================================================
   SCENE 4 — "Unified source of truth"  (journey 4, ivory #EDECE2)
   Ivory-blueprint treatment: five entry-point echoes (command,
   AI deck, keys, canvas, source) hang as numbered blueprint
   parts (01–05 hairline index tags), emitting DASHED cobalt
   leader lines that converge on ONE managed source transaction —
   a real `% @mathgeo begin … end` midpoint block framed by a
   title-block double rule and annotated "single source of
   truth". Resolution sequence: leaders converge → echoes settle
   to 0.22 → the block assembles line-by-line → begin/end
   directives draw hairline rules outward → a fingerprint chip
   lands at the corner → the geometry behind flashes. Clarity
   over spectacle, single focal point throughout.
   ============================================================ */

export interface Scene4Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

type Edge = "top" | "bottom" | "left" | "right";

interface EchoDef {
  id: string;
  /** i18n key for the fragment label. */
  labelKey: I18nKey;
  /** Fragment position, % of stage (Frag left/top). */
  x: number;
  y: number;
  /** Line start anchor, % of stage (fragment edge nearest center). */
  ax: number;
  ay: number;
  edges: Edge[];
}

/* Local bilingual copy — blueprint annotation + real product
   vocabulary for the echo contents. The central i18n dictionary
   is owned by the integration step, so NEW copy lives here as a
   small local table keyed by useLang().lang. Existing copy keeps
   flowing through t(). */
const COPY = {
  en: {
    truth: "single source of truth",
    commandLabel: "Inversion point",
    aiPrompt: "› Draw the circumcircle of ABC",
    keysLabel: "midpoint · perpendicular bisector",
  },
  zh: {
    truth: "唯一真源",
    commandLabel: "反演点",
    aiPrompt: "› 作 ABC 的外接圆",
    keysLabel: "中点 · 中垂线",
  },
} as const;

/* The converged transaction — a REAL managed source block.
   Mathematical/source notation is identical in both languages. */
const BLOCK = [
  "% @mathgeo begin plan-kind=midpoint inputs=A,B outputs=M",
  "\\coordinate (M) at ($(A)!0.5!(B)$);",
  "% @mathgeo end",
] as const;

/* Five echoes ring the stage in a balanced scatter — top, right,
   bottom-right, bottom-left, left — anchors on inward edges.
   Nothing enters the top ~76px header safety zone. */
const ECHOES: EchoDef[] = [
  { id: "command", labelKey: "s4.echo.command", x: 58, y: 14, ax: 68, ay: 21, edges: ["top", "left"] },
  { id: "ai", labelKey: "s4.echo.ai", x: 74, y: 46, ax: 74, ay: 50, edges: ["left"] },
  { id: "keys", labelKey: "s4.echo.keys", x: 60, y: 80, ax: 63, ay: 80, edges: ["bottom", "left"] },
  { id: "canvas", labelKey: "s4.echo.canvas", x: 10, y: 72, ax: 27, ay: 70, edges: ["bottom"] },
  { id: "source", labelKey: "s4.echo.source", x: 6, y: 40, ax: 21, ay: 44, edges: ["left"] },
];

/* Convergence target — the single managed source transaction. */
const CX = 50;
const CY = 45;

export default function Scene4({ progress }: Scene4Props) {
  const p = clamp01(progress);
  const reduced = useReducedMotion();
  const { t, lang } = useLang();

  /* Faint ambient drift on the echoes — auto no-op under reduced motion. */
  useEffect(() => {
    if (reduced) return;
    return ambient(".scene-4__echo", { drift: 2, duration: 10000 });
  }, [reduced]);

  /* ---- Choreography windows ----
     0.00–0.10  echoes rise in, scattered (blueprint parts 01–05)
     0.10–0.54  five dashed leaders draw inward, staggered by 0.045
     0.26–0.50  echoes dim to 0.22 — fully settled BEFORE assembly
     0.50–0.56  the title-block frame resolves
     0.56–0.86  RESOLUTION: block lines assemble (stagger 0.12,
                easeOut3); begin/end directives draw hairline
                rules outward (scaleX from center)
     0.60–0.70  annotation leader resolves (a beat behind line 1)
     0.78–0.94  converged leaders recede
     0.88–0.92  fingerprint ✓ chip lands at the block corner
     0.91–0.96  geometry behind flashes, then settles by 1.00
     0.92–0.99  one quiet line of copy appears                 */

  const echoDim = 1 - 0.78 * window01(p, 0.26, 0.5);
  const lineFade = 1 - 0.5 * window01(p, 0.78, 0.94);

  /* The title-block frame resolves first; its lines then assemble
     inside it one by one. */
  const frameT = easeInOut3(window01(p, 0.5, 0.56));

  /* Line-by-line assembly — 3 lines, staggered 0.12 apart, easeOut3. */
  const lineStyle = (from: number, to: number) => {
    const lt = easeOut3(window01(p, from, to));
    return {
      opacity: lt,
      transform: `translateY(${(1 - lt) * 10}px)`,
      willChange: "transform, opacity",
    } as const;
  };

  /* Hairline rules draw outward from the begin/end directive lines
     (scaleX from center), each trailing its directive by a beat. */
  const rule1T = easeOut3(window01(p, 0.61, 0.68));
  const rule2T = easeOut3(window01(p, 0.84, 0.9));

  /* Content-fingerprint validation chip — lands at the block corner
     once the block has fully assembled. */
  const chipT = easeOut3(window01(p, 0.88, 0.92));

  /* The annotation leader trails the first directive line — a beat
     behind its subject. */
  const annotOp = easeInOut3(window01(p, 0.6, 0.7));

  /* Geometry emphasis: barely present (0.05), flashes to ~0.25 once
     the fingerprint lands, then settles quiet at 0.16. Verified
     against ivory #EDECE2: cobalt ink #16367F at 0.05 / 0.25 / 0.16
     opacity mixes to ≈ rgb(226,227,221) / rgb(183,191,201) /
     rgb(202,207,210) — whisper, soft pulse, ghost. */
  const geoOp = Math.max(
    0.05,
    0.05 + 0.2 * window01(p, 0.91, 0.96) - 0.09 * window01(p, 0.96, 1),
  );

  /* Per-leader draw-on progress, evenly staggered (easeInOut3). */
  const leaderDraw = ECHOES.map((_, i) => {
    const from = 0.1 + i * 0.045;
    return easeInOut3(window01(p, from, from + 0.26));
  });

  const txLabelActive = frameT > 0.6;

  return (
    <div className="scene-4">
      {/* Living geometry, recessed far behind the transaction —
          medians + centroid break the inscribed-triangle monotony
          at whisper-quiet opacity; ink flips cobalt on ivory via
          the scoped var overrides in Scene4.css. */}
      <div className="scene-4__geo" style={{ opacity: geoOp }} aria-hidden>
        <GeometryCanvas
          variant="hero"
          construction="medians"
          interactive={false}
          className="scene-4__geo-svg"
        />
      </div>

      {/* Blueprint leader lines — dashed cobalt strokes converging
          on the transaction. A dashed line can't draw on through
          dashoffset (the dash pattern owns the dasharray), so each
          leader's draw-on lives on a WHITE MASK line (luminance
          only, never rendered) and the visible dashed stroke is
          revealed through it — same windows, same easeInOut3 as
          the original solid draw-on. */}
      <svg
        className="scene-4__lines"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          {ECHOES.map((e, i) => (
            <mask
              key={e.id}
              id={`scene-4-draw-${e.id}`}
              maskUnits="userSpaceOnUse"
              x={-10}
              y={-10}
              width={120}
              height={120}
            >
              <line
                x1={e.ax}
                y1={e.ay}
                x2={CX}
                y2={CY}
                pathLength={1}
                stroke="white"
                strokeWidth={2}
                style={drawStroke(leaderDraw[i], 0, 1)}
              />
            </mask>
          ))}
        </defs>
        {ECHOES.map((e) => (
          <line
            key={e.id}
            x1={e.ax}
            y1={e.ay}
            x2={CX}
            y2={CY}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            className={`scene-4__line scene-4__leader--${e.id}`}
            mask={`url(#scene-4-draw-${e.id})`}
            style={{ opacity: lineFade }}
          />
        ))}
      </svg>

      {/* Entry-point echoes — blueprint parts 01–05, real product
          vocabulary with cobalt index tags */}
      {ECHOES.map((e, i) => (
        <Frag
          key={e.id}
          x={e.x}
          y={e.y}
          label={t(e.labelKey)}
          edges={e.edges}
          className={`scene-4__echo scene-4__echo--${e.id}`}
          style={{ opacity: window01(p, 0, 0.1) * echoDim }}
        >
          <div className="scene-4__echo-inner" style={riseIn(p, 0, 0.1, 14)}>
            <span className="scene-4__tag" aria-hidden>{`0${i + 1}`}</span>
            {e.id === "command" && (
              <span className="scene-4__row">
                <KeyHint keys={["⌘", "K"]} label={COPY[lang].commandLabel} />
              </span>
            )}
            {e.id === "ai" && (
              <SourceLine dim>{COPY[lang].aiPrompt}</SourceLine>
            )}
            {e.id === "keys" && (
              <KeyHint keys={["M", "B"]} label={COPY[lang].keysLabel} />
            )}
            {e.id === "canvas" && (
              <svg
                className="scene-4__mini-sketch"
                viewBox="0 0 34 22"
                aria-hidden
              >
                {/* Mini midpoint sketch — segment AB, midpoint M,
                    matching the managed block's construction. */}
                <line
                  x1="3"
                  y1="18"
                  x2="29"
                  y2="5"
                  stroke="var(--line-ui, var(--line-strong))"
                  strokeWidth="1"
                />
                <line
                  x1="15.1"
                  y1="9.7"
                  x2="16.9"
                  y2="13.3"
                  stroke="var(--line-ui, var(--line-strong))"
                  strokeWidth="1"
                />
                <circle cx="3" cy="18" r="1.4" fill="var(--fg, var(--paper))" />
                <circle cx="29" cy="5" r="1.4" fill="var(--fg, var(--paper))" />
                <circle cx="16" cy="11.5" r="1.4" fill="var(--fg, var(--paper))" />
              </svg>
            )}
            {e.id === "source" && (
              <SourceLine>{BLOCK[1]}</SourceLine>
            )}
          </div>
        </Frag>
      ))}

      {/* The one bright focal point — a real managed source block,
          framed as a blueprint title block with its annotation. The
          frame resolves first; the three source lines then assemble
          one by one, the begin/end directives drawing hairline
          rules outward, and a fingerprint ✓ chip lands last. */}
      <div className="scene-4__tx" style={{ opacity: frameT }}>
        <TinyLabel active={txLabelActive}>{t("s4.tx.label")}</TinyLabel>
        <div className="scene-4__tx-block">
          <div
            className="scene-4__tx-line scene-4__tx-line--dir"
            style={lineStyle(0.56, 0.63)}
          >
            {BLOCK[0]}
          </div>
          <div
            className="scene-4__tx-rule"
            style={{ transform: `scaleX(${rule1T})` }}
          />
          <div
            className="scene-4__tx-line scene-4__tx-line--code"
            style={lineStyle(0.68, 0.75)}
          >
            {BLOCK[1]}
          </div>
          <div
            className="scene-4__tx-line scene-4__tx-line--dir"
            style={lineStyle(0.8, 0.86)}
          >
            {BLOCK[2]}
          </div>
          <div
            className="scene-4__tx-rule"
            style={{ transform: `scaleX(${rule2T})` }}
          />
        </div>
        <div
          className="scene-4__chip"
          style={{
            opacity: chipT,
            transform: `translateY(${(1 - chipT) * 4}px)`,
          }}
        >
          fingerprint ✓
        </div>
        <div className="scene-4__annot" style={{ opacity: annotOp }}>
          <span className="scene-4__annot-text">{COPY[lang].truth}</span>
        </div>
      </div>

      {/* Final quiet beat */}
      <div
        className={`scene-4__quiet${lang === "zh" ? " scene-4__quiet--zh" : ""}`}
        style={fadeIn(p, 0.92, 0.99)}
      >
        {t("s4.quiet")}
      </div>
    </div>
  );
}
