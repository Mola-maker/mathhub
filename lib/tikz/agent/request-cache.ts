import { hashSource } from '@/lib/tikz/document/source-hash';

export const TIKZ_AGENT_REQUEST_CACHE_SCHEMA_VERSION =
  'tikz-agent-request-cache/v1' as const;

export interface TikzAgentRequestCacheIdentity {
  readonly schemaVersion: typeof TIKZ_AGENT_REQUEST_CACHE_SCHEMA_VERSION;
  readonly provider: string;
  readonly model: string;
  /** Identity of the byte-stable provider prefix. */
  readonly stablePrefixDigest: string;
  /** Identity of the revision-bound snapshot appended after that prefix. */
  readonly runtimeContextDigest: string;
  readonly stablePrefixChars: number;
  readonly runtimeContextChars: number;
}

/**
 * Describe, but never cache, one provider request. The provider may reuse the
 * stable prefix while the runtime digest continues to bind the current Canvas
 * revision. A cached model answer is never reused as document truth.
 */
export function tikzAgentRequestCacheIdentity(input: {
  readonly provider: string;
  readonly model: string;
  readonly stableSystemPrompt: string;
  readonly runtimeContext: string;
}): TikzAgentRequestCacheIdentity {
  return {
    schemaVersion: TIKZ_AGENT_REQUEST_CACHE_SCHEMA_VERSION,
    provider: input.provider,
    model: input.model,
    stablePrefixDigest: hashSource(input.stableSystemPrompt),
    runtimeContextDigest: hashSource(input.runtimeContext),
    stablePrefixChars: input.stableSystemPrompt.length,
    runtimeContextChars: input.runtimeContext.length,
  };
}

/** Same provider/model and byte-identical stable policy can share a prefix cache lane. */
export function sameTikzAgentPrefixLane(
  left: TikzAgentRequestCacheIdentity,
  right: TikzAgentRequestCacheIdentity,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.provider === right.provider
    && left.model === right.model
    && left.stablePrefixDigest === right.stablePrefixDigest;
}
