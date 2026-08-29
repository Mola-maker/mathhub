import { describe, expect, it } from 'vitest';
import {
  compactGeometryConversationContext,
  isGeometryAgentContextCheckpoint,
} from './conversation-context';

describe('compactGeometryConversationContext', () => {
  it('retains newest intent and records dropped dialogue without creating truth', () => {
    const result = compactGeometryConversationContext(
      Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `${index}:${'x'.repeat(2_000)}`,
      })),
      { lane: 'geogebra', maxMessages: 4, maxMessageChars: 800, maxTotalChars: 2_400 },
    );

    expect(result.messages.at(-1)?.content).toContain('11:');
    expect(result.checkpoint.droppedMessageCount).toBeGreaterThan(0);
    expect(result.checkpoint.truthPolicy).toBe('current-source-projection-only');
    expect(result.checkpoint.summaryPromotedToTruth).toBe(false);
    expect(result.checkpoint.loss).toContain('revision-basis-unavailable');
  });

  it('omits an oversized fenced protocol as a whole instead of slicing it', () => {
    const protocol = `\`\`\`ggb\n${'A=Point(x)\n'.repeat(500)}\`\`\``;
    const result = compactGeometryConversationContext([
      { role: 'assistant', content: `before\n${protocol}\nactionable tail` },
      { role: 'user', content: 'continue from the current canvas' },
    ], {
      lane: 'geogebra',
      maxMessages: 2,
      maxMessageChars: 700,
      maxTotalChars: 1_000,
    });

    const assistant = result.messages[0]?.content ?? '';
    expect(assistant).not.toContain('```ggb');
    expect(assistant).toContain('actionable tail');
    expect(result.checkpoint.droppedStructuredBlockCount).toBe(1);
    expect(result.checkpoint.loss).toContain('structured-block-dropped');
  });

  it('carries an explicitly attested revision basis in the receipt', () => {
    const result = compactGeometryConversationContext([
      { role: 'user', content: 'draw the orthocenter' },
    ], {
      lane: 'tikz',
      basis: {
        lane: 'tikz',
        documentId: 'doc-1',
        epoch: 'epoch-1',
        revision: 4,
        sourceId: 'doc-1:tikz',
        sourceHash: 'abcd',
        semanticHash: 'semantic-abcd',
        attestation: 'server-attested',
      },
    });

    expect(result.checkpoint.basis?.revision).toBe(4);
    expect(result.checkpoint.basis?.semanticHash).toBe('semantic-abcd');
    expect(result.checkpoint.basis?.attestation).toBe('server-attested');
    expect(result.checkpoint.loss).not.toContain('revision-basis-unavailable');
    expect(isGeometryAgentContextCheckpoint(result.checkpoint)).toBe(true);
  });

  it('rejects receipts whose loss ledger or basis identity is inconsistent', () => {
    const result = compactGeometryConversationContext([
      { role: 'user', content: 'draw the orthocenter' },
    ], { lane: 'tikz' });
    expect(isGeometryAgentContextCheckpoint({
      ...result.checkpoint,
      loss: [],
    })).toBe(false);
    expect(isGeometryAgentContextCheckpoint({
      ...result.checkpoint,
      basis: {
        lane: 'tikz',
        documentId: 'doc\u0000',
        epoch: 'epoch-1',
        revision: 0,
        sourceId: 'doc:tikz',
        sourceHash: 'abcd',
        attestation: 'server-attested',
      },
      loss: [],
    })).toBe(false);
    expect(isGeometryAgentContextCheckpoint({
      ...result.checkpoint,
      basis: {
        lane: 'geogebra',
        documentId: 'doc-2',
        epoch: 'epoch-1',
        revision: 0,
        sourceHash: 'abcd',
        semanticHash: 'bad\u0000hash',
        attestation: 'client-declared',
      },
      loss: [],
    })).toBe(false);
  });
});
