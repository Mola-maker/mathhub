import { classifyTikzExecutableEnvelopes } from './executable-envelope';

export const TIKZ_AGENT_TOOL_CALL_SCHEMA_VERSION =
  'tikz-agent-tool-call/v1' as const;

export type TikzAgentReadToolName =
  | 'inspect-geometry'
  | 'explain-relation'
  | 'inspect-construction'
  | 'simulate-intent'
  | 'build-proof-state'
  | 'verify-geometry-claim'
  | 'validate-tikz-action'
  | 'search-geometry-problems';

export interface TikzAgentToolCall {
  readonly schemaVersion: typeof TIKZ_AGENT_TOOL_CALL_SCHEMA_VERSION;
  readonly callId: string;
  readonly name: TikzAgentReadToolName;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type ExtractTikzAgentToolCallResult =
  | { readonly count: 0; readonly call: null }
  | { readonly count: number; readonly call: null; readonly error: string }
  | { readonly count: 1; readonly call: TikzAgentToolCall };

const TOOL_FENCE = /```tikz-agent-tool\s*\r?\n([\s\S]*?)```/giu;
const CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TOOL_NAMES: readonly TikzAgentReadToolName[] = [
  'inspect-geometry',
  'explain-relation',
  'inspect-construction',
  'simulate-intent',
  'build-proof-state',
  'verify-geometry-claim',
  'validate-tikz-action',
  'search-geometry-problems',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractTikzAgentToolCall(
  output: string,
): ExtractTikzAgentToolCallResult {
  const bodies = [...output.matchAll(TOOL_FENCE)].map((match) => match[1] ?? '');
  if (bodies.length === 0) return { count: 0, call: null };
  if (bodies.length !== 1) {
    return {
      count: bodies.length,
      call: null,
      error: 'An agent turn must contain at most one tool call.',
    };
  }
  if (bodies[0]!.length > 32_000) {
    return { count: 1, call: null, error: 'Agent tool call is too large.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodies[0]!);
  } catch {
    return { count: 1, call: null, error: 'Agent tool call is not valid JSON.' };
  }
  if (!isRecord(parsed)) {
    return { count: 1, call: null, error: 'Agent tool call must be an object.' };
  }
  if (
    parsed.schemaVersion !== TIKZ_AGENT_TOOL_CALL_SCHEMA_VERSION
    || typeof parsed.callId !== 'string'
    || !CALL_ID.test(parsed.callId)
    || typeof parsed.name !== 'string'
    || !TOOL_NAMES.includes(parsed.name as TikzAgentReadToolName)
    || !isRecord(parsed.arguments)
  ) {
    return { count: 1, call: null, error: 'Agent tool call has an invalid closed schema.' };
  }
  return {
    count: 1,
    call: {
      schemaVersion: TIKZ_AGENT_TOOL_CALL_SCHEMA_VERSION,
      callId: parsed.callId,
      name: parsed.name as TikzAgentReadToolName,
      arguments: parsed.arguments,
    },
  };
}

export function countTikzExecutableActionFences(output: string): number {
  const classified = classifyTikzExecutableEnvelopes(output);
  return classified.plainActionCount + classified.typedActionCount;
}
