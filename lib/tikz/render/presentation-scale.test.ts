import { describe, expect, it } from 'vitest';
import {
  presentationDashArray,
  presentationDashOffset,
  presentationFont,
  presentationStrokeWidth,
} from './presentation-scale';
import { NATURAL_CM_TO_CSS_PX } from './viewport';

describe('TikZ physical presentation scale', () => {
  it('keeps natural dvisvgm dimensions at one CSS centimetre', () => {
    const viewport = { scale: NATURAL_CM_TO_CSS_PX };
    expect(presentationStrokeWidth(0.531, viewport)).toBeCloseTo(0.531, 6);
    expect(presentationDashArray('3.985 3.985', viewport)).toBe('3.985 3.985');
    expect(presentationDashOffset(1.328, viewport)).toBeCloseTo(1.328, 6);
    expect(presentationFont('italic 13px KaTeX_Math', viewport)).toBe('italic 13px KaTeX_Math');
  });

  it('scales physical presentation with the fitted geometry', () => {
    const viewport = { scale: NATURAL_CM_TO_CSS_PX * 2 };
    expect(presentationStrokeWidth(0.531, viewport)).toBeCloseTo(1.062, 6);
    expect(presentationDashArray('3.985 3.985', viewport)).toBe('7.97 7.97');
    expect(presentationDashOffset(1.328, viewport)).toBeCloseTo(2.656, 6);
    expect(presentationFont('italic 13px KaTeX_Math', viewport)).toBe('italic 26px KaTeX_Math');
  });
});
