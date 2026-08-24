import { parseManagedConstructionBlocks } from '../semantics/managed-construction';

const HIDDEN_RECORD_LABEL = '[internal semantic record hidden]';

function maskRecordLine(line: string): string {
  const ending = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
  const body = ending ? line.slice(0, -ending.length) : line;
  const prefix = /^([ \t]*%[ \t]*@mathgeo[ \t]+record)\b/u.exec(body)?.[1]
    ?? '% @mathgeo record';
  return `${prefix} ${HIDDEN_RECORD_LABEL}${ending}`;
}
/**
 * Build a provider-facing source view without duplicating trusted managed-IR
 * JSON into the prompt. Only attached blocks whose metadata and integrity have
 * already passed the host parser are masked. Model-facing GeometryIntent/v2
 * has no source-range authority, so retaining thousands of padding spaces is
 * unnecessary. CodeMirror, Broker and the exact compiler keep the unmodified
 * source and all revision-bound offsets.
 */
export function tikzSourceForAgent(source: string): string {
  const ranges = parseManagedConstructionBlocks(source)
    .filter((block) => (
      block.metadataStatus === 'valid'
      && block.integrityStatus === 'valid'
    ))
    .flatMap((block) => block.semanticRecordRanges)
    .sort((left, right) => left.start - right.start);
  if (ranges.length === 0) return source;
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (
      range.start < cursor
      || range.start < 0
      || range.end < range.start
      || range.end > source.length
    ) continue;
    parts.push(source.slice(cursor, range.start));
    parts.push(maskRecordLine(source.slice(range.start, range.end)));
    cursor = range.end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}
