import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  useGeometry,
  projectToLine,
  distance,
  type ConstructionFigure,
  type ConstructionVariant,
  type Point,
} from "./geometry";

/* ============================================================
   GeometryCanvas — the living geometry object as SVG.

   Default mode (figure omitted): triangle A/B/C (1px --paper) plus
   a construction overlay selected by the `construction` prop:

     'circumcircle' — circumcircle + O + rays + aux circle (default)
     'incircle'     — incircle + I + bisector rays + touch ticks
     'medians'      — three medians + G + midpoint ticks
     'altitudes'    — three dashed altitudes + H + right-angle marks

   Figure mode (figure prop passed explicitly — Scene 2's switcher):
     'rectangle'    — Polygon(A, B, C, D) from diagonal A–C (drag A or C)
     'pentagon'     — Polygon(O, A, 5), drag A rotates/scales
     'ellipse'      — Ellipse(F1, F2, 3), drag F1 (= A)
     'homothety'    — triangle + Dilate(A, 1.5, O) ghost, drag A

   NOTE: figure rendering is strictly opt-in per instance via the
   `figure` prop. When the prop is omitted the canvas ALWAYS renders
   the triangle family (following context `construction`) — so Scenes
   1/4/5 never change regardless of the context `figure` state.

   Delicate 1px lines via vector-effect="non-scaling-stroke".
   Main strokes --paper, construction lines --line-faint,
   tick/right-angle marks --line-strong, labels ~11px --mist.
   ============================================================ */

export interface GeometryCanvasProps {
  variant?: "hero" | "dock";
  interactive?: boolean;
  className?: string;
  /**
   * Construction overlay. When omitted, the canvas follows
   * `useGeometry().construction` (itself defaulting to 'circumcircle').
   */
  construction?: ConstructionVariant;
  /**
   * Switchable figure (Scene 2). When omitted, the canvas renders the
   * triangle family only — it does NOT follow `useGeometry().figure`,
   * so passing nothing keeps Scene 1/4/5 visuals pinned.
   */
  figure?: ConstructionFigure;
}

const VIEW = 10; // normalized viewBox space 0..10

/** Small perpendicular notch (tick mark) at `mid`, across direction `along`.
    `mid` is applied by the caller — this returns only the notch vector. */
function tickNotch(_mid: Point, along: Point, size = 0.16): Point {
  const len = Math.hypot(along.x, along.y) || 1;
  return { x: (-along.y / len) * size, y: (along.x / len) * size };
}

type DragTarget = "A" | "C";

export function GeometryCanvas({
  variant = "hero",
  interactive = true,
  className,
  construction: constructionProp,
  figure: figureProp,
}: GeometryCanvasProps) {
  const {
    A,
    B,
    C,
    setA,
    setC,
    circumcenter: O,
    circumradius: r,
    construction: ctxConstruction,
    derived,
    figureGeometry,
  } = useGeometry();
  const construction = constructionProp ?? ctxConstruction;
  /* Figure mode is opt-in per instance (see header note): omitted →
     classic circumcircle-family rendering, no context leakage. */
  const figure = figureProp ?? "circumcircle";

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const dragTarget = useRef<DragTarget>("A");

  const toSvg = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // viewBox 0..10 with preserveAspectRatio="xMidYMid meet"
    const scale = Math.min(rect.width, rect.height) / VIEW;
    const offsetX = (rect.width - VIEW * scale) / 2;
    const offsetY = (rect.height - VIEW * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    };
  }, []);

  /* Pointer drag, per handle (A or C). Pointer capture routes the
     gesture to whichever grab circle received pointerdown. */
  const handlePointer = useCallback(
    (target: DragTarget, set: (p: Point) => void) => ({
      onPointerDown: (e: PointerEvent<SVGCircleElement>) => {
        if (!interactive) return;
        dragTarget.current = target;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      onPointerMove: (e: PointerEvent<SVGCircleElement>) => {
        if (!dragging.current || !interactive || dragTarget.current !== target)
          return;
        set(toSvg(e.clientX, e.clientY));
      },
      onPointerUp: (e: PointerEvent<SVGCircleElement>) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      },
    }),
    [interactive, toSvg],
  );

  /* Keyboard control: arrow keys nudge the handle (Shift = larger step). */
  const handleKey = useCallback(
    (set: (p: Point) => void, p: Point) =>
      (e: KeyboardEvent<SVGCircleElement>) => {
        if (!interactive) return;
        const step = e.shiftKey ? 0.5 : 0.2;
        const moves: Record<string, Point> = {
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
        };
        const d = moves[e.key];
        if (!d) return;
        e.preventDefault();
        set({ x: p.x + d.x, y: p.y + d.y });
      },
    [interactive],
  );

  const isHero = variant === "hero";
  const labelFontSize = 0.34; // ≈11px at typical hero scale

  const { incenter: I, centroid: G, orthocenter: H, midAB, midBC, midCA, inradius } =
    derived;

  /* ---------- shared hairline props ---------- */
  const faint = {
    stroke: "var(--line-faint)",
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke",
  } as const;
  const strong = {
    stroke: "var(--line-strong)",
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke",
  } as const;

  /** Draggable handle: visible dot + wide transparent grab circle. */
  const renderHandle = (
    target: DragTarget,
    p: Point,
    set: (q: Point) => void,
    label: string,
  ) => (
    <g key={`handle-${target}`}>
      <circle
        cx={p.x}
        cy={p.y}
        r={0.07}
        fill="var(--paper)"
        style={interactive ? { pointerEvents: "none" } : undefined}
      />
      {interactive && (
        <circle
          cx={p.x}
          cy={p.y}
          r={0.55}
          fill="transparent"
          style={{ cursor: "grab", touchAction: "none" }}
          tabIndex={0}
          role="slider"
          aria-label={`Point ${label} — drag or use arrow keys to move`}
          aria-valuenow={Math.round(p.x * 100) / 100}
          {...handlePointer(target, set)}
          onKeyDown={handleKey(set, p)}
        />
      )}
    </g>
  );

  /* ---------- circumcircle elements (original, lightly enriched) ---------- */
  const ray = (p: Point) => ({
    x1: O.x,
    y1: O.y,
    x2: O.x + (p.x - O.x) * 1.35,
    y2: O.y + (p.y - O.y) * 1.35,
  });
  const rayB = ray(B);
  const rayC = ray(C);
  const normalBC = tickNotch(midBC, { x: C.x - B.x, y: C.y - B.y });
  const normalCA = tickNotch(midCA, { x: A.x - C.x, y: A.y - C.y });
  // faint dashed perpendicular bisector: from O through midBC, gently extended
  const bisDir: Point = { x: midBC.x - O.x, y: midBC.y - O.y };
  const bisector = {
    x1: O.x - bisDir.x * 0.28,
    y1: O.y - bisDir.y * 0.28,
    x2: midBC.x + bisDir.x * 0.32,
    y2: midBC.y + bisDir.y * 0.32,
  };

  /* ---------- incircle elements ---------- */
  const bisectorRay = (v: Point) => ({
    x1: v.x,
    y1: v.y,
    x2: v.x + (I.x - v.x) * 1.28,
    y2: v.y + (I.y - v.y) * 1.28,
  });
  const bisA = bisectorRay(A);
  const bisB = bisectorRay(B);
  const touchBC = projectToLine(I, B, C);
  const touchCA = projectToLine(I, C, A);
  const touchAB = projectToLine(I, A, B);
  const touchTicks: Array<{ p: Point; along: Point }> = [
    { p: touchBC, along: { x: C.x - B.x, y: C.y - B.y } },
    { p: touchCA, along: { x: A.x - C.x, y: A.y - C.y } },
    { p: touchAB, along: { x: B.x - A.x, y: B.y - A.y } },
  ];

  /* ---------- medians elements ---------- */
  const medians: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
    { x1: A.x, y1: A.y, x2: midBC.x, y2: midBC.y },
    { x1: B.x, y1: B.y, x2: midCA.x, y2: midCA.y },
    { x1: C.x, y1: C.y, x2: midAB.x, y2: midAB.y },
  ];
  const midTicks: Array<{ p: Point; along: Point }> = [
    { p: midBC, along: { x: C.x - B.x, y: C.y - B.y } },
    { p: midCA, along: { x: A.x - C.x, y: A.y - C.y } },
    { p: midAB, along: { x: B.x - A.x, y: B.y - A.y } },
  ];

  /* ---------- altitudes elements ---------- */
  const footA = projectToLine(A, B, C);
  const footB = projectToLine(B, C, A);
  const footC = projectToLine(C, A, B);
  const altitudes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
    { x1: A.x, y1: A.y, x2: footA.x, y2: footA.y },
    { x1: B.x, y1: B.y, x2: footB.x, y2: footB.y },
    { x1: C.x, y1: C.y, x2: footC.x, y2: footC.y },
  ];
  /** Right-angle square at `foot`, corner aligned with side + altitude. */
  const rightAngle = (foot: Point, vertex: Point, s1: Point, s2: Point): string => {
    const side: Point = { x: s2.x - s1.x, y: s2.y - s1.y };
    const sl = Math.hypot(side.x, side.y) || 1;
    const u: Point = { x: side.x / sl, y: side.y / sl };
    const alt: Point = { x: vertex.x - foot.x, y: vertex.y - foot.y };
    const al = Math.hypot(alt.x, alt.y) || 1;
    const v: Point = { x: alt.x / al, y: alt.y / al };
    const s = 0.22;
    const p1 = { x: foot.x + u.x * s, y: foot.y + u.y * s };
    const p2 = { x: foot.x + (u.x + v.x) * s, y: foot.y + (u.y + v.y) * s };
    const p3 = { x: foot.x + v.x * s, y: foot.y + v.y * s };
    return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
  };

  /* ---------- variant center + labels ---------- */
  const center: { p: Point; text: string } =
    construction === "incircle"
      ? { p: I, text: "I" }
      : construction === "medians"
        ? { p: G, text: "G" }
        : construction === "altitudes"
          ? { p: H, text: "H" }
          : { p: O, text: "O" };

  const labels: Array<{ p: Point; text: string; dx: number; dy: number }> = [
    { p: A, text: "A", dx: 0.22, dy: -0.18 },
    { p: B, text: "B", dx: -0.42, dy: 0.1 },
    { p: C, text: "C", dx: 0.28, dy: 0.1 },
    { p: center.p, text: center.text, dx: 0.2, dy: -0.14 },
  ];

  const ariaLabels: Record<ConstructionVariant, string> = {
    circumcircle: "Triangle ABC with circumcircle centered at O",
    incircle: "Triangle ABC with incircle centered at I",
    medians: "Triangle ABC with medians meeting at centroid G",
    altitudes: "Triangle ABC with altitudes meeting at orthocenter H",
  };

  /* ================= figure elements (Scene 2 switcher) ================= */

  const { rectangle: rect, pentagon: pent, ellipse: ell, homothety: hom } =
    figureGeometry;

  /* Rectangle: axis-aligned from diagonal A–C; tiny right-angle square
     at the computed corner rect.B (edges point toward A and C). */
  const rsx = Math.sign(C.x - A.x) || 1;
  const rsy = Math.sign(C.y - A.y) || 1;
  const rs = 0.22;
  const rectAngle = `${rect.B.x - rsx * rs},${rect.B.y} ${rect.B.x - rsx * rs},${
    rect.B.y + rsy * rs
  } ${rect.B.x},${rect.B.y + rsy * rs}`;

  /* Pentagon: defining radius + construction circle. */
  const pentR = distance(pent.O, A);

  /* Ellipse: axis unit vectors from the foci line. */
  const eRad = (ell.angleDeg * Math.PI) / 180;
  const eux = Math.cos(eRad);
  const euy = Math.sin(eRad);
  const ellMajor = {
    x1: ell.center.x - eux * ell.rx * 1.12,
    y1: ell.center.y - euy * ell.rx * 1.12,
    x2: ell.center.x + eux * ell.rx * 1.12,
    y2: ell.center.y + euy * ell.rx * 1.12,
  };
  const ellMinor = {
    x1: ell.center.x + euy * ell.ry * 1.18,
    y1: ell.center.y - eux * ell.ry * 1.18,
    x2: ell.center.x - euy * ell.ry * 1.18,
    y2: ell.center.y + eux * ell.ry * 1.18,
  };

  /* Homothety: rays from O through each vertex to its ghost image. */
  const homRays = [
    { x1: hom.O.x, y1: hom.O.y, x2: hom.ghostA.x, y2: hom.ghostA.y },
    { x1: hom.O.x, y1: hom.O.y, x2: hom.ghostB.x, y2: hom.ghostB.y },
    { x1: hom.O.x, y1: hom.O.y, x2: hom.ghostC.x, y2: hom.ghostC.y },
  ];

  const figureLabels: Record<
    Exclude<ConstructionFigure, "circumcircle">,
    Array<{ p: Point; text: string; dx: number; dy: number }>
  > = {
    rectangle: [
      { p: A, text: "A", dx: 0.22, dy: -0.18 },
      { p: rect.B, text: "B", dx: 0.24, dy: -0.16 },
      { p: C, text: "C", dx: 0.26, dy: 0.34 },
      { p: rect.D, text: "D", dx: -0.46, dy: 0.34 },
    ],
    pentagon: [
      { p: A, text: "A", dx: 0.22, dy: -0.18 },
      { p: pent.O, text: "O", dx: 0.2, dy: -0.14 },
    ],
    ellipse: [
      { p: ell.F1, text: "F1", dx: 0.22, dy: -0.18 },
      { p: ell.F2, text: "F2", dx: 0.24, dy: 0.36 },
    ],
    homothety: [
      { p: A, text: "A", dx: 0.22, dy: -0.18 },
      { p: B, text: "B", dx: -0.42, dy: 0.1 },
      { p: C, text: "C", dx: 0.28, dy: 0.1 },
      { p: hom.O, text: "O", dx: 0.2, dy: -0.14 },
      { p: hom.ghostA, text: "A′", dx: 0.22, dy: -0.18 },
      { p: hom.ghostB, text: "B′", dx: -0.52, dy: 0.1 },
      { p: hom.ghostC, text: "C′", dx: 0.28, dy: 0.1 },
    ],
  };

  const figureAria: Record<Exclude<ConstructionFigure, "circumcircle">, string> = {
    rectangle: "Rectangle ABCD constructed from diagonal A to C",
    pentagon: "Regular pentagon from center O through vertex A",
    ellipse: "Ellipse with foci F1 and F2",
    homothety: "Triangle ABC with dilated ghost triangle at ratio 1.5 about O",
  };

  const activeLabels = figure === "circumcircle" ? labels : figureLabels[figure];
  const ariaLabel =
    figure === "circumcircle" ? ariaLabels[construction] : figureAria[figure];

  return (
    <svg
      ref={svgRef}
      className={[
        "geometry-canvas",
        `geometry-canvas--${variant}`,
        `geometry-canvas--${construction}`,
        figure !== "circumcircle" ? `geometry-canvas--${figure}` : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      {/* ============ construction underlay ============ */}

      {figure === "circumcircle" && construction === "circumcircle" && (
        <>
          {/* faint auxiliary circle (half-radius, concentric) */}
          {isHero && (
            <circle
              cx={O.x}
              cy={O.y}
              r={r * 0.5}
              fill="none"
              {...faint}
              strokeDasharray="2 5"
            />
          )}
          {/* construction rays */}
          <line {...rayB} {...faint} />
          <line {...rayC} {...faint} />
          {/* faint dashed perpendicular bisector from O through mid BC */}
          <line {...bisector} {...faint} strokeDasharray="2 5" />
          {/* circumcircle */}
          <circle
            cx={O.x}
            cy={O.y}
            r={r}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
        </>
      )}

      {figure === "circumcircle" && construction === "incircle" && (
        <>
          {/* angle bisector rays from A and B through I */}
          <line {...bisA} {...faint} strokeDasharray="2 4" />
          <line {...bisB} {...faint} strokeDasharray="2 4" />
          {/* incircle */}
          <circle
            cx={I.x}
            cy={I.y}
            r={inradius}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
        </>
      )}

      {figure === "circumcircle" &&
        construction === "medians" &&
        medians.map((m, i) => <line key={i} {...m} {...faint} />)}

      {figure === "circumcircle" &&
        construction === "altitudes" &&
        altitudes.map((a, i) => (
          <line key={i} {...a} {...faint} strokeDasharray="2 4" />
        ))}

      {/* ---------- figure underlays (Scene 2 switcher) ---------- */}

      {figure === "rectangle" && (
        <>
          {/* the construction input: diagonal A–C */}
          <line x1={A.x} y1={A.y} x2={C.x} y2={C.y} {...faint} strokeDasharray="2 5" />
          {/* rectangle Polygon(A, B, C, D) */}
          <polygon
            points={`${A.x},${A.y} ${rect.B.x},${rect.B.y} ${C.x},${C.y} ${rect.D.x},${rect.D.y}`}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
            opacity={0.9}
          />
        </>
      )}

      {figure === "pentagon" && (
        <>
          {/* construction circle through A about O + defining radius */}
          <circle
            cx={pent.O.x}
            cy={pent.O.y}
            r={pentR}
            fill="none"
            {...faint}
            strokeDasharray="2 5"
          />
          <line x1={pent.O.x} y1={pent.O.y} x2={A.x} y2={A.y} {...faint} />
          {/* regular pentagon Polygon(O, A, 5) */}
          <polygon
            points={pent.vertices.map((v) => `${v.x},${v.y}`).join(" ")}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
            opacity={0.9}
          />
        </>
      )}

      {figure === "ellipse" && (
        <>
          {/* major axis through the foci + faint dashed minor axis */}
          <line {...ellMajor} {...faint} />
          <line {...ellMinor} {...faint} strokeDasharray="2 5" />
          {/* Ellipse(F1, F2, 3) — rotated about its center */}
          <g transform={`rotate(${ell.angleDeg} ${ell.center.x} ${ell.center.y})`}>
            <ellipse
              cx={ell.center.x}
              cy={ell.center.y}
              rx={ell.rx}
              ry={ell.ry}
              fill="none"
              stroke="var(--paper)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.9}
            />
          </g>
        </>
      )}

      {figure === "homothety" && (
        <>
          {/* projection rays O → A′B′C′ through the vertices */}
          {homRays.map((l, i) => (
            <line key={i} {...l} {...faint} strokeDasharray="2 5" />
          ))}
          {/* source triangle */}
          <polygon
            points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
          />
          {/* ghost image: Dilate(·, 1.5, O) */}
          <polygon
            points={`${hom.ghostA.x},${hom.ghostA.y} ${hom.ghostB.x},${hom.ghostB.y} ${hom.ghostC.x},${hom.ghostC.y}`}
            fill="none"
            stroke="var(--soft)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
            strokeDasharray="3 3"
            opacity={0.85}
          />
        </>
      )}

      {/* ============ triangle (always, circumcircle family only) ============ */}
      {figure === "circumcircle" && (
        <polygon
          points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`}
          fill="none"
          stroke="var(--paper)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="miter"
        />
      )}

      {/* ============ constraint / tick / right-angle marks ============ */}

      {figure === "circumcircle" && construction === "circumcircle" && (
        <>
          {/* constraint tick marks at midpoints of BC and CA */}
          <line
            x1={midBC.x - normalBC.x}
            y1={midBC.y - normalBC.y}
            x2={midBC.x + normalBC.x}
            y2={midBC.y + normalBC.y}
            {...strong}
          />
          <line
            x1={midCA.x - normalCA.x}
            y1={midCA.y - normalCA.y}
            x2={midCA.x + normalCA.x}
            y2={midCA.y + normalCA.y}
            {...strong}
          />
        </>
      )}

      {figure === "circumcircle" &&
        construction === "incircle" &&
        touchTicks.map(({ p, along }, i) => {
          const n = tickNotch(p, along, 0.14);
          return (
            <line
              key={i}
              x1={p.x - n.x}
              y1={p.y - n.y}
              x2={p.x + n.x}
              y2={p.y + n.y}
              {...strong}
            />
          );
        })}

      {figure === "circumcircle" &&
        construction === "medians" &&
        midTicks.map(({ p, along }, i) => {
          const n = tickNotch(p, along);
          return (
            <line
              key={i}
              x1={p.x - n.x}
              y1={p.y - n.y}
              x2={p.x + n.x}
              y2={p.y + n.y}
              {...strong}
            />
          );
        })}

      {figure === "circumcircle" && construction === "altitudes" && (
        <>
          <polyline points={rightAngle(footA, A, B, C)} fill="none" {...strong} />
          <polyline points={rightAngle(footB, B, C, A)} fill="none" {...strong} />
          <polyline points={rightAngle(footC, C, A, B)} fill="none" {...strong} />
        </>
      )}

      {/* tiny right-angle square at the rectangle's computed corner B */}
      {figure === "rectangle" && (
        <polyline points={rectAngle} fill="none" {...strong} />
      )}

      {/* ============ center marks + vertices + draggable handles ============ */}

      {figure === "circumcircle" && (
        <>
          {/* center mark (O / I / G / H) */}
          <circle cx={center.p.x} cy={center.p.y} r={0.045} fill="var(--soft)" />

          {/* fixed vertices */}
          <circle cx={B.x} cy={B.y} r={0.055} fill="var(--paper)" />
          <circle cx={C.x} cy={C.y} r={0.055} fill="var(--paper)" />

          {/* draggable point A */}
          {renderHandle("A", A, setA, "A")}
        </>
      )}

      {figure === "rectangle" && (
        <>
          {/* computed corners */}
          <circle cx={rect.B.x} cy={rect.B.y} r={0.045} fill="var(--soft)" />
          <circle cx={rect.D.x} cy={rect.D.y} r={0.045} fill="var(--soft)" />
          {/* diagonal endpoints — both draggable */}
          {renderHandle("A", A, setA, "A")}
          {renderHandle("C", C, setC, "C")}
        </>
      )}

      {figure === "pentagon" && (
        <>
          {/* center + the four derived vertices */}
          <circle cx={pent.O.x} cy={pent.O.y} r={0.045} fill="var(--soft)" />
          {pent.vertices.slice(1).map((v, i) => (
            <circle key={i} cx={v.x} cy={v.y} r={0.04} fill="var(--soft)" />
          ))}
          {/* draggable defining vertex A */}
          {renderHandle("A", A, setA, "A")}
        </>
      )}

      {figure === "ellipse" && (
        <>
          {/* fixed focus F2 */}
          <circle cx={ell.F2.x} cy={ell.F2.y} r={0.055} fill="var(--paper)" />
          {/* draggable focus F1 (= A) */}
          {renderHandle("A", A, setA, "F1")}
        </>
      )}

      {figure === "homothety" && (
        <>
          {/* homothety center */}
          <circle cx={hom.O.x} cy={hom.O.y} r={0.045} fill="var(--soft)" />
          {/* fixed source vertices */}
          <circle cx={B.x} cy={B.y} r={0.055} fill="var(--paper)" />
          <circle cx={C.x} cy={C.y} r={0.055} fill="var(--paper)" />
          {/* ghost vertices */}
          <circle cx={hom.ghostA.x} cy={hom.ghostA.y} r={0.04} fill="var(--soft)" />
          <circle cx={hom.ghostB.x} cy={hom.ghostB.y} r={0.04} fill="var(--soft)" />
          <circle cx={hom.ghostC.x} cy={hom.ghostC.y} r={0.04} fill="var(--soft)" />
          {/* draggable point A — the ghost follows */}
          {renderHandle("A", A, setA, "A")}
        </>
      )}

      {/* editorial labels */}
      {activeLabels.map(({ p, text, dx, dy }) => (
        <text
          key={text}
          x={p.x + dx}
          y={p.y + dy}
          fontSize={labelFontSize}
          fill="var(--mist)"
          fontFamily="var(--font-sans)"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {text}
        </text>
      ))}
    </svg>
  );
}

export default GeometryCanvas;
