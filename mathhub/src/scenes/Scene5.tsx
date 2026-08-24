import { useEffect, useRef, useState } from "react";
import "./Scene5.css";
import { useGeometry } from "../system/geometry";
import GeometryCanvas from "../system/GeometryCanvas";
import { Frag, TinyLabel, SourceLine } from "../system/fragments";
import { clamp01, window01 } from "../system/scroll";
import {
  ambient,
  easeInOut3,
  easeOut3,
  subscribeTicker,
  useReducedMotion,
} from "../system/motion";
import { useLang, type I18nKey } from "../system/i18n";

export interface Scene5Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

/* ============================================================
   SCENE 5 — Workspace reveal.
   The hero object unfolds into the quiet MathHub instrument:
   geometry recenters as the unobstructed canvas while four
   open fragments dock in sequence — top tool-chord toolbar,
   left command deck, right 关系 inspector, bottom source dock.
   Single focal rule: the region currently docking is brightest;
   already-docked regions settle to a quiet baseline.

   Every label here is real studio vocabulary — tool chords,
   关系-tab fields, GeoGebra commands, managed TikZ blocks,
   the solver status chip. No compass/ruler/locus, no proof
   ledger, no snake_case relations.

   This is the ONLY scene that carries the toolbar — it is the
   workspace reveal, the one place the toolbar belongs.
   ============================================================ */

/* Toolbar — real tool chords from the studio (V/L/C/M/B/I). */
const TOOL_KEYS: readonly I18nKey[] = [
  "s5.tool.select",
  "s5.tool.segment",
  "s5.tool.circle",
  "s5.tool.midpoint",
  "s5.tool.perpbisect",
  "s5.tool.invert",
];

/* Inspector tabs — the open one is 关系 / Relations. */
const TAB_KEYS: readonly I18nKey[] = [
  "s5.inspector.tab.geometry",
  "s5.inspector.tab.style",
  "s5.inspector.tab.relations",
];

/* 关系-tab fields — the inspector's real vocabulary: what the
   selected derived point is, how it writes back, and who holds
   its constraints while it is dragged. */
const RELATION_KEYS: ReadonlyArray<{ key: I18nKey; primary?: boolean }> = [
  { key: "s5.rel.deftype", primary: true },
  { key: "s5.rel.writeback" },
  { key: "s5.rel.upstream" },
  { key: "s5.rel.downstream" },
  { key: "s5.rel.dof" },
];

/* Command-deck history — a real AI entry resolving into real
   GeoGebra commands: prompt in, verified construction out. */
const HISTORY_KEYS: readonly I18nKey[] = [
  "s5.history.ai",
  "s5.history.circle",
  "s5.history.center",
];

/* Managed TikZ block — the source dock's ledger. Pure notation,
   identical literals in both languages, so it lives here as a
   local constant instead of the dictionary. */
const LEDGER_LINES: readonly string[] = [
  "% @mathgeo begin plan-kind=midpoint inputs=A,B outputs=M",
  "\\coordinate (M) at ($(A)!0.5!(B)$);",
  "\\node[draw,circle through=(B)] at (O) {};",
  "% @mathgeo end",
];

/* Solver status chip — the magic moment signature: dragging a
   derived point while the worker solver back-solves upstream free
   points. ~1.2s of "holding" resolves into "held", then the chip
   gently loops. Reduced motion pins it to the resolved state. */
const SOLVER_DRAG_MS = 1200;
const SOLVER_CYCLE_MS = 4400;

/* Dock windows (start → fully in place), in sequence. */
const W = {
  top: [0.16, 0.34],
  left: [0.32, 0.5],
  right: [0.48, 0.66],
  bottom: [0.64, 0.82],
  end: [0.86, 0.98],
} as const;

/** Quiet baseline a dock settles to once the next region takes focus. */
const SETTLE = 0.72;

/** 60%-through point of a window — where the previous dock's settle
    begins, so the handoff pans slowly instead of stepping. */
const at60 = (w: readonly [number, number]) => w[0] + 0.6 * (w[1] - w[0]);

/* Overlapped settle drivers: dock N begins dimming at ~60% through
   dock N+1's entrance and reaches the baseline at ~60% through dock
   N+2's — a continuous focal pan across the anatomy. */
const S = {
  top: [at60(W.left), at60(W.right)],
  left: [at60(W.right), at60(W.bottom)],
  right: [at60(W.bottom), at60(W.end)],
  bottom: [at60(W.end), at60(W.end) + 0.14],
} as const;

export default function Scene5({ progress }: Scene5Props) {
  const p = clamp01(progress);
  const { t } = useLang();
  const { sourceLines, lastTransaction } = useGeometry();
  const reduced = useReducedMotion();

  /* Living-geometry drift (auto-disabled under reduced motion). */
  const driftRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => ambient(driftRef.current, { drift: 2.5, duration: 9500 }), []);

  /* Solver status chip — one shared-ticker subscription; the state
     only flips twice per cycle, so re-renders stay rare. */
  const [solverHeld, setSolverHeld] = useState(false);
  useEffect(() => {
    if (reduced) {
      setSolverHeld(true);
      return;
    }
    let acc = 0;
    const unsub = subscribeTicker((_time, dt) => {
      acc = (acc + dt) % SOLVER_CYCLE_MS;
      const held = acc >= SOLVER_DRAG_MS;
      setSolverHeld((prev) => (prev === held ? prev : held));
    });
    return unsub;
  }, [reduced]);

  /* ---- Dock entrances (easeOut3 — arrival without overshoot) ---- */
  const tTop = easeOut3(window01(p, W.top[0], W.top[1]));
  const tLeft = easeOut3(window01(p, W.left[0], W.left[1]));
  const tRight = easeOut3(window01(p, W.right[0], W.right[1]));
  const tBottom = easeOut3(window01(p, W.bottom[0], W.bottom[1]));
  const tEnd = easeOut3(window01(p, W.end[0], W.end[1]));

  /* ---- Single-focal brightness: full while docking, then a slow
         overlapped pan down to the quiet baseline (easeInOut3). ---- */
  const dim = (w: readonly [number, number]) =>
    1 - (1 - SETTLE) * easeInOut3(window01(p, w[0], w[1]));
  const brightTop = tTop * dim(S.top);
  const brightLeft = tLeft * dim(S.left);
  const brightRight = tRight * dim(S.right);
  const brightBottom = tBottom * dim(S.bottom);

  /* ---- Depth artifacts: each appears AFTER its parent region
         docks, staggered, transform/opacity only, and settles to
         the same quiet baseline as its parent. ---- */
  /* Solver chip docks after the inspector settles (0.66). */
  const tSolver = easeOut3(window01(p, 0.68, 0.78));
  const settleRight = dim(S.right);
  const settleBottom = dim(S.bottom);
  /* Ledger lines dock after the source dock settles (0.82). */
  const tLedger = (i: number) =>
    easeOut3(window01(p, 0.815 + i * 0.026, 0.86 + i * 0.026));
  /* Canvas metadata appears once the anatomy has opened. */
  const tMeta = easeOut3(window01(p, 0.6, 0.7));
  /* Capability chips surface once every dock has settled. */
  const tChips = easeOut3(window01(p, 0.84, 0.93));

  /* ---- Geometry morph: recenter + slight scale as the anatomy opens ---- */
  const m = easeInOut3(window01(p, 0.12, 0.86));
  const geoScale = 1 - 0.14 * m;
  const geoOpacity = 1 - 0.22 * window01(p, W.top[0], W.bottom[1]);

  /* ---- Faint spatial unfolding (≤2deg, easeInOut3) ---- */
  const tilt = easeInOut3(window01(p, 0.1, 0.8)) * 1.8;

  return (
    <div className="scene-5" data-progress={p.toFixed(3)}>
      <div
        className="scene-5__stage"
        style={{ transform: `perspective(1500px) rotateX(${tilt}deg)` }}
      >
        {/* Central canvas — the hero object becoming the workspace.
            Same construction the user has followed since Scene 1. */}
        <div
          className="scene-5__canvas-wrap"
          style={{
            opacity: geoOpacity,
            transform: `translate(-50%, ${-50 - 3.2 * m}%) scale(${geoScale})`,
          }}
        >
          <div ref={driftRef} className="scene-5__canvas-drift">
            <GeometryCanvas
              variant="hero"
              construction="circumcircle"
              interactive
              className="scene-5__canvas"
            />
          </div>
          {/* Model density — a whisper at the canvas corner. */}
          <div
            className="scene-5__canvas-meta"
            style={{
              opacity: tMeta,
              transform: `translateY(${(1 - tMeta) * 6}px)`,
            }}
          >
            {t("s5.canvas.meta")}
          </div>
        </div>

        {/* TOP — tool-chord toolbar. Docks BELOW the floating site
            header: never closer than 80px from the stage top, so the
            global header zone (~76px) stays unobstructed while visible. */}
        <Frag
          x={50}
          y={8}
          edges={["bottom"]}
          className="scene-5__toolbar"
          style={{
            top: "max(8%, 80px)",
            opacity: brightTop,
            transform: `translateX(-50%) translateY(${-(1 - tTop) * 14}px)`,
          }}
        >
          <div className="scene-5__tools">
            {TOOL_KEYS.map((key, i) => (
              <span key={key} className="scene-5__tool">
                <TinyLabel
                  active={i === 2}
                  className={i === 2 ? undefined : "tinylabel--on-deep"}
                >
                  {t(key)}
                </TinyLabel>
              </span>
            ))}
          </div>
        </Frag>

        {/* Capability chips — the two real panels that orbit the
            canvas: construction-steps replay and exact TeX preview.
            They surface only after every dock has settled. */}
        <div
          className="scene-5__chips"
          style={{
            opacity: tChips,
            transform: `translateX(-50%) translateY(${(1 - tChips) * 8}px)`,
          }}
        >
          <span className="scene-5__chip">{t("s5.chip.steps")}</span>
          <span className="scene-5__chip">{t("s5.chip.preview")}</span>
        </div>

        {/* LEFT — command deck: palette placeholder, an AI entry
            resolving into real commands, and the fail-closed badge
            proving the proposal bound to the live board. */}
        <Frag
          x={7}
          y={30}
          edges={["left"]}
          label={t("s5.deck.label")}
          className="scene-5__deck"
          style={{
            opacity: brightLeft,
            transform: `translateX(${-(1 - tLeft) * 14}px)`,
          }}
        >
          <SourceLine
            dim
            className="scene-5__prompt sourceline--dim-on-deep"
          >
            {t("s5.deck.prompt")}
          </SourceLine>
          {HISTORY_KEYS.map((key) => (
            <SourceLine
              key={key}
              dim
              className="scene-5__history sourceline--dim-on-deep"
            >
              › {t(key)}
            </SourceLine>
          ))}
          <div className="scene-5__badge-row">
            <span className="scene-5__badge">{t("s5.history.badge")}</span>
          </div>
        </Frag>

        {/* RIGHT — 关系 inspector: definition, write-back, upstream,
            downstream, degrees of freedom */}
        <Frag
          x={78}
          y={30}
          edges={["right"]}
          label={t("s5.inspector.label")}
          className="scene-5__inspector"
          style={{
            opacity: brightRight,
            transform: `translateX(${(1 - tRight) * 14}px)`,
          }}
        >
          <div className="scene-5__tabs">
            {TAB_KEYS.map((key, i) => (
              <TinyLabel
                key={key}
                active={i === 2}
                className={i === 2 ? undefined : "tinylabel--on-deep"}
              >
                {t(key)}
              </TinyLabel>
            ))}
          </div>
          {RELATION_KEYS.map(({ key, primary }) => (
            <SourceLine
              key={key}
              dim={!primary}
              className={primary ? undefined : "sourceline--dim-on-deep"}
            >
              {t(key)}
            </SourceLine>
          ))}
          {/* Solver status chip — docking after the inspector settles:
              a derived point is dragged, the solver keeps every
              constraint, and the chip says so. */}
          <div
            className="scene-5__solver"
            style={{
              opacity: tSolver * settleRight,
              transform: `translateY(${(1 - tSolver) * 6}px)`,
            }}
          >
            <TinyLabel className="tinylabel--on-deep scene-5__solver-label">
              {t("s5.solver.label")}
            </TinyLabel>
            <span
              className={
                solverHeld
                  ? "scene-5__solver-chip scene-5__solver-chip--held"
                  : "scene-5__solver-chip"
              }
            >
              {solverHeld ? t("s5.solver.held") : t("s5.solver.dragging")}
            </span>
          </div>
        </Frag>

        {/* BOTTOM — collapsible source dock (live source) */}
        <Frag
          x={50}
          y={84}
          edges={["top"]}
          label={t("s5.source.label")}
          className="scene-5__source"
          style={{
            opacity: brightBottom,
            transform: `translateX(-50%) translateY(${(1 - tBottom) * 14}px)`,
          }}
        >
          <div className="scene-5__source-strip">
            {sourceLines.map((line, i) => (
              <SourceLine
                key={line}
                dim={i !== 1}
                className={i !== 1 ? "sourceline--dim-on-deep" : undefined}
              >
                {line}
              </SourceLine>
            ))}
            <TinyLabel
              active
              className="scene-5__tx"
              style={{ opacity: lastTransaction ? 1 : 0 }}
            >
              {lastTransaction ?? "Δ A"}
            </TinyLabel>
            <span className="scene-5__collapse" aria-hidden="true">
              –
            </span>
          </div>
          {/* Managed-block ledger — the dock's memory: the construction
              lands here as a real @mathgeo block. */}
          <div className="scene-5__ledger">
            {LEDGER_LINES.map((line, i) => {
              const tLine = tLedger(i);
              return (
                <SourceLine
                  key={line}
                  dim
                  className="scene-5__ledger-line sourceline--dim-on-deep"
                  style={{
                    opacity: tLine * settleBottom,
                    transform: `translateY(${(1 - tLine) * 6}px)`,
                  }}
                >
                  {line}
                </SourceLine>
              );
            })}
          </div>
        </Frag>

        {/* END — the quiet gateway */}
        <a
          className="scene-5__enter"
          href="#scene-6"
          style={{
            opacity: tEnd,
            transform: `translateX(-50%) translateY(${(1 - tEnd) * 10}px)`,
            pointerEvents: tEnd > 0.6 ? "auto" : "none",
          }}
        >
          {t("s5.enter")}
        </a>
      </div>
    </div>
  );
}
