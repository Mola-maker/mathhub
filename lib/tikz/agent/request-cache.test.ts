import { describe, expect, it } from 'vitest';
import {
  buildTikzRuntimeContext,
  buildTikzStableSystemPrompt,
} from '@/lib/tikz/prompt/tikz-system-prompt';
import {
  sameTikzAgentPrefixLane,
  tikzAgentRequestCacheIdentity,
} from './request-cache';

describe('TikZ agent request cache identity', () => {
  it('keeps the provider prefix stable while source, geometry and request change', () => {
    const stableSystemPrompt = buildTikzStableSystemPrompt();
    const first = tikzAgentRequestCacheIdentity({
      provider: 'relay',
      model: 'deepseek-v4',
      stableSystemPrompt,
      runtimeContext: buildTikzRuntimeContext('画一个三角形', {
        previousCode: '\\begin{tikzpicture}\\end{tikzpicture}',
        semanticContext: '{"basis":{"revision":1}}',
      }),
    });
    const second = tikzAgentRequestCacheIdentity({
      provider: 'relay',
      model: 'deepseek-v4',
      stableSystemPrompt,
      runtimeContext: buildTikzRuntimeContext('把九点圆改成红色', {
        previousCode: '\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}',
        semanticContext: '{"basis":{"revision":8}}',
      }),
    });

    expect(sameTikzAgentPrefixLane(first, second)).toBe(true);
    expect(first.stablePrefixDigest).toBe(second.stablePrefixDigest);
    expect(first.runtimeContextDigest).not.toBe(second.runtimeContextDigest);
    expect(stableSystemPrompt).not.toContain('# Current Canvas source');
    expect(stableSystemPrompt).not.toContain('# User request');
  });

  it('separates provider and model cache lanes', () => {
    const stableSystemPrompt = buildTikzStableSystemPrompt();
    const identity = (provider: string, model: string) => tikzAgentRequestCacheIdentity({
      provider,
      model,
      stableSystemPrompt,
      runtimeContext: 'runtime',
    });
    expect(sameTikzAgentPrefixLane(identity('relay', 'a'), identity('relay', 'b'))).toBe(false);
    expect(sameTikzAgentPrefixLane(identity('relay', 'a'), identity('other', 'a'))).toBe(false);
  });
});
