// GeoGebra command reference for the Math Studio assistant.
//
// The model that generates drawings (see app/api/math/route.ts) had no
// command reference and hallucinated invalid syntax. This curated cheat-sheet of
// real, evalCommand-compatible GeoGebra commands is injected into its system
// prompt so it emits valid, professional drawings.
//
// Signatures follow the official manual:
// https://geogebra.github.io/docs/manual/en/commands/

export const GEOGEBRA_REFERENCE = `GEOGEBRA COMMAND REFERENCE (evalCommand syntax — one command per line)

POINTS & INTERSECTIONS
  A=(x, y)                              define a labelled point
  P=Point(<object>)                     point bound to a line/segment/conic/function
  Midpoint(<A>, <B>)   Midpoint(<Segment>)   Midpoint(<Conic>)
  Intersect(<object>, <object>)         single intersection
  Intersect(<object>, <object>, <index>)     nth intersection (index = 1,2,…)
  Intersect(<Function>, <Function>, <startX>)
  Centroid(<Polygon>)

LINES, SEGMENTS, RAYS, VECTORS
  Segment(<A>, <B>)                     Segment(<Point>, <Length>)
  Line(<A>, <B>)                        Line(<Point>, <Parallel Line>)    Line(<Point>, <Direction Vector>)
  Ray(<Start Point>, <Point>)
  Vector(<Start>, <End>)                Vector(<Point>)  (position vector)
  PerpendicularLine(<Point>, <Line>)
  PerpendicularBisector(<A>, <B>)       PerpendicularBisector(<Segment>)
  AngleBisector(<A>, <B>, <C>)          AngleBisector(<Line>, <Line>)
  Tangent(<Point>, <Conic>)             Tangent(<x-value>, <Function>)
  Polyline(<A>, <B>, …)                 open connected path

POLYGONS  (prefer these for closed shapes — they create edges + area)
  Polygon(<A>, <B>, …, <Z>)             polygon through the given vertices
  Polygon(<Point>, <Point>, <Number of Vertices>)   regular polygon

CIRCLES & ARCS
  Circle(<Center>, <Radius>)            Circle(<Center>, <Point>)         Circle(<A>, <B>, <C>)  (through 3 pts)
  Semicircle(<A>, <B>)
  CircularArc(<Center>, <A>, <B>)       CircumcircularArc(<A>, <B>, <C>)
  CircularSector(<Center>, <A>, <B>)    Sector(<Conic>, <Point>, <Point>)
  Incircle(<A>, <B>, <C>)

CONICS
  Ellipse(<Focus>, <Focus>, <Semimajor Axis>)      Ellipse(<Focus>, <Focus>, <Point>)
  Hyperbola(<Focus>, <Focus>, <Semimajor Axis>)    Hyperbola(<Focus>, <Focus>, <Point>)
  Parabola(<Focus Point>, <Directrix Line>)
  Conic(<a>, <b>, <c>, <d>, <e>, <f>)   for a x² + b xy + c y² + d x + e y + f = 0
  Conic(<List of 5 Points>)

FUNCTIONS & CALCULUS
  f(x)=<expression>                     e.g.  f(x)=x^2-3x+2     g(x)=sin(x)
  Function(<Function>, <Start x>, <End x>)   restrict the domain
  Derivative(<Function>)                Derivative(<Function>, <n>)
  Integral(<Function>)                  Integral(<Function>, <Start x>, <End x>)
  Curve(<x-expr>, <y-expr>, <param>, <start>, <end>)   parametric curve
  Spline(<List of Points>)

ANGLES
  Angle(<A>, <Vertex B>, <C>)           the angle ABC
  Angle(<Object>)                       e.g. all interior angles of a polygon
  Angle(<Vector>, <Vector>)

TRANSFORMATIONS  (return the image; the original is kept)
  Translate(<Object>, <Vector>)
  Rotate(<Object>, <Angle>)             Rotate(<Object>, <Angle>, <Center>)   (angle e.g. 90°)
  Reflect(<Object>, <Line>)             Reflect(<Object>, <Point>)
  Dilate(<Object>, <Factor>, <Center>)

MEASUREMENTS (produce numbers)
  Distance(<Point>, <Object>)   Length(<Segment|Vector|List>)   Area(<Conic|Polygon>)
  Radius(<Conic>)   Slope(<Line>)

LISTS, SEQUENCES, TEXT
  L={A, B, C}                           a list (points for discrete commands below)
  Sequence(<expr>, <var>, <from>, <to>)        Sequence(<expr>, <var>, <from>, <to>, <step>)
  Element(<List>, <n>)
  Text("<string>", <Point>)             place an annotation at a point

DISCRETE MATH  (input is a list of points, e.g. L={A,B,C,D})
  ConvexHull(<List of Points>)          Voronoi(<List of Points>)
  DelaunayTriangulation(<List of Points>)
  MinimumSpanningTree(<List of Points>)  TravelingSalesman(<List of Points>)
  ShortestDistance(<List of Segments>, <Start>, <End>, <Weighted Boolean>)

INTERACTIVITY
  Slider(<min>, <max>)                  Slider(<min>, <max>, <increment>)

STYLING  (optional, AFTER the object exists — one per line)
  SetColor(<Object>, "<name or #RRGGBB>")   SetPointSize(<Point>, <size>)
  SetLineThickness(<Object>, <1-13>)        SetCaption(<Object>, "<text>")   ShowLabel(<Object>, true|false)

═══ 3D ═══  (give points a z-coordinate; GeoGebra opens the 3D view automatically)

3D — POINTS, LINES, PLANES
  A=(x, y, z)                           a 3D point (Segment/Line/Ray/Polygon/Vector accept 3D points too)
  Plane(<A>, <B>, <C>)                  Plane(<Point>, <Line>)   Plane(<Point>, <Plane>)   Plane(<Polygon>)
  PerpendicularLine(<Point>, <Plane>)   PerpendicularPlane(<Point>, <Line>)
  Intersect(<Plane>, <Line>)            IntersectConic(<Plane>, <Quadric>)   IntersectPath(<Plane>, <Plane>)
  Distance(<Point>, <Plane>)            Angle(<Plane>, <Plane>)

3D — SOLIDS & SURFACES
  Sphere(<Center>, <Radius>)            Sphere(<Center>, <Point>)
  Cube(<A>, <B>)                        Cube(<A>, <B>, <Direction>)
  Tetrahedron(<A>, <B>)   Octahedron(<A>, <B>)   Dodecahedron(<A>, <B>)   Icosahedron(<A>, <B>)
  Prism(<Polygon>, <Height>)            Prism(<A>, <B>, …, <Top Point>)
  Pyramid(<Polygon>, <Apex Point>)     Pyramid(<Polygon>, <Height>)
  Cone(<Center>, <Apex>, <Radius>)     Cone(<Point>, <Vector>, <Angle>)
  Cylinder(<Bottom Center>, <Top Center>, <Radius>)    Cylinder(<Circle>, <Height>)
  Surface(<x(u,v)>, <y(u,v)>, <z(u,v)>, <u>, <u0>, <u1>, <v>, <v0>, <v1>)   parametric surface
  f(x,y)=<expression>                  z = f(x,y) surface, e.g.  f(x,y)=x^2-y^2
  Net(<Polyhedron>, <Number 0..1>)     Volume(<Solid>)   Surface area via Area(<face>)

MORE FUNCTIONS, SOLVING & PLOTTING
  Solve(<Equation>)   Solve({<eqns>}, {<vars>})   Solutions(<Equation>)   NSolve(<Equation>)
  Roots(<Function>, <Start x>, <End x>)   Extremum(<Function>, <a>, <b>)   InflectionPoint(<Polynomial>)
  ImplicitCurve(<f(x,y)>)              e.g. ImplicitCurve(x^2 + y^2 - 25)
  Sum(<List>)   Product(<List>)   Iteration(<Function>, <Start>, <n>)   Sequence(...)

VIEW
  SetPerspective("T")                  show the 3D view  ("AT" = algebra + 3D, "AG" = algebra + 2D)
  ZoomIn(<factor>)   ZoomOut(<factor>)   SetAxesRatio(<x>, <y>, <z>)`;

/** Construction rules + recipes — the #1 source of evalCommand failures when omitted. */
export const GEOGEBRA_CONSTRUCTION_GUIDE = `
═══ EXECUTION ORDER (mandatory — top to bottom) ═══
1. Labelled coordinates: A=(x,y)   OR   point bound to an EXISTING object (see recipes).
2. Segments / lines / polygons that use those points.
3. Circles / conics.
4. Intersect(...) LAST — only after BOTH parent objects exist on prior lines.
Every symbol (D, E, segDE, omega, F, lineBC) MUST be assigned on its own line BEFORE use.
Never pass bare names like DE or BC to Intersect — create segDE=Segment(D,E) first.

═══ FORBIDDEN (causes "undefined" / syntax errors) ═══
- LaTeX or math markup: $…$, \\frac, \\par, ^, _ outside function(x)=…
- JavaScript: var, let, const, return, function(
- Semicolons joining commands; multiple commands on one line
- Circle(A,B) when AB is a DIAMETER — that means center A, radius |AB|, NOT a diameter circle
- Referencing E, F, E_line, DE, omega before they are created on earlier lines
- Invented commands: Draw, Plot, LineExtension, PointOn, Create, Define, MidPoint (wrong case)
- Triangle centers: use TriangleCenter(A,B,C,3) for circumcenter — NEVER TriangleCircumcenter or Circumcenter
- TikZ/tkz: \\tkzDef, \\tkzDraw, tikzpicture — output GeoGebra only
- Algebraic self-reference: E=(… lengthBC …) when lengthBC was never defined as a number/geo object
- Using Intersect(D,E,…) — D and E are points; Intersect needs two geometric OBJECTS (Segment/Line/Circle)

═══ RECIPES (copy these patterns) ═══
Point ON a segment (parameter 0→1 from first to second endpoint):
  D=Point(Segment(A,C), 0.35)

Point on the EXTENSION of BC beyond C (parameter >1 on Line(B,C); 0=B, 1=C, 1.3≈30% past C):
  lineBC=Line(B,C)
  E=Point(lineBC, 1.35)

Circle with AB as DIAMETER (NOT Circle(A,B)):
  M=Midpoint(A,B)
  omega=Circle(M,A)

Intersection of segment DE with a circle (define segment first; index 1 or 2 if two hits):
  segDE=Segment(D,E)
  F=Intersect(segDE, omega, 1)

If F is missing, also try Line(D,E) instead of Segment(D,E), or adjust E's parameter.

Parallel line through D parallel to line AO:
  lineAO=Line(A,O)
  lineDM=Line(D,lineAO)

Circle with AD as diameter; E on AB, F on AC; M = DM ∩ EF:
  M_AD=Midpoint(A,D)
  circleAD=Circle(M_AD,A)
  segAB=Segment(A,B)
  segAC=Segment(A,C)
  E=Intersect(circleAD,segAB,2)
  F=Intersect(circleAD,segAC,2)
  lineAO=Line(A,O)
  lineDM=Line(D,lineAO)
  segEF=Segment(E,F)
  M=Intersect(lineDM,segEF)
  O=TriangleCenter(A,B,C,3)

Concyclic quadrilateral ABCD — put ALL FOUR vertices ON one circle ω1 (never Circle(A,B,C), which misses D):
  omega1=Circle((0,0),5)
  A=(5*cos(115°),5*sin(115°))
  B=(5*cos(178°),5*sin(178°))
  C=(5*cos(235°),5*sin(235°))
  D=(5*cos(40°),5*sin(40°))
  Polygon(A,B,C,D)
  lineAC=Line(A,C)
  lineBD=Line(B,D)
  E=Intersect(lineAC,lineBD)
  lineAD=Line(A,D)
  lineBC=Line(B,C)
  F=Intersect(lineAD,lineBC)

Circle ω2 tangent to rays EB and EC at M, N — its centre lies on the bisector of ∠BEC (NOT Circle(E,…)):
  bisE=AngleBisector(B,E,C)
  I=Point(bisE,0.5)
  lineEB=Line(E,B)
  lineEC=Line(E,C)
  perpM=PerpendicularLine(I,lineEB)
  M=Intersect(perpM,lineEB)
  omega2=Circle(I,M)
  perpN=PerpendicularLine(I,lineEC)
  N=Intersect(perpN,lineEC)
  Drag I (or change the 0.5 parameter) so ω2 actually meets ω1.

Two circles meeting at P, Q — the RADICAL AXIS is the common chord PQ; the chord MN of tangent points is a DIFFERENT line:
  P=Intersect(omega1,omega2,1)
  Q=Intersect(omega1,omega2,2)
  radAxis=Line(P,Q)
  lineMN=Line(M,N)
  S=Intersect(lineBC,lineMN)
  T=Intersect(lineAD,lineMN)
  omega3=Circle(P,Q,S)
  CRITICAL: lineMN is Line(M,N), NEVER Line(P,Q). Conflating chord MN with the radical axis PQ is the classic mistake — they coincide only in degenerate cases. Line–line Intersect needs no index (they meet once).

Radical axis of two NON-intersecting circles (no real P, Q): it is PERPENDICULAR to the line of centres O1O2 — build it as cLine=Line(O1,O2) then radAxis=PerpendicularLine(K,cLine), where K is any point of equal power (e.g. the meet of a common tangent pair).

Ratio / constraint problems (AD/DC = BC/(2CE), etc.):
  For a DIAGRAM only, do NOT solve the ratio algebraically. Place D and E with the
  Point(Segment(...), t) and Point(Line(...), s) recipes above (pick t∈(0,1), s>1).
  Approximate positions are correct for illustration.

═══ WORKED EXAMPLE — isosceles triangle, D on AC, E on BC extension, diameter circle, F ═══
A=(0,5)
B=(-4,0)
C=(4,0)
Polygon(A,B,C)
D=Point(Segment(A,C),0.4)
lineBC=Line(B,C)
E=Point(lineBC,1.4)
Segment(A,B)
Segment(A,C)
Segment(B,C)
Segment(C,E)
segDE=Segment(D,E)
M=Midpoint(A,B)
omega=Circle(M,A)
F=Intersect(segDE,omega,1)
SetCaption(D,"D")
SetCaption(E,"E")
SetCaption(F,"F")
SetColor(omega,"blue")`;

/** Fix common model typos before sanitize/eval. */
const COMMAND_ALIASES: Record<string, string> = {
  MidPoint: 'Midpoint',
  midPoint: 'Midpoint',
  midpoint: 'Midpoint',
  LineExtension: 'Line',
  PointOn: 'Point',
  Draw: 'Segment',
  Plot: 'Function',
  TriangleCentre: 'TriangleCenter',
};

/** tkz/TikZ/LaTeX patterns — never evalCommand. */
const TIKZ_REJECT = /\\(?:tkz|begin\{tikz|end\{tikz|draw|node|coordinate|label|fill|path|useasboundingbox|fuzhuxian)/i;

/** Rewrite invented triangle-center commands to TriangleCenter(A,B,C,n). */
function rewriteTriangleCenters(line: string): string {
  // Already valid official 4-argument form — do not rewrite.
  if (/^(\w+)\s*=\s*TriangleCenter\s*\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*\d+\s*\)\s*$/i.test(line)) {
    return line;
  }
  const m = line.match(
    /^(\w+)\s*=\s*(?:Triangle(?:Circum|In|Orth)?center|Circumcenter|Incenter|Orthocenter|DefTriangleCenter)\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*\)\s*$/i,
  );
  if (!m) return line;
  const [, name, a, b, c] = m;
  const lower = line.toLowerCase();
  let n = 3;
  if (lower.includes('incenter') || lower.includes('incentre')) n = 1;
  else if (lower.includes('centroid')) n = 2;
  else if (lower.includes('orthocenter') || lower.includes('orthocentre')) n = 4;
  return `${name}=TriangleCenter(${a},${b},${c},${n})`;
}

export function normalizeGgbLine(line: string): string {
  let s = rewriteTriangleCenters(line.trim());
  for (const [wrong, right] of Object.entries(COMMAND_ALIASES)) {
    s = s.replace(new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), right);
  }
  return s;
}

/** Lines that must never reach evalCommand. */
const GGB_LINE_REJECT = /\\(?:frac|par|triangle|cdot|left|right|tkz|begin\{tikz)|\$|^[\s]*(?:var|let|const)\s/;

/** Sanitize one GeoGebra command line from model output. */
export function sanitizeGgbLine(line: string): string | null {
  const trimmed = line.trim().replace(/;\s*$/, '');
  if (!trimmed) return null;
  if (/;/.test(trimmed)) return null;
  if (GGB_LINE_REJECT.test(trimmed) || TIKZ_REJECT.test(trimmed)) return null;
  if (/^[\s]*(?:\/\/|#)/.test(trimmed)) return null;
  return trimmed;
}

/** Extract GeoGebra evalCommand lines from an assistant reply. */
export function parseGgbBlock(text: string): string[] {
  const raw = extractGgbBlockRaw(text);
  const out: string[] = [];
  for (const line of raw) {
    const normalized = normalizeGgbLine(line);
    for (const part of normalized.split(/\r?\n/)) {
      const clean = sanitizeGgbLine(part);
      if (clean) out.push(clean);
    }
  }
  return orderGgbCommands(out);
}

const TRI_CENTER_RE = /^(\w+)\s*=\s*TriangleCenter\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(\d+)\s*\)$/i;

/** Perpendicular-bisector construction when TriangleCenter(A,B,C,3) throws in web3d. */
export function circumcenterFallbackCommands(
  name: string,
  a: string,
  b: string,
  c: string,
  batchId = 0,
): string[] {
  const tag = `${name.replace(/\W/g, '_') || 'O'}_${batchId}`;
  return [
    `__ggb_pb1_${tag}=PerpendicularBisector(${a.trim()},${b.trim()})`,
    `__ggb_pb2_${tag}=PerpendicularBisector(${a.trim()},${c.trim()})`,
    `${name}=Intersect(__ggb_pb1_${tag},__ggb_pb2_${tag})`,
  ];
}

/** Fallback command chain for a single line, or null if none. */
export function triangleCenterFallbacks(cmd: string, batchId = 0): string[] | null {
  const m = cmd.match(TRI_CENTER_RE);
  if (!m) return null;
  const [, name, a, b, c, n] = m;
  if (Number(n) === 3) return circumcenterFallbackCommands(name, a, b, c, batchId);
  return null;
}

/** Execution tier — ensures points exist before TriangleCenter / Intersect. */
export function ggbCommandTier(line: string): number {
  const s = line.trim();
  if (!s) return 99;
  if (/^[A-Za-z][\w]*=\(\s*-?\d/.test(s)) return 0;
  if (/^[a-z][\w]*\([^)]*\)\s*=/.test(s)) return 1;
  if (/TriangleCenter\s*\(|Centroid\s*\(|Incircle\s*\(/i.test(s)) return 4;
  if (/\bIntersect\b/i.test(s)) return 5;
  if (/^(Set|Show|Hide|Zoom|Slider|Text)[A-Z]/i.test(s)) return 6;
  return 2;
}

export function orderGgbCommands(cmds: string[]): string[] {
  return cmds
    .map((cmd, index) => ({ cmd, index, tier: ggbCommandTier(cmd) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((x) => x.cmd);
}

/** Left-hand-side label of an assignment command (`O=...`), or null for bare calls. */
export function ggbCommandLabel(line: string): string | null {
  const m = line.trim().match(/^([A-Za-z_]\w*)\s*=(?!=)/);
  return m ? m[1] : null;
}

/**
 * Merge a previous canvas script with a follow-up script so the figure is
 * extended, not lost. Same-label assignments take the NEW definition (the user
 * may have moved a point); bare calls (Polygon/Segment/Set*) are de-duplicated.
 * Result is re-ordered so coordinates run before Intersect/TriangleCenter.
 */
export function mergeGgbScripts(previous: string[], next: string[]): string[] {
  const out: string[] = [];
  const labelIndex = new Map<string, number>();
  const push = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const label = ggbCommandLabel(line);
    if (label) {
      const at = labelIndex.get(label);
      if (at !== undefined) { out[at] = line; return; }
      labelIndex.set(label, out.length);
      out.push(line);
    } else if (!out.includes(line)) {
      out.push(line);
    }
  };
  for (const l of previous) push(l);
  for (const l of next) push(l);
  return orderGgbCommands(out);
}

function extractGgbBlockRaw(text: string): string[] {
  const re = /```(?:geogebra|ggb|geo)\s*\n?([\s\S]*?)```/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length > 0) {
    // Use the LAST block — correction pass appends a fresh script after failed prose.
    return matches[matches.length - 1][1].split(/\r?\n/);
  }
  const open = text.match(/```(?:geogebra|ggb|geo)\s*\n?([\s\S]*)$/i);
  if (!open) return [];
  return open[1].split(/\r?\n/);
}

/** PascalCase command names documented in GEOGEBRA_REFERENCE + CONSTRUCTION_GUIDE. */
const REFERENCE_EXCLUDE = new Set([
  'Boolean', 'End', 'List', 'Number', 'Object', 'Polynomial', 'Start',
]);

export function extractReferenceCommandNames(): string[] {
  const corpus = GEOGEBRA_REFERENCE + GEOGEBRA_CONSTRUCTION_GUIDE;
  const names = new Set<string>();
  for (const m of corpus.matchAll(/(?:^|[\s|])([A-Z][a-zA-Z0-9]{2,})\(/gm)) {
    const name = m[1];
    if (!REFERENCE_EXCLUDE.has(name)) names.add(name);
  }
  // Point appears in docs as Point(<object>) — re-include explicitly
  names.add('Point');
  return [...names].sort();
}
