import { describe, expect, it } from 'vitest';
import {
  createTikzAgentRunResumeToken,
  verifyTikzAgentRunResumeToken,
} from './run-resume-token';

describe('TikZ Agent run resume token', () => {
  it('binds an opaque recovery capability to exactly one run id', () => {
    const token = createTikzAgentRunResumeToken('tikz-run-a');
    expect(verifyTikzAgentRunResumeToken('tikz-run-a', token)).toBe(true);
    expect(verifyTikzAgentRunResumeToken('tikz-run-b', token)).toBe(false);
    expect(verifyTikzAgentRunResumeToken('tikz-run-a', `${token}x`)).toBe(false);
  });
});
