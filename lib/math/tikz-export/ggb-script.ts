// Parse a GeoGebra command script (the exact lines the Math-Studio pipeline
// evalCommand-ed to build a figure, e.g. `M=Midpoint(B,Q)`, `Segment(A,B)`,
// `omega=Circle(M,A)`, `F=Intersect(segDE,omega,1)`, `SetColor(omega,"blue")`)
// into the GgbObject IR the TikZ transpiler consumes.
//
// Why this exists: the self-hosted GWT GeoGebra bundle returns empty from
// getCommandString, so reading the live applet loses every construction
// relationship (points come back "free", segments have no endpoints). The
// command script is the reliable, semantic source of what was drawn. We keep
// using the applet only for evaluated coordinates (getXcoord/getYcoord work).

import type { GgbObject } from './ggb-to-tikz';
import { splitTopLevelArgs } from './ggb-to-tikz';

/** Commands whose result is a point. */
const POINT_HEADS = new Set([
  'Point', 'Midpoint', 'Intersect', 'TriangleCenter', 'Centroid', 'Center',
  'Circumcenter', 'Incenter', 'Orthocenter', 'Reflect', 'Rotate', 'Translate',
  'Dilate', 'ClosestPoint', 'Vertex', 'Foot', 'Mirror', 'Corner',
]);
const CONIC_HEADS = new Set([
  'Circle', 'Semicircle', 'Ellipse', 'Hyperbola', 'Parabola', 'Conic',
  'Incircle', 'Circumcircle', 'CircularArc', 'CircumcircularArc',
]);
const LINE_HEADS = new Set([
  'Line', 'PerpendicularLine', 'PerpendicularBisector', 'AngleBisector',
  'Polyline', 'Tangent', 'Polar',
]);

function head(expr: string): string | null {
  const m = expr.trim().match(/^([A-Za-z]+)\s*\(/);
  return m ? m[1] : null;
}

/** Output type of an expression, or null if it's a number / aux / unknown. */
function classify(expr: string): GgbObject['type'] | null {
  const e = expr.trim();
  if (/^\(\s*-?[\d.]/.test(e)) return 'point';   // literal (x, y)
  const h = head(e);
  if (!h) return null;
  if (POINT_HEADS.has(h)) return 'point';
  if (h === 'Segment') return 'segment';
  if (h === 'Ray') return 'ray';
  if (LINE_HEADS.has(h)) return 'line';
  if (CONIC_HEADS.has(h)) return 'conic';
  if (h === 'Polygon') return 'polygon';
  if (h === 'Angle') return 'angle';   // marked in tkz mode (\tkzMarkAngle)
  return null;   // Distance/Length/Area/Vector/Text/Slider/… → not drawn
}

function parseLiteralPoint(expr: string): { x: number; y: number } | null {
  const m = expr.trim().match(/^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00',
  blue: '#0000ff', orange: '#ff7f00', yellow: '#ffff00', purple: '#a020f0',
  magenta: '#ff00ff', cyan: '#00ffff', gray: '#808080', grey: '#808080',
  pink: '#ff7f7f', brown: '#a0522d', darkgray: '#404040', lightgray: '#d3d3d3',
};

function toHex(raw: string): string | undefined {
  const s = raw.trim().replace(/^["']|["']$/g, '');
  if (/^#?[0-9a-f]{6}$/i.test(s)) return s.startsWith('#') ? s : `#${s}`;
  return NAMED_COLORS[s.toLowerCase()];
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '');
}

/**
 * Parse a GeoGebra script into drawable objects. `coordOf` (typically the
 * applet's getXcoord/getYcoord) supplies evaluated point coordinates; literal
 * `A=(x,y)` points are read directly when no applet is available.
 */
export function parseGgbScript(
  commands: string[],
  coordOf?: (name: string) => { x: number; y: number } | null,
): GgbObject[] {
  const objs: GgbObject[] = [];
  const byName = new Map<string, GgbObject>();
  let autoId = 0;

  for (const raw of commands) {
    const line = raw.trim();
    if (!line) continue;

    // styling commands modify an already-seen object
    const sm = line.match(/^(SetColor|SetCaption|ShowLabel|SetLineThickness|SetPointSize|SetLineStyle)\s*\(([\s\S]*)\)\s*$/);
    if (sm) {
      const [, fn, inner] = sm;
      const args = splitTopLevelArgs(inner);
      const target = byName.get(args[0]?.trim());
      if (target && args.length >= 2) {
        if (fn === 'SetColor') target.color = toHex(args[1]);
        else if (fn === 'SetCaption') target.caption = unquote(args[1]);
        else if (fn === 'ShowLabel') target.labelVisible = /true/i.test(args[1]);
        else if (fn === 'SetLineThickness') target.thickness = parseFloat(args[1]) || undefined;
        else if (fn === 'SetLineStyle') target.dashed = (parseFloat(args[1]) || 0) !== 0;
      }
      continue;
    }

    const eq = line.match(/^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/);
    const name = eq ? eq[1] : '';
    const expr = (eq ? eq[2] : line).trim();

    const type = classify(expr);
    if (!type) continue;

    const o: GgbObject = {
      name: name || `__o${autoId++}`,
      type,
      command: expr,
      visible: true,
    };
    if (type === 'point') {
      const c = (name && coordOf?.(name)) || parseLiteralPoint(expr);
      if (c) { o.x = c.x; o.y = c.y; }
    }
    objs.push(o);
    byName.set(o.name, o);
  }
  return objs;
}
