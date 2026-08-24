import type { TikzAgentToolCall } from './tool-protocol';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

/**
 * Request-local memo key for deterministic tools over one immutable GeometryDoc
 * basis. Search is intentionally excluded because its external corpus can
 * change independently of the document revision.
 */
export function tikzAgentToolObservationCacheKey(
  call: TikzAgentToolCall,
): string | null {
  if (call.name === 'search-geometry-problems') {
    return null;
  }
  return `${call.name}:${canonicalJson(call.arguments)}`;
}
