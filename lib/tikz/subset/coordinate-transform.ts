import type { CoordExpr, SourceRange, Statement } from './ast';
import type { Pt } from '../semantics/calc-eval';
import type { TikzOptionSequence } from '../syntax/option-sequence';

/**
 * TikZ's coordinate transformation matrix in scene centimetres.
 *
 * It maps `(x,y)` to `(a*x + c*y + e, b*x + d*y + f)`.  This is the
 * coordinate matrix, not `transform canvas`: line widths and node glyphs are
 * deliberately outside this value.
 */
export interface TikzCoordinateTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
  readonly sourceRanges?: readonly SourceRange[];
}

export const IDENTITY_TIKZ_COORDINATE_TRANSFORM: TikzCoordinateTransform = {
  a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
};

const EPSILON = 1e-10;

export function isIdentityTikzCoordinateTransform(
  transform: TikzCoordinateTransform | undefined,
): boolean {
  if (!transform) return true;
  return Math.abs(transform.a - 1) < EPSILON
    && Math.abs(transform.b) < EPSILON
    && Math.abs(transform.c) < EPSILON
    && Math.abs(transform.d - 1) < EPSILON
    && Math.abs(transform.e) < EPSILON
    && Math.abs(transform.f) < EPSILON;
}

/** Compose transforms in source order: the inner transform runs first. */
export function composeTikzCoordinateTransforms(
  outer: TikzCoordinateTransform,
  inner: TikzCoordinateTransform,
): TikzCoordinateTransform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
    sourceRanges: [
      ...(outer.sourceRanges ?? []),
      ...(inner.sourceRanges ?? []),
    ],
  };
}

export function applyTikzCoordinateTransform(
  transform: TikzCoordinateTransform | undefined,
  point: Pt,
): Pt {
  if (!transform) return point;
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

export function inverseTikzCoordinateTransform(
  transform: TikzCoordinateTransform | undefined,
): TikzCoordinateTransform {
  if (!transform || isIdentityTikzCoordinateTransform(transform)) {
    return IDENTITY_TIKZ_COORDINATE_TRANSFORM;
  }
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) {
    throw new TypeError('TikZ coordinate transform is singular and cannot be written back.');
  }
  const a = transform.d / determinant;
  const b = -transform.b / determinant;
  const c = -transform.c / determinant;
  const d = transform.a / determinant;
  return {
    a, b, c, d,
    e: -(a * transform.e + c * transform.f),
    f: -(b * transform.e + d * transform.f),
  };
}

export function sourceCoordinateForWorldPoint(
  transform: TikzCoordinateTransform | undefined,
  worldPoint: Pt,
): Pt {
  return applyTikzCoordinateTransform(
    inverseTikzCoordinateTransform(transform),
    worldPoint,
  );
}

export function tikzCoordinateTransformScale(
  transform: TikzCoordinateTransform | undefined,
): number {
  if (!transform) return 1;
  const xScale = Math.hypot(transform.a, transform.b);
  const yScale = Math.hypot(transform.c, transform.d);
  const dot = transform.a * transform.c + transform.b * transform.d;
  if (
    !Number.isFinite(xScale)
    || !Number.isFinite(yScale)
    || xScale < EPSILON
    || Math.abs(xScale - yScale) > EPSILON * Math.max(1, xScale, yScale)
    || Math.abs(dot) > EPSILON * Math.max(1, xScale * yScale)
  ) {
    throw new TypeError('Interactive scope projection only supports non-singular similarity transforms.');
  }
  return xScale;
}

/** True when the linear CTM preserves angles and uniform lengths up to scale. */
export function isTikzCoordinateTransformSimilarity(
  transform: TikzCoordinateTransform | undefined,
): boolean {
  try {
    tikzCoordinateTransformScale(transform);
    return true;
  } catch {
    return false;
  }
}

export function tikzCoordinateTransformRotationDegrees(
  transform: TikzCoordinateTransform | undefined,
): number {
  if (!transform) return 0;
  tikzCoordinateTransformScale(transform);
  const degrees = Math.atan2(transform.b, transform.a) * 180 / Math.PI;
  // A textual `rotate=30` must not become a noisy 29.999999999999993 in
  // GeometryDoc, AI context, source proofs, or SVG attributes.
  const canonical = Math.round(degrees * 1e12) / 1e12;
  return Object.is(canonical, -0) ? 0 : canonical;
}

const LENGTH_FACTORS: Readonly<Record<string, number>> = {
  '': 1,
  cm: 1,
  mm: 0.1,
  in: 2.54,
  pt: 2.54 / 72.27,
};

function finiteNumber(raw: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw.trim())) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function lengthInCentimetres(raw: string): number | null {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(cm|mm|in|pt)?\s*$/iu.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  const factor = LENGTH_FACTORS[match[2]?.toLowerCase() ?? ''];
  return Number.isFinite(value) && factor !== undefined ? value * factor : null;
}

function literalPoint(raw: string): Pt | null {
  const unwrapped = raw.trim().replace(/^\{([\s\S]*)\}$/u, '$1').trim();
  const match = /^\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)$/u.exec(unwrapped);
  if (!match) return null;
  const x = lengthInCentimetres(match[1]!);
  const y = lengthInCentimetres(match[2]!);
  return x === null || y === null ? null : { x, y };
}

function translation(x: number, y: number, range: SourceRange): TikzCoordinateTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y, sourceRanges: [range] };
}

function rotation(degrees: number, range: SourceRange): TikzCoordinateTransform {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0, sourceRanges: [range] };
}

function uniformScale(factor: number, range: SourceRange): TikzCoordinateTransform {
  return { a: factor, b: 0, c: 0, d: factor, e: 0, f: 0, sourceRanges: [range] };
}

function affineLinear(
  a: number,
  b: number,
  c: number,
  d: number,
  range: SourceRange,
): TikzCoordinateTransform | null {
  const determinant = a * d - b * c;
  return [a, b, c, d, determinant].every(Number.isFinite)
    && Math.abs(determinant) >= EPSILON
    ? { a, b, c, d, e: 0, f: 0, sourceRanges: [range] }
    : null;
}

function splitStaticCsv(raw: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (char === ',' && depth === 0) {
      parts.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(raw.slice(start).trim());
  return parts;
}

function staticCm(value: string, range: SourceRange): TikzCoordinateTransform | null {
  const unwrapped = value.trim().replace(/^\{([\s\S]*)\}$/u, '$1').trim();
  const parts = splitStaticCsv(unwrapped);
  if (!parts || parts.length !== 5) return null;
  const [a, b, c, d] = parts.slice(0, 4).map(finiteNumber);
  const shift = literalPoint(parts[4]!);
  if (a === null || b === null || c === null || d === null || !shift) return null;
  const linear = affineLinear(a, b, c, d, range);
  return linear
    ? { ...linear, e: shift.x, f: shift.y, sourceRanges: [range] }
    : null;
}

function around(
  center: Pt,
  inner: TikzCoordinateTransform,
  range: SourceRange,
): TikzCoordinateTransform {
  return composeTikzCoordinateTransforms(
    translation(center.x, center.y, range),
    composeTikzCoordinateTransforms(inner, translation(-center.x, -center.y, range)),
  );
}

export interface TikzTransformOptionProjection {
  readonly transform: TikzCoordinateTransform;
  readonly recognizedCount: number;
  readonly unsupportedEntries: readonly string[];
}

/**
 * Interpret the bounded, static coordinate-transform subset without executing
 * pgfkeys. Unknown entries are returned to the caller; scopes must reject them,
 * while a path can keep treating them as presentation options.
 */
export function projectTikzCoordinateTransformOptions(
  sequence: TikzOptionSequence,
): TikzTransformOptionProjection {
  let transform = IDENTITY_TIKZ_COORDINATE_TRANSFORM;
  let recognizedCount = 0;
  const unsupportedEntries: string[] = [];
  for (const entry of sequence.entries) {
    const key = entry.interpretedKey.replace(/^\/tikz\//u, '').trim().toLowerCase();
    const value = entry.interpretedValue;
    const range = { start: entry.range.start, end: entry.range.end };
    let next: TikzCoordinateTransform | null = null;
    if (key === 'xshift' && value !== null) {
      const x = lengthInCentimetres(value);
      if (x !== null) next = translation(x, 0, range);
    } else if (key === 'yshift' && value !== null) {
      const y = lengthInCentimetres(value);
      if (y !== null) next = translation(0, y, range);
    } else if (key === 'shift' && value !== null) {
      const point = literalPoint(value);
      if (point) next = translation(point.x, point.y, range);
    } else if (key === 'rotate' && value !== null) {
      const degrees = finiteNumber(value);
      if (degrees !== null) next = rotation(degrees, range);
    } else if (key === 'scale' && value !== null) {
      const factor = finiteNumber(value);
      if (factor !== null && Math.abs(factor) >= EPSILON) next = uniformScale(factor, range);
    } else if ((key === 'xscale' || key === 'yscale') && value !== null) {
      const factor = finiteNumber(value);
      if (factor !== null && Math.abs(factor) >= EPSILON) {
        next = key === 'xscale'
          ? affineLinear(factor, 0, 0, 1, range)
          : affineLinear(1, 0, 0, factor, range);
      }
    } else if ((key === 'xslant' || key === 'yslant') && value !== null) {
      const factor = finiteNumber(value);
      if (factor !== null) {
        next = key === 'xslant'
          ? affineLinear(1, 0, factor, 1, range)
          : affineLinear(1, factor, 0, 1, range);
      }
    } else if (key === 'cm' && value !== null) {
      next = staticCm(value, range);
    } else if ((key === 'rotate around' || key === 'scale around') && value !== null) {
      const unwrapped = value.trim().replace(/^\{([\s\S]*)\}$/u, '$1').trim();
      const match = /^([^:]+):\s*(\([\s\S]+\))$/u.exec(unwrapped);
      const scalar = match ? finiteNumber(match[1]!) : null;
      const center = match ? literalPoint(match[2]!) : null;
      if (scalar !== null && center && (key !== 'scale around' || Math.abs(scalar) >= EPSILON)) {
        next = around(
          center,
          key === 'rotate around' ? rotation(scalar, range) : uniformScale(scalar, range),
          range,
        );
      }
    }
    if (!next) {
      unsupportedEntries.push(entry.interpreted || entry.raw);
      continue;
    }
    recognizedCount += 1;
    transform = composeTikzCoordinateTransforms(transform, next);
  }
  return { transform, recognizedCount, unsupportedEntries };
}

function coordIsStatic(expr: CoordExpr): boolean {
  return expr.kind === 'literal' || expr.kind === 'ref';
}

/** True when applying a similarity CTM cannot fabricate partial geometry. */
export function statementSupportsTikzCoordinateTransform(
  statement: Statement,
  transform?: TikzCoordinateTransform,
): boolean {
  const similarity = isTikzCoordinateTransformSimilarity(transform);
  switch (statement.kind) {
    case 'coordinate':
      return coordIsStatic(statement.at);
    case 'let-coordinate':
      return false;
    case 'node':
      return coordIsStatic(statement.at);
    case 'pic':
    case 'graph':
      return similarity;
    case 'path':
      return statement.specs.every((spec) => {
        switch (spec.type) {
          case 'polyline': return spec.points.every(coordIsStatic);
          // Rectangle corners are axis-aligned in TikZ's active coordinate
          // space. Until the CTM-aware corner construction is proven for
          // external named coordinates, transformed rectangles stay opaque.
          case 'rectangle': return false;
          case 'cubic-bezier': return [spec.start, spec.control1, spec.control2, spec.end].every(coordIsStatic);
          case 'circular-arc': return coordIsStatic(spec.start);
          // An invertible affine image of an ellipse is still an ellipse. The
          // semantic layer canonicalizes its two singular axes in world space.
          case 'ellipse': return coordIsStatic(spec.center);
          // A literal-radius circle has a complete affine image. `circle
          // through`, however, is a construction-time radius calculation and
          // remains similarity-only until its execution provenance is modeled.
          case 'circle': return coordIsStatic(spec.center)
            && (spec.radius.kind === 'literal'
              || (similarity && coordIsStatic(spec.radius.point)));
        }
      });
  }
}
