// GeoGebra construction → TikZ ("Magic!" export).
//
// Pure, deterministic, unit-testable: takes a serialisable snapshot of the live
// applet's construction (read in components/math-studio.tsx via the
// applet JS API) and emits LaTeX in one of two styles the customer actually uses
// (distilled in docs/tikz-euclide-export.md):
//
//   'tkz' — tkz-euclide construction macros (the house style). Recognised GGB
//           commands map ~1:1 to \tkzDef…/\tkzInter…/\tkzDraw…; anything we can't
//           map falls back to a numeric \tkzDefPoint(x,y){Name} (always valid).
//   'raw' — absolute-coordinate \draw/\fill, mimicking GeoGebra's own
//           "Export → PGF/TikZ" output (colours, scriptsize dot+label).
//
// Hard rules learned from compile failures in the field:
//   · PGF node names must never contain braces — `A_{1}` breaks \csname lookups.
//     Node ids use nodeName() (brace-free); display text uses labelTex().
//   · Derived lines (PerpendicularLine / ParallelLine / AngleBisector /
//     PerpendicularBisector / Line(P,l)) are registered symbolically via
//     \tkzDefLine aux points so dependent intersections, reflections and the
//     lines themselves stay exact instead of falling back to coordinates.
//   · Every fallback is counted and named in the note so "approximate" output
//     is visible instead of silent.

export type TikzMode = 'tkz' | 'raw';

export interface GgbObject {
  name: string;
  /** getObjectType(): 'point' | 'segment' | 'line' | 'ray' | 'vector' | 'conic' | 'polygon' | 'numeric' | … */
  type: string;
  /** getCommandString() — the defining command, '' for free objects. */
  command: string;
  visible: boolean;
  /** point coords (getXcoord/getYcoord). */
  x?: number;
  y?: number;
  /** hex colour '#RRGGBB' (getColor), used by raw mode only. */
  color?: string;
  /** getLineThickness(). */
  thickness?: number;
  /** getLineStyle() !== 0. */
  dashed?: boolean;
  /** SetCaption text — the intended display label (defaults to the name). */
  caption?: string;
  /** ShowLabel(obj,false) → false; controls whether the point is labelled. */
  labelVisible?: boolean;
}

export interface TikzExportResult {
  code: string;
  /** short human note for the UI, e.g. "12 个对象 · 2 个回退为坐标". */
  note: string;
}

// ── small helpers ───────────────────────────────────────────────────────────

/** Round to ≤4 dp, drop trailing zeros, normalise -0. */
function fmt(n: number | undefined): string {
  if (n == null || !isFinite(n)) return '0';
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * PGF node id for a GGB label. Node names live inside \csname — braces or
 * backslashes there are a guaranteed compile error, so strip everything but
 * letters, digits, underscore and prime. `A_{12}` → `A_12`, `P'` → `P'`.
 */
export function nodeName(name: string): string {
  const clean = name.replace(/[{}]/g, '').replace(/[^A-Za-z0-9_']/g, '');
  return clean || 'P';
}

/** Display math for a label: brace multi-char subscripts. `A_12` → `A_{12}`. */
export function labelTex(name: string): string {
  return name.replace(/[{}]/g, '').replace(/_([A-Za-z0-9]+)/g, '_{$1}');
}

/** True when \tkzLabelPoints would already typeset the node id correctly
 *  (i.e. no multi-char subscript that needs braces). */
function labelMatchesNode(name: string): boolean {
  const n = nodeName(name);
  return labelTex(name) === n || !/_[A-Za-z0-9]{2,}/.test(n);
}

interface ParsedCommand { fn: string; args: string[] }

export function splitTopLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseCommand(cmd: string): ParsedCommand | null {
  let c = cmd.trim();
  // some bundles return "Label = Command(...)"; keep only the command.
  const assign = c.match(/^[A-Za-z_][\w']*\s*=\s*([\s\S]+)$/);
  if (assign && assign[1].includes('(')) c = assign[1].trim();
  const m = c.match(/^([A-Za-z]+)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  return { fn: m[1], args: splitTopLevelArgs(m[2]) };
}

function isNumberLiteral(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s.trim());
}

/** GGB angle literal → degrees: `45°`, `45deg`, `0.7853981…` (radians), `pi/4`. */
export function angleToDegrees(s: string): number | null {
  const t = s.trim();
  const deg = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:°|deg)$/i);
  if (deg) return parseFloat(deg[1]);
  if (isNumberLiteral(t)) {
    // bare number from getCommandString is radians
    return (parseFloat(t) * 180) / Math.PI;
  }
  const pi = t.match(/^(-?)(?:(\d+(?:\.\d+)?)\s*\*?\s*)?(?:pi|π)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/i);
  if (pi) {
    const sign = pi[1] === '-' ? -1 : 1;
    const num = pi[2] ? parseFloat(pi[2]) : 1;
    const den = pi[3] ? parseFloat(pi[3]) : 1;
    return (sign * num * 180) / den;
  }
  return null;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Circumcentre + radius of three points (NaN-safe; collinear → r=0). */
function circumcircle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number; r: number } {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return { x: a.x, y: a.y, r: 0 };
  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  return { x: ux, y: uy, r: Math.hypot(a.x - ux, a.y - uy) };
}

/** Incircle of three points (centre = weighted vertex mean, r = area/s). */
function incircle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number; r: number } {
  const la = dist(b, c); const lb = dist(a, c); const lc = dist(a, b);
  const p = la + lb + lc;
  if (p < 1e-12) return { x: a.x, y: a.y, r: 0 };
  const x = (la * a.x + lb * b.x + lc * c.x) / p;
  const y = (la * a.y + lb * b.y + lc * c.y) / p;
  const s = p / 2;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return { x, y, r: area / s };
}

// ── construction index ──────────────────────────────────────────────────────

interface ConicInfo {
  center?: string;        // centre point name
  through?: string;       // a point on the circle
  radiusNum?: number;     // explicit numeric radius
  pts3?: [string, string, string];
  kind?: 'circum' | 'in'; // 3-point circles: circumscribed vs inscribed
  cx?: number; cy?: number; r?: number;   // resolved numeric geometry
}

/** A derived line, expressible as a tkz-euclide \tkzDefLine construction. */
interface DerivedLine {
  kind: 'perpendicular' | 'parallel' | 'mediator' | 'bisector';
  /** through-point (perpendicular/parallel), or vertex B (bisector). */
  anchor?: string;
  /** base segment points (perpendicular/parallel/mediator) or A,B,C (bisector). */
  base: string[];
  /** derived-on-derived: the base is itself a named (possibly derived) line,
   *  resolved recursively when the line is materialised. */
  baseLine?: string;
}

/** A circular arc: Semicircle(A,B) · CircularArc(C,A,B) · CircumcircularArc(A,B,C). */
interface ArcInfo {
  kind: 'semi' | 'central' | 'circum';
  /** semi=[A,B] · central=[C,A,B] · circum=[A,B,C] */
  p: string[];
  cx: number; cy: number; r: number;
  /** circum arcs: triangle orientation decides the sweep direction */
  ccw: boolean;
}

interface Index {
  pts: Map<string, { x: number; y: number }>;
  linePts: Map<string, [string, string]>;  // line/segment/ray → its 2 defining points
  derived: Map<string, DerivedLine>;       // lines that need a \tkzDefLine first
  vectors: Map<string, [string, string]>;  // vector name → (from, to)
  conics: Map<string, ConicInfo>;
  arcs: Map<string, ArcInfo>;
}

function buildIndex(objects: GgbObject[]): Index {
  const pts = new Map<string, { x: number; y: number }>();
  for (const o of objects) {
    if (o.type === 'point' && o.x != null && o.y != null) pts.set(o.name, { x: o.x, y: o.y });
  }

  const linePts = new Map<string, [string, string]>();
  const derived = new Map<string, DerivedLine>();
  const vectors = new Map<string, [string, string]>();
  const conics = new Map<string, ConicInfo>();
  const arcs = new Map<string, ArcInfo>();

  /** Resolve a line argument to its 2 base points: named simple line, inline
   *  Line/Segment/Ray(P,Q), or a previously registered derived line's pair is
   *  NOT available at index time — derived-on-derived stays unresolved. */
  const baseOf = (arg: string): [string, string] | null => {
    const named = linePts.get(arg);
    if (named) return named;
    const p = parseCommand(arg);
    if (p && (p.fn === 'Line' || p.fn === 'Segment' || p.fn === 'Ray')
      && p.args.length >= 2 && pts.has(p.args[0]) && pts.has(p.args[1])) {
      return [p.args[0], p.args[1]];
    }
    return null;
  };

  for (const o of objects) {
    const parsed = parseCommand(o.command);
    if (!parsed) continue;
    const { fn, args } = parsed;
    const isLineType = o.type === 'line' || o.type === 'segment' || o.type === 'ray';

    if ((fn === 'Line' || fn === 'Segment' || fn === 'Ray') && args.length >= 2
      && pts.has(args[0]) && pts.has(args[1])) {
      linePts.set(o.name, [args[0], args[1]]);
    } else if (fn === 'Line' && args.length === 2 && pts.has(args[0]) && isLineType) {
      // Line(P, l) = parallel to l through P.
      const base = baseOf(args[1]);
      if (base) derived.set(o.name, { kind: 'parallel', anchor: args[0], base });
      else if (derived.has(args[1])) derived.set(o.name, { kind: 'parallel', anchor: args[0], base: [], baseLine: args[1] });
    } else if ((fn === 'PerpendicularLine' || fn === 'OrthogonalLine')
      && args.length >= 2 && pts.has(args[0])) {
      const base = baseOf(args[1]);
      if (base) derived.set(o.name, { kind: 'perpendicular', anchor: args[0], base });
      else if (derived.has(args[1])) derived.set(o.name, { kind: 'perpendicular', anchor: args[0], base: [], baseLine: args[1] });
    } else if ((fn === 'PerpendicularBisector' || fn === 'LineBisector') && args.length === 2
      && pts.has(args[0]) && pts.has(args[1])) {
      derived.set(o.name, { kind: 'mediator', base: [args[0], args[1]] });
    } else if (fn === 'AngleBisector' && args.length === 3 && args.every((a) => pts.has(a))) {
      derived.set(o.name, { kind: 'bisector', anchor: args[1], base: [args[0], args[1], args[2]] });
    } else if (fn === 'Vector' && args.length === 2 && pts.has(args[0]) && pts.has(args[1])) {
      vectors.set(o.name, [args[0], args[1]]);
    } else if (fn === 'Semicircle' && args.length === 2 && args.every((a) => pts.has(a))) {
      const a = pts.get(args[0])!; const b = pts.get(args[1])!;
      arcs.set(o.name, {
        kind: 'semi', p: [args[0], args[1]],
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: dist(a, b) / 2, ccw: true,
      });
    } else if (fn === 'CircularArc' && args.length === 3 && args.every((a) => pts.has(a))) {
      const c = pts.get(args[0])!;
      arcs.set(o.name, {
        kind: 'central', p: [args[0], args[1], args[2]],
        cx: c.x, cy: c.y, r: dist(c, pts.get(args[1])!), ccw: true,
      });
    } else if (fn === 'CircumcircularArc' && args.length === 3 && args.every((a) => pts.has(a))) {
      const [a, b, c] = args.map((n) => pts.get(n)!);
      const cc = circumcircle(a, b, c);
      const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      arcs.set(o.name, {
        kind: 'circum', p: [args[0], args[1], args[2]],
        cx: cc.x, cy: cc.y, r: cc.r, ccw: cross > 0,
      });
    } else if (fn === 'Circle' || fn === 'Circumcircle' || fn === 'Incircle') {
      const info: ConicInfo = {};
      if (fn !== 'Incircle' && args.length === 2 && pts.has(args[0]) && pts.has(args[1])) {
        info.center = args[0]; info.through = args[1];
        const c = pts.get(args[0])!; const t = pts.get(args[1])!;
        info.cx = c.x; info.cy = c.y; info.r = dist(c, t);
      } else if (fn !== 'Incircle' && args.length === 2 && pts.has(args[0]) && isNumberLiteral(args[1])) {
        info.center = args[0]; info.radiusNum = parseFloat(args[1]);
        const c = pts.get(args[0])!; info.cx = c.x; info.cy = c.y; info.r = info.radiusNum;
      } else if (args.length === 3 && args.every((p) => pts.has(p))) {
        info.pts3 = [args[0], args[1], args[2]];
        info.kind = fn === 'Incircle' ? 'in' : 'circum';
        const f = fn === 'Incircle' ? incircle : circumcircle;
        const cc = f(pts.get(args[0])!, pts.get(args[1])!, pts.get(args[2])!);
        info.cx = cc.x; info.cy = cc.y; info.r = cc.r;
      }
      conics.set(o.name, info);
    }
  }
  return { pts, linePts, derived, vectors, conics, arcs };
}

/** A line/segment/ray argument → its 2 defining points (named object OR inline). */
function resolveLineArg(arg: string, idx: Index): [string, string] | null {
  const named = idx.linePts.get(arg);
  if (named) return named;
  const p = parseCommand(arg);
  if (p && (p.fn === 'Line' || p.fn === 'Segment' || p.fn === 'Ray')
    && p.args.length >= 2 && idx.pts.has(p.args[0]) && idx.pts.has(p.args[1])) {
    return [p.args[0], p.args[1]];
  }
  return null;
}

/** A circle argument → its ConicInfo (named object OR inline Circle(...)). */
function resolveConicArg(arg: string, idx: Index): ConicInfo | null {
  const named = idx.conics.get(arg);
  if (named) return named;
  const p = parseCommand(arg);
  if (p && p.fn === 'Circle' && p.args.length === 2 && idx.pts.has(p.args[0]) && idx.pts.has(p.args[1])) {
    return { center: p.args[0], through: p.args[1] };
  }
  return null;
}

/**
 * Whether a point should be drawn + labelled. The customer labels meaningful
 * points (single uppercase, optional prime/subscript) and anything they caption;
 * scaffolding like `midBQ`, `M_AD`, `__o3` stays defined but unlabelled.
 */
function isMeaningfulPoint(o: GgbObject): boolean {
  if (o.labelVisible === false) return false;
  if (o.caption && o.caption.trim()) return true;
  return /^[A-Z]'*(?:_\d+|_\{[^}]+\}|\d)?$/.test(o.name);
}

// ── tkz-euclide renderer (house style) ───────────────────────────────────────

const TRIANGLE_CENTER: Record<string, { macro: string; zh: string }> = {
  '1': { macro: 'in', zh: '内心' },
  '2': { macro: 'centroid', zh: '重心' },
  '3': { macro: 'circum', zh: '外心' },
  '4': { macro: 'ortho', zh: '垂心' },
  '5': { macro: 'euler', zh: '九点圆心' },
};

function renderTkz(objects: GgbObject[], idx: Index): TikzExportResult {
  const defs: string[] = [];               // ordered defs: points AND derived lines
  const segs: string[] = [];
  const dashedSegs: string[] = [];
  const lineDraws: string[] = [];          // infinite lines / rays (drawn extended)
  const dashedLineDraws: string[] = [];
  const circleDraws: string[] = [];
  const polygonDraws: string[] = [];
  const drawPoints: string[] = [];
  const explicitLabels: string[] = [];     // names whose display ≠ node id
  const consumedInter = new Set<string>();
  const fallbacks: string[] = [];          // command names that fell back to coords
  const objByName = new Map(objects.map((o) => [o.name, o]));

  // Derived lines are materialised lazily: pair = [anchor/aux1, aux2].
  const derivedPair = new Map<string, [string, string]>();
  let auxSeq = 0;

  const N = (s: string) => nodeName(s);

  const materializeDerived = (name: string, visiting: Set<string> = new Set()): [string, string] | null => {
    const cached = derivedPair.get(name);
    if (cached) return cached;
    if (visiting.has(name)) return null;   // defensive: cycles can't occur in valid GGB
    visiting.add(name);
    const d = idx.derived.get(name);
    if (!d) return null;
    const aux = () => `${N(name)}p${auxSeq++}`;
    if (d.kind === 'perpendicular' || d.kind === 'parallel') {
      // base is either two points, or — derived-on-derived — another line
      // that we materialise first (its own aux pair becomes our base).
      const basePair: [string, string] | null = d.base.length >= 2
        ? [N(d.base[0]), N(d.base[1])]
        : d.baseLine
          ? (() => {
              const simple = resolveLineArg(d.baseLine!, idx);
              return simple ? [N(simple[0]), N(simple[1])] as [string, string] : materializeDerived(d.baseLine!, visiting);
            })()
          : null;
      if (!basePair) return null;
      const p2 = aux();
      defs.push(`    \\tkzDefLine[${d.kind}=through ${N(d.anchor!)}](${basePair[0]},${basePair[1]})\\tkzGetPoint{${p2}} %${d.kind === 'perpendicular' ? '垂线' : '平行线'}`);
      const pair: [string, string] = [N(d.anchor!), p2];
      derivedPair.set(name, pair);
      return pair;
    }
    if (d.kind === 'mediator') {
      // robust across tkz versions: midpoint + perpendicular through it.
      const m = aux(); const p2 = aux();
      defs.push(`    \\tkzDefMidPoint(${N(d.base[0])},${N(d.base[1])})\\tkzGetPoint{${m}} %中垂线`);
      defs.push(`    \\tkzDefLine[perpendicular=through ${m}](${N(d.base[0])},${N(d.base[1])})\\tkzGetPoint{${p2}}`);
      const pair: [string, string] = [m, p2];
      derivedPair.set(name, pair);
      return pair;
    }
    // bisector from vertex B of angle ABC
    const p2 = aux();
    defs.push(`    \\tkzDefLine[bisector](${N(d.base[0])},${N(d.base[1])},${N(d.base[2])})\\tkzGetPoint{${p2}} %角平分线`);
    const pair: [string, string] = [N(d.anchor!), p2];
    derivedPair.set(name, pair);
    return pair;
  };

  /** Any line-ish argument → a node-name pair usable in tkz operands. */
  const linePair = (arg: string): [string, string] | null => {
    const simple = resolveLineArg(arg, idx);
    if (simple) return [N(simple[0]), N(simple[1])];
    return materializeDerived(arg);
  };

  // Pre-group intersection points that share the same operand pair.
  const interByPair = new Map<string, GgbObject[]>();
  for (const o of objects) {
    if (o.type !== 'point') continue;
    const p = parseCommand(o.command);
    if (p && p.fn === 'Intersect' && p.args.length >= 2) {
      const key = [p.args[0], p.args[1]].sort().join('∩');
      (interByPair.get(key) ?? interByPair.set(key, []).get(key)!).push(o);
    }
  }

  const numericPoint = (o: GgbObject, zh: string, fallbackOf?: string) => {
    defs.push(`    \\tkzDefPoint(${fmt(o.x)},${fmt(o.y)}){${N(o.name)}} %${zh}`);
    if (fallbackOf) fallbacks.push(fallbackOf);
  };

  function emitIntersection(o: GgbObject, parsed: ParsedCommand) {
    if (consumedInter.has(o.name)) return;
    const [a, b] = parsed.args;
    const aPair = linePair(a); const bPair = linePair(b);
    const aConic = resolveConicArg(a, idx); const bConic = resolveConicArg(b, idx);

    const conicArgs = (c: ConicInfo): string | null =>
      c.center && c.through ? `${N(c.center)},${N(c.through)}`
        : c.pts3 && c.kind !== 'in' ? `${N(c.pts3[0])},${N(c.pts3[1])}` : null;

    // line ∩ line → single point.
    if (aPair && bPair) {
      defs.push(`    \\tkzInterLL(${aPair[0]},${aPair[1]})(${bPair[0]},${bPair[1]})\\tkzGetPoint{${N(o.name)}} %交点`);
      consumedInter.add(o.name);
      return;
    }

    // line ∩ circle  or  circle ∩ circle → two points; pair them up.
    const key = [a, b].sort().join('∩');
    const group = (interByPair.get(key) ?? []).filter((g) => !consumedInter.has(g.name));
    let macro: string | null = null;
    let opnds: string | null = null;
    if (aPair && bConic) { macro = 'InterLC'; const ca = conicArgs(bConic); if (ca) opnds = `(${aPair[0]},${aPair[1]})(${ca})`; }
    else if (bPair && aConic) { macro = 'InterLC'; const ca = conicArgs(aConic); if (ca) opnds = `(${bPair[0]},${bPair[1]})(${ca})`; }
    else if (aConic && bConic) { macro = 'InterCC'; const ca = conicArgs(aConic); const cb = conicArgs(bConic); if (ca && cb) opnds = `(${ca})(${cb})`; }

    // Guard: a stale/3rd intersection object with nothing left to pair —
    // emit it numerically instead of crashing the export.
    if (macro && opnds && group.length > 0) {
      const first = N(group[0].name);
      const second = group[1] ? N(group[1].name) : `${first}'`;
      defs.push(`    \\tkz${macro}${opnds}\\tkzGetPoints{${first}}{${second}} %交点`);
      consumedInter.add(group[0].name);
      if (group[1]) consumedInter.add(group[1].name);
      return;
    }

    numericPoint(o, '交点', 'Intersect');
    consumedInter.add(o.name);
  }

  for (const o of objects) {
    if (o.type !== 'point') continue;
    const parsed = parseCommand(o.command);

    if (!parsed) { numericPoint(o, '自由点'); }
    else {
      const { fn, args } = parsed;
      if (fn === 'Midpoint' && args.length === 2 && idx.pts.has(args[0]) && idx.pts.has(args[1])) {
        defs.push(`    \\tkzDefMidPoint(${N(args[0])},${N(args[1])})\\tkzGetPoint{${N(o.name)}} %中点`);
      } else if (fn === 'Midpoint' && args.length === 1 && resolveLineArg(args[0], idx)) {
        const lp = resolveLineArg(args[0], idx)!;
        defs.push(`    \\tkzDefMidPoint(${N(lp[0])},${N(lp[1])})\\tkzGetPoint{${N(o.name)}} %中点`);
      } else if (fn === 'TriangleCenter' && args.length === 4 && TRIANGLE_CENTER[args[3]]) {
        const { macro, zh } = TRIANGLE_CENTER[args[3]];
        const tri = `${N(args[0])},${N(args[1])},${N(args[2])}`;
        defs.push(macro === 'in'
          ? `    \\tkzInCenter(${tri})\\tkzGetPoint{${N(o.name)}} %内心`
          : `    \\tkzDefTriangleCenter[${macro}](${tri})\\tkzGetPoint{${N(o.name)}} %${zh}`);
      } else if (fn === 'Reflect' && args.length === 2 && idx.pts.has(args[0])) {
        const lp = linePair(args[1]);
        if (lp) defs.push(`    \\tkzDefPointBy[reflection = over ${lp[0]}--${lp[1]}](${N(args[0])})\\tkzGetPoint{${N(o.name)}} %轴反射`);
        else if (idx.pts.has(args[1])) defs.push(`    \\tkzDefPointBy[symmetry=center ${N(args[1])}](${N(args[0])})\\tkzGetPoint{${N(o.name)}} %中心对称`);
        else numericPoint(o, '反射', 'Reflect');
      } else if (fn === 'Rotate' && args.length === 3 && idx.pts.has(args[0]) && idx.pts.has(args[2])
        && angleToDegrees(args[1]) != null) {
        const deg = angleToDegrees(args[1])!;
        defs.push(`    \\tkzDefPointBy[rotation=center ${N(args[2])} angle ${fmt(deg)}](${N(args[0])})\\tkzGetPoint{${N(o.name)}} %旋转`);
      } else if (fn === 'Dilate' && args.length === 3 && idx.pts.has(args[0]) && idx.pts.has(args[2])
        && isNumberLiteral(args[1])) {
        defs.push(`    \\tkzDefPointBy[homothety=center ${N(args[2])} ratio ${fmt(parseFloat(args[1]))}](${N(args[0])})\\tkzGetPoint{${N(o.name)}} %位似`);
      } else if (fn === 'Translate' && args.length === 2 && idx.pts.has(args[0]) && idx.vectors.has(args[1])) {
        const [vf, vt] = idx.vectors.get(args[1])!;
        defs.push(`    \\tkzDefPointWith[colinear= at ${N(args[0])}](${N(vf)},${N(vt)})\\tkzGetPoint{${N(o.name)}} %平移`);
      } else if (fn === 'ClosestPoint' && args.length === 2 && idx.pts.has(args[1]) && linePair(args[0])) {
        const lp = linePair(args[0])!;
        defs.push(`    \\tkzDefPointBy[projection = onto ${lp[0]}--${lp[1]}](${N(args[1])})\\tkzGetPoint{${N(o.name)}} %投影`);
      } else if (fn === 'Point' && args.length === 2 && isNumberLiteral(args[1]) && linePair(args[0])) {
        const lp = linePair(args[0])!;
        defs.push(`    \\tkzDefPointOnLine[pos=${fmt(parseFloat(args[1]))}](${lp[0]},${lp[1]})\\tkzGetPoint{${N(o.name)}} %线上点`);
      } else if (fn === 'Center' && args.length === 1 && idx.conics.get(args[0])?.center) {
        const c = idx.conics.get(args[0])!;
        defs.push(`    \\tkzDefPoint(${fmt(c.cx)},${fmt(c.cy)}){${N(o.name)}} %圆心 (= ${N(c.center!)})`);
      } else if (fn === 'Intersect' && args.length >= 2) {
        emitIntersection(o, parsed);
      } else {
        numericPoint(o, '构造点', parsed.fn);
      }
    }

    if (o.visible && isMeaningfulPoint(o)) {
      drawPoints.push(N(o.name));
      if (!labelMatchesNode(o.name) || (o.caption && o.caption.trim())) explicitLabels.push(o.name);
    }
  }

  // Polygon edges are drawn by \tkzDrawPolygon — skip any segment that repeats one.
  const edgeKey = (a: string, b: string) => [a, b].sort().join('|');
  const polyEdges = new Set<string>();
  for (const o of objects) {
    if (o.type !== 'polygon') continue;
    const p = parseCommand(o.command);
    if (p && p.fn === 'Polygon') {
      for (let i = 0; i < p.args.length; i++) polyEdges.add(edgeKey(p.args[i], p.args[(i + 1) % p.args.length]));
    }
  }

  // segments / lines / circles / polygons
  for (const o of objects) {
    if (!o.visible) continue;
    if (o.type === 'segment') {
      const lp = idx.linePts.get(o.name);
      if (lp && !polyEdges.has(edgeKey(lp[0], lp[1]))) {
        (o.dashed ? dashedSegs : segs).push(`${N(lp[0])},${N(lp[1])}`);
      }
    } else if (o.type === 'line' || o.type === 'ray') {
      // full lines draw extended; derived lines materialise their aux pair.
      const lp = idx.linePts.get(o.name)
        ? [N(idx.linePts.get(o.name)![0]), N(idx.linePts.get(o.name)![1])] as [string, string]
        : materializeDerived(o.name);
      if (lp) {
        (o.dashed ? dashedLineDraws : lineDraws).push(`${lp[0]},${lp[1]}`);
      } else {
        fallbacks.push(parseCommand(o.command)?.fn ?? o.type);
      }
    } else if (idx.arcs.has(o.name)) {
      // Semicircle / CircularArc / CircumcircularArc → \tkzDrawArc(center,from)(to)
      // (tkz arcs sweep counterclockwise from the second operand to the third).
      const arc = idx.arcs.get(o.name)!;
      const dash = o.dashed ? '[dashed]' : '';
      if (arc.kind === 'semi') {
        const m = `${N(o.name)}m`;
        defs.push(`    \\tkzDefMidPoint(${N(arc.p[0])},${N(arc.p[1])})\\tkzGetPoint{${m}} %半圆心`);
        circleDraws.push(`    \\tkzDrawArc${dash}(${m},${N(arc.p[1])})(${N(arc.p[0])})`);
      } else if (arc.kind === 'central') {
        circleDraws.push(`    \\tkzDrawArc${dash}(${N(arc.p[0])},${N(arc.p[1])})(${N(arc.p[2])})`);
      } else {
        const oName = `${N(o.name)}o`;
        defs.push(`    \\tkzDefCircle[circum](${N(arc.p[0])},${N(arc.p[1])},${N(arc.p[2])})\\tkzGetPoint{${oName}} %弧心`);
        circleDraws.push(arc.ccw
          ? `    \\tkzDrawArc${dash}(${oName},${N(arc.p[0])})(${N(arc.p[2])})`
          : `    \\tkzDrawArc${dash}(${oName},${N(arc.p[2])})(${N(arc.p[0])})`);
      }
    } else if (o.type === 'conic') {
      const c = idx.conics.get(o.name);
      if (!c) { fallbacks.push(parseCommand(o.command)?.fn ?? 'conic'); continue; }
      const dash = o.dashed ? '[dashed]' : '';
      if (c.center && c.through) {
        circleDraws.push(`    \\tkzDrawCircle${dash}(${N(c.center)},${N(c.through)})`);
      } else if (c.pts3 && c.kind === 'circum') {
        // circumscribed circle through 3 points: define its centre, draw through A.
        const oName = `O${circleDraws.length || ''}c`;
        defs.push(`    \\tkzDefCircle[circum](${N(c.pts3[0])},${N(c.pts3[1])},${N(c.pts3[2])})\\tkzGetPoint{${oName}} %外接圆心`);
        circleDraws.push(`    \\tkzDrawCircle${dash}(${oName},${N(c.pts3[0])})`);
      } else if (c.pts3 && c.kind === 'in') {
        const oName = `O${circleDraws.length || ''}i`;
        defs.push(`    \\tkzDefCircle[in](${N(c.pts3[0])},${N(c.pts3[1])},${N(c.pts3[2])})\\tkzGetPoint{${oName}} %内切圆心`);
        circleDraws.push(`    \\tkzDrawCircle${o.dashed ? '[R,dashed]' : '[R]'}(${oName},${fmt(c.r)})`);
      } else if (c.cx != null && c.cy != null && c.r != null) {
        // numeric centre+radius — define the centre then draw by radius.
        const cname = `Oc${circleDraws.length || ''}`;
        defs.push(`    \\tkzDefPoint(${fmt(c.cx)},${fmt(c.cy)}){${cname}} %圆心`);
        circleDraws.push(`    \\tkzDrawCircle${o.dashed ? '[R,dashed]' : '[R]'}(${cname},${fmt(c.r)})`);
        fallbacks.push('Circle');
      }
    } else if (o.type === 'polygon') {
      const p = parseCommand(o.command);
      if (p && p.fn === 'Polygon' && p.args.every((a) => idx.pts.has(a))) {
        polygonDraws.push(`    \\tkzDrawPolygon(${p.args.map(N).join(',')})`);
      }
    }
  }

  // angle marks — Angle(A,B,C) measures at vertex B, exactly tkzMarkAngle's
  // convention; a caption becomes the angle label.
  const angleMarks: string[] = [];
  for (const o of objects) {
    if (!o.visible || o.type !== 'angle') continue;
    const p = parseCommand(o.command);
    if (p && p.fn === 'Angle' && p.args.length === 3 && p.args.every((a) => idx.pts.has(a))) {
      const [a, b, c] = p.args.map(N);
      angleMarks.push(`    \\tkzMarkAngle[size=0.6](${a},${b},${c})`);
      if (o.caption?.trim()) angleMarks.push(`    \\tkzLabelAngle[pos=0.9](${a},${b},${c}){${o.caption.trim()}}`);
    } else if (p?.fn === 'Angle') {
      fallbacks.push('Angle');
    }
  }

  // labels grouped by position (centroid heuristic)
  const labelGroups = groupLabels(objects, idx, new Set(explicitLabels));

  const body: string[] = [];
  body.push(...defs);
  if (segs.length) body.push(`    \\tkzDrawSegments(${segs.join(' ')})`);
  if (dashedSegs.length) body.push(`    \\tkzDrawSegments[dashed](${dashedSegs.join(' ')})`);
  if (lineDraws.length) body.push(`    \\tkzDrawLines[add=0.3 and 0.3](${lineDraws.join(' ')})`);
  if (dashedLineDraws.length) body.push(`    \\tkzDrawLines[add=0.3 and 0.3,dashed](${dashedLineDraws.join(' ')})`);
  body.push(...circleDraws, ...polygonDraws, ...angleMarks);
  if (drawPoints.length) body.push(`    \\tkzDrawPoints(${drawPoints.join(',')})`);
  for (const [pos, names] of labelGroups) {
    if (names.length) body.push(`    \\tkzLabelPoints[${pos}](${names.join(',')})`);
  }
  for (const name of explicitLabels) {
    const o = objByName.get(name);
    const text = o?.caption?.trim() ? o.caption.trim() : `$${labelTex(name)}$`;
    body.push(`    \\tkzLabelPoint[above right](${nodeName(name)}){${text}}`);
  }

  const code = [
    '\\begin{center}',
    '\\begin{tikzpicture}[scale=0.6]',
    ...body,
    '\\end{tikzpicture}',
    '\\end{center}',
  ].join('\n');

  const total = objects.filter((o) => o.visible || o.type === 'point').length;
  const fallNote = fallbacks.length
    ? ` · ${fallbacks.length} 个回退为坐标 (${[...new Set(fallbacks)].join(', ')})`
    : '';
  return { code, note: `tkz-euclide · ${total} 个对象${fallNote}` };
}

/** Position label of each visible point by direction from the figure centroid. */
function groupLabels(objects: GgbObject[], idx: Index, skip: Set<string>): Array<[string, string[]]> {
  const pts = [...idx.pts.values()];
  if (pts.length === 0) return [];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const groups: Record<string, string[]> = { above: [], below: [], left: [], right: [] };
  for (const o of objects) {
    if (o.type !== 'point' || !o.visible || o.x == null || o.y == null || !isMeaningfulPoint(o)) continue;
    if (skip.has(o.name)) continue;
    const dx = o.x - cx; const dy = o.y - cy;
    const pos = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'above' : 'below');
    groups[pos].push(nodeName(o.name));
  }
  return [['above', groups.above], ['below', groups.below], ['left', groups.left], ['right', groups.right]];
}

/**
 * Numeric endpoints for a derived line (raw mode / sanity checks): perpendicular,
 * parallel, mediator and bisector all resolve from their base points' coords.
 */
function derivedNumeric(name: string, idx: Index, depth = 0): { p: { x: number; y: number }; q: { x: number; y: number } } | null {
  if (depth > 6) return null;   // defensive: valid GGB derivations are shallow
  const d = idx.derived.get(name);
  if (!d) return null;
  const P = (n: string) => idx.pts.get(n);
  if (d.kind === 'perpendicular' || d.kind === 'parallel') {
    const anchor = P(d.anchor!);
    let a = d.base.length >= 2 ? P(d.base[0]) : undefined;
    let b = d.base.length >= 2 ? P(d.base[1]) : undefined;
    if ((!a || !b) && d.baseLine) {
      // derived-on-derived: take the parent line's numeric direction
      const lp = idx.linePts.get(d.baseLine);
      if (lp) { a = P(lp[0]); b = P(lp[1]); }
      else {
        const parent = derivedNumeric(d.baseLine, idx, depth + 1);
        if (parent) { a = parent.p; b = parent.q; }
      }
    }
    if (!anchor || !a || !b) return null;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const dir = d.kind === 'parallel' ? { x: dx, y: dy } : { x: -dy, y: dx };
    return { p: anchor, q: { x: anchor.x + dir.x, y: anchor.y + dir.y } };
  }
  if (d.kind === 'mediator') {
    const a = P(d.base[0]); const b = P(d.base[1]);
    if (!a || !b) return null;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { p: m, q: { x: m.x - (b.y - a.y), y: m.y + (b.x - a.x) } };
  }
  const a = P(d.base[0]); const b = P(d.base[1]); const c = P(d.base[2]);
  if (!a || !b || !c) return null;
  const la = dist(b, a); const lc = dist(b, c);
  if (la < 1e-12 || lc < 1e-12) return null;
  const dir = { x: (a.x - b.x) / la + (c.x - b.x) / lc, y: (a.y - b.y) / la + (c.y - b.y) / lc };
  return { p: b, q: { x: b.x + dir.x, y: b.y + dir.y } };
}

// ── raw PGF/TikZ renderer (GeoGebra-export look) ─────────────────────────────

function hexToRgb255(hex?: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function widthPt(thickness?: number): string {
  const w = Math.max(0.4, Math.round((thickness ?? 2) * 0.4 * 10) / 10);
  return `${w}pt`;
}

function renderRaw(objects: GgbObject[], idx: Index): TikzExportResult {
  // collect colours → \definecolor palette
  const palette = new Map<string, string>();   // 'RRGGBB' → colour name
  const colorName = (hex?: string): string => {
    const [r, g, b] = hexToRgb255(hex);
    const key = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    if (key === '000000') return 'black';
    if (!palette.has(key)) palette.set(key, `c${palette.size}`);
    return palette.get(key)!;
  };

  const draws: string[] = [];
  const labels: string[] = [];

  // figure bbox (points + circle extents) for \clip
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const grow = (x: number, y: number) => { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); };
  for (const p of idx.pts.values()) grow(p.x, p.y);

  for (const o of objects) {
    if (!o.visible) continue;
    const col = colorName(o.color);
    const style = `line width=${widthPt(o.thickness)}${col === 'black' ? '' : `,color=${col}`}${o.dashed ? ',dashed' : ''}`;
    if (o.type === 'segment' || o.type === 'line' || o.type === 'ray') {
      const lp = idx.linePts.get(o.name);
      let p: { x: number; y: number } | undefined;
      let q: { x: number; y: number } | undefined;
      if (lp) {
        p = idx.pts.get(lp[0]); q = idx.pts.get(lp[1]);
      } else {
        // derived line (perpendicular / parallel / bisector …) → synthesise
        const dn = derivedNumeric(o.name, idx);
        if (dn) { p = dn.p; q = dn.q; }
      }
      if (!p || !q) continue;
      // infinite lines / rays read better extended past their control points;
      // normalise by figure span so unit-vector derived lines extend too.
      let [x1, y1, x2, y2] = [p.x, p.y, q.x, q.y];
      if (o.type === 'line' || o.type === 'ray') {
        const dx = q.x - p.x; const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const reach = Math.max(maxx - minx, maxy - miny, 4) * 0.45;
        const ux = (dx / len) * reach; const uy = (dy / len) * reach;
        if (o.type === 'line') { x1 = p.x - ux; y1 = p.y - uy; }
        x2 = p.x + ux; y2 = p.y + uy;
      }
      draws.push(`\\draw [${style}] (${fmt(x1)},${fmt(y1)})-- (${fmt(x2)},${fmt(y2)});`);
    } else if (idx.arcs.has(o.name)) {
      const arc = idx.arcs.get(o.name)!;
      // sweep counterclockwise from `from` to `to` around the centre
      const fromName = arc.kind === 'semi' ? arc.p[1] : arc.kind === 'central' ? arc.p[1] : (arc.ccw ? arc.p[0] : arc.p[2]);
      const toName = arc.kind === 'semi' ? arc.p[0] : arc.kind === 'central' ? arc.p[2] : (arc.ccw ? arc.p[2] : arc.p[0]);
      const from = idx.pts.get(fromName); const to = idx.pts.get(toName);
      if (!from || !to || arc.r <= 0) continue;
      const deg = (p: { x: number; y: number }) => (Math.atan2(p.y - arc.cy, p.x - arc.cx) * 180) / Math.PI;
      const a1 = deg(from);
      let a2 = deg(to);
      while (a2 <= a1 + 1e-9) a2 += 360;
      draws.push(`\\draw [${style}] (${fmt(from.x)},${fmt(from.y)}) arc (${fmt(a1)}:${fmt(a2)}:${fmt(arc.r)}cm);`);
      grow(arc.cx - arc.r, arc.cy - arc.r); grow(arc.cx + arc.r, arc.cy + arc.r);
    } else if (o.type === 'conic') {
      const c = idx.conics.get(o.name);
      if (!c || c.cx == null || c.cy == null || c.r == null) continue;
      draws.push(`\\draw [${style}] (${fmt(c.cx)},${fmt(c.cy)}) circle (${fmt(c.r)}cm);`);
      grow(c.cx - c.r, c.cy - c.r); grow(c.cx + c.r, c.cy + c.r);
    } else if (o.type === 'polygon') {
      const p = parseCommand(o.command);
      if (p && p.fn === 'Polygon' && p.args.every((a) => idx.pts.has(a))) {
        const path = p.args.map((a) => { const pt = idx.pts.get(a)!; return `(${fmt(pt.x)},${fmt(pt.y)})`; }).join('-- ');
        draws.push(`\\draw [${style}] ${path}-- cycle;`);
      }
    }
  }

  // point dots + labels (scriptsize block, like GeoGebra)
  for (const o of objects) {
    if (o.type !== 'point' || !o.visible || o.x == null || o.y == null || !isMeaningfulPoint(o)) continue;
    const col = colorName(o.color);
    const fill = col === 'black' ? 'black' : col;
    const text = o.caption?.trim() ? o.caption.trim() : `$${labelTex(o.name)}$`;
    labels.push(`\\draw [fill=${fill}] (${fmt(o.x)},${fmt(o.y)}) circle (1pt);`);
    labels.push(`\\draw[color=${col}] (${fmt(o.x + 0.18)},${fmt(o.y + 0.18)}) node {${text}};`);
  }

  const colorDefs = [...palette.entries()].map(([key, name]) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(key.slice(i, i + 2), 16));
    return `\\definecolor{${name}}{RGB}{${r},${g},${b}}`;
  });

  const clip = isFinite(minx)
    ? [`\\clip(${fmt(minx - 0.5)},${fmt(miny - 0.5)}) rectangle (${fmt(maxx + 0.5)},${fmt(maxy + 0.5)});`]
    : [];

  const code = [
    ...colorDefs,
    '\\begin{tikzpicture}[line cap=round,line join=round,>=triangle 45,x=1cm,y=1cm]',
    ...clip,
    ...draws,
    '\\begin{scriptsize}',
    ...labels,
    '\\end{scriptsize}',
    '\\end{tikzpicture}',
  ].join('\n');

  const total = objects.filter((o) => o.visible).length;
  return { code, note: `raw PGF/TikZ · ${total} 个对象` };
}

// ── entry point ──────────────────────────────────────────────────────────────

export function ggbToTikz(objects: GgbObject[], mode: TikzMode): TikzExportResult {
  if (objects.length === 0) {
    return { code: mode === 'tkz' ? '% 画布为空' : '% empty canvas', note: '画布为空' };
  }
  const idx = buildIndex(objects);
  return mode === 'tkz' ? renderTkz(objects, idx) : renderRaw(objects, idx);
}
