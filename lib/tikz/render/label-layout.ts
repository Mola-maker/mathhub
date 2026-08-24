import type { Pt } from '../semantics/calc-eval';
import { NATURAL_CM_TO_CSS_PX } from './viewport';

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function labelOffset(anchor: string, presentationScale = 1): Pt {
  const normalized = anchor.toLowerCase();
  let x = 0;
  let y = 0;
  if (normalized.includes('above') || normalized.includes('north')) y -= 6;
  if (normalized.includes('below') || normalized.includes('south')) y += 16;
  if (normalized.includes('left') || normalized.includes('west')) x -= 6;
  if (normalized.includes('right') || normalized.includes('east')) x += 6;
  if (normalized.includes('base')) y += 4;
  if (normalized.includes('mid')) y += 2;
  return { x: x * presentationScale, y: y * presentationScale };
}

export function labelScreenBounds(
  at: Pt,
  text: string,
  anchor: string,
  presentationScale = 1,
): ScreenBounds {
  const offset = labelOffset(anchor, presentationScale);
  const baseline = {
    x: at.x + offset.x,
    y: at.y + offset.y,
  };
  const visibleText = text.replace(/\$/g, '');
  const width = Math.max(10, Array.from(visibleText).length * 8) * presentationScale;

  let left = baseline.x - width / 2;
  let right = baseline.x + width / 2;
  if (offset.x < 0) {
    left = baseline.x - width;
    right = baseline.x;
  } else if (offset.x > 0) {
    left = baseline.x;
    right = baseline.x + width;
  }

  return {
    left,
    top: baseline.y - 14 * presentationScale,
    right,
    bottom: baseline.y + 3 * presentationScale,
  };
}

/**
 * Approximate the TeX label ink box in scene centimetres at natural 96dpi.
 *
 * fitViewport later scales this physical box together with the geometry. This
 * mirrors dvisvgm's tight viewBox much more closely than treating a label as a
 * zero-area anchor, while hit testing and rendering keep using screen bounds.
 */
export function labelSceneFitPoints(at: Pt, text: string, anchor: string): readonly Pt[] {
  const bounds = labelScreenBounds({ x: 0, y: 0 }, text, anchor);
  const normalized = anchor.toLowerCase();
  // The exact renderer wraps the source in standalone[border=2pt]. Browser
  // labels use live fonts instead of TeX paths, so include the measured
  // dvisvgm side bearing in fit truth and clamp the two common vertical
  // anchors to the exact ink+wrapper extent. This changes only auto-fit; hit
  // testing and the visible label offset keep their authoring behavior.
  const horizontalWrapperBearing = 3.5;
  const exactVerticalExtent = 18;
  const left = bounds.left - horizontalWrapperBearing;
  const right = bounds.right + horizontalWrapperBearing;
  const top = normalized.includes('above') || normalized.includes('north')
    ? Math.max(bounds.top, -exactVerticalExtent)
    : bounds.top;
  const bottom = normalized.includes('below') || normalized.includes('south')
    ? Math.min(bounds.bottom, exactVerticalExtent)
    : bounds.bottom;
  return [
    { x: at.x + left / NATURAL_CM_TO_CSS_PX, y: at.y - top / NATURAL_CM_TO_CSS_PX },
    { x: at.x + right / NATURAL_CM_TO_CSS_PX, y: at.y - top / NATURAL_CM_TO_CSS_PX },
    { x: at.x + right / NATURAL_CM_TO_CSS_PX, y: at.y - bottom / NATURAL_CM_TO_CSS_PX },
    { x: at.x + left / NATURAL_CM_TO_CSS_PX, y: at.y - bottom / NATURAL_CM_TO_CSS_PX },
  ];
}
