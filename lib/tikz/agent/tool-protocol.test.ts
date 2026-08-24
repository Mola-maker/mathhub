import { describe, expect, it } from 'vitest';
import {
  countTikzExecutableActionFences,
  extractTikzAgentToolCall,
} from './tool-protocol';

const call = (overrides: Record<string, unknown> = {}) => `\`\`\`tikz-agent-tool
${JSON.stringify({
  schemaVersion: 'tikz-agent-tool-call/v1',
  callId: 'call-1',
  name: 'inspect-geometry',
  arguments: { refs: ['A'] },
  ...overrides,
})}
\`\`\``;

describe('TikZ agent tool protocol', () => {
  it('accepts exactly one closed read-tool call', () => {
    expect(extractTikzAgentToolCall(call())).toMatchObject({
      count: 1,
      call: { callId: 'call-1', name: 'inspect-geometry' },
    });
    for (const name of [
      'explain-relation',
      'inspect-construction',
      'simulate-intent',
      'build-proof-state',
      'verify-geometry-claim',
    ]) {
      expect(extractTikzAgentToolCall(call({ name }))).toMatchObject({
        count: 1,
        call: { name },
      });
    }
  });

  it('does not execute ordinary JSON or TikZ examples', () => {
    expect(extractTikzAgentToolCall('```json\n{"name":"inspect-geometry"}\n```'))
      .toEqual({ count: 0, call: null });
    expect(extractTikzAgentToolCall('```tikz\n\\draw (0,0)--(1,1);\n```'))
      .toEqual({ count: 0, call: null });
  });

  it('rejects multiple, unknown and malformed calls', () => {
    expect(extractTikzAgentToolCall(`${call()}\n${call({ callId: 'call-2' })}`))
      .toMatchObject({ count: 2, call: null });
    expect(extractTikzAgentToolCall(call({ name: 'commit-source' })).call).toBeNull();
    expect(extractTikzAgentToolCall('```tikz-agent-tool\n{broken}\n```').call).toBeNull();
  });

  it('counts write actions separately from read tools', () => {
    expect(countTikzExecutableActionFences(`${call()}\n\`\`\`tikz-action\n\\draw (A)--(B);\n\`\`\``))
      .toBe(1);
  });
});
