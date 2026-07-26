// Construction protocol — break a GeoGebra script into rigorous, numbered
// construction steps (尺规作图语言), each replayable as a prefix of the script.
//
// Deterministic by design: the steps come from the exact commands the engine
// executed, not from an LLM's retelling, so the protocol can never drift from
// the figure. Styling lines (SetColor/ShowLabel/…) are folded out of the
// numbering but stay inside each prefix so replayed steps keep their look.

import { parseCommand } from '@/lib/math/tikz-export/ggb-to-tikz';

export interface ConstructionStep {
  /** 1-based step number (styling lines are not numbered). */
  n: number;
  /** The exact script line this step executes. */
  cmd: string;
  /** Rigorous description, zh-first (the studio UI language). */
  text: string;
  /** Replay prefix: every script line up to and including this step. */
  prefix: string[];
}

const STYLING = /^\s*(Set|Show|Hide|Zoom|Pan|Center|SetPerspective|SetAxesRatio)\w*\s*\(/;

const TRIANGLE_CENTER_ZH: Record<string, string> = {
  '1': '内心', '2': '重心', '3': '外心', '4': '垂心', '5': '九点圆心',
};

function lhsOf(line: string): { label: string; expr: string } {
  const m = line.match(/^\s*([A-Za-z_][\w']*)\s*=(?!=)\s*([\s\S]+)$/);
  return m ? { label: m[1], expr: m[2].trim() } : { label: '', expr: line.trim() };
}

const named = (label: string, zh: string) => (label ? `${zh}，记作 ${label}` : zh);

/** Rigorous zh description of one construction line. */
export function describeGgbCommand(line: string): string {
  const { label, expr } = lhsOf(line);

  // literal coordinates: A=(x, y)
  const lit = expr.match(/^\(\s*(-?[\d.]+(?:\s*\*?[^,()]*)?)\s*,\s*(-?[\d.]+(?:\s*\*?[^,()]*)?)\s*\)$/);
  if (label && lit) return `取点 ${label} = (${lit[1].trim()}, ${lit[2].trim()})`;

  // function definition: f(x)=…
  const fn = line.match(/^\s*([a-zA-Z]\w*)\s*\(\s*x\s*\)\s*=\s*([\s\S]+)$/);
  if (fn) return `定义函数 ${fn[1]}(x) = ${fn[2].trim()}`;

  const parsed = parseCommand(expr);
  if (!parsed) return `执行 ${line.trim()}`;
  const { fn: head, args } = parsed;
  const A = (i: number) => args[i]?.trim() ?? '';

  switch (head) {
    case 'Point': {
      if (args.length === 2) {
        const t = parseFloat(A(1));
        const where = isNaN(t) ? `参数 ${A(1)}` : t <= 1 ? `参数 ${A(1)}（0→1 由首端到末端）` : `参数 ${A(1)}（>1，在延长线上）`;
        return named(label, `在 ${A(0)} 上取一点，${where}`);
      }
      return named(label, `在 ${A(0)} 上任取一点`);
    }
    case 'Midpoint':
      return named(label, args.length === 2 ? `取 ${A(0)}、${A(1)} 的中点` : `取 ${A(0)} 的中点`);
    case 'Segment':
      return named(label, `连接 ${A(0)}、${A(1)}，得线段 ${A(0)}${A(1)}`);
    case 'Line':
      if (args.length === 2 && /^[a-z]/.test(A(1)) === false && /\(/.test(A(1)) === false && /^[A-Z]/.test(A(1)))
        return named(label, `过 ${A(0)}、${A(1)} 作直线`);
      return named(label, `过 ${A(0)} 作与 ${A(1)} 平行的直线`);
    case 'Ray':
      return named(label, `以 ${A(0)} 为端点、经过 ${A(1)} 作射线`);
    case 'Vector':
      return named(label, `作向量 ${A(0)}→${A(1)}`);
    case 'Polygon':
      if (args.length === 3 && /^\d+$/.test(A(2)))
        return named(label, `以 ${A(0)}${A(1)} 为一边作正 ${A(2)} 边形`);
      return named(label, `顺次连接 ${args.join('、')}，得多边形 ${args.join('')}`);
    case 'Polyline':
      return named(label, `顺次连接 ${args.join('、')} 作折线`);
    case 'Circle':
      if (args.length === 3) return named(label, `过 ${A(0)}、${A(1)}、${A(2)} 三点作圆`);
      if (/^[\d.]+$/.test(A(1))) return named(label, `以 ${A(0)} 为圆心、${A(1)} 为半径作圆`);
      return named(label, `以 ${A(0)} 为圆心、过点 ${A(1)} 作圆`);
    case 'Semicircle':
      return named(label, `以 ${A(0)}${A(1)} 为直径作半圆（在 ${A(0)}→${A(1)} 左侧）`);
    case 'CircularArc':
      return named(label, `以 ${A(0)} 为圆心，作从 ${A(1)} 到 ${A(2)} 的圆弧（逆时针）`);
    case 'CircumcircularArc':
      return named(label, `过 ${A(0)}、${A(1)}、${A(2)} 作圆弧`);
    case 'Incircle':
      return named(label, `作 △${A(0)}${A(1)}${A(2)} 的内切圆`);
    case 'PerpendicularLine':
    case 'OrthogonalLine':
      return named(label, `过 ${A(0)} 作 ${A(1)} 的垂线`);
    case 'PerpendicularBisector':
    case 'LineBisector':
      return named(label, args.length === 2 ? `作线段 ${A(0)}${A(1)} 的垂直平分线` : `作 ${A(0)} 的垂直平分线`);
    case 'AngleBisector':
      return named(label, args.length === 3 ? `作 ∠${A(0)}${A(1)}${A(2)} 的角平分线` : `作 ${A(0)} 与 ${A(1)} 的角平分线`);
    case 'Tangent':
      return named(label, `过 ${A(0)} 作 ${A(1)} 的切线`);
    case 'Intersect': {
      const idx = args.length === 3 && /^\d+$/.test(A(2)) ? `第 ${A(2)} 个` : '';
      return named(label, `取 ${A(0)} 与 ${A(1)} 的${idx}交点`);
    }
    case 'TriangleCenter': {
      const zh = TRIANGLE_CENTER_ZH[A(3)] ?? `三角形中心(${A(3)})`;
      return named(label, `作 △${A(0)}${A(1)}${A(2)} 的${zh}`);
    }
    case 'Centroid':
      return named(label, `作 ${args.join('、')} 的重心`);
    case 'Reflect':
      return named(label, `作 ${A(0)} 关于 ${A(1)} 的对称图形`);
    case 'Rotate':
      return named(label, args.length === 3
        ? `将 ${A(0)} 绕 ${A(2)} 旋转 ${A(1)}`
        : `将 ${A(0)} 旋转 ${A(1)}`);
    case 'Translate':
      return named(label, `将 ${A(0)} 沿向量 ${A(1)} 平移`);
    case 'Dilate':
      return named(label, `以 ${A(2)} 为位似中心、${A(1)} 为比作 ${A(0)} 的位似图形`);
    case 'ClosestPoint':
      return named(label, `作 ${A(1)} 在 ${A(0)} 上的投影（垂足）`);
    case 'Angle':
      return named(label, args.length === 3 ? `标记 ∠${A(0)}${A(1)}${A(2)}` : `标记 ${A(0)} 的角`);
    case 'Center':
      return named(label, `取 ${A(0)} 的圆心`);
    default:
      return label ? `作 ${label} = ${head}(${args.join(', ')})` : `执行 ${head}(${args.join(', ')})`;
  }
}

/**
 * Break a dependency-ordered script into numbered, replayable steps.
 * Styling lines attach to the running prefix but are not numbered.
 */
export function buildConstructionSteps(commands: string[]): ConstructionStep[] {
  const steps: ConstructionStep[] = [];
  const prefix: string[] = [];

  for (const raw of commands) {
    const line = raw.trim();
    if (!line) continue;
    prefix.push(line);
    if (STYLING.test(line)) continue;
    steps.push({
      n: steps.length + 1,
      cmd: line,
      text: describeGgbCommand(line),
      prefix: [...prefix],
    });
  }

  // Trailing styling lines belong to the last step's replay prefix.
  if (steps.length > 0) steps[steps.length - 1].prefix = [...prefix];
  return steps;
}

/** Compact protocol text (e.g. for copying): "1. …\n2. …" */
export function formatConstructionProtocol(steps: ConstructionStep[]): string {
  return steps.map((s) => `${s.n}. ${s.text}`).join('\n');
}
