import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ============================================================
   GeometryContext — the living triangle A/B/C + constructions.
   Coordinates live in a normalized SVG viewBox space: 0..10.

   Construction variants (Geometry_Expansion):
     'circumcircle' — triangle + circumcircle + O   (default, original)
     'incircle'     — triangle + incircle + I
     'medians'      — triangle + three medians + G
     'altitudes'    — triangle + three altitudes + H
   All variants derive from the same draggable A/B/C.

   Switchable figures (Scene 2 figure switcher):
     'circumcircle' — the classic triangle + Circle(A, B, C)
     'rectangle'    — Polygon(A, B, C, D) from diagonal A–C (drag A or C)
     'pentagon'     — Polygon(O, A, 5) regular, drag A rotates/scales
     'ellipse'      — Ellipse(F1, F2, 3), drag F1 (= A)
     'homothety'    — A' = Dilate(A, 1.5, O) ghost triangle, drag A
   Figures derive from the same handle set: A (always draggable) and
   C (also draggable for the rectangle). Source lines use REAL
   GeoGebra commands only.
   ============================================================ */

export interface Point {
  x: number;
  y: number;
}

export type ConstructionVariant =
  | "circumcircle"
  | "incircle"
  | "medians"
  | "altitudes";

/* ---------- Switchable constructions (Scene 2 figure switcher) ----------
   Five real GeoGebra-syntax constructions, all driven by the SAME
   small handle set (A always draggable, C also draggable for the
   rectangle). 'circumcircle' keeps the classic triangle behavior. */

export type ConstructionFigure =
  | "circumcircle"
  | "rectangle"
  | "pentagon"
  | "ellipse"
  | "homothety";

/** Rectangle from diagonal A–C (axis-aligned): B and D are computed. */
export interface RectangleGeometry {
  B: Point; // computed corner, (C.x, A.y)
  D: Point; // computed corner, (A.x, C.y)
}

/** Regular pentagon from center O + draggable vertex A (rotates/scales). */
export interface PentagonGeometry {
  O: Point;
  vertices: Point[]; // 5 vertices; vertices[0] === A
}

/** Ellipse from foci F1 (= A, draggable) / F2 (fixed) + semi-axis a. */
export interface EllipseGeometry {
  F1: Point;
  F2: Point;
  center: Point;
  /** Major-axis rotation, degrees (for an SVG rotate transform). */
  angleDeg: number;
  rx: number; // semi-major = a
  ry: number; // semi-minor = sqrt(a² − c²), floored for degenerate drags
}

/** Homothety: triangle ABC + center O + ghost image at ratio 1.5. */
export interface HomothetyGeometry {
  O: Point;
  ratio: number;
  ghostA: Point;
  ghostB: Point;
  ghostC: Point;
}

/** Per-figure derived landmarks, recomputed from A/C every render. */
export interface FigureGeometry {
  rectangle: RectangleGeometry;
  pentagon: PentagonGeometry;
  ellipse: EllipseGeometry;
  homothety: HomothetyGeometry;
}

/** Derived landmarks, recomputed from A/B/C every render. */
export interface DerivedGeometry {
  circumcenter: Point; // O
  incenter: Point; // I
  centroid: Point; // G
  orthocenter: Point; // H
  midAB: Point;
  midBC: Point;
  midCA: Point;
  inradius: number;
}

export interface GeometryState {
  A: Point;
  B: Point;
  C: Point;
  setA: (p: Point) => void;
  /** Drags the second free point (rectangle's diagonal end C). */
  setC: (p: Point) => void;
  circumcenter: Point; // derived, O
  circumradius: number;
  sourceLines: string[];
  lastTransaction: string | null;
  construction: ConstructionVariant;
  setConstruction: (c: ConstructionVariant) => void;
  derived: DerivedGeometry;
  /** Active switchable construction (Scene 2 figure switcher). */
  figure: ConstructionFigure;
  setFigure: (f: ConstructionFigure) => void;
  /** Derived landmarks for every non-circumcircle figure. */
  figureGeometry: FigureGeometry;
}

const DEFAULT_A: Point = { x: 5.1, y: 1.9 };
const DEFAULT_B: Point = { x: 2.1, y: 7.5 };
const DEFAULT_C: Point = { x: 7.9, y: 7.3 };
const DEFAULT_CONSTRUCTION: ConstructionVariant = "circumcircle";
const DEFAULT_FIGURE: ConstructionFigure = "circumcircle";

/* Fixed anchors for the switchable figures (only A — and C for the
   rectangle — are draggable; everything else derives). */
const PENTAGON_CENTER: Point = { x: 5.0, y: 5.3 };
const ELLIPSE_F2: Point = { x: 6.8, y: 5.6 };
const ELLIPSE_SEMI_AXIS = 3;
const HOMOTHETY_CENTER: Point = { x: 5.0, y: 5.0 };
const HOMOTHETY_RATIO = 1.5;

/** Clamp a point inside the 0..10 space with a small margin. */
function clampPoint(p: Point): Point {
  const m = 0.35;
  return {
    x: Math.min(10 - m, Math.max(m, p.x)),
    y: Math.min(10 - m, Math.max(m, p.y)),
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function cross(u: Point, v: Point): number {
  return u.x * v.y - u.y * v.x;
}

/** Circumcenter of triangle a-b-c. Falls back to centroid if degenerate. */
export function circumcenterOf(a: Point, b: Point, c: Point): Point {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) {
    return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

export function distance(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function midpointOf(p: Point, q: Point): Point {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

export function centroidOf(a: Point, b: Point, c: Point): Point {
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

/** Incenter of triangle a-b-c (side-length weighted). Falls back to centroid. */
export function incenterOf(a: Point, b: Point, c: Point): Point {
  const wa = distance(b, c); // side opposite A
  const wb = distance(c, a); // side opposite B
  const wc = distance(a, b); // side opposite C
  const p = wa + wb + wc;
  if (p < 1e-9) return centroidOf(a, b, c);
  return {
    x: (wa * a.x + wb * b.x + wc * c.x) / p,
    y: (wa * a.y + wb * b.y + wc * c.y) / p,
  };
}

/** Inradius of triangle a-b-c: 2·area / perimeter. */
export function inradiusOf(a: Point, b: Point, c: Point): number {
  const wa = distance(b, c);
  const wb = distance(c, a);
  const wc = distance(a, b);
  const p = wa + wb + wc;
  if (p < 1e-9) return 0;
  const twoArea = Math.abs(cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - a.x, y: c.y - a.y }));
  return twoArea / p;
}

/** Orthocenter of triangle a-b-c via altitude intersection. Falls back to centroid. */
export function orthocenterOf(a: Point, b: Point, c: Point): Point {
  // altitude from A: through A, perpendicular to BC
  const dBC: Point = { x: c.x - b.x, y: c.y - b.y };
  const r1: Point = { x: -dBC.y, y: dBC.x };
  // altitude from B: through B, perpendicular to CA
  const dCA: Point = { x: a.x - c.x, y: a.y - c.y };
  const r2: Point = { x: -dCA.y, y: dCA.x };
  const den = cross(r1, r2);
  if (Math.abs(den) < 1e-9) return centroidOf(a, b, c);
  const t = cross({ x: b.x - a.x, y: b.y - a.y }, r2) / den;
  return { x: a.x + t * r1.x, y: a.y + t * r1.y };
}

/** Orthogonal projection of p onto the line through l1-l2. */
export function projectToLine(p: Point, l1: Point, l2: Point): Point {
  const d: Point = { x: l2.x - l1.x, y: l2.y - l1.y };
  const dd = d.x * d.x + d.y * d.y;
  if (dd < 1e-12) return { x: l1.x, y: l1.y };
  const t = ((p.x - l1.x) * d.x + (p.y - l1.y) * d.y) / dd;
  return { x: l1.x + t * d.x, y: l1.y + t * d.y };
}

/** Homothety image of p under Dilate(p, ratio, center). */
export function dilate(p: Point, ratio: number, center: Point): Point {
  return {
    x: center.x + (p.x - center.x) * ratio,
    y: center.y + (p.y - center.y) * ratio,
  };
}

/** Vertices of the regular n-gon with given center through `vertex`
    (GeoGebra Polygon(O, A, n)); vertices[0] === vertex. */
export function regularPolygonVertices(
  center: Point,
  vertex: Point,
  n: number,
): Point[] {
  const r = distance(center, vertex);
  const a0 = Math.atan2(vertex.y - center.y, vertex.x - center.x);
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i * 2 * Math.PI) / n;
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
  });
}

/**
 * Pseudo-source for the current construction.
 * 'circumcircle' (default) yields the original three lines — with the
 * real GeoGebra command `c = Circle(A, B, C)` (no such command as
 * `circumcircle(...)` exists in GeoGebra).
 */
export function buildSourceLines(
  a: Point,
  construction: ConstructionVariant = "circumcircle",
): string[] {
  const base = ["triangle(A, B, C)", `A = point(${fmt(a.x)}, ${fmt(a.y)})`];
  switch (construction) {
    case "incircle":
      return [...base, "incircle(A, B, C)", "I = incenter(A, B, C)"];
    case "medians":
      return [
        ...base,
        "median(A, BC)",
        "median(B, CA)",
        "centroid G = median ∩ median",
      ];
    case "altitudes":
      return [
        ...base,
        "altitude(A, BC)",
        "altitude(B, CA)",
        "H = orthocenter(A, B, C)",
      ];
    case "circumcircle":
    default:
      return [...base, "c = Circle(A, B, C)"];
  }
}

/**
 * Source for the switchable Scene-2 figures — REAL GeoGebra syntax only.
 * Every figure returns exactly three lines; index 1 is always the live
 * coordinate line of the primary draggable handle (consumed by the
 * source-flash emphasis and by downstream scenes).
 */
export function buildFigureSourceLines(
  figure: ConstructionFigure,
  a: Point,
  c: Point = DEFAULT_C,
): string[] {
  switch (figure) {
    case "rectangle":
      return [
        `C = point(${fmt(c.x)}, ${fmt(c.y)})`,
        `A = point(${fmt(a.x)}, ${fmt(a.y)})`,
        "poly = Polygon(A, B, C, D)",
      ];
    case "pentagon":
      return [
        `O = point(${fmt(PENTAGON_CENTER.x)}, ${fmt(PENTAGON_CENTER.y)})`,
        `A = point(${fmt(a.x)}, ${fmt(a.y)})`,
        "p5 = Polygon(O, A, 5)",
      ];
    case "ellipse":
      return [
        `F2 = point(${fmt(ELLIPSE_F2.x)}, ${fmt(ELLIPSE_F2.y)})`,
        `F1 = point(${fmt(a.x)}, ${fmt(a.y)})`,
        `e = Ellipse(F1, F2, ${ELLIPSE_SEMI_AXIS})`,
      ];
    case "homothety":
      return [
        "triangle(A, B, C)",
        `A = point(${fmt(a.x)}, ${fmt(a.y)})`,
        `A' = Dilate(A, ${HOMOTHETY_RATIO}, O)`,
      ];
    case "circumcircle":
    default:
      return buildSourceLines(a, "circumcircle");
  }
}

const GeometryContext = createContext<GeometryState | null>(null);

export function GeometryProvider({ children }: { children: ReactNode }) {
  const [A, setAState] = useState<Point>(DEFAULT_A);
  const [C, setCState] = useState<Point>(DEFAULT_C);
  const [construction, setConstructionState] =
    useState<ConstructionVariant>(DEFAULT_CONSTRUCTION);
  const [figure, setFigureState] =
    useState<ConstructionFigure>(DEFAULT_FIGURE);
  const [lastTransaction, setLastTransaction] = useState<string | null>(null);
  const txTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashTransaction = useCallback((label: string) => {
    setLastTransaction(label);
    if (txTimer.current) clearTimeout(txTimer.current);
    txTimer.current = setTimeout(() => setLastTransaction(null), 1200);
  }, []);

  const setA = useCallback(
    (p: Point) => {
      setAState(clampPoint(p));
      flashTransaction("Δ A");
    },
    [flashTransaction],
  );

  const setC = useCallback(
    (p: Point) => {
      setCState(clampPoint(p));
      flashTransaction("Δ C");
    },
    [flashTransaction],
  );

  const setConstruction = useCallback((c: ConstructionVariant) => {
    setConstructionState(c);
  }, []);

  const setFigure = useCallback((f: ConstructionFigure) => {
    setFigureState(f);
  }, []);

  const value = useMemo<GeometryState>(() => {
    const B = DEFAULT_B;
    const O = circumcenterOf(A, B, C);
    const derived: DerivedGeometry = {
      circumcenter: O,
      incenter: incenterOf(A, B, C),
      centroid: centroidOf(A, B, C),
      orthocenter: orthocenterOf(A, B, C),
      midAB: midpointOf(A, B),
      midBC: midpointOf(B, C),
      midCA: midpointOf(C, A),
      inradius: inradiusOf(A, B, C),
    };
    /* Semi-focal distance for the ellipse (semi-axis a stays fixed). */
    const cHalf = distance(A, ELLIPSE_F2) / 2;
    const figureGeometry: FigureGeometry = {
      rectangle: {
        B: { x: C.x, y: A.y },
        D: { x: A.x, y: C.y },
      },
      pentagon: {
        O: PENTAGON_CENTER,
        vertices: regularPolygonVertices(PENTAGON_CENTER, A, 5),
      },
      ellipse: {
        F1: A,
        F2: ELLIPSE_F2,
        center: midpointOf(A, ELLIPSE_F2),
        angleDeg:
          (Math.atan2(ELLIPSE_F2.y - A.y, ELLIPSE_F2.x - A.x) * 180) / Math.PI,
        rx: ELLIPSE_SEMI_AXIS,
        ry: Math.sqrt(
          Math.max(ELLIPSE_SEMI_AXIS * ELLIPSE_SEMI_AXIS - cHalf * cHalf, 0.12),
        ),
      },
      homothety: {
        O: HOMOTHETY_CENTER,
        ratio: HOMOTHETY_RATIO,
        ghostA: dilate(A, HOMOTHETY_RATIO, HOMOTHETY_CENTER),
        ghostB: dilate(B, HOMOTHETY_RATIO, HOMOTHETY_CENTER),
        ghostC: dilate(C, HOMOTHETY_RATIO, HOMOTHETY_CENTER),
      },
    };
    return {
      A,
      B,
      C,
      setA,
      setC,
      circumcenter: O,
      circumradius: distance(O, A),
      sourceLines:
        figure === "circumcircle"
          ? buildSourceLines(A, construction)
          : buildFigureSourceLines(figure, A, C),
      lastTransaction,
      construction,
      setConstruction,
      derived,
      figure,
      setFigure,
      figureGeometry,
    };
  }, [A, C, setA, setC, lastTransaction, construction, setConstruction, figure, setFigure]);

  return (
    <GeometryContext.Provider value={value}>
      {children}
    </GeometryContext.Provider>
  );
}

export function useGeometry(): GeometryState {
  const ctx = useContext(GeometryContext);
  if (!ctx) {
    throw new Error("useGeometry must be used inside <GeometryProvider>");
  }
  return ctx;
}
