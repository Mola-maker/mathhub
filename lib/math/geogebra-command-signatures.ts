/**
 * Official-style GeoGebra command signatures (evalCommand).
 * Source: https://geogebra.github.io/docs/manual/en/commands/
 */
import { GGB_COMMAND_INDEX, manualUrlForCommand } from '@/lib/math/geogebra-command-index';

/** Per-command signatures — overrides for commands models hallucinate most. */
export const GGB_SIGNATURE_DETAIL: Record<string, string> = {
  Point: 'Point(object) — on segment/line/circle; Point(Segment(A,B), t) with t∈[0,1]; Point(Line(A,B), s) s>1 for extension',
  Midpoint: 'Midpoint(A, B) | Midpoint(segment) | Midpoint(conic)',
  Intersect: 'Intersect(obj1, obj2) | Intersect(obj1, obj2, index) — index 1 or 2 when two hits; obj must be Segment/Line/Circle not bare points',
  Segment: 'Segment(A, B) | Segment(point, length)',
  Line: 'Line(A, B) | Line(P, parallelLine) — through P parallel to line | Line(P, directionVector)',
  Ray: 'Ray(start, throughPoint)',
  Vector: 'Vector(A, B) | Vector(point)',
  Polygon: 'Polygon(A, B, C, …) | Polygon(center, vertex, n) regular n-gon',
  Circle: 'Circle(center, radius) | Circle(center, pointOnCircle) | Circle(A,B,C) through 3 points — NOT diameter; for diameter use M=Midpoint(A,B); c=Circle(M,A)',
  Semicircle: 'Semicircle(A, B)',
  Incircle: 'Incircle(A, B, C)',
  TriangleCenter: 'TriangleCenter(A, B, C, n) — 1=Incenter 2=Centroid 3=Circumcenter(外心) 4=Orthocenter — NEVER TriangleCircumcenter',
  Centroid: 'Centroid(polygon) | Centroid(A, B, C)',
  PerpendicularLine: 'PerpendicularLine(point, line)',
  PerpendicularBisector: 'PerpendicularBisector(A, B) | PerpendicularBisector(segment)',
  AngleBisector: 'AngleBisector(A, B, C) | AngleBisector(line, line)',
  Tangent: 'Tangent(point, conic) | Tangent(x, function) — for line tangent to circle at M on segment, use Circle with center on angle bisector or approximate with Tangent(P, circle)',
  Angle: 'Angle(A, B, C) | Angle(object) | Angle(vector, vector)',
  Area: 'Area(conic|polygon)',
  Distance: 'Distance(point, object)',
  Length: 'Length(segment|vector|list)',
  SetCaption: 'SetCaption(object, "label")',
  SetColor: 'SetColor(object, "red"|"#RRGGBB")',
  SetLineThickness: 'SetLineThickness(object, 1..13)',
  ShowLabel: 'ShowLabel(object, true|false)',
  Text: 'Text("string", point)',
  Slider: 'Slider(min, max) | Slider(min, max, step)',
  Translate: 'Translate(object, vector)',
  Rotate: 'Rotate(object, angle) | Rotate(object, angle, center)',
  Reflect: 'Reflect(object, line|point)',
  Dilate: 'Dilate(object, factor, center)',
  Ellipse: 'Ellipse(f1, f2, semimajor) | Ellipse(f1, f2, point)',
  Parabola: 'Parabola(focus, directrix)',
  Hyperbola: 'Hyperbola(f1, f2, semimajor) | Hyperbola(f1, f2, point)',
  Conic: 'Conic(a,b,c,d,e,f) implicit | Conic(listOf5Points)',
  Derivative: 'Derivative(f) | Derivative(f, n)',
  Integral: 'Integral(f) | Integral(f, a, b)',
  Solve: 'Solve(equation) | Solve({eqns}, {vars})',
  NSolve: 'NSolve(equation) | NSolve(equation, variable)',
  Solutions: 'Solutions(equation)',
  Function: 'Function(f, startX, endX) restrict domain',
  Curve: 'Curve(x(t), y(t), t, tMin, tMax)',
  ImplicitCurve: 'ImplicitCurve(f(x,y)) e.g. ImplicitCurve(x^2+y^2-25)',
  Plane: 'Plane(A,B,C) | Plane(point, line) | Plane(point, plane) | Plane(polygon)',
  Sphere: 'Sphere(center, radius) | Sphere(center, point)',
  Cube: 'Cube(A, B) | Cube(A, B, direction)',
  Prism: 'Prism(polygon, height) | Prism(A, B, …, topPoint)',
  Pyramid: 'Pyramid(polygon, apex) | Pyramid(polygon, height)',
  Cone: 'Cone(center, apex, radius) | Cone(point, vector, angle)',
  Cylinder: 'Cylinder(bottom, top, radius) | Cylinder(circle, height)',
  Surface: 'Surface(x(u,v), y(u,v), z(u,v), u, u0, u1, v, v0, v1)',
  Volume: 'Volume(solid)',
  SetPerspective: 'SetPerspective("AG") algebra+2D | "AT" algebra+3D | "CG" CAS+2D | "GT" tools+2D | "T" 3D only',
  ZoomIn: 'ZoomIn(factor) | ZoomIn(x1,y1,x2,y2)',
  ZoomOut: 'ZoomOut(factor) | ZoomOut(x1,y1,x2,y2)',
  SetAxesRatio: 'SetAxesRatio(xRatio, yRatio) | SetAxesRatio(xRatio, yRatio, zRatio)',
  SetPointSize: 'SetPointSize(point, size)',
  ConvexHull: 'ConvexHull(listOfPoints) — discrete; requires point list L={A,B,C,…}',
  Voronoi: 'Voronoi(listOfPoints)',
  DelaunayTriangulation: 'DelaunayTriangulation(listOfPoints)',
  MinimumSpanningTree: 'MinimumSpanningTree(listOfPoints)',
  TravelingSalesman: 'TravelingSalesman(listOfPoints)',
  ShortestDistance: 'ShortestDistance(listOfSegments, start, end, weightedBoolean)',
  CircumcircularArc: 'CircumcircularArc(A, B, C) — arc on circumcircle of triangle ABC',
  Sequence: 'Sequence(expr, var, from, to) | Sequence(expr, var, from, to, step)',
  Element: 'Element(list, index)',
  Cell: 'Cell(columnLetter, rowNumber) spreadsheet cell',
  CellRange: 'CellRange(startCell, endCell)',
  BinomialDist: 'BinomialDist(n, p, k, boolean)',
  Normal: 'Normal(mean, sd, variable, boolean)',
  Mean: 'Mean(list)',
  Simplify: 'Simplify(expression) — CAS',
  Expand: 'Expand(expression) — CAS',
  Factor: 'Factor(expression) — CAS',
};

/** Return signature text for one command (detailed or manual link). */
export function getCommandSignature(name: string): string {
  const detail = GGB_SIGNATURE_DETAIL[name];
  if (detail) return `${name}: ${detail}`;
  return `${name}(...) — ${manualUrlForCommand(name)}`;
}

/** All indexed command names with signatures (for export / API). */
export function getAllCommandSignatures(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const names of Object.values(GGB_COMMAND_INDEX)) {
    for (const n of names) {
      if (!out[n]) out[n] = getCommandSignature(n);
    }
  }
  return out;
}
