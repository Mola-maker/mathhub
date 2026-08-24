import { describe, expect, it } from 'vitest';
import { isTikzAgentEvent, tikzAgentEvent } from './protocol';

describe('TikZ agent durable artifact references', () => {
  it('accepts a bounded revision-bound proof-plan reference on a tool terminal', () => {
    const event = tikzAgentEvent('run-1', 2, {
      type: 'tool.completed',
      title: 'proof ready',
      toolCallId: 'proof-call',
      toolName: 'build-proof-state',
      artifactRef: {
        schemaVersion: 'tikz-agent-artifact-ref/v1',
        artifactKind: 'geometry-proof-plan',
        artifactId: 'proof-plan:abc',
        observationCallId: 'proof-call',
        documentId: 'doc',
        epoch: 'epoch',
        revision: 4,
        sourceId: 'doc:tikz',
        sourceHash: 'source-hash',
      },
    });

    expect(isTikzAgentEvent(event)).toBe(true);
  });

  it('rejects an unbounded or incomplete durable artifact reference', () => {
    const event = tikzAgentEvent('run-1', 2, {
      type: 'tool.completed',
      title: 'proof ready',
      toolCallId: 'proof-call',
      toolName: 'build-proof-state',
    });
    expect(isTikzAgentEvent({
      ...event,
      artifactRef: {
        schemaVersion: 'tikz-agent-artifact-ref/v1',
        artifactKind: 'geometry-proof-plan',
        artifactId: '',
      },
    })).toBe(false);
  });
});
