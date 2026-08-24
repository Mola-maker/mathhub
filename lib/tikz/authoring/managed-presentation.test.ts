import { describe, expect, it } from 'vitest';
import {
  parseManagedConstructionBlocks,
} from '../semantics/managed-construction';
import {
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
  createPrimitiveConstructionPlan,
} from './construction-catalog';
import {
  compileConstructionPlan,
  compileConstructionWriterArtifact,
  type ConstructionPlan,
  type PrimitiveKind,
} from './construction-ir';
import { decodeManagedConstructionPlan } from './construction-plan-codec';
import {
  managedConstructionPlanRecompilePatches,
  managedStyleRecompilePatches,
} from './managed-construction-recompile';
import {
  hydrateManagedPresentation,
  mergeManagedPresentation,
} from './managed-presentation';
import type { AuthoringAnchor } from './source-builder';

function anchor(name: string, x: number, y: number): AuthoringAnchor {
  return {
    name,
    position: { x, y },
    existing: true,
  };
}

function primitivePlan(
  kind: PrimitiveKind,
  anchors: readonly AuthoringAnchor[],
): ConstructionPlan {
  return createPrimitiveConstructionPlan(kind, {
    anchors,
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => `${kind}-managed-1`,
  });
}

function compiledBlock(plan: ConstructionPlan, lineEnding = '\n'): string {
  return compileConstructionPlan(plan).lines.join(lineEnding) + lineEnding;
}

function writerProof(plan: ConstructionPlan) {
  const artifact = compileConstructionWriterArtifact(plan);
  return {
    expectedWriterId: artifact.writerId,
    expectedWriterRevision: artifact.writerRevision,
    expectedWriterSlotIds: artifact.slots.map((slot) => slot.id),
    expectedWriterSlotSemanticFingerprints:
      artifact.slots.map((slot) => slot.semanticFingerprint),
  };
}

function applySinglePatch(
  source: string,
  patch: { readonly from: number; readonly to: number; readonly insert: string },
): string {
  return source.slice(0, patch.from) + patch.insert + source.slice(patch.to);
}

function resealBody(source: string, body: string): string {
  const block = parseManagedConstructionBlocks(source)[0]!;
  const patch = managedStyleRecompilePatches(source, block.id, {
    from: block.tikzBodyRange.start,
    to: block.tikzBodyRange.end,
    insert: body,
  })[0]!;
  return applySinglePatch(source, patch);
}

describe('ManagedPresentationIR primitive vertical slice', () => {
  it('targets only the nine-point-circle render slot in a multi-slot writer', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => (
      candidate.id === 'nine-point-circle'
    ))!;
    let nextName = 0;
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [
        anchor('A', 0, 0),
        anchor('B', 6, 0),
        anchor('C', 2, 4),
      ],
      nextName: (prefix) => `${prefix}${++nextName}`,
      nextConstructionId: () => 'nine-point-style-1',
    });
    const source = compiledBlock(plan);
    const artifact = compileConstructionWriterArtifact(plan);
    const circleSlot = artifact.slots.find((slot) => (
      slot.role === 'nine-point-circle-render'
    ))!;
    const slotStart = source.indexOf(circleSlot.canonicalSource);
    const optionStart = slotStart + circleSlot.canonicalSource.indexOf('[');
    const optionEnd = slotStart + circleSlot.canonicalSource.indexOf(']') + 1;
    const currentOptions = source.slice(optionStart + 1, optionEnd - 1);
    const patch = managedStyleRecompilePatches(source, plan.id, {
      from: optionStart,
      to: optionEnd,
      insert: `[${currentOptions},red,very thick]`,
    })[0]!;
    const styled = applySinglePatch(source, patch);
    const decoded = decodeManagedConstructionPlan(
      styled,
      parseManagedConstructionBlocks(styled)[0]!,
    );

    expect(decoded.ok).toBe(true);
    if (!decoded.ok || !decoded.presentation) return;
    expect(decoded.presentation.slots).toHaveLength(artifact.slots.length);
    expect(decoded.presentation.attachments.map((item) => item.raw))
      .toEqual(expect.arrayContaining(['red', 'very thick']));
    expect(mergeManagedPresentation(decoded.presentation, decoded.plan))
      .toMatchObject({ ok: true, tikzBody: expect.stringContaining('red,very thick') });
    artifact.slots
      .filter((slot) => slot.id !== circleSlot.id)
      .forEach((slot) => expect(styled).toContain(slot.canonicalSource));
  });

  it('does not advertise coordinate points as presentation-option slots', () => {
    const point = primitivePlan('point', [anchor('A', 0, 0)]);

    expect(hydrateManagedPresentation(
      point,
      '\\coordinate[red] (A) at (0,0);\n',
    )).toMatchObject({
      ok: false,
      issues: [{ code: 'unsupported-plan-kind' }],
    });
  });

  it('preserves nested options, comments, and CRLF while changing a segment endpoint', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);
    const next = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('C', 3, 1),
    ]);
    const body = '\\draw[red,% keep this style\r\n  thick,fill=blue!20] (A) -- (B);\r\n';

    const hydrated = hydrateManagedPresentation(previous, body);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    const merged = mergeManagedPresentation(hydrated.presentation, next);

    expect(merged).toEqual({
      ok: true,
      tikzBody: '\\draw[red,% keep this style\r\n  thick,fill=blue!20] (A) -- (C);\r\n',
    });
  });

  it('updates a circle semantic option while preserving presentation attachments', () => {
    const previous = primitivePlan('circle', [
      anchor('O', 0, 0),
      anchor('A', 2, 0),
    ]);
    const next = primitivePlan('circle', [
      anchor('O', 0, 0),
      anchor('B', 0, 3),
    ]);
    const body = '\\node[draw,circle through=(A),red,very thick] at (O) {};\n';

    const hydrated = hydrateManagedPresentation(previous, body);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    const merged = mergeManagedPresentation(hydrated.presentation, next);

    expect(merged).toEqual({
      ok: true,
      tikzBody: '\\node[draw,circle through=(B),red,very thick] at (O) {};\n',
    });
  });

  it('allows a safe draw color to replace the circle writer baseline', () => {
    const previous = primitivePlan('circle', [
      anchor('O', 0, 0),
      anchor('A', 2, 0),
    ]);
    const next = primitivePlan('circle', [
      anchor('O', 0, 0),
      anchor('B', 0, 3),
    ]);
    const body = '\\node[draw=red,circle through=(A),very thick] at (O) {};\n';

    const hydrated = hydrateManagedPresentation(previous, body);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    expect(mergeManagedPresentation(hydrated.presentation, next)).toEqual({
      ok: true,
      tikzBody: '\\node[draw=red,circle through=(B),very thick] at (O) {};\n',
    });
  });

  it('rejects a presentation attachment that overrides circle geometry', () => {
    const previous = primitivePlan('circle', [
      anchor('O', 0, 0),
      anchor('A', 2, 0),
    ]);
    const hydrated = hydrateManagedPresentation(
      previous,
      '\\node[draw,circle through=(A),red,circle through=(B)] at (O) {};\n',
    );

    expect(hydrated).toMatchObject({
      ok: false,
      issues: [{ code: 'semantic-option-conflict' }],
    });
  });

  it('rejects transform and executable pgfkeys in a changed semantic slot', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);

    expect(hydrateManagedPresentation(
      previous,
      '\\draw[rotate=15,postaction={decorate}] (A) -- (B);\n',
    )).toMatchObject({
      ok: false,
      issues: [{ code: 'unsupported-presentation-option' }],
    });
  });

  it('uses the same presentation-safe recompiler for a styled managed block', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);
    const next = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('C', 3, 1),
    ]);
    const canonical = compiledBlock(previous, '\r\n');
    const styled = resealBody(
      canonical,
      '\\draw[blue,thick,fill=blue!20] (A) -- (B);\r\n',
    );
    const decoded = decodeManagedConstructionPlan(
      styled,
      parseManagedConstructionBlocks(styled)[0]!,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.presentation?.attachments.length).toBe(3);

    const block = parseManagedConstructionBlocks(styled)[0]!;
    const patch = managedConstructionPlanRecompilePatches(
      styled,
      previous.id,
      next,
      {
        expectedContentFingerprint: block.contentFingerprint!,
        expectedRange: block.range,
        expectedPlanKind: block.planKind,
        expectedCanonicalPlan: decoded.plan,
        ...writerProof(decoded.plan),
        expectedPresentationFingerprint:
          decoded.presentation!.presentationFingerprint,
        expectedAttachmentsFingerprint:
          decoded.presentation!.attachmentsFingerprint,
      },
    )[0]!;
    const result = applySinglePatch(styled, patch);
    const resultBlock = parseManagedConstructionBlocks(result)[0]!;

    expect(result.slice(resultBlock.tikzBodyRange.start, resultBlock.tikzBodyRange.end))
      .toBe('\\draw[blue,thick,fill=blue!20] (A) -- (C);\r\n');
    expect(resultBlock.integrityStatus).toBe('valid');
    const resultDecoded = decodeManagedConstructionPlan(result, resultBlock);
    expect(resultDecoded.ok).toBe(true);
    if (resultDecoded.ok) {
      expect(resultDecoded.presentation?.attachmentsFingerprint)
        .toBe(decoded.presentation?.attachmentsFingerprint);
    }
  });

  it('requires exact presentation CAS for every non-canonical block', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);
    const next = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('C', 3, 1),
    ]);
    const styled = resealBody(
      compiledBlock(previous),
      '\\draw[red,thick] (A) -- (B);\n',
    );
    const block = parseManagedConstructionBlocks(styled)[0]!;

    expect(() => managedConstructionPlanRecompilePatches(
      styled,
      previous.id,
      next,
      {
        expectedContentFingerprint: block.contentFingerprint!,
        expectedRange: block.range,
        expectedPlanKind: block.planKind,
        expectedCanonicalPlan: previous,
        ...writerProof(previous),
      },
    )).toThrow('exact presentation fingerprint');
  });

  it('detects equal-length LF/CRLF presentation drift hidden by normalized content hashing', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);
    const next = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('C', 3, 1),
    ]);
    const canonical = compiledBlock(previous);
    const first = resealBody(
      canonical,
      '\\draw[red,% a\r\n thick,% b\n dashed] (A) -- (B);\n',
    );
    const drifted = resealBody(
      canonical,
      '\\draw[red,% a\n thick,% b\r\n dashed] (A) -- (B);\n',
    );
    const firstBlock = parseManagedConstructionBlocks(first)[0]!;
    const driftedBlock = parseManagedConstructionBlocks(drifted)[0]!;
    expect(driftedBlock.contentFingerprint).toBe(firstBlock.contentFingerprint);
    expect(driftedBlock.range.end - driftedBlock.range.start)
      .toBe(firstBlock.range.end - firstBlock.range.start);
    const decoded = decodeManagedConstructionPlan(first, firstBlock);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || !decoded.presentation) return;
    // Bind to a const: narrowing of a property does not survive into the closure.
    const presentation = decoded.presentation;

    expect(() => managedConstructionPlanRecompilePatches(
      drifted,
      previous.id,
      next,
      {
        expectedContentFingerprint: driftedBlock.contentFingerprint!,
        expectedRange: driftedBlock.range,
        expectedPlanKind: driftedBlock.planKind,
        expectedCanonicalPlan: previous,
        ...writerProof(previous),
        expectedPresentationFingerprint: presentation.presentationFingerprint,
        expectedAttachmentsFingerprint: presentation.attachmentsFingerprint,
      },
    )).toThrow('presentation changed');
  });

  it('does not bless managed header divergence as presentation', () => {
    const previous = primitivePlan('segment', [
      anchor('A', 0, 0),
      anchor('B', 2, 0),
    ]);
    const canonical = compiledBlock(previous);
    const styled = resealBody(
      canonical,
      '\\draw[red,thick] (A) -- (B);\n',
    );
    const divergedHeader = styled.replace(
      ' outputs=',
      ' unowned-header-token=yes outputs=',
    );

    expect(decodeManagedConstructionPlan(
      divergedHeader,
      parseManagedConstructionBlocks(divergedHeader)[0]!,
    )).toMatchObject({
      ok: false,
      issues: [{ code: 'non-canonical-source' }],
    });
  });
});
