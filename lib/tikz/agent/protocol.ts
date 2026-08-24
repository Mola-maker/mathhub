export const TIKZ_AGENT_EVENT_SCHEMA_VERSION = 'tikz-agent-event/v1' as const;
export const MAX_TIKZ_AGENT_EVENT_BYTES = 60 * 1024;
export const MAX_TIKZ_AGENT_PROPOSAL_EVENT_BYTES = 48 * 1024;

export function tikzAgentEventBytes(event: Record<string, unknown>): number {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`).byteLength;
}

export type TikzAgentEventType =
  | 'run.started'
  | 'context.read'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.rejected'
  | 'proposal.preparing'
  | 'proposal.ready'
  | 'proposal.rejected'
  | 'commit.started'
  | 'commit.completed'
  | 'commit.verified'
  | 'commit.rejected'
  | 'run.completed'
  | 'run.failed';

export interface TikzAgentArtifactRef {
  readonly schemaVersion: 'tikz-agent-artifact-ref/v1';
  readonly artifactKind: 'geometry-proof-plan';
  readonly artifactId: string;
  readonly observationCallId: string;
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceId?: string;
  readonly sourceHash: string;
}

export interface TikzAgentEvent {
  schemaVersion: typeof TIKZ_AGENT_EVENT_SCHEMA_VERSION;
  runId: string;
  eventId: string;
  sequence: number;
  type: TikzAgentEventType;
  title: string;
  detail?: string;
  toolCallId?: string;
  toolName?: string;
  /** Bounded durable pointer; the full artifact remains in the tool receipt. */
  artifactRef?: TikzAgentArtifactRef;
  outcome?: 'answer' | 'mutation' | 'unapplied-candidate' | 'failed';
}

export function tikzAgentEvent(
  runId: string,
  sequence: number,
  event: Omit<TikzAgentEvent, 'schemaVersion' | 'runId' | 'eventId' | 'sequence'>,
): TikzAgentEvent {
  return {
    schemaVersion: TIKZ_AGENT_EVENT_SCHEMA_VERSION,
    runId,
    eventId: `${runId}:${sequence}`,
    sequence,
    ...event,
  };
}

export function isTikzAgentEvent(value: unknown): value is TikzAgentEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<TikzAgentEvent>;
  const types: readonly TikzAgentEventType[] = [
    'run.started',
    'context.read',
    'tool.started',
    'tool.completed',
    'tool.rejected',
    'proposal.preparing',
    'proposal.ready',
    'proposal.rejected',
    'commit.started',
    'commit.completed',
    'commit.verified',
    'commit.rejected',
    'run.completed',
    'run.failed',
  ];
  const outcomes: readonly NonNullable<TikzAgentEvent['outcome']>[] = [
    'answer',
    'mutation',
    'unapplied-candidate',
    'failed',
  ];
  const toolEvent = event.type === 'tool.started'
    || event.type === 'tool.completed'
    || event.type === 'tool.rejected';
  const artifactRef = event.artifactRef;
  const artifactRecord = artifactRef !== null
    && typeof artifactRef === 'object'
    && !Array.isArray(artifactRef)
    ? artifactRef as Partial<TikzAgentArtifactRef>
    : null;
  const validArtifactRef = artifactRef === undefined || Boolean(
    artifactRecord
    && artifactRecord.schemaVersion === 'tikz-agent-artifact-ref/v1'
    && artifactRecord.artifactKind === 'geometry-proof-plan'
    && typeof artifactRecord.artifactId === 'string'
    && artifactRecord.artifactId.length > 0
    && artifactRecord.artifactId.length <= 256
    && typeof artifactRecord.observationCallId === 'string'
    && artifactRecord.observationCallId.length > 0
    && artifactRecord.observationCallId.length <= 128
    && typeof artifactRecord.documentId === 'string'
    && artifactRecord.documentId.length > 0
    && typeof artifactRecord.epoch === 'string'
    && artifactRecord.epoch.length > 0
    && Number.isSafeInteger(artifactRecord.revision)
    && (artifactRecord.revision ?? -1) >= 0
    && (artifactRecord.sourceId === undefined || typeof artifactRecord.sourceId === 'string')
    && typeof artifactRecord.sourceHash === 'string'
    && artifactRecord.sourceHash.length > 0
  );
  return event.schemaVersion === TIKZ_AGENT_EVENT_SCHEMA_VERSION
    && typeof event.runId === 'string'
    && event.runId.length > 0
    && typeof event.eventId === 'string'
    && event.eventId.length > 0
    && typeof event.sequence === 'number'
    && Number.isSafeInteger(event.sequence)
    && event.sequence >= 0
    && typeof event.type === 'string'
    && types.includes(event.type as TikzAgentEventType)
    && typeof event.title === 'string'
    && event.title.length > 0
    && (event.detail === undefined || typeof event.detail === 'string')
    && validArtifactRef
    && (
      !toolEvent
      || (
        typeof event.toolCallId === 'string'
        && event.toolCallId.length > 0
        && typeof event.toolName === 'string'
        && event.toolName.length > 0
      )
    )
    && (
      event.outcome === undefined
      || outcomes.includes(event.outcome as NonNullable<TikzAgentEvent['outcome']>)
    );
}
