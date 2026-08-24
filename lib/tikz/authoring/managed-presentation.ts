import type { Statement } from '../subset/ast';
import { parseTikz } from '../subset/parser';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { hashSource } from '../document/source-hash';
import {
  parseTikzOptionSequence,
  type TikzOptionEntry,
  type TikzOptionSequence,
} from '../syntax/option-sequence';
import {
  compileConstructionWriterArtifact,
  type ConstructionPlan,
  type ConstructionWriterSlot,
} from './construction-ir';

export const MANAGED_PRESENTATION_SCHEMA = 'managed-presentation/v1' as const;

export type ManagedPresentationIssueCode =
  | 'unsupported-plan-kind'
  | 'slot-count-mismatch'
  | 'slot-identity-mismatch'
  | 'source-shape-mismatch'
  | 'invalid-option-site'
  | 'unsupported-presentation-option'
  | 'semantic-option-conflict';

export interface ManagedPresentationIssue {
  readonly code: ManagedPresentationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ManagedPresentationOptionAttachment {
  readonly kind: 'command-option';
  readonly slotId: string;
  readonly siteId: string;
  readonly ordinal: number;
  readonly raw: string;
  /** Range relative to the exact option-list interior. */
  readonly range: { readonly start: number; readonly end: number };
}

export interface ManagedSlotPresentation {
  readonly slotId: string;
  readonly semanticFingerprint: string;
  readonly source: string;
  readonly sourceWithoutOptions: string;
  readonly optionSite:
    | {
      readonly id: string;
      readonly sequence: TikzOptionSequence | null;
      readonly canonicalSequence: TikzOptionSequence | null;
      readonly canonicalEntryIndexes: readonly number[];
      readonly protectedSemanticOptionKeys: readonly string[];
    }
    | null;
}

/**
 * Revision-local presentation recovered from writer-owned source slots.
 *
 * It never becomes a second source of truth: exact bytes stay in `source` and
 * are accepted only after the prior canonical writer artifact proves the slot
 * shape. Unsupported or ambiguous differences fail closed.
 */
export interface ManagedPresentationIR {
  readonly schema: typeof MANAGED_PRESENTATION_SCHEMA;
  readonly constructionId: string;
  readonly planKind: ConstructionPlan['kind'];
  readonly writerId: string;
  readonly writerRevision: number;
  /** Exact revision-local body fingerprint, including line endings/comments. */
  readonly presentationFingerprint: string;
  readonly attachmentsFingerprint: string;
  readonly trailingLineEnding: '' | '\n' | '\r\n';
  /** Exact separator between writer slots; empty for a one-slot writer. */
  readonly slotSeparator: '' | '\n' | '\r\n';
  readonly slots: readonly ManagedSlotPresentation[];
  readonly attachments: readonly ManagedPresentationOptionAttachment[];
  readonly opaqueSlots: readonly string[];
}

export type ManagedPresentationHydrationResult =
  | { readonly ok: true; readonly presentation: ManagedPresentationIR }
  | { readonly ok: false; readonly issues: readonly ManagedPresentationIssue[] };

export type ManagedPresentationMergeResult =
  | { readonly ok: true; readonly tikzBody: string }
  | { readonly ok: false; readonly issues: readonly ManagedPresentationIssue[] };

interface ParsedWriterStatement {
  readonly source: string;
  readonly sourceWithoutOptions: string;
  readonly optionRange: { readonly start: number; readonly end: number } | null;
  readonly sequence: TikzOptionSequence | null;
}

const WRAPPER_PREFIX = '\\begin{tikzpicture}\n';
const WRAPPER_SUFFIX = '\n\\end{tikzpicture}';
const CONTENT_FINGERPRINT_FIELD = /content-fingerprint=[0-9a-f]{16}/u;

function issue(
  code: ManagedPresentationIssueCode,
  path: string,
  message: string,
): ManagedPresentationIssue {
  return { code, path, message };
}

function normalizedFingerprintHeader(value: string): string {
  return value.replace(
    CONTENT_FINGERPRINT_FIELD,
    'content-fingerprint=<presentation-fingerprint>',
  );
}

/**
 * Proves that two complete blocks differ only in the TikZ body and its content
 * fingerprint. Header layout, record bytes, end marker, and surrounding line
 * endings must remain exact; this prevents a body hydrator from accidentally
 * blessing unrelated block divergence.
 */
export function managedPresentationEnvelopeMatches(
  currentText: string,
  canonicalText: string,
): boolean {
  const currentBlocks = parseManagedConstructionBlocks(currentText);
  const canonicalBlocks = parseManagedConstructionBlocks(canonicalText);
  if (currentBlocks.length !== 1 || canonicalBlocks.length !== 1) return false;
  const current = currentBlocks[0]!;
  const canonical = canonicalBlocks[0]!;
  if (
    current.range.start !== 0
    || current.range.end !== currentText.length
    || canonical.range.start !== 0
    || canonical.range.end !== canonicalText.length
  ) return false;
  const currentHeader = currentText.slice(current.headerRange.start, current.headerRange.end);
  const canonicalHeader = canonicalText.slice(canonical.headerRange.start, canonical.headerRange.end);
  if (
    normalizedFingerprintHeader(currentHeader)
    !== normalizedFingerprintHeader(canonicalHeader)
  ) return false;
  const currentMetadata = currentText.slice(current.headerRange.end, current.tikzBodyRange.start);
  const canonicalMetadata = canonicalText.slice(
    canonical.headerRange.end,
    canonical.tikzBodyRange.start,
  );
  if (currentMetadata !== canonicalMetadata) return false;
  return currentText.slice(current.tikzBodyRange.end)
    === canonicalText.slice(canonical.tikzBodyRange.end);
}

function trailingLineEndingOf(value: string): '' | '\n' | '\r\n' {
  if (value.endsWith('\r\n')) return '\r\n';
  if (value.endsWith('\n')) return '\n';
  return '';
}

function withoutTrailingLineEnding(
  value: string,
  lineEnding: '' | '\n' | '\r\n',
): string {
  return lineEnding ? value.slice(0, -lineEnding.length) : value;
}

function statementOptions(statement: Statement) {
  return 'options' in statement ? statement.options : null;
}

function parseWriterStatement(source: string): ParsedWriterStatement | null {
  try {
    const picture = parseTikz(`${WRAPPER_PREFIX}${source}${WRAPPER_SUFFIX}`);
    if (picture.statements.length !== 1) return null;
    const options = statementOptions(picture.statements[0]!);
    if (!options) {
      return {
        source,
        sourceWithoutOptions: source,
        optionRange: null,
        sequence: null,
      };
    }
    const optionRange = {
      start: options.range.start - WRAPPER_PREFIX.length,
      end: options.range.end - WRAPPER_PREFIX.length,
    };
    if (
      optionRange.start < 0
      || optionRange.end > source.length
      || optionRange.end <= optionRange.start + 1
      || source[optionRange.start] !== '['
      || source[optionRange.end - 1] !== ']'
    ) return null;
    const raw = source.slice(optionRange.start + 1, optionRange.end - 1);
    return {
      source,
      sourceWithoutOptions: source.slice(0, optionRange.start)
        + source.slice(optionRange.end),
      optionRange,
      sequence: parseTikzOptionSequence(raw),
    };
  } catch {
    return null;
  }
}

function supportsPresentation(plan: ConstructionPlan): boolean {
  const artifact = compileConstructionWriterArtifact(plan);
  return artifact.slots.some((slot) => slot.optionSites.length === 1)
    && artifact.slots.every((slot) => slot.optionSites.length <= 1);
}

const SAFE_BARE_PRESENTATION_OPTIONS = new Set([
  'black', 'red', 'blue', 'green', 'orange', 'purple', 'gray', 'brown',
  'cyan', 'magenta', 'lime', 'olive', 'pink', 'teal', 'violet', 'yellow',
  'white', 'ultra thin', 'very thin', 'thin', 'semithick', 'thick',
  'very thick', 'ultra thick', 'dashed', 'densely dashed', 'dotted',
  'dash dot', '->', '<-', '<->', 'draw', 'fill', 'double',
]);
const SIMPLE_COLOR_VALUE = /^(?:none|[A-Za-z]+(?:![0-9]+(?:![A-Za-z]+)?)*)$/u;
const SIMPLE_NUMBER = /^(?:0|1|0?\.[0-9]+)$/u;
const SIMPLE_DIMENSION = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:pt|cm|mm|em|ex)$/u;

function safePresentationOption(entry: TikzOptionEntry): boolean {
  const option = entry.interpreted;
  if (SAFE_BARE_PRESENTATION_OPTIONS.has(option)) return true;
  const key = entry.interpretedKey;
  const value = entry.interpretedValue;
  if (value === null) return false;
  if (key === 'draw' || key === 'color' || key === 'fill') {
    return SIMPLE_COLOR_VALUE.test(value);
  }
  if (key === 'opacity' || key === 'fill opacity' || key === 'draw opacity' || key === 'text opacity') {
    return SIMPLE_NUMBER.test(value);
  }
  if (key === 'line width') return SIMPLE_DIMENSION.test(value);
  if (key === 'line cap') return /^(?:round|butt|rect)$/u.test(value);
  if (key === 'line join') return /^(?:round|bevel|miter)$/u.test(value);
  if (key === 'rounded corners') return SIMPLE_DIMENSION.test(value);
  return false;
}

function protectedSemanticOptionKeys(
  canonical: TikzOptionSequence | null,
): ReadonlySet<string> {
  return new Set((canonical?.entries ?? [])
    .filter((entry) => !safePresentationOption(entry))
    .map((entry) => entry.interpretedKey));
}

interface WriterBodyLayout {
  readonly sources: readonly string[];
  readonly separator: '' | '\n' | '\r\n';
  readonly trailingLineEnding: '' | '\n' | '\r\n';
  readonly starts: readonly number[];
}

export interface ManagedPresentationOptionSiteTarget {
  readonly slotId: string;
  readonly from: number;
  readonly to: number;
  readonly raw: string;
}

function writerBodyLayout(
  source: string,
  slotCount: number,
): WriterBodyLayout | null {
  const trailingLineEnding = trailingLineEndingOf(source);
  const body = withoutTrailingLineEnding(source, trailingLineEnding);
  if (slotCount === 1) {
    return {
      sources: [body],
      separator: '',
      trailingLineEnding,
      starts: [0],
    };
  }
  const separator = body.includes('\r\n') ? '\r\n' : '\n';
  const sources = body.split(separator);
  if (
    sources.length !== slotCount
    || sources.some((item) => item.includes('\n') || item.includes('\r'))
  ) return null;
  const starts: number[] = [];
  let cursor = 0;
  for (const item of sources) {
    starts.push(cursor);
    cursor += item.length + separator.length;
  }
  return { sources, separator, trailingLineEnding, starts };
}

/** Resolve one trusted writer option site to a range relative to the TikZ body. */
export function managedPresentationOptionSiteTarget(
  plan: ConstructionPlan,
  currentTikzBody: string,
  slotId: string,
): ManagedPresentationOptionSiteTarget | null {
  const artifact = compileConstructionWriterArtifact(plan);
  const slotIndex = artifact.slots.findIndex((slot) => slot.id === slotId);
  const slot = artifact.slots[slotIndex];
  const layout = writerBodyLayout(currentTikzBody, artifact.slots.length);
  const source = layout?.sources[slotIndex];
  if (!slot || !layout || source === undefined || slot.optionSites.length !== 1) {
    return null;
  }
  const parsed = parseWriterStatement(source);
  if (!parsed) return null;
  const start = layout.starts[slotIndex]!;
  if (parsed.optionRange) {
    return {
      slotId,
      from: start + parsed.optionRange.start,
      to: start + parsed.optionRange.end,
      raw: parsed.sequence?.raw ?? '',
    };
  }
  const insertionOffset = commandInsertionOffset(source);
  return insertionOffset === null
    ? null
    : {
      slotId,
      from: start + insertionOffset,
      to: start + insertionOffset,
      raw: '',
    };
}

function matchCanonicalEntries(
  current: TikzOptionSequence | null,
  canonical: TikzOptionSequence | null,
  protectedKeys: ReadonlySet<string>,
): readonly number[] | null {
  const semanticEntries = canonical?.entries.filter((entry) => (
    protectedKeys.has(entry.interpretedKey)
  )) ?? [];
  // A null canonical yields no semantic entries and returned above; check it
  // explicitly so the invariant is visible rather than asserted.
  if (semanticEntries.length === 0) return [];
  if (!canonical || !current || !current.balanced || !canonical.balanced) return null;
  const used = new Set<number>();
  const matches: number[] = [];
  for (const canonicalEntry of semanticEntries) {
    const index = current.entries.findIndex((entry, candidateIndex) => (
      !used.has(candidateIndex)
      && entry.interpreted === canonicalEntry.interpreted
      && entry.interpretedRange !== null
    ));
    if (index < 0) return null;
    used.add(index);
    matches.push(index);
  }
  return matches;
}

function commandInsertionOffset(source: string): number | null {
  const command = /^\\[A-Za-z@]+/u.exec(source);
  return command ? command[0].length : null;
}

/**
 * Prove that a style delta addresses exactly the registered command-option
 * site (or inserts that site at the command boundary). The caller must still
 * hydrate/decode the replacement to validate option semantics.
 */
export function managedPresentationOptionPatchMatches(
  plan: ConstructionPlan,
  currentTikzBody: string,
  patch: { readonly from: number; readonly to: number; readonly insert: string },
): boolean {
  const artifact = compileConstructionWriterArtifact(plan);
  const layout = writerBodyLayout(currentTikzBody, artifact.slots.length);
  if (!layout) return false;
  const slotIndex = layout.sources.findIndex((source, index) => {
    const start = layout.starts[index]!;
    return patch.from >= start && patch.to <= start + source.length;
  });
  const slot = artifact.slots[slotIndex];
  const source = layout.sources[slotIndex];
  if (!slot || source === undefined || slot.optionSites.length !== 1) return false;
  const start = layout.starts[slotIndex]!;
  const relativePatch = {
    from: patch.from - start,
    to: patch.to - start,
  };
  const parsed = parseWriterStatement(source);
  if (
    !parsed
    || relativePatch.from < 0
    || relativePatch.to < relativePatch.from
    || relativePatch.to > source.length
    || patch.insert.length < 2
    || patch.insert[0] !== '['
    || patch.insert[patch.insert.length - 1] !== ']'
    || !parseTikzOptionSequence(patch.insert.slice(1, -1)).balanced
  ) return false;
  if (parsed.optionRange) {
    return relativePatch.from === parsed.optionRange.start
      && relativePatch.to === parsed.optionRange.end;
  }
  const insertionOffset = commandInsertionOffset(source);
  return insertionOffset !== null
    && relativePatch.from === insertionOffset
    && relativePatch.to === insertionOffset;
}

function optionAttachments(
  slot: ConstructionWriterSlot,
  current: TikzOptionSequence | null,
  canonicalEntryIndexes: readonly number[],
): readonly ManagedPresentationOptionAttachment[] {
  if (!current || slot.optionSites.length !== 1) return [];
  const canonicalIndexes = new Set(canonicalEntryIndexes);
  return current.entries.flatMap((entry, index) => (
    canonicalIndexes.has(index)
      ? []
      : [{
        kind: 'command-option' as const,
        slotId: slot.id,
        siteId: slot.optionSites[0]!.id,
        ordinal: entry.ordinal,
        raw: entry.segmentRaw,
        range: entry.segmentRange,
      }]
  ));
}

export function hydrateManagedPresentation(
  previousPlan: ConstructionPlan,
  currentTikzBody: string,
): ManagedPresentationHydrationResult {
  if (!supportsPresentation(previousPlan)) {
    return {
      ok: false,
      issues: [issue(
        'unsupported-plan-kind',
        'plan.kind',
        'The construction writer has no unambiguous presentation option site.',
      )],
    };
  }
  const artifact = compileConstructionWriterArtifact(previousPlan);
  const layout = writerBodyLayout(currentTikzBody, artifact.slots.length);
  if (!layout) {
    return {
      ok: false,
      issues: [issue(
        'slot-count-mismatch',
        'slots',
        `Current TikZ body does not map one-to-one onto ${artifact.slots.length} writer slots.`,
      )],
    };
  }
  const managedSlots: ManagedSlotPresentation[] = [];
  const attachments: ManagedPresentationOptionAttachment[] = [];
  for (let index = 0; index < artifact.slots.length; index += 1) {
    const slot = artifact.slots[index]!;
    const current = parseWriterStatement(layout.sources[index]!);
    const canonical = parseWriterStatement(slot.canonicalSource);
    if (!current || !canonical || current.sourceWithoutOptions !== canonical.sourceWithoutOptions) {
      return { ok: false, issues: [issue(
        'source-shape-mismatch',
        `slots.${slot.id}`,
        'Current source differs outside the registered command-option site.',
      )] };
    }
    if (slot.optionSites.length === 0 && current.sequence !== null) {
      return { ok: false, issues: [issue(
        'invalid-option-site',
        `slots.${slot.id}.optionSites`,
        'Current source introduces options into a writer slot that does not own an option site.',
      )] };
    }
    const protectedKeys = protectedSemanticOptionKeys(canonical.sequence);
    const canonicalEntryIndexes = matchCanonicalEntries(
      current.sequence,
      canonical.sequence,
      protectedKeys,
    );
    if (canonicalEntryIndexes === null) {
      return { ok: false, issues: [issue(
        'semantic-option-conflict',
        `slots.${slot.id}.command-options`,
        'Current options no longer contain the prior canonical semantic option sequence.',
      )] };
    }
    const canonicalIndexes = new Set(canonicalEntryIndexes);
    const conflictingAttachment = current.sequence?.entries.find((entry, entryIndex) => (
      !canonicalIndexes.has(entryIndex) && protectedKeys.has(entry.interpretedKey)
    ));
    if (conflictingAttachment) {
      return { ok: false, issues: [issue(
        'semantic-option-conflict',
        `slots.${slot.id}.command-options`,
        `Presentation attachment duplicates semantic option ${conflictingAttachment.interpretedKey}.`,
      )] };
    }
    const unsupportedAttachment = current.sequence?.entries.find((entry, entryIndex) => (
      !canonicalIndexes.has(entryIndex) && !safePresentationOption(entry)
    ));
    if (unsupportedAttachment) {
      return { ok: false, issues: [issue(
        'unsupported-presentation-option',
        `slots.${slot.id}.command-options`,
        `Option ${unsupportedAttachment.interpretedKey || unsupportedAttachment.interpreted} is not in the presentation-safe vertical slice.`,
      )] };
    }
    attachments.push(...optionAttachments(slot, current.sequence, canonicalEntryIndexes));
    managedSlots.push({
      slotId: slot.id,
      semanticFingerprint: slot.semanticFingerprint,
      source: current.source,
      sourceWithoutOptions: current.sourceWithoutOptions,
      optionSite: slot.optionSites.length === 1 ? {
        id: slot.optionSites[0]!.id,
        sequence: current.sequence,
        canonicalSequence: canonical.sequence,
        canonicalEntryIndexes,
        protectedSemanticOptionKeys: [...protectedKeys],
      } : null,
    });
  }
  return {
    ok: true,
    presentation: {
      schema: MANAGED_PRESENTATION_SCHEMA,
      constructionId: previousPlan.id,
      planKind: previousPlan.kind,
      writerId: artifact.writerId,
      writerRevision: artifact.writerRevision,
      presentationFingerprint: hashSource(currentTikzBody),
      attachmentsFingerprint: hashSource(JSON.stringify(
        attachments.map((attachment) => ({
          slotId: attachment.slotId,
          siteId: attachment.siteId,
          ordinal: attachment.ordinal,
          raw: attachment.raw,
        })),
      )),
      trailingLineEnding: layout.trailingLineEnding,
      slotSeparator: layout.separator,
      slots: managedSlots,
      attachments,
      opaqueSlots: [],
    },
  };
}

function replacementPatches(
  current: TikzOptionSequence,
  previousCanonical: TikzOptionSequence,
  nextCanonical: TikzOptionSequence,
  canonicalEntryIndexes: readonly number[],
  protectedKeys: ReadonlySet<string>,
): readonly { from: number; to: number; insert: string }[] | null {
  const previousEntries = previousCanonical.entries.filter((entry) => (
    protectedKeys.has(entry.interpretedKey)
  ));
  const nextEntries = nextCanonical.entries.filter((entry) => (
    protectedKeys.has(entry.interpretedKey)
  ));
  if (
    previousEntries.length !== nextEntries.length
    || previousEntries.length !== canonicalEntryIndexes.length
  ) return null;
  const patches: Array<{ from: number; to: number; insert: string }> = [];
  for (let index = 0; index < previousEntries.length; index += 1) {
    const previous = previousEntries[index]!;
    const next = nextEntries[index]!;
    const currentEntry = current.entries[canonicalEntryIndexes[index]!] as TikzOptionEntry | undefined;
    if (
      !currentEntry?.interpretedRange
      || previous.interpretedKey !== next.interpretedKey
      || currentEntry.interpreted !== previous.interpreted
    ) return null;
    if (currentEntry.interpreted !== next.interpreted) {
      patches.push({
        from: currentEntry.interpretedRange.start,
        to: currentEntry.interpretedRange.end,
        insert: next.raw,
      });
    }
  }
  return patches.sort((left, right) => right.from - left.from);
}

function applyOptionPatches(
  raw: string,
  patches: readonly { from: number; to: number; insert: string }[],
): string {
  return patches.reduce(
    (value, patch) => value.slice(0, patch.from) + patch.insert + value.slice(patch.to),
    raw,
  );
}

export function mergeManagedPresentation(
  presentation: ManagedPresentationIR,
  nextPlan: ConstructionPlan,
): ManagedPresentationMergeResult {
  if (
    nextPlan.id !== presentation.constructionId
    || nextPlan.kind !== presentation.planKind
    || !supportsPresentation(nextPlan)
  ) {
    return {
      ok: false,
      issues: [issue(
        'slot-identity-mismatch',
        'plan',
        'The next plan does not retain the presentation owner identity or writer option sites.',
      )],
    };
  }
  const artifact = compileConstructionWriterArtifact(nextPlan);
  if (
    presentation.slots.length !== artifact.slots.length
    || presentation.writerId !== artifact.writerId
    || presentation.writerRevision !== artifact.writerRevision
    || presentation.slots.some((slot, index) => (
      slot.slotId !== artifact.slots[index]?.id
    ))
  ) {
    return {
      ok: false,
      issues: [issue(
        'slot-identity-mismatch',
        'slots',
        'Writer slot identity changed during presentation-aware recompilation.',
      )],
    };
  }
  const mergedSources: string[] = [];
  for (let index = 0; index < artifact.slots.length; index += 1) {
    const priorSlot = presentation.slots[index]!;
    const nextSlot = artifact.slots[index]!;
    const next = parseWriterStatement(nextSlot.canonicalSource);
    if (!next) {
      return { ok: false, issues: [issue(
        'source-shape-mismatch',
        `slots.${nextSlot.id}`,
        'The trusted next writer slot could not be projected to one statement.',
      )] };
    }
    const site = priorSlot.optionSite;
    if (!site) {
      if (priorSlot.source !== priorSlot.sourceWithoutOptions) {
        return { ok: false, issues: [issue(
          'invalid-option-site',
          `slots.${priorSlot.slotId}`,
          'A slot without an option site contains presentation options.',
        )] };
      }
      mergedSources.push(next.source);
      continue;
    }
    const currentSequence = site.sequence;
    const previousCanonical = site.canonicalSequence;
    const nextCanonical = next.sequence;
    let mergedRaw = currentSequence?.raw ?? '';
    if (previousCanonical && previousCanonical.entries.length > 0) {
      if (!currentSequence || !nextCanonical) {
        return { ok: false, issues: [issue(
          'semantic-option-conflict',
          `slots.${priorSlot.slotId}.${site.id}`,
          'Canonical option site disappeared during recompilation.',
        )] };
      }
      const patches = replacementPatches(
        currentSequence,
        previousCanonical,
        nextCanonical,
        site.canonicalEntryIndexes,
        new Set(site.protectedSemanticOptionKeys),
      );
      if (!patches) {
        return { ok: false, issues: [issue(
          'semantic-option-conflict',
          `slots.${priorSlot.slotId}.${site.id}`,
          'Canonical semantic options cannot be merged without touching presentation attachments.',
        )] };
      }
      mergedRaw = applyOptionPatches(currentSequence.raw, patches);
    } else if (nextCanonical && nextCanonical.entries.length > 0) {
      return { ok: false, issues: [issue(
        'semantic-option-conflict',
        `slots.${priorSlot.slotId}.${site.id}`,
        'The next writer introduced canonical options into a presentation-only site.',
      )] };
    }
    let nextSource = next.source;
    if (next.optionRange) {
      nextSource = nextSource.slice(0, next.optionRange.start + 1)
        + mergedRaw
        + nextSource.slice(next.optionRange.end - 1);
    } else if (mergedRaw.length > 0) {
      const offset = commandInsertionOffset(nextSource);
      if (offset === null) {
        return { ok: false, issues: [issue(
          'invalid-option-site',
          `slots.${priorSlot.slotId}.${site.id}`,
          'The trusted writer slot has no command insertion boundary.',
        )] };
      }
      nextSource = `${nextSource.slice(0, offset)}[${mergedRaw}]${nextSource.slice(offset)}`;
    }
    mergedSources.push(nextSource);
  }
  return {
    ok: true,
    tikzBody: mergedSources.join(presentation.slotSeparator)
      + presentation.trailingLineEnding,
  };
}
