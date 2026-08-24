import { describe, expect, it } from 'vitest';
import type { ConstructionWriterArtifact } from '../authoring/construction-ir';
import { parseManagedConstructionBlocks } from './managed-construction';
import {
  managedWriterSlotEnvelopeFingerprint,
  readManagedConstructionV3Envelope,
  serializeManagedConstructionV3Block,
  validateManagedConstructionV3Artifact,
  writeManagedConstructionV3Block,
} from './managed-construction-v3';

const SLOT = {
  id: 'construction:segment-1:primitive:primitive-segment-render',
  role: 'primitive-segment-render',
  writerRevision: 1,
  semanticFingerprint: '0123456789abcdef',
} as const;

const ARTIFACT = {
  writerId: 'mathgeo/tikz-construction-writer',
  writerRevision: 1,
  planKind: 'primitive',
  semanticFingerprint: '1111111111111111',
  referenceSurface: ['A', 'B'],
  slots: [{
    ...SLOT,
    kind: 'tikz-statement',
    owners: ['entity:A', 'entity:B'],
    canonicalSource: '\\draw (A) -- (B);',
    optionSites: [{ id: 'command-options', insertionPolicy: 'command-options' }],
  }],
} as const satisfies ConstructionWriterArtifact;

const RECORDS = [
  { recordType: 'input', id: 'input:A', role: 'start', ref: 'A' },
  { recordType: 'input', id: 'input:B', role: 'end', ref: 'B' },
  {
    recordType: 'entity',
    id: 'entity:AB',
    kind: 'segment',
    name: 'AB',
    from: 'A',
    to: 'B',
  },
  {
    recordType: 'output',
    id: 'output:AB',
    role: 'segment',
    ref: 'AB',
    kind: 'segment',
  },
] as const;

function reseal(source: string): string {
  const block = parseManagedConstructionBlocks(source)[0];
  expect(block).toBeDefined();
  return source.replace(
    /content-fingerprint=[0-9a-f]{16}/u,
    `content-fingerprint=${block!.actualContentFingerprint}`,
  );
}

function v3Source(options: {
  readonly slotFingerprint?: string;
  readonly beginAttributes?: string;
  readonly endAttributes?: string;
  readonly beforeSlot?: string;
  readonly body?: string;
  readonly afterSlot?: string;
} = {}): string {
  const defaultBody = '\\draw (A) -- (B); % UTF-16 几何';
  let source = serializeManagedConstructionV3Block({
    id: 'segment-1',
    kind: 'segment',
    planKind: 'primitive',
    inputs: ['A', 'B'],
    outputs: ['AB'],
    records: RECORDS,
    artifact: ARTIFACT,
    slotSources: [{ id: SLOT.id, source: defaultBody }],
  });
  const beginAttributes = options.beginAttributes
    ?? `id=${SLOT.id} role=${SLOT.role} writer-revision=1 semantic-fingerprint=${SLOT.semanticFingerprint}`;
  const endAttributes = options.endAttributes ?? `id=${SLOT.id}`;
  source = source
    .replace(
      /% @mathgeo slot-begin [^\r\n]+/u,
      `% @mathgeo slot-begin ${beginAttributes}`,
    )
    .replace(
      /% @mathgeo slot-end [^\r\n]+/u,
      `% @mathgeo slot-end ${endAttributes}`,
    )
    .replace(defaultBody, options.body ?? defaultBody);
  if (options.slotFingerprint) {
    source = source.replace(
      /slots-fingerprint=[0-9a-f]{16}/u,
      `slots-fingerprint=${options.slotFingerprint}`,
    );
  }
  if (options.beforeSlot) {
    source = source.replace(
      /% @mathgeo slot-begin/u,
      `${options.beforeSlot}\n% @mathgeo slot-begin`,
    );
  }
  if (options.afterSlot) {
    source = source.replace(
      /(% @mathgeo slot-end[^\r\n]*(?:\r?\n|$))/u,
      `$1${options.afterSlot}\n`,
    );
  }
  return reseal(source);
}

function read(source: string) {
  const block = parseManagedConstructionBlocks(source)[0];
  expect(block).toBeDefined();
  return readManagedConstructionV3Envelope(source, block!);
}

describe('managed construction schema-v3 writer envelope', () => {
  it('recovers an exact UTF-16 writer slot but reader alone grants no write capability', () => {
    const source = v3Source();
    const envelope = read(source);

    expect(envelope).toMatchObject({
      constructionId: 'segment-1',
      writerId: 'mathgeo/tikz-construction-writer',
      writerRevision: 1,
      syntacticallyValid: true,
      writable: false,
      issues: [],
    });
    expect(envelope.slots).toHaveLength(1);
    const slot = envelope.slots[0]!;
    expect(source.slice(slot.sourceRange.start, slot.sourceRange.end))
      .toBe('\\draw (A) -- (B); % UTF-16 几何\n');
    expect(validateManagedConstructionV3Artifact(envelope, ARTIFACT))
      .toMatchObject({ artifactMatched: true, writable: false, issues: [] });
  });

  it('round-trips the serializer through syntax and artifact attestation', () => {
    const source = serializeManagedConstructionV3Block({
      id: 'segment-1',
      kind: 'segment',
      planKind: 'primitive',
      inputs: ['A', 'B'],
      outputs: ['AB'],
      records: RECORDS,
      artifact: ARTIFACT,
      slotSources: [{ id: SLOT.id, source: '\\draw[red] (A) -- (B);' }],
      lineEnding: '\r\n',
    });
    const envelope = read(source);
    const validation = validateManagedConstructionV3Artifact(envelope, ARTIFACT);

    expect(envelope.syntacticallyValid).toBe(true);
    expect(envelope.opaqueRanges).toEqual([]);
    expect(source.slice(
      envelope.slots[0]!.sourceRange.start,
      envelope.slots[0]!.sourceRange.end,
    )).toBe('\\draw[red] (A) -- (B);\r\n');
    expect(validation).toMatchObject({ artifactMatched: true, writable: false });
  });

  it('grants write capability only after writer self-validation', () => {
    const result = writeManagedConstructionV3Block({
      id: 'segment-1',
      kind: 'segment',
      planKind: 'primitive',
      inputs: ['A', 'B'],
      outputs: ['AB'],
      records: RECORDS,
      artifact: ARTIFACT,
      slotSources: [{ id: SLOT.id, source: '\\draw[red] (A) -- (B);' }],
    });

    expect(result.writable).toBe(true);
    expect(result.envelope.syntacticallyValid).toBe(true);
    expect(result.artifactValidation.artifactMatched).toBe(true);
    expect(result.block.schemaVersion).toBe(3);
  });

  it('binds the header to the exact parsed block identity', () => {
    const source = v3Source();
    const block = parseManagedConstructionBlocks(source)[0]!;
    const envelope = readManagedConstructionV3Envelope(source, {
      ...block,
      id: 'different-construction',
    });

    expect(envelope.syntacticallyValid).toBe(false);
    expect(envelope.issues.some((candidate) => (
      candidate.code === 'header-identity-mismatch'
    ))).toBe(true);
  });

  it('refuses serializer inputs that cannot round-trip through the strict reader', () => {
    const duplicateArtifact = {
      ...ARTIFACT,
      slots: [ARTIFACT.slots[0]!, ARTIFACT.slots[0]!],
    } as ConstructionWriterArtifact;
    const base = {
      id: 'segment-1',
      kind: 'segment',
      planKind: 'primitive',
      inputs: ['A', 'B'],
      outputs: ['AB'],
      records: RECORDS,
    };

    expect(() => serializeManagedConstructionV3Block({
      ...base,
      artifact: duplicateArtifact,
      slotSources: [
        { id: SLOT.id, source: '\\draw (A) -- (B);' },
        { id: SLOT.id, source: '\\draw (A) -- (B);' },
      ],
    })).toThrow(/ordered writer artifact/u);
    expect(() => serializeManagedConstructionV3Block({
      ...base,
      artifact: ARTIFACT,
      slotSources: [{ id: SLOT.id, source: '\\draw (A) -- (B);' }],
      lineEnding: '\n% injected' as '\n',
    })).toThrow(/lineEnding/u);
  });

  it('rejects duplicate, unknown and malformed marker attributes', () => {
    const duplicate = read(v3Source({
      beginAttributes: `id=${SLOT.id} role=${SLOT.role} role=other writer-revision=1 semantic-fingerprint=${SLOT.semanticFingerprint}`,
    }));
    const unknown = read(v3Source({
      endAttributes: `id=${SLOT.id} unexpected=true`,
    }));
    const malformed = read(v3Source({
      beginAttributes: `id=${SLOT.id} role=${SLOT.role} junk writer-revision=1 semantic-fingerprint=${SLOT.semanticFingerprint}`,
    }));

    for (const envelope of [duplicate, unknown, malformed]) {
      expect(envelope.syntacticallyValid).toBe(false);
      expect(envelope.issues.some((candidate) => (
        candidate.code === 'invalid-slot-marker'
      ))).toBe(true);
      expect(envelope.writable).toBe(false);
    }
  });

  it('rejects nested slots and mismatched ordered slot fingerprints', () => {
    const nestedBegin = '% @mathgeo slot-begin id=nested role=nested-role writer-revision=1 semantic-fingerprint=2222222222222222';
    const nested = read(v3Source({
      body: `${nestedBegin}\n\\draw (A) -- (B);\n% @mathgeo slot-end id=nested`,
    }));
    const mismatched = read(v3Source({
      slotFingerprint: 'ffffffffffffffff',
    }));

    expect(nested.syntacticallyValid).toBe(false);
    expect(nested.issues.some((candidate) => candidate.code === 'nested-slot'))
      .toBe(true);
    expect(mismatched.syntacticallyValid).toBe(false);
    expect(mismatched.issues.some((candidate) => (
      candidate.code === 'slot-fingerprint-mismatch'
    ))).toBe(true);
  });

  it('does not bind a role-spoofed artifact', () => {
    const role = 'other-role';
    const spoofedSlot = { ...SLOT, role };
    const envelope = read(v3Source({
      slotFingerprint: managedWriterSlotEnvelopeFingerprint([spoofedSlot]),
      beginAttributes: `id=${SLOT.id} role=${role} writer-revision=1 semantic-fingerprint=${SLOT.semanticFingerprint}`,
    }));
    const validation = validateManagedConstructionV3Artifact(envelope, ARTIFACT);

    expect(envelope.syntacticallyValid).toBe(true);
    expect(validation.artifactMatched).toBe(false);
    expect(validation.writable).toBe(false);
  });

  it('preserves non-whitespace outside slots as opaque and remains read-only', () => {
    const source = v3Source({ beforeSlot: '% user-owned helper' });
    const envelope = read(source);

    expect(envelope.syntacticallyValid).toBe(false);
    expect(envelope.opaqueRanges).toHaveLength(1);
    expect(source.slice(
      envelope.opaqueRanges[0]!.start,
      envelope.opaqueRanges[0]!.end,
    )).toContain('% user-owned helper');
    expect(envelope.writable).toBe(false);
  });

  it('never falls back to v3 semantics for a v2 block', () => {
    const source = [
      '% @mathgeo begin schema=2 id=segment-1 kind=primitive',
      '\\draw (A) -- (B);',
      '% @mathgeo end',
      '',
    ].join('\n');
    const envelope = read(source);

    expect(envelope.syntacticallyValid).toBe(false);
    expect(envelope.issues.some((candidate) => candidate.code === 'not-schema-v3'))
      .toBe(true);
    expect(envelope.writable).toBe(false);
  });
});
