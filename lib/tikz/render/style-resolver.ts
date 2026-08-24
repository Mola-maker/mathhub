import { orderedTikzOptionValues } from '../syntax/option-sequence';

export interface ResolvedStyle {
  stroke: string; strokeWidth: number; dash: string | null;
  dashOffset: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  arrow: 'none' | '->' | '<-' | '<->';
  arrowTip: 'to' | 'stealth' | 'latex';
  fill: string | null;
  strokeOpacity: number;
  fillOpacity: number;
  textOpacity: number;
  opacity: number;
}

/**
 * dvisvgm exposes TeX points in CSS-pixel space. Keeping the interactive
 * renderer on the same conversion prevents a style jump when exact preview is
 * toggled. TikZ's default line width is 0.4pt.
 */
export const TEX_POINT_TO_CSS_PX = 96 / 72.27;
const px = (points: number) => Math.round(points * TEX_POINT_TO_CSS_PX * 1000) / 1000;
const INK = '#000000';
export const DEFAULT_STYLE: ResolvedStyle = {
  stroke: INK, strokeWidth: px(0.4), dash: null, dashOffset: 0,
  lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, arrow: 'none', arrowTip: 'to',
  fill: null, strokeOpacity: 1, fillOpacity: 1, textOpacity: 1, opacity: 1,
};

const COLORS: Record<string, string> = {
  red: '#ff0000', blue: '#0000ff', green: '#008000', black: INK, gray: '#808080', orange: '#ffa500',
  purple: '#800080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00',
  olive: '#808000', pink: '#ffc0cb', teal: '#008080', violet: '#ee82ee', yellow: '#ffd700', white: '#ffffff',
};
const WIDTHS: Record<string, number> = {
  'ultra thin': px(0.1),
  'very thin': px(0.2),
  thin: px(0.4),
  semithick: px(0.6),
  thick: px(0.8),
  'very thick': px(1.2),
  'ultra thick': px(1.6),
};
const DASHES: Record<string, string> = {
  dashed: `${px(3)} ${px(3)}`,
  'densely dashed': `${px(3)} ${px(2)}`,
  dotted: `0 ${px(2)}`,
  'dash dot': `${px(3)} ${px(2)} ${px(0.4)} ${px(2)}`,
};
const PT_DIMENSION = /(-?(?:\d+(?:\.\d*)?|\.\d+))pt/u;

function dimensionPoints(raw: string): number | null {
  const match = new RegExp(`^\\s*${PT_DIMENSION.source}\\s*$`, 'u').exec(raw);
  return match ? Number(match[1]) : null;
}

function customDashPattern(raw: string): string | null {
  const tokens = [...raw.matchAll(
    new RegExp(`\\b(on|off)\\s+${PT_DIMENSION.source}`, 'gu'),
  )];
  if (tokens.length < 2 || tokens[0]?.[1] !== 'on') return null;
  let expected: 'on' | 'off' = 'on';
  const values: number[] = [];
  for (const token of tokens) {
    if (token[1] !== expected) return null;
    const value = Number(token[2]);
    if (!Number.isFinite(value) || value < 0) return null;
    values.push(px(value));
    expected = expected === 'on' ? 'off' : 'on';
  }
  const consumed = tokens.map((token) => token[0]).join(' ');
  if (raw.replace(/\s+/gu, ' ').trim() !== consumed.replace(/\s+/gu, ' ').trim()) {
    return null;
  }
  return values.join(' ');
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function resolveColor(token: string): string | null {
  // xcolor's `color!N` is a mix of N% color and (100-N)% white,
  // not alpha transparency. Opacity remains an independent TikZ option.
  const m = /^([a-z]+)!([0-9]+)$/i.exec(token);
  if (m) {
    const c = COLORS[m[1].toLowerCase()];
    if (!c) return null;
    const n = Math.max(0, Math.min(100, Number(m[2]))) / 100;
    const [r, g, b] = hexToRgb(c);
    const mix = (channel: number) => Math.round(channel * n + 255 * (1 - n));
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }
  return COLORS[token.toLowerCase()] ?? null;
}

/** Conservative capability predicate for inherited scope presentation keys. */
export function isInteractivePresentationOption(option: string): boolean {
  const opt = option.trim();
  if (['->', '<-', '<->', 'draw', 'fill'].includes(opt)) return true;
  if (/^>=\s*\{?\s*(?:To|>|Stealth|Latex)\s*\}?$/iu.test(opt)) return true;
  if (/^line\s*width\s*=\s*[\d.]+pt$/u.test(opt)) return true;
  if (/^line\s*cap\s*=\s*(?:round|rect|butt)$/u.test(opt)) return true;
  if (/^line\s*join\s*=\s*(?:round|bevel|miter)$/u.test(opt)) return true;
  if (/^miter\s*limit\s*=\s*(?:\d+(?:\.\d*)?|\.\d+)$/u.test(opt)) return true;
  if (/^dash\s*phase\s*=\s*-?(?:\d+(?:\.\d*)?|\.\d+)pt$/u.test(opt)) return true;
  if (/^dash\s*pattern\s*=/.test(opt)) {
    return customDashPattern(opt.slice(opt.indexOf('=') + 1)) !== null;
  }
  const dash = /^dash\s*=\s*(.+)\s+phase\s+(-?(?:\d+(?:\.\d*)?|\.\d+)pt)$/u.exec(opt);
  if (dash) {
    return customDashPattern(dash[1]) !== null && dimensionPoints(dash[2]) !== null;
  }
  if (/^(?:draw\s*opacity|fill\s*opacity|text\s*opacity|opacity)\s*=\s*[\d.]+$/u.test(opt)) return true;
  if (/^(?:draw|fill|color)\s*=\s*.+$/u.test(opt)) return true;
  return WIDTHS[opt] !== undefined
    || DASHES[opt] !== undefined
    || resolveColor(opt) !== null;
}

export function resolveStyle(
  raw: string | null,
  command: 'draw' | 'path' | 'fill' | 'filldraw' | 'node' | 'pic',
): ResolvedStyle {
  const base: ResolvedStyle = {
    ...DEFAULT_STYLE,
    fill: command === 'fill' || command === 'filldraw' ? INK : null,
  };
  if (command === 'path') base.stroke = 'none';

  if (!raw) return base;

  const opts = orderedTikzOptionValues(raw);
  let hasArrow = false;
  for (const opt of opts) {
    if (/^->$/.test(opt)) { base.arrow = '->'; hasArrow = true; continue; }
    if (/^<-$/.test(opt)) { base.arrow = '<-'; hasArrow = true; continue; }
    if (/^<->$/.test(opt)) { base.arrow = '<->'; hasArrow = true; continue; }
    const arrowTip = /^>=\s*\{?\s*(To|>|Stealth|Latex)\s*\}?$/iu.exec(opt);
    if (arrowTip) {
      const value = arrowTip[1]!.toLowerCase();
      base.arrowTip = value === 'stealth' ? 'stealth' : value === 'latex' ? 'latex' : 'to';
      continue;
    }
    const lw = /^line\s*width\s*=\s*([\d.]+)pt$/.exec(opt);
    if (lw) { base.strokeWidth = px(Number(lw[1])); continue; }
    const lineCap = /^line\s*cap\s*=\s*(round|rect|butt)$/.exec(opt);
    if (lineCap) {
      base.lineCap = lineCap[1] === 'rect' ? 'square' : lineCap[1] as 'round' | 'butt';
      continue;
    }
    const lineJoin = /^line\s*join\s*=\s*(round|bevel|miter)$/.exec(opt);
    if (lineJoin) {
      base.lineJoin = lineJoin[1] as ResolvedStyle['lineJoin'];
      continue;
    }
    const miterLimit = /^miter\s*limit\s*=\s*(\d+(?:\.\d*)?|\.\d+)$/.exec(opt);
    if (miterLimit) {
      base.miterLimit = Number(miterLimit[1]);
      continue;
    }
    const dashPattern = /^dash\s*pattern\s*=\s*(.+)$/.exec(opt);
    if (dashPattern) {
      const parsed = customDashPattern(dashPattern[1]);
      if (parsed !== null) base.dash = parsed;
      continue;
    }
    const dashPhase = /^dash\s*phase\s*=\s*(.+)$/.exec(opt);
    if (dashPhase) {
      const points = dimensionPoints(dashPhase[1]);
      if (points !== null) base.dashOffset = px(points);
      continue;
    }
    const dash = /^dash\s*=\s*(.+)\s+phase\s+(-?(?:\d+(?:\.\d*)?|\.\d+)pt)$/.exec(opt);
    if (dash) {
      const parsed = customDashPattern(dash[1]);
      const points = dimensionPoints(dash[2]);
      if (parsed !== null && points !== null) {
        base.dash = parsed;
        base.dashOffset = px(points);
      }
      continue;
    }
    const fo = /^fill\s*opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (fo) { base.fillOpacity = Number(fo[1]); continue; }
    const drawOpacity = /^draw\s*opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (drawOpacity) { base.strokeOpacity = Number(drawOpacity[1]); continue; }
    const textOpacity = /^text\s*opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (textOpacity) { base.textOpacity = Number(textOpacity[1]); continue; }
    const op = /^opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (op) { base.opacity = Number(op[1]); continue; }
    if (opt === 'draw') {
      if (base.stroke === 'none') base.stroke = INK;
      continue;
    }
    const draw = /^draw\s*=\s*(.+)$/.exec(opt);
    if (draw) {
      if (draw[1].trim() === 'none') base.stroke = 'none';
      else {
        const color = resolveColor(draw[1].trim());
        if (color) base.stroke = color;
      }
      continue;
    }
    const colorOption = /^color\s*=\s*(.+)$/.exec(opt);
    if (colorOption) {
      const color = resolveColor(colorOption[1].trim());
      if (color) {
        base.stroke = color;
        if (base.fill !== null) base.fill = color;
      }
      continue;
    }
    if (opt === 'fill') {
      base.fill = base.stroke === 'none' ? INK : base.stroke;
      continue;
    }
    const fc = /^fill\s*=\s*(.+)$/.exec(opt);
    if (fc) {
      if (fc[1].trim() === 'none') base.fill = null;
      else {
        const c = resolveColor(fc[1].trim());
        if (c) base.fill = c;
      }
      continue;
    }
    if (WIDTHS[opt]) { base.strokeWidth = WIDTHS[opt]; continue; }
    if (DASHES[opt]) { base.dash = DASHES[opt]; continue; }
    const c = resolveColor(opt);
    if (c) {
      if (opt.includes('!')) base.stroke = c; // grayscale → affects stroke
      else base.stroke = c;
      continue;
    }
  }
  // For fill/filldraw: if no explicit fill color was set, default fill = stroke color
  if ((command === 'fill' || command === 'filldraw') && base.fill === INK) base.fill = base.stroke;
  void hasArrow;
  return base;
}

const ANCHORS = new Set(['above', 'below', 'left', 'right', 'center', 'base', 'mid', 'north', 'south', 'east', 'west']);

export function anchorFromRaw(raw: string | null): string {
  if (!raw) return 'above';
  const opts = orderedTikzOptionValues(raw);
  for (const opt of opts) {
    if (ANCHORS.has(opt)) return opt;
    // composite: pick first anchor token (e.g. 'above right', 'above right of=A')
    for (const a of ANCHORS) {
      if (opt.startsWith(a + ' ') || opt.startsWith(a + '\t') || opt.startsWith(a + ',')) return opt;
    }
  }
  return 'above';
}
