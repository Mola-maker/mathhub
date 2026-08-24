import type { TikzAgentEventType } from '../agent/protocol';
import type { GeometryProblemSourceId } from './source-catalog';

export const GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION =
  'geometry-evaluation-corpus/v3' as const;

export type GeometryEvaluationLane =
  | 'answer-only'
  | 'construct'
  | 'modify-existing'
  | 'transform-selection'
  | 'verify-rendering';

export type GeometryEvaluationCapability =
  | 'semantic-read'
  | 'atomic-construction'
  | 'binding-scoped-style'
  | 'label-intent'
  | 'dependency-preserving-transform'
  | 'interactive-render'
  | 'exact-render';

export type GeometryEvaluationProposalSchema =
  | 'construction-plan-proposal/v1'
  | 'ai-construction-dag-intent/v1'
  | 'ai-construction-intent-batch-proposal/v1'
  | 'canvas-construction-batch-proposal/v1'
  | 'inspector-direct-proposal/v1'
  | 'inspector-style-proposal/v1'
  | 'managed-presentation-intent/v1'
  | 'host-semantic-action-batch/v1'
  | 'host-semantic-action-set/v1'
  | 'ai-semantic-delete-intent/v1'
  | 'ai-selection-transform-intent/v1'
  | 'canvas-selection-transform-proposal/v1';

/**
 * Closed invariant vocabulary interpreted by the runner. There is deliberately
 * no free-form `passed` field: corpus expectations must be reproducible from
 * source, GeometryDoc, Agent events, Broker records, or render artifacts.
 */
export type GeometryEvaluationInvariant =
  | { readonly kind: 'source-unchanged' }
  | {
    readonly kind: 'agent-terminal';
    readonly outcome: 'answer' | 'mutation';
    readonly requiredEventTypes?: readonly TikzAgentEventType[];
  }
  | {
    readonly kind: 'grounding-resolves';
    readonly minimumRefs: number;
    readonly recordTypes?: readonly ('entity' | 'constraint' | 'relation' | 'style' | 'binding')[];
  }
  | { readonly kind: 'single-broker-commit' }
  | {
    readonly kind: 'proposal-schema';
    readonly allowed: readonly GeometryEvaluationProposalSchema[];
  }
  | { readonly kind: 'semantic-entity-delta'; readonly minimum: number }
  | { readonly kind: 'post-commit-basis-current' }
  | { readonly kind: 'binding-scoped-write' }
  | { readonly kind: 'semantic-style-changed' }
  | { readonly kind: 'label-entity-delta'; readonly minimum: number }
  | { readonly kind: 'selection-transform-attested' }
  | { readonly kind: 'geometry-position-changed' }
  | { readonly kind: 'semantic-relations-preserved' }
  | { readonly kind: 'external-impact-acknowledged' }
  | {
    readonly kind: 'render-artifacts-attested';
    readonly lanes: readonly ('interactive' | 'exact')[];
  }
  | { readonly kind: 'render-read-only' };

export interface GeometryEvaluationResearchReference {
  readonly disposition: 'research-reference-only';
  readonly source: GeometryProblemSourceId;
  readonly recordId: string;
  readonly sourceUrl: string;
  readonly admission: 'not-admitted';
  /**
   * Attribution is displayed from the current live gateway record. The live
   * row is mutable, unpinned and must never become evaluation input.
   */
  readonly attributionMode: 'gateway-record';
}

export interface GeometryEvaluationAdmittedArtifactReference {
  readonly disposition: 'admitted-artifact';
  readonly referenceSchema: 'AdmittedProblemReference/v1';
  readonly corpusIdentity: string;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly contentDigestAlgorithm: 'sha256';
  readonly manifestSchema: 'ProblemArtifactManifest/v1';
  readonly taskId: string;
  readonly taskContentDigest: string;
  readonly taskSchema: 'ProblemTask/v1';
  readonly admission: 'evaluation-canary';
}

export type GeometryEvaluationSourceReference =
  | GeometryEvaluationResearchReference
  | GeometryEvaluationAdmittedArtifactReference;

export interface GeometryEvaluationLocalFixture {
  readonly fixturePath: string;
  /** Selects one immutable case definition from the byte-pinned expectations artifact. */
  readonly expectationProfile: string;
  readonly authorship: 'independently-authored';
  readonly sourceSha256: string;
  readonly expectationsSha256: string;
}

export interface GeometryEvaluationTurn {
  readonly lane: GeometryEvaluationLane;
  readonly instruction: string;
  readonly expectedCapabilities: readonly GeometryEvaluationCapability[];
  readonly invariants: readonly GeometryEvaluationInvariant[];
}

export interface GeometryEvaluationCase {
  readonly schemaVersion: typeof GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION;
  readonly caseId: string;
  readonly title: string;
  readonly source: GeometryEvaluationSourceReference;
  /** Executable truth is local and byte-pinned, never copied from live search. */
  readonly localFixture: GeometryEvaluationLocalFixture;
  readonly turns: readonly GeometryEvaluationTurn[];
}

/**
 * Provenance-only seed for the first live MathNet gateway result. More cases
 * are admitted in batches after source/license review. External problem text
 * deliberately remains outside the repository and outside prompt caches.
 */
export const GEOMETRY_EVALUATION_CORPUS: readonly GeometryEvaluationCase[] = [
  {
    schemaVersion: GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION,
    caseId: 'mathnet-0akr-simson-triad',
    title: 'Simson line · comprehension, construction and follow-up editing',
    source: {
      disposition: 'research-reference-only',
      source: 'mathnet',
      recordId: 'mathnet:0akr',
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=0akr',
      admission: 'not-admitted',
      attributionMode: 'gateway-record',
    },
    localFixture: {
      fixturePath: 'competition/simson-line',
      expectationProfile: 'full-triad',
      authorship: 'independently-authored',
      sourceSha256: '874e56e46c236de65ddf31ef781be529b490daad365edb0e0be1dd30064d23db',
      expectationsSha256: '19ed3a2540e056de5339e2950cf4f2837f1222de675dea1f81d4cf3b746cf986',
    },
    turns: [
      {
        lane: 'answer-only',
        instruction: '解释西姆松线中三个垂足为何共线，不要修改画板。',
        expectedCapabilities: ['semantic-read'],
        invariants: [
          { kind: 'source-unchanged' },
          {
            kind: 'agent-terminal',
            outcome: 'answer',
            requiredEventTypes: ['context.read', 'run.completed'],
          },
          {
            kind: 'grounding-resolves',
            minimumRefs: 3,
            recordTypes: ['entity', 'constraint', 'relation'],
          },
        ],
      },
      {
        lane: 'construct',
        instruction: '在当前三角形上构造西姆松线。',
        expectedCapabilities: ['atomic-construction'],
        invariants: [
          { kind: 'single-broker-commit' },
          {
            kind: 'proposal-schema',
            allowed: [
              'construction-plan-proposal/v1',
              'ai-construction-dag-intent/v1',
              'ai-construction-intent-batch-proposal/v1',
              'canvas-construction-batch-proposal/v1',
            ],
          },
          { kind: 'semantic-entity-delta', minimum: 1 },
          { kind: 'post-commit-basis-current' },
          {
            kind: 'agent-terminal',
            outcome: 'mutation',
            requiredEventTypes: ['proposal.ready', 'commit.completed', 'commit.verified'],
          },
        ],
      },
      {
        lane: 'modify-existing',
        instruction: '把刚构造的西姆松线改成绿色并加粗，再给它添加标签。',
        expectedCapabilities: ['binding-scoped-style', 'label-intent'],
        invariants: [
          { kind: 'single-broker-commit' },
          { kind: 'proposal-schema', allowed: ['host-semantic-action-batch/v1'] },
          { kind: 'binding-scoped-write' },
          { kind: 'semantic-style-changed' },
          { kind: 'label-entity-delta', minimum: 1 },
          { kind: 'post-commit-basis-current' },
        ],
      },
      {
        lane: 'transform-selection',
        instruction: '整体平移这个构造并保持所有垂直与共线关系。',
        expectedCapabilities: ['dependency-preserving-transform'],
        invariants: [
          { kind: 'single-broker-commit' },
          { kind: 'proposal-schema', allowed: ['canvas-selection-transform-proposal/v1'] },
          { kind: 'selection-transform-attested' },
          { kind: 'geometry-position-changed' },
          { kind: 'semantic-relations-preserved' },
          { kind: 'external-impact-acknowledged' },
          { kind: 'post-commit-basis-current' },
        ],
      },
      {
        lane: 'verify-rendering',
        instruction: '比较当前交互画板与精准 TikZ 产物，报告可见偏差但不要修改源码。',
        expectedCapabilities: ['interactive-render', 'exact-render'],
        invariants: [
          { kind: 'source-unchanged' },
          { kind: 'render-artifacts-attested', lanes: ['interactive', 'exact'] },
          { kind: 'render-read-only' },
        ],
      },
    ],
  },
  {
    schemaVersion: GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION,
    caseId: 'mathnet-iran-2025-nine-point-cyclic',
    title: 'Nine-point circle and cyclic quadrilateral · staged Olympiad construction',
    source: {
      disposition: 'research-reference-only',
      source: 'mathnet',
      recordId: 'mathnet:iran-2025-nine-point-cyclic',
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?source=iran',
      admission: 'not-admitted',
      attributionMode: 'gateway-record',
    },
    localFixture: {
      fixturePath: 'evaluation/mathnet-nine-point-cyclic',
      expectationProfile: 'mathnet-nine-point-cyclic',
      authorship: 'independently-authored',
      sourceSha256: 'e5cb12b4dda508321456a8cf1d1e7e090d3545fb2fa7d151ce1732253ad909bc',
      expectationsSha256: 'd25f5eb7f2e7f77610f73bd57eba392d651e6a047733d4356224610b27a36b65',
    },
    turns: [
      {
        lane: 'answer-only',
        instruction: '解释当前图中三条高、垂心 H、九点圆心 N 与九点圆之间的关系，不要修改画板。',
        expectedCapabilities: ['semantic-read'],
        invariants: [
          { kind: 'source-unchanged' },
          {
            kind: 'agent-terminal',
            outcome: 'answer',
            requiredEventTypes: ['context.read', 'run.completed'],
          },
          {
            kind: 'grounding-resolves',
            minimumRefs: 6,
            recordTypes: ['entity', 'constraint', 'relation'],
          },
        ],
      },
      {
        lane: 'construct',
        instruction: '继续构造 EF 与 HD 的垂直平分线交点 P，再按题意构造外接圆上的 L，并标出待证的圆内接四边形 ANDL。',
        expectedCapabilities: ['atomic-construction'],
        invariants: [
          { kind: 'single-broker-commit' },
          {
            kind: 'proposal-schema',
            allowed: [
              'construction-plan-proposal/v1',
              'ai-construction-dag-intent/v1',
              'ai-construction-intent-batch-proposal/v1',
              'canvas-construction-batch-proposal/v1',
            ],
          },
          { kind: 'semantic-entity-delta', minimum: 3 },
          { kind: 'post-commit-basis-current' },
        ],
      },
      {
        lane: 'modify-existing',
        instruction: '把待证四边形改为紫色粗线，并给 P、L 和九点圆心 N 添加标签。',
        expectedCapabilities: ['binding-scoped-style', 'label-intent'],
        invariants: [
          { kind: 'single-broker-commit' },
          { kind: 'binding-scoped-write' },
          { kind: 'semantic-style-changed' },
          { kind: 'label-entity-delta', minimum: 3 },
          { kind: 'post-commit-basis-current' },
        ],
      },
      {
        lane: 'verify-rendering',
        instruction: '比较交互画板与精准 TikZ 产物中九点圆、垂足、直角记号和标签的位置，报告偏差但不要写入源码。',
        expectedCapabilities: ['interactive-render', 'exact-render'],
        invariants: [
          { kind: 'source-unchanged' },
          { kind: 'render-artifacts-attested', lanes: ['interactive', 'exact'] },
          { kind: 'render-read-only' },
        ],
      },
    ],
  },
] as const;
