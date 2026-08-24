import type { TextPatch } from '../document/source-transaction';
import {
  MANAGED_CONSTRUCTION_SCHEMA_V2,
  MANAGED_CONSTRUCTION_SCHEMA_V3,
  managedConstructionContentFingerprint,
  managedConstructionDocumentReferenceIssueKey,
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
} from '../semantics/managed-construction';
import {
  compileConstructionPlan,
  compileConstructionWriterArtifact,
  type ConstructionPlan,
} from './construction-ir';
import {
  compileConstructionPlanV3,
  compileConstructionPlanV3WithPresentation,
} from './construction-ir-v3';
import { decodeManagedConstructionPlan } from './construction-plan-codec';
import {
  hydrateManagedPresentation,
  managedPresentationEnvelopeMatches,
  mergeManagedPresentation,
  type ManagedPresentationIR,
} from './managed-presentation';
import {
  managedConstructionV3OutsideSlotsMatches,
  readManagedConstructionV3Envelope,
  validateManagedConstructionV3Artifact,
} from '../semantics/managed-construction-v3';

export type ManagedConstructionRecompileIssueCode =
  | 'managed-recompile-failed'
  | 'presentation-conflict'
  | 'merged-block-invalid';

export class ManagedConstructionRecompileError extends Error {
  readonly code: ManagedConstructionRecompileIssueCode;
  readonly stage: 'precondition' | 'hydrate' | 'merge' | 'validate';

  constructor(
    message: string,
    code: ManagedConstructionRecompileIssueCode = 'managed-recompile-failed',
    stage: 'precondition' | 'hydrate' | 'merge' | 'validate' = 'validate',
  ) {
    super(message);
    this.name = 'ManagedConstructionRecompileError';
    this.code = code;
    this.stage = stage;
  }
}

export interface ManagedConstructionRecompilePrecondition {
  /** Compare-and-swap guard copied from the current parsed managed block. */
  readonly expectedContentFingerprint: string;
  /** UTF-16 source range copied from the same revision-bound block. */
  readonly expectedRange: { readonly start: number; readonly end: number };
  /** Optional extra guard for callers that cache the construction kind. */
  readonly expectedPlanKind?: string;
  /** CAS guard for a losslessly hydrated non-canonical presentation body. */
  readonly expectedPresentationFingerprint?: string;
  readonly expectedWriterId: string;
  readonly expectedWriterRevision: number;
  readonly expectedWriterSlotIds: readonly string[];
  readonly expectedWriterSlotSemanticFingerprints: readonly string[];
  readonly expectedAttachmentsFingerprint?: string;
  /**
   * Canonical semantic plan used to prove writer-slot ownership. Exact blocks
   * recompile directly; supported presentation divergence is hydrated and
   * merged through ManagedPresentationIR, while all other divergence fails
   * closed with `presentation-conflict`.
   */
  readonly expectedCanonicalPlan: ConstructionPlan;
}

function compiledBlockText(
  plan: ConstructionPlan,
  currentText: string,
  envelopeText = currentText,
): string {
  const compilation = compileConstructionPlan(plan);
  const lineEnding = sourceLineEnding(envelopeText);
  const keepsTrailingLineEnding = currentText.endsWith('\r\n') || currentText.endsWith('\n');
  return compilation.lines.join(lineEnding)
    + (keepsTrailingLineEnding ? lineEnding : '');
}

function sourceLineEnding(value: string): '\n' | '\r\n' {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function preserveTrailingLineEnding(
  compiled: string,
  currentText: string,
  lineEnding: '\n' | '\r\n',
): string {
  const currentHasTrailing = currentText.endsWith('\r\n') || currentText.endsWith('\n');
  if (currentHasTrailing) return compiled;
  return compiled.endsWith(lineEnding)
    ? compiled.slice(0, -lineEnding.length)
    : compiled;
}

/**
 * `envelopeText` is the block minus its TikZ body. Reading the line ending from
 * the full block would let a CRLF inside the writer-owned presentation body
 * rewrite the canonical header and record lines, so the envelope comparison
 * would reject bytes that never changed.
 */
function compiledBlockTextForSchema(
  plan: ConstructionPlan,
  currentText: string,
  schemaVersion: number | null,
  envelopeText = currentText,
): string {
  if (schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3) {
    const lineEnding = sourceLineEnding(envelopeText);
    return preserveTrailingLineEnding(
      compileConstructionPlanV3(plan, lineEnding).source,
      currentText,
      lineEnding,
    );
  }
  return compiledBlockText(plan, currentText, envelopeText);
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
  // Declare a string key: the literal `managed:${string}:${string}` type would
  // otherwise be inferred and reject the plain-string lookups below.
  const referenceToEntityId = new Map<string, string>(target.records.flatMap((record) => (
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
    block.schemaVersion !== MANAGED_CONSTRUCTION_SCHEMA_V2
    && block.schemaVersion !== MANAGED_CONSTRUCTION_SCHEMA_V3
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} uses unsupported schema ${String(block.schemaVersion)}.`,
    );
  }
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
  // Header, records and end marker only: the TikZ body is presentation
  // territory and must not dictate the canonical envelope's line ending.
  const envelopeText = source.slice(block.range.start, block.tikzBodyRange.start)
    + source.slice(block.tikzBodyRange.end, block.range.end);
  if (
    precondition.expectedCanonicalPlan.id !== constructionId
    || precondition.expectedCanonicalPlan.kind !== block.planKind
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} does not match the expected canonical plan identity.`,
    );
  }
  const priorCanonicalText = compiledBlockTextForSchema(
    precondition.expectedCanonicalPlan,
    currentText,
    block.schemaVersion,
    envelopeText,
  );
  const priorArtifact = compileConstructionWriterArtifact(
    precondition.expectedCanonicalPlan,
  );
  if (
    precondition.expectedWriterId !== priorArtifact.writerId
    || precondition.expectedWriterRevision !== priorArtifact.writerRevision
    || JSON.stringify(precondition.expectedWriterSlotIds)
      !== JSON.stringify(priorArtifact.slots.map((slot) => slot.id))
    || JSON.stringify(precondition.expectedWriterSlotSemanticFingerprints)
      !== JSON.stringify(priorArtifact.slots.map((slot) => slot.semanticFingerprint))
  ) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} writer ABI changed since the semantic snapshot.`,
      'presentation-conflict',
      'precondition',
    );
  }
  let replacement = compiledBlockTextForSchema(
    nextPlan,
    currentText,
    block.schemaVersion,
    envelopeText,
  );
  let priorPresentation: ManagedPresentationIR | null = null;
  if (priorCanonicalText !== currentText) {
    if (precondition.expectedPresentationFingerprint === undefined) {
      throw new ManagedConstructionRecompileError(
        'Non-canonical managed presentation requires an exact presentation fingerprint.',
        'presentation-conflict',
        'precondition',
      );
    }
    let presentationBody = source.slice(
      block.tikzBodyRange.start,
      block.tikzBodyRange.end,
    );
    let envelopeMatches = managedPresentationEnvelopeMatches(
      currentText,
      priorCanonicalText,
    );
    if (block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3) {
      const currentLocalBlock = parseManagedConstructionBlocks(currentText)[0];
      const canonicalBlock = parseManagedConstructionBlocks(priorCanonicalText)[0];
      if (!currentLocalBlock || !canonicalBlock) {
        throw new ManagedConstructionRecompileError(
          'Schema-v3 presentation block could not be reparsed.',
          'presentation-conflict',
          'hydrate',
        );
      }
      const currentEnvelope = readManagedConstructionV3Envelope(
        currentText,
        currentLocalBlock,
      );
      const canonicalEnvelope = readManagedConstructionV3Envelope(
        priorCanonicalText,
        canonicalBlock,
      );
      const artifactValidation = validateManagedConstructionV3Artifact(
        currentEnvelope,
        priorArtifact,
      );
      envelopeMatches = (
        currentEnvelope.slots.length === 1
        && artifactValidation.artifactMatched
        && managedConstructionV3OutsideSlotsMatches(
          currentText,
          currentEnvelope,
          priorCanonicalText,
          canonicalEnvelope,
        )
      );
      if (currentEnvelope.slots.length === 1) {
        presentationBody = currentText.slice(
          currentEnvelope.slots[0]!.sourceRange.start,
          currentEnvelope.slots[0]!.sourceRange.end,
        );
      }
    }
    if (!envelopeMatches) {
      throw new ManagedConstructionRecompileError(
        'Managed block differs outside the writer-owned presentation slot.',
        'presentation-conflict',
        'hydrate',
      );
    }
    const hydrated = hydrateManagedPresentation(
      precondition.expectedCanonicalPlan,
      presentationBody,
    );
    if (!hydrated.ok) {
      throw new ManagedConstructionRecompileError(
        hydrated.issues[0]?.message ?? 'Current presentation cannot be hydrated.',
        'presentation-conflict',
        'hydrate',
      );
    }
    priorPresentation = hydrated.presentation;
    if (
      precondition.expectedPresentationFingerprint !== undefined
      && hydrated.presentation.presentationFingerprint
        !== precondition.expectedPresentationFingerprint
    ) {
      throw new ManagedConstructionRecompileError(
        `Managed construction ${constructionId} presentation changed since the semantic snapshot.`,
        'presentation-conflict',
        'precondition',
      );
    }
    if (
      precondition.expectedPresentationFingerprint !== undefined
      && (
        precondition.expectedWriterId !== hydrated.presentation.writerId
      || precondition.expectedWriterRevision
        !== hydrated.presentation.writerRevision
      || precondition.expectedAttachmentsFingerprint
        !== hydrated.presentation.attachmentsFingerprint
      )
    ) {
      throw new ManagedConstructionRecompileError(
        `Managed construction ${constructionId} writer ABI or attachments changed since the semantic snapshot.`,
        'presentation-conflict',
        'precondition',
      );
    }
    if (block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3) {
      // Envelope, not the whole block: a CRLF inside the writer-owned body is a
      // presentation detail and must not rewrite the canonical header/records.
      const lineEnding = sourceLineEnding(envelopeText);
      try {
        replacement = preserveTrailingLineEnding(
          compileConstructionPlanV3WithPresentation(
            nextPlan,
            hydrated.presentation,
            lineEnding,
          ).source,
          currentText,
          lineEnding,
        );
      } catch (error) {
        throw new ManagedConstructionRecompileError(
          error instanceof Error ? error.message : 'Next v3 presentation cannot be merged.',
          'presentation-conflict',
          'merge',
        );
      }
    } else {
      const merged = mergeManagedPresentation(hydrated.presentation, nextPlan);
      if (!merged.ok) {
        throw new ManagedConstructionRecompileError(
          merged.issues[0]?.message ?? 'Next presentation cannot be merged.',
          'presentation-conflict',
          'merge',
        );
      }
      const replacementBlock = parseManagedConstructionBlocks(replacement)[0];
      if (!replacementBlock) {
        throw new ManagedConstructionRecompileError(
          'Trusted recompile produced no managed block before presentation merge.',
        );
      }
      const resealed = managedStyleRecompilePatches(
        replacement,
        constructionId,
        {
          from: replacementBlock.tikzBodyRange.start,
          to: replacementBlock.tikzBodyRange.end,
          insert: merged.tikzBody,
        },
      );
      const wholeBlockPatch = resealed[0];
      if (
        resealed.length !== 1
        || !wholeBlockPatch
        || wholeBlockPatch.from !== 0
        || wholeBlockPatch.to !== replacement.length
      ) {
        throw new ManagedConstructionRecompileError(
          'Presentation merge did not produce one atomic managed-block replacement.',
        );
      }
      replacement = wholeBlockPatch.insert;
    }
  } else if (precondition.expectedPresentationFingerprint !== undefined) {
    throw new ManagedConstructionRecompileError(
      `Managed construction ${constructionId} no longer has the expected presentation projection.`,
      'presentation-conflict',
      'precondition',
    );
  }
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
  const decodedReplacement = decodeManagedConstructionPlan(
    replacement,
    parsed[0]!,
  );
  if (!decodedReplacement.ok) {
    throw new ManagedConstructionRecompileError(
      `Merged managed block failed writer/presentation self-validation: ${decodedReplacement.issues[0]?.message ?? 'unknown decode failure'}`,
      'merged-block-invalid',
      'validate',
    );
  }
  if (
    priorPresentation
    && (
      !decodedReplacement.presentation
      || decodedReplacement.presentation.writerId !== priorPresentation.writerId
      || decodedReplacement.presentation.writerRevision
        !== priorPresentation.writerRevision
      || decodedReplacement.presentation.attachmentsFingerprint
        !== priorPresentation.attachmentsFingerprint
      || JSON.stringify(decodedReplacement.presentation.slots.map((slot) => slot.slotId))
        !== JSON.stringify(priorPresentation.slots.map((slot) => slot.slotId))
      || JSON.stringify(decodedReplacement.presentation.opaqueSlots)
        !== JSON.stringify(priorPresentation.opaqueSlots)
    )
  ) {
    throw new ManagedConstructionRecompileError(
      'Merged managed block did not preserve the hydrated presentation attachments and writer ABI.',
      'merged-block-invalid',
      'validate',
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
  if (block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3) {
    const envelope = readManagedConstructionV3Envelope(source, block);
    const owningSlots = envelope.slots.filter((slot) => (
      bodyPatch.from >= slot.sourceRange.start
      && bodyPatch.to <= slot.sourceRange.end
    ));
    if (
      !envelope.syntacticallyValid
      || envelope.opaqueRanges.length !== 0
      || owningSlots.length !== 1
    ) {
      throw new ManagedConstructionRecompileError(
        'Schema-v3 style patch must stay inside exactly one attached writer slot.',
        'presentation-conflict',
        'precondition',
      );
    }
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
