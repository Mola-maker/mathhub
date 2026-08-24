import { describe, expect, it } from 'vitest';
import { lex } from './lexer';

describe('TikZ subset lexer numeric and opaque punctuation handling', () => {
  it.each([
    ['.5', '.5'],
    ['-.5', '.5'],
    ['.5e-2', '.5e-2'],
    ['1.', '1.'],
    ['1.5', '1.5'],
  ])('tokenizes %s as a number without losing the source range', (source, numericLexeme) => {
    const token = lex(source).find((candidate) => candidate.value === numericLexeme);
    expect(token).toMatchObject({ type: 'number', value: numericLexeme });
    expect(source.slice(token!.start, token!.end)).toBe(numericLexeme);
  });

  it.each(['.', 'A.center', '{text.}'])(
    'preserves dot punctuation in %s as a lossless token instead of throwing',
    (source) => {
      const tokens = lex(source);
      const dots = tokens.filter((token) => token.value === '.');
      expect(dots.length).toBeGreaterThan(0);
      expect(dots.every((token) => token.type === 'dot')).toBe(true);
      for (const token of dots) {
        expect(source.slice(token.start, token.end)).toBe('.');
      }
    },
  );
});
