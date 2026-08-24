import { hashSource } from '../document/source-hash';
import type { ConstructionWriterArtifact } from '../authoring/construction-ir';
import {
  MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM,
  managedConstructionContentFingerprint,
  parseManagedConstructionBlocks,
  serializeManagedConstructionRecords,
  type ManagedConstructionBlock,
  type ManagedConstructionSemanticRecord,
} from './managed-construction';

export const MANAGED_CONSTRUCTION_V3_ENVELOPE_SCHEMA =
  'managed-construction-v3-envelope/v1' as const;

export type ManagedConstructionV3IssueCode =
  | 'not-schema-v3'
  | 'invalid-header'
  | 'header-identity-mismatch'
  | 'invalid-writer-revision'
  | 'invalid-fingerprint'
  | 'slot-limit-exceeded'
  | 'nested-slot'
  | 'orphan-slot-end'
  | 'missing-slot-end'
  | 'slot-id-mismatch'
  | 'duplicate-slot-id'
  | 'invalid-slot-marker'
  | 'overlapping-slot-marker'
  | 'slot-count-mismatch'
  | 'slot-fingerprint-mismatch'
  | 'opaque-source-outside-slot'
  | 'invalid-envelope'
  | 'writer-artifact-mismatch';

export interface ManagedConstructionV3Issue {
  readonly code: ManagedConstructionV3IssueCode;
  readonly message: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly slotId?: string;
}

export interface ManagedConstructionV3Slot {
  readonly id: string;
  readonly role: string;
  readonly writerRevision: number;
  readonly semanticFingerprint: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly beginMarkerRange: { readonly start: number; readonly end: number };
  readonly sourceRange: { readonly start: number; readonly end: number };
  readonly endMarkerRange: { readonly start: number; readonly end: number };
}

export interface ManagedConstructionV3Envelope {
  readonly schema: typeof MANAGED_CONSTRUCTION_V3_ENVELOPE_SCHEMA;
  readonly constructionId: string;
  readonly sourceRange: { readonly start: number; readonly end: number };
  readonly headerRange: { readonly start: number; readonly end: number };
  readonly writerId: string;
  readonly writerRevision: number;
  readonly planFingerprint: string;
  readonly slotsFingerprint: string;
  readonly envelopeFingerprint: string;
  readonly slots: readonly ManagedConstructionV3Slot[];
  /** Exact unowned source ranges. They are preserved but make v3 read-only. */
  readonly opaqueRanges: readonly { readonly start: number; readonly end: number }[];
  /** Syntax-only result. Writer ownership still requires artifact validation. */
  readonly syntacticallyValid: boolean;
  /** Reader-only milestone: no caller may treat this as a write capability yet. */
  readonly writable: false;
  readonly issues: readonly ManagedConstructionV3Issue[];
}

export interface ManagedConstructionV3ArtifactValidation {
  readonly schema: 'managed-construction-v3-artifact-validation/v1';
  readonly envelopeFingerprint: string;
  readonly artifactFingerprint: string;
  readonly artifactMatched: boolean;
  /** Artifact identity is necessary but not sufficient for a write capability. */
  readonly writable: false;
  readonly issues: readonly ManagedConstructionV3Issue[];
}

export interface ManagedConstructionV3SerializationInput {
  readonly id: string;
  readonly kind: string;
  readonly planKind: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly records: readonly ManagedConstructionSemanticRecord[];
  readonly artifact: ConstructionWriterArtifact;
  /** Must be in the exact same order as artifact.slots. */
  readonly slotSources: readonly {
    readonly id: string;
    readonly source: string;
  }[];
  readonly lineEnding?: '\n' | '\r\n';
}

export interface ManagedConstructionV3WriteResult {
  readonly schema: 'managed-construction-v3-write/v1';
  readonly source: string;
  readonly block: ManagedConstructionBlock;
  readonly envelope: ManagedConstructionV3Envelope;
  readonly artifactValidation: ManagedConstructionV3ArtifactValidation;
  /** Granted only by the trusted writer after a complete self-validation pass. */
  readonly writable: true;
}

export class ManagedConstructionV3WriteError extends Error {
  readonly issues: readonly ManagedConstructionV3Issue[];

  constructor(
    message: string,
    issues: readonly ManagedConstructionV3Issue[] = [],
  ) {
    super(message);
    this.name = 'ManagedConstructionV3WriteError';
    this.issues = issues;
  }
}

type SlotFingerprintInput = Pick<
  ManagedConstructionV3Slot,
  'id' | 'role' | 'writerRevision' | 'semanticFingerprint'
>;

const HEADER =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+begin(?<attributes>[^\r\n]*)(?:\r?\n|$)$/u;
const SLOT_BEGIN =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+slot-begin(?<attributes>[^\r\n]*)(?:\r?\n|$)/gmu;
const SLOT_END =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+slot-end(?<attributes>[^\r\n]*)(?:\r?\n|$)/gmu;
const ATTRIBUTE = /[ \t]+(?<key>[a-z][a-z0-9-]*)=(?<value>[^ \t\r\n]*)/iyu;
const FINGERPRINT = /^[0-9a-f]{16}$/u;
const MAX_SLOTS = 256;
const MAX_MARKER_EVENTS = MAX_SLOTS * 2;
const WRITER_ID = /^[A-Za-z0-9][A-Za-z0-9./:_-]{0,127}$/u;
const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/u;
const SLOT_ROLE = /^[a-z][a-z0-9-]{0,127}$/u;
const HEADER_NAME = /^[A-Za-z_][A-Za-z0-9:_-]*$/u;
const HEADER_REFERENCE = /^(?:[A-Za-z_][A-Za-z0-9:_-]*|managed:[A-Za-z0-9:_.%-]+)$/u;
const RESERVED_MANAGED_LINE =
  /^[ \t]*%[ \t]*@mathgeo(?:[ \t]|$)/mu;
const CONTENT_FINGERPRINT_FIELD = /content-fingerprint=[0-9a-f]{16}/u;

const HEADER_ATTRIBUTES = new Set([
  'schema',
  'fingerprint-alg',
  'content-fingerprint',
  'id',
  'kind',
  'plan-kind',
  'inputs',
  'outputs',
  'writer-id',
  'writer-revision',
  'plan-fingerprint',
  'slots-fingerprint',
  'slot-count',
]);
const SLOT_BEGIN_ATTRIBUTES = new Set([
  'id',
  'role',
  'writer-revision',
  'semantic-fingerprint',
]);
const SLOT_END_ATTRIBUTES = new Set(['id']);

interface ParsedAttributes {
  readonly values: ReadonlyMap<string, string>;
  readonly valid: boolean;
}

function attributesOf(
  raw: string,
  allowed: ReadonlySet<string>,
): ParsedAttributes {
  const attributes = new Map<string, string>();
  let valid = true;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while (cursor < raw.length) {
    ATTRIBUTE.lastIndex = cursor;
    match = ATTRIBUTE.exec(raw);
    if (!match || match.index !== cursor) {
      valid = false;
      break;
    }
    const key = match.groups?.key?.toLowerCase();
    const value = match.groups?.value;
    if (!key || value === undefined || !allowed.has(key) || attributes.has(key)) {
      valid = false;
    } else {
      attributes.set(key, value);
    }
    cursor = ATTRIBUTE.lastIndex;
  }
  return { values: attributes, valid: valid && cursor === raw.length };
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function issue(
  code: ManagedConstructionV3IssueCode,
  message: string,
  range: { readonly start: number; readonly end: number },
  slotId?: string,
): ManagedConstructionV3Issue {
  return { code, message, range, ...(slotId ? { slotId } : {}) };
}

export function managedWriterSlotEnvelopeFingerprint(
  slots: readonly SlotFingerprintInput[],
): string {
  return hashSource(JSON.stringify({
    domain: 'mathgeo/managed-writer-slot-envelope/v1',
    slots: slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      writerRevision: slot.writerRevision,
      semanticFingerprint: slot.semanticFingerprint,
    })),
  }));
}

interface MarkerEvent {
  readonly kind: 'begin' | 'end';
  readonly start: number;
  readonly end: number;
  readonly attributes: ReadonlyMap<string, string>;
  readonly attributesValid: boolean;
}

function markerEvents(
  source: string,
  range: { readonly start: number; readonly end: number },
): { readonly events: readonly MarkerEvent[]; readonly limitExceeded: boolean } {
  const events: MarkerEvent[] = [];
  let limitExceeded = false;
  for (const [kind, pattern] of [
    ['begin', SLOT_BEGIN],
    ['end', SLOT_END],
  ] as const) {
    pattern.lastIndex = range.start;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      if (match.index >= range.end) break;
      const end = match.index + match[0].length;
      if (end > range.end) break;
      if (events.length >= MAX_MARKER_EVENTS) {
        limitExceeded = true;
        break;
      }
      const parsedAttributes = attributesOf(
        match.groups?.attributes ?? '',
        kind === 'begin' ? SLOT_BEGIN_ATTRIBUTES : SLOT_END_ATTRIBUTES,
      );
      events.push({
        kind,
        start: match.index,
        end,
        attributes: parsedAttributes.values,
        attributesValid: parsedAttributes.valid,
      });
    }
  }
  return {
    events: events.sort((left, right) => left.start - right.start || left.end - right.end),
    limitExceeded,
  };
}

/**
 * Parse and validate persistent schema-v3 slot markers without enabling v3
 * writes. v1/v2 parsing remains untouched; malformed v3 stays exact and
 * read-only rather than falling back to v2 semantics.
 */
export function readManagedConstructionV3Envelope(
  source: string,
  block: ManagedConstructionBlock,
): ManagedConstructionV3Envelope {
  const issues: ManagedConstructionV3Issue[] = [];
  const headerText = source.slice(block.headerRange.start, block.headerRange.end);
  const headerMatch = HEADER.exec(headerText);
  const parsedHeader = attributesOf(
    headerMatch?.groups?.attributes ?? '',
    HEADER_ATTRIBUTES,
  );
  const header = parsedHeader.values;
  const writerId = header.get('writer-id') ?? '';
  const writerRevision = positiveInteger(header.get('writer-revision'));
  const planFingerprint = header.get('plan-fingerprint') ?? '';
  const slotsFingerprint = header.get('slots-fingerprint') ?? '';
  const expectedSlotCount = positiveInteger(header.get('slot-count'));

  if (block.schemaVersion !== 3) {
    issues.push(issue(
      'not-schema-v3',
      `Expected schema-v3 block, found ${String(block.schemaVersion)}.`,
      block.headerRange,
    ));
  }
  if (
    !headerMatch
    || !parsedHeader.valid
    || !WRITER_ID.test(writerId)
    || expectedSlotCount === null
  ) {
    issues.push(issue(
      'invalid-header',
      'Schema-v3 requires a strict header, a bounded writer-id and a positive slot-count.',
      block.headerRange,
    ));
  }
  const headerIdentityMatches = (
    header.get('schema') === '3'
    && header.get('fingerprint-alg')
      === MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM
    && header.get('content-fingerprint') === block.contentFingerprint
    && block.contentFingerprint === block.actualContentFingerprint
    && header.get('id') === block.id
    && header.get('kind') === block.kind
    && header.get('plan-kind') === block.planKind
    && header.get('inputs') === block.inputs.join(',')
    && header.get('outputs') === block.outputs.join(',')
  );
  if (!headerIdentityMatches) {
    issues.push(issue(
      'header-identity-mismatch',
      'Schema-v3 header identity does not match the parsed, attached managed block.',
      block.headerRange,
    ));
  }
  if (block.metadataStatus !== 'valid' || block.integrityStatus !== 'valid') {
    issues.push(issue(
      'invalid-envelope',
      'Schema-v3 envelope requires valid semantic metadata and attached content integrity.',
      block.range,
    ));
  }
  if (writerRevision === null) {
    issues.push(issue(
      'invalid-writer-revision',
      'Schema-v3 requires a positive safe-integer writer-revision.',
      block.headerRange,
    ));
  }
  if (!FINGERPRINT.test(planFingerprint) || !FINGERPRINT.test(slotsFingerprint)) {
    issues.push(issue(
      'invalid-fingerprint',
      'Schema-v3 plan-fingerprint and slots-fingerprint must be 16 lowercase hex characters.',
      block.headerRange,
    ));
  }

  const markerScan = markerEvents(source, block.tikzBodyRange);
  const events = markerScan.events;
  if (markerScan.limitExceeded) {
    issues.push(issue(
      'slot-limit-exceeded',
      `Schema-v3 contains more than ${MAX_MARKER_EVENTS} slot marker events.`,
      block.tikzBodyRange,
    ));
  }
  const slots: ManagedConstructionV3Slot[] = [];
  const ids = new Set<string>();
  let open: MarkerEvent | null = null;
  let previousEvent: MarkerEvent | null = null;
  for (const event of events) {
    if (previousEvent && event.start < previousEvent.end) {
      issues.push(issue(
        'overlapping-slot-marker',
        'Writer slot marker lines must not overlap.',
        { start: event.start, end: Math.max(event.end, previousEvent.end) },
      ));
      previousEvent = event;
      continue;
    }
    previousEvent = event;
    if (event.kind === 'begin') {
      if (open) {
        issues.push(issue(
          'nested-slot',
          'Writer slot markers must be non-nested.',
          { start: open.start, end: event.end },
          open.attributes.get('id'),
        ));
        continue;
      }
      open = event;
      continue;
    }
    if (!open) {
      issues.push(issue(
        'orphan-slot-end',
        'Writer slot end marker has no matching begin marker.',
        { start: event.start, end: event.end },
        event.attributes.get('id'),
      ));
      continue;
    }
    const id = open.attributes.get('id') ?? '';
    const endId = event.attributes.get('id') ?? '';
    const role = open.attributes.get('role') ?? '';
    const slotRevision = positiveInteger(open.attributes.get('writer-revision'));
    const semanticFingerprint = open.attributes.get('semantic-fingerprint') ?? '';
    if (
      !open.attributesValid
      || !SLOT_ID.test(id)
      || !SLOT_ROLE.test(role)
      || slotRevision === null
      || !FINGERPRINT.test(semanticFingerprint)
    ) {
      issues.push(issue(
        'invalid-slot-marker',
        'Slot begin requires only valid id, role, writer-revision and semantic-fingerprint attributes.',
        { start: open.start, end: open.end },
        id || undefined,
      ));
    } else if (!event.attributesValid || !SLOT_ID.test(endId)) {
      issues.push(issue(
        'invalid-slot-marker',
        'Slot end requires exactly one valid id attribute.',
        { start: event.start, end: event.end },
        endId || undefined,
      ));
    } else if (id !== endId) {
      issues.push(issue(
        'slot-id-mismatch',
        `Slot begin ${id} closes with ${endId || '<missing>'}.`,
        { start: open.start, end: event.end },
        id,
      ));
    } else if (ids.has(id)) {
      issues.push(issue(
        'duplicate-slot-id',
        `Writer slot ID ${id} is duplicated.`,
        { start: open.start, end: event.end },
        id,
      ));
    } else {
      ids.add(id);
      if (writerRevision !== null && slotRevision !== writerRevision) {
        issues.push(issue(
          'invalid-writer-revision',
          `Slot ${id} revision ${slotRevision} does not match writer revision ${writerRevision}.`,
          { start: open.start, end: open.end },
          id,
        ));
      }
      slots.push({
        id,
        role,
        writerRevision: slotRevision,
        semanticFingerprint,
        range: { start: open.start, end: event.end },
        beginMarkerRange: { start: open.start, end: open.end },
        sourceRange: { start: open.end, end: event.start },
        endMarkerRange: { start: event.start, end: event.end },
      });
    }
    open = null;
  }
  if (open) {
    issues.push(issue(
      'missing-slot-end',
      'Writer slot begin marker has no matching end marker.',
      { start: open.start, end: block.tikzBodyRange.end },
      open.attributes.get('id'),
    ));
  }
  if (slots.length > MAX_SLOTS) {
    issues.push(issue(
      'slot-limit-exceeded',
      `Schema-v3 slot count exceeds ${MAX_SLOTS}.`,
      block.tikzBodyRange,
    ));
  }
  if (expectedSlotCount !== null && slots.length !== expectedSlotCount) {
    issues.push(issue(
      'slot-count-mismatch',
      `Header declares ${expectedSlotCount} slots, parsed ${slots.length}.`,
      block.headerRange,
    ));
  }
  if (
    FINGERPRINT.test(slotsFingerprint)
    && managedWriterSlotEnvelopeFingerprint(slots) !== slotsFingerprint
  ) {
    issues.push(issue(
      'slot-fingerprint-mismatch',
      'Ordered writer slot envelope fingerprint does not match the header.',
      block.headerRange,
    ));
  }

  const opaqueRanges: Array<{ start: number; end: number }> = [];
  let cursor = block.tikzBodyRange.start;
  for (const slot of [...slots].sort((left, right) => left.range.start - right.range.start)) {
    if (slot.range.start > cursor) {
      const raw = source.slice(cursor, slot.range.start);
      if (raw.trim().length > 0) {
        opaqueRanges.push({ start: cursor, end: slot.range.start });
      }
    }
    cursor = Math.max(cursor, slot.range.end);
  }
  if (cursor < block.tikzBodyRange.end) {
    const raw = source.slice(cursor, block.tikzBodyRange.end);
    if (raw.trim().length > 0) {
      opaqueRanges.push({ start: cursor, end: block.tikzBodyRange.end });
    }
  }
  opaqueRanges.forEach((range) => issues.push(issue(
    'opaque-source-outside-slot',
    'Source outside persistent writer slots is preserved as opaque and keeps this envelope read-only.',
    range,
  )));

  return {
    schema: MANAGED_CONSTRUCTION_V3_ENVELOPE_SCHEMA,
    constructionId: block.id,
    sourceRange: { ...block.range },
    headerRange: { ...block.headerRange },
    writerId,
    writerRevision: writerRevision ?? 0,
    planFingerprint,
    slotsFingerprint,
    envelopeFingerprint: hashSource(source.slice(block.range.start, block.range.end)),
    slots,
    opaqueRanges,
    syntacticallyValid: issues.length === 0,
    writable: false,
    issues,
  };
}

/**
 * Bind a syntax-valid envelope to a trusted in-process writer artifact.
 * This deliberately remains an attestation-only result until a v3 merge/write
 * coordinator proves presentation conservation and reparsed equivalence.
 */
export function validateManagedConstructionV3Artifact(
  envelope: ManagedConstructionV3Envelope,
  artifact: ConstructionWriterArtifact,
): ManagedConstructionV3ArtifactValidation {
  const issues: ManagedConstructionV3Issue[] = [];
  if (!envelope.syntacticallyValid) {
    issues.push(issue(
      'invalid-envelope',
      'Writer artifact cannot authorize a syntactically invalid v3 envelope.',
      envelope.sourceRange,
    ));
  }

  const expectedSlots = artifact.slots.map((slot) => ({
    id: slot.id,
    role: slot.role,
    writerRevision: artifact.writerRevision,
    semanticFingerprint: slot.semanticFingerprint,
  }));
  const sameSlots = (
    envelope.slots.length === expectedSlots.length
    && envelope.slots.every((slot, index) => {
      const expected = expectedSlots[index];
      return Boolean(expected)
        && slot.id === expected!.id
        && slot.role === expected!.role
        && slot.writerRevision === expected!.writerRevision
        && slot.semanticFingerprint === expected!.semanticFingerprint;
    })
  );
  const artifactMatched = (
    envelope.syntacticallyValid
    && envelope.writerId === artifact.writerId
    && envelope.writerRevision === artifact.writerRevision
    && envelope.planFingerprint === artifact.semanticFingerprint
    && envelope.slotsFingerprint
      === managedWriterSlotEnvelopeFingerprint(expectedSlots)
    && sameSlots
  );
  if (!artifactMatched) {
    issues.push(issue(
      'writer-artifact-mismatch',
      'Envelope writer, plan, ordered slot roles or semantic fingerprints do not match the trusted artifact.',
      envelope.headerRange,
    ));
  }

  return {
    schema: 'managed-construction-v3-artifact-validation/v1',
    envelopeFingerprint: envelope.envelopeFingerprint,
    artifactFingerprint: artifact.semanticFingerprint,
    artifactMatched,
    writable: false,
    issues,
  };
}

function normalizedContentFingerprintHeader(value: string): string {
  return value.replace(
    CONTENT_FINGERPRINT_FIELD,
    'content-fingerprint=<managed-v3-content>',
  );
}

/**
 * Compare two exact, standalone v3 blocks while treating only persistent slot
 * source bytes and the derived content fingerprint as replaceable. Metadata,
 * marker bytes/order, writer identity and every byte outside slots must match.
 */
export function managedConstructionV3OutsideSlotsMatches(
  currentSource: string,
  current: ManagedConstructionV3Envelope,
  canonicalSource: string,
  canonical: ManagedConstructionV3Envelope,
): boolean {
  if (
    current.sourceRange.start !== 0
    || current.sourceRange.end !== currentSource.length
    || canonical.sourceRange.start !== 0
    || canonical.sourceRange.end !== canonicalSource.length
    || !current.syntacticallyValid
    || !canonical.syntacticallyValid
    || current.opaqueRanges.length !== 0
    || canonical.opaqueRanges.length !== 0
    || current.slots.length !== canonical.slots.length
    || current.constructionId !== canonical.constructionId
    || current.writerId !== canonical.writerId
    || current.writerRevision !== canonical.writerRevision
    || current.planFingerprint !== canonical.planFingerprint
    || current.slotsFingerprint !== canonical.slotsFingerprint
  ) return false;

  const currentHeader = currentSource.slice(
    current.headerRange.start,
    current.headerRange.end,
  );
  const canonicalHeader = canonicalSource.slice(
    canonical.headerRange.start,
    canonical.headerRange.end,
  );
  if (
    normalizedContentFingerprintHeader(currentHeader)
    !== normalizedContentFingerprintHeader(canonicalHeader)
  ) return false;

  let currentCursor = current.headerRange.end;
  let canonicalCursor = canonical.headerRange.end;
  for (let index = 0; index < current.slots.length; index += 1) {
    const currentSlot = current.slots[index]!;
    const canonicalSlot = canonical.slots[index]!;
    if (
      currentSlot.id !== canonicalSlot.id
      || currentSlot.role !== canonicalSlot.role
      || currentSlot.writerRevision !== canonicalSlot.writerRevision
      || currentSlot.semanticFingerprint !== canonicalSlot.semanticFingerprint
      || currentSource.slice(currentCursor, currentSlot.sourceRange.start)
        !== canonicalSource.slice(canonicalCursor, canonicalSlot.sourceRange.start)
    ) return false;
    currentCursor = currentSlot.sourceRange.end;
    canonicalCursor = canonicalSlot.sourceRange.end;
  }
  return currentSource.slice(currentCursor)
    === canonicalSource.slice(canonicalCursor);
}

function assertHeaderName(value: string, field: string): void {
  if (!HEADER_NAME.test(value)) {
    throw new TypeError(`Schema-v3 ${field} is not a safe header name.`);
  }
}

function assertHeaderReferences(
  values: readonly string[],
  field: string,
): void {
  if (!values.every((value) => HEADER_REFERENCE.test(value))) {
    throw new TypeError(`Schema-v3 ${field} contains an unsafe reference.`);
  }
}

/**
 * Serialize schema-v3 bytes for migration and trusted writer tooling. Callers
 * do not gain write authority from serialization alone; production creation
 * routes through writeManagedConstructionV3Block and the narrow v3 policy.
 */
export function serializeManagedConstructionV3Block(
  input: ManagedConstructionV3SerializationInput,
): string {
  const lineEnding = input.lineEnding ?? '\n';
  if (lineEnding !== '\n' && lineEnding !== '\r\n') {
    throw new TypeError('Schema-v3 lineEnding must be LF or CRLF.');
  }
  assertHeaderName(input.id, 'id');
  assertHeaderName(input.kind, 'kind');
  assertHeaderName(input.planKind, 'plan-kind');
  assertHeaderReferences(input.inputs, 'inputs');
  assertHeaderReferences(input.outputs, 'outputs');
  if (!WRITER_ID.test(input.artifact.writerId)) {
    throw new TypeError('Schema-v3 writer-id is invalid.');
  }
  if (!FINGERPRINT.test(input.artifact.semanticFingerprint)) {
    throw new TypeError('Schema-v3 artifact fingerprint is invalid.');
  }
  if (input.artifact.planKind !== input.planKind) {
    throw new TypeError('Schema-v3 plan-kind does not match the writer artifact.');
  }
  if (
    !Number.isSafeInteger(input.artifact.writerRevision)
    || input.artifact.writerRevision < 1
  ) {
    throw new TypeError('Schema-v3 writer revision is invalid.');
  }
  if (
    input.artifact.slots.length === 0
    || input.artifact.slots.length > MAX_SLOTS
    || input.slotSources.length !== input.artifact.slots.length
  ) {
    throw new RangeError('Schema-v3 requires one source for every bounded writer slot.');
  }

  const slotIds = new Set<string>();
  const slotFingerprintInputs = input.artifact.slots.map((slot, index) => {
    const source = input.slotSources[index];
    if (
      !source
      || source.id !== slot.id
      || slotIds.has(slot.id)
      || !SLOT_ID.test(slot.id)
      || !SLOT_ROLE.test(slot.role)
      || !FINGERPRINT.test(slot.semanticFingerprint)
    ) {
      throw new TypeError('Schema-v3 slot sources must exactly match the ordered writer artifact.');
    }
    slotIds.add(slot.id);
    if (RESERVED_MANAGED_LINE.test(source.source)) {
      throw new TypeError(`Schema-v3 slot ${slot.id} contains a reserved @mathgeo marker line.`);
    }
    return {
      id: slot.id,
      role: slot.role,
      writerRevision: input.artifact.writerRevision,
      semanticFingerprint: slot.semanticFingerprint,
    };
  });
  const slotsFingerprint = managedWriterSlotEnvelopeFingerprint(slotFingerprintInputs);
  const recordLines = serializeManagedConstructionRecords(input.records);
  const metadataText = recordLines.length > 0
    ? `${recordLines.join(lineEnding)}${lineEnding}`
    : '';
  const bodyParts = input.artifact.slots.flatMap((slot, index) => {
    const slotSource = input.slotSources[index]!.source;
    const sourceWithEnding = slotSource.endsWith('\n')
      ? slotSource
      : `${slotSource}${lineEnding}`;
    return [
      `% @mathgeo slot-begin id=${slot.id} role=${slot.role} writer-revision=${input.artifact.writerRevision} semantic-fingerprint=${slot.semanticFingerprint}${lineEnding}`,
      sourceWithEnding,
      `% @mathgeo slot-end id=${slot.id}${lineEnding}`,
    ];
  });
  const tikzBodyText = bodyParts.join('');
  const contentFingerprint = managedConstructionContentFingerprint({
    id: input.id,
    kind: input.kind,
    planKind: input.planKind,
    inputs: input.inputs,
    outputs: input.outputs,
    metadataText,
    tikzBodyText,
  });
  const header = [
    '% @mathgeo begin',
    'schema=3',
    `fingerprint-alg=${MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM}`,
    `content-fingerprint=${contentFingerprint}`,
    `id=${input.id}`,
    `kind=${input.kind}`,
    `plan-kind=${input.planKind}`,
    `inputs=${input.inputs.join(',')}`,
    `outputs=${input.outputs.join(',')}`,
    `writer-id=${input.artifact.writerId}`,
    `writer-revision=${input.artifact.writerRevision}`,
    `plan-fingerprint=${input.artifact.semanticFingerprint}`,
    `slots-fingerprint=${slotsFingerprint}`,
    `slot-count=${input.artifact.slots.length}`,
  ].join(' ');
  return `${header}${lineEnding}${metadataText}${tikzBodyText}% @mathgeo end${lineEnding}`;
}

/**
 * Serialize one trusted schema-v3 writer artifact and prove that the emitted
 * block can be recovered as the same attached envelope. Reader results remain
 * read-only; this is the only helper in this module that grants a write
 * capability, and only for the exact returned source bytes.
 */
export function writeManagedConstructionV3Block(
  input: ManagedConstructionV3SerializationInput,
): ManagedConstructionV3WriteResult {
  const source = serializeManagedConstructionV3Block(input);
  const blocks = parseManagedConstructionBlocks(source);
  const block = blocks[0];
  if (
    blocks.length !== 1
    || !block
    || block.range.start !== 0
    || block.range.end !== source.length
    || block.schemaVersion !== 3
    || block.id !== input.id
    || block.kind !== input.kind
    || block.planKind !== input.planKind
    || block.metadataStatus !== 'valid'
    || block.integrityStatus !== 'valid'
  ) {
    throw new ManagedConstructionV3WriteError(
      'Schema-v3 writer did not produce one complete attached managed block.',
    );
  }
  const envelope = readManagedConstructionV3Envelope(source, block);
  const artifactValidation = validateManagedConstructionV3Artifact(
    envelope,
    input.artifact,
  );
  if (
    !envelope.syntacticallyValid
    || envelope.opaqueRanges.length !== 0
    || !artifactValidation.artifactMatched
  ) {
    throw new ManagedConstructionV3WriteError(
      'Schema-v3 writer output failed envelope or artifact self-validation.',
      [...envelope.issues, ...artifactValidation.issues],
    );
  }
  return {
    schema: 'managed-construction-v3-write/v1',
    source,
    block,
    envelope,
    artifactValidation,
    writable: true,
  };
}
