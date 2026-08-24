import type { Pt } from './calc-eval';
import { flattenCubicBezier, type CubicBezierGeometry } from '../geometry/cubic-bezier';
import { flattenCircularArc, type CircularArcGeometry } from '../geometry/circular-arc';

export type GeomPath =
  | { type: 'poly'; points: Pt[]; closed: boolean }
  | ({ type: 'cubic-bezier' } & CubicBezierGeometry)
  | ({ type: 'circular-arc' } & CircularArcGeometry)
  | { type: 'circle'; center: Pt; radius: number };

const EPS = 1e-9;

interface Annotated { pt: Pt; t: number }

// segment-segment intersection; returns pt + t on first (0..1) and u on second
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): { pt: Pt; t: number; u: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return null; // parallel
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = (ac.x * s.y - ac.y * s.x) / denom;
  const u = (ac.x * r.y - ac.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { pt: { x: a.x + r.x * t, y: a.y + r.y * t }, t, u };
}

// segment-circle: returns 0-2 intersection pts with parameter t along segment
function segCircle(a: Pt, b: Pt, c: Pt, r: number): Annotated[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const sd = Math.sqrt(Math.max(0, disc));
  const t1 = (-B - sd) / (2 * A);
  const t2 = (-B + sd) / (2 * A);
  const out: Annotated[] = [];
  if (t1 >= -EPS && t1 <= 1 + EPS) out.push({ pt: { x: a.x + dx * t1, y: a.y + dy * t1 }, t: t1 });
  if (disc > EPS && t2 >= -EPS && t2 <= 1 + EPS) out.push({ pt: { x: a.x + dx * t2, y: a.y + dy * t2 }, t: t2 });
  return out;
}

// circle-circle: returns 0-2 intersection pts with parameter t (angle on first)
function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Annotated[] {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return []; // concentric
  if (d > r1 + r2 + EPS) return []; // separate
  if (d < Math.abs(r1 - r2) - EPS) return []; // contained
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  const ox = -(dy * h) / d;
  const oy = (dx * h) / d;
  if (h < EPS) {
    return [{ pt: { x: mx, y: my }, t: Math.atan2(my - c1.y, mx - c1.x) }];
  }
  const p1 = { x: mx + ox, y: my + oy };
  const p2 = { x: mx - ox, y: my - oy };
  return [
    { pt: p1, t: Math.atan2(p1.y - c1.y, p1.x - c1.x) },
    { pt: p2, t: Math.atan2(p2.y - c1.y, p2.x - c1.x) },
  ];
}

function polySegments(p: { points: Pt[]; closed: boolean }): Array<[Pt, Pt]> {
  const segs: Array<[Pt, Pt]> = [];
  for (let i = 0; i < p.points.length - 1; i++) segs.push([p.points[i], p.points[i + 1]]);
  if (p.closed && p.points.length > 0) segs.push([p.points[p.points.length - 1], p.points[0]]);
  return segs;
}

function asPolyline(path: Exclude<GeomPath, { type: 'circle' }>): { points: Pt[]; closed: boolean } {
  return path.type === 'poly'
    ? path
    : {
      points: [...(path.type === 'cubic-bezier'
        ? flattenCubicBezier(path, 0.005)
        : flattenCircularArc(path, 1))],
      closed: false,
    };
}

export function intersectPaths(first: GeomPath, second: GeomPath): Pt[] {
  const annotated: Annotated[] = [];

  if (first.type !== 'circle') {
    const segs = polySegments(asPolyline(first));
    segs.forEach(([a, b], segIdx) => {
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const base = segs.slice(0, segIdx).reduce((s, [p, q]) => s + Math.hypot(q.x - p.x, q.y - p.y), 0);
      if (second.type !== 'circle') {
        const segs2 = polySegments(asPolyline(second));
        for (const [c, d] of segs2) {
          const hit = segSeg(a, b, c, d);
          if (hit) annotated.push({ pt: hit.pt, t: base + hit.t * segLen });
        }
      } else {
        for (const x of segCircle(a, b, second.center, second.radius)) {
          annotated.push({ pt: x.pt, t: base + x.t * segLen });
        }
      }
    });
  } else {
    const circ1 = first;
    if (second.type !== 'circle') {
      for (const [a, b] of polySegments(asPolyline(second))) {
        for (const x of segCircle(a, b, circ1.center, circ1.radius)) {
          annotated.push({ pt: x.pt, t: Math.atan2(x.pt.y - circ1.center.y, x.pt.x - circ1.center.x) });
        }
      }
    } else {
      for (const x of circleCircle(circ1.center, circ1.radius, second.center, second.radius)) {
        annotated.push({ pt: x.pt, t: x.t });
      }
    }
  }

  // sort by t
  annotated.sort((p, q) => p.t - q.t);
  // dedupe
  const out: Pt[] = [];
  for (const a of annotated) {
    if (out.length === 0 || Math.hypot(a.pt.x - out[out.length - 1].x, a.pt.y - out[out.length - 1].y) > 1e-7) {
      out.push(a.pt);
    }
  }
  return out;
}
