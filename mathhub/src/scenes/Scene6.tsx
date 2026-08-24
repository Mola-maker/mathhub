import { useEffect, useRef } from "react";
import "./Scene6.css";
import { TinyLabel } from "../system/fragments";
import { useLang } from "../system/i18n";
import {
  clamp01,
  window01,
  easeOut3,
  subscribeTicker,
  useReducedMotion,
} from "../system/motion";
import { MATH_STUDIO_URL, TIKZ_STUDIO_URL } from "../system/gateways";

export interface Scene6Props {
  /** Scene-local scroll progress 0..1, supplied by SceneShell. */
  progress: number;
}

/* ============================================================
   SCENE 6 — "Two instruments" (the finale)
   Two REAL backend board entries, side by side but editorially
   asymmetric: GeoGebra Studio larger/left, TikZ Studio smaller
   and right-offset. Open fragments with ≤2 hairlines each —
   the whole artifact is ONE keyboard-focusable <a> per entry.

   State completeness (Kimi principles, cobalt execution):
     hover         subtle brighten + hairline strengthens
     focus-visible 1px --paper outline, offset 3px
     pressed       translateY(1px)
   Motion: transform/opacity only; orbit runs on the shared
   ticker; the caret blink is opacity-only; both die under
   prefers-reduced-motion.
   ============================================================ */

/** Staggered rise-in via easeOut3 (chapter label → GeoGebra → TikZ). */
function enter(p: number, from: number, to: number, px: number) {
  const t = easeOut3(window01(p, from, to));
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * px}px)`,
    willChange: "transform, opacity" as const,
  };
}

export default function Scene6({ progress }: Scene6Props) {
  const p = clamp01(progress);
  const { t } = useLang();
  const reduced = useReducedMotion();
  const orbitRef = useRef<SVGGElement | null>(null);

  /* Live-geometry motif: a point orbiting its circle (with a tiny
     drag-hint cursor trailing it), driven by the ONE shared rAF
     ticker — CSS transform rotation only, ~9s per revolution.
     Static when the user prefers reduced motion. */
  useEffect(() => {
    if (reduced) return;
    return subscribeTicker((time) => {
      const g = orbitRef.current;
      if (g) g.style.transform = `rotate(${(time * 0.04) % 360}deg)`;
    });
  }, [reduced]);

  return (
    <div className="scene-6" data-progress={p.toFixed(3)}>
      {/* ---- Chapter label (enters first) ---- */}
      <div className="scene-6__kicker" style={enter(p, 0.04, 0.16, 12)}>
        <TinyLabel active={p > 0.06}>{t("s6.kicker")}</TinyLabel>
      </div>

      {/* ---- GeoGebra Studio — larger, left ---- */}
      <div
        className="scene-6__slot scene-6__slot--geo"
        style={enter(p, 0.14, 0.4, 30)}
      >
        <a
          className="scene-6__gateway scene-6__gateway--geo"
          href={MATH_STUDIO_URL}
        >
          <h3 className="scene-6__name">{t("s6.geo.name")}</h3>
          <p className="scene-6__desc">{t("s6.geo.desc")}</p>

          <div className="scene-6__motif" aria-hidden="true">
            <svg viewBox="0 0 120 120" className="scene-6__geosvg">
              <circle
                cx="60"
                cy="60"
                r="34"
                fill="none"
                stroke="var(--soft)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx="60" cy="60" r="1.6" fill="var(--mist)" />
              {/* orbiting group: radius ray + draggable point + drag hint */}
              <g ref={orbitRef} className="scene-6__orbit">
                <line
                  x1="60"
                  y1="60"
                  x2="60"
                  y2="26"
                  stroke="var(--line-faint)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx="60"
                  cy="26"
                  r="4"
                  fill="none"
                  stroke="var(--paper)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx="60" cy="26" r="1.2" fill="var(--paper)" />
                <path d="M 69 21 l 7 -3 l -2.5 6.5 z" fill="var(--mist)" />
              </g>
            </svg>
            <span className="scene-6__hint">{t("s6.geo.hint")}</span>
          </div>

          <span className="scene-6__cta">{t("s6.geo.cta")}</span>
        </a>
      </div>

      {/* ---- TikZ Studio — smaller, right-offset ---- */}
      <div
        className="scene-6__slot scene-6__slot--tikz"
        style={enter(p, 0.3, 0.56, 30)}
      >
        <a
          className="scene-6__gateway scene-6__gateway--tikz"
          href={TIKZ_STUDIO_URL}
        >
          <h3 className="scene-6__name">{t("s6.tikz.name")}</h3>
          <p className="scene-6__desc">{t("s6.tikz.desc")}</p>

          {/* Typeset-source motif: delicate TikZ lines + blinking caret.
              Mathematical source is NEVER translated (i18n hard rule). */}
          <div className="scene-6__code" aria-hidden="true">
            <span className="scene-6__codeline">
              \draw (A) -- (B) -- (C) -- cycle;
            </span>
            <span className="scene-6__codeline scene-6__codeline--dim">
              \draw (O) circle (2.4);
            </span>
            <span className="scene-6__codeline scene-6__codeline--dim">
              \node[above] at (A) {"$A$"};
            </span>
            <span className="scene-6__codeline">
              \path (A) -- (O)
              <span className="scene-6__caret" />
            </span>
          </div>

          <span className="scene-6__cta">{t("s6.tikz.cta")}</span>
        </a>
      </div>
    </div>
  );
}
