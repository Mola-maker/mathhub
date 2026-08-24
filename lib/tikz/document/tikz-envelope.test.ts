import { describe, expect, it } from 'vitest';
import { tikzPictureBodyEndOffset } from './tikz-envelope';

describe('tikzPictureBodyEndOffset', () => {
  it('keeps the outer insertion point when an inner statement is opaque', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\path let \\p1=($(B)-(A)$), \\n1={\\x1+\\y1} in coordinate (N) at (0,0);',
      '\\end{tikzpicture}',
    ].join('\n');

    expect(tikzPictureBodyEndOffset(source)).toBe(source.indexOf('\\end{tikzpicture}'));
  });

  it('rejects ambiguous multiple top-level picture envelopes', () => {
    const source = '\\begin{tikzpicture}\\end{tikzpicture}\\begin{tikzpicture}\\end{tikzpicture}';
    expect(tikzPictureBodyEndOffset(source)).toBeNull();
  });
});
