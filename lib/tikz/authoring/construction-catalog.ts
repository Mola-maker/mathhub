import type {
  AuthoringAnchor,
  AuthoringElementKind,
} from './source-builder';
import {
  type ConstructionPlan,
  type PrimitiveKind,
} from './construction-ir';

export type ConstructionCategory =
  | 'navigate'
  | 'primitive'
  | 'constraint'
  | 'transform'
  | 'olympiad';

export interface ConstructionInputSlot {
  id: string;
  prompt: string;
  accepts: 'point' | 'circle';
  createOnEmpty?: boolean;
}

export interface ConstructionBuildContext {
  anchors: readonly AuthoringAnchor[];
  nextName(prefix: string): string;
  /**
   * Allocates a document-unique managed construction identity. Geometry names
   * and construction identities are intentionally separate namespaces.
   */
  nextConstructionId?(prefix: string): string;
}

export interface ConstructionToolSpec {
  id: string;
  label: string;
  symbol: string;
  description: string;
  category: ConstructionCategory;
  aliases: readonly string[];
  shortcut?: string;
  inputSlots: readonly ConstructionInputSlot[];
  kind?: AuthoringElementKind | 'point';
  variableArity?: boolean;
  resultPrefix?: string;
  validate?: (anchors: readonly AuthoringAnchor[]) => string | null;
  plan?: (context: ConstructionBuildContext) => ConstructionPlan;
}

const pointSlot = (
  id: string,
  prompt: string,
  createOnEmpty = false,
): ConstructionInputSlot => ({
  id,
  prompt,
  accepts: 'point',
  createOnEmpty,
});

const circleSlot = (
  id: string,
  prompt: string,
): ConstructionInputSlot => ({
  id,
  prompt,
  accepts: 'circle',
});

function distance(a: AuthoringAnchor, b: AuthoringAnchor): number {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
  );
}

function collinear(
  a: AuthoringAnchor,
  b: AuthoringAnchor,
  c: AuthoringAnchor,
): boolean {
  const cross = (
    (b.position.x - a.position.x) * (c.position.y - a.position.y)
    - (b.position.y - a.position.y) * (c.position.x - a.position.x)
  );
  const scale = Math.max(distance(a, b) * distance(a, c), 1);
  return Math.abs(cross) <= 1e-7 * scale;
}

function linesParallel(
  a: AuthoringAnchor,
  b: AuthoringAnchor,
  c: AuthoringAnchor,
  d: AuthoringAnchor,
): boolean {
  const first = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
  };
  const second = {
    x: d.position.x - c.position.x,
    y: d.position.y - c.position.y,
  };
  const scale = Math.max(
    Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y),
    1,
  );
  return Math.abs(first.x * second.y - first.y * second.x) <= 1e-7 * scale;
}

function infiniteLineIntersection(
  a: AuthoringAnchor,
  b: AuthoringAnchor,
  c: AuthoringAnchor,
  d: AuthoringAnchor,
): { readonly x: number; readonly y: number } | null {
  const first = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
  };
  const second = {
    x: d.position.x - c.position.x,
    y: d.position.y - c.position.y,
  };
  const denominator = first.x * second.y - first.y * second.x;
  const scale = Math.max(
    Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y),
    1,
  );
  if (Math.abs(denominator) <= 1e-7 * scale) return null;
  const between = {
    x: c.position.x - a.position.x,
    y: c.position.y - a.position.y,
  };
  const t = (between.x * second.y - between.y * second.x) / denominator;
  const result = {
    x: a.position.x + t * first.x,
    y: a.position.y + t * first.y,
  };
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

function circumcenterPoint(
  a: AuthoringAnchor,
  b: AuthoringAnchor,
  c: AuthoringAnchor,
): { x: number; y: number } | null {
  const ax = a.position.x;
  const ay = a.position.y;
  const bx = b.position.x;
  const by = b.position.y;
  const cx = c.position.x;
  const cy = c.position.y;
  const denominator = 2 * (
    ax * (by - cy)
    + bx * (cy - ay)
    + cx * (ay - by)
  );
  if (Math.abs(denominator) <= 1e-12) return null;
  const aa = ax * ax + ay * ay;
  const bb = bx * bx + by * by;
  const cc = cx * cx + cy * cy;
  return {
    x: (
      aa * (by - cy)
      + bb * (cy - ay)
      + cc * (ay - by)
    ) / denominator,
    y: (
      aa * (cx - bx)
      + bb * (ax - cx)
      + cc * (bx - ax)
    ) / denominator,
  };
}

function validateLine(anchors: readonly AuthoringAnchor[], aIndex: number, bIndex: number): string | null {
  return distance(anchors[aIndex], anchors[bIndex]) <= 1e-8
    ? '参考直线退化为一点，请重新选择'
    : null;
}

const BASE_SPECS: ConstructionToolSpec[] = [
  {
    id: 'point',
    label: '点',
    symbol: '•',
    description: '点击空白处创建自由点',
    category: 'primitive',
    aliases: ['point', 'free point', '自由点'],
    shortcut: 'P',
    inputSlots: [pointSlot('point', '放置自由点', true)],
    kind: 'point',
  },
  {
    id: 'segment',
    label: '线段',
    symbol: '╱',
    description: '依次选择两个点创建线段',
    category: 'primitive',
    aliases: ['segment', '连接', '连线'],
    shortcut: 'L',
    inputSlots: [
      pointSlot('start', '选择起点', true),
      pointSlot('end', '选择终点', true),
    ],
    kind: 'segment',
  },
  {
    id: 'vector',
    label: '向量',
    symbol: '↗',
    description: '依次选择起点和终点创建向量',
    category: 'primitive',
    aliases: ['vector'],
    inputSlots: [
      pointSlot('start', '选择起点', true),
      pointSlot('end', '选择终点', true),
    ],
    kind: 'vector',
  },
  {
    id: 'line',
    label: '直线',
    symbol: '↔',
    description: '依次选择两个点创建延长直线',
    category: 'primitive',
    aliases: ['line', '直线'],
    inputSlots: [
      pointSlot('start', '选择直线第一点', true),
      pointSlot('end', '选择直线第二点', true),
    ],
    kind: 'line',
  },
  {
    id: 'ray',
    label: '射线',
    symbol: '→',
    description: '依次选择起点和方向点',
    category: 'primitive',
    aliases: ['ray'],
    inputSlots: [
      pointSlot('start', '选择射线起点', true),
      pointSlot('direction', '选择方向点', true),
    ],
    kind: 'ray',
  },
  {
    id: 'polyline',
    label: '折线',
    symbol: '⌁',
    description: '逐点点击，双击或 Enter 完成',
    category: 'primitive',
    aliases: ['polyline', '折线'],
    inputSlots: [
      pointSlot('point', '继续选择折点', true),
      pointSlot('point', '继续选择折点', true),
    ],
    variableArity: true,
    kind: 'polyline',
  },
  {
    id: 'polygon',
    label: '多边形',
    symbol: '△',
    description: '逐点点击，双击、点击首点或 Enter 闭合',
    category: 'primitive',
    aliases: ['polygon', '多边形'],
    inputSlots: [
      pointSlot('vertex', '继续选择顶点', true),
      pointSlot('vertex', '继续选择顶点', true),
      pointSlot('vertex', '继续选择顶点', true),
    ],
    variableArity: true,
    kind: 'polygon',
  },
  {
    id: 'rectangle',
    label: '矩形',
    symbol: '□',
    description: '选择两个对角点创建矩形',
    category: 'primitive',
    aliases: ['rectangle', '四边形', 'quadrilateral'],
    shortcut: 'Q',
    inputSlots: [
      pointSlot('corner', '选择第一个对角点', true),
      pointSlot('opposite', '选择相对角点', true),
    ],
    kind: 'rectangle',
    validate: (anchors) => distance(anchors[0], anchors[1]) <= 1e-8
      ? '矩形的两个对角点不能重合'
      : null,
    plan: rectangleByOppositeCornersPlan,
  },
  {
    id: 'circle',
    label: '圆',
    symbol: '○',
    description: '依次选择圆心和圆上一点',
    category: 'primitive',
    aliases: ['circle', '圆'],
    shortcut: 'C',
    inputSlots: [
      pointSlot('center', '选择圆心', true),
      pointSlot('through', '选择圆上一点', true),
    ],
    kind: 'circle',
  },
  {
    id: 'label',
    label: '标注',
    symbol: 'A',
    description: '选择点并创建可编辑标签',
    category: 'primitive',
    aliases: ['label', 'text', '标签'],
    inputSlots: [pointSlot('point', '选择要标注的点')],
    kind: 'label',
  },
  {
    id: 'angle',
    label: '角',
    symbol: '∠',
    description: '依次选择边点、顶点、边点',
    category: 'primitive',
    aliases: ['angle'],
    inputSlots: [
      pointSlot('arm-a', '选择第一条边上的点'),
      pointSlot('vertex', '选择角的顶点'),
      pointSlot('arm-b', '选择第二条边上的点'),
    ],
    kind: 'angle',
  },
  {
    id: 'right-angle',
    label: '直角',
    symbol: '⌞',
    description: '依次选择边点、顶点、边点',
    category: 'primitive',
    aliases: ['right angle', '直角标记'],
    inputSlots: [
      pointSlot('arm-a', '选择第一条边上的点'),
      pointSlot('vertex', '选择直角顶点'),
      pointSlot('arm-b', '选择第二条边上的点'),
    ],
    kind: 'right-angle',
  },
  {
    id: 'midpoint',
    label: '中点',
    symbol: '◉',
    description: '选择两个已有点创建保持约束的中点',
    category: 'constraint',
    aliases: ['midpoint', '中点'],
    inputSlots: [
      pointSlot('a', '选择端点 A'),
      pointSlot('b', '选择端点 B'),
    ],
    kind: 'midpoint',
    resultPrefix: 'M',
    validate: (anchors) => validateLine(anchors, 0, 1),
    plan: midpointPlan,
  },
  {
    id: 'perpendicular-foot',
    label: '垂足',
    symbol: '⊥',
    description: '依次选择待投影点和直线上的两个点',
    category: 'constraint',
    aliases: ['foot', '垂足', 'projection'],
    inputSlots: [
      pointSlot('point', '选择待投影点'),
      pointSlot('line-a', '选择直线第一点'),
      pointSlot('line-b', '选择直线第二点'),
    ],
    kind: 'perpendicular-foot',
    resultPrefix: 'H',
    validate: (anchors) => validateLine(anchors, 1, 2),
    plan: perpendicularFootPlan,
  },
  {
    id: 'point-on-circle',
    label: '圆上点',
    symbol: '⊙',
    description: '点击具有可逆圆定义语义的圆周创建绑定点',
    category: 'constraint',
    aliases: ['point on circle', 'glider', '圆上点', '路径点'],
    inputSlots: [
      circleSlot('circle', '点击具有可逆圆定义语义的目标圆'),
    ],
    resultPrefix: 'P',
    plan({ anchors, nextName }) {
      const circle = anchors[0]?.circle;
      if (!circle) {
        throw new TypeError('请点击一个可识别的圆');
      }
      const result = nextName('P');
      return {
        id: `point-on-circle-${result}`,
        kind: 'point-on-circle',
        inputs: [{
          id: 'circle',
          role: 'circle',
          ref: circle.stableId,
        }],
        entities: [{
          recordType: 'entity',
          id: `entity-${result}`,
          name: result,
          kind: 'point',
          tags: ['derived', 'on-circle'],
        }],
        constraints: [{
          recordType: 'constraint',
          id: `constraint-${result}`,
          kind: 'on-circle',
          point: result,
          circle: circle.stableId,
        }],
        relations: [{
          recordType: 'relation',
          id: `depends-${result}`,
          kind: 'depends-on',
          from: result,
          to: circle.stableId,
          directed: true,
        }],
        outputs: [{
          recordType: 'output',
          id: `output-${result}`,
          role: 'point',
          ref: result,
          kind: 'derived-point',
        }],
        circle: {
          id: circle.stableId,
          center: circle.centerName,
          through: circle.throughName ?? undefined,
          radius: circle.radius,
          angleDegrees: circle.angleDeg,
        },
        result,
        selection: [result],
        status: `已在圆上创建约束点 ${result}`,
      };
    },
  },
];

function pointEntity(name: string, tags: readonly string[] = ['derived']): ConstructionPlan['entities'][number] {
  return {
    recordType: 'entity',
    id: `entity-${name}`,
    name,
    kind: 'point',
    tags,
  };
}

function lineEntity(name: string, from: string, to: string): ConstructionPlan['entities'][number] {
  return {
    recordType: 'entity',
    id: `entity-${name}`,
    name,
    kind: 'line',
    from,
    to,
  };
}

function dependencyRelations(from: string, refs: readonly string[]): ConstructionPlan['relations'] {
  return refs.map((to, index) => ({
    recordType: 'relation' as const,
    id: `depends-${from}-${index + 1}`,
    kind: 'depends-on' as const,
    from,
    to,
    directed: true,
  }));
}

function outputRecord(ref: string, role: string, kind: 'derived-point' | 'derived-line' = 'derived-point'): ConstructionPlan['outputs'][number] {
  return {
    recordType: 'output',
    id: `output-${ref}`,
    role,
    ref,
    kind,
  };
}

const PRIMITIVE_KINDS: ReadonlySet<string> = new Set<PrimitiveKind>([
  'point',
  'segment',
  'vector',
  'line',
  'ray',
  'polyline',
  'polygon',
  'rectangle',
  'circle',
  'label',
  'angle',
  'right-angle',
]);

export function isPrimitiveConstructionKind(
  kind: string,
): kind is PrimitiveKind {
  return PRIMITIVE_KINDS.has(kind);
}

function assertPrimitiveAnchorCardinality(
  kind: PrimitiveKind,
  anchors: readonly AuthoringAnchor[],
): void {
  const expected = kind === 'point' || kind === 'label'
    ? 1
    : kind === 'angle' || kind === 'right-angle'
      ? 3
      : kind === 'polyline'
        ? 2
        : kind === 'polygon'
          ? 3
          : 2;
  const valid = kind === 'polyline' || kind === 'polygon'
    ? anchors.length >= expected
    : anchors.length === expected;
  if (!valid) {
    throw new RangeError(
      `${kind} requires ${kind === 'polyline' || kind === 'polygon' ? 'at least ' : ''}${expected} anchors`,
    );
  }
}

function primitiveInputRoles(kind: PrimitiveKind): readonly string[] {
  switch (kind) {
    case 'point':
      return [];
    case 'segment':
    case 'vector':
    case 'line':
      return ['from', 'to'];
    case 'ray':
      return ['origin', 'direction'];
    case 'polyline':
    case 'polygon':
      return [];
    case 'rectangle':
      return ['first-corner', 'opposite-corner'];
    case 'circle':
      return ['center', 'through'];
    case 'label':
      return ['at'];
    case 'angle':
    case 'right-angle':
      return ['arm-a', 'vertex', 'arm-b'];
  }
}

function primitiveDefinition(
  kind: PrimitiveKind,
  anchors: readonly AuthoringAnchor[],
): Extract<ConstructionPlan, { kind: 'primitive' }>['primitive'] {
  const names = anchors.map((anchor) => anchor.name);
  switch (kind) {
    case 'point':
      return {
        kind,
        name: anchors[0].name,
        position: anchors[0].position,
      };
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return { kind, from: names[0], to: names[1] };
    case 'polyline':
    case 'polygon':
      return { kind, vertices: names };
    case 'rectangle':
      return { kind, corners: [names[0], names[1]] };
    case 'circle':
      return { kind, center: names[0], through: names[1] };
    case 'label':
      return { kind, at: names[0], text: `$${names[0]}$` };
    case 'angle':
    case 'right-angle':
      return { kind, points: [names[0], names[1], names[2]] };
  }
}

function primitiveEntity(
  kind: PrimitiveKind,
  entityId: string,
  entityName: string,
  anchors: readonly AuthoringAnchor[],
): ConstructionPlan['entities'][number] {
  const names = anchors.map((anchor) => anchor.name);
  const base = {
    recordType: 'entity' as const,
    id: entityId,
    name: entityName,
    tags: ['canvas-authored', 'primitive'],
  };
  switch (kind) {
    case 'point':
      return {
        ...base,
        kind,
        position: anchors[0].position,
        tags: ['canvas-authored', 'primitive', 'free'],
      };
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return { ...base, kind, from: names[0], to: names[1] };
    case 'polyline':
    case 'polygon':
      return { ...base, kind, vertices: names };
    case 'rectangle':
      return { ...base, kind, corners: [names[0], names[1]] };
    case 'circle':
      return { ...base, kind, center: names[0], through: names[1] };
    case 'label':
      return { ...base, kind, at: names[0], text: `$${names[0]}$` };
    case 'angle':
    case 'right-angle':
      return { ...base, kind, points: [names[0], names[1], names[2]] };
  }
}

/**
 * The single production factory for canvas-authored primitives. Preview and
 * commit both consume the returned ConstructionPlan; only commit serializes it
 * to TikZ. This keeps creation source-neutral while sharing one semantic plan.
 */
export function createPrimitiveConstructionPlan(
  kind: PrimitiveKind,
  context: ConstructionBuildContext,
): ConstructionPlan {
  const { anchors } = context;
  assertPrimitiveAnchorCardinality(kind, anchors);
  const fallbackId = kind === 'point'
    ? `point-${anchors[0].name}`
    : `${kind}-${anchors.map((anchor) => anchor.name).join('-')}`;
  const constructionId = context.nextConstructionId?.(fallbackId) ?? fallbackId;
  const entityName = kind === 'point' ? anchors[0].name : constructionId;
  const entityId = `entity-${entityName}`;
  const entityReference = kind === 'point' ? entityName : entityId;
  const roles = primitiveInputRoles(kind);
  const inputs = kind === 'polyline' || kind === 'polygon'
    ? anchors.map((anchor, index) => ({
      id: `vertex-${index + 1}`,
      role: 'vertex',
      ref: anchor.name,
    }))
    : anchors.flatMap((anchor, index) => {
      const role = roles[index];
      return role
        ? [{ id: `input-${index + 1}`, role, ref: anchor.name }]
        : [];
    });
  return {
    id: constructionId,
    kind: 'primitive',
    inputs,
    entities: [primitiveEntity(kind, entityId, entityName, anchors)],
    constraints: [],
    relations: kind === 'point'
      ? []
      : dependencyRelations(entityReference, anchors.map((anchor) => anchor.name)),
    outputs: [{
      recordType: 'output',
      id: `output-${constructionId}`,
      role: kind,
      ref: entityReference,
      kind,
    }],
    primitive: primitiveDefinition(kind, anchors),
    selection: anchors.map((anchor) => anchor.name),
    status: kind === 'point'
      ? `已创建自由点 ${entityName}`
      : `已创建 ${kind} 图元`,
  };
}

function rectangleByOppositeCornersPlan(
  { anchors, nextName, nextConstructionId }: ConstructionBuildContext,
): ConstructionPlan {
  const [first, opposite] = anchors.map((anchor) => anchor.name);
  const second = nextName('R');
  const fourth = nextName('R');
  const constructionId = nextConstructionId?.(
    `rectangle-${first}-${opposite}`,
  ) ?? `rectangle-${first}-${opposite}-${second}-${fourth}`;
  const edgeIds = [
    `line-${first}-${second}`,
    `line-${second}-${opposite}`,
    `line-${opposite}-${fourth}`,
    `line-${fourth}-${first}`,
  ] as const;
  return {
    id: constructionId,
    kind: 'rectangle-by-opposite-corners',
    inputs: [
      { id: 'first', role: 'first-corner', ref: first },
      { id: 'opposite', role: 'opposite-corner', ref: opposite },
    ],
    entities: [
      pointEntity(second, ['derived', 'rectangle-corner']),
      pointEntity(fourth, ['derived', 'rectangle-corner']),
      lineEntity(edgeIds[0], first, second),
      lineEntity(edgeIds[1], second, opposite),
      lineEntity(edgeIds[2], opposite, fourth),
      lineEntity(edgeIds[3], fourth, first),
      {
        recordType: 'entity',
        id: `entity-${constructionId}-boundary`,
        name: `${constructionId}-boundary`,
        kind: 'polygon',
        vertices: [first, second, opposite, fourth],
        tags: ['rectangle-boundary', 'derived'],
      },
      {
        recordType: 'entity',
        id: `entity-${constructionId}`,
        name: constructionId,
        kind: 'rectangle',
        corners: [first, opposite],
        tags: ['rectangle', 'derived'],
      },
    ],
    constraints: [
      {
        recordType: 'constraint',
        id: `parallel-${edgeIds[0]}-${edgeIds[2]}`,
        kind: 'parallel',
        line: edgeIds[0],
        reference: edgeIds[2],
      },
      {
        recordType: 'constraint',
        id: `parallel-${edgeIds[1]}-${edgeIds[3]}`,
        kind: 'parallel',
        line: edgeIds[1],
        reference: edgeIds[3],
      },
      {
        recordType: 'constraint',
        id: `perpendicular-${edgeIds[0]}-${edgeIds[1]}`,
        kind: 'perpendicular',
        line: edgeIds[0],
        reference: edgeIds[1],
      },
    ],
    relations: [
      ...dependencyRelations(second, [first, opposite]),
      ...dependencyRelations(fourth, [first, opposite]),
      ...dependencyRelations(`entity-${constructionId}`, [first, opposite]),
      ...dependencyRelations(
        `entity-${constructionId}-boundary`,
        [`entity-${constructionId}`],
      ),
    ],
    outputs: [
      outputRecord(second, 'second-corner'),
      outputRecord(fourth, 'fourth-corner'),
      {
        recordType: 'output',
        id: `output-${constructionId}`,
        role: 'rectangle',
        ref: `entity-${constructionId}`,
        kind: 'rectangle',
      },
    ],
    first,
    opposite,
    second,
    fourth,
    selection: [second, fourth],
    status: `已创建由 ${first} 与 ${opposite} 确定的动态矩形`,
  };
}

function midpointPlan(
  { anchors, nextName }: ConstructionBuildContext,
): ConstructionPlan {
  const [a, b] = anchors.map((anchor) => anchor.name);
  const result = nextName('M');
  return {
    id: `midpoint-${result}`,
    kind: 'midpoint',
    inputs: [
      { id: 'a', role: 'segment-start', ref: a },
      { id: 'b', role: 'segment-end', ref: b },
    ],
    entities: [
      pointEntity(result, ['derived', 'midpoint']),
    ],
    constraints: [{
      recordType: 'constraint',
      id: `midpoint-${result}-${a}-${b}`,
      kind: 'midpoint',
      point: result,
      a,
      b,
    }],
    relations: dependencyRelations(result, [a, b]),
    outputs: [outputRecord(result, 'midpoint')],
    a,
    b,
    result,
    selection: [result],
    status: `已创建 ${a}、${b} 的中点 ${result}`,
  };
}

function perpendicularFootPlan(
  { anchors, nextName }: ConstructionBuildContext,
): ConstructionPlan {
  const [point, lineStart, lineEnd] = anchors.map((anchor) => anchor.name);
  const result = nextName('H');
  return {
    id: `perpendicular-foot-${result}`,
    kind: 'perpendicular-foot',
    inputs: [
      { id: 'point', role: 'projected-point', ref: point },
      { id: 'line-start', role: 'reference-start', ref: lineStart },
      { id: 'line-end', role: 'reference-end', ref: lineEnd },
    ],
    entities: [
      pointEntity(result, ['derived', 'perpendicular-foot']),
    ],
    constraints: [{
      recordType: 'constraint',
      id: `perpendicular-foot-${result}-${lineStart}-${lineEnd}`,
      kind: 'perpendicular-foot',
      point,
      lineStart,
      lineEnd,
      result,
    }],
    relations: dependencyRelations(result, [point, lineStart, lineEnd]),
    outputs: [outputRecord(result, 'foot')],
    point,
    lineStart,
    lineEnd,
    result,
    selection: [result],
    status: `已创建 ${point} 到直线 ${lineStart}${lineEnd} 的垂足 ${result}`,
  };
}

function perpendicularBisectorPlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [a, b] = anchors.map((anchor) => anchor.name);
  const midpoint = nextName('M');
  const result = nextName('Q');
  const line = `line-${midpoint}-${result}`;
  return {
    id: `perp-bisector-${midpoint}`,
    kind: 'perpendicular-bisector',
    inputs: [
      { id: 'a', role: 'segment-start', ref: a },
      { id: 'b', role: 'segment-end', ref: b },
    ],
    entities: [
      pointEntity(midpoint, ['derived', 'midpoint']),
      pointEntity(result, ['derived', 'direction']),
      lineEntity(line, midpoint, result),
    ],
    constraints: [
      {
        recordType: 'constraint',
        id: `midpoint-${midpoint}-${a}-${b}`,
        kind: 'midpoint',
        point: midpoint,
        a,
        b,
      },
      {
        recordType: 'constraint',
        id: `perpendicular-bisector-${line}`,
        kind: 'perpendicular-bisector',
        line,
        midpoint,
        a,
        b,
      },
    ],
    relations: [
      ...dependencyRelations(midpoint, [a, b]),
      ...dependencyRelations(result, [midpoint, a, b]),
      ...dependencyRelations(line, [midpoint, result]),
    ],
    outputs: [
      outputRecord(midpoint, 'midpoint'),
      outputRecord(result, 'direction-point'),
      {
        recordType: 'output',
        id: `output-${line}`,
        role: 'perpendicular-bisector',
        ref: line,
        kind: 'line',
      },
    ],
    a,
    b,
    midpoint,
    result,
    line,
    selection: [midpoint, result],
    status: `已创建 ${a}${b} 的中垂线`,
  };
}

function angleBisectorPlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [armA, vertex, armB] = anchors.map((anchor) => anchor.name);
  const result = nextName('Q');
  const line = `line-${vertex}-${result}`;
  return {
    id: `angle-bisector-${result}`,
    kind: 'angle-bisector',
    inputs: [
      { id: 'arm-a', role: 'first-arm', ref: armA },
      { id: 'vertex', role: 'vertex', ref: vertex },
      { id: 'arm-b', role: 'second-arm', ref: armB },
    ],
    entities: [
      pointEntity(result, ['derived', 'angle-bisector']),
      lineEntity(line, vertex, result),
    ],
    constraints: [{
      recordType: 'constraint',
      id: `angle-bisector-${line}`,
      kind: 'angle-bisector',
      line,
      armA,
      vertex,
      armB,
    }],
    relations: [
      ...dependencyRelations(result, [armA, vertex, armB]),
      ...dependencyRelations(line, [vertex, result]),
    ],
    outputs: [
      outputRecord(result, 'bisector-direction'),
      {
        recordType: 'output',
        id: `output-${line}`,
        role: 'angle-bisector',
        ref: line,
        kind: 'line',
      },
    ],
    armA,
    vertex,
    armB,
    result,
    line,
    selection: [vertex, result],
    status: `已创建 ∠${armA}${vertex}${armB} 的角平分线`,
  };
}

function circumcirclePlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [a, b, c] = anchors.map((anchor) => anchor.name);
  const center = nextName('O');
  const circle = `circle-${center}`;
  return {
    id: `circumcircle-${center}`,
    kind: 'circumcircle',
    inputs: [
      { id: 'a', role: 'first-point', ref: a },
      { id: 'b', role: 'second-point', ref: b },
      { id: 'c', role: 'third-point', ref: c },
    ],
    entities: [
      pointEntity(center, ['derived', 'circumcenter']),
      {
        recordType: 'entity',
        id: circle,
        name: circle,
        kind: 'circle',
        center,
        through: a,
        tags: ['derived', 'circumcircle'],
      },
    ],
    constraints: [{
      recordType: 'constraint',
      id: `circle-through-${a}-${b}-${c}`,
      kind: 'circle-through-three-points',
      circle,
      center,
      points: [a, b, c],
    }],
    relations: [
      ...dependencyRelations(center, [a, b, c]),
      ...dependencyRelations(circle, [center, a, b, c]),
    ],
    outputs: [
      outputRecord(center, 'circumcenter'),
      {
        recordType: 'output',
        id: `output-${circle}`,
        role: 'circumcircle',
        ref: circle,
        kind: 'circle',
      },
    ],
    a,
    b,
    c,
    center,
    circle,
    selection: [center, a],
    status: `已创建经过 ${a}、${b}、${c} 的外接圆`,
  };
}

function tangentAtPointPlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const circle = anchors[0]?.circle;
  if (!circle) {
    throw new TypeError('请点击一个可识别的圆');
  }
  const touch = nextName('T');
  const result = nextName('Q');
  const line = `line-${touch}-${result}`;
  return {
    id: `tangent-${result}`,
    kind: 'tangent-at-point',
    inputs: [
      { id: 'circle', role: 'circle', ref: circle.stableId },
      { id: 'circle-center', role: 'circle-center', ref: circle.centerName },
    ],
    entities: [
      pointEntity(touch, ['derived', 'on-circle', 'tangent-touch']),
      pointEntity(result, ['derived', 'tangent-direction']),
      lineEntity(line, touch, result),
    ],
    constraints: [
      {
        recordType: 'constraint',
        id: `on-circle-${touch}`,
        kind: 'on-circle',
        point: touch,
        circle: circle.stableId,
      },
      {
        recordType: 'constraint',
        id: `tangent-${line}`,
        kind: 'tangent-at-point',
        line,
        touch,
        circle: circle.stableId,
        center: circle.centerName,
      },
    ],
    relations: [
      ...dependencyRelations(touch, [circle.stableId]),
      ...dependencyRelations(result, [touch, circle.centerName]),
      ...dependencyRelations(line, [touch, result]),
    ],
    outputs: [
      outputRecord(touch, 'tangent-touch-point'),
      outputRecord(result, 'tangent-direction'),
      {
        recordType: 'output',
        id: `output-${line}`,
        role: 'tangent-line',
        ref: line,
        kind: 'line',
      },
    ],
    touch,
    circle: {
      id: circle.stableId,
      center: circle.centerName,
      through: circle.throughName ?? undefined,
      radius: circle.radius,
      angleDegrees: circle.angleDeg,
    },
    result,
    line,
    selection: [touch, result],
    status: `已创建圆在 ${touch} 处的切线`,
  };
}

function reflectPointPlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [point, center] = anchors.map((anchor) => anchor.name);
  const result = nextName('R');
  return {
    id: `reflect-point-${result}`,
    kind: 'reflect-point',
    inputs: [{ id: 'point', role: 'point', ref: point }, { id: 'center', role: 'center', ref: center }],
    entities: [pointEntity(result, ['derived', 'reflection'])],
    constraints: [{
      recordType: 'constraint',
      id: `point-reflection-${result}`,
      kind: 'point-reflection',
      source: point,
      center,
      result,
    }],
    relations: dependencyRelations(result, [point, center]),
    outputs: [outputRecord(result, 'reflected-point')],
    point,
    center,
    result,
    selection: [result],
    status: `已创建 ${point} 关于 ${center} 的对称点 ${result}`,
  };
}

function reflectLinePlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [point, lineStart, lineEnd] = anchors.map((anchor) => anchor.name);
  const foot = nextName('H');
  const result = nextName('R');
  return {
    id: `reflect-line-${result}`,
    kind: 'reflect-line',
    inputs: [
      { id: 'point', role: 'point', ref: point },
      { id: 'line-a', role: 'axis-start', ref: lineStart },
      { id: 'line-b', role: 'axis-end', ref: lineEnd },
    ],
    entities: [pointEntity(foot, ['derived', 'projection']), pointEntity(result, ['derived', 'reflection'])],
    constraints: [{
      recordType: 'constraint',
      id: `line-reflection-${result}`,
      kind: 'line-reflection',
      source: point,
      axisStart: lineStart,
      axisEnd: lineEnd,
      foot,
      result,
    }],
    relations: [
      ...dependencyRelations(foot, [point, lineStart, lineEnd]),
      ...dependencyRelations(result, [point, foot, lineStart, lineEnd]),
    ],
    outputs: [outputRecord(foot, 'projection-foot'), outputRecord(result, 'reflected-point')],
    point,
    lineStart,
    lineEnd,
    foot,
    result,
    selection: [result],
    status: `已创建 ${point} 关于 ${lineStart}${lineEnd} 的对称点 ${result}`,
  };
}

function rotate90Plan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [point, center] = anchors.map((anchor) => anchor.name);
  const result = nextName('R');
  return {
    id: `rotate-${result}`,
    kind: 'rotate-90',
    inputs: [{ id: 'point', role: 'point', ref: point }, { id: 'center', role: 'center', ref: center }],
    entities: [pointEntity(result, ['derived', 'rotation'])],
    constraints: [{
      recordType: 'constraint',
      id: `rotation-${result}`,
      kind: 'rotation',
      source: point,
      center,
      result,
      angleDegrees: 90,
    }],
    relations: dependencyRelations(result, [point, center]),
    outputs: [outputRecord(result, 'rotated-point')],
    point,
    center,
    result,
    selection: [result],
    status: `已将 ${point} 绕 ${center} 逆时针旋转 90°`,
  };
}

function homothety2Plan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const [point, center] = anchors.map((anchor) => anchor.name);
  const result = nextName('S');
  return {
    id: `homothety-${result}`,
    kind: 'homothety-2',
    inputs: [{ id: 'point', role: 'point', ref: point }, { id: 'center', role: 'center', ref: center }],
    entities: [pointEntity(result, ['derived', 'homothety'])],
    constraints: [{
      recordType: 'constraint',
      id: `homothety-${result}`,
      kind: 'homothety',
      source: point,
      center,
      result,
      scale: 2,
    }],
    relations: dependencyRelations(result, [point, center]),
    outputs: [outputRecord(result, 'homothetic-point')],
    point,
    center,
    result,
    selection: [result],
    status: `已创建以 ${center} 为中心、比值 2 的位似点`,
  };
}

function radicalAxisPlan({ anchors, nextName }: ConstructionBuildContext): ConstructionPlan {
  const circle1 = anchors[0]?.circle;
  const circle2 = anchors[1]?.circle;
  if (!circle1 || !circle2) {
    throw new TypeError('请选择两个具有可逆定义语义的圆');
  }
  const result = nextName('X');
  const direction = nextName('Q');
  const line = nextName(`line-${result}-${direction}-`);
  return {
    id: `radical-axis-${result}`,
    kind: 'radical-axis',
    inputs: [
      { id: 'circle-1', role: 'first-circle', ref: circle1.stableId },
      { id: 'circle-2', role: 'second-circle', ref: circle2.stableId },
    ],
    entities: [
      pointEntity(result, ['derived', 'radical-axis', 'equal-power-point']),
      pointEntity(direction, ['derived', 'radical-axis-direction']),
      lineEntity(line, result, direction),
    ],
    constraints: [{
      recordType: 'constraint',
      id: `radical-axis-${line}`,
      kind: 'radical-axis',
      line,
      point: result,
      circle1: circle1.stableId,
      circle2: circle2.stableId,
    }],
    relations: [
      ...dependencyRelations(result, [circle1.stableId, circle2.stableId]),
      ...dependencyRelations(direction, [result, circle1.stableId, circle2.stableId]),
      ...dependencyRelations(line, [result, direction, circle1.stableId, circle2.stableId]),
    ],
    outputs: [
      outputRecord(result, 'radical-axis-point'),
      outputRecord(direction, 'radical-axis-direction'),
      {
        recordType: 'output',
        id: `output-${line}`,
        role: 'radical-axis-line',
        ref: line,
        kind: 'line',
      },
    ],
    circle1: {
      id: circle1.stableId,
      center: circle1.centerName,
      through: circle1.throughName ?? undefined,
      radius: circle1.radius,
      evaluatedCenter: circle1.center,
      evaluatedRadius: circle1.radius,
    },
    circle2: {
      id: circle2.stableId,
      center: circle2.centerName,
      through: circle2.throughName ?? undefined,
      radius: circle2.radius,
      evaluatedCenter: circle2.center,
      evaluatedRadius: circle2.radius,
    },
    result,
    direction,
    line,
    selection: [result, direction],
    status: '已创建两圆根轴',
  };
}

const ADVANCED_SPECS: ConstructionToolSpec[] = [
  {
    id: 'parallel-line',
    label: '平行线',
    symbol: '∥',
    description: '选择过点，再选择参考直线的两个点',
    category: 'constraint',
    aliases: ['parallel', '平行'],
    inputSlots: [
      pointSlot('through', '选择直线经过的点'),
      pointSlot('line-a', '选择参考直线第一点'),
      pointSlot('line-b', '选择参考直线第二点'),
    ],
    resultPrefix: 'Q',
    validate: (anchors) => validateLine(anchors, 1, 2),
    plan({ anchors, nextName }) {
      const [through, a, b] = anchors.map((anchor) => anchor.name);
      const q = nextName('Q');
      return {
        id: `parallel-${q}`,
        kind: 'parallel-line',
        inputs: [
          { id: 'through', role: 'through-point', ref: through },
          { id: 'reference-start', role: 'reference-start', ref: a },
          { id: 'reference-end', role: 'reference-end', ref: b },
        ],
        entities: [
          {
            recordType: 'entity',
            id: `entity-${q}`,
            name: q,
            kind: 'point',
            tags: ['derived', 'direction'],
          },
          {
            recordType: 'entity',
            id: `line-${q}`,
            name: `line-${q}`,
            kind: 'line',
            from: through,
            to: q,
          },
          // The reference line is a first-class semantic dependency of the
          // parallel constraint, even though it is not a visible output.
          lineEntity(`line-${a}-${b}`, a, b),
        ],
        constraints: [{
          recordType: 'constraint',
          id: `constraint-${q}`,
          kind: 'parallel',
          line: `line-${q}`,
          reference: `line-${a}-${b}`,
        }],
        relations: [
          ...[a, b].map((ref, index) => ({
            recordType: 'relation' as const,
            id: `depends-${q}-${index + 1}`,
            kind: 'depends-on' as const,
            from: q,
            to: ref,
            directed: true,
          })),
          ...dependencyRelations(`line-${a}-${b}`, [a, b]),
        ],
        outputs: [{
          recordType: 'output',
          id: `output-${q}`,
          role: 'direction-point',
          ref: q,
          kind: 'derived-point',
        }],
        through,
        referenceStart: a,
        referenceEnd: b,
        result: q,
        selection: [through, q],
        status: `已创建过 ${through} 的平行线`,
      };
    },
  },
  {
    id: 'perpendicular-line',
    label: '垂线',
    symbol: '⟂',
    description: '选择过点，再选择参考直线的两个点',
    category: 'constraint',
    aliases: ['perpendicular line', '垂直线'],
    inputSlots: [
      pointSlot('through', '选择垂线经过的点'),
      pointSlot('line-a', '选择参考直线第一点'),
      pointSlot('line-b', '选择参考直线第二点'),
    ],
    resultPrefix: 'Q',
    validate: (anchors) => validateLine(anchors, 1, 2),
    plan({ anchors, nextName }) {
      const [through, a, b] = anchors.map((anchor) => anchor.name);
      const q = nextName('Q');
      return {
        id: `perpendicular-${q}`,
        kind: 'perpendicular-line',
        inputs: [
          { id: 'through', role: 'through-point', ref: through },
          { id: 'reference-start', role: 'reference-start', ref: a },
          { id: 'reference-end', role: 'reference-end', ref: b },
        ],
        entities: [
          {
            recordType: 'entity',
            id: `entity-${q}`,
            name: q,
            kind: 'point',
            tags: ['derived', 'direction'],
          },
          {
            recordType: 'entity',
            id: `line-${q}`,
            name: `line-${q}`,
            kind: 'line',
            from: through,
            to: q,
          },
          // Keep the referenced source line in the same typed graph as the
          // perpendicular constraint; it is intentionally not an output.
          lineEntity(`line-${a}-${b}`, a, b),
        ],
        constraints: [{
          recordType: 'constraint',
          id: `constraint-${q}`,
          kind: 'perpendicular',
          line: `line-${q}`,
          reference: `line-${a}-${b}`,
        }],
        relations: [
          ...[a, b].map((ref, index) => ({
            recordType: 'relation' as const,
            id: `depends-${q}-${index + 1}`,
            kind: 'depends-on' as const,
            from: q,
            to: ref,
            directed: true,
          })),
          ...dependencyRelations(`line-${a}-${b}`, [a, b]),
        ],
        outputs: [{
          recordType: 'output',
          id: `output-${q}`,
          role: 'direction-point',
          ref: q,
          kind: 'derived-point',
        }],
        through,
        referenceStart: a,
        referenceEnd: b,
        result: q,
        selection: [through, q],
        status: `已创建过 ${through} 的垂线`,
      };
    },
  },
  {
    id: 'perpendicular-bisector',
    label: '中垂线',
    symbol: '⌖',
    description: '选择线段的两个端点',
    category: 'constraint',
    aliases: ['perpendicular bisector', '中垂线'],
    inputSlots: [
      pointSlot('a', '选择端点 A'),
      pointSlot('b', '选择端点 B'),
    ],
    resultPrefix: 'M',
    validate: (anchors) => validateLine(anchors, 0, 1),
    plan: perpendicularBisectorPlan,
  },
  {
    id: 'angle-bisector',
    label: '角平分线',
    symbol: '⋔',
    description: '依次选择边点、顶点、边点',
    category: 'constraint',
    aliases: ['angle bisector', '角平分线'],
    inputSlots: [
      pointSlot('arm-a', '选择第一条边上的点'),
      pointSlot('vertex', '选择角的顶点'),
      pointSlot('arm-b', '选择第二条边上的点'),
    ],
    resultPrefix: 'Q',
    validate(anchors) {
      if (validateLine(anchors, 1, 0) || validateLine(anchors, 1, 2)) {
        return '角的边不能退化为一点';
      }
      const [a, vertex, b] = anchors;
      const first = {
        x: (a.position.x - vertex.position.x) / distance(a, vertex),
        y: (a.position.y - vertex.position.y) / distance(a, vertex),
      };
      const second = {
        x: (b.position.x - vertex.position.x) / distance(b, vertex),
        y: (b.position.y - vertex.position.y) / distance(b, vertex),
      };
      return Math.hypot(first.x + second.x, first.y + second.y) <= 1e-7
        ? '平角没有唯一的内部角平分线'
        : null;
    },
    plan: angleBisectorPlan,
  },
  {
    id: 'circumcircle',
    label: '三点圆',
    symbol: '◯',
    description: '选择三个不共线点创建外接圆',
    category: 'constraint',
    aliases: ['circumcircle', '外接圆', 'three point circle'],
    inputSlots: [
      pointSlot('a', '选择圆上第一点'),
      pointSlot('b', '选择圆上第二点'),
      pointSlot('c', '选择圆上第三点'),
    ],
    resultPrefix: 'O',
    validate: (anchors) => collinear(anchors[0], anchors[1], anchors[2])
      ? '三个点共线，不能确定外接圆'
      : null,
    plan: circumcirclePlan,
  },
  {
    id: 'tangent-at-point',
    label: '切线',
    symbol: '⊙',
    description: '点击具有可逆圆定义语义的圆周，创建绑定切点和切线',
    category: 'constraint',
    aliases: ['tangent', '切线'],
    inputSlots: [
      circleSlot('circle', '点击语义圆的切点位置'),
    ],
    resultPrefix: 'Q',
    plan: tangentAtPointPlan,
  },
  {
    id: 'reflect-point',
    label: '点反射',
    symbol: '⇄',
    description: '选择待变换点和反射中心',
    category: 'transform',
    aliases: ['reflect point', '中心对称'],
    inputSlots: [
      pointSlot('point', '选择待反射点'),
      pointSlot('center', '选择反射中心'),
    ],
    resultPrefix: 'R',
    plan: reflectPointPlan,
  },
  {
    id: 'reflect-line',
    label: '轴反射',
    symbol: '⋈',
    description: '选择待变换点和反射轴上的两个点',
    category: 'transform',
    aliases: ['reflect line', '轴对称'],
    inputSlots: [
      pointSlot('point', '选择待反射点'),
      pointSlot('line-a', '选择反射轴第一点'),
      pointSlot('line-b', '选择反射轴第二点'),
    ],
    resultPrefix: 'R',
    validate: (anchors) => validateLine(anchors, 1, 2),
    plan: reflectLinePlan,
  },
  {
    id: 'rotate-90',
    label: '旋转 90°',
    symbol: '↻',
    description: '选择待旋转点和旋转中心；方向为逆时针 90°',
    category: 'transform',
    aliases: ['rotate', '旋转', '90 degree'],
    inputSlots: [
      pointSlot('point', '选择待旋转点'),
      pointSlot('center', '选择旋转中心'),
    ],
    resultPrefix: 'R',
    plan: rotate90Plan,
  },
  {
    id: 'homothety-2',
    label: '位似 ×2',
    symbol: '⤢',
    description: '选择待变换点和位似中心；默认比值为 2',
    category: 'transform',
    aliases: ['homothety', 'dilation', '位似'],
    inputSlots: [
      pointSlot('point', '选择待变换点'),
      pointSlot('center', '选择位似中心'),
    ],
    resultPrefix: 'S',
    plan: homothety2Plan,
  },
  {
    id: 'inversion-point',
    label: '反演点',
    symbol: '◌',
    description: '选择待反演点、反演中心和反演圆上一点',
    category: 'olympiad',
    aliases: ['inversion', '反演', 'invert point'],
    shortcut: 'I',
    inputSlots: [
      pointSlot('point', '选择待反演点'),
      pointSlot('center', '选择反演中心'),
      pointSlot('radius', '选择反演圆上一点'),
    ],
    resultPrefix: 'Inv',
    validate(anchors) {
      if (distance(anchors[0], anchors[1]) <= 1e-8) return '反演点不能与反演中心重合';
      if (distance(anchors[1], anchors[2]) <= 1e-8) return '反演圆半径不能为 0';
      return null;
    },
    plan({ anchors, nextName }) {
      const [point, center, radius] = anchors.map((anchor) => anchor.name);
      const result = nextName('Inv');
      // Auxiliary geometry owns a real semantic identity as well. Allocate it
      // through the same revision-bound namespace as points so it cannot
      // shadow an input reference during managed IR resolution.
      const guide = nextName(`segment-${point}-${result}-`);
      return {
        id: `inversion-${result}`,
        kind: 'inversion-point',
        inputs: [
          { id: 'point', role: 'point', ref: point },
          { id: 'center', role: 'center', ref: center },
          { id: 'radius-point', role: 'radius-point', ref: radius },
        ],
        entities: [
          {
            recordType: 'entity',
            id: `entity-${result}`,
            name: result,
            kind: 'point',
            tags: ['derived', 'inversion'],
          },
          {
            recordType: 'entity',
            id: `entity-${guide}`,
            name: guide,
            kind: 'segment',
            from: point,
            to: result,
            tags: ['construction-guide', 'inversion'],
          },
        ],
        constraints: [{
          recordType: 'constraint',
          id: `constraint-${result}`,
          kind: 'inversion',
          point,
          center,
          radius,
          result,
        }],
        relations: [
          ...[point, center, radius].map((ref, index) => ({
            recordType: 'relation' as const,
            id: `depends-${result}-${index + 1}`,
            kind: 'depends-on' as const,
            from: result,
            to: ref,
            directed: true,
          })),
          ...dependencyRelations(guide, [point, result]),
        ],
        outputs: [
          {
            recordType: 'output',
            id: `output-${result}`,
            role: 'inverted-point',
            ref: result,
            kind: 'derived-point',
          },
          {
            recordType: 'output',
            id: `output-${guide}`,
            role: 'inversion-guide',
            ref: guide,
            kind: 'segment',
          },
        ],
        point,
        center,
        radiusPoint: radius,
        result,
        guide,
        selection: [result],
        status: `已创建 ${point} 关于圆 (${center}, ${radius}) 的反演点`,
      };
    },
  },
  {
    id: 'radical-axis',
    label: '根轴',
    symbol: '⌁',
    description: '依次选择两个具有可逆定义语义的圆',
    category: 'olympiad',
    aliases: ['radical axis', '根轴'],
    inputSlots: [
      circleSlot('circle-1', '选择第一个圆'),
      circleSlot('circle-2', '选择第二个圆'),
    ],
    resultPrefix: 'X',
    validate(anchors) {
      const first = anchors[0]?.circle;
      const second = anchors[1]?.circle;
      if (!first || !second) return '请选择两个具有可逆定义语义的圆';
      if (first.stableId === second.stableId) return '请选择两个不同的圆';
      if (!Number.isFinite(first.radius) || first.radius <= 1e-8) return '第一个圆半径必须大于 0';
      if (!Number.isFinite(second.radius) || second.radius <= 1e-8) return '第二个圆半径必须大于 0';
      const centerDistance = Math.hypot(
        second.center.x - first.center.x,
        second.center.y - first.center.y,
      );
      const centerScale = Math.max(first.radius, second.radius, 1);
      if (centerDistance <= 1e-7 * centerScale) {
        return '同心或近同心圆没有唯一的有限根轴';
      }
      return null;
    },
    plan: radicalAxisPlan,
  },
  {
    id: 'cyclic-quadrilateral',
    label: '圆内接四边形',
    symbol: '◇',
    description: '选择三点确定圆，再选择过首点的割线方向',
    category: 'olympiad',
    aliases: ['cyclic quadrilateral', '圆内接四边形', '四边形'],
    shortcut: 'U',
    inputSlots: [
      pointSlot('a', '选择圆上第一点 A'),
      pointSlot('b', '选择圆上第二点 B'),
      pointSlot('c', '选择圆上第三点 C'),
      pointSlot('direction', '选择从 A 出发的割线方向点'),
    ],
    resultPrefix: 'D',
    validate(anchors) {
      if (collinear(anchors[0], anchors[1], anchors[2])) {
        return '前三点共线，不能确定外接圆';
      }
      if (distance(anchors[0], anchors[3]) <= 1e-8) {
        return '割线方向点不能与首点重合';
      }
      const center = circumcenterPoint(anchors[0], anchors[1], anchors[2]);
      if (!center) return '前三点不能确定稳定的外接圆';
      const direction = {
        x: anchors[3].position.x - anchors[0].position.x,
        y: anchors[3].position.y - anchors[0].position.y,
      };
      const radius = {
        x: anchors[0].position.x - center.x,
        y: anchors[0].position.y - center.y,
      };
      const dot = direction.x * radius.x + direction.y * radius.y;
      const scale = Math.max(
        Math.hypot(direction.x, direction.y) * Math.hypot(radius.x, radius.y),
        1,
      );
      if (
        !Number.isFinite(dot)
        || !Number.isFinite(scale)
        || !Number.isFinite(direction.x)
        || !Number.isFinite(direction.y)
        || !Number.isFinite(radius.x)
        || !Number.isFinite(radius.y)
      ) {
        return '圆内接四边形的几何数据无效';
      }
      if (Math.abs(dot) > 1e-7 * scale) {
        // Keep this guard aligned with the TikZ writer's second-intersection
        // formula. A non-tangent secant can still collapse the quadrilateral
        // when its other intersection is B or C.
        const directionSquared = direction.x * direction.x + direction.y * direction.y;
        const projection = direction.x * radius.x + direction.y * radius.y;
        const t = -2 * projection / directionSquared;
        const derivedFourth = {
          x: anchors[0].position.x + t * direction.x,
          y: anchors[0].position.y + t * direction.y,
        };
        if (
          !Number.isFinite(directionSquared)
          || !Number.isFinite(projection)
          || !Number.isFinite(t)
          || !Number.isFinite(derivedFourth.x)
          || !Number.isFinite(derivedFourth.y)
        ) {
          return '割线交点无效，请选择其他方向点';
        }
        const pointScale = Math.max(
          Math.hypot(direction.x, direction.y),
          Math.hypot(radius.x, radius.y),
          distance(anchors[0], anchors[1]),
          distance(anchors[0], anchors[2]),
          1,
        );
        const coincidenceTolerance = 1e-7 * pointScale;
        if (
          Math.hypot(derivedFourth.x - anchors[1].position.x, derivedFourth.y - anchors[1].position.y)
            <= coincidenceTolerance
          || Math.hypot(derivedFourth.x - anchors[2].position.x, derivedFourth.y - anchors[2].position.y)
            <= coincidenceTolerance
        ) {
          return '割线的另一交点与 B 或 C 重合，不能构成四个不同顶点';
        }
      }
      return Math.abs(dot) <= 1e-7 * scale
        ? '当前方向在首点处与外接圆相切，不能确定不同的第四点'
        : null;
    },
    plan({ anchors, nextName }) {
      const [a, b, c, direction] = anchors.map((anchor) => anchor.name);
      const center = nextName('O');
      const d = nextName('D');
      const circle = nextName(`circle-${center}-`);
      const secant = nextName(`line-${a}-${direction}-`);
      const polygon = nextName(`quadrilateral-${d}-`);
      return {
        id: `cyclic-${d}`,
        kind: 'cyclic-quadrilateral',
        inputs: [
          { id: 'a', role: 'vertex', ref: a },
          { id: 'b', role: 'vertex', ref: b },
          { id: 'c', role: 'vertex', ref: c },
          { id: 'direction', role: 'secant-direction', ref: direction },
        ],
        entities: [
          {
            recordType: 'entity',
            id: `entity-${center}`,
            name: center,
            kind: 'point',
            tags: ['derived', 'circumcenter'],
          },
          {
            recordType: 'entity',
            id: `entity-${d}`,
            name: d,
            kind: 'point',
            tags: ['derived', 'on-circle'],
          },
          {
            recordType: 'entity',
            id: `entity-${circle}`,
            name: circle,
            kind: 'circle',
            center,
            through: a,
            tags: ['derived', 'circumcircle', 'through-three-points'],
          },
          lineEntity(secant, a, direction),
          {
            recordType: 'entity',
            id: `entity-${polygon}`,
            name: polygon,
            kind: 'polygon',
            vertices: [a, b, d, c],
          },
        ],
        constraints: [
          {
            recordType: 'constraint',
            id: `constraint-${circle}`,
            kind: 'circle-through-three-points',
            circle,
            center,
            points: [a, b, c],
          },
          {
            recordType: 'constraint',
            id: `constraint-${d}-other-intersection`,
            kind: 'line-circle-other-intersection',
            point: d,
            line: secant,
            circle,
            excludePoint: a,
            domain: 'line',
            selector: 'exclude-known-point',
          },
          {
            recordType: 'constraint',
            id: `constraint-${d}`,
            kind: 'cyclic',
            points: [a, b, c, d],
          },
        ],
        relations: [
          ...dependencyRelations(center, [a, b, c]),
          ...dependencyRelations(circle, [center, a, b, c]),
          ...dependencyRelations(secant, [a, direction]),
          ...dependencyRelations(d, [secant, circle, a]),
          ...dependencyRelations(polygon, [a, b, d, c]),
        ],
        outputs: [
          {
            recordType: 'output',
            id: `output-${center}`,
            role: 'circumcenter',
            ref: center,
            kind: 'derived-point',
          },
          {
            recordType: 'output',
            id: `output-${d}`,
            role: 'fourth-vertex',
            ref: d,
            kind: 'derived-point',
          },
          {
            recordType: 'output',
            id: `output-${circle}`,
            role: 'circumcircle',
            ref: circle,
            kind: 'circle',
          },
          {
            recordType: 'output',
            id: `output-${secant}`,
            role: 'secant-line',
            ref: secant,
            kind: 'line',
          },
          {
            recordType: 'output',
            id: `output-${polygon}`,
            role: 'cyclic-quadrilateral',
            ref: polygon,
            kind: 'polygon',
          },
        ],
        a,
        b,
        c,
        direction,
        center,
        result: d,
        circle,
        secant,
        polygon,
        selection: [a, b, c, d],
        status: `已创建圆内接四边形 ${a}${b}${d}${c}`,
      };
    },
  },
  {
    id: 'complete-quadrilateral',
    label: '完全四边形',
    symbol: '⌗',
    description: '选择四个连续交点，生成四条完整直线与两个对边交点',
    category: 'olympiad',
    aliases: ['complete quadrilateral', '完全四边形', '四直线'],
    inputSlots: [
      pointSlot('a', '选择连续交点 A'),
      pointSlot('b', '选择连续交点 B'),
      pointSlot('c', '选择连续交点 C'),
      pointSlot('d', '选择连续交点 D'),
    ],
    resultPrefix: 'X',
    validate(anchors) {
      for (let firstIndex = 0; firstIndex < anchors.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < anchors.length; secondIndex += 1) {
          if (distance(anchors[firstIndex], anchors[secondIndex]) <= 1e-8) {
            return '完全四边形需要四个互不重合的连续交点';
          }
        }
      }
      if (
        validateLine(anchors, 0, 1)
        || validateLine(anchors, 2, 3)
        || validateLine(anchors, 1, 2)
        || validateLine(anchors, 3, 0)
      ) {
        return '完全四边形的定义直线不能退化为点';
      }
      if (
        collinear(anchors[0], anchors[1], anchors[2])
        || collinear(anchors[1], anchors[2], anchors[3])
        || collinear(anchors[2], anchors[3], anchors[0])
        || collinear(anchors[3], anchors[0], anchors[1])
      ) {
        return '完全四边形的相邻定义直线必须是四条不同直线';
      }
      if (linesParallel(anchors[0], anchors[1], anchors[2], anchors[3])) {
        return '直线 AB 与 CD 平行，当前欧氏模型没有有限交点';
      }
      if (linesParallel(anchors[1], anchors[2], anchors[3], anchors[0])) {
        return '直线 BC 与 DA 平行，当前欧氏模型没有有限交点';
      }
      const firstIntersection = infiniteLineIntersection(anchors[0], anchors[1], anchors[2], anchors[3]);
      const secondIntersection = infiniteLineIntersection(anchors[1], anchors[2], anchors[3], anchors[0]);
      if (!firstIntersection || !secondIntersection) {
        return '完全四边形需要两个有限的对边交点';
      }
      const intersectionScale = Math.max(
        1,
        distance(anchors[0], anchors[1]),
        distance(anchors[1], anchors[2]),
        distance(anchors[2], anchors[3]),
        distance(anchors[3], anchors[0]),
      );
      if (
        Math.hypot(
          firstIntersection.x - secondIntersection.x,
          firstIntersection.y - secondIntersection.y,
        ) <= 1e-7 * intersectionScale
      ) {
        return '完全四边形的两个对边交点不能重合';
      }
      return null;
    },
    plan({ anchors, nextName }) {
      const [a, b, c, d] = anchors.map((anchor) => anchor.name);
      const x = nextName('X');
      const y = nextName('X');
      const lineAB = nextName(`line-${a}-${b}-`);
      const lineBC = nextName(`line-${b}-${c}-`);
      const lineCD = nextName(`line-${c}-${d}-`);
      const lineDA = nextName(`line-${d}-${a}-`);
      const diagonal = nextName(`segment-${x}-${y}-`);
      return {
        id: `complete-quadrilateral-${x}`,
        kind: 'complete-quadrilateral',
        inputs: [
          { id: 'a', role: 'vertex', ref: a },
          { id: 'b', role: 'vertex', ref: b },
          { id: 'c', role: 'vertex', ref: c },
          { id: 'd', role: 'vertex', ref: d },
        ],
        entities: [
          {
            recordType: 'entity',
            id: `entity-${x}`,
            name: x,
            kind: 'point',
            tags: ['derived', 'intersection'],
          },
          {
            recordType: 'entity',
            id: `entity-${y}`,
            name: y,
            kind: 'point',
            tags: ['derived', 'intersection'],
          },
          lineEntity(lineAB, a, b),
          lineEntity(lineBC, b, c),
          lineEntity(lineCD, c, d),
          lineEntity(lineDA, d, a),
          {
            recordType: 'entity',
            id: `entity-${diagonal}`,
            name: diagonal,
            kind: 'segment',
            from: x,
            to: y,
            tags: ['derived', 'diagonal'],
          },
        ],
        constraints: [
          {
            recordType: 'constraint',
            id: `constraint-${x}-line-intersection`,
            kind: 'line-intersection',
            point: x,
            line1: lineAB,
            line2: lineCD,
            domain: 'line',
          },
          {
            recordType: 'constraint',
            id: `constraint-${y}-line-intersection`,
            kind: 'line-intersection',
            point: y,
            line1: lineBC,
            line2: lineDA,
            domain: 'line',
          },
          {
            recordType: 'constraint',
            id: `constraint-${x}`,
            kind: 'complete-quadrilateral',
            points: [a, b, c, d],
          },
        ],
        relations: [
          ...dependencyRelations(lineAB, [a, b]),
          ...dependencyRelations(lineBC, [b, c]),
          ...dependencyRelations(lineCD, [c, d]),
          ...dependencyRelations(lineDA, [d, a]),
          ...dependencyRelations(x, [lineAB, lineCD]),
          ...dependencyRelations(y, [lineBC, lineDA]),
          ...dependencyRelations(diagonal, [x, y]),
        ],
        outputs: [
          {
            recordType: 'output',
            id: `output-${x}`,
            role: 'opposite-intersection-1',
            ref: x,
            kind: 'derived-point',
          },
          {
            recordType: 'output',
            id: `output-${y}`,
            role: 'opposite-intersection-2',
            ref: y,
            kind: 'derived-point',
          },
          {
            recordType: 'output',
            id: `output-${lineAB}`,
            role: 'side-line-ab',
            ref: lineAB,
            kind: 'line',
          },
          {
            recordType: 'output',
            id: `output-${lineBC}`,
            role: 'side-line-bc',
            ref: lineBC,
            kind: 'line',
          },
          {
            recordType: 'output',
            id: `output-${lineCD}`,
            role: 'side-line-cd',
            ref: lineCD,
            kind: 'line',
          },
          {
            recordType: 'output',
            id: `output-${lineDA}`,
            role: 'side-line-da',
            ref: lineDA,
            kind: 'line',
          },
          {
            recordType: 'output',
            id: `output-${diagonal}`,
            role: 'diagonal-segment',
            ref: diagonal,
            kind: 'segment',
          },
        ],
        a,
        b,
        c,
        d,
        firstIntersection: x,
        secondIntersection: y,
        lineAB,
        lineBC,
        lineCD,
        lineDA,
        diagonal,
        selection: [a, b, c, d, x, y],
        status: '已创建四直线完全四边形',
      };
    },
  },
];

export const CONSTRUCTION_TOOL_SPECS: readonly ConstructionToolSpec[] = [
  ...BASE_SPECS,
  ...ADVANCED_SPECS,
];

export const constructionSpecRegistry: ReadonlyMap<string, ConstructionToolSpec> = new Map(
  CONSTRUCTION_TOOL_SPECS.map((spec) => [spec.id, spec]),
);

export const CONSTRUCTION_CATEGORY_LABELS: Readonly<Record<ConstructionCategory, string>> = {
  navigate: '导航',
  primitive: '基础',
  constraint: '约束',
  transform: '变换',
  olympiad: '竞赛',
};
