import type { Viewport } from './viewport';
import { tikzPresentationScale } from './viewport';

const NUMBER = /-?(?:\d+(?:\.\d*)?|\.\d+)/gu;

export function presentationStrokeWidth(
  naturalCssPixels: number,
  viewport: Pick<Viewport, 'scale'>,
): number {
  return naturalCssPixels * tikzPresentationScale(viewport);
}

export function presentationDashArray(
  naturalDash: string | null | undefined,
  viewport: Pick<Viewport, 'scale'>,
): string | undefined {
  if (!naturalDash) return undefined;
  const scale = tikzPresentationScale(viewport);
  return naturalDash.replace(NUMBER, (token) => {
    const value = Number(token) * scale;
    return String(Math.round(value * 1_000) / 1_000);
  });
}

export function presentationDashOffset(
  naturalOffset: number | null | undefined,
  viewport: Pick<Viewport, 'scale'>,
): number | undefined {
  if (naturalOffset === null || naturalOffset === undefined || naturalOffset === 0) {
    return undefined;
  }
  return naturalOffset * tikzPresentationScale(viewport);
}

export function presentationFont(
  naturalFont: string,
  viewport: Pick<Viewport, 'scale'>,
): string {
  const scale = tikzPresentationScale(viewport);
  return naturalFont.replace(/(\d+(?:\.\d+)?)px/u, (_token, size: string) => (
    `${Math.round(Number(size) * scale * 1_000) / 1_000}px`
  ));
}
