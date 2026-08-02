import type { Pt } from '../semantics/calc-eval';

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function labelOffset(anchor: string): Pt {
  const normalized = anchor.toLowerCase();
  let x = 0;
  let y = 0;
  if (normalized.includes('above') || normalized.includes('north')) y -= 6;
  if (normalized.includes('below') || normalized.includes('south')) y += 16;
  if (normalized.includes('left') || normalized.includes('west')) x -= 6;
  if (normalized.includes('right') || normalized.includes('east')) x += 6;
  if (normalized.includes('base')) y += 4;
  if (normalized.includes('mid')) y += 2;
  return { x, y };
}

export function labelScreenBounds(at: Pt, text: string, anchor: string): ScreenBounds {
  const offset = labelOffset(anchor);
  const baseline = {
    x: at.x + offset.x,
    y: at.y + offset.y,
  };
  const visibleText = text.replace(/\$/g, '');
  const width = Math.max(10, Array.from(visibleText).length * 8);

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
    top: baseline.y - 14,
    right,
    bottom: baseline.y + 3,
  };
}
