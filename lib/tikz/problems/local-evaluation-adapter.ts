import {
  tikzAgentEvent,
  type TikzAgentEvent,
} from '../agent/protocol';
import { hashSource } from '../document/source-hash';
import type { GeometryTransactionRequest } from '../ir/transactions';
import { attestAiTransaction } from '../transactions/transaction-attestation';
import type { SourceHashEvidence } from '../transactions/broker';
import type {
  GeometryEvaluationCapability,
  GeometryEvaluationLane,
} from './evaluation-corpus';
import {
  GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION,
  GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION,
  type GeometryEvaluationAdapter,
  type GeometryEvaluationAnswerEvidence,
  type GeometryEvaluationRenderArtifactAttestation,
  type GeometryEvaluationSnapshot,
} from './evaluation-runner';

type MutationLane = Extract<
  GeometryEvaluationLane,
  'construct' | 'modify-existing' | 'transform-selection'
>;

export interface LocalGeometryEvaluationMutationContext {
  readonly snapshot: GeometryEvaluationSnapshot;
  readonly instruction: string;
  readonly turnIndex: number;
}

export type LocalGeometryEvaluationMutationBuilder = (
  context: LocalGeometryEvaluationMutationContext,
) => GeometryTransactionRequest | Promise<GeometryTransactionRequest>;

export interface LocalGeometryEvaluationRenderCapture {
  readonly lane: 'interactive' | 'exact';
  readonly rendererId: string;
  readonly mediaType: string;
  readonly artifact: string;
  /** Required for exact captures; supplied by the actual compiler caller. */
  readonly exactCompiler?: {
    readonly jobId: string;
    readonly compilerId: string;
    readonly compilerProfileDigest: string;
  };
}

export interface LocalGeometryEvaluationAdapterOptions {
  readonly capabilities: readonly GeometryEvaluationCapability[];
  readonly answer?: (input: {
    readonly snapshot: GeometryEvaluationSnapshot;
    readonly instruction: string;
    readonly turnIndex: number;
  }) => GeometryEvaluationAnswerEvidence | Promise<GeometryEvaluationAnswerEvidence>;
  readonly mutations?: Readonly<Partial<Record<MutationLane, LocalGeometryEvaluationMutationBuilder>>>;
  /**
   * The adapter never manufactures a render. The caller must return captured
   * artifact bytes and, for exact TeX, a concrete compiler job/profile identity.
   */
  readonly render?: (input: {
    readonly snapshot: GeometryEvaluationSnapshot;
    readonly instruction: string;
    readonly turnIndex: number;
  }) => readonly LocalGeometryEvaluationRenderCapture[]
    | Promise<readonly LocalGeometryEvaluationRenderCapture[]>;
}

function mutationLane(lane: GeometryEvaluationLane): lane is MutationLane {
  return lane === 'construct' || lane === 'modify-existing' || lane === 'transform-selection';
}

function evidenceFor(snapshot: GeometryEvaluationSnapshot): SourceHashEvidence {
  const insertion = snapshot.aiContext.construction.sourceBindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  return {
    hash: snapshot.manifest.sourceHash,
    algorithm: snapshot.manifest.hashAlgorithm,
    source: snapshot.source,
    kernelHash: snapshot.geometryDoc.basis.kernelHash,
    projectionHash: snapshot.geometryDoc.basis.projectionHash,
    pluginSetDigest: snapshot.geometryDoc.basis.pluginSetDigest,
    authorizedBindingIds: snapshot.aiContext.construction.authorizedBindingIds,
    authorizationScopeFingerprint:
      snapshot.aiContext.construction.authorizationScopeFingerprint,
    ...(insertion?.createCapabilityFingerprint
      ? { createCapabilityFingerprint: insertion.createCapabilityFingerprint }
      : {}),
  };
}

function renderArtifact(
  snapshot: GeometryEvaluationSnapshot,
  capture: LocalGeometryEvaluationRenderCapture,
): GeometryEvaluationRenderArtifactAttestation {
  const artifactHash = hashSource(capture.artifact);
  const common = {
    schemaVersion: GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION,
    lane: capture.lane,
    documentId: snapshot.documentId,
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    rendererId: capture.rendererId,
    mediaType: capture.mediaType,
    source: snapshot.source,
    sourceHashAlgorithm: 'fnv1a64-utf8' as const,
    sourceHash: hashSource(snapshot.source),
    artifact: capture.artifact,
    artifactHashAlgorithm: 'fnv1a64-utf8' as const,
    artifactHash,
  };
  if (capture.lane === 'interactive') return common;
  if (!capture.exactCompiler) {
    throw new TypeError('Exact evaluation captures require a compiler job attestation.');
  }
  return {
    ...common,
    compiler: {
      schemaVersion: GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION,
      ...capture.exactCompiler,
      sourceHash: common.sourceHash,
      artifactHash,
    },
  };
}

function startedEvents(runId: string): TikzAgentEvent[] {
  return [
    tikzAgentEvent(runId, 0, { type: 'run.started', title: 'Evaluation run started' }),
    tikzAgentEvent(runId, 1, { type: 'context.read', title: 'GeometryDoc context read' }),
  ];
}

/**
 * In-process harness adapter for deterministic domain checks.
 *
 * StudioDocument and TikzTransactionBroker remain owned by the runner. Mutation
 * builders only produce the same typed transactions used by Canvas/AI, and the
 * runner independently matches the Broker result to the committed document.
 */
export function createLocalGeometryEvaluationAdapter(
  options: LocalGeometryEvaluationAdapterOptions,
): GeometryEvaluationAdapter {
  return {
    capabilities: [...new Set(options.capabilities)],
    async execute({ caseDefinition, turn, turnIndex, snapshot, broker }) {
      const runId = `evaluation:${caseDefinition.caseId}:${turnIndex}:${snapshot.revision}`;
      const events = startedEvents(runId);
      if (turn.lane === 'answer-only') {
        if (!options.answer) {
          throw new TypeError('Local evaluation adapter has no answer observer.');
        }
        const answer = await options.answer({
          snapshot,
          instruction: turn.instruction,
          turnIndex,
        });
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'run.completed',
          title: 'Semantic answer completed',
          outcome: 'answer',
        }));
        return { agentEvents: events, answer };
      }
      if (turn.lane === 'verify-rendering') {
        if (!options.render) {
          throw new TypeError('Local evaluation adapter has no captured render artifacts.');
        }
        const callId = `${runId}:render`;
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'tool.started',
          title: 'Render artifacts requested',
          toolCallId: callId,
          toolName: 'capture-render-artifacts',
        }));
        const captures = await options.render({
          snapshot,
          instruction: turn.instruction,
          turnIndex,
        });
        const renderArtifacts = captures.map((capture) => renderArtifact(snapshot, capture));
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'tool.completed',
          title: 'Render artifacts captured',
          toolCallId: callId,
          toolName: 'capture-render-artifacts',
        }));
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'run.completed',
          title: 'Render verification completed',
          outcome: 'answer',
        }));
        return { agentEvents: events, renderArtifacts };
      }
      if (!mutationLane(turn.lane)) {
        throw new TypeError(`Unsupported local evaluation lane ${turn.lane}.`);
      }
      const builder = options.mutations?.[turn.lane];
      if (!builder) {
        throw new TypeError(`Local evaluation adapter has no ${turn.lane} transaction builder.`);
      }
      const request = await builder({
        snapshot,
        instruction: turn.instruction,
        turnIndex,
      });
      events.push(tikzAgentEvent(runId, events.length, {
        type: 'proposal.ready',
        title: 'Typed transaction prepared',
        outcome: 'unapplied-candidate',
      }));
      events.push(tikzAgentEvent(runId, events.length, {
        type: 'commit.started',
        title: 'Broker commit started',
      }));
      const [attestation, brokerResult] = await Promise.all([
        attestAiTransaction(request),
        Promise.resolve(broker.commit(request, evidenceFor(snapshot))),
      ]);
      if (brokerResult.ok) {
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'commit.completed',
          title: 'Broker commit completed',
          outcome: 'mutation',
        }));
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'commit.verified',
          title: 'Committed document will be independently verified',
          outcome: 'mutation',
        }));
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'run.completed',
          title: 'Mutation run completed',
          outcome: 'mutation',
        }));
      } else {
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'commit.rejected',
          title: 'Broker commit rejected',
          outcome: 'failed',
        }));
        events.push(tikzAgentEvent(runId, events.length, {
          type: 'run.failed',
          title: 'Mutation run failed',
          outcome: 'failed',
        }));
      }
      return {
        agentEvents: events,
        transaction: { request, brokerResult, attestation },
      };
    },
  };
}
