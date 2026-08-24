import { useEffect, useRef, useState } from "react";
import { subscribeTicker } from "./motion";
import "./cursor.css";

/* ============================================================
   Custom cursor — 6px off-white dot (instant follow) + 24px
   hairline ring (lerped follow, k≈0.18 frame-independent).

   Fine pointers only; disabled entirely under reduced motion
   (the component renders null and the cursor.css `cursor:none`
   overrides are gated behind the same media queries, so the
   native cursor stays).

   All per-frame work writes transforms directly to the DOM via
   the shared ticker — no React re-renders. React state only
   flips when a media query changes.
   ============================================================ */

const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/* Hover targets: ring scales to 1.8, dot disappears.
   [data-cursor] (incl. data-cursor="drag") is supported for
   future interactive handles — e.g. the GeometryCanvas point-A
   drag handle — without this component needing to know them. */
const INTERACTIVE = "a, button, [role='button'], [data-cursor]";

/* Ring follow stiffness @60fps, made frame-rate independent
   below via 1 - pow(1 - k, dt / 16.7). */
const RING_K = 0.18;

export default function Cursor() {
  const [enabled, setEnabled] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(FINE_POINTER).matches &&
      !window.matchMedia(REDUCED_MOTION).matches,
  );
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  /* Re-evaluate only when a media query flips — never per frame. */
  useEffect(() => {
    const fine = window.matchMedia(FINE_POINTER);
    const reduced = window.matchMedia(REDUCED_MOTION);
    const update = () => setEnabled(fine.matches && !reduced.matches);
    update();
    fine.addEventListener("change", update);
    reduced.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let tx = 0;
    let ty = 0; // pointer target (client px)
    let rx = 0;
    let ry = 0; // lerped ring position
    let seen = false; // stays hidden until the first pointermove
    let visible = false;

    const show = () => {
      if (visible) return;
      visible = true;
      dot.classList.add("is-visible");
      ring.classList.add("is-visible");
    };
    const hide = () => {
      if (!visible) return;
      visible = false;
      dot.classList.remove("is-visible");
      ring.classList.remove("is-visible");
    };
    const setHover = (on: boolean) => {
      dot.classList.toggle("is-hover", on);
      ring.classList.toggle("is-hover", on);
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      dot.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      if (!seen) {
        /* First contact: snap the ring to the pointer so it never
           sweeps in from 0,0, then reveal both elements. */
        seen = true;
        rx = tx;
        ry = ty;
        ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      }
      show();
    };

    /* Event delegation — works for present and future targets. */
    const onOver = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      setHover(el !== null && el.closest(INTERACTIVE) !== null);
    };
    const onOut = (e: PointerEvent) => {
      const next = e.relatedTarget;
      if (!(next instanceof Element)) {
        /* Pointer left the window (or hit a non-element). */
        hide();
        setHover(false);
        return;
      }
      setHover(next.closest(INTERACTIVE) !== null);
    };

    const unsubscribe = subscribeTicker((_time, delta) => {
      if (!seen) return;
      const dt = Math.min(delta, 64); // clamp tab-switch jumps
      const k = 1 - Math.pow(1 - RING_K, dt / 16.7);
      rx += (tx - rx) * k;
      ry += (ty - ry) * k;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    });

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerout", onOut, { passive: true });
    return () => {
      unsubscribe();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
    </>
  );
}
