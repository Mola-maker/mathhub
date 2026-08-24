import type { TikzAgentEvent } from './protocol';

export interface TikzAgentToolCallState {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: 'running' | 'completed' | 'rejected' | 'cancelled';
  readonly title: string;
  readonly detail?: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly startedEventId?: string;
  readonly terminalEventId?: string;
}

export interface TikzAgentRunState {
  readonly runId: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly steps: readonly TikzAgentEvent[];
  readonly toolCalls: readonly TikzAgentToolCallState[];
  readonly seenEventIds: ReadonlySet<string>;
  readonly lastSequence: number;
  readonly terminalEventId?: string;
}

export function emptyTikzAgentRun(runId: string): TikzAgentRunState {
  return {
    runId,
    status: 'running',
    steps: [],
    toolCalls: [],
    seenEventIds: new Set(),
    lastSequence: -1,
  };
}

function isToolEvent(event: TikzAgentEvent): boolean {
  return event.type === 'tool.started'
    || event.type === 'tool.completed'
    || event.type === 'tool.rejected';
}

function reduceToolCalls(
  toolCalls: readonly TikzAgentToolCallState[],
  event: TikzAgentEvent,
): readonly TikzAgentToolCallState[] | null {
  if (!isToolEvent(event) || !event.toolCallId || !event.toolName) return toolCalls;
  const index = toolCalls.findIndex((toolCall) => toolCall.toolCallId === event.toolCallId);
  const existing = index >= 0 ? toolCalls[index]! : undefined;
  if (existing && existing.toolName !== event.toolName) return null;
  if (existing && existing.status !== 'running') return null;

  const status = event.type === 'tool.completed'
    ? 'completed'
    : event.type === 'tool.rejected' ? 'rejected' : 'running';
  const updated: TikzAgentToolCallState = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status,
    title: event.title,
    ...(event.detail ? { detail: event.detail } : existing?.detail ? { detail: existing.detail } : {}),
    firstSequence: existing?.firstSequence ?? event.sequence,
    lastSequence: event.sequence,
    ...(existing?.startedEventId
      ? { startedEventId: existing.startedEventId }
      : event.type === 'tool.started' ? { startedEventId: event.eventId } : {}),
    ...(status !== 'running' ? { terminalEventId: event.eventId } : {}),
  };
  if (index < 0) return [...toolCalls, updated].slice(-64);
  const next = [...toolCalls];
  next[index] = updated;
  return next;
}

function settleOpenToolCalls(
  toolCalls: readonly TikzAgentToolCallState[],
  terminal: TikzAgentEvent,
): readonly TikzAgentToolCallState[] {
  let changed = false;
  const next = toolCalls.map((toolCall) => {
    if (toolCall.status !== 'running') return toolCall;
    changed = true;
    return {
      ...toolCall,
      status: terminal.type === 'run.failed' ? 'rejected' as const : 'cancelled' as const,
      lastSequence: terminal.sequence,
      terminalEventId: terminal.eventId,
    };
  });
  return changed ? next : toolCalls;
}

export function reduceTikzAgentRun(
  state: TikzAgentRunState,
  event: TikzAgentEvent,
): TikzAgentRunState {
  if (event.runId !== state.runId || state.seenEventIds.has(event.eventId)) return state;
  if (state.status !== 'running') return state;
  if (event.sequence <= state.lastSequence) return state;
  const projectedToolCalls = reduceToolCalls(state.toolCalls, event);
  // A toolCallId is a stable identity within one run. Conflicting tool names,
  // regressions after a tool terminal, or repeated terminal transitions are
  // quarantined instead of becoming extra UI actions.
  if (projectedToolCalls === null) return state;
  const terminal = event.type === 'run.completed' || event.type === 'run.failed';
  const toolCalls = terminal
    ? settleOpenToolCalls(projectedToolCalls, event)
    : projectedToolCalls;
  const seen = new Set(state.seenEventIds);
  seen.add(event.eventId);
  return {
    runId: state.runId,
    status: event.type === 'run.failed'
      ? 'failed'
      : terminal ? 'completed' : 'running',
    steps: [...state.steps, event].slice(-64),
    toolCalls,
    seenEventIds: seen,
    lastSequence: event.sequence,
    ...(terminal ? { terminalEventId: event.eventId } : {}),
  };
}
