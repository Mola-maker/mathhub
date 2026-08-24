import { describe, expect, it } from 'vitest';
import { extractAiPatchProposal } from './extract-ai-patch';

const validProposal = {
  schemaVersion: 'ai-patch-proposal/v1',
  proposalId: 'proposal-1',
  idempotencyKey: 'proposal-1',
  basis: {
    documentId: 'document-1',
    epoch: 'epoch-1',
    revision: 0,
    sourceHash: 'hash-1',
    sourceId: 'document-1:tikz',
  },
  focusBindingIds: ['binding-1'],
  readBindingIds: ['binding-1'],
  operations: [],
};

describe('extractAiPatchProposal', () => {
  it('never executes a valid proposal shown in an ordinary JSON example', () => {
    const result = extractAiPatchProposal(
      `Example only:\n\`\`\`json\n${JSON.stringify(validProposal)}\n\`\`\``,
    );
    expect(result.proposal).toBeNull();
    expect(result.actionCount).toBe(0);
    expect(result.error).toContain('GeometryIntent');
    expect(result.error).not.toContain('ai-patch-proposal/v1');
  });

  it('fails closed when the model emits more than one executable action', () => {
    const fenced = `\`\`\`tikz-patch\n${JSON.stringify(validProposal)}\n\`\`\``;
    const result = extractAiPatchProposal(`${fenced}\n${fenced}`);
    expect(result.proposal).toBeNull();
    expect(result.actionCount).toBe(2);
    expect(result.error).toContain('more than one');
  });

  it('extracts only the closed GeometryIntent model-facing schema', () => {
    const intent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'create-nine-point',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
      },
    };
    expect(extractAiPatchProposal(
      `\`\`\`tikz-geometry-intent\n${JSON.stringify(intent)}\n\`\`\``,
    )).toMatchObject({ proposal: intent, actionCount: 1, error: null });
    expect(extractAiPatchProposal(
      `\`\`\`json\n${JSON.stringify(intent)}\n\`\`\``,
    )).toMatchObject({ proposal: null, actionCount: 0 });

    const transformIntent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'move-existing-segment',
      operation: {
        kind: 'transform',
        targetRefs: ['segment:AB'],
        transform: { kind: 'translate', dx: 1, dy: -0.5 },
      },
    };
    expect(extractAiPatchProposal(
      `\`\`\`tikz-geometry-intent\n${JSON.stringify(transformIntent)}\n\`\`\``,
    )).toMatchObject({ proposal: transformIntent, actionCount: 1, error: null });

    const deleteIntent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'delete-existing-segment',
      operation: {
        kind: 'delete',
        targetRefs: ['segment:AB'],
      },
    };
    expect(extractAiPatchProposal(
      `\`\`\`tikz-geometry-intent\n${JSON.stringify(deleteIntent)}\n\`\`\``,
    )).toMatchObject({ proposal: deleteIntent, actionCount: 1, error: null });
    expect(extractAiPatchProposal(
      `\`\`\`tikz-geometry-intent\n${JSON.stringify({
        ...deleteIntent,
        operation: { ...deleteIntent.operation, mode: 'cascade' },
      })}\n\`\`\``,
    )).toMatchObject({ proposal: null, actionCount: 1 });
  });
});
