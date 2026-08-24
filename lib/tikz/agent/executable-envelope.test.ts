import { describe, expect, it } from 'vitest';
import { classifyTikzExecutableEnvelopes } from './executable-envelope';

describe('classifyTikzExecutableEnvelopes', () => {
  it('preserves ordered plain actions as one classifiable batch', () => {
    const result = classifyTikzExecutableEnvelopes([
      'first',
      '```tikz-action\n\\coordinate (D) at (1,0);\n```',
      'then',
      '```tikz-action\n\\draw (D) circle (1);\n```',
    ].join('\n'));
    expect(result).toMatchObject({
      openingCount: 2,
      malformed: false,
      plainActionCount: 2,
      semanticIntentCount: 0,
      legacyTypedActionCount: 0,
      typedActionCount: 0,
      toolCount: 0,
    });
    expect(result.envelopes.map((item) => item.body)).toEqual([
      '\\coordinate (D) at (1,0);',
      '\\draw (D) circle (1);',
    ]);
  });

  it('distinguishes mixed and unclosed executable output', () => {
    const mixed = classifyTikzExecutableEnvelopes([
      '```tikz-action\n\\draw (A)--(B);\n```',
      '```tikz-patch\n{}\n```',
    ].join('\n'));
    expect(mixed).toMatchObject({ plainActionCount: 1, typedActionCount: 1 });
    expect(mixed).toMatchObject({ semanticIntentCount: 0, legacyTypedActionCount: 1 });

    expect(classifyTikzExecutableEnvelopes(
      '```tikz-action\n\\draw (A)--(B);',
    )).toMatchObject({ openingCount: 1, malformed: true });
  });

  it('never treats an ordinary TikZ example as executable', () => {
    expect(classifyTikzExecutableEnvelopes(
      '```tikz\n\\draw (A)--(B);\n```',
    )).toMatchObject({ openingCount: 0, plainActionCount: 0, typedActionCount: 0 });
  });

  it('classifies one GeometryIntent as the semantic typed write envelope', () => {
    const result = classifyTikzExecutableEnvelopes(
      '```tikz-geometry-intent\n{"schemaVersion":"geometry-intent/v2"}\n```',
    );
    expect(result).toMatchObject({
      openingCount: 1,
      malformed: false,
      toolCount: 0,
      plainActionCount: 0,
      semanticIntentCount: 1,
      legacyTypedActionCount: 0,
      typedActionCount: 1,
    });
    expect(result.envelopes[0]?.kind).toBe('semantic-intent');
  });

  it('keeps legacy typed envelopes distinguishable from model-facing GeometryIntent', () => {
    const result = classifyTikzExecutableEnvelopes([
      '```tikz-geometry-intent\n{}\n```',
      '```tikz-managed-presentation\n{}\n```',
    ].join('\n'));
    expect(result).toMatchObject({
      typedActionCount: 2,
      semanticIntentCount: 1,
      legacyTypedActionCount: 1,
    });
  });
});
