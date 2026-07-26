export interface ResolvedStyle {
  stroke: string; strokeWidth: number; dash: string | null;
  arrow: 'none' | '->' | '<-' | '<->';
  fill: string | null; fillOpacity: number; opacity: number;
}

const INK = '#251f1a';
export const DEFAULT_STYLE: ResolvedStyle = {
  stroke: INK, strokeWidth: 1, dash: null, arrow: 'none',
  fill: null, fillOpacity: 0.25, opacity: 1,
};

const COLORS: Record<string, string> = {
  red: '#ff0000', blue: '#0000ff', green: '#008000', black: INK, gray: '#808080', orange: '#ffa500',
  purple: '#800080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00',
  olive: '#808000', pink: '#ffc0cb', teal: '#008080', violet: '#ee82ee', yellow: '#ffd700', white: '#ffffff',
};
const WIDTHS: Record<string, number> = {
  'ultra thin': 0.4, 'very thin': 0.6, thin: 0.8, semithick: 1, thick: 1.4, 'very thick': 2, 'ultra thick': 3,
};
const DASHES: Record<string, string> = {
  dashed: '6 4', 'densely dashed': '3 2.5', dotted: '1.5 3', 'dash dot': '6 3 1.5 3',
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function resolveColor(token: string): string | null {
  // black!N → rgba(37,31,26,N/100); color!N → rgba(...)
  const m = /^([a-z]+)!([0-9]+)$/i.exec(token);
  if (m) {
    const c = COLORS[m[1].toLowerCase()];
    if (!c) return null;
    const n = Math.max(0, Math.min(100, Number(m[2]))) / 100;
    const [r, g, b] = hexToRgb(c);
    return `rgba(${r},${g},${b},${n})`;
  }
  return COLORS[token.toLowerCase()] ?? null;
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

  const opts = raw.split(',').map(s => s.trim()).filter(Boolean);
  let hasArrow = false;
  for (const opt of opts) {
    if (/^->$/.test(opt)) { base.arrow = '->'; hasArrow = true; continue; }
    if (/^<-$/.test(opt)) { base.arrow = '<-'; hasArrow = true; continue; }
    if (/^<->$/.test(opt)) { base.arrow = '<->'; hasArrow = true; continue; }
    if (/^>=/.test(opt)) continue;
    const lw = /^line\s*width\s*=\s*([\d.]+)pt$/.exec(opt);
    if (lw) { base.strokeWidth = Math.round(Number(lw[1]) * 1.333 * 1000) / 1000; continue; }
    const fo = /^fill\s*opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (fo) { base.fillOpacity = Number(fo[1]); continue; }
    const op = /^opacity\s*=\s*([\d.]+)$/.exec(opt);
    if (op) { base.opacity = Number(op[1]); continue; }
    const fc = /^fill\s*=\s*(.+)$/.exec(opt);
    if (fc) {
      const c = resolveColor(fc[1]);
      if (c) base.fill = c;
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
  const opts = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const opt of opts) {
    if (ANCHORS.has(opt)) return opt;
    // composite: pick first anchor token (e.g. 'above right', 'above right of=A')
    for (const a of ANCHORS) {
      if (opt.startsWith(a + ' ') || opt.startsWith(a + '\t') || opt.startsWith(a + ',')) return opt;
    }
  }
  return 'above';
}