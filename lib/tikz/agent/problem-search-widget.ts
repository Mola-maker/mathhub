import type { TikzAgentToolObservation } from './runtime';
import type { TikzAgentToolCall } from './tool-protocol';
import {
  parseTikzReadOnlyAgentWidget,
  type GeometryProblemSearchWidget,
} from './widget-protocol';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Projects a bounded, read-only problem-search observation into UI data.
 * Retrieved rows remain untrusted reference material and never become write authority.
 */
export function geometryProblemSearchWidget(
  call: TikzAgentToolCall,
  observation: TikzAgentToolObservation,
): GeometryProblemSearchWidget | null {
  if (
    call.name !== 'search-geometry-problems'
    || !observation.ok
    || typeof call.arguments.query !== 'string'
    || !Array.isArray(observation.payload.records)
  ) return null;

  const results = observation.payload.records.slice(0, 12).flatMap((candidate) => {
    if (!record(candidate)) return [];
    return [{
      id: candidate.id,
      source: candidate.source,
      title: candidate.title,
      statementPreview: typeof candidate.statementPreview === 'string'
        ? candidate.statementPreview.slice(0, 800)
        : candidate.statementPreview,
      sourceUrl: candidate.sourceUrl,
      datasetUrl: candidate.datasetUrl,
      licenseId: candidate.licenseId,
      contentHash: candidate.contentHash,
      contentHashAlgorithm: candidate.contentHashAlgorithm,
      contentHashScope: candidate.contentHashScope,
      admission: candidate.admission,
      rights: candidate.rights,
      hasImages: candidate.hasImages,
      assetCount: Array.isArray(candidate.assets) ? candidate.assets.length : 0,
      topics: candidate.topics,
    }];
  });
  if (results.length === 0) return null;

  const parsed = parseTikzReadOnlyAgentWidget({
    kind: 'problem-search',
    title: `找到 ${results.length} 道几何题`,
    query: call.arguments.query,
    results,
    sourceStatus: observation.payload.sourceStatus,
  }, { trustedHostProblemSearch: true });
  return parsed?.kind === 'problem-search' ? parsed : null;
}
