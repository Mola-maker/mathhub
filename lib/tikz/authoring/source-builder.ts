import type { TextPatch } from '../document/source-transaction';
import { formatCoordNumber } from '../patch/source-patch';
import type { Pt } from '../semantics/calc-eval';
import type { SceneCircleDefinition } from '../semantics/scene';
import { tikzPictureBodyEndOffset } from '../document/tikz-envelope';
import {
  calcInterpolateCoordinate,
  calcProjectionCoordinate,
} from './tikz-coordinate-serializer';

export type AuthoringElementKind =
  | 'segment'
  | 'vector'
  | 'line'
  | 'ray'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'label'
  | 'angle'
  | 'right-angle'
  | 'midpoint'
  | 'perpendicular-foot';

export interface AuthoringAnchor {
  name: string;
  position: Pt;
  existing: boolean;
  circle?: {
    stableId: string;
    semanticEntityId: string;
    sourceBindingId: string;
    stmtIndex: number;
    sourceRange?: { start: number; end: number };
    centerName: string;
    throughName: string | null;
    center: Pt;
    radius: number;
    angleDeg: number;
    definition: SceneCircleDefinition;
  };
}

export function nextPointName(
  existing: ReadonlySet<string>,
  prefix = 'P',
): string {
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new RangeError('无法分配新的 TikZ 点名');
}

export function coordinateSource(anchor: AuthoringAnchor): string {
  return `\\coordinate (${anchor.name}) at (${formatCoordNumber(anchor.position.x)},${formatCoordNumber(anchor.position.y)});`;
}

export function elementSource(
  kind: Exclude<AuthoringElementKind, 'midpoint' | 'perpendicular-foot'>,
  anchors: readonly AuthoringAnchor[],
): string {
  const names = anchors.map((anchor) => anchor.name);
  switch (kind) {
    case 'segment':
      return `\\draw (${names[0]}) -- (${names[1]});`;
    case 'vector':
      return `\\draw[->] (${names[0]}) -- (${names[1]});`;
    case 'line':
      return `\\draw ${calcInterpolateCoordinate(names[0], -3, names[1])} -- ${calcInterpolateCoordinate(names[0], 4, names[1])};`;
    case 'ray':
      return `\\draw[->] (${names[0]}) -- ${calcInterpolateCoordinate(names[0], 4, names[1])};`;
    case 'polyline':
      return `\\draw ${names.map((name) => `(${name})`).join(' -- ')};`;
    case 'polygon':
    case 'rectangle':
      return `\\draw ${names.map((name) => `(${name})`).join(' -- ')} -- cycle;`;
    case 'circle':
      return `\\node[draw,circle through=(${names[1]})] at (${names[0]}) {};`;
    case 'label':
      return `\\node[above] at (${names[0]}) {$${names[0]}$};`;
    case 'angle':
      return `\\pic[draw] {angle = ${names[0]}--${names[1]}--${names[2]}};`;
    case 'right-angle':
      return `\\pic[draw] {right angle = ${names[0]}--${names[1]}--${names[2]}};`;
  }
}

/**
 * Legacy test fixture builder. Creation commits now go exclusively through
 * ConstructionPlan/compileConstructionPlan; this export remains only for the
 * source-builder compatibility tests until that fixture is retired.
 * @deprecated Do not use in runtime authoring or preview code.
 */
export function authoringLines(
  kind: AuthoringElementKind | 'point',
  anchors: readonly AuthoringAnchor[],
  resultName: string | null = null,
): string[] {
  if (kind === 'midpoint') {
    if (!resultName) throw new TypeError('中点构造缺少结果点名');
    return [
      `\\coordinate (${resultName}) at ${calcInterpolateCoordinate(anchors[0].name, 0.5, anchors[1].name)};`,
    ];
  }
  if (kind === 'perpendicular-foot') {
    if (!resultName) throw new TypeError('垂足构造缺少结果点名');
    const [point, lineStart, lineEnd] = anchors;
    return [
      `\\coordinate (${resultName}) at ${calcProjectionCoordinate(lineStart.name, point.name, lineEnd.name)};`,
    ];
  }
  const coordinates = anchors
    .filter((anchor) => !anchor.existing)
    .map(coordinateSource);
  return kind === 'point'
    ? coordinates
    : [...coordinates, elementSource(kind, anchors)];
}

export function insertBeforeTikzEndPatch(
  source: string,
  lines: readonly string[],
): TextPatch {
  const end = tikzPictureBodyEndOffset(source);
  if (end === null && source.trim().length === 0) {
    return {
      from: 0,
      to: source.length,
      insert: [
        '\\begin{tikzpicture}',
        ...lines,
        '\\end{tikzpicture}',
      ].join('\n'),
    };
  }
  if (end === null) {
    throw new SyntaxError('Source has no structurally valid \\end{tikzpicture}.');
  }
  const prefix = end > 0 && source[end - 1] === '\n' ? '' : '\n';
  return {
    from: end,
    to: end,
    insert: `${prefix}${lines.join('\n')}\n`,
  };
}
