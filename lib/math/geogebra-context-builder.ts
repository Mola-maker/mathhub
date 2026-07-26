/**
 * Server-side GeoGebra command lookup — builds per-problem context for the LLM.
 * Runs on every POST /api/math (not browser MCP).
 */
import {
  GGB_COMMAND_INDEX,
  searchGgbCommands,
  type GgbCommandCategory,
} from '@/lib/math/geogebra-command-index';
import { getCommandSignature, getAllCommandSignatures } from '@/lib/math/geogebra-command-signatures';

/** Always inject these — minimum viable construction kit. */
const CORE_COMMANDS = [
  'Point', 'Segment', 'Line', 'Circle', 'Midpoint', 'Intersect', 'Polygon',
  'TriangleCenter', 'PerpendicularLine', 'AngleBisector', 'SetCaption', 'SetColor',
] as const;

/** Chinese / English keywords → command names. */
const KEYWORD_COMMANDS: Array<{ pattern: RegExp; commands: string[] }> = [
  { pattern: /外心|circumcenter|外接圆/i, commands: ['TriangleCenter', 'Circle'] },
  { pattern: /内心|incenter|内切圆/i, commands: ['TriangleCenter', 'Incircle'] },
  { pattern: /重心|centroid/i, commands: ['TriangleCenter', 'Centroid'] },
  { pattern: /垂心|orthocenter/i, commands: ['TriangleCenter'] },
  { pattern: /中点|midpoint/i, commands: ['Midpoint'] },
  { pattern: /直径|diameter/i, commands: ['Midpoint', 'Circle'] },
  { pattern: /平行|parallel/i, commands: ['Line', 'AreParallel'] },
  { pattern: /垂直|perpendicular|垂线/i, commands: ['PerpendicularLine', 'PerpendicularBisector'] },
  { pattern: /角平分|angle bisector/i, commands: ['AngleBisector', 'Angle'] },
  { pattern: /交点|相交|intersect/i, commands: ['Intersect', 'IntersectPath'] },
  { pattern: /切线|相切|tangent/i, commands: ['Tangent', 'IsTangent', 'Line'] },
  { pattern: /根轴|radical|圆幂|power/i, commands: ['Intersect', 'Line', 'Circle'] },
  { pattern: /四边形|quadrilateral|外接圆|circumcircle|共圆/i, commands: ['Circle', 'Polygon', 'Intersect', 'TriangleCenter'] },
  { pattern: /圆|circle/i, commands: ['Circle', 'Incircle', 'Semicircle'] },
  { pattern: /椭圆|ellipse/i, commands: ['Ellipse', 'Conic'] },
  { pattern: /抛物线|parabola/i, commands: ['Parabola'] },
  { pattern: /双曲线|hyperbola/i, commands: ['Hyperbola'] },
  { pattern: /三角形|triangle|多边形|polygon/i, commands: ['Polygon', 'TriangleCenter'] },
  { pattern: /锐角|钝角|直角/i, commands: ['Angle', 'Polygon'] },
  { pattern: /3d|三维|立体|球|sphere|棱锥|pyramid|prism/i, commands: ['Plane', 'Sphere', 'Prism', 'Pyramid', 'Cube', 'Volume'] },
  { pattern: /方程|solve|求解|根/i, commands: ['Solve', 'NSolve', 'Solutions', 'Roots'] },
  { pattern: /积分|integral|导数|derivative/i, commands: ['Integral', 'Derivative', 'IntegralSymbolic'] },
  { pattern: /函数|function|图像|plot/i, commands: ['Function', 'Curve', 'ImplicitCurve'] },
  { pattern: /概率|probability|正态|normal|二项|binomial/i, commands: ['Normal', 'BinomialDist', 'RandomNormal'] },
  { pattern: /统计|mean|median|方差|variance|回归|fit/i, commands: ['Mean', 'Median', 'Variance', 'FitLine', 'FitPoly'] },
  { pattern: /cas|因式|factor|expand|simplify/i, commands: ['Factor', 'Expand', 'Simplify', 'CSolve'] },
  { pattern: /表格|spreadsheet|cell/i, commands: ['Cell', 'CellRange', 'FillCells'] },
  { pattern: /向量|vector/i, commands: ['Vector', 'UnitVector'] },
  { pattern: /样式|颜色|caption|label|线宽|slider|滑块|perspective|zoom/i, commands: ['SetCaption', 'SetColor', 'SetLineThickness', 'ShowLabel', 'SetPointSize', 'SetPerspective', 'ZoomIn', 'ZoomOut', 'SetAxesRatio', 'Slider'] },
  { pattern: /旋转|rotate|反射|reflect|平移|translate|缩放|dilate/i, commands: ['Rotate', 'Reflect', 'Translate', 'Dilate'] },
  { pattern: /离散|凸包|voronoi|delaunay|最小生成树|旅行商|convex hull|spanning tree|tsp/i, commands: ['ConvexHull', 'Voronoi', 'DelaunayTriangulation', 'MinimumSpanningTree', 'TravelingSalesman', 'ShortestDistance'] },
  { pattern: /tikz|tkz|latex/i, commands: ['Point', 'Segment', 'Line', 'Circle', 'Midpoint', 'Intersect', 'TriangleCenter'] },
];

export type GgbContextResult = {
  commandNames: string[];
  categories: GgbCommandCategory[];
  block: string;
};

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Infer relevant GeoGebra commands from user problem text. */
export function inferCommandsFromProblem(
  text: string,
  drawingCommand?: 'draw' | 'continue' | 'draw_steps' | 'translate_tikz' | 'solve_optional' | 'algebra',
  max = 80,
): string[] {
  const found: string[] = [...CORE_COMMANDS];
  const lower = text.toLowerCase();

  for (const { pattern, commands } of KEYWORD_COMMANDS) {
    if (pattern.test(text)) found.push(...commands);
  }

  // Match command names literally mentioned in text
  for (const names of Object.values(GGB_COMMAND_INDEX)) {
    for (const name of names) {
      if (lower.includes(name.toLowerCase())) found.push(name);
    }
  }

  // Substring search via index (e.g. "circum" → TriangleCenter)
  for (const token of text.split(/[\s,，。；;：:\(\)\[\]{}\\]+/).filter((t) => t.length >= 4)) {
    for (const hit of searchGgbCommands(token, { limit: 3 })) {
      found.push(hit.name);
    }
  }

  const cap = drawingCommand === 'draw_steps' || drawingCommand === 'continue' ? 120 : max;
  return uniqueNames(found).slice(0, cap);
}

function categoriesForCommands(names: string[]): GgbCommandCategory[] {
  const cats = new Set<GgbCommandCategory>();
  for (const name of names) {
    for (const [cat, list] of Object.entries(GGB_COMMAND_INDEX) as [GgbCommandCategory, readonly string[]][]) {
      if (list.includes(name)) cats.add(cat);
    }
  }
  return [...cats];
}

/** Build dynamic reference block injected into system prompt per request. */
export function buildGgbContextForProblem(
  problem: string,
  drawingCommand?: 'draw' | 'continue' | 'draw_steps' | 'translate_tikz' | 'solve_optional' | 'algebra',
): GgbContextResult {
  const commandNames = inferCommandsFromProblem(problem, drawingCommand);
  const categories = categoriesForCommands(commandNames);

  const lines = commandNames.map((name) => `  ${getCommandSignature(name)}`);
  const block = [
    '═══ SERVER COMMAND LOOKUP (matched this problem — use ONLY these signatures) ═══',
    `Matched ${commandNames.length} commands from official manual:`,
    ...lines,
    '',
    `Manual: https://geogebra.github.io/docs/manual/en/commands/`,
    'If unsure, prefer commands listed above; never invent TriangleCircumcenter or TikZ.',
  ].join('\n');

  return { commandNames, categories, block };
}

export function formatFullCommandIndexAppendix(): string {
  const all = getAllCommandSignatures();
  const byCat: string[] = ['═══ FULL COMMAND SIGNATURE INDEX (all categories) ═══'];
  for (const [cat, names] of Object.entries(GGB_COMMAND_INDEX) as [GgbCommandCategory, readonly string[]][]) {
    byCat.push(`\n[${cat.toUpperCase()}]`);
    for (const n of names) {
      byCat.push(`  ${all[n] ?? getCommandSignature(n)}`);
    }
  }
  return byCat.join('\n');
}
