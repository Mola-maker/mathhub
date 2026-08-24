/**
 * Stable binding identities shared by the TikZ projector and transaction
 * Broker. Keeping this ABI outside either side prevents proposal metadata from
 * inventing a second binding namespace.
 */
export function managedBlockBindingId(
  constructionId: string,
  ambiguousRangeStart?: number,
): string {
  return ambiguousRangeStart === undefined
    ? `binding:managed:${constructionId}`
    : `binding:managed:${constructionId}:ambiguous:${ambiguousRangeStart}`;
}

export function managedRecordBindingId(
  blockBindingId: string,
  recordType: string,
  recordId: string,
): string {
  return `${blockBindingId}:record:${recordType}:${recordId}`;
}
