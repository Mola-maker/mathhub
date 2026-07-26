import type { CalcExpr, CoordExpr, NumExpr } from '../../tikz/subset/ast';

export interface Pt { x: number; y: number }
export interface EvalEnvs {
  points: ReadonlyMap<string, Pt>;
  pvars?: ReadonlyMap<string, Pt>;
  nvars?: ReadonlyMap<string, number>;
}
export class EvalError extends Error {
  constructor(message: string, public readonly code: 'unknown-ref' | 'degenerate' | 'eval') { super(message); this.name = 'EvalError'; }
}

const EPS = 1e-12;
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, t: number): Pt => ({ x: a.x * t, y: a.y * t });
const rotateDeg = (a: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

export function evalCoord(expr: CoordExpr, env: EvalEnvs): Pt {
  switch (expr.kind) {
    case 'literal': {
      const x = typeof expr.x === 'number' ? expr.x : evalNum(expr.x, env);
      const y = typeof expr.y === 'number' ? expr.y : evalNum(expr.y, env);
      return { x, y };
    }
    case 'ref': {
      const p = env.points.get(expr.name);
      if (!p) throw new EvalError(`未定义的点 '${expr.name}'`, 'unknown-ref');
      return p;
    }
    case 'calc': return evalCalc(expr.expr, env);
  }
}

export function evalCalc(e: CalcExpr, env: EvalEnvs): Pt {
  switch (e.op) {
    case 'coord': return evalCoord(e.coord, env);
    case 'add': return add(evalCalc(e.left, env), evalCalc(e.right, env));
    case 'sub': return sub(evalCalc(e.left, env), evalCalc(e.right, env));
    case 'interpolate': { const a = evalCalc(e.a, env); const b = evalCalc(e.b, env); const t = evalNum(e.t, env); return add(a, scale(sub(b, a), t)); }
    case 'rotate': { const a = evalCalc(e.a, env); const b = evalCalc(e.b, env); const t = evalNum(e.t, env); const ang = evalNum(e.angleDeg, env); return add(a, scale(rotateDeg(sub(b, a), ang), t)); }
    case 'project': {
      const a = evalCalc(e.a, env); const p = evalCalc(e.p, env); const b = evalCalc(e.b, env);
      const d = sub(b, a); const len2 = d.x * d.x + d.y * d.y;
      if (len2 < EPS) throw new EvalError('投影的参考线退化为一点', 'degenerate');
      const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2;
      return add(a, scale(d, t));
    }
  }
}

export function evalNum(e: NumExpr, env: EvalEnvs): number {
  switch (e.kind) {
    case 'num-lit': return e.value;
    case 'num-var': { const v = env.nvars?.get(e.name); if (v === undefined) throw new EvalError(`未定义的数 '${e.name}'`, 'unknown-ref'); return v; }
    case 'num-comp': { const p = env.pvars?.get(e.pvar); if (!p) throw new EvalError(`未定义的点 '${e.pvar}'`, 'unknown-ref'); return e.axis === 'x' ? p.x : p.y; }
    case 'num-bin': {
      const l = evalNum(e.left, env); const r = evalNum(e.right, env);
      if (e.binop === '+') return l + r;
      if (e.binop === '-') return l - r;
      if (e.binop === '*') return l * r;
      if (Math.abs(r) < EPS) throw new EvalError('除数为 0', 'degenerate');
      return l / r;
    }
    case 'veclen': return Math.hypot(evalNum(e.x, env), evalNum(e.y, env));
  }
}