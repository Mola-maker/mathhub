import type { FunctionPlotWidget } from './widget-protocol';

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'op'; value: string };

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'exp', 'log', 'ln']);
const COLORS: FunctionPlotWidget['series'][number]['color'][] = [
  'blue', 'red', 'green', 'orange', 'purple', 'gray',
];

function normalizeExpression(value: string): string {
  return value
    .replaceAll('−', '-')
    .replaceAll('π', 'pi')
    .replaceAll('²', '^2')
    .replaceAll('³', '^3')
    .replace(/\bln\b/giu, 'log')
    .trim();
}

function tokenize(source: string): Token[] | null {
  if (source.length === 0 || source.length > 160) return null;
  const tokens: Token[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (/\s/u.test(char)) { index += 1; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(source.slice(index));
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: 'number', value });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z]+/u.exec(source.slice(index));
    if (name) {
      tokens.push({ kind: 'name', value: name[0]!.toLowerCase() });
      index += name[0].length;
      continue;
    }
    if ('+-*/^()'.includes(char)) {
      tokens.push({ kind: 'op', value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens.length > 0 && tokens.length <= 256 ? tokens : null;
}

class SafeFunctionParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[], private readonly x: number) {}

  parse(): number {
    const value = this.addSub();
    if (this.index !== this.tokens.length || !Number.isFinite(value)) throw new Error('invalid expression');
    return value;
  }

  private peek(): Token | undefined { return this.tokens[this.index]; }
  private take(): Token { return this.tokens[this.index++]!; }

  private addSub(): number {
    let value = this.mulDiv();
    while (this.peek()?.kind === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const operator = this.take().value;
      const right = this.mulDiv();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private startsFactor(token: Token | undefined): boolean {
    return token?.kind === 'number'
      || token?.kind === 'name'
      || (token?.kind === 'op' && token.value === '(');
  }

  private mulDiv(): number {
    let value = this.power();
    for (;;) {
      const token = this.peek();
      if (token?.kind === 'op' && (token.value === '*' || token.value === '/')) {
        const operator = this.take().value;
        const right = this.power();
        value = operator === '*' ? value * right : value / right;
      } else if (this.startsFactor(token)) {
        value *= this.power();
      } else break;
    }
    return value;
  }

  private power(): number {
    const left = this.unary();
    if (this.peek()?.kind === 'op' && this.peek()!.value === '^') {
      this.take();
      return left ** this.power();
    }
    return left;
  }

  private unary(): number {
    const token = this.peek();
    if (token?.kind === 'op' && (token.value === '+' || token.value === '-')) {
      const operator = this.take().value;
      const value = this.unary();
      return operator === '-' ? -value : value;
    }
    return this.atom();
  }

  private atom(): number {
    const token = this.take();
    if (token.kind === 'number') return token.value;
    if (token.kind === 'name') {
      if (token.value === 'x') return this.x;
      if (token.value === 'pi') return Math.PI;
      if (token.value === 'e') return Math.E;
      if (!FUNCTIONS.has(token.value) || this.take().value !== '(') throw new Error('invalid function');
      const argument = this.addSub();
      const close = this.take();
      if (close.kind !== 'op' || close.value !== ')') throw new Error('unclosed function');
      switch (token.value) {
        case 'sin': return Math.sin(argument);
        case 'cos': return Math.cos(argument);
        case 'tan': return Math.tan(argument);
        case 'sqrt': return Math.sqrt(argument);
        case 'abs': return Math.abs(argument);
        case 'exp': return Math.exp(argument);
        case 'log':
        case 'ln': return Math.log(argument);
      }
    }
    if (token.kind === 'op' && token.value === '(') {
      const value = this.addSub();
      const close = this.take();
      if (close.kind !== 'op' || close.value !== ')') throw new Error('unclosed group');
      return value;
    }
    throw new Error('invalid atom');
  }
}

function evaluate(source: string, x: number): number | null {
  const tokens = tokenize(normalizeExpression(source));
  if (!tokens) return null;
  try {
    const value = new SafeFunctionParser(tokens, x).parse();
    return Number.isFinite(value) && Math.abs(value) <= 1e6 ? value : null;
  } catch {
    return null;
  }
}

function expressionsFromProblem(problem: string): string[] {
  const expressions: string[] = [];
  const marker = /y\s*=/giu;
  for (const match of problem.matchAll(marker)) {
    const start = (match.index ?? 0) + match[0].length;
    const remainder = problem.slice(start);
    const boundary = /(?:与|和|以及|\band\b|\bwith\b)\s*y\s*=|[，,；;。\n]/iu.exec(remainder);
    const raw = remainder.slice(0, boundary?.index ?? remainder.length);
    const allowed = /^[0-9A-Za-zπ.+*/^() \t²³−]+/u.exec(raw)?.[0]?.trim() ?? '';
    if (allowed && !expressions.includes(allowed)) expressions.push(allowed);
    if (expressions.length >= 6) break;
  }
  return expressions;
}

export function hostFunctionPlotWidget(problem: string): FunctionPlotWidget | null {
  if (/(?:不(?:需要|要|用|显示|生成)|无需).{0,12}(?:widget|函数图|图表)/iu.test(problem)) return null;
  if (!/(?:\bwidget\b|交互(?:式)?函数图|函数图\s*(?:卡片|组件))/iu.test(problem)) return null;
  const expressions = expressionsFromProblem(problem);
  if (expressions.length === 0) return null;
  const series = expressions.flatMap((expression, index) => {
    const points: { x: number; y: number }[] = [];
    for (let sample = 0; sample <= 160; sample += 1) {
      const x = -5 + (sample / 160) * 10;
      const y = evaluate(expression, x);
      if (y !== null) points.push({ x, y });
    }
    return points.length >= 2
      ? [{ label: `y=${expression}`, color: COLORS[index]!, points }]
      : [];
  });
  if (series.length === 0) return null;
  return {
    kind: 'function-plot',
    title: series.length > 1 ? '函数关系对照' : '函数图',
    expression: series.map((entry) => entry.label).join(' · '),
    xLabel: 'x',
    yLabel: 'y',
    series,
  };
}

export const __hostFunctionWidgetTest = { evaluate, expressionsFromProblem };
