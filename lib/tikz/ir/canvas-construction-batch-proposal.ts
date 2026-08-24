import {
  compileConstructionWriterArtifact,
  compileSourceCircleAdoption,
  validateConstructionPlan,
  type CircleConstructionReference,
  type ConstructionPlan,
  type SourceCircleAdoptionIntent,
} from '../authoring/construction-ir';
import { evaluateConstructionPlan } from '../authoring/construction-eval';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import { validateConstructionPlanSemanticFootprint } from '../authoring/construction-plan-footprint';
import {
  compactCanonicalConstructionPlan,
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
  validateConstructionPlanWriterSafety,
} from '../authoring/construction-plan-codec';
import { insertBeforeTikzEndPatch } from '../authoring/source-builder';
import { hashSource } from '../document/source-hash';
import { applyTextPatches, type TextPatch } from '../document/source-transaction';
import {
  parseManagedConstructionBlocks,
  sourceRangeOverlapsManagedDirectiveRegion,
} from '../semantics/managed-construction';
import type { SceneCircleDefinition } from '../semantics/scene';
import type { GeometryDoc } from './geometry-doc';
import type { JsonObject } from './model';
import { qualifiedManagedEntityReference } from './persistent-entity-reference';
import type {
  GeometryPrecondition,
  GeometryResourceReference,
  GeometryTransactionRequest,
} from './transactions';

export const CANVAS_CONSTRUCTION_BATCH_PROPOSAL_SCHEMA_VERSION =
  'canvas-construction-batch-proposal/v1' as const;

export type CanvasCircleAdoptionIntent = SourceCircleAdoptionIntent;

export interface CanvasConstructionBatchProposal {
  readonly schemaVersion: typeof CANVAS_CONSTRUCTION_BATCH_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
  /** Post-commit UTF-16 range containing all newly inserted canonical plans. */
  readonly insertedRange: { readonly start: number; readonly end: number };
}

// A type alias, not an interface: this capability travels in transaction
// metadata as JsonValue, and only a type alias carries the implicit index
// signature JsonObject requires.
type AdoptionCapability = {
  readonly constructionId: string;
  readonly sourceEntityId: string;
  readonly managedEntityId: string;
  readonly sourceStableId: string;
  readonly bindingId: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly sourceFingerprint: string;
  readonly definition: SceneCircleDefinition;
};

function closeNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function geometryPoint(
  geometryDoc: GeometryDoc,
  name: string,
): { readonly x: number; readonly y: number } | null {
  const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
    entity.kind === 'point'
    && entity.name === name
    && typeof entity.parameters?.x === 'number'
    && Number.isFinite(entity.parameters.x)
    && typeof entity.parameters?.y === 'number'
    && Number.isFinite(entity.parameters.y)
  ));
  return matches.length === 1
    ? {
      x: matches[0]!.parameters!.x as number,
      y: matches[0]!.parameters!.y as number,
    }
    : null;
}

function geometryPointSnapshot(
  geometryDoc: GeometryDoc,
): Map<string, { readonly x: number; readonly y: number }> {
  const points = new Map<string, { readonly x: number; readonly y: number }>();
  geometryDoc.semantic.ir.entities.forEach((entity) => {
    if (
      entity.kind === 'point'
      && entity.name
      && typeof entity.parameters?.x === 'number'
      && Number.isFinite(entity.parameters.x)
      && typeof entity.parameters?.y === 'number'
      && Number.isFinite(entity.parameters.y)
    ) {
      points.set(entity.name, {
        x: entity.parameters.x,
        y: entity.parameters.y,
      });
    }
  });
  return points;
}

function evaluatedPoint(
  value: CircleConstructionReference['evaluatedCenter'],
): { readonly x: number; readonly y: number } | null {
  if (value === undefined) return null;
  return 'x' in value ? value : { x: value[0], y: value[1] };
}

/**
 * Validate a circle produced earlier in the same topologically ordered batch.
 * It is not present in the current GeometryDoc yet, so resolving it through
 * current source bindings would incorrectly reject a valid construction DAG.
 */
function sameBatchCircleReferenceConflict(
  geometryDoc: GeometryDoc,
  priorPlans: readonly ConstructionPlan[],
  reference: CircleConstructionReference,
): string | null | undefined {
  if (!reference.id) return undefined;
  const matches = priorPlans.flatMap((plan) => plan.entities.flatMap((entity) => (
    entity.kind === 'circle'
    && qualifiedManagedEntityReference(plan.id, entity.id) === reference.id
      ? [{ entity, plan }]
      : []
  )));
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) return `circle ${reference.id} is ambiguous inside the batch`;

  const points = geometryPointSnapshot(geometryDoc);
  for (const plan of priorPlans) {
    const evaluation = evaluateConstructionPlan(plan, points);
    if (evaluation.status === 'invalid') {
      return `circle ${reference.id} depends on invalid earlier geometry`;
    }
    evaluation.points.forEach((point, name) => points.set(name, point));
  }
  const { entity } = matches[0]!;
  if (entity.center !== reference.center) {
    return `circle ${reference.id} changed its same-batch center`;
  }
  const center = points.get(entity.center);
  if (!center) return `circle ${reference.id} has no finite same-batch center`;
  let radius: number;
  if (typeof entity.through === 'string') {
    if (reference.through !== entity.through) {
      return `circle ${reference.id} changed its same-batch through point`;
    }
    const through = points.get(entity.through);
    if (!through) return `circle ${reference.id} has no finite same-batch through point`;
    radius = Math.hypot(through.x - center.x, through.y - center.y);
    if (
      reference.radius !== undefined
      && (typeof reference.radius !== 'number' || !closeNumber(reference.radius, radius))
    ) return `circle ${reference.id} carries a stale same-batch radius`;
  } else {
    if (typeof entity.radius !== 'number' || !Number.isFinite(entity.radius)) {
      return `circle ${reference.id} has no finite same-batch radius`;
    }
    radius = entity.radius;
    if (
      reference.through !== undefined
      || typeof reference.radius !== 'number'
      || !closeNumber(reference.radius, radius)
    ) return `circle ${reference.id} changed its same-batch radius`;
  }
  if (!Number.isFinite(radius) || radius <= 1e-8) {
    return `circle ${reference.id} is degenerate inside the batch`;
  }
  const snapshotCenter = evaluatedPoint(reference.evaluatedCenter);
  if (
    snapshotCenter
    && (
      !closeNumber(snapshotCenter.x, center.x)
      || !closeNumber(snapshotCenter.y, center.y)
    )
  ) return `circle ${reference.id} carries a stale same-batch center snapshot`;
  if (
    reference.evaluatedRadius !== undefined
    && !closeNumber(reference.evaluatedRadius, radius)
  ) return `circle ${reference.id} carries a stale same-batch radius snapshot`;
  return null;
}

function authoritativeCircleDefinition(
  source: string,
  referenceId: string,
  adoptions: readonly CanvasCircleAdoptionIntent[],
): SceneCircleDefinition | null {
  const adopted = adoptions.filter((adoption) => (
    qualifiedManagedEntityReference(
      adoption.constructionId,
      adoption.managedEntityId,
    ) === referenceId
  ));
  const existing = parseManagedConstructionBlocks(source).flatMap((block) => {
    if (
      block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
    ) return [];
    return block.records.flatMap((record): SceneCircleDefinition[] => {
      if (
        record.recordType !== 'entity'
        || record.kind !== 'circle'
        || qualifiedManagedEntityReference(block.id, record.id) !== referenceId
      ) return [];
      // Test the value, not the key: the center-radius variant declares
      // `through?: never`, so `'through' in record` can be true while the
      // value is undefined, which would yield a center-through definition
      // with no through point.
      if (typeof record.through === 'string' && record.through.length > 0) {
        return [{
          kind: 'center-through' as const,
          centerName: record.center,
          throughName: record.through,
        }];
      }
      if (typeof record.radius === 'number' && Number.isFinite(record.radius)) {
        return [{
          kind: 'center-radius' as const,
          centerName: record.center,
          radius: record.radius,
        }];
      }
      return [];
    });
  });
  const definitions = [
    ...adopted.map((adoption) => adoption.definition),
    ...existing,
  ];
  return definitions.length === 1 ? definitions[0]! : null;
}

function canvasCircleReferenceConflict(
  source: string,
  geometryDoc: GeometryDoc,
  adoptions: readonly CanvasCircleAdoptionIntent[],
  reference: CircleConstructionReference,
): string | null {
  if (!reference.id) return 'circle reference has no managed identity';
  const definition = authoritativeCircleDefinition(source, reference.id, adoptions);
  if (!definition || reference.center !== definition.centerName) {
    return `circle ${reference.id} is not bound to one current managed definition`;
  }
  const center = geometryPoint(geometryDoc, definition.centerName);
  if (!center) return `circle ${reference.id} has no unique current center point`;
  let evaluatedRadius: number;
  if (definition.kind === 'center-through') {
    if (reference.through !== definition.throughName) {
      return `circle ${reference.id} changed its authoritative through point`;
    }
    const through = geometryPoint(geometryDoc, definition.throughName);
    if (!through) return `circle ${reference.id} has no unique current through point`;
    evaluatedRadius = Math.hypot(through.x - center.x, through.y - center.y);
    if (
      reference.radius !== undefined
      && (typeof reference.radius !== 'number'
        || !closeNumber(reference.radius, evaluatedRadius))
    ) return `circle ${reference.id} carries a stale evaluated radius`;
  } else {
    if (reference.through !== undefined || reference.radius !== definition.radius) {
      return `circle ${reference.id} changed its authoritative radius`;
    }
    evaluatedRadius = definition.radius;
  }
  if (!Number.isFinite(evaluatedRadius) || evaluatedRadius <= 1e-8) {
    return `circle ${reference.id} is degenerate at the current revision`;
  }
  const evaluatedCenter = reference.evaluatedCenter === undefined
    ? null
    : 'x' in reference.evaluatedCenter
      ? reference.evaluatedCenter
      : {
        x: reference.evaluatedCenter[0],
        y: reference.evaluatedCenter[1],
      };
  if (
    evaluatedCenter
    && (
      !closeNumber(evaluatedCenter.x, center.x)
      || !closeNumber(evaluatedCenter.y, center.y)
    )
  ) return `circle ${reference.id} carries a stale evaluated center`;
  if (
    reference.evaluatedRadius !== undefined
    && !closeNumber(reference.evaluatedRadius, evaluatedRadius)
  ) return `circle ${reference.id} carries a stale evaluated radius snapshot`;
  return null;
}

function canvasPlanCircleCapabilityConflict(
  source: string,
  geometryDoc: GeometryDoc,
  adoptions: readonly CanvasCircleAdoptionIntent[],
  priorPlans: readonly ConstructionPlan[],
  plan: ConstructionPlan,
): string | null {
  const conflict = (reference: CircleConstructionReference) => {
    const sameBatch = sameBatchCircleReferenceConflict(
      geometryDoc,
      priorPlans,
      reference,
    );
    return sameBatch === undefined
      ? canvasCircleReferenceConflict(source, geometryDoc, adoptions, reference)
      : sameBatch;
  };
  if (plan.kind === 'point-on-circle' || plan.kind === 'tangent-at-point') {
    return conflict(plan.circle);
  }
  if (plan.kind === 'radical-axis') {
    return conflict(plan.circle1) ?? conflict(plan.circle2);
  }
  return null;
}

function canvasPlanInputCapabilityConflict(
  source: string,
  geometryDoc: GeometryDoc,
  plans: readonly ConstructionPlan[],
  adoptions: readonly CanvasCircleAdoptionIntent[],
): string | null {
  const allowed = new Set<string>();
  const currentReferenceCounts = new Map<string, number>();
  geometryDoc.semantic.ir.entities.forEach((entity) => {
    new Set([entity.id, entity.name].filter((value): value is string => Boolean(value)))
      .forEach((reference) => currentReferenceCounts.set(
        reference,
        (currentReferenceCounts.get(reference) ?? 0) + 1,
      ));
  });
  currentReferenceCounts.forEach((count, reference) => {
    if (count === 1) allowed.add(reference);
  });
  parseManagedConstructionBlocks(source).forEach((block) => {
    if (block.metadataStatus !== 'valid' || block.integrityStatus !== 'valid') return;
    block.records.forEach((record) => {
      if (record.recordType === 'entity') {
        allowed.add(qualifiedManagedEntityReference(block.id, record.id));
      }
    });
  });
  adoptions.forEach((adoption) => allowed.add(qualifiedManagedEntityReference(
    adoption.constructionId,
    adoption.managedEntityId,
  )));
  for (const plan of plans) {
    const missing = plan.inputs.find((entry) => !allowed.has(entry.ref));
    if (missing) {
      return `${plan.id} input ${missing.id} does not resolve to a current or same-batch capability`;
    }
    // Plans are source ordered. Only outputs of an already validated producer
    // become capabilities for later consumers, which makes the batch itself a
    // deterministic topological order rather than a bag of mutually trusting
    // compact plans. Point consumers use the canonical TikZ name; circle
    // consumers use the persistent managed reference while retaining the
    // writer-visible center/through names in their CircleConstructionReference.
    for (const output of plan.outputs) {
      allowed.add(output.ref);
      const entity = plan.entities.find((candidate) => (
        candidate.id === output.ref || candidate.name === output.ref
      ));
      if (!entity) continue;
      allowed.add(entity.id);
      allowed.add(entity.name);
      allowed.add(qualifiedManagedEntityReference(plan.id, entity.id));
    }
  }
  return null;
}

function sameCircleDefinition(
  left: unknown,
  right: SceneCircleDefinition,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function primarySourceOf(source: string, geometryDoc: GeometryDoc) {
  const { basis } = geometryDoc;
  const sourceId = basis.sourceId;
  if (!sourceId) {
    throw new TypeError('Canvas construction requires a source-bound GeometryDoc.');
  }
  const primary = geometryDoc.construction.sources.find((candidate) => (
    candidate.sourceId === sourceId
  ));
  if (
    !primary
    || primary.text !== source
    || primary.revision !== basis.revision
    || primary.hash !== basis.sourceHash
    || geometryDoc.semantic.status !== 'complete'
  ) {
    throw new TypeError(
      'Canvas construction requires the complete current GeometryDoc source revision.',
    );
  }
  return { sourceId, primary };
}

function orderedDisjointPatches(
  source: string,
  patches: readonly TextPatch[],
): readonly TextPatch[] {
  const ordered = [...patches].sort((left, right) => (
    left.from - right.from || left.to - right.to
  ));
  if (ordered.some((patch, index) => (
    !Number.isInteger(patch.from)
    || !Number.isInteger(patch.to)
    || patch.from < 0
    || patch.to < patch.from
    || patch.to > source.length
    || (index > 0 && patch.from < ordered[index - 1]!.to)
  ))) {
    throw new TypeError('Canvas construction patches must be ordered and disjoint.');
  }
  return ordered;
}

export function canvasConstructionBatchPatchFingerprint(
  source: string,
  patches: readonly TextPatch[],
): string {
  return hashSource(JSON.stringify(patches.map((patch) => ({
    from: patch.from,
    to: patch.to,
    insert: patch.insert,
    expectedText: source.slice(patch.from, patch.to),
  }))));
}

function jsonSafeCompactPlan(plan: ConstructionPlan): JsonObject {
  return JSON.parse(
    JSON.stringify(compactCanonicalConstructionPlan(plan)),
  ) as JsonObject;
}

/**
 * Compile one Canvas gesture into one revision-bound semantic transaction.
 * Plans retain authoring order (owned input points before the final object),
 * while raw-circle adoption replacements and the insertion remain independent
 * CodeMirror changes over the same starting document.
 */
export function compileCanvasConstructionBatchProposal(input: {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly plans: readonly ConstructionPlan[];
  readonly primaryConstructionId: string;
  readonly adoptions?: readonly CanvasCircleAdoptionIntent[];
}): CanvasConstructionBatchProposal {
  const { basis } = input.geometryDoc;
  const { sourceId } = primarySourceOf(input.source, input.geometryDoc);
  const adoptions = input.adoptions ?? [];
  if (input.plans.length === 0) {
    throw new TypeError('Canvas construction batch requires at least one plan.');
  }
  if (input.plans.length > 64 || adoptions.length > 32) {
    throw new TypeError('Canvas construction batch exceeds the semantic operation limit.');
  }
  const constructionIds = [
    ...input.plans.map((plan) => plan.id),
    ...adoptions.map((adoption) => adoption.constructionId),
  ];
  if (
    constructionIds.some((id) => typeof id !== 'string' || id.length === 0)
    || new Set(constructionIds).size !== constructionIds.length
    || !input.plans.some((plan) => plan.id === input.primaryConstructionId)
    || input.plans[input.plans.length - 1]?.id !== input.primaryConstructionId
  ) {
    throw new TypeError(
      'Canvas construction IDs must be unique and include the primary plan.',
    );
  }
  const existingBlocks = parseManagedConstructionBlocks(input.source);
  if (constructionIds.some((id) => existingBlocks.some((block) => block.id === id))) {
    throw new TypeError('Canvas construction ID already exists in the current source.');
  }
  const existingEntityNames = new Set(input.geometryDoc.semantic.ir.entities.flatMap((entity) => (
    entity.name ? [entity.name] : []
  )));
  const batchEntityNames = input.plans.flatMap((plan) => (
    plan.entities.map((entity) => entity.name)
  ));
  if (
    new Set(batchEntityNames).size !== batchEntityNames.length
    || batchEntityNames.some((name) => existingEntityNames.has(name))
    || adoptions.some((adoption) => (
      adoption.managedEntityId !== 'circle'
      || !input.plans.some((plan) => plan.inputs.some((entry) => (
        entry.ref === qualifiedManagedEntityReference(
          adoption.constructionId,
          adoption.managedEntityId,
        )
      )))
    ))
  ) {
    throw new TypeError(
      'Canvas construction batch contains ambiguous entity identities or an orphaned adoption.',
    );
  }
  const inputCapabilityConflict = canvasPlanInputCapabilityConflict(
    input.source,
    input.geometryDoc,
    input.plans,
    adoptions,
  );
  if (inputCapabilityConflict) {
    throw new TypeError(`Canvas construction input capability is stale: ${inputCapabilityConflict}.`);
  }

  const planCompilations = input.plans.map((plan, planIndex) => {
    const issues = validateConstructionPlan(plan);
    if (issues.length > 0) {
      throw new TypeError(
        `Canvas construction plan ${plan.id} is invalid: ${issues[0]!.message}`,
      );
    }
    const writerIssues = validateConstructionPlanWriterSafety(plan);
    if (writerIssues.length > 0) {
      throw new TypeError(
        `Canvas construction plan ${plan.id} is not writer-safe: ${writerIssues[0]!.message}`,
      );
    }
    const footprintIssues = validateConstructionPlanSemanticFootprint(plan);
    if (footprintIssues.length > 0) {
      throw new TypeError(
        `Canvas construction plan ${plan.id} has a non-canonical semantic footprint: ${footprintIssues[0]!.path}.`,
      );
    }
    const circleCapabilityConflict = canvasPlanCircleCapabilityConflict(
      input.source,
      input.geometryDoc,
      adoptions,
      input.plans.slice(0, planIndex),
      plan,
    );
    if (circleCapabilityConflict) {
      throw new TypeError(
        `Canvas construction plan ${plan.id} has a stale circle capability: ${circleCapabilityConflict}.`,
      );
    }
    const compilation = compileNewManagedConstructionPlan(plan);
    const localSource = `${compilation.lines.join('\n')}\n`;
    const localBlocks = parseManagedConstructionBlocks(localSource);
    const decoded = localBlocks.length === 1
      ? decodeManagedConstructionPlan(localSource, localBlocks[0]!)
      : null;
    const intentionallyCompactOnly = plan.kind === 'point-on-circle'
      || plan.kind === 'tangent-at-point'
      || plan.kind === 'radical-axis';
    if (
      !intentionallyCompactOnly
      && (!decoded || !decoded.ok || decoded.presentation)
    ) {
      throw new TypeError(
        `Canvas construction plan ${plan.id} did not produce reversible canonical source.`,
      );
    }
    const proofPlan = decoded?.ok && !decoded.presentation
      ? decoded.plan
      : plan;
    const artifact = compileConstructionWriterArtifact(proofPlan);
    return { plan, proofPlan, compilation, artifact };
  });
  const insertionPatch = insertBeforeTikzEndPatch(
    input.source,
    planCompilations.flatMap(({ compilation }) => compilation.lines),
  );
  const insertionBinding = input.geometryDoc.construction.bindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  const insertionMetadata = insertionBinding?.metadata;
  const writeCapabilities = Array.isArray(insertionMetadata?.writeCapabilities)
    ? insertionMetadata.writeCapabilities
    : [];
  const capabilityFingerprint = typeof insertionMetadata?.capabilityFingerprint === 'string'
    ? insertionMetadata.capabilityFingerprint
    : null;
  if (
    !insertionBinding
    || insertionBinding.kind !== 'source-range'
    || !insertionBinding.writable
    || insertionBinding.source.document.sourceId !== sourceId
    || insertionBinding.source.document.revision !== basis.revision
    || insertionBinding.source.document.hash !== basis.sourceHash
    || insertionBinding.source.range.start !== insertionPatch.from
    || insertionBinding.source.range.end !== insertionPatch.to
    || insertionBinding.source.verbatim
      !== input.source.slice(insertionPatch.from, insertionPatch.to)
    || insertionMetadata?.purpose !== 'append-construction'
    || !writeCapabilities.includes('create-managed-construction-batch')
    || !capabilityFingerprint
  ) {
    throw new TypeError(
      'Canvas construction has no current tikzpicture body insertion capability.',
    );
  }
  const insertionCapability = {
    capability: 'create-managed-construction-batch',
    capabilityFingerprint,
    bindingId: insertionBinding.id,
    sourceId,
    sourceRevision: basis.revision,
    sourceHash: basis.sourceHash,
    range: { ...insertionBinding.source.range },
    syntaxNodeType: insertionBinding.syntaxNodeType ?? 'source-range',
    sourceFingerprint: hashSource(insertionBinding.source.verbatim),
  };

  const adoptionCapabilities: AdoptionCapability[] = [];
  const adoptionPatches = adoptions.map((adoption) => {
    const bindingId = adoption.sourceBindingId;
    const binding = input.geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === bindingId
    ));
    const entity = input.geometryDoc.semantic.ir.entities.find((candidate) => (
      candidate.id === adoption.sourceEntityId
    ));
    const range = adoption.range;
    const coincidentBindings = input.geometryDoc.construction.bindings.filter((candidate) => (
      candidate.source.document.sourceId === sourceId
      && candidate.source.range.start === range.start
      && candidate.source.range.end === range.end
    ));
    const coincidentSourceMapEntries = input.geometryDoc.sourceMap.entries.filter((entry) => (
      entry.sourceId === sourceId
      && entry.range.start === range.start
      && entry.range.end === range.end
    ));
    if (
      bindingId !== `binding:${adoption.sourceEntityId}`
      || !binding
      || !binding.writable
      || binding.targets.length !== 1
      || binding.targets[0]?.recordType !== 'entity'
      || binding.targets[0].id !== adoption.sourceEntityId
      || binding.source.document.sourceId !== sourceId
      || binding.source.document.revision !== basis.revision
      || binding.source.document.hash !== basis.sourceHash
      || binding.source.range.start !== range.start
      || binding.source.range.end !== range.end
      || range.start < 0
      || range.end <= range.start
      || range.end > input.source.length
      || binding.source.verbatim !== input.source.slice(range.start, range.end)
      || coincidentBindings.length !== 1
      || coincidentSourceMapEntries.length !== 1
      || coincidentSourceMapEntries[0]?.bindingId !== bindingId
      || !entity
      || entity.kind !== 'circle'
      || entity.metadata?.persistentSourceReference !== adoption.sourceStableId
      || !sameCircleDefinition(entity.parameters?.circleDefinition, adoption.definition)
      || existingBlocks.some((block) => (
        range.start < block.range.end && range.end > block.range.start
      ))
      || sourceRangeOverlapsManagedDirectiveRegion(input.source, range)
      || input.geometryDoc.construction.opaqueNodes.some((node) => (
        node.source.document.sourceId === sourceId
        && range.start < node.source.range.end
        && range.end > node.source.range.start
      ))
    ) {
      throw new TypeError(
        `Raw circle ${adoption.sourceStableId} has no current direct-write adoption capability.`,
      );
    }
    const sourceSlice = input.source.slice(range.start, range.end);
    const compilation = compileSourceCircleAdoption({
      id: adoption.constructionId,
      entityId: adoption.managedEntityId,
      source: sourceSlice,
      circle: adoption.definition.kind === 'center-through'
        ? {
          center: adoption.definition.centerName,
          through: adoption.definition.throughName,
        }
        : {
          center: adoption.definition.centerName,
          radius: adoption.definition.radius,
        },
    });
    adoptionCapabilities.push({
      constructionId: adoption.constructionId,
      sourceEntityId: adoption.sourceEntityId,
      managedEntityId: adoption.managedEntityId,
      sourceStableId: adoption.sourceStableId,
      bindingId,
      range: { ...range },
      sourceFingerprint: hashSource(sourceSlice),
      definition: { ...adoption.definition },
    });
    return {
      from: range.start,
      to: range.end,
      insert: compilation.lines.join('\n'),
    };
  });
  const patches = orderedDisjointPatches(
    input.source,
    [...adoptionPatches, insertionPatch],
  );
  if (
    patches.length > 65
    || patches.reduce((size, patch) => size + patch.insert.length, 0) > 1024 * 1024
  ) {
    throw new TypeError('Canvas construction batch exceeds the source patch limit.');
  }
  const candidateSource = applyTextPatches(input.source, patches);
  const candidateBlocks = parseManagedConstructionBlocks(candidateSource);
  const candidateIds = candidateBlocks.map((block) => block.id);
  if (
    new Set(candidateIds).size !== candidateIds.length
    || constructionIds.some((id) => {
      const matches = candidateBlocks.filter((block) => block.id === id);
      return matches.length !== 1
        || matches[0]!.metadataStatus !== 'valid'
        || matches[0]!.integrityStatus !== 'valid';
    })
  ) {
    throw new TypeError(
      'Canvas construction batch did not produce unique, attached managed blocks.',
    );
  }

  const patchFingerprint = canvasConstructionBatchPatchFingerprint(
    input.source,
    patches,
  );
  const planProofs = planCompilations.map(({ plan, proofPlan, artifact }) => ({
    constructionId: plan.id,
    planKind: plan.kind,
    syntaxKind: constructionPlanSyntaxKind(plan),
    compactPlan: jsonSafeCompactPlan(proofPlan),
    writerId: artifact.writerId,
    writerRevision: artifact.writerRevision,
    slotIds: artifact.slots.map((slot) => slot.id),
    slotSemanticFingerprints: artifact.slots.map((slot) => (
      slot.semanticFingerprint
    )),
  }));
  const transactionId = [
    'canvas-construction-batch',
    basis.documentId,
    basis.epoch,
    basis.revision,
    input.primaryConstructionId,
    patchFingerprint,
  ].join(':');
  const resources: GeometryResourceReference[] = patches.map((patch) => ({
    kind: 'source-range',
    sourceId,
    range: { start: patch.from, end: patch.to },
  }));
  const preconditions: GeometryPrecondition[] = patches.map((patch) => ({
    kind: 'source-slice-equals',
    sourceId,
    range: { start: patch.from, end: patch.to },
    text: input.source.slice(patch.from, patch.to),
  }));
  const deltaBeforeInsertion = adoptionPatches.reduce((delta, patch) => (
    patch.from <= insertionPatch.from
      ? delta + patch.insert.length - (patch.to - patch.from)
      : delta
  ), 0);
  const insertedStart = insertionPatch.from + deltaBeforeInsertion;

  return {
    schemaVersion: CANVAS_CONSTRUCTION_BATCH_PROPOSAL_SCHEMA_VERSION,
    insertedRange: {
      start: insertedStart,
      end: insertedStart + insertionPatch.insert.length,
    },
    transaction: {
      schemaVersion: 'geometry-transaction/v1',
      transactionId,
      idempotencyKey: transactionId,
      documentId: basis.documentId,
      documentEpoch: basis.epoch,
      origin: 'canvas',
      stage: 'validated',
      expectedRevision: basis.revision,
      sourceHash: basis.sourceHash,
      ...(basis.kernelHash ? { expectedKernelHash: basis.kernelHash } : {}),
      ...(basis.pluginSetDigest ? { pluginSetDigest: basis.pluginSetDigest } : {}),
      readSet: resources,
      writeSet: resources,
      preconditions,
      operations: [{
        operationId: `${transactionId}:source`,
        op: 'source-patch',
        patches: patches.map((patch) => ({
          sourceId,
          range: { start: patch.from, end: patch.to },
          insert: patch.insert,
          expectedText: input.source.slice(patch.from, patch.to),
        })),
        preconditions,
      }],
      metadata: {
        sourceEditOrigin: 'geometry',
        proposalSchemaVersion: CANVAS_CONSTRUCTION_BATCH_PROPOSAL_SCHEMA_VERSION,
        semanticWrite: true,
        canvasConstructionBatchProof: {
          schemaVersion: 'canvas-construction-batch-proof/v1',
          primaryConstructionId: input.primaryConstructionId,
          patchFingerprint,
          insertionCapability,
          planProofs,
          adoptionProofs: adoptionCapabilities,
        },
      },
    },
  };
}
