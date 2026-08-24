import {
  GEOMETRY_PROBLEM_SOURCE_IDS,
  isGeometryProblemSourceId,
  type GeometryProblemSourceId,
  type GeometryProblemSourceMaterialRights,
  type GeometryProblemUsageDecision,
} from '../problems/source-catalog';
import {
  GEOMETRY_PROOF_CLAIM_KINDS,
  type GeometryProofClaimKind,
  type GeometryProofObligationStatus,
} from '../semantics/geometry-proof-state';
import type { TikzAsyncWorkItem } from '../runtime/work-item';

export const TIKZ_AGENT_WIDGET_SCHEMA_VERSION = 'tikz-agent-widget/v1' as const;

export interface FunctionPlotWidget {
  readonly kind: 'function-plot';
  readonly title: string;
  readonly expression: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly series: readonly {
    readonly label: string;
    readonly color: 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'gray';
    readonly points: readonly { readonly x: number; readonly y: number }[];
  }[];
}

/**
 * A geometry-flow is a view over one immutable GeometryDoc snapshot.  The
 * model may describe the steps, but it is never allowed to choose which
 * document revision those steps operate on.  The host attaches this basis
 * after projecting the flow from the current GeometryDoc.
 */
export interface GeometryFlowBasis {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly kernelHash?: string;
  readonly projectionHash?: string;
  readonly pluginSetDigest?: string;
}

export interface GeometryFlowWidget {
  readonly kind: 'geometry-flow';
  readonly title: string;
  /** Optional for legacy display-only payloads; required for Canvas focus. */
  readonly basis?: GeometryFlowBasis;
  readonly problemId?: string;
  readonly source?: string;
  readonly sourceUrl?: string;
  readonly datasetUrl?: string;
  readonly license?: string;
  readonly licenseId?: string;
  readonly contentHash?: string;
  readonly contentHashAlgorithm?: 'fnv1a64-utf8';
  readonly solutionProvenance?: 'dataset-provided' | 'official-solution' | 'unknown';
  readonly steps: readonly {
    readonly id: string;
    readonly title: string;
    readonly explanation: string;
    readonly constructionToolId?: string;
    readonly entityRefs?: readonly string[];
    readonly tikz?: string;
    readonly provenance?: 'source-solution' | 'semantic-kernel' | 'agent-inference';
    /** Host-derived only. Model-authored proof badges are rejected. */
    readonly proof?: {
      readonly claimId: string;
      readonly kind: GeometryProofClaimKind;
      readonly status: GeometryProofObligationStatus;
      readonly evidenceIds: readonly string[];
      readonly tolerance: number;
      readonly residual?: number;
      readonly method?: string;
      readonly diagnostic?: string;
    };
    readonly state: 'given' | 'construction' | 'deduction' | 'goal';
  }[];
}

/**
 * Compare a flow assertion with a host-owned current basis.  The four
 * identity fields are mandatory for admission.  Optional kernel/projection
 * attestations are compared when present, so a richer host basis can never
 * silently survive a semantic-pipeline change.
 */
export function geometryFlowBasisMatches(
  flow: GeometryFlowWidget | null | undefined,
  current: Pick<GeometryFlowBasis, 'documentId' | 'epoch' | 'revision' | 'sourceHash'>
    & Partial<Pick<GeometryFlowBasis, 'kernelHash' | 'projectionHash' | 'pluginSetDigest'>>
    | null
    | undefined,
): boolean {
  const basis = flow?.basis;
  if (!basis || !current) return false;
  if (
    basis.documentId !== current.documentId
    || basis.epoch !== current.epoch
    || basis.revision !== current.revision
    || basis.sourceHash !== current.sourceHash
  ) return false;
  return (basis.kernelHash === undefined || basis.kernelHash === current.kernelHash)
    && (basis.projectionHash === undefined || basis.projectionHash === current.projectionHash)
    && (basis.pluginSetDigest === undefined || basis.pluginSetDigest === current.pluginSetDigest);
}

export interface TikzRenderComparisonArtifact {
  readonly schemaVersion: 'tikz-render-comparison-artifact/v1';
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly mode: 'interactive-only' | 'interactive-vs-exact';
  readonly interactiveRasterDigest: string;
  readonly exactRasterDigest?: string;
  readonly exactArtifactDigest?: string;
}

export interface VisualAuditWidget {
  readonly kind: 'visual-audit';
  readonly title: string;
  readonly status: 'pending' | 'passed' | 'warning';
  readonly fidelity?: 'matched' | 'drift' | 'not-compared';
  readonly summary: string;
  readonly observations: readonly string[];
  /** Host-issued and basis-bound; model-authored widget parsing strips it. */
  readonly comparisonArtifact?: TikzRenderComparisonArtifact;
  /** Host-owned lifecycle identity; model-authored widget parsing strips it. */
  readonly workItem?: TikzAsyncWorkItem<'visual-audit'>;
}

export interface GeometryProblemSearchWidget {
  readonly kind: 'problem-search';
  readonly title: string;
  readonly query: string;
  readonly results: readonly {
    readonly id: string;
    readonly source: GeometryProblemSourceId;
    readonly title: string;
    readonly statementPreview: string;
    readonly sourceUrl: string;
    readonly datasetUrl: string;
    readonly licenseId: string;
    readonly contentHash: string;
    readonly contentHashAlgorithm: 'sha256-utf8';
    readonly contentHashScope: 'normalized-live-snapshot';
    readonly admission: 'search-reference-only';
    readonly provider?: {
      readonly datasetId: string;
      readonly config: string;
      readonly split: string;
      readonly rowIndex?: number;
      readonly revision: null;
      readonly revisionStatus: 'unpinned-live-viewer';
    };
    readonly rights: {
      readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
      readonly redistribution: GeometryProblemUsageDecision;
      readonly commercial: GeometryProblemUsageDecision;
      readonly training: GeometryProblemUsageDecision;
    };
    readonly hasImages: boolean;
    readonly assetCount: number;
    readonly topics: readonly string[];
  }[];
  readonly sourceStatus?: readonly {
    readonly id: GeometryProblemSourceId;
    readonly enabled: boolean;
    readonly accessMode: 'live-search' | 'registry-only' | 'restricted-opt-in';
    readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
    readonly detail: string;
  }[];
}

export type TikzReadOnlyAgentWidget =
  | FunctionPlotWidget
  | GeometryFlowWidget
  | GeometryProblemSearchWidget
  | VisualAuditWidget;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function stringList(value: unknown, maxItems: number): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => text(item, 256));
}

export function parseTikzReadOnlyAgentWidget(
  value: unknown,
  options: {
    readonly trustedHostProblemSearch?: boolean;
    readonly trustedHostGeometryProof?: boolean;
  } = {},
): TikzReadOnlyAgentWidget | null {
  if (!record(value)) return null;
  if (value.kind === 'function-plot') {
    if (!text(value.title, 160) || !text(value.expression, 512) || !Array.isArray(value.series)) {
      return null;
    }
    if (value.series.length === 0 || value.series.length > 6) return null;
    const colors = ['blue', 'red', 'green', 'orange', 'purple', 'gray'] as const;
    const series: FunctionPlotWidget['series'][number][] = [];
    for (const candidate of value.series) {
      if (!record(candidate) || !text(candidate.label, 80)) return null;
      if (!colors.includes(candidate.color as typeof colors[number])) return null;
      if (!Array.isArray(candidate.points) || candidate.points.length < 2 || candidate.points.length > 512) {
        return null;
      }
      const points: { x: number; y: number }[] = [];
      for (const point of candidate.points) {
        if (
          !record(point)
          || typeof point.x !== 'number'
          || typeof point.y !== 'number'
          || !Number.isFinite(point.x)
          || !Number.isFinite(point.y)
        ) return null;
        points.push({ x: point.x, y: point.y });
      }
      series.push({
        label: candidate.label,
        color: candidate.color as typeof colors[number],
        points,
      });
    }
    return {
      kind: 'function-plot',
      title: value.title,
      expression: value.expression,
      ...(text(value.xLabel, 32) ? { xLabel: value.xLabel } : {}),
      ...(text(value.yLabel, 32) ? { yLabel: value.yLabel } : {}),
      series,
    };
  }
  if (value.kind === 'geometry-flow') {
    if (!text(value.title, 160) || !Array.isArray(value.steps)) return null;
    if (value.steps.length === 0 || value.steps.length > 32) return null;
    const states = ['given', 'construction', 'deduction', 'goal'] as const;
    const provenances = ['source-solution', 'semantic-kernel', 'agent-inference'] as const;
    const proofStatuses: readonly GeometryProofObligationStatus[] = [
      'formally-proven',
      'numerically-satisfied',
      'counterexample',
      'unresolved',
      'inconsistent',
    ];
    let basis: GeometryFlowBasis | undefined;
    if (value.basis !== undefined) {
      if (!record(value.basis)
        || !text(value.basis.documentId, 160)
        || !text(value.basis.epoch, 160)
        || typeof value.basis.revision !== 'number'
        || !Number.isSafeInteger(value.basis.revision)
        || value.basis.revision < 0
        || !text(value.basis.sourceHash, 128)
        || !/^(?:[0-9a-f]{16}|[0-9a-f]{64})$/u.test(value.basis.sourceHash)
        || (value.basis.kernelHash !== undefined && !text(value.basis.kernelHash, 512))
        || (value.basis.projectionHash !== undefined && !text(value.basis.projectionHash, 512))
        || (value.basis.pluginSetDigest !== undefined && !text(value.basis.pluginSetDigest, 512))) {
        return null;
      }
      basis = {
        documentId: value.basis.documentId,
        epoch: value.basis.epoch,
        revision: value.basis.revision,
        sourceHash: value.basis.sourceHash,
        ...(text(value.basis.kernelHash, 512) ? { kernelHash: value.basis.kernelHash } : {}),
        ...(text(value.basis.projectionHash, 512)
          ? { projectionHash: value.basis.projectionHash }
          : {}),
        ...(text(value.basis.pluginSetDigest, 512)
          ? { pluginSetDigest: value.basis.pluginSetDigest }
          : {}),
      };
    }
    const ids = new Set<string>();
    const steps: GeometryFlowWidget['steps'][number][] = [];
    for (const candidate of value.steps) {
      if (
        !record(candidate)
        || !text(candidate.id, 80)
        || ids.has(candidate.id)
        || !text(candidate.title, 160)
        || !text(candidate.explanation, 1_200)
        || !states.includes(candidate.state as typeof states[number])
        || (candidate.entityRefs !== undefined && !stringList(candidate.entityRefs, 32))
        || (candidate.constructionToolId !== undefined && !text(candidate.constructionToolId, 128))
        || (candidate.tikz !== undefined && !text(candidate.tikz, 4_096))
        || (candidate.provenance !== undefined
          && !provenances.includes(candidate.provenance as typeof provenances[number]))
      ) return null;
      let proof: NonNullable<GeometryFlowWidget['steps'][number]['proof']> | undefined;
      if (candidate.proof !== undefined) {
        if (options.trustedHostGeometryProof !== true || !record(candidate.proof)) return null;
        const evidenceIds = candidate.proof.evidenceIds;
        if (
          !text(candidate.proof.claimId, 128)
          || !GEOMETRY_PROOF_CLAIM_KINDS.includes(
            candidate.proof.kind as GeometryProofClaimKind,
          )
          || !proofStatuses.includes(
            candidate.proof.status as GeometryProofObligationStatus,
          )
          || !stringList(evidenceIds, 32)
          || typeof candidate.proof.tolerance !== 'number'
          || !Number.isFinite(candidate.proof.tolerance)
          || candidate.proof.tolerance < 1e-12
          || candidate.proof.tolerance > 1e-2
          || (
            candidate.proof.residual !== undefined
            && (
              typeof candidate.proof.residual !== 'number'
              || !Number.isFinite(candidate.proof.residual)
              || candidate.proof.residual < 0
            )
          )
          || (candidate.proof.method !== undefined && !text(candidate.proof.method, 128))
          || (candidate.proof.diagnostic !== undefined
            && !text(candidate.proof.diagnostic, 512))
        ) return null;
        proof = {
          claimId: candidate.proof.claimId,
          kind: candidate.proof.kind as GeometryProofClaimKind,
          status: candidate.proof.status as GeometryProofObligationStatus,
          evidenceIds,
          tolerance: candidate.proof.tolerance,
          ...(typeof candidate.proof.residual === 'number'
            ? { residual: candidate.proof.residual }
            : {}),
          ...(text(candidate.proof.method, 128) ? { method: candidate.proof.method } : {}),
          ...(text(candidate.proof.diagnostic, 512)
            ? { diagnostic: candidate.proof.diagnostic }
            : {}),
        };
      }
      ids.add(candidate.id);
      steps.push({
        id: candidate.id,
        title: candidate.title,
        explanation: candidate.explanation,
        state: candidate.state as typeof states[number],
        ...(text(candidate.constructionToolId, 128)
          ? { constructionToolId: candidate.constructionToolId }
          : {}),
        ...(Array.isArray(candidate.entityRefs)
          ? { entityRefs: candidate.entityRefs as string[] }
          : {}),
        ...(text(candidate.tikz, 4_096) ? { tikz: candidate.tikz } : {}),
        ...(provenances.includes(candidate.provenance as typeof provenances[number])
          ? { provenance: candidate.provenance as typeof provenances[number] }
          : {}),
        ...(proof ? { proof } : {}),
      });
    }
    return {
      kind: 'geometry-flow',
      title: value.title,
      ...(basis ? { basis } : {}),
      ...(text(value.problemId, 128) ? { problemId: value.problemId } : {}),
      ...(text(value.source, 256) ? { source: value.source } : {}),
      ...(text(value.sourceUrl, 1_024) && /^https:\/\//u.test(value.sourceUrl)
        ? { sourceUrl: value.sourceUrl }
        : {}),
      ...(text(value.datasetUrl, 1_024) && /^https:\/\//u.test(value.datasetUrl)
        ? { datasetUrl: value.datasetUrl }
        : {}),
      ...(text(value.license, 128) ? { license: value.license } : {}),
      ...(text(value.licenseId, 64) ? { licenseId: value.licenseId } : {}),
      ...(text(value.contentHash, 128) && /^[0-9a-f]{16}$/u.test(value.contentHash)
        ? { contentHash: value.contentHash }
        : {}),
      ...(value.contentHashAlgorithm === 'fnv1a64-utf8'
        ? { contentHashAlgorithm: value.contentHashAlgorithm }
        : {}),
      ...(value.solutionProvenance === 'dataset-provided'
        || value.solutionProvenance === 'official-solution'
        || value.solutionProvenance === 'unknown'
        ? { solutionProvenance: value.solutionProvenance }
        : {}),
      steps,
    };
  }
  if (value.kind === 'problem-search') {
    // These fields attest host-observed provenance and rights state. Model
    // output is never an authority for a problem-search card.
    if (options.trustedHostProblemSearch !== true) return null;
    if (
      !text(value.title, 160)
      || !text(value.query, 240)
      || !Array.isArray(value.results)
      || value.results.length === 0
      || value.results.length > 12
    ) return null;
    const sourceMaterialRights = ['allowed', 'conditional', 'review-required', 'blocked', 'unknown'] as const;
    const usageDecisions = ['allowed', 'review-required', 'blocked'] as const;
    const ids = new Set<string>();
    const results: GeometryProblemSearchWidget['results'][number][] = [];
    for (const candidate of value.results) {
      const provider = record(candidate) && candidate.provider !== undefined
        ? candidate.provider
        : undefined;
      if (
        !record(candidate)
        || !text(candidate.id, 192)
        || ids.has(candidate.id)
        || typeof candidate.source !== 'string'
        || !isGeometryProblemSourceId(candidate.source)
        || !text(candidate.title, 240)
        || !text(candidate.statementPreview, 800)
        || !text(candidate.sourceUrl, 1_024)
        || !/^https:\/\//u.test(candidate.sourceUrl)
        || !text(candidate.datasetUrl, 1_024)
        || !/^https:\/\//u.test(candidate.datasetUrl)
        || !text(candidate.licenseId, 64)
        || !text(candidate.contentHash, 64)
        || !/^[0-9a-f]{64}$/u.test(candidate.contentHash)
        || candidate.contentHashAlgorithm !== 'sha256-utf8'
        || candidate.contentHashScope !== 'normalized-live-snapshot'
        || candidate.admission !== 'search-reference-only'
        || !record(candidate.rights)
        || !sourceMaterialRights.includes(candidate.rights.sourceMaterialRights as typeof sourceMaterialRights[number])
        || !usageDecisions.includes(candidate.rights.redistribution as typeof usageDecisions[number])
        || !usageDecisions.includes(candidate.rights.commercial as typeof usageDecisions[number])
        || !usageDecisions.includes(candidate.rights.training as typeof usageDecisions[number])
        || typeof candidate.hasImages !== 'boolean'
        || typeof candidate.assetCount !== 'number'
        || !Number.isSafeInteger(candidate.assetCount)
        || candidate.assetCount < 0
        || candidate.assetCount > 12
        || !stringList(candidate.topics, 12)
        || (provider !== undefined && (
          !record(provider)
          || !text(provider.datasetId, 160)
          || !text(provider.config, 160)
          || provider.split !== 'train'
          || (provider.rowIndex !== undefined && (
            !Number.isSafeInteger(provider.rowIndex)
            || (provider.rowIndex as number) < 0
            || (provider.rowIndex as number) > 1_000_000
          ))
          || provider.revision !== null
          || provider.revisionStatus !== 'unpinned-live-viewer'
        ))
      ) return null;
      ids.add(candidate.id);
      results.push({
        id: candidate.id,
        source: candidate.source,
        title: candidate.title,
        statementPreview: candidate.statementPreview,
        sourceUrl: candidate.sourceUrl,
        datasetUrl: candidate.datasetUrl,
        licenseId: candidate.licenseId,
        contentHash: candidate.contentHash,
        contentHashAlgorithm: 'sha256-utf8',
        contentHashScope: 'normalized-live-snapshot',
        admission: 'search-reference-only',
        ...(provider !== undefined ? {
          provider: {
            datasetId: provider.datasetId as string,
            config: provider.config as string,
            split: provider.split as string,
            ...(provider.rowIndex !== undefined
              ? { rowIndex: provider.rowIndex as number }
              : {}),
            revision: null,
            revisionStatus: 'unpinned-live-viewer',
          },
        } : {}),
        rights: {
          sourceMaterialRights: candidate.rights.sourceMaterialRights as GeometryProblemSourceMaterialRights,
          redistribution: candidate.rights.redistribution as GeometryProblemUsageDecision,
          commercial: candidate.rights.commercial as GeometryProblemUsageDecision,
          training: candidate.rights.training as GeometryProblemUsageDecision,
        },
        hasImages: candidate.hasImages,
        assetCount: candidate.assetCount,
        topics: candidate.topics as string[],
      });
    }
    let sourceStatus: GeometryProblemSearchWidget['sourceStatus'];
    if (value.sourceStatus !== undefined) {
      if (!Array.isArray(value.sourceStatus)
        || value.sourceStatus.length > GEOMETRY_PROBLEM_SOURCE_IDS.length) return null;
      const statusIds = new Set<string>();
      const parsedStatuses: NonNullable<GeometryProblemSearchWidget['sourceStatus']>[number][] = [];
      for (const candidate of value.sourceStatus) {
        if (
          !record(candidate)
          || typeof candidate.id !== 'string'
          || !isGeometryProblemSourceId(candidate.id)
          || statusIds.has(String(candidate.id))
          || typeof candidate.enabled !== 'boolean'
          || !['live-search', 'registry-only', 'restricted-opt-in'].includes(String(candidate.accessMode))
          || !sourceMaterialRights.includes(candidate.sourceMaterialRights as typeof sourceMaterialRights[number])
          || !text(candidate.detail, 240)
        ) return null;
        statusIds.add(String(candidate.id));
        parsedStatuses.push({
          id: candidate.id,
          enabled: candidate.enabled,
          accessMode: candidate.accessMode as 'live-search' | 'registry-only' | 'restricted-opt-in',
          sourceMaterialRights: candidate.sourceMaterialRights as GeometryProblemSourceMaterialRights,
          detail: candidate.detail,
        });
      }
      sourceStatus = parsedStatuses;
    }
    return {
      kind: 'problem-search',
      title: value.title,
      query: value.query,
      results,
      ...(sourceStatus ? { sourceStatus } : {}),
    };
  }
  if (value.kind === 'visual-audit') {
    const statuses = ['pending', 'passed', 'warning'] as const;
    if (
      !text(value.title, 160)
      || !statuses.includes(value.status as typeof statuses[number])
      || !text(value.summary, 1_000)
      || !stringList(value.observations, 12)
      || (value.fidelity !== undefined
        && !['matched', 'drift', 'not-compared'].includes(String(value.fidelity)))
    ) return null;
    return {
      kind: 'visual-audit',
      title: value.title,
      status: value.status as typeof statuses[number],
      ...(value.fidelity === 'matched' || value.fidelity === 'drift' || value.fidelity === 'not-compared'
        ? { fidelity: value.fidelity }
        : {}),
      summary: value.summary,
      observations: value.observations,
    };
  }
  return null;
}

const COMPLETE_WIDGET = /```tikz-agent-widget\b(?:[ \t]*\r?\n)?([\s\S]*?)```/giu;

/** Read-only UI artifacts. They never participate in executable classification. */
export function extractTikzAgentWidgets(output: string): TikzReadOnlyAgentWidget[] {
  const widgets: TikzReadOnlyAgentWidget[] = [];
  for (const match of output.matchAll(COMPLETE_WIDGET)) {
    if (widgets.length >= 4 || (match[1]?.length ?? 0) > 48 * 1024) break;
    try {
      const parsed = parseTikzReadOnlyAgentWidget(JSON.parse(match[1] ?? ''));
      if (parsed) widgets.push(parsed);
    } catch {
      // Malformed read-only widgets are ignored; they never become write input.
    }
  }
  return widgets;
}
