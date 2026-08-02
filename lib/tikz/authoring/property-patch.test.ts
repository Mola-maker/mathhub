import { describe, expect, it } from 'vitest';
import { applyTextPatch } from '../document/source-transaction';
import {
  deleteStatementPatch,
  labelTextPatch,
  replaceLabelAnchorRaw,
} from './property-patch';

describe('TikZ authoring property patches', () => {
  it('replaces nested label text without touching options or position', () => {
    const source = '\\node[above,font=\\small] at (A) {$A_{1}$};';
    const patch = labelTextPatch(source, { start: 0, end: source.length }, '$P$');
    expect(applyTextPatch(source, patch))
      .toBe('\\node[above,font=\\small] at (A) {$P$};');
  });

  it('deletes exactly one statement and its trailing newline', () => {
    const source = '\\draw (A)--(B);\n\\draw (B)--(C);\n';
    const end = source.indexOf(';') + 1;
    expect(applyTextPatch(
      source,
      deleteStatementPatch(source, { start: 0, end }),
    )).toBe('\\draw (B)--(C);\n');
  });

  it('replaces a label anchor without dropping unrelated options', () => {
    expect(replaceLabelAnchorRaw('above,blue,font=\\small', 'below right'))
      .toBe('below right,blue,font=\\small');
  });
});
