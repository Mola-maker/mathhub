import { describe, expect, it } from 'vitest';
import { buildMathDrawingSystemPrompt } from './math-system-prompt';

describe('GeoGebra assistant source-of-truth policy', () => {
  it('keeps compacted dialogue subordinate to the current command snapshot', () => {
    const { prompt } = buildMathDrawingSystemPrompt('继续构造三角形的高。', {
      drawingCommand: 'continue',
      previousGgbCommands: [
        'A=(0,0)',
        'B=(4,0)',
        'C=(1,3)',
      ],
    });

    expect(prompt).toContain('Conversation history is advisory');
    expect(prompt).toContain('CURRENT CANVAS commands');
    expect(prompt).toContain('Never resurrect a dropped object, constraint, or relation');
  });
});
