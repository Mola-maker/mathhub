import { describe, expect, it } from 'vitest';
import {
  authoringLines,
  elementSource,
  insertBeforeTikzEndPatch,
  nextPointName,
  type AuthoringAnchor,
} from './source-builder';

const A: AuthoringAnchor = {
  name: 'A',
  position: { x: 0, y: 0 },
  existing: true,
};
const P1: AuthoringAnchor = {
  name: 'P1',
  position: { x: 1.25, y: -2 },
  existing: false,
};

describe('TikZ authoring source builder', () => {
  it('creates collision-free point names', () => {
    expect(nextPointName(new Set(['P1', 'P2']))).toBe('P3');
  });

  it('adds only new coordinates before a segment', () => {
    expect(authoringLines('segment', [A, P1])).toEqual([
      '\\coordinate (P1) at (1.25,-2);',
      '\\draw (A) -- (P1);',
    ]);
  });

  it('builds editable semantic categories', () => {
    expect(elementSource('circle', [A, P1]))
      .toBe('\\node[draw,circle through=(P1)] at (A) {};');
    expect(elementSource('right-angle', [A, P1, { ...P1, name: 'P2' }]))
      .toContain('right angle = A--P1--P2');
    expect(elementSource('vector', [A, P1]))
      .toBe('\\draw[->] (A) -- (P1);');
  });

  it('builds source-native derived point constructions', () => {
    expect(authoringLines('midpoint', [A, { ...P1, existing: true }], 'M1'))
      .toEqual(['\\coordinate (M1) at ($(A)!0.5!(P1)$);']);
    expect(authoringLines(
      'perpendicular-foot',
      [A, { ...P1, name: 'B', existing: true }, { ...P1, name: 'C', existing: true }],
      'H1',
    )).toEqual(['\\coordinate (H1) at ($(B)!(A)!(C)$);']);
  });

  it('inserts immediately before the tikzpicture end marker', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const patch = insertBeforeTikzEndPatch(source, ['\\coordinate (P1) at (1,2);']);
    expect(source.slice(0, patch.from) + patch.insert + source.slice(patch.to))
      .toContain('\\coordinate (P1) at (1,2);\n\\end{tikzpicture}');
  });
});
