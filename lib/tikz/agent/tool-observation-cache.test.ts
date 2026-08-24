import { describe, expect, it } from 'vitest';
import { tikzAgentToolObservationCacheKey } from './tool-observation-cache';

describe('tikzAgentToolObservationCacheKey', () => {
  it('canonicalizes deterministic read-tool argument order', () => {
    const left = tikzAgentToolObservationCacheKey({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'a',
      name: 'inspect-geometry',
      arguments: { depth: 2, refs: ['A'] },
    });
    const right = tikzAgentToolObservationCacheKey({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'b',
      name: 'inspect-geometry',
      arguments: { refs: ['A'], depth: 2 },
    });
    expect(left).toBe(right);
  });

  it('does not memoize external problem search', () => {
    expect(tikzAgentToolObservationCacheKey({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'search',
      name: 'search-geometry-problems',
      arguments: { query: 'Simson' },
    })).toBeNull();
  });

  it('memoizes every GeometryDoc-bound semantic read tool', () => {
    for (const name of [
      'explain-relation',
      'inspect-construction',
      'simulate-intent',
      'build-proof-state',
      'verify-geometry-claim',
      'validate-tikz-action',
    ] as const) {
      expect(tikzAgentToolObservationCacheKey({
        schemaVersion: 'tikz-agent-tool-call/v1',
        callId: `cache-${name}`,
        name,
        arguments: { refs: ['A'] },
      })).toBe(`${name}:{"refs":["A"]}`);
    }
  });
});
