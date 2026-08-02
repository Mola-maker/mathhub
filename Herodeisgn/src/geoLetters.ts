// 3D triangulated "Geo" wordmark. Each letter is filled with a Delaunay
// triangulation of (a) boundary samples taken from the letter's arc-based
// outline and (b) interior samples drawn by rejection sampling. The result
// is a triangulated polygon mesh — irregular triangles, not a regular grid.
//
// LineSegments2 / LineMaterial is used because LineBasicMaterial's
// linewidth is capped at 1px by WebGL on most platforms. Y-up; z=0.

import { Vector2 } from 'three';
import { Group } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import Delaunator from 'delaunator';

// ── Inside-letter predicate ─────────────────────────────────────────

/**
 * Is the point inside the letter's filled region (excluding the inner
 * counter and any rectangular cut-outs)? Single predicate used for both
 * interior point rejection sampling and triangle centroid filtering.
 */
function isInsideLetter(
  x: number,
  y: number,
  letter: 'g' | 'e' | 'o',
  outerR: number,
  innerR: number,
): boolean {
  const dSq = x * x + y * y;
  if (dSq > outerR * outerR) return false;

  if (letter === 'g') {
    // G's bar slot — right-side rectangular cutout
    const barBotY = outerR * Math.sin(-Math.PI * 0.11);
    const barTopY = outerR * Math.sin(Math.PI * 0.20);
    if (x > 14 && y > barBotY && y < barTopY) return false;
  }

  if (letter === 'e') {
    // e's bottom-right opening
    if (x > 16 && y > -26 && y < -4) return false;
    // e's inner counter — D-shape above the crossbar
    if (dSq < innerR * innerR && y > 6) return false;
  }

  if (letter === 'o') {
    if (dSq < innerR * innerR) return false;
  }

  return true;
}

// ── Delaunay sampling ───────────────────────────────────────────────

/** Tiny seeded PRNG — deterministic so the mesh looks identical each load. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample points that will become vertices of the Delaunay triangulation.
 * Returns:
 *   - dense boundary points sampled from the letter's outer arc (with
 *     gaps at G's bar slot and e's opening)
 *   - rectangular cutout corner points so those edges appear in the mesh
 *   - inner-counter boundary points (for o and e)
 *   - interior points drawn by rejection sampling
 */
function sampleLetterPoints(
  letter: 'g' | 'e' | 'o',
  outerR: number,
  innerR: number,
  interiorCount: number,
  rng: () => number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const twoPi = 2 * Math.PI;
  const normAngle = (raw: number) => ((raw % twoPi) + twoPi) % twoPi;

  // Outer-arc KEEP ranges per letter (normalized angles, [0, 2π]).
  // The cutout (bar slot for G, opening for e) is the complement of
  // these ranges. For G the bar slot is the SHORT 56° wraparound arc
  // around 0°/2π, so the outer arc is [barTop, barBot] going through
  // 90°/180°/270°. For e the opening is the SHORT 20° arc at the
  // lower-right; the outer arc is two ranges flanking it.
  type Range = { start: number; end: number };
  let keepRanges: Range[];
  if (letter === 'g') {
    const barBot = normAngle(-Math.PI * 0.11); // ~5.93 rad (340°)
    const barTop = normAngle(Math.PI * 0.20);  // ~0.628 rad (36°)
    keepRanges = [{ start: barTop, end: barBot }];
  } else if (letter === 'e') {
    const cutBot = normAngle(Math.atan2(-26, outerR)); // ~5.87 rad
    const cutTop = normAngle(Math.atan2(-4, outerR));  // ~6.22 rad
    keepRanges = [
      { start: 0, end: cutBot },
      { start: cutTop, end: twoPi },
    ];
  } else {
    keepRanges = [{ start: 0, end: twoPi }];
  }

  const inKeep = (a: number) =>
    keepRanges.some((r) => a >= r.start && a <= r.end);

  // Outer arc samples — only keep angles in the keep-ranges.
  const outerSamples = 56;
  for (let i = 0; i < outerSamples; i++) {
    const angle = (i / outerSamples) * twoPi;
    const a = normAngle(angle);
    if (!inKeep(a)) continue;
    pts.push([outerR * Math.cos(angle), outerR * Math.sin(angle)]);
  }

  // Count what we've pushed so far to budget the interior points.
  const totalBound = pts.length;

  // Bar-slot corners (G)
  if (letter === 'g') {
    const barBotAngle = -Math.PI * 0.11;
    const barTopAngle = Math.PI * 0.20;
    pts.push([14, outerR * Math.sin(barBotAngle)]);
    pts.push([outerR * Math.cos(barBotAngle), outerR * Math.sin(barBotAngle)]);
    pts.push([14, outerR * Math.sin(barTopAngle)]);
    pts.push([outerR * Math.cos(barTopAngle), outerR * Math.sin(barTopAngle)]);
  }

  // Opening corners (e)
  if (letter === 'e') {
    pts.push([16, -26]);
    pts.push([outerR * Math.cos(Math.atan2(-26, outerR)), -26]);
    pts.push([16, -4]);
    pts.push([outerR * Math.cos(Math.atan2(-4, outerR)), -4]);
  }

  // Inner counter boundary. Dense ring (not sparse) gives the inner edge
  // a real wireframe look without falling into Delaunay's radial-fan
  // habit (the interior points now dominate the center).
  if (letter === 'o') {
    const innerSamples = 36;
    for (let i = 0; i < innerSamples; i++) {
      const angle = (i / innerSamples) * twoPi;
      // Mild radius jitter (±1.2 units) breaks perfect concentricity.
      const r = innerR + Math.sin(angle * 7.3 + i * 1.1) * 1.2;
      pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }

  if (letter === 'e') {
    // Upper D-counter boundary (top half of inner ring).
    const innerSamples = 24;
    for (let i = 0; i < innerSamples; i++) {
      const t = i / (innerSamples - 1);
      const angle = Math.PI - Math.PI * t; // π → 0 (top half)
      const y = innerR * Math.sin(angle);
      if (y <= 6) continue;
      const r = innerR + Math.sin(angle * 5.7 + i * 0.9) * 1.2;
      pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    // Crossbar: a horizontal line of samples across the middle of the
    // letter. Connects the left inner edge of the D to the right edge.
    const crossbarSamples = 10;
    for (let i = 0; i < crossbarSamples; i++) {
      const t = i / (crossbarSamples - 1);
      const x = -innerR + t * (innerR - (-innerR));
      pts.push([x, 6]);
    }
  }

  // For 'g': explicit horizontal bar through the bowl (visual identity).
  // Samples along the inner-facing edge of the bar slot.
  if (letter === 'g') {
    const barSamples = 8;
    for (let i = 0; i < barSamples; i++) {
      const t = i / (barSamples - 1);
      // The bar runs from the inner edge of the bowl on the left to
      // a small inset on the right.
      const x = -innerR + t * (outerR * 0.55);
      pts.push([x, 6]);
    }
    // Lower D (inner counter of the G bowl below the bar).
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const angle = Math.PI + Math.PI * t; // bottom half: π → 2π
      const r = innerR + Math.sin(angle * 4.1 + i * 0.7) * 1.0;
      pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }

  // Interior points via rejection sampling.
  let attempts = 0;
  const maxAttempts = interiorCount * 60;
  while (attempts < maxAttempts) {
    attempts++;
    const x = (rng() * 2 - 1) * outerR;
    const y = (rng() * 2 - 1) * outerR;
    if (!isInsideLetter(x, y, letter, outerR, innerR)) continue;
    pts.push([x, y]);
    if (pts.length >= totalBound + interiorCount) break;
  }

  return pts;
}

/**
 * Run Delaunay on the sampled points and return unique edges of triangles
 * whose centroid lies inside the letter shape. Each edge is six floats
 * (x1, y1, z, x2, y2, z) suitable for LineSegmentsGeometry.setPositions.
 */
function buildDelaunayMesh(
  letter: 'g' | 'e' | 'o',
  outerR: number,
  innerR: number,
  interiorCount: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const points = sampleLetterPoints(letter, outerR, innerR, interiorCount, rng);

  const flat = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    flat[i * 2] = points[i][0];
    flat[i * 2 + 1] = points[i][1];
  }

  const delaunay = new Delaunator(flat);
  const tris = delaunay.triangles;

  const segments: number[] = [];
  const seen = new Set<number>();

  const pushEdge = (ai: number, bi: number) => {
    const lo = Math.min(ai, bi);
    const hi = Math.max(ai, bi);
    const key = lo * 100000 + hi;
    if (seen.has(key)) return;
    seen.add(key);
    segments.push(
      points[lo][0], points[lo][1], 0,
      points[hi][0], points[hi][1], 0,
    );
  };

  for (let i = 0; i < tris.length; i += 3) {
    const ai = tris[i];
    const bi = tris[i + 1];
    const ci = tris[i + 2];
    const cx = (points[ai][0] + points[bi][0] + points[ci][0]) / 3;
    const cy = (points[ai][1] + points[bi][1] + points[ci][1]) / 3;
    if (!isInsideLetter(cx, cy, letter, outerR, innerR)) continue;
    pushEdge(ai, bi);
    pushEdge(bi, ci);
    pushEdge(ci, ai);
  }

  return segments;
}

// ── Letter builder ──────────────────────────────────────────────────

export type LetterMesh = {
  group: Group;
  lines: LineSegments2;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
};

function buildLetter(
  letter: 'g' | 'e' | 'o',
  outerR: number,
  innerR: number,
  interiorCount: number,
  seed: number,
): LetterMesh {
  const positions = buildDelaunayMesh(letter, outerR, innerR, interiorCount, seed);

  const geom = new LineSegmentsGeometry();
  geom.setPositions(positions);

  const mat = new LineMaterial({
    color: 0x0a0a0a,
    linewidth: 1.4,
    transparent: true,
    opacity: 0,
    resolution: new Vector2(1, 1),
    depthTest: true,
  });

  const lines = new LineSegments2(geom, mat);
  lines.computeLineDistances();

  // Compute bbox from positions (each edge is 6 floats: x1 y1 z x2 y2 z).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 6) {
    const ax = positions[i], ay = positions[i + 1];
    const bx = positions[i + 3], by = positions[i + 4];
    if (ax < minX) minX = ax;
    if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay;
    if (ay > maxY) maxY = ay;
    if (bx < minX) minX = bx;
    if (bx > maxX) maxX = bx;
    if (by < minY) minY = by;
    if (by > maxY) maxY = by;
  }

  const group = new Group();
  group.add(lines);

  return { group, lines, bbox: { minX, maxX, minY, maxY } };
}

// ── Public API ──────────────────────────────────────────────────────

export type GeoWordmark = {
  group: Group;
  letters: LetterMesh[];
  width: number;
  lineMaterials: LineMaterial[];
};

export function buildGeoWordmark(targetWidth = 11): GeoWordmark {
  const gOuterR = 65;
  const gInnerR = 22;
  const eOuterR = 60;
  const eInnerR = 22;
  const oOuterR = 60;
  const oInnerR = 22;

  // Deterministic seeds so the mesh is identical on every reload.
  // Higher interior counts break up the radial-fan artifact and give a
  // dense triangulated fill that's recognizable as the letter shape.
  const g = buildLetter('g', gOuterR, gInnerR, 120, 11);
  const e = buildLetter('e', eOuterR, eInnerR, 100, 23);
  const o = buildLetter('o', oOuterR, oInnerR, 140, 47);

  const gW = g.bbox.maxX - g.bbox.minX;
  const eW = e.bbox.maxX - e.bbox.minX;
  const oW = o.bbox.maxX - o.bbox.minX;

  const gutter = targetWidth * 0.06;
  const totalW = gW + eW + oW + 2 * gutter;
  const scale = targetWidth / totalW;

  g.group.scale.setScalar(scale);
  e.group.scale.setScalar(scale);
  o.group.scale.setScalar(scale);

  const sG = gW * scale;
  const sE = eW * scale;
  const sO = oW * scale;

  const startX = -targetWidth / 2;
  g.group.position.x = startX + sG / 2;
  e.group.position.x = startX + sG + gutter + sE / 2;
  o.group.position.x = startX + sG + gutter + sE + gutter + sO / 2;

  g.group.position.y = -g.bbox.minY * scale;
  e.group.position.y = -e.bbox.minY * scale;
  o.group.position.y = -o.bbox.minY * scale;

  const group = new Group();
  group.add(g.group, e.group, o.group);

  return {
    group,
    letters: [g, e, o],
    width: targetWidth,
    lineMaterials: [g.lines.material, e.lines.material, o.lines.material] as LineMaterial[],
  };
}