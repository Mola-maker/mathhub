import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { isTikzAgentEvent, type TikzAgentEvent } from '../agent/protocol';
import { analyze } from '../analyze';
import {
  planSelectionTransform,
  type SelectionTransform,
  type SelectionTransformPlan,
} from '../authoring/selection-transform';
import {
  StudioDocument,
  type StudioDocumentSnapshot,
  type StudioTransactionRecord,
} from '../document/studio-document';
import { applyTextPatches, type TextPatch } from '../document/source-transaction';
import {
  hashSource,
  hashSourceUsing,
  type SourceHashAlgorithm,
} from '../document/source-hash';
import { buildGeometryAiContext, type GeometryAiContext } from '../ir/ai-context';
import { createGeometryDoc, type GeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import type { GeometryTransactionRequest } from '../ir/transactions';
import {
  buildSceneManifest,
  type SceneManifest,
} from '../semantics/scene-manifest';
import {
  matchesAiTransactionAttestation,
  type AiTransactionAttestation,
} from '../transactions/transaction-attestation';
import {
  TikzTransactionBroker,
  type TikzTransactionBrokerResult,
} from '../transactions/broker';
import type {
  GeometryEvaluationCapability,
  GeometryEvaluationCase,
  GeometryEvaluationInvariant,
  GeometryEvaluationLane,
  GeometryEvaluationProposalSchema,
  GeometryEvaluationPairedSemanticFixture,
  GeometryEvaluationTurn,
} from './evaluation-corpus';
import {
  isHostAdmittedProblemArtifact,
  type AdmittedProblemArtifact,
} from './problem-admission-policy';
import { problemCorpusIdentitySha256 } from './problem-corpus-registry';
import {
  isGeometryAgentContextCheckpoint,
  type GeometryAgentContextCheckpoint,
} from '@/lib/geometry/agent/conversation-context';
import { projectGeogebraCommandsToGeometryDoc } from '@/lib/geometry/adapters/geogebra-geometry-doc';
import {
  buildGeometrySemanticSignature,
  compareGeometrySemanticSignatures,
  type GeometrySemanticSignature,
  type GeometrySemanticSignatureComparison,
} from '@/lib/geometry/semantic-signature';

export const GEOMETRY_EVALUATION_REPORT_SCHEMA_VERSION =
  'geometry-evaluation-report/v3' as const;
export const GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION =
  'geometry-evaluation-render-artifact/v1' as const;
export const GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION =
  'geometry-evaluation-exact-compiler-attestation/v1' as const;

export interface GeometryEvaluationSnapshot {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly source: string;
  readonly manifest: SceneManifest;
  readonly geometryDoc: GeometryDoc;
  readonly aiContext: GeometryAiContext;
}

export interface GeometryEvaluationSnapshotAttestation {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly kernelHash: string | null;
  readonly projectionHash: string | null;
  readonly pluginSetDigest: string | null;
}

export interface GeometryEvaluationAssertion {
  readonly id: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface GeometryEvaluationAnswerEvidence {
  readonly text: string;
  /** GeometryDoc record IDs explicitly used to ground the answer. */
  readonly groundingRefs: readonly string[];
}

export interface GeometryEvaluationExactCompilerAttestation {
  readonly schemaVersion: typeof GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION;
  readonly jobId: string;
  readonly compilerId: string;
  readonly compilerProfileDigest: string;
  readonly sourceHash: string;
  readonly artifactHash: string;
}

export interface GeometryEvaluationRenderArtifactAttestation {
  readonly schemaVersion: typeof GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION;
  readonly lane: 'interactive' | 'exact';
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly rendererId: string;
  readonly mediaType: string;
  /** Exact source bytes submitted to this render lane. */
  readonly source: string;
  readonly sourceHashAlgorithm: SourceHashAlgorithm;
  readonly sourceHash: string;
  /** Captured artifact bytes. The runner recomputes the claimed digest. */
  readonly artifact: string;
  readonly artifactHashAlgorithm: SourceHashAlgorithm;
  readonly artifactHash: string;
  readonly compiler?: GeometryEvaluationExactCompilerAttestation;
}

export interface GeometryEvaluationTransactionEvidence {
  readonly request: GeometryTransactionRequest;
  readonly brokerResult: TikzTransactionBrokerResult;
  readonly attestation: AiTransactionAttestation;
}

/** Adapter output contains evidence only; it has no pass/fail assertions. */
export interface GeometryEvaluationTurnObservation {
  readonly agentEvents: readonly TikzAgentEvent[];
  /** Auditable bounded dialogue receipt; never semantic or source truth. */
  readonly contextCheckpoint?: GeometryAgentContextCheckpoint;
  readonly answer?: GeometryEvaluationAnswerEvidence;
  readonly transaction?: GeometryEvaluationTransactionEvidence;
  readonly renderArtifacts?: readonly GeometryEvaluationRenderArtifactAttestation[];
}

export interface GeometryEvaluationAdapter {
  /** Missing capabilities are recorded as an explicit SKIP before execution. */
  readonly capabilities: readonly GeometryEvaluationCapability[];
  execute(input: {
    readonly caseDefinition: GeometryEvaluationCase;
    readonly turn: GeometryEvaluationTurn;
    readonly turnIndex: number;
    readonly snapshot: GeometryEvaluationSnapshot;
    readonly broker: TikzTransactionBroker;
    readonly signal?: AbortSignal;
  }): Promise<GeometryEvaluationTurnObservation>;
}

/**
 * Production exact-render evidence must be resolved outside the adapter that
 * produced the observation (for example by reading the compiler job registry
 * and its artifact attestation). Unit captures alone can never satisfy this
 * boundary.
 */
export type GeometryEvaluationExactRenderVerifier = (input: {
  readonly artifact: GeometryEvaluationRenderArtifactAttestation;
  readonly snapshot: GeometryEvaluationSnapshot;
  readonly signal?: AbortSignal;
}) => boolean | Promise<boolean>;

export interface GeometryEvaluationLaneReport {
  readonly lane: GeometryEvaluationLane;
  readonly turnIndex: number;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly passed: boolean;
  readonly before: GeometryEvaluationSnapshotAttestation;
  readonly after: GeometryEvaluationSnapshotAttestation;
  readonly assertions: readonly GeometryEvaluationAssertion[];
  readonly eventTypes: readonly string[];
  readonly unsupportedCapabilities: readonly GeometryEvaluationCapability[];
}

export interface GeometryEvaluationSemanticSignatureAttestation {
  readonly sourceLanguage: string;
  readonly sourceSha256: string;
  readonly projectionStatus: GeometrySemanticSignature['projectionStatus'];
  readonly comparable: boolean;
  readonly semanticHash: string;
  readonly relationHash: string;
  readonly presentationHash: string;
  readonly coverage: GeometrySemanticSignature['coverage'];
  readonly exclusionCount: number;
}

export interface GeometryEvaluationPairedSemanticReport {
  readonly schemaVersion: 'geometry-evaluation-paired-semantic-report/v1';
  readonly passed: boolean;
  readonly tikz: GeometryEvaluationSemanticSignatureAttestation;
  readonly geogebra: GeometryEvaluationSemanticSignatureAttestation;
  readonly comparison: GeometrySemanticSignatureComparison;
  readonly assertions: readonly GeometryEvaluationAssertion[];
}

export interface GeometryEvaluationReport {
  readonly schemaVersion: typeof GEOMETRY_EVALUATION_REPORT_SCHEMA_VERSION;
  readonly caseId: string;
  readonly passed: boolean;
  readonly source: GeometryEvaluationCase['source'];
  readonly fixture: GeometryEvaluationCase['localFixture'];
  readonly pairedSemantic?: GeometryEvaluationPairedSemanticReport;
  readonly lanes: readonly GeometryEvaluationLaneReport[];
}

const EVALUATION_FIXTURE_ROOT = resolve(process.cwd(), 'lib', 'tikz', '__fixtures__');
const EVALUATION_FIXTURE_STEM = /^[a-z0-9][a-z0-9/_-]*$/u;
const EVALUATION_PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_EVALUATION_FIXTURE_BYTES = 256 * 1024;
const MAX_EVALUATION_EXPECTATIONS_BYTES = 128 * 1024;
const MAX_GEOGEBRA_PAIRED_COMMANDS = 512;

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function evaluationCaseExpectation(caseDefinition: GeometryEvaluationCase): unknown {
  return {
    schemaVersion: caseDefinition.schemaVersion,
    caseId: caseDefinition.caseId,
    title: caseDefinition.title,
    source: caseDefinition.source,
    ...(caseDefinition.localFixture.pairedSemanticFixture
      ? { pairedSemanticFixture: caseDefinition.localFixture.pairedSemanticFixture }
      : {}),
    turns: caseDefinition.turns,
  };
}

function pinnedFixtureFile(stem: string, extension: '.tikz' | '.json' | '.ggb.txt'): string {
  if (
    !EVALUATION_FIXTURE_STEM.test(stem)
    || stem.includes('//')
    || stem.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Evaluation fixture path must be a repository-relative safe stem');
  }
  const candidate = resolve(EVALUATION_FIXTURE_ROOT, `${stem}${extension}`);
  const fromRoot = relative(EVALUATION_FIXTURE_ROOT, candidate);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Evaluation fixture path escapes the repository fixture root');
  }
  return candidate;
}

async function loadPinnedEvaluationFixture(
  fixture: GeometryEvaluationCase['localFixture'],
  caseDefinition: GeometryEvaluationCase,
): Promise<{ readonly source: string }> {
  if (!SHA256_HEX.test(fixture.sourceSha256) || !SHA256_HEX.test(fixture.expectationsSha256)) {
    throw new Error('Evaluation fixture digests must be lowercase SHA-256 values');
  }
  if (!EVALUATION_PROFILE_ID.test(fixture.expectationProfile)) {
    throw new Error('Evaluation expectation profile must be a bounded safe identifier');
  }
  const sourcePath = pinnedFixtureFile(fixture.fixturePath, '.tikz');
  const expectationsPath = pinnedFixtureFile(fixture.fixturePath, '.json');
  const [sourceBytes, expectationsBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(expectationsPath),
  ]);
  if (sourceBytes.byteLength > MAX_EVALUATION_FIXTURE_BYTES) {
    throw new Error('Evaluation fixture source exceeds the local byte budget');
  }
  if (expectationsBytes.byteLength > MAX_EVALUATION_EXPECTATIONS_BYTES) {
    throw new Error('Evaluation fixture expectations exceed the local byte budget');
  }
  if (sha256Bytes(sourceBytes) !== fixture.sourceSha256) {
    throw new Error('Evaluation fixture source digest does not match the corpus definition');
  }
  if (sha256Bytes(expectationsBytes) !== fixture.expectationsSha256) {
    throw new Error('Evaluation fixture expectations digest does not match the corpus definition');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const source = decoder.decode(sourceBytes);
  const expectationsText = decoder.decode(expectationsBytes);
  try {
    const expectations = JSON.parse(expectationsText) as unknown;
    if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) {
      throw new TypeError('expectations root must be an object');
    }
    const root = expectations as Record<string, unknown>;
    if (root.schemaVersion !== 'geometry-evaluation-expectations/v2') {
      throw new TypeError('unsupported expectations schema');
    }
    const profiles = root.profiles;
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
      throw new TypeError('expectations profiles must be an object');
    }
    const selected = (profiles as Record<string, unknown>)[fixture.expectationProfile];
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
      throw new TypeError('selected expectation profile is unavailable');
    }
    if (canonicalJson(selected) !== canonicalJson(evaluationCaseExpectation(caseDefinition))) {
      throw new TypeError('selected expectation profile does not match the executable case');
    }
  } catch (error) {
    throw new Error('Evaluation fixture expectations do not authorize this case definition', {
      cause: error,
    });
  }
  return { source };
}

function semanticSignatureAttestation(
  signature: GeometrySemanticSignature,
  sourceSha256: string,
): GeometryEvaluationSemanticSignatureAttestation {
  return {
    sourceLanguage: signature.sourceLanguage,
    sourceSha256,
    projectionStatus: signature.projectionStatus,
    comparable: signature.comparable,
    semanticHash: signature.semanticHash,
    relationHash: signature.relationHash,
    presentationHash: signature.presentationHash,
    coverage: signature.coverage,
    exclusionCount: signature.exclusions.length,
  };
}

async function evaluatePairedSemanticFixture(input: {
  readonly caseId: string;
  readonly fixture: GeometryEvaluationPairedSemanticFixture;
}): Promise<GeometryEvaluationPairedSemanticReport> {
  const fixture = input.fixture;
  if (
    fixture.schemaVersion !== 'geometry-evaluation-paired-semantic-fixture/v1'
    || fixture.authorship !== 'independently-authored'
    || !SHA256_HEX.test(fixture.tikzSourceSha256)
    || !SHA256_HEX.test(fixture.geogebraCommandsSha256)
    || !Number.isSafeInteger(fixture.minimumPortableEntityCount)
    || fixture.minimumPortableEntityCount < 1
    || (fixture.minimumPortableConstraintCount !== undefined
      && (!Number.isSafeInteger(fixture.minimumPortableConstraintCount)
        || fixture.minimumPortableConstraintCount < 0))
    || (fixture.minimumPortableRelationCount !== undefined
      && (!Number.isSafeInteger(fixture.minimumPortableRelationCount)
        || fixture.minimumPortableRelationCount < 0))
    || (fixture.requireRelationMatch !== undefined
      && typeof fixture.requireRelationMatch !== 'boolean')
    || (fixture.requirePresentationMatch !== undefined
      && typeof fixture.requirePresentationMatch !== 'boolean')
  ) throw new Error('Paired semantic fixture contract is invalid');

  const [tikzBytes, geogebraBytes] = await Promise.all([
    readFile(pinnedFixtureFile(fixture.tikzFixturePath, '.tikz')),
    readFile(pinnedFixtureFile(fixture.geogebraCommandsPath, '.ggb.txt')),
  ]);
  if (
    tikzBytes.byteLength > MAX_EVALUATION_FIXTURE_BYTES
    || geogebraBytes.byteLength > MAX_EVALUATION_FIXTURE_BYTES
  ) throw new Error('Paired semantic fixture exceeds the local byte budget');
  const tikzSha256 = sha256Bytes(tikzBytes);
  const geogebraSha256 = sha256Bytes(geogebraBytes);
  if (
    tikzSha256 !== fixture.tikzSourceSha256
    || geogebraSha256 !== fixture.geogebraCommandsSha256
  ) throw new Error('Paired semantic fixture digest does not match the corpus definition');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const tikzSource = decoder.decode(tikzBytes);
  const geogebraSource = decoder.decode(geogebraBytes);
  const commands = geogebraSource.split(/\r?\n/gu)
    .map((command) => command.trim())
    .filter(Boolean);
  if (
    commands.length === 0
    || commands.length > MAX_GEOGEBRA_PAIRED_COMMANDS
    || commands.some((command) => command.length > 4_096 || /[\r\n\u0000]/u.test(command))
  ) throw new Error('Paired GeoGebra command fixture is empty or exceeds its safety bound');

  const tikzSnapshot = createGeometryEvaluationSnapshot({
    documentId: `paired-${input.caseId}-tikz`,
    epoch: 'paired-semantic-epoch-1',
    revision: 0,
    source: tikzSource,
  });
  const tikzSignature = buildGeometrySemanticSignature(tikzSnapshot.geometryDoc);
  const geogebraProjection = projectGeogebraCommandsToGeometryDoc({
    identity: {
      documentId: `paired-${input.caseId}-geogebra`,
      epoch: 'paired-semantic-epoch-1',
      revision: 0,
    },
    commands,
  });
  const geogebraSignature = geogebraProjection.semanticSignature;
  const comparison = compareGeometrySemanticSignatures(tikzSignature, geogebraSignature);
  const minimumConstraints = fixture.minimumPortableConstraintCount ?? 0;
  const minimumRelations = fixture.minimumPortableRelationCount ?? 0;
  const assertions = [
    assertion(
      'paired-semantic:tikz-comparable',
      tikzSignature.comparable,
      `${tikzSignature.coverage.entities.portable}/${tikzSignature.coverage.entities.total} portable entities`,
    ),
    assertion(
      'paired-semantic:geogebra-comparable',
      geogebraSignature.comparable,
      `${geogebraSignature.coverage.entities.portable}/${geogebraSignature.coverage.entities.total} portable entities`,
    ),
    assertion(
      'paired-semantic:minimum-portable-entities',
      tikzSignature.coverage.entities.portable >= fixture.minimumPortableEntityCount
        && geogebraSignature.coverage.entities.portable >= fixture.minimumPortableEntityCount,
      `minimum ${fixture.minimumPortableEntityCount}`,
    ),
    assertion(
      'paired-semantic:minimum-portable-constraints',
      tikzSignature.coverage.constraints.portable >= minimumConstraints
        && geogebraSignature.coverage.constraints.portable >= minimumConstraints,
      `minimum ${minimumConstraints}`,
    ),
    assertion(
      'paired-semantic:minimum-portable-relations',
      tikzSignature.coverage.relations.portable >= minimumRelations
        && geogebraSignature.coverage.relations.portable >= minimumRelations,
      `minimum ${minimumRelations}`,
    ),
    assertion(
      'paired-semantic:mathematical-equivalence',
      comparison.equivalent,
      comparison.reasons.join(', ') || 'equivalent',
    ),
    assertion(
      'paired-semantic:relation-equivalence',
      fixture.requireRelationMatch !== true || comparison.relationHashMatches,
      comparison.relationHashMatches ? 'matched' : 'reported-only mismatch',
    ),
    assertion(
      'paired-semantic:presentation-equivalence',
      fixture.requirePresentationMatch !== true || comparison.presentationHashMatches,
      comparison.presentationHashMatches ? 'matched' : 'reported-only mismatch',
    ),
  ];
  return {
    schemaVersion: 'geometry-evaluation-paired-semantic-report/v1',
    passed: assertions.every((item) => item.passed),
    tikz: semanticSignatureAttestation(tikzSignature, tikzSha256),
    geogebra: semanticSignatureAttestation(geogebraSignature, geogebraSha256),
    comparison,
    assertions,
  };
}

const MUTATION_LANES = new Set<GeometryEvaluationLane>([
  'construct',
  'modify-existing',
  'transform-selection',
]);

const CONSTRUCTION_SCHEMAS = new Set<GeometryEvaluationProposalSchema>([
  'construction-plan-proposal/v1',
  'ai-construction-dag-intent/v1',
  'ai-construction-intent-batch-proposal/v1',
  'canvas-construction-batch-proposal/v1',
]);
const STYLE_SCHEMAS = new Set<GeometryEvaluationProposalSchema>([
  'inspector-direct-proposal/v1',
  'inspector-style-proposal/v1',
  'managed-presentation-intent/v1',
  'host-semantic-action-batch/v1',
  'host-semantic-action-set/v1',
]);
const LABEL_SCHEMAS = new Set<GeometryEvaluationProposalSchema>([
  'construction-plan-proposal/v1',
  'ai-construction-dag-intent/v1',
  'ai-construction-intent-batch-proposal/v1',
  'canvas-construction-batch-proposal/v1',
  'host-semantic-action-batch/v1',
  'host-semantic-action-set/v1',
]);

export function createGeometryEvaluationSnapshot(input: {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly source: string;
}): GeometryEvaluationSnapshot {
  const analysis = analyze(input.source, input.revision);
  if (analysis.status === 'invalid' || !analysis.stmts || !analysis.scene) {
    const detail = analysis.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Evaluation source is not projectable${detail ? `: ${detail}` : ''}`);
  }
  const manifest = buildSceneManifest({
    source: input.source,
    sourceRevision: input.revision,
    stmts: analysis.stmts,
    scene: analysis.scene,
    cst: analysis.cst,
    issues: analysis.issues,
  });
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source: input.source,
    hashAlgorithm: manifest.hashAlgorithm,
    basis: {
      documentId: input.documentId,
      epoch: input.epoch,
      revision: input.revision,
      sourceId: `${input.documentId}:tikz`,
      sourceHash: manifest.sourceHash,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  const focusRefs = geometryDoc.semantic.ir.entities
    .map((entity) => entity.id)
    .slice(0, 96);
  return {
    ...input,
    manifest,
    geometryDoc,
    aiContext: buildGeometryAiContext(geometryDoc, {
      focusRefs,
      focusDepth: 3,
      maxEntities: 220,
      maxConstraints: 180,
      maxRelations: 300,
      maxBindings: 220,
      maxOpaqueNodes: 96,
    }),
  };
}

export function attestGeometryEvaluationSnapshot(
  snapshot: GeometryEvaluationSnapshot,
): GeometryEvaluationSnapshotAttestation {
  const basis = snapshot.geometryDoc.basis;
  if (!basis.kernelHash || !basis.projectionHash || !basis.pluginSetDigest) {
    throw new Error('Evaluation snapshot is missing a complete GeometryDoc basis.');
  }
  return {
    documentId: basis.documentId,
    epoch: basis.epoch,
    revision: basis.revision,
    sourceHash: basis.sourceHash,
    kernelHash: basis.kernelHash,
    projectionHash: basis.projectionHash,
    pluginSetDigest: basis.pluginSetDigest,
  };
}

function attestRawSnapshot(
  snapshot: StudioDocumentSnapshot,
): GeometryEvaluationSnapshotAttestation {
  return {
    documentId: snapshot.documentId,
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    sourceHash: hashSource(snapshot.source),
    kernelHash: null,
    projectionHash: null,
    pluginSetDigest: null,
  };
}

function assertion(
  id: string,
  passed: boolean,
  detail?: string,
): GeometryEvaluationAssertion {
  return { id, passed, ...(detail ? { detail } : {}) };
}

function proposalSchema(
  transaction: GeometryEvaluationTransactionEvidence | undefined,
): GeometryEvaluationProposalSchema | null {
  const value = transaction?.request.metadata?.proposalSchemaVersion;
  return typeof value === 'string' ? value as GeometryEvaluationProposalSchema : null;
}

function requestPatches(request: GeometryTransactionRequest): TextPatch[] {
  return request.operations.flatMap((operation) => (
    operation.op === 'source-patch'
      ? operation.patches.map((patch) => ({
          from: patch.range.start,
          to: patch.range.end,
          insert: patch.insert,
        }))
      : []
  )).sort((left, right) => left.from - right.from || left.to - right.to);
}

function samePatch(left: TextPatch, right: TextPatch): boolean {
  return left.from === right.from && left.to === right.to && left.insert === right.insert;
}

function transactionEvidenceChecks(input: {
  readonly before: GeometryEvaluationSnapshot;
  readonly afterRaw: StudioDocumentSnapshot;
  readonly records: readonly StudioTransactionRecord[];
  readonly evidence: GeometryEvaluationTransactionEvidence | undefined;
}): Promise<GeometryEvaluationAssertion[]> {
  return (async () => {
    const { before, afterRaw, records, evidence } = input;
    const request = evidence?.request;
    const result = evidence?.brokerResult;
    const record = records.length === 1 ? records[0] : undefined;
    const patches = request ? requestPatches(request) : [];
    let appliedSource: string | null = null;
    try {
      appliedSource = patches.length > 0
        ? applyTextPatches(before.source, patches)
        : null;
    } catch {
      appliedSource = null;
    }
    const attestationMatches = request && evidence
      ? await matchesAiTransactionAttestation(evidence.attestation, request)
      : false;
    const brokerCommitted = Boolean(
      result?.ok
      && result.status === 'committed'
      && result.fromRevision === before.revision
      && result.toRevision === before.revision + 1,
    );
    const requestMatchesBasis = Boolean(
      request
      && request.documentId === before.documentId
      && request.documentEpoch === before.epoch
      && request.expectedRevision === before.revision
      && request.sourceHash === before.manifest.sourceHash
      && (
        request.expectedKernelHash === undefined
        || request.expectedKernelHash === before.geometryDoc.basis.kernelHash
      )
      && (
        request.expectedProjectionHash === undefined
        || request.expectedProjectionHash === before.geometryDoc.basis.projectionHash
      )
      && (
        request.pluginSetDigest === undefined
        || request.pluginSetDigest === before.geometryDoc.basis.pluginSetDigest
      ),
    );
    const recordMatches = Boolean(
      request
      && result?.ok
      && record
      && record.transactionId === request.transactionId
      && record.idempotencyKey === request.idempotencyKey
      && record.fromRevision === before.revision
      && record.toRevision === before.revision + 1
      && result.transactionId === record.transactionId
      && result.idempotencyKey === record.idempotencyKey
      && record.patches.length === patches.length
      && record.patches.every((patch, index) => samePatch(patch, patches[index]!)),
    );
    return [
      assertion('transaction-evidence-present', Boolean(evidence)),
      assertion('broker-committed', brokerCommitted),
      assertion('single-studio-transaction-record', records.length === 1, `${records.length}`),
      assertion('transaction-request-basis-current', requestMatchesBasis),
      assertion('transaction-attestation-valid', Boolean(attestationMatches)),
      assertion('broker-record-matches-request', recordMatches),
      assertion(
        'transaction-source-materialized',
        appliedSource !== null && appliedSource === afterRaw.source,
      ),
      assertion(
        'single-revision-commit',
        afterRaw.revision === before.revision + 1,
      ),
    ];
  })();
}

function agentEventChecks(
  events: readonly TikzAgentEvent[],
): GeometryEvaluationAssertion[] {
  const allValid = events.every(isTikzAgentEvent);
  const runIds = new Set(events.map((event) => event.runId));
  const sequences = events.map((event) => event.sequence);
  const ordered = sequences.every((value, index) => value === index);
  const idsUnique = new Set(events.map((event) => event.eventId)).size === events.length;
  const terminal = events.at(-1);
  const terminalValid = terminal?.type === 'run.completed' || terminal?.type === 'run.failed';
  return [
    assertion('agent-events-valid', allValid && events.length > 0),
    assertion('agent-run-identity-stable', runIds.size === 1),
    assertion('agent-events-ordered', ordered && idsUnique),
    assertion('agent-terminal-last', Boolean(terminalValid)),
  ];
}

function recordIds(
  snapshot: GeometryEvaluationSnapshot,
  allowed?: readonly ('entity' | 'constraint' | 'relation' | 'style' | 'binding')[],
): Set<string> {
  const permit = new Set(allowed ?? ['entity', 'constraint', 'relation', 'style', 'binding']);
  return new Set([
    ...(permit.has('entity') ? snapshot.geometryDoc.semantic.ir.entities.map((item) => item.id) : []),
    ...(permit.has('constraint') ? snapshot.geometryDoc.semantic.ir.constraints.map((item) => item.id) : []),
    ...(permit.has('relation') ? snapshot.geometryDoc.semantic.ir.relations.map((item) => item.id) : []),
    ...(permit.has('style') ? snapshot.geometryDoc.semantic.ir.styles.map((item) => item.id) : []),
    ...(permit.has('binding') ? snapshot.geometryDoc.construction.bindings.map((item) => item.id) : []),
  ]);
}

function labelCount(snapshot: GeometryEvaluationSnapshot): number {
  return snapshot.geometryDoc.semantic.ir.entities.filter((entity) => entity.kind === 'label').length;
}

function styleFingerprint(snapshot: GeometryEvaluationSnapshot): string {
  return hashSource(JSON.stringify({
    styles: snapshot.geometryDoc.semantic.ir.styles,
    entityParameters: snapshot.geometryDoc.semantic.ir.entities.map((entity) => ({
      id: entity.id,
      parameters: entity.parameters,
    })),
    renderStyles: snapshot.geometryDoc.rendering.flatMap((rendering) => (
      rendering.primitives.map((primitive) => ({ id: primitive.id, style: primitive.style }))
    )),
  }));
}

function positionFingerprint(snapshot: GeometryEvaluationSnapshot): string {
  return hashSource(JSON.stringify({
    entities: snapshot.geometryDoc.semantic.ir.entities.map((entity) => ({
      id: entity.id,
      x: entity.parameters?.x,
      y: entity.parameters?.y,
      center: entity.parameters?.center,
    })),
    geometry: snapshot.geometryDoc.rendering.flatMap((rendering) => (
      rendering.primitives.map((primitive) => ({ id: primitive.id, geometry: primitive.geometry }))
    )),
  }));
}

function stableSemanticRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSemanticRecord);
  if (!value || typeof value !== 'object') return value;
  const omitted = new Set(['metadata', 'sourceBindingIds', 'range', 'sourceRange']);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !omitted.has(key))
    .map(([key, item]) => [key, stableSemanticRecord(item)]));
}

function semanticRelationSignatures(snapshot: GeometryEvaluationSnapshot): Set<string> {
  return new Set([
    ...snapshot.geometryDoc.semantic.ir.constraints,
    ...snapshot.geometryDoc.semantic.ir.relations,
  ].map((record) => JSON.stringify(stableSemanticRecord(record))));
}

function writeIsBindingScoped(
  before: GeometryEvaluationSnapshot,
  evidence: GeometryEvaluationTransactionEvidence | undefined,
): boolean {
  if (!evidence) return false;
  const bindings = before.geometryDoc.construction.bindings;
  const sourceId = before.geometryDoc.basis.sourceId;
  return requestPatches(evidence.request).every((patch) => bindings.some((binding) => {
    if (binding.source.document.sourceId !== sourceId) return false;
    const range = binding.source.range;
    if (patch.from === patch.to) {
      return patch.from >= range.start && patch.to <= range.end;
    }
    return patch.from >= range.start && patch.to <= range.end;
  }));
}

async function validateRenderArtifact(
  artifact: GeometryEvaluationRenderArtifactAttestation | undefined,
  lane: 'interactive' | 'exact',
  snapshot: GeometryEvaluationSnapshot,
  exactRenderVerifier: GeometryEvaluationExactRenderVerifier | undefined,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (
    !artifact
    || artifact.schemaVersion !== GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION
    || artifact.lane !== lane
    || artifact.documentId !== snapshot.documentId
    || artifact.epoch !== snapshot.epoch
    || artifact.revision !== snapshot.revision
    || artifact.source !== snapshot.source
    || artifact.sourceHash !== snapshot.manifest.sourceHash
    || artifact.rendererId.length === 0
    || artifact.mediaType.length === 0
    || artifact.artifact.length === 0
  ) return false;
  const [sourceHash, artifactHash] = await Promise.all([
    hashSourceUsing(artifact.source, artifact.sourceHashAlgorithm),
    hashSourceUsing(artifact.artifact, artifact.artifactHashAlgorithm),
  ]);
  if (sourceHash !== artifact.sourceHash || artifactHash !== artifact.artifactHash) return false;
  if (lane === 'interactive') return artifact.compiler === undefined;
  const compiler = artifact.compiler;
  const structurallyAttested = Boolean(
    compiler
    && compiler.schemaVersion === GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION
    && compiler.jobId.length > 0
    && compiler.compilerId.length > 0
    && compiler.compilerProfileDigest.length > 0
    && compiler.sourceHash === artifact.sourceHash
    && compiler.artifactHash === artifact.artifactHash,
  );
  if (!structurallyAttested || !exactRenderVerifier) return false;
  return exactRenderVerifier({ artifact, snapshot, signal });
}

async function renderChecks(
  observation: GeometryEvaluationTurnObservation,
  after: GeometryEvaluationSnapshot,
  exactRenderVerifier: GeometryEvaluationExactRenderVerifier | undefined,
  signal: AbortSignal | undefined,
): Promise<Map<'interactive' | 'exact', boolean>> {
  const artifacts = observation.renderArtifacts ?? [];
  const interactive = artifacts.filter((item) => item.lane === 'interactive');
  const exact = artifacts.filter((item) => item.lane === 'exact');
  return new Map([
    ['interactive', interactive.length === 1
      && await validateRenderArtifact(
        interactive[0], 'interactive', after, exactRenderVerifier, signal,
      )],
    ['exact', exact.length === 1
      && await validateRenderArtifact(exact[0], 'exact', after, exactRenderVerifier, signal)],
  ]);
}

function transformProof(
  evidence: GeometryEvaluationTransactionEvidence | undefined,
): Record<string, unknown> | null {
  const value = evidence?.request.metadata?.canvasSelectionTransformProof;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finitePoint(value: unknown): value is { readonly x: number; readonly y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === 'number'
    && Number.isFinite(point.x)
    && typeof point.y === 'number'
    && Number.isFinite(point.y);
}

function transformFromProof(value: unknown): SelectionTransform | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const transform = value as Record<string, unknown>;
  if (
    transform.kind === 'translate'
    && typeof transform.dx === 'number'
    && Number.isFinite(transform.dx)
    && typeof transform.dy === 'number'
    && Number.isFinite(transform.dy)
  ) return { kind: 'translate', dx: transform.dx, dy: transform.dy };
  if (
    transform.kind === 'rotate'
    && typeof transform.degrees === 'number'
    && Number.isFinite(transform.degrees)
    && finitePoint(transform.center)
  ) return { kind: 'rotate', degrees: transform.degrees, center: transform.center };
  if (
    transform.kind === 'scale'
    && typeof transform.factor === 'number'
    && Number.isFinite(transform.factor)
    && finitePoint(transform.center)
  ) return { kind: 'scale', factor: transform.factor, center: transform.center };
  if (
    transform.kind === 'reflect'
    && finitePoint(transform.lineStart)
    && finitePoint(transform.lineEnd)
  ) {
    return {
      kind: 'reflect',
      lineStart: transform.lineStart,
      lineEnd: transform.lineEnd,
    };
  }
  return null;
}

function canonicalTransformPlan(
  before: GeometryEvaluationSnapshot,
  evidence: GeometryEvaluationTransactionEvidence | undefined,
): SelectionTransformPlan | null {
  const proof = transformProof(evidence);
  const selected = proof?.selectedEntityIds;
  const transform = transformFromProof(proof?.transform);
  if (
    !Array.isArray(selected)
    || selected.some((id) => typeof id !== 'string')
    || !transform
  ) return null;
  try {
    const plan = planSelectionTransform(
      before.source,
      before.geometryDoc,
      selected as string[],
      transform,
    );
    const matches = (
      JSON.stringify(proof?.selectedEntityIds) === JSON.stringify(plan.selectedEntityIds)
      && JSON.stringify(proof?.variableEntityIds) === JSON.stringify(plan.variableEntityIds)
      && JSON.stringify(proof?.impactedEntityIds) === JSON.stringify(plan.impactedEntityIds)
      && JSON.stringify(proof?.externalImpactedEntityIds)
        === JSON.stringify(plan.externalImpactedEntityIds)
      && JSON.stringify(proof?.transform) === JSON.stringify(plan.transform)
    );
    return matches ? plan : null;
  } catch {
    return null;
  }
}

function capabilityAssertion(input: {
  readonly capability: GeometryEvaluationCapability;
  readonly before: GeometryEvaluationSnapshot;
  readonly after: GeometryEvaluationSnapshot;
  readonly observation: GeometryEvaluationTurnObservation;
  readonly records: readonly StudioTransactionRecord[];
  readonly renderValidity: ReadonlyMap<'interactive' | 'exact', boolean>;
}): GeometryEvaluationAssertion {
  const { capability, before, after, observation, records, renderValidity } = input;
  const schema = proposalSchema(observation.transaction);
  const grounded = observation.answer?.groundingRefs ?? [];
  const knownIds = recordIds(before);
  switch (capability) {
    case 'semantic-read':
      return assertion(
        'capability:semantic-read',
        records.length === 0
          && before.source === after.source
          && grounded.length > 0
          && grounded.every((id) => knownIds.has(id)),
      );
    case 'atomic-construction':
      return assertion(
        'capability:atomic-construction',
        records.length === 1
          && Boolean(schema && CONSTRUCTION_SCHEMAS.has(schema))
          && after.geometryDoc.semantic.ir.entities.length
            > before.geometryDoc.semantic.ir.entities.length,
      );
    case 'binding-scoped-style':
      return assertion(
        'capability:binding-scoped-style',
        records.length === 1
          && Boolean(schema && STYLE_SCHEMAS.has(schema))
          && writeIsBindingScoped(before, observation.transaction)
          && styleFingerprint(after) !== styleFingerprint(before),
      );
    case 'label-intent':
      return assertion(
        'capability:label-intent',
        records.length === 1
          && Boolean(schema && LABEL_SCHEMAS.has(schema))
          && labelCount(after) > labelCount(before),
      );
    case 'dependency-preserving-transform': {
      const beforeRelations = semanticRelationSignatures(before);
      const afterRelations = semanticRelationSignatures(after);
      return assertion(
        'capability:dependency-preserving-transform',
        records.length === 1
          && (
            schema === 'canvas-selection-transform-proposal/v1'
            || schema === 'ai-selection-transform-intent/v1'
          )
          && positionFingerprint(after) !== positionFingerprint(before)
          && [...beforeRelations].every((item) => afterRelations.has(item)),
      );
    }
    case 'interactive-render':
      return assertion('capability:interactive-render', renderValidity.get('interactive') === true);
    case 'exact-render':
      return assertion('capability:exact-render', renderValidity.get('exact') === true);
  }
}

function invariantAssertion(input: {
  readonly invariant: GeometryEvaluationInvariant;
  readonly before: GeometryEvaluationSnapshot;
  readonly after: GeometryEvaluationSnapshot;
  readonly observation: GeometryEvaluationTurnObservation;
  readonly records: readonly StudioTransactionRecord[];
  readonly renderValidity: ReadonlyMap<'interactive' | 'exact', boolean>;
}): GeometryEvaluationAssertion {
  const { invariant, before, after, observation, records, renderValidity } = input;
  const schema = proposalSchema(observation.transaction);
  switch (invariant.kind) {
    case 'source-unchanged':
      return assertion('invariant:source-unchanged', before.source === after.source && records.length === 0);
    case 'agent-terminal': {
      const terminal = observation.agentEvents.at(-1);
      const eventTypes = new Set(observation.agentEvents.map((event) => event.type));
      const required = invariant.requiredEventTypes ?? [];
      return assertion(
        'invariant:agent-terminal',
        terminal?.type === 'run.completed'
          && terminal.outcome === invariant.outcome
          && required.every((type) => eventTypes.has(type)),
      );
    }
    case 'grounding-resolves': {
      const refs = observation.answer?.groundingRefs ?? [];
      const ids = recordIds(before, invariant.recordTypes);
      return assertion(
        'invariant:grounding-resolves',
        refs.length >= invariant.minimumRefs && refs.every((id) => ids.has(id)),
      );
    }
    case 'single-broker-commit':
      return assertion(
        'invariant:single-broker-commit',
        records.length === 1
          && observation.transaction?.brokerResult.ok === true
          && observation.transaction.brokerResult.status === 'committed',
      );
    case 'proposal-schema':
      return assertion(
        'invariant:proposal-schema',
        schema !== null && invariant.allowed.includes(schema),
        schema ?? 'missing',
      );
    case 'semantic-entity-delta':
      return assertion(
        'invariant:semantic-entity-delta',
        after.geometryDoc.semantic.ir.entities.length
          - before.geometryDoc.semantic.ir.entities.length >= invariant.minimum,
      );
    case 'post-commit-basis-current':
      return assertion(
        'invariant:post-commit-basis-current',
        after.geometryDoc.basis.revision === before.revision + 1
          && after.geometryDoc.basis.sourceHash === hashSource(after.source)
          && after.geometryDoc.basis.documentId === before.documentId
          && after.geometryDoc.basis.epoch === before.epoch,
      );
    case 'binding-scoped-write':
      return assertion(
        'invariant:binding-scoped-write',
        writeIsBindingScoped(before, observation.transaction),
      );
    case 'semantic-style-changed':
      return assertion(
        'invariant:semantic-style-changed',
        styleFingerprint(before) !== styleFingerprint(after),
      );
    case 'label-entity-delta':
      return assertion(
        'invariant:label-entity-delta',
        labelCount(after) - labelCount(before) >= invariant.minimum,
      );
    case 'selection-transform-attested': {
      const proof = transformProof(observation.transaction);
      return assertion(
        'invariant:selection-transform-attested',
        (
          schema === 'canvas-selection-transform-proposal/v1'
          || schema === 'ai-selection-transform-intent/v1'
        )
          && proof?.schemaVersion === 'canvas-selection-transform-proof/v1'
          && canonicalTransformPlan(before, observation.transaction) !== null,
      );
    }
    case 'geometry-position-changed':
      return assertion(
        'invariant:geometry-position-changed',
        positionFingerprint(before) !== positionFingerprint(after),
      );
    case 'semantic-relations-preserved': {
      const previous = semanticRelationSignatures(before);
      const current = semanticRelationSignatures(after);
      return assertion(
        'invariant:semantic-relations-preserved',
        [...previous].every((item) => current.has(item)),
      );
    }
    case 'external-impact-acknowledged': {
      return assertion(
        'invariant:external-impact-acknowledged',
        canonicalTransformPlan(before, observation.transaction) !== null,
      );
    }
    case 'render-artifacts-attested':
      return assertion(
        'invariant:render-artifacts-attested',
        invariant.lanes.every((lane) => renderValidity.get(lane) === true),
      );
    case 'render-read-only':
      return assertion(
        'invariant:render-read-only',
        records.length === 0 && before.source === after.source,
      );
    case 'context-checkpoint-current': {
      const checkpoint = observation.contextCheckpoint;
      const basis = checkpoint?.basis;
      const currentSignature = buildGeometrySemanticSignature(before.geometryDoc);
      return assertion(
        'invariant:context-checkpoint-current',
        isGeometryAgentContextCheckpoint(checkpoint)
          && checkpoint.lane === 'tikz'
          && checkpoint.truthPolicy === 'current-source-projection-only'
          && checkpoint.summaryPromotedToTruth === false
          && basis !== undefined
          && basis.attestation === 'server-attested'
          && basis.documentId === before.documentId
          && basis.epoch === before.epoch
          && basis.revision === before.revision
          && typeof basis.sourceId === 'string'
          && basis.sourceId === before.geometryDoc.basis.sourceId
          && basis.sourceHash === hashSource(before.source)
          && basis.semanticHash
            === currentSignature.semanticHash
          && basis.relationHash === currentSignature.relationHash
          && (invariant.maximumRetainedMessages === undefined
            || checkpoint.retainedMessageCount <= invariant.maximumRetainedMessages)
          && (invariant.requiredLosses ?? []).every((loss) => checkpoint.loss.includes(loss)),
      );
    }
  }
}

export async function runGeometryEvaluationCase(input: {
  readonly caseDefinition: GeometryEvaluationCase;
  /** Optional caller assertion only; executable bytes always come from the pinned repository fixture. */
  readonly initialSource?: string;
  readonly adapter: GeometryEvaluationAdapter;
  readonly documentId?: string;
  readonly epoch?: string;
  readonly signal?: AbortSignal;
  readonly exactRenderVerifier?: GeometryEvaluationExactRenderVerifier;
  readonly admissionReceipt?: AdmittedProblemArtifact;
}): Promise<GeometryEvaluationReport> {
  const sourceReference = input.caseDefinition.source;
  if (sourceReference.disposition === 'admitted-artifact') {
    const receipt = input.admissionReceipt;
    if (!isHostAdmittedProblemArtifact(receipt) || receipt.lane !== 'evaluation') {
      throw new Error('Admitted evaluation cases require the exact host-issued evaluation receipt');
    }
    const corpusIdentity = problemCorpusIdentitySha256({
      source: receipt.source,
      sourceId: receipt.sourceId,
      contentDigest: receipt.contentDigest,
      taskId: receipt.task.taskId,
      split: receipt.task.split,
      leakageGroup: receipt.task.leakageGroup,
      task: receipt.task,
    });
    if (
      sourceReference.referenceSchema !== 'AdmittedProblemReference/v1'
      || sourceReference.corpusIdentity !== corpusIdentity
      || sourceReference.source !== receipt.source
      || sourceReference.sourceId !== receipt.sourceId
      || sourceReference.contentDigest !== receipt.contentDigest
      || sourceReference.taskId !== receipt.task.taskId
      || sourceReference.taskContentDigest !== receipt.task.contentDigest
    ) {
      throw new Error('Evaluation admission receipt does not match the corpus source reference');
    }
  }
  const fixture = await loadPinnedEvaluationFixture(
    input.caseDefinition.localFixture,
    input.caseDefinition,
  );
  if (input.initialSource !== undefined && input.initialSource !== fixture.source) {
    throw new Error('Caller source does not match the pinned evaluation fixture bytes');
  }
  const pairedSemantic = input.caseDefinition.localFixture.pairedSemanticFixture
    ? await evaluatePairedSemanticFixture({
        caseId: input.caseDefinition.caseId,
        fixture: input.caseDefinition.localFixture.pairedSemanticFixture,
      })
    : undefined;
  const documentId = input.documentId ?? `evaluation:${input.caseDefinition.caseId}`;
  const epoch = input.epoch ?? 'evaluation-epoch-1';
  const document = new StudioDocument(fixture.source, { documentId, epoch });
  const broker = new TikzTransactionBroker(document);
  let snapshot = createGeometryEvaluationSnapshot({
    documentId,
    epoch,
    revision: 0,
    source: fixture.source,
  });
  const lanes: GeometryEvaluationLaneReport[] = [];
  const supported = new Set(input.adapter.capabilities);
  if (!input.exactRenderVerifier) supported.delete('exact-render');

  for (let turnIndex = 0; turnIndex < input.caseDefinition.turns.length; turnIndex += 1) {
    if (input.signal?.aborted) throw input.signal.reason;
    const turn = input.caseDefinition.turns[turnIndex]!;
    const before = snapshot;
    const unsupportedCapabilities = turn.expectedCapabilities.filter((item) => !supported.has(item));
    if (unsupportedCapabilities.length > 0) {
      lanes.push({
        lane: turn.lane,
        turnIndex,
        status: 'skipped',
        passed: false,
        before: attestGeometryEvaluationSnapshot(before),
        after: attestGeometryEvaluationSnapshot(before),
        assertions: [assertion(
          'adapter-capability-gate',
          false,
          `SKIP: ${unsupportedCapabilities.join(', ')}`,
        )],
        eventTypes: [],
        unsupportedCapabilities,
      });
      continue;
    }

    const revisionBefore = document.getSnapshot().revision;
    let observation: GeometryEvaluationTurnObservation;
    try {
      observation = await input.adapter.execute({
        caseDefinition: input.caseDefinition,
        turn,
        turnIndex,
        snapshot: before,
        broker,
        signal: input.signal,
      });
    } catch (error) {
      const raw = document.getSnapshot();
      lanes.push({
        lane: turn.lane,
        turnIndex,
        status: 'failed',
        passed: false,
        before: attestGeometryEvaluationSnapshot(before),
        after: attestRawSnapshot(raw),
        assertions: [assertion(
          'adapter-completed',
          false,
          error instanceof Error ? error.message : 'adapter failed',
        )],
        eventTypes: [],
        unsupportedCapabilities: [],
      });
      break;
    }

    const afterRaw = document.getSnapshot();
    const records = document.getTransactionsSince(revisionBefore);
    let after: GeometryEvaluationSnapshot;
    try {
      after = createGeometryEvaluationSnapshot({
        documentId: afterRaw.documentId,
        epoch: afterRaw.epoch,
        revision: afterRaw.revision,
        source: afterRaw.source,
      });
    } catch (error) {
      lanes.push({
        lane: turn.lane,
        turnIndex,
        status: 'failed',
        passed: false,
        before: attestGeometryEvaluationSnapshot(before),
        after: attestRawSnapshot(afterRaw),
        assertions: [assertion(
          'post-turn-source-projectable',
          false,
          error instanceof Error ? error.message : 'projection failed',
        )],
        eventTypes: observation.agentEvents.map((event) => event.type),
        unsupportedCapabilities: [],
      });
      break;
    }

    const checks: GeometryEvaluationAssertion[] = [
      ...agentEventChecks(observation.agentEvents),
      assertion('document-identity-stable', after.documentId === before.documentId),
      assertion('epoch-stable', after.epoch === before.epoch),
    ];
    if (MUTATION_LANES.has(turn.lane)) {
      checks.push(...await transactionEvidenceChecks({
        before,
        afterRaw,
        records,
        evidence: observation.transaction,
      }));
    } else {
      checks.push(
        assertion('read-lane-has-no-transaction-evidence', observation.transaction === undefined),
        assertion('read-lane-has-no-commit', records.length === 0),
        assertion('read-lane-revision-stable', after.revision === before.revision),
      );
    }
    const renderValidity = await renderChecks(
      observation,
      after,
      input.exactRenderVerifier,
      input.signal,
    );
    checks.push(...turn.expectedCapabilities.map((capability) => capabilityAssertion({
      capability,
      before,
      after,
      observation,
      records,
      renderValidity,
    })));
    checks.push(...turn.invariants.map((invariant) => invariantAssertion({
      invariant,
      before,
      after,
      observation,
      records,
      renderValidity,
    })));

    const passed = checks.every((check) => check.passed);
    lanes.push({
      lane: turn.lane,
      turnIndex,
      status: passed ? 'passed' : 'failed',
      passed,
      before: attestGeometryEvaluationSnapshot(before),
      after: attestGeometryEvaluationSnapshot(after),
      assertions: checks,
      eventTypes: observation.agentEvents.map((event) => event.type),
      unsupportedCapabilities: [],
    });
    snapshot = after;
    if (!passed) break;
  }

  return {
    schemaVersion: GEOMETRY_EVALUATION_REPORT_SCHEMA_VERSION,
    caseId: input.caseDefinition.caseId,
    passed: lanes.length === input.caseDefinition.turns.length
      && lanes.every((lane) => lane.status === 'passed')
      && (pairedSemantic?.passed ?? true),
    source: input.caseDefinition.source,
    fixture: input.caseDefinition.localFixture,
    ...(pairedSemantic ? { pairedSemantic } : {}),
    lanes,
  };
}
