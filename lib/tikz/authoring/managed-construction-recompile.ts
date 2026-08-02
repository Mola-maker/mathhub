import type { TextPatch } from '../document/source-transaction';
import {
  managedConstructionContentFingerprint,
  managedConstructionDocumentReferenceIssueKey,
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
} from '../semantics/managed-construction';
import {
  compileConstructionPlan,
  type ConstructionPlan,
} from './construction-ir';

export class ManagedConstructionRecompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedConstructionRecompileError';
  }
}

export interface ManagedConstructionRecompilePrecondition {
  /** Compare-and-swap guard copied from the current parsed managed block. */
  readonly expectedContentFingerprint: string;
  /** UTF-16 source range copied from the same revision-bound block. */
  readonly expectedRange: { readonly start: number; readonly end: number };
  /** Optional extra guard for callers that cache the construction kind. */
  readonly expectedPlanKind?: string;
  /**
   * Schema-v2 presentation guard. Replacement is allowed only while the
   * current block is still the canonical compilation of this prior plan.
   * Styled/diverged bodies fail closed until Presentation IR/schema-v3 can
   * round-trip them without loss.
   */
  readonly expectedCanonicalPlan: ConstructionPlan;
}

function compiledBlockText(plan: ConstructionPlan, currentText: string): string {
  const compilation = compileConstructionPlan(plan);
  const lineEnding = currentText.includes('\r\n') ? '\r\n' : '\n';
  const keepsTrailingLineEnding = currentText.endsWith('\r\n') || currentText.endsWith('\n');
  return compilation.lines.join(lineEnding)
    + (keepsTrailingLineEnding ? lineEnding : '');
}

function uniqueAttachedBlock(source: string, constructionId: string) {
  const matches = parseManagedConstructionBlocks(source).filter(
    (candidate) => candidate.id === constructionId,
  );
  if (matches.length === 0) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} does not exist.`,
    );
  }
  if (matches.length !== 1) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ID ${constructionId} is ambiguous (${matches.length} blocks).`,
    );
  }
  const block = matches[0]!;
  if (block.metadataStatus !== 'valid' || block.integrityStatus !== 'valid') {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} is not valid and attached.`,
    );
  }
  return block;
}

function collectMatchingReferences(
  value: unknown,
  candidates: ReadonlySet<string>,
  result: Set<string>,
): void {
  if (typeof value === 'string') {
    if (candidates.has(value)) result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMatchingReferences(item, candidates, result));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value as Record<string, unknown>).forEach((item) => (
    collectMatchingReferences(item, candidates, result)
  ));
}

function externallyReferencedEntities(
  source: string,
  target: ManagedConstructionBlock,
): ReadonlySet<string> {
  const referenceToEntityId = new Map(target.records.flatMap((record) => (
    record.recordType === 'entity'
      ? [[`managed:${target.id}:${record.id}`, record.id] as const]
      : []
  )));
  const candidateReferences = new Set(referenceToEntityId.keys());
  const references = new Set<string>();
  for (const block of parseManagedConstructionBlocks(source)) {
    if (
      block.range.start === target.range.start
      || block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
    ) continue;
    block.records.forEach((record) => (
      collectMatchingReferences(record, candidateReferences, references)
    ));
  }
  return new Set([...references].flatMap((reference) => {
    const entityId = referenceToEntityId.get(reference);
    return entityId ? [entityId] : [];
  }));
}

function assertExternallyReferencedEntityIdentity(
  source: string,
  block: ManagedConstructionBlock,
  nextPlan: ConstructionPlan,
): void {
  const requiredIds = externallyReferencedEntities(source, block);
  if (requiredIds.size === 0) return;
  const previous = new Map(block.records.flatMap((record) => (
    record.recordType === 'entity' ? [[record.id, record] as const] : []
  )));
  const next = new Map(nextPlan.entities.map((entity) => [entity.id, entity] as const));
  for (const recordId of requiredIds) {
    const priorEntity = previous.get(recordId);
    const nextEntity = next.get(recordId);
    if (!priorEntity || !nextEntity) {
      throw new ManagedConstructionRecompileError(
        `Managed entity ${block.id}:${recordId} is referenced by another construction and cannot be removed or renamed.`,
      );
    }
    if (
      nextEntity.kind !== priorEntity.kind
      || nextEntity.name !== priorEntity.name
    ) {
      throw new ManagedConstructionRecompileError(
        `Managed entity ${block.id}:${recordId} is externally referenced; its kind and TikZ name must remain stable.`,
      );
    }
  }
}

function assertNoNewDocumentReferenceIssues(
  previousSource: string,
  nextSource: string,
): void {
  const existing = new Set(
    managedConstructionDocumentReferenceIssues(previousSource)
      .map(managedConstructionDocumentReferenceIssueKey),
  );
  const introduced = managedConstructionDocumentReferenceIssues(nextSource)
    .filter((item) => !existing.has(managedConstructionDocumentReferenceIssueKey(item)));
  if (introduced.length > 0) {
    throw new ManagedConstructionRecompileError(
      `Managed construction replacement would introduce a document-level reference error: ${introduced[0]!.message}`,
    );
  }
}

/**
 * Compile a validated ConstructionPlan into an atomic whole-block replacement.
 *
 * This is the only geometry-changing write path for an existing managed
 * construction. AI and Canvas callers provide typed semantic intent; this
 * trusted boundary regenerates metadata and TikZ together. It never accepts a
 * caller-authored body string, and stale fingerprints/ranges fail closed.
 */
export function managedConstructionPlanRecompilePatches(
  source: string,
  constructionId: string,
  nextPlan: ConstructionPlan,
  precondition: ManagedConstructionRecompilePrecondition,
): readonly TextPatch[] {
  const block = uniqueAttachedBlock(source, constructionId);
  if (
    block.range.start !== precondition.expectedRange.start
    || block.range.end !== precondition.expectedRange.end
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} moved since the semantic snapshot.`,
    );
  }
  if (
    !block.contentFingerprint
    || block.contentFingerprint !== precondition.expectedContentFingerprint
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} changed since the semantic snapshot.`,
    );
  }
  if (
    precondition.expectedPlanKind !== undefined
    && block.planKind !== precondition.expectedPlanKind
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} no longer has plan kind ${precondition.expectedPlanKind}.`,
    );
  }
  if (nextPlan.id !== constructionId) {
    throw new ManagedConstructionRecompileError(
      'Typed recompile cannot rename a managed construction identity.',
    );
  }
  if (nextPlan.kind !== block.planKind) {
    throw new ManagedConstructionRecompileError(
      `Typed recompile cannot change plan kind ${block.planKind} to ${nextPlan.kind}.`,
    );
  }
  assertExternallyReferencedEntityIdentity(source, block, nextPlan);
  const currentText = source.slice(block.range.start, block.range.end);
  if (
    precondition.expectedCanonicalPlan.id !== constructionId
    || precondition.expectedCanonicalPlan.kind !== block.planKind
    || compiledBlockText(precondition.expectedCanonicalPlan, currentText) !== currentText
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} has presentation/source divergence; schema-v2 replacement would be lossy.`,
    );
  }
  const replacement = compiledBlockText(nextPlan, currentText);
  const parsed = parseManagedConstructionBlocks(replacement);
  if (
    parsed.length !== 1
    || parsed[0].range.start !== 0
    || parsed[0].range.end !== replacement.length
    || parsed[0].id !== constructionId
    || parsed[0].planKind !== block.planKind
    || parsed[0].metadataStatus !== 'valid'
    || parsed[0].integrityStatus !== 'valid'
  ) {
    throw new ManagedConstructionRecompileError(
      'Typed recompile did not produce one complete, attached managed block.',
    );
  }
  const nextSource = source.slice(0, block.range.start)
    + replacement
    + source.slice(block.range.end);
  assertNoNewDocumentReferenceIssues(source, nextSource);
  return [{
    from: block.range.start,
    to: block.range.end,
    insert: replacement,
  }];
}

/**
 * Re-seal a style-only mutation inside one managed construction.
 *
 * Geometry and label-content edits may duplicate data in semantic records and
 * therefore need a typed plan/record rewrite. Style options are intentionally
 * derived from TikZ construction syntax, so they can be updated by replacing
 * the body slice and renewing the content fingerprint atomically.
 */
export function managedStyleRecompilePatches(
  source: string,
  constructionId: string,
  bodyPatch: TextPatch,
): readonly TextPatch[] {
  const block = uniqueAttachedBlock(source, constructionId);
  if (
    bodyPatch.from < block.tikzBodyRange.start
    || bodyPatch.to > block.tikzBodyRange.end
    || bodyPatch.to < bodyPatch.from
  ) {
    throw new ManagedConstructionRecompileError(
      'Style patch must stay inside the managed TikZ body.',
    );
  }

  const bodyStart = block.tikzBodyRange.start;
  const nextTikzBody = [
    source.slice(bodyStart, bodyPatch.from),
    bodyPatch.insert,
    source.slice(bodyPatch.to, block.tikzBodyRange.end),
  ].join('');
  const metadataText = source.slice(
    block.headerRange.end,
    block.tikzBodyRange.start,
  );
  const nextFingerprint = managedConstructionContentFingerprint({
    id: block.id,
    kind: block.kind,
    planKind: block.planKind,
    inputs: block.inputs,
    outputs: block.outputs,
    metadataText,
    tikzBodyText: nextTikzBody,
  });
  const header = source.slice(block.headerRange.start, block.headerRange.end);
  const fingerprintMatch =
    /content-fingerprint=(?<fingerprint>[0-9a-f]{16})/.exec(header);
  const previousFingerprint = fingerprintMatch?.groups?.fingerprint;
  if (
    !fingerprintMatch
    || !previousFingerprint
    || fingerprintMatch.index === undefined
  ) {
    throw new ManagedConstructionRecompileError(
      'Managed construction fingerprint field is missing or malformed.',
    );
  }
  const fingerprintOffset = (
    fingerprintMatch.index
    + fingerprintMatch[0].indexOf(previousFingerprint)
  );
  const fingerprintStart = block.headerRange.start + fingerprintOffset;
  const nextHeader = [
    source.slice(block.headerRange.start, fingerprintStart),
    nextFingerprint,
    source.slice(
      fingerprintStart + previousFingerprint.length,
      block.headerRange.end,
    ),
  ].join('');
  const nextBlock = [
    source.slice(block.range.start, block.headerRange.start),
    nextHeader,
    source.slice(block.headerRange.end, block.tikzBodyRange.start),
    nextTikzBody,
    source.slice(block.tikzBodyRange.end, block.range.end),
  ].join('');

  return [{
    from: block.range.start,
    to: block.range.end,
    insert: nextBlock,
  }];
}
