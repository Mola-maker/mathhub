export type TokenType =
  | 'cmd' | 'lbrace' | 'rbrace' | 'lbracket' | 'rbracket' | 'lparen' | 'rparen'
  | 'dashdash' | 'bang' | 'colon' | 'equals' | 'comma' | 'semi' | 'dollar'
  | 'plus' | 'minus' | 'star' | 'slash' | 'gt' | 'lt'
  | 'number' | 'name';

export interface Token { type: TokenType; value: string; start: number; end: number }

const SINGLE: Record<string, TokenType> = {
  '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket',
  '(': 'lparen', ')': 'rparen', '!': 'bang', ':': 'colon', '=': 'equals',
  ',': 'comma', ';': 'semi', '$': 'dollar', '+': 'plus', '*': 'star', '/': 'slash',
  '>': 'gt', '<': 'lt',
};

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (type: TokenType, value: string, start: number, end: number) => tokens.push({ type, value, start, end });
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(src.slice(i));
      if (m) { push('cmd', m[0], i, i + m[0].length); i += m[0].length; continue; }
      push('cmd', src.slice(i, i + 2), i, i + 2); i += 2; continue;
    }
    if (ch === '-' && src[i + 1] === '-') { push('dashdash', '--', i, i + 2); i += 2; continue; }
    if (ch === '-') { push('minus', '-', i, i + 1); i++; continue; }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { push('number', num[0], i, i + num[0].length); i += num[0].length; continue; }
    const nm = /^[A-Za-z][A-Za-z0-9_]*/.exec(src.slice(i));
    if (nm) { push('name', nm[0], i, i + nm[0].length); i += nm[0].length; continue; }
    const t = SINGLE[ch];
    if (t) { push(t, ch, i, i + 1); i++; continue; }
    throw new Error(`无法识别的字符 '${ch}' @${i}`);
  }
  return tokens;
}