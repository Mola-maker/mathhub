import {
  compileConstructionPlan,
  compileConstructionWriterArtifact,
  type ConstructionCompilation,
  type ConstructionPlan,
  type PrimitiveConstructionPlan,
  type PrimitiveDefinition,
} from './construction-ir';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import {
  writeManagedConstructionV3Block,
  type ManagedConstructionV3WriteResult,
} from '../semantics/managed-construction-v3';
import {
  mergeManagedPresentation,
  type ManagedPresentationIR,
} from './managed-presentation';

type V3Primitive = Extract<PrimitiveDefinition, { kind: 'segment' | 'circle' }>;

export type ManagedConstructionV3WritePlan = PrimitiveConstructionPlan & {
  readonly primitive: V3Primitive;
};

export interface ManagedConstructionV3Compilation
  extends ConstructionCompilation {
  /** Complete, self-validated source bytes, including the trailing line ending. */
  readonly source: string;
  readonly write: ManagedConstructionV3WriteResult;
}

function canonicalV3Identity(plan: ManagedConstructionV3WritePlan) {
  const canonicalV2 = compileConstructionPlan(plan);
  const canonicalV2Source = `${canonicalV2.lines.join('\n')}\n`;
  const v2Blocks = parseManagedConstructionBlocks(canonicalV2Source);
  const v2Block = v2Blocks[0];
  if (
    v2Blocks.length !== 1
    || !v2Block
    || v2Block.range.start !== 0
    || v2Block.range.end !== canonicalV2Source.length
    || v2Block.metadataStatus !== 'valid'
    || v2Block.integrityStatus !== 'valid'
  ) {
    throw new TypeError(
      'Canonical construction writer did not produce one attached semantic block.',
    );
  }
  return {
    block: v2Block,
    artifact: compileConstructionWriterArtifact(plan),
  };
}

function v3Compilation(
  plan: ManagedConstructionV3WritePlan,
  slotSources: readonly { readonly id: string; readonly source: string }[],
  lineEnding: '\n' | '\r\n',
): ManagedConstructionV3Compilation {
  const identity = canonicalV3Identity(plan);
  const write = writeManagedConstructionV3Block({
    id: identity.block.id,
    kind: identity.block.kind,
    planKind: identity.block.planKind,
    inputs: identity.block.inputs,
    outputs: identity.block.outputs,
    records: identity.block.records,
    artifact: identity.artifact,
    slotSources,
    lineEnding,
  });
  const sourceWithoutTrailingEnding = write.source.endsWith(lineEnding)
    ? write.source.slice(0, -lineEnding.length)
    : write.source;
  return {
    lines: sourceWithoutTrailingEnding.split(lineEnding),
    selection: [...plan.selection],
    status: plan.status,
    kind: plan.kind,
    source: write.source,
    write,
  };
}

/**
 * Deliberately narrow activation gate. Schema-v3 starts with the two primitive
 * presentation shapes that ManagedPresentationIR can already hydrate and
 * merge. Point definitions and multi-slot constructions remain schema-v2.
 */
export function isManagedConstructionV3WritePlan(
  plan: ConstructionPlan,
): plan is ManagedConstructionV3WritePlan {
  return plan.kind === 'primitive'
    && (plan.primitive.kind === 'segment' || plan.primitive.kind === 'circle')
    && plan.sourceWriterHint === undefined;
}

/**
 * Transitional schema-v3 frontend for trusted plans. The existing v2 writer
 * remains the semantic canonicalizer; its parsed records/header identity are
 * then enclosed in the v3 persistent writer-slot ABI and self-validated.
 * This avoids duplicating geometry semantics while v2 and v3 coexist.
 */
export function compileConstructionPlanV3(
  plan: ConstructionPlan,
  lineEnding: '\n' | '\r\n' = '\n',
): ManagedConstructionV3Compilation {
  if (!isManagedConstructionV3WritePlan(plan)) {
    throw new TypeError(
      'Schema-v3 writer currently supports only canonical primitive segment and circle plans.',
    );
  }

  const artifact = compileConstructionWriterArtifact(plan);
  return v3Compilation(
    plan,
    artifact.slots.map((slot) => ({
      id: slot.id,
      source: slot.canonicalSource,
    })),
    lineEnding,
  );
}

/**
 * Recompile v3 from a previously hydrated presentation. The caller supplies
 * typed presentation IR, never source bytes; mergeManagedPresentation proves
 * that only registered option attachments are carried into the next slot.
 */
export function compileConstructionPlanV3WithPresentation(
  plan: ConstructionPlan,
  presentation: ManagedPresentationIR,
  lineEnding: '\n' | '\r\n' = '\n',
): ManagedConstructionV3Compilation {
  if (!isManagedConstructionV3WritePlan(plan)) {
    throw new TypeError(
      'Schema-v3 presentation merge supports only primitive segment and circle plans.',
    );
  }
  if (presentation.constructionId !== plan.id) {
    throw new TypeError('Schema-v3 presentation belongs to another construction.');
  }
  const merged = mergeManagedPresentation(presentation, plan);
  if (!merged.ok) {
    throw new TypeError(
      merged.issues[0]?.message ?? 'Schema-v3 presentation merge failed.',
    );
  }
  const artifact = compileConstructionWriterArtifact(plan);
  if (artifact.slots.length !== 1) {
    throw new TypeError('Schema-v3 presentation merge expected exactly one writer slot.');
  }
  return v3Compilation(
    plan,
    [{ id: artifact.slots[0]!.id, source: merged.tikzBody }],
    lineEnding,
  );
}

/**
 * Single creation policy for production callers: emit v3 only where the
 * writer-slot/presentation contract is complete, otherwise preserve the v2
 * canonical writer. Existing blocks are never upgraded by this helper.
 */
export function compileNewManagedConstructionPlan(
  plan: ConstructionPlan,
): ConstructionCompilation {
  return isManagedConstructionV3WritePlan(plan)
    ? compileConstructionPlanV3(plan)
    : compileConstructionPlan(plan);
}
