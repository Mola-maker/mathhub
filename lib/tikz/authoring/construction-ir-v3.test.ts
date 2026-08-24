import { describe, expect, it } from 'vitest';
import { createPrimitiveConstructionPlan } from './construction-catalog';
import { compileConstructionWriterArtifact } from './construction-ir';
import {
  compileNewManagedConstructionPlan,
  isManagedConstructionV3WritePlan,
} from './construction-ir-v3';
import { decodeManagedConstructionPlan } from './construction-plan-codec';
import {
  managedConstructionPlanRecompilePatches,
  managedStyleRecompilePatches,
} from './managed-construction-recompile';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';

function segmentPlan() {
  return createPrimitiveConstructionPlan('segment', {
    anchors: [
      { name: 'A', position: { x: 0, y: 0 }, existing: true },
      { name: 'B', position: { x: 2, y: 0 }, existing: true },
    ],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => 'managed-v3-segment',
  });
}

describe('schema-v3 managed construction activation', () => {
  it('uses one bounded presentation segment for semantic infinite lines', () => {
    const plan = createPrimitiveConstructionPlan('line', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-v3-line',
    });
    const source = compileNewManagedConstructionPlan(plan).lines.join('\n');
    expect(source).toContain('\\draw ($(A)!-0.25!(B)$) -- ($(A)!1.25!(B)$);');
    expect(source).not.toContain('!4!(B)');
  });

  it('uses double-read/single-write policy for new supported primitives', () => {
    const plan = segmentPlan();
    const compilation = compileNewManagedConstructionPlan(plan);
    const source = `${compilation.lines.join('\n')}\n`;
    const block = parseManagedConstructionBlocks(source)[0]!;
    const decoded = decodeManagedConstructionPlan(source, block);

    expect(isManagedConstructionV3WritePlan(plan)).toBe(true);
    expect(block.schemaVersion).toBe(3);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.presentation).toBeUndefined();
      expect(decoded.compactPlan).toEqual(expect.objectContaining({
        id: plan.id,
        kind: 'primitive',
      }));
    }
  });

  it('hydrates and re-emits a style attachment from the persistent writer slot', () => {
    const plan = segmentPlan();
    const source = `${compileNewManagedConstructionPlan(plan).lines.join('\n')}\n`;
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    const stylePatch = managedStyleRecompilePatches(
      source,
      plan.id,
      { from: insertAt, to: insertAt, insert: '[red]' },
    )[0]!;
    const styled = stylePatch.insert;
    const styledBlock = parseManagedConstructionBlocks(styled)[0]!;
    const decoded = decodeManagedConstructionPlan(styled, styledBlock);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || !decoded.presentation) return;

    const artifact = compileConstructionWriterArtifact(decoded.plan);
    const replacement = managedConstructionPlanRecompilePatches(
      styled,
      plan.id,
      decoded.plan,
      {
        expectedContentFingerprint: styledBlock.contentFingerprint!,
        expectedRange: styledBlock.range,
        expectedPlanKind: styledBlock.planKind,
        expectedPresentationFingerprint:
          decoded.presentation.presentationFingerprint,
        expectedAttachmentsFingerprint:
          decoded.presentation.attachmentsFingerprint,
        expectedWriterId: artifact.writerId,
        expectedWriterRevision: artifact.writerRevision,
        expectedWriterSlotIds: artifact.slots.map((slot) => slot.id),
        expectedWriterSlotSemanticFingerprints:
          artifact.slots.map((slot) => slot.semanticFingerprint),
        expectedCanonicalPlan: decoded.plan,
      },
    )[0]!;

    expect(replacement.insert).toContain('\\draw[red] (A) -- (B);');
    expect(parseManagedConstructionBlocks(replacement.insert)[0]!.schemaVersion)
      .toBe(3);
  });

  it('keeps the canonical envelope on LF when only the writer body uses CRLF', () => {
    const plan = segmentPlan();
    const source = `${compileNewManagedConstructionPlan(plan).lines.join('\n')}\n`;
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    // A comment inside the option list forces a CRLF that legitimately belongs
    // to presentation. Inferring the line ending from the whole block would
    // rewrite the header and record lines nobody edited.
    const styled = managedStyleRecompilePatches(
      source,
      plan.id,
      { from: insertAt, to: insertAt, insert: '[red,% keep\r\n  thick]' },
    )[0]!.insert;
    const styledBlock = parseManagedConstructionBlocks(styled)[0]!;
    const decoded = decodeManagedConstructionPlan(styled, styledBlock);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || !decoded.presentation) return;

    const artifact = compileConstructionWriterArtifact(decoded.plan);
    const replacement = managedConstructionPlanRecompilePatches(
      styled,
      plan.id,
      decoded.plan,
      {
        expectedContentFingerprint: styledBlock.contentFingerprint!,
        expectedRange: styledBlock.range,
        expectedPlanKind: styledBlock.planKind,
        expectedPresentationFingerprint:
          decoded.presentation.presentationFingerprint,
        expectedAttachmentsFingerprint:
          decoded.presentation.attachmentsFingerprint,
        expectedWriterId: artifact.writerId,
        expectedWriterRevision: artifact.writerRevision,
        expectedWriterSlotIds: artifact.slots.map((slot) => slot.id),
        expectedWriterSlotSemanticFingerprints:
          artifact.slots.map((slot) => slot.semanticFingerprint),
        expectedCanonicalPlan: decoded.plan,
      },
    )[0]!;

    const replacedBlock = parseManagedConstructionBlocks(replacement.insert)[0]!;
    const envelope = replacement.insert.slice(0, replacedBlock.tikzBodyRange.start)
      + replacement.insert.slice(replacedBlock.tikzBodyRange.end);
    expect(envelope).not.toContain('\r\n');
    // The CRLF the author wrote survives inside the writer-owned slot.
    expect(replacement.insert).toContain('% keep\r\n');
  });

  it('keeps point creation on schema-v2 until point slots have a presentation contract', () => {
    const point = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'A', position: { x: 1, y: 2 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-v2-point',
    });
    const source = `${compileNewManagedConstructionPlan(point).lines.join('\n')}\n`;

    expect(isManagedConstructionV3WritePlan(point)).toBe(false);
    expect(parseManagedConstructionBlocks(source)[0]!.schemaVersion).toBe(2);
  });
});
