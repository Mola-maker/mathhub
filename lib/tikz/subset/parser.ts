import { lex, type Token } from './lexer';
import {
  ParseError,
  type TikzPicture,
  type Statement,
  type CoordExpr,
  type CalcExpr,
  type NumExpr,
  type LetBinding,
  type PathSpec,
  type IntersectionBinding,
  type CircleRadius,
  type StyleOptions,
  type SourceRange,
} from './ast';

// ---------- cursor ----------

type Cursor = {
  tokens: Token[];
  pos: number;
  src: string;
  peek(): Token | undefined;
  peekAt(offset: number): Token | undefined;
  next(): Token;
  expect(type: Token['type'], what: string): Token;
  expectCmd(value: string): Token;
  fail(msg: string, t?: Token): never;
  readBracketRaw(): StyleOptions;
  readBraceRaw(): { raw: string; range: SourceRange };
};

function makeCursor(tokens: Token[], src: string): Cursor {
  const c: Cursor = {
    tokens, pos: 0, src,
    peek() { return this.tokens[this.pos]; },
    peekAt(offset) { return this.tokens[this.pos + offset]; },
    next() { return this.tokens[this.pos++]; },
    expect(type, what) {
      const t = this.peek();
      if (!t || t.type !== type) this.fail(`期望 ${what}`, t);
      return this.next();
    },
    expectCmd(value) {
      const t = this.peek();
      if (!t || t.type !== 'cmd' || t.value !== value) this.fail(`期望 ${value}`, t);
      return this.next();
    },
    fail(msg, t) {
      throw new ParseError(msg, t?.start ?? this.src.length, t?.end ?? this.src.length);
    },
    readBracketRaw() {
      const open = this.expect('lbracket', "'['");
      // bracket-depth scan: tokens '[' ]' are level markers; other tokens ('name', 'cmd', 'equals', etc.) are interior
      let depth = 1;
      while (this.pos < this.tokens.length && depth > 0) {
        const t = this.next();
        if (t.type === 'lbracket') depth++;
        else if (t.type === 'rbracket') depth--;
      }
      if (depth !== 0) this.fail("'[' 未闭合", open);
      const closeTok = this.tokens[this.pos - 1];
      const raw = this.src.slice(open.end, closeTok.start);
      const range: SourceRange = { start: open.start, end: closeTok.end };
      return { raw, range };
    },
    readBraceRaw() {
      const open = this.expect('lbrace', "'{'");
      let depth = 1;
      while (this.pos < this.tokens.length && depth > 0) {
        const t = this.next();
        if (t.type === 'lbrace') depth++;
        else if (t.type === 'rbrace') depth--;
      }
      if (depth !== 0) this.fail("'{' 未闭合", open);
      const closeTok = this.tokens[this.pos - 1];
      const raw = this.src.slice(open.end, closeTok.start);
      const range: SourceRange = { start: open.start, end: closeTok.end };
      return { raw, range };
    },
  };
  return c;
}

// ---------- coord ----------

function parseCoord(c: Cursor): CoordExpr {
  const open = c.expect('lparen', "'('");
  const t = c.peek();
  if (!t) c.fail("'(' 未闭合", open);

  if (t.type === 'dollar') {
    c.next(); // opening $
    const calcExpr = parseCalcExpr(c);
    c.expect('dollar', "'$'");
    const close = c.expect('rparen', "')'");
    return { kind: 'calc', expr: calcExpr, range: { start: open.start, end: close.end } };
  }

  if (t.type === 'number' || t.type === 'minus' || t.type === 'lbrace') {
    const x: { value: number | NumExpr; range: SourceRange } = parseLiteralOrBraceNumber(c);
    // unit detection after x: peek next
    const afterX = c.peek();
    if (afterX && afterX.type === 'name' && /^(cm|mm|in|pt|em|ex|mu|sp|gd)$/.test(afterX.value)) {
      c.fail('v1 子集坐标只支持纯数字（单位 cm 省略）', afterX);
    }
    c.expect('comma', "','");
    const y: { value: number | NumExpr; range: SourceRange } = parseLiteralOrBraceNumber(c);
    const after = c.peek();
    if (after && after.type === 'rparen') {
      c.next();
      return { kind: 'literal', x: x.value, y: y.value, range: { start: open.start, end: after.end } };
    }
    if (after && after.type === 'name') {
      c.fail('v1 子集坐标只支持纯数字（单位 cm 省略）', after);
    }
    c.fail('坐标字面量格式应为 (x,y)', after ?? open);
  }

  if (t.type === 'name') {
    const name = c.next();
    const close = c.expect('rparen', "')'");
    return { kind: 'ref', name: name.value, range: { start: open.start, end: close.end } };
  }

  c.fail("'(' 内无法识别", t);
}

function parseLiteralNumber(c: Cursor): { value: number; range: SourceRange } {
  const t = c.peek();
  if (!t) c.fail('期望数字');
  if (t.type === 'minus') {
    const m = c.next();
    const n = c.expect('number', '数字');
    return { value: -Number(n.value), range: { start: m.start, end: n.end } };
  }
  const n = c.expect('number', '数字');
  return { value: Number(n.value), range: { start: n.start, end: n.end } };
}

function offsetNumExprRanges(expr: NumExpr, offset: number): NumExpr {
  const range = {
    start: expr.range.start + offset,
    end: expr.range.end + offset,
  };
  switch (expr.kind) {
    case 'num-lit':
    case 'num-var':
    case 'num-comp':
      return { ...expr, range };
    case 'num-bin':
      return {
        ...expr,
        left: offsetNumExprRanges(expr.left, offset),
        right: offsetNumExprRanges(expr.right, offset),
        range,
      };
    case 'num-call':
      return {
        ...expr,
        arg: offsetNumExprRanges(expr.arg, offset),
        range,
      };
    case 'veclen':
      return {
        ...expr,
        x: offsetNumExprRanges(expr.x, offset),
        y: offsetNumExprRanges(expr.y, offset),
        range,
      };
  }
}

function parseLiteralOrBraceNumber(c: Cursor): { value: number | NumExpr; range: SourceRange } {
  const t = c.peek();
  if (!t) c.fail('期望数字');
  if (t.type === 'lbrace') {
    // {numexpr} — preserve the expression for the semantic evaluator.
    const inner = c.readBraceRaw();
    const subTokens = lex(inner.raw);
    const sub = makeCursor(subTokens, inner.raw);
    const expr = parseNumAddSub(sub);
    if (sub.peek()) sub.fail('花括号数值表达式末尾存在多余内容', sub.peek());
    return {
      value: offsetNumExprRanges(expr, inner.range.start + 1),
      range: { start: inner.range.start, end: inner.range.end },
    };
  }
  return parseLiteralNumber(c);
}

// ---------- calc ----------

function parseCalcFactor(c: Cursor): CalcExpr {
  const inner = parseCoord(c);
  return { op: 'coord', coord: inner, range: inner.range };
}

function parseNumAtom(c: Cursor): NumExpr {
  const t = c.peek();
  if (!t) c.fail('期望数字因子');
  if (t.type === 'number') {
    const n = c.next();
    return { kind: 'num-lit', value: Number(n.value), range: { start: n.start, end: n.end } };
  }
  if (t.type === 'minus') {
    const m = c.next();
    const n = c.expect('number', '数字');
    return { kind: 'num-lit', value: -Number(n.value), range: { start: m.start, end: n.end } };
  }
  if (t.type === 'cmd' && t.value === '\\n') {
    const cmd = c.next();
    const n = c.expect('number', '编号');
    return { kind: 'num-var', name: cmd.value + n.value, range: { start: cmd.start, end: n.end } };
  }
  if (t.type === 'cmd' && (t.value === '\\x' || t.value === '\\y')) {
    const cmd = c.next();
    const n = c.expect('number', '编号');
    return {
      kind: 'num-comp',
      pvar: `\\p${n.value}`,
      axis: cmd.value === '\\x' ? 'x' : 'y',
      range: { start: cmd.start, end: n.end },
    };
  }
  if (t.type === 'cmd' && t.value === '\\veclen') {
    const cmd = c.next();
    c.expect('lparen', "'('");
    const a = parseNumAddSub(c);
    c.expect('comma', "','");
    const b = parseNumAddSub(c);
    const close = c.expect('rparen', "')'");
    return { kind: 'veclen', x: a, y: b, range: { start: cmd.start, end: close.end } };
  }
  if (t.type === 'name' && (t.value === 'sin' || t.value === 'cos')) {
    const fn = c.next();
    c.expect('lparen', "'('");
    const arg = parseNumAddSub(c);
    const close = c.expect('rparen', "')'");
    return {
      kind: 'num-call',
      fn: fn.value as 'sin' | 'cos',
      arg,
      range: { start: fn.start, end: close.end },
    };
  }
  if (t.type === 'name' && t.value === 'veclen') {
    // bare 'veclen' (some sources omit the leading backslash)
    const cmd = c.next();
    c.expect('lparen', "'('");
    const a = parseNumAddSub(c);
    c.expect('comma', "','");
    const b = parseNumAddSub(c);
    const close = c.expect('rparen', "')'");
    return { kind: 'veclen', x: a, y: b, range: { start: cmd.start, end: close.end } };
  }
  if (t.type === 'lparen') {
    const open = c.next();
    const inner = parseNumAddSub(c);
    const close = c.expect('rparen', "')'");
    return { ...inner, range: { start: open.start, end: close.end } };
  }
  if (t.type === 'lbrace') {
    const inner = c.readBraceRaw();
    const subTokens = lex(inner.raw);
    const sub = makeCursor(subTokens, inner.raw);
    const expr = parseNumAddSub(sub);
    return offsetNumExprRanges(expr, inner.range.start + 1);
  }
  c.fail('无法解析数字因子', t);
}

function parseNumMulDiv(c: Cursor): NumExpr {
  let left = parseNumAtom(c);
  for (;;) {
    const t = c.peek();
    if (!t || (t.type !== 'star' && t.type !== 'slash')) break;
    const op = c.next();
    const right = parseNumAtom(c);
    left = {
      kind: 'num-bin',
      binop: op.type === 'star' ? '*' : '/',
      left, right,
      range: { start: left.range.start, end: right.range.end },
    };
  }
  return left;
}

function parseNumAddSub(c: Cursor): NumExpr {
  let left = parseNumMulDiv(c);
  for (;;) {
    const t = c.peek();
    if (!t || (t.type !== 'plus' && t.type !== 'minus')) break;
    const op = c.next();
    const right = parseNumMulDiv(c);
    left = {
      kind: 'num-bin',
      binop: op.type === 'plus' ? '+' : '-',
      left, right,
      range: { start: left.range.start, end: right.range.end },
    };
  }
  return left;
}

function parseCalcExpr(c: Cursor): CalcExpr {
  let left = parseCalcFactor(c);
  for (;;) {
    const t = c.peek();
    if (!t) break;
    if (t.type === 'plus' || t.type === 'minus') {
      const op = c.next();
      const right = parseCalcFactor(c);
      left = {
        op: op.type === 'plus' ? 'add' : 'sub',
        left, right,
        range: { start: left.range.start, end: right.range.end },
      };
      continue;
    }
    if (t.type === 'bang') {
      c.next(); // '!'
      // project: try factor P + '!' + factor B → project(left, P, B)
      if (c.peek()?.type === 'lparen') {
        const save = c.pos;
        try {
          const p = parseCalcFactor(c);
          if (c.peek()?.type === 'bang') {
            c.next();
            const b = parseCalcFactor(c);
            left = { op: 'project', a: left, p, b, range: { start: left.range.start, end: b.range.end } };
            continue;
          }
        } catch { /* fallthrough */ }
        c.pos = save; // restore
      }
      // interpolate / rotate: '!' t '!' [θ ':'] factor
      const tExpr = parseNumAddSub(c);
      c.expect('bang', "'!'");
      // peek-ahead: if after angle there's a ':' → rotate; else interpolate (angle was actually the next factor head)
      const probe = makeCursor(c.tokens.slice(c.pos), c.src);
      let angle: NumExpr | null = null;
      try {
        const a = probe.peek();
        // peek-ahead consumes up to but does not mutate outer c
        // For simple number angle: probe eats one number; if next probe token is ':' → rotate
        if (a && (a.type === 'number' || a.type === 'minus' || a.type === 'cmd')) {
          probe.next();
          if (probe.peek()?.type === 'colon') {
            // commit: parse angle with outer c
            angle = parseNumAddSub(c);
          }
        }
      } catch { /* not a rotate */ }
      if (angle && c.peek()?.type === 'colon') {
        c.next(); // ':'
        const factor = parseCalcFactor(c);
        left = {
          op: 'rotate',
          a: left,
          t: tExpr,
          angleDeg: angle,
          b: factor,
          range: { start: left.range.start, end: factor.range.end },
        };
        continue;
      }
      const b = parseCalcFactor(c);
      left = {
        op: 'interpolate',
        a: left, t: tExpr, b,
        range: { start: left.range.start, end: b.range.end },
      };
      continue;
    }
    break;
  }
  return left;
}

// ---------- statements ----------

function parseCoordinate(c: Cursor): Statement {
  const start = c.expectCmd('\\coordinate');
  c.expect('lparen', "'('");
  const name = c.expect('name', '点名称');
  c.expect('rparen', "')'");
  c.expect('name', "'at'");
  const at = parseCoord(c);
  c.expect('semi', "';'");
  return { kind: 'coordinate', name: name.value, at, range: { start: start.start, end: at.range.end + 1 } };
}

function parsePath(c: Cursor, command: 'draw' | 'path' | 'fill' | 'filldraw'): Statement {
  const startTok = c.expectCmd(`\\${command}`);
  let options: StyleOptions | null = null;
  let namePath: string | null = null;
  let intersections: { of: [string, string]; bindings: IntersectionBinding[] } | null = null;

  if (c.peek()?.type === 'lbracket') {
    const br = c.readBracketRaw();
    options = br;
    const mp = /name\s+path\s*=\s*([A-Za-z][A-Za-z0-9_-]*)/.exec(br.raw);
    if (mp) namePath = mp[1];
    const mi = /name\s+intersections\s*=\s*\{of\s*=\s*([A-Za-z][\w-]*)\s+and\s+([A-Za-z][\w-]*)\}/.exec(br.raw);
    if (mi) intersections = { of: [mi[1], mi[2]], bindings: [] };
  }

  const specs: PathSpec[] = [];
  for (;;) {
    const t = c.peek();
    if (!t) c.fail("缺少 ';'");
    if (t.type === 'semi') break;

    // intersections bindings: '(' 'intersection' '-' number ')' 'coordinate' '(' name ')'
    if (intersections && t.type === 'lparen' && c.peekAt(1)?.type === 'name' && c.peekAt(1)?.value?.startsWith('intersection')) {
      c.next(); // '('
      const tag = c.next();
      if (tag.type !== 'name' || !tag.value?.startsWith('intersection')) c.fail("应以 'intersection' 开头", tag);
      c.expect('minus', "'-'");
      const idx = c.expect('number', '编号');
      c.expect('rparen', "')'");
      const coordKw = c.next();
      if (coordKw.type !== 'name' || coordKw.value !== 'coordinate') c.fail("应为 'coordinate'", coordKw);
      c.expect('lparen', "'('");
      const nm = c.expect('name', '点名称');
      c.expect('rparen', "')'");
      intersections.bindings.push({ index: Number(idx.value), name: nm.value, range: { start: t.start, end: nm.end + 1 } });
      continue;
    }

    // coord (polyline/circle)
    const coord = parseCoord(c);
    const next = c.peek();
    if (next && next.type === 'name' && next.value === 'circle') {
      c.next();
      const rad = parseCircleRadius(c);
      specs.push({ type: 'circle', center: coord, radius: rad, range: { start: coord.range.start, end: rad.range.end } });
      continue;
    }
    // polyline
    const points: CoordExpr[] = [coord];
    let cycle = false;
    let lastEnd = coord.range.end;
    while (c.peek()?.type === 'dashdash') {
      c.next();
      const after = c.peek();
      if (after && after.type === 'name' && after.value === 'cycle') {
        c.next();
        cycle = true;
        lastEnd = after.end;
        break;
      }
      const pt = parseCoord(c);
      points.push(pt);
      lastEnd = pt.range.end;
    }
    specs.push({ type: 'polyline', points, cycle, range: { start: coord.range.start, end: lastEnd } });
  }
  const semi = c.expect('semi', "';'");
  return { kind: 'path', command, options, specs, namePath, intersections, range: { start: startTok.start, end: semi.end } };
}

function parseCircleRadius(c: Cursor): CircleRadius {
  const t = c.peek();
  if (!t) c.fail('圆括号期望');
  if (t.type === 'name' && t.value === 'through') {
    const through = c.next();
    const point = parseCoord(c);
    return {
      kind: 'through',
      point,
      range: { start: through.start, end: point.range.end },
    };
  }
  if (t.type === 'lparen') {
    const open = c.next();
    const num = c.expect('number', '半径数字');
    const close = c.expect('rparen', "')'");
    return { kind: 'literal', value: Number(num.value), range: { start: open.start, end: close.end } };
  }
  if (t.type === 'lbracket') {
    const br = c.readBracketRaw();
    const m = /^through\s*=\s*/.exec(br.raw.trimStart());
    if (!m) c.fail('圆括号仅支持标准 circle through (...) 语法', t);
    const inner = br.raw.slice(m[0].length).trim();
    const subTokens = lex(inner);
    const sub = makeCursor(subTokens, inner);
    const coord = parseCoord(sub);
    return { kind: 'through', point: coord, range: { start: br.range.start, end: br.range.end } };
  }
  c.fail('圆括号或 circle through (...)', t);
}

function parseNode(c: Cursor): Statement {
  const start = c.expectCmd('\\node');
  let options: StyleOptions | null = null;
  if (c.peek()?.type === 'lbracket') options = c.readBracketRaw();
  c.expect('name', "'at'");
  const at = parseCoord(c);
  const textBrace = c.readBraceRaw();
  const semi = c.expect('semi', "';'");
  const throughMatch = options
    ? /(?:^|,)\s*circle\s+through\s*=\s*\{?\s*(\([^)]+\))\s*\}?/.exec(options.raw)
    : null;
  if (throughMatch) {
    const throughCursor = makeCursor(lex(throughMatch[1]), throughMatch[1]);
    const throughPoint = parseCoord(throughCursor);
    if (throughCursor.peek()) throughCursor.fail('circle through 坐标后存在多余内容');
    const namePath = /(?:^|,)\s*name\s+path\s*=\s*([A-Za-z][A-Za-z0-9_-]*)/.exec(
      options?.raw ?? '',
    )?.[1] ?? null;
    const visible = /(?:^|,)\s*draw(?:\s|,|$)/.test(options?.raw ?? '');
    return {
      kind: 'path',
      command: visible ? 'draw' : 'path',
      options,
      specs: [{
        type: 'circle',
        center: at,
        radius: { kind: 'through', point: throughPoint, range: options!.range },
        range: { start: at.range.start, end: options!.range.end },
      }],
      namePath,
      intersections: null,
      range: { start: start.start, end: semi.end },
    };
  }
  return { kind: 'node', options, at, text: textBrace.raw, range: { start: start.start, end: semi.end } };
}

function parsePic(c: Cursor): Statement {
  const start = c.expectCmd('\\pic');
  let options: StyleOptions | null = null;
  if (c.peek()?.type === 'lbracket') options = c.readBracketRaw();
  const brace = c.readBraceRaw();
  const semi = c.expect('semi', "';'");
  const m = /^(angle|right\s+angle)\s*=\s*(\w+)\s*--\s*(\w+)\s*--\s*(\w+)$/.exec(brace.raw.trim());
  if (!m) c.fail('pic 仅支持 {angle = A--B--C} 或 {right angle = A--B--C}', { start: brace.range.start, end: brace.range.end, type: 'name', value: brace.raw } as Token);
  const picType: 'angle' | 'right-angle' = m[1] === 'angle' ? 'angle' : 'right-angle';
  return { kind: 'pic', picType, points: [m[2], m[3], m[4]], options, range: { start: start.start, end: semi.end } };
}

// ---------- statement dispatch ----------

function parseStatement(c: Cursor): Statement {
  const t = c.peek();
  if (!t || t.type !== 'cmd') c.fail('期望语句', t);
  if (t.value === '\\coordinate') return parseCoordinate(c);

  if (t.value === '\\path') {
    let p = c.peekAt(1);
    if (p && p.type === 'lbracket') {
      const save = c.pos + 1;
      try {
        const sub = makeCursor(c.tokens.slice(save), c.src);
        sub.readBracketRaw();
        p = sub.peek();
      } catch { p = undefined; }
    }
    if (p && p.type === 'name' && p.value === 'let') return parseLetCoordinate2(c);
    return parsePath(c, 'path');
  }
  if (t.value === '\\draw' || t.value === '\\fill' || t.value === '\\filldraw') {
    const cmd = t.value.slice(1) as 'draw' | 'fill' | 'filldraw';
    return parsePath(c, cmd);
  }
  if (t.value === '\\node') return parseNode(c);
  if (t.value === '\\pic') return parsePic(c);
  c.fail(`子集不支持的命令 ${t.value}`, t);
}

function parseLetCoordinate2(c: Cursor): Statement {
  c.expectCmd('\\path');
  // optional [...] options
  if (c.peek()?.type === 'lbracket') c.readBracketRaw();
  c.expect('name', "'let'");
  const bindings: LetBinding[] = [];
  for (;;) {
    const t = c.peek();
    if (t && t.type === 'name' && t.value === 'in') break;
    if (!t) c.fail('let 缺少 in');
    const tCmd = c.peek();
    if (!tCmd || tCmd.type !== 'cmd' || (tCmd.value !== '\\p' && tCmd.value !== '\\n')) {
      c.fail('let 绑定仅支持 \\p 或 \\n', tCmd);
    }
    const cmdTok = c.next();
    const bindingIndex = c.expect('number', '绑定编号');
    const bindingName = cmdTok.value + bindingIndex.value;
    c.expect('equals', "'='");
    if (cmdTok.value === '\\p') {
      const value = parseCoord(c);
      bindings.push({ type: 'point', name: bindingName, value, range: { start: cmdTok.start, end: value.range.end } });
    } else {
      c.expect('lbrace', "'{'");
      const value = parseNumAddSub(c);
      c.expect('rbrace', "'}'");
      bindings.push({ type: 'num', name: bindingName, value, range: { start: cmdTok.start, end: value.range.end + 1 } });
    }
    const sep = c.peek();
    if (sep && sep.type === 'comma') c.next();
    else break;
  }
  c.expect('name', "'in'");
  const coordKw = c.next();
  if (coordKw.type !== 'name' || coordKw.value !== 'coordinate') c.fail("期望 'coordinate' 关键字", coordKw);
  c.expect('lparen', "'('");
  const name = c.expect('name', '点名称');
  c.expect('rparen', "')'");
  c.expect('name', "'at'");
  const at = parseCoord(c);
  c.expect('semi', "';'");
  return { kind: 'let-coordinate', bindings, name: name.value, at, range: { start: bindings[0]?.range.start ?? name.start, end: at.range.end + 1 } };
}

// ---------- public entry ----------

export function parseTikz(src: string): TikzPicture {
  const tokens = lex(src);
  const c = makeCursor(tokens, src);
  const begin = c.expectCmd('\\begin');
  c.expect('lbrace', "'{'");
  const env = c.expect('name', '环境名');
  if (env.value !== 'tikzpicture') c.fail(`只支持 tikzpicture 环境，收到 ${env.value}`, env);
  c.expect('rbrace', "'}'");
  let scale: number | null = null;
  if (c.peek()?.type === 'lbracket') {
    const br = c.readBracketRaw();
    const m = /scale\s*=\s*([\d.]+)/.exec(br.raw);
    if (m) scale = Number(m[1]);
  }
  const statements: Statement[] = [];
  for (;;) {
    const t = c.peek();
    if (!t) { c.fail('缺少 \\end{tikzpicture}'); }
    if (t && t.type === 'cmd' && t.value === '\\end') {
      c.next();
      c.expect('lbrace', "'{'");
      const e = c.expect('name', '环境名');
      c.expect('rbrace', "'}'");
      if (e.value !== 'tikzpicture') c.fail('环境闭合不匹配', e);
      break;
    }
    statements.push(parseStatement(c));
  }
  return { scale, statements, range: { start: begin.start, end: src.length } };
}
