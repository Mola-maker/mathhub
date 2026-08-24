import type { Pt } from '../semantics/calc-eval';

export interface AxisAlignedEllipse {
  readonly center: Pt;
  readonly xRadius: number;
  readonly yRadius: number;
  readonly rotationDegrees?: number;
}

export interface EllipseLinearTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export interface CanonicalEllipseAxes {
  /** Major semi-axis in world units. */
  readonly xRadius: number;
  /** Minor semi-axis in world units. */
  readonly yRadius: number;
  /** Counter-clockwise angle of the major semi-axis in world space. */
  readonly rotationDegrees: number;
}

const ELLIPSE_EPSILON = 1e-12;

function canonicalDegrees(radians: number): number {
  let degrees = radians * 180 / Math.PI;
  // An unoriented ellipse is unchanged after 180 degrees. Keeping one
  // half-open interval makes GeometryDoc, AI context and SVG deterministic.
  degrees = ((degrees + 90) % 180 + 180) % 180 - 90;
  const rounded = Math.round(degrees * 1e12) / 1e12;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Canonicalize the image of an axis-aligned ellipse under an invertible 2D
 * linear map. This is the left-singular system of
 * `transform * diag(xRadius, yRadius)` and therefore also covers circles,
 * non-uniform scales, reflections and slants without sampling.
 */
export function affineEllipseAxes(
  transform: EllipseLinearTransform | undefined,
  xRadius: number,
  yRadius: number,
): CanonicalEllipseAxes {
  const a = (transform?.a ?? 1) * xRadius;
  const b = (transform?.b ?? 0) * xRadius;
  const c = (transform?.c ?? 0) * yRadius;
  const d = (transform?.d ?? 1) * yRadius;
  const xx = a * a + c * c;
  const xy = a * b + c * d;
  const yy = b * b + d * d;
  const trace = xx + yy;
  const discriminant = Math.hypot(xx - yy, 2 * xy);
  const majorSquared = (trace + discriminant) / 2;
  const minorSquared = (trace - discriminant) / 2;
  if (
    ![a, b, c, d, majorSquared, minorSquared].every(Number.isFinite)
    || majorSquared <= ELLIPSE_EPSILON
    || minorSquared <= ELLIPSE_EPSILON
  ) {
    throw new TypeError('Affine ellipse projection requires finite positive radii and an invertible transform.');
  }
  // When both singular values coincide the axis is mathematically
  // indeterminate. Zero is the least surprising canonical presentation.
  const rotationRadians = discriminant <= ELLIPSE_EPSILON * Math.max(1, trace)
    ? 0
    : 0.5 * Math.atan2(2 * xy, xx - yy);
  return {
    xRadius: Math.sqrt(majorSquared),
    yRadius: Math.sqrt(Math.max(0, minorSquared)),
    rotationDegrees: canonicalDegrees(rotationRadians),
  };
}

export function flattenEllipse(
  ellipse: AxisAlignedEllipse,
  segments = 72,
): readonly Pt[] {
  const count = Math.max(12, Math.min(360, Math.floor(segments)));
  const rotation = ((ellipse.rotationDegrees ?? 0) * Math.PI) / 180;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    const localX = Math.cos(angle) * ellipse.xRadius;
    const localY = Math.sin(angle) * ellipse.yRadius;
    return {
      x: ellipse.center.x + localX * cosRotation - localY * sinRotation,
      y: ellipse.center.y + localX * sinRotation + localY * cosRotation,
    };
  });
}
