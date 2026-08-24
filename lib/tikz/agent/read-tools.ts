import { analyze } from '@/lib/tikz/analyze';
import { applyTextPatches } from '@/lib/tikz/document/source-transaction';
import { hashSource } from '@/lib/tikz/document/source-hash';
import {
  buildGeometryAiContext,
  buildGeometrySourceMap,
  compileAiWriteProposal,
  createGeometryDoc,
  explainGeometryRelation,
  projectTikzAnalysisToGeometryTruth,
  type GeometryDoc,
  type GeometryAiContext,
  type GeometryEntity,
  type GeometryTransactionRequest,
} from '@/lib/tikz/ir';
import { isConstructionIntent } from '@/lib/tikz/authoring/construction-intent';
import {
  lowerAiSourceCandidate,
  type AiSourceCandidateBasis,
} from '@/lib/tikz/server/lower-ai-output';
import type {
  TikzAgentToolCall,
  TikzAgentReadToolName,
} from './tool-protocol';
import type { TikzAgentToolObservation } from './runtime';
import {
  isGeometryIntent,
  lowerGeometryIntent,
} from './geometry-intent';
import {
  searchGeometryProblemSources,
  geometryProblemReferenceRecord,
  type GeometryProblemRecord,
} from '@/lib/tikz/problems/source-gateway';
import {
  buildGeometryProofState,
  GEOMETRY_PROOF_CLAIM_KINDS,
  type GeometryProofClaimInput,
  type GeometryProofClaimKind,
} from '@/lib/tikz/semantics/geometry-proof-state';
import { buildGeometryProofPlanArtifact } from '@/lib/tikz/semantics/geometry-proof-plan';

export interface TikzAgentReadToolContext {
  /** Host-owned run identity; never accepted from a model tool envelope. */
  readonly runId?: string;
  readonly basis: AiSourceCandidateBasis;
  readonly geometryDoc: GeometryDoc;
  readonly allowedEntityIds: readonly string[];
  readonly signal?: AbortSignal;
}

const MAX_REFS = 32;
const MAX_ACTION_BODY = 24_000;
const MAX_PROBLEM_OBSERVATION_CHARS = 28_000;
// Leave headroom for basis, entities and the authenticated observation
// envelope under runtime.MAX_OBSERVATION_CHARS (32k).
const MAX_MANAGED_PLAN_OBSERVATION_CHARS = 24_000;
const MAX_CLAIM_REFS = 24;
const MAX_PROOF_CLAIMS = 8;
const MAX_PROOF_ARGUMENT_CHARS = 8_000;
const MAX_PROOF_OBSERVATION_CHARS = 24_000;
const MAX_SIMULATION_OBSERVATION_CHARS = 28_000;
const CLAIM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface ResolvedEntityRefs {
  readonly ok: true;
  readonly entityIds: readonly string[];
  readonly entities: readonly GeometryEntity[];
}

interface RejectedEntityRefs {
  readonly ok: false;
  readonly code: 'ambiguous-reference' | 'unknown-reference' | 'reference-outside-focus-scope';
  readonly refs: readonly string[];
}

export function compactGeometryProblemRecords(
  records: readonly GeometryProblemRecord[],
): ReadonlyArray<Record<string, unknown>> {
  const compact: Array<Record<string, unknown>> = [];
  for (const entry of records) {
    const reference = geometryProblemReferenceRecord(entry);
    const candidate = {
      ...reference,
      topics: reference.topics.slice(0, 12),
      assets: reference.assets.slice(0, 12),
    };
    if (JSON.stringify([...compact, candidate]).length <= MAX_PROBLEM_OBSERVATION_CHARS) {
      compact.push(candidate);
      continue;
    }
    if (compact.length === 0) {
      compact.push({
        ...candidate,
        topics: entry.topics.slice(0, 8),
      });
    }
    break;
  }
  return compact;
}

function stringList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const strings = value.filter((item): item is string => (
    typeof item === 'string' && item.length > 0 && item.length <= 256
  ));
  return strings.length === value.length ? strings : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function serializedLength(value: unknown): number | null {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function observation(
  call: TikzAgentToolCall,
  ok: boolean,
  payload: Record<string, unknown>,
  taint?: TikzAgentToolObservation['taint'],
): TikzAgentToolObservation {
  return {
    schemaVersion: 'tikz-agent-tool-observation/v1',
    callId: call.callId,
    ok,
    ...(taint ? { taint } : {}),
    payload,
  };
}

function entityAliases(entities: readonly GeometryEntity[]) {
  const aliases = new Map<string, Set<string>>();
  for (const entity of entities) {
    const values = [entity.id];
    if (entity.name) {
      values.push(entity.name, `${entity.kind}:${entity.name}`);
      if (entity.kind === 'point') values.push(`point:${entity.name}`);
    }
    for (const alias of values) {
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(entity.id);
      aliases.set(alias, ids);
    }
  }
  return aliases;
}

function resolveEntityRefs(
  refs: readonly string[],
  context: TikzAgentReadToolContext,
): ResolvedEntityRefs | RejectedEntityRefs {
  const allEntities = context.geometryDoc.semantic.ir.entities;
  const allById = new Map(allEntities.map((entity) => [entity.id, entity]));
  const aliases = entityAliases(allEntities);
  const allowed = new Set(context.allowedEntityIds);
  const entityIds: string[] = [];
  const ambiguous: string[] = [];
  const unknown: string[] = [];
  const outside: string[] = [];
  for (const ref of refs) {
    let ids: readonly string[];
    if (allById.has(ref)) {
      ids = [ref];
    } else {
      const matches = aliases.get(ref);
      if (!matches || matches.size === 0) {
        unknown.push(ref);
        continue;
      }
      if (matches.size > 1) {
        ambiguous.push(ref);
        continue;
      }
      ids = [...matches];
    }
    if (ids.some((entityId) => !allowed.has(entityId))) {
      outside.push(ref);
      continue;
    }
    entityIds.push(...ids);
  }
  if (ambiguous.length > 0) {
    return { ok: false, code: 'ambiguous-reference', refs: ambiguous };
  }
  if (outside.length > 0) {
    return { ok: false, code: 'reference-outside-focus-scope', refs: outside };
  }
  if (unknown.length > 0) {
    return { ok: false, code: 'unknown-reference', refs: unknown };
  }
  return {
    ok: true,
    // Preserve caller order and repeated refs. Repetition is semantic for
    // claims such as perpendicular(A,B,A,D); consumers that need a set create
    // one explicitly at their boundary.
    entityIds,
    entities: entityIds.map((entityId) => allById.get(entityId)!),
  };
}

function isProofClaimKind(value: unknown): value is GeometryProofClaimKind {
  return typeof value === 'string'
    && GEOMETRY_PROOF_CLAIM_KINDS.includes(value as GeometryProofClaimKind);
}

function validProofClaimArity(
  kind: GeometryProofClaimKind,
  count: number,
): boolean {
  if (kind === 'coincident') return count >= 2;
  if (kind === 'collinear' || kind === 'equal-distance') return count >= 3;
  if (kind === 'concyclic') return count >= 4;
  return count === (kind === 'parallel' || kind === 'perpendicular' ? 4 : 3);
}

function proofClaims(
  value: unknown,
  context: TikzAgentReadToolContext,
): GeometryProofClaimInput[] | RejectedEntityRefs | null {
  const valueLength = serializedLength(value);
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_PROOF_CLAIMS
    || valueLength === null
    || valueLength > MAX_PROOF_ARGUMENT_CHARS
  ) {
    return null;
  }
  const claims: GeometryProofClaimInput[] = [];
  const claimIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const keys = Object.keys(candidate);
    if (keys.some((key) => !['claimId', 'kind', 'pointRefs', 'tolerance'].includes(key))) {
      return null;
    }
    const claimId = candidate.claimId;
    const kind = candidate.kind;
    const pointRefs = stringList(candidate.pointRefs, MAX_CLAIM_REFS);
    const claimTolerance = candidate.tolerance;
    if (
      typeof claimId !== 'string'
      || !CLAIM_ID.test(claimId)
      || claimIds.has(claimId)
      || !isProofClaimKind(kind)
      || !pointRefs
      || !validProofClaimArity(kind, pointRefs.length)
      || (
        claimTolerance !== undefined
        && (typeof claimTolerance !== 'number' || !Number.isFinite(claimTolerance))
      )
    ) return null;
    const resolved = resolveEntityRefs(pointRefs, context);
    if (!resolved.ok) return resolved;
    if (resolved.entities.some((entity) => entity.kind !== 'point')) return null;
    claimIds.add(claimId);
    claims.push({
      claimId,
      kind,
      entityIds: resolved.entityIds,
      ...(typeof claimTolerance === 'number' ? { tolerance: claimTolerance } : {}),
    });
  }
  return claims;
}

function explainRelation(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const from = call.arguments.from;
  const to = call.arguments.to;
  const maxHops = call.arguments.maxHops ?? 8;
  if (
    typeof from !== 'string'
    || typeof to !== 'string'
    || from.length === 0
    || to.length === 0
    || from.length > 256
    || to.length > 256
    || !Number.isSafeInteger(maxHops)
    || (maxHops as number) < 1
    || (maxHops as number) > 24
  ) return observation(call, false, { code: 'invalid-relation-query' });
  const resolved = resolveEntityRefs([from, to], context);
  if (!resolved.ok) {
    return observation(call, false, { code: resolved.code, refs: resolved.refs });
  }
  const explanation = explainGeometryRelation(context.geometryDoc.semantic, {
    fromRef: resolved.entityIds[0]!,
    toRef: resolved.entityIds[1]!,
    maxHops: maxHops as number,
    allowedEntityIds: context.allowedEntityIds,
  });
  return observation(call, explanation.status === 'connected', {
    basis: {
      revision: context.geometryDoc.basis.revision,
      kernelHash: context.geometryDoc.basis.kernelHash,
      projectionHash: context.geometryDoc.basis.projectionHash,
    },
    explanation,
  });
}

function inspectConstruction(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const refs = stringList(call.arguments.refs ?? [], MAX_REFS);
  if (!refs || refs.length === 0) {
    return observation(call, false, { code: 'invalid-construction-refs' });
  }
  const resolved = resolveEntityRefs(refs, context);
  if (!resolved.ok) {
    return observation(call, false, { code: resolved.code, refs: resolved.refs });
  }
  const focused = buildGeometryAiContext(context.geometryDoc, {
    focusRefs: resolved.entityIds,
    focusDepth: 2,
    maxEntities: 80,
    maxConstraints: 80,
    maxRelations: 120,
    maxBindings: 192,
  });
  const targetIds = new Set(resolved.entityIds);
  const constructionIds = new Set(focused.construction.sourceBindings.flatMap((binding) => (
    binding.managedConstructionId
    && binding.entityIds.some((entityId) => targetIds.has(entityId))
      ? [binding.managedConstructionId]
      : []
  )));
  const constructions: Array<Record<string, unknown>> = [];
  for (const binding of focused.construction.sourceBindings) {
    if (
      !binding.managedConstructionId
      || !constructionIds.has(binding.managedConstructionId)
      || binding.managedPlan?.status !== 'canonical'
      || constructions.some((item) => (
        item.managedConstructionId === binding.managedConstructionId
      ))
    ) continue;
    const candidate = {
      managedConstructionId: binding.managedConstructionId,
      managedPlanKind: binding.managedPlanKind,
      managedSyntaxKind: binding.managedSyntaxKind,
      writerId: binding.managedWriterId,
      writerRevision: binding.managedWriterRevision,
      plan: binding.managedPlan.previousPlan,
      presentation: binding.managedPlan.presentation,
    };
    if (
      JSON.stringify([...constructions, candidate]).length
      > MAX_MANAGED_PLAN_OBSERVATION_CHARS
    ) break;
    constructions.push(candidate);
  }
  return observation(call, constructions.length > 0, {
    basis: {
      revision: context.geometryDoc.basis.revision,
      sourceHash: context.geometryDoc.basis.sourceHash,
      kernelHash: context.geometryDoc.basis.kernelHash,
    },
    requestedEntityIds: resolved.entityIds,
    constructions,
    omitted: Math.max(0, constructionIds.size - constructions.length),
  });
}

function sourcePatchesOf(transaction: GeometryTransactionRequest) {
  return transaction.operations.flatMap((operation) => (
    operation.op === 'source-patch'
      ? operation.patches.map((patch) => ({
          from: patch.range.start,
          to: patch.range.end,
          insert: patch.insert,
        }))
      : []
  ));
}

function geometryIntentContext(
  context: TikzAgentReadToolContext,
): GeometryAiContext {
  const allowedEntityIds = new Set(context.allowedEntityIds);
  const allowedBindingIds = new Set(context.basis.readBindingIds);
  const projected = buildGeometryAiContext(context.geometryDoc, {
    focusRefs: context.allowedEntityIds,
    focusDepth: 0,
    maxFocusEntities: Math.max(1, context.allowedEntityIds.length),
    maxEntities: 240,
    maxConstraints: 180,
    maxRelations: 320,
    maxBindings: 256,
  });
  const sourceBindings = projected.construction.sourceBindings.filter((binding) => (
    allowedBindingIds.has(binding.id)
  ));
  const retainedBindingIds = new Set(sourceBindings.map((binding) => binding.id));
  return {
    ...projected,
    entities: projected.entities.filter((entity) => allowedEntityIds.has(entity.id)),
    focus: {
      ...projected.focus,
      resolvedEntityIds: projected.focus.resolvedEntityIds.filter((entityId) => (
        allowedEntityIds.has(entityId)
      )),
      closureEntityIds: projected.focus.closureEntityIds.filter((entityId) => (
        allowedEntityIds.has(entityId)
      )),
      ranking: projected.focus.ranking?.filter((entry) => (
        allowedEntityIds.has(entry.entityId)
      )),
    },
    construction: {
      ...projected.construction,
      sourceBindings,
      authorizedBindingIds: projected.construction.authorizedBindingIds.filter((bindingId) => (
        retainedBindingIds.has(bindingId)
      )),
    },
  };
}

function simulateIntent(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const modelIntent = call.arguments.intent;
  let proposal: unknown = modelIntent;
  if (isGeometryIntent(modelIntent)) {
    const lowered = lowerGeometryIntent(modelIntent, geometryIntentContext(context));
    if (!lowered.ok) {
      return observation(call, false, {
        code: 'geometry-intent-lowering-rejected',
        diagnosticCode: lowered.code,
        message: lowered.message,
      });
    }
    proposal = lowered.proposal;
  } else if (!isConstructionIntent(modelIntent)) {
    return observation(call, false, { code: 'invalid-geometry-intent' });
  }
  const compiled = compileAiWriteProposal(proposal, {
    basis: context.basis,
    bindings: context.basis.bindings,
    allowedBindingIds: context.basis.readBindingIds,
    source: context.basis.source,
    geometryDoc: context.geometryDoc,
  });
  if (!compiled.ok) {
    return observation(call, false, {
      code: 'intent-compilation-rejected',
      diagnostics: compiled.errors.slice(0, 16).map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  const patches = sourcePatchesOf(compiled.transaction);
  let candidate: string;
  try {
    candidate = applyTextPatches(context.basis.source, patches);
  } catch {
    return observation(call, false, { code: 'intent-patch-conflict' });
  }
  const nextRevision = context.geometryDoc.basis.revision + 1;
  const analysis = analyze(candidate, nextRevision);
  const sourceHash = hashSource(candidate);
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source: candidate,
    hashAlgorithm: context.basis.hashAlgorithm,
    basis: {
      documentId: context.geometryDoc.basis.documentId,
      epoch: context.geometryDoc.basis.epoch,
      revision: nextRevision,
      sourceId: context.geometryDoc.basis.sourceId,
      sourceHash,
      pluginSetDigest: context.geometryDoc.basis.pluginSetDigest,
    },
  });
  let candidateDoc: GeometryDoc;
  try {
    candidateDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  } catch (error) {
    return observation(call, false, {
      code: 'candidate-projection-invalid',
      message: error instanceof Error ? error.message : 'Candidate GeometryDoc failed validation.',
    });
  }
  const beforeIds = new Set(context.geometryDoc.semantic.ir.entities.map((entity) => entity.id));
  const addedEntities = candidateDoc.semantic.ir.entities
    .filter((entity) => !beforeIds.has(entity.id))
    .slice(0, 64)
    .map((entity) => ({ id: entity.id, kind: entity.kind, name: entity.name }));
  const errors = analysis.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 16)
    .map((issue) => issue.message);
  const valid = errors.length === 0 && candidateDoc.semantic.status === 'complete';
  let postProof: Record<string, unknown> = {};
  if (call.arguments.postconditionClaims !== undefined) {
    const candidateEntityIds = candidateDoc.semantic.ir.entities.map((entity) => entity.id);
    const candidateContext: TikzAgentReadToolContext = {
      ...context,
      geometryDoc: candidateDoc,
      allowedEntityIds: candidateEntityIds,
    };
    const postconditionClaims = proofClaims(
      call.arguments.postconditionClaims,
      candidateContext,
    );
    if (!postconditionClaims) {
      return observation(call, false, { code: 'invalid-postcondition-claims' });
    }
    if (!Array.isArray(postconditionClaims)) {
      return observation(call, false, {
        code: postconditionClaims.code,
        refs: postconditionClaims.refs,
      });
    }
    const candidateSemantic = buildGeometryAiContext(candidateDoc, {
      focusRefs: postconditionClaims.flatMap((claim) => claim.entityIds),
      focusDepth: 1,
      maxEntities: 240,
      maxConstraints: 180,
      maxRelations: 320,
      maxBindings: 256,
    });
    const postProofState = buildGeometryProofState(candidateDoc, {
      allowedEntityIds: candidateEntityIds,
      focusEntityIds: candidateSemantic.focus.resolvedEntityIds,
      claims: postconditionClaims,
      candidateTools: candidateSemantic.construction.intentTools,
      maxFacts: 48,
      maxCandidates: 12,
    });
    const postProofPlan = buildGeometryProofPlanArtifact(postProofState, {
      observationCallId: call.callId,
      runId: context.runId,
      authoritativeForWrite: false,
    });
    postProof = {
      postProofState,
      postProofPlan,
      proofDelta: {
        formallyProvenClaimIds: postProofState.obligations
          .filter((item) => item.status === 'formally-proven')
          .map((item) => item.claimId),
        numericallySatisfiedClaimIds: postProofState.obligations
          .filter((item) => item.status === 'numerically-satisfied')
          .map((item) => item.claimId),
        unresolvedClaimIds: postProofState.obligations
          .filter((item) => item.status === 'unresolved')
          .map((item) => item.claimId),
        contradictedClaimIds: postProofState.obligations
          .filter((item) => (
            item.status === 'counterexample' || item.status === 'inconsistent'
          ))
          .map((item) => item.claimId),
      },
    };
  }
  const payload = {
    valid,
    simulatedOnly: true,
    sourceUnchanged: context.basis.source === context.geometryDoc.construction.sources[0]?.text,
    patchCount: patches.length,
    sourceLengthDelta: candidate.length - context.basis.source.length,
    candidateSourceHash: sourceHash,
    candidateKernelHash: candidateDoc.basis.kernelHash,
    candidateProjectionHash: candidateDoc.basis.projectionHash,
    semanticStatus: candidateDoc.semantic.status,
    diagnostics: errors,
    addedEntities,
    addedConstraintKinds: [...new Set(candidateDoc.semantic.ir.constraints
      .filter((constraint) => !context.geometryDoc.semantic.ir.constraints.some((current) => (
        current.id === constraint.id
      )))
      .map((constraint) => constraint.kind))].slice(0, 32),
    addedRelationKinds: [...new Set(candidateDoc.semantic.ir.relations
      .filter((relation) => !context.geometryDoc.semantic.ir.relations.some((current) => (
        current.id === relation.id
      )))
      .map((relation) => relation.kind))].slice(0, 32),
    ...postProof,
  };
  if (
    (serializedLength(payload) ?? Number.POSITIVE_INFINITY)
    > MAX_SIMULATION_OBSERVATION_CHARS
  ) {
    return observation(call, false, { code: 'simulation-observation-too-large' });
  }
  return observation(call, valid, payload);
}

function buildProofState(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const claims = proofClaims(call.arguments.claims, context);
  if (!claims) return observation(call, false, { code: 'invalid-proof-claims' });
  if (!Array.isArray(claims)) {
    return observation(call, false, { code: claims.code, refs: claims.refs });
  }
  const semantic = geometryIntentContext(context);
  const proofState = buildGeometryProofState(context.geometryDoc, {
    allowedEntityIds: context.allowedEntityIds,
    focusEntityIds: semantic.focus.resolvedEntityIds,
    claims,
    candidateTools: semantic.construction.intentTools,
    maxFacts: 48,
    maxCandidates: 12,
  });
  const requestedAuxiliaryToolIds = call.arguments.requestedAuxiliaryToolIds === undefined
    ? []
    : stringList(call.arguments.requestedAuxiliaryToolIds, 16);
  if (!requestedAuxiliaryToolIds) {
    return observation(call, false, { code: 'invalid-proof-auxiliary-selection' });
  }
  const proofPlan = buildGeometryProofPlanArtifact(proofState, {
    observationCallId: call.callId,
    runId: context.runId,
    requestedAuxiliaryToolIds,
    authoritativeForWrite: true,
  });
  if (
    (serializedLength({ proofState, proofPlan }) ?? Number.POSITIVE_INFINITY)
    > MAX_PROOF_OBSERVATION_CHARS
  ) {
    return observation(call, false, { code: 'proof-state-observation-too-large' });
  }
  return observation(call, true, {
    proofState,
    proofPlan,
  });
}

function verifyGeometryClaim(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const claim = call.arguments.claim;
  if (!isRecord(claim)) {
    return observation(call, false, { code: 'invalid-geometry-claim' });
  }
  const claims = proofClaims([{
    claimId: 'claim',
    kind: claim.kind,
    pointRefs: claim.pointRefs,
    ...(claim.tolerance === undefined ? {} : { tolerance: claim.tolerance }),
  }], context);
  if (!claims) return observation(call, false, { code: 'invalid-geometry-claim' });
  if (!Array.isArray(claims)) {
    return observation(call, false, { code: claims.code, refs: claims.refs });
  }
  const proofState = buildGeometryProofState(context.geometryDoc, {
    allowedEntityIds: context.allowedEntityIds,
    claims,
    maxCandidates: 0,
  });
  const claimResult = proofState.obligations[0]!;
  return observation(call, true, {
    verdict: claimResult.status,
    method: claimResult.method,
    residual: claimResult.residual,
    tolerance: claimResult.tolerance,
    entityIds: claimResult.entityIds,
    semanticEvidence: claimResult.evidenceIds,
    diagnostic: claimResult.diagnostic,
    basis: proofState.basis,
  });
}

function inspectGeometry(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const refs = stringList(call.arguments.refs ?? [], MAX_REFS);
  if (!refs) return observation(call, false, { code: 'invalid-refs' });
  const requested = new Set(refs);
  const allowed = new Set(context.allowedEntityIds);
  const permittedEntities = context.geometryDoc.semantic.ir.entities.filter((entity) => (
    allowed.has(entity.id)
  ));
  const requestedOutsideScope = [...requested].some((reference) => (
    !permittedEntities.some((entity) => (
      entity.id === reference || entity.name === reference
    ))
  ));
  if (requestedOutsideScope) {
    return observation(call, false, { code: 'reference-outside-focus-scope' });
  }
  const inspectedContext = buildGeometryAiContext(context.geometryDoc, {
    focusRefs: refs,
    focusDepth: 3,
    maxEntities: 80,
    maxConstraints: 80,
    maxRelations: 120,
    maxBindings: 160,
  });
  // Return the complete, bounded semantic neighborhood selected by the host
  // rather than only the literal entities named by the model. Complex
  // constructions are understood through their auxiliary points, constraints
  // and dependency relations. The allowedEntityIds intersection is the
  // revision-bound authority barrier: deeper inspection may improve context,
  // but can never expand the server-attested read/write scope.
  const permittedById = new Map(permittedEntities.map((entity) => [entity.id, entity]));
  const neighborhoodIds = requested.size === 0
    ? context.allowedEntityIds
    : inspectedContext.focus.closureEntityIds;
  const entities = neighborhoodIds
    .map((entityId) => permittedById.get(entityId))
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
    .slice(0, 80);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const ranking = (inspectedContext.focus.ranking ?? [])
    .filter((entry) => entityIds.has(entry.entityId))
    .slice(0, 80);
  const constraints = context.geometryDoc.semantic.ir.constraints.filter((constraint) => (
    constraint.arguments.some((argument) => (
      argument.entityId ? entityIds.has(argument.entityId) : false
    ))
  ));
  const relations = context.geometryDoc.semantic.ir.relations.filter((relation) => (
    relation.participants.some((participant) => (
      participant.entityId ? entityIds.has(participant.entityId) : false
    ))
  ));
  const managedPlans: Array<Record<string, unknown>> = [];
  for (const binding of inspectedContext.construction.sourceBindings) {
    if (binding.managedPlan?.status !== 'canonical') continue;
    const candidate = {
      bindingId: binding.id,
      managedConstructionId: binding.managedConstructionId,
      managedPlanKind: binding.managedPlanKind,
      managedSyntaxKind: binding.managedSyntaxKind,
      managedPlan: binding.managedPlan,
    };
    if (
      JSON.stringify([...managedPlans, candidate]).length
      > MAX_MANAGED_PLAN_OBSERVATION_CHARS
    ) break;
    managedPlans.push(candidate);
  }
  return observation(call, true, {
    basis: {
      revision: context.geometryDoc.basis.revision,
      sourceHash: context.geometryDoc.basis.sourceHash,
      kernelHash: context.geometryDoc.basis.kernelHash,
      projectionHash: context.geometryDoc.basis.projectionHash,
    },
    entities: entities.slice(0, 80),
    ranking,
    constraints: constraints.slice(0, 80),
    relations: relations.slice(0, 120),
    managedPlans,
    omitted: {
      entities: Math.max(0, entities.length - 80),
      constraints: Math.max(0, constraints.length - 80),
      relations: Math.max(0, relations.length - 120),
    },
  });
}

function validateTikzAction(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): TikzAgentToolObservation {
  const body = call.arguments.body;
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_ACTION_BODY) {
    return observation(call, false, { code: 'invalid-action-body' });
  }
  const lowered = lowerAiSourceCandidate(
    `\`\`\`tikz-action\n${body}\n\`\`\``,
    context.basis,
  );
  if (lowered.status !== 'proposal') {
    return observation(call, false, {
      code: `lowering-${lowered.status}`,
      ...(lowered.status === 'rejected' ? { message: lowered.message } : {}),
    });
  }
  const compiled = compileAiWriteProposal(lowered.proposal, {
    basis: context.basis,
    bindings: context.basis.bindings,
    allowedBindingIds: context.basis.readBindingIds,
    source: context.basis.source,
    geometryDoc: context.geometryDoc,
  });
  if (!compiled.ok) {
    return observation(call, false, {
      code: 'proposal-invalid',
      diagnostics: compiled.errors.slice(0, 16).map((issue) => issue.code),
    });
  }
  const patches = compiled.transaction.operations.flatMap((operation) => (
    operation.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : []
  ));
  let candidate: string;
  try {
    candidate = applyTextPatches(context.basis.source, patches);
  } catch {
    return observation(call, false, { code: 'patch-conflict' });
  }
  const analysis = analyze(candidate, context.basis.revision + 1);
  const diagnostics = analysis.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 16)
    .map((issue) => issue.message);
  return observation(call, diagnostics.length === 0, {
    valid: diagnostics.length === 0,
    diagnostics,
    patchCount: patches.length,
    bindingIds: lowered.proposal.operations.map((operation) => operation.bindingId),
    candidateHash: hashSource(candidate),
  });
}

async function searchGeometryProblems(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): Promise<TikzAgentToolObservation> {
  const query = call.arguments.query;
  const offset = call.arguments.offset ?? 0;
  const limit = call.arguments.limit ?? 8;
  if (
    typeof query !== 'string'
    || query.trim().length === 0
    || query.length > 240
    || !Number.isSafeInteger(offset)
    || (offset as number) < 0
    || !Number.isSafeInteger(limit)
    || (limit as number) < 1
    || (limit as number) > 12
  ) return observation(call, false, { code: 'invalid-problem-search' });
  const result = await searchGeometryProblemSources({
    query,
    offset: offset as number,
    limit: limit as number,
    signal: context.signal ?? AbortSignal.timeout(12_000),
  });
  return observation(call, true, {
    records: compactGeometryProblemRecords(result.records),
    sourceStatus: result.sourceStatus,
  }, 'untrusted-external-reference');
}

const TOOL_EXECUTORS: Record<
  TikzAgentReadToolName,
  (call: TikzAgentToolCall, context: TikzAgentReadToolContext) => (
    TikzAgentToolObservation | Promise<TikzAgentToolObservation>
  )
> = {
  'inspect-geometry': inspectGeometry,
  'explain-relation': explainRelation,
  'inspect-construction': inspectConstruction,
  'simulate-intent': simulateIntent,
  'build-proof-state': buildProofState,
  'verify-geometry-claim': verifyGeometryClaim,
  'validate-tikz-action': validateTikzAction,
  'search-geometry-problems': searchGeometryProblems,
};

export async function executeTikzAgentReadTool(
  call: TikzAgentToolCall,
  context: TikzAgentReadToolContext,
): Promise<TikzAgentToolObservation> {
  return TOOL_EXECUTORS[call.name](call, context);
}
