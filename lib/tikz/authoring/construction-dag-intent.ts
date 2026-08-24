import type { Pt } from '../semantics/calc-eval';
import type { GeometryDoc } from '../ir/geometry-doc';
import type { JsonObject, JsonValue } from '../ir/model';
import { qualifiedManagedEntityReference } from '../ir/persistent-entity-reference';
import { constructionAuthorizationScopeFingerprint } from './construction-authorization';
import {
  constructionIntentContract,
  constructionSpecRegistry,
  type ConstructionOutputSlotContract,
} from './construction-catalog';
import { evaluateConstructionPlan } from './construction-eval';
import { createConstructionIdentityAllocatorSession } from './construction-identity';
import {
  assertConstructionIntentAuthority,
  compileCatalogConstructionStep,
  isConstructionIntentBasis,
  isConstructionIntentCapability,
  type CatalogConstructionStepCompilationInput,
  type ConstructionIntent,
  type ConstructionIntentBasis,
} from './construction-intent';
import type {
  ConstructionEntity,
  ConstructionPlan,
  SourceCircleAdoptionIntent,
} from './construction-ir';
import type { AuthoringAnchor } from './source-builder';

export const CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION =
  'construction-dag-intent/v1' as const;

export type ConstructionDagInput =
  | { readonly kind: 'binding'; readonly bindingId: string }
  | {
    readonly kind: 'step-output';
    readonly stepId: string;
    readonly outputKey: string;
  };

export interface ConstructionDagStep {
  readonly stepId: string;
  readonly toolId: string;
  readonly inputs: readonly ConstructionDagInput[];
  readonly requestedNames: Readonly<Record<string, string>>;
  readonly parameters: JsonObject;
}

/** Host-only lowering target. Models never provide basis, bindings or capability. */
export interface ConstructionDagIntent {
  readonly schemaVersion: typeof CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly basis: ConstructionIntentBasis;
  readonly capability: ConstructionIntent['capability'];
  /** Already topologically ordered by the host lowering pass. */
  readonly steps: readonly ConstructionDagStep[];
}

export interface ConstructionDagCompilationInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly allowedBindingIds: readonly string[];
  readonly intent: ConstructionDagIntent;
}

export interface ConstructionDagCompilation {
  readonly intent: ConstructionDagIntent;
  readonly plans: readonly ConstructionPlan[];
  readonly primaryConstructionId: string;
  readonly adoptions: readonly SourceCircleAdoptionIntent[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validJsonValue(
  value: unknown,
  depth: number,
  budget: { remaining: number },
): value is JsonValue {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > 5) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 512;
  if (Array.isArray(value)) {
    return value.length <= 32
      && value.every((item) => validJsonValue(item, depth + 1, budget));
  }
  if (!record(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, item]) => (
    boundedString(key, 128) && validJsonValue(item, depth + 1, budget)
  ));
}

function validNames(value: unknown): value is Readonly<Record<string, string>> {
  return record(value)
    && Object.keys(value).length <= 32
    && Object.entries(value).every(([key, name]) => (
      boundedString(key, 128) && boundedString(name, 128)
    ));
}

function isDagInput(value: unknown): value is ConstructionDagInput {
  if (!record(value)) return false;
  if (value.kind === 'binding') {
    return exactKeys(value, ['bindingId', 'kind']) && boundedString(value.bindingId);
  }
  return value.kind === 'step-output'
    && exactKeys(value, ['kind', 'outputKey', 'stepId'])
    && boundedString(value.stepId, 128)
    && boundedString(value.outputKey, 128);
}

function isDagStep(value: unknown): value is ConstructionDagStep {
  return record(value)
    && exactKeys(value, [
      'inputs', 'parameters', 'requestedNames', 'stepId', 'toolId',
    ])
    && boundedString(value.stepId, 128)
    && boundedString(value.toolId, 128)
    && Array.isArray(value.inputs)
    && value.inputs.length <= 64
    && value.inputs.every(isDagInput)
    && validNames(value.requestedNames)
    && record(value.parameters)
    && validJsonValue(value.parameters, 0, { remaining: 128 });
}

export function isConstructionDagIntent(value: unknown): value is ConstructionDagIntent {
  if (
    !record(value)
    || !exactKeys(value, [
      'basis', 'capability', 'idempotencyKey', 'intentId', 'schemaVersion', 'steps',
    ])
    || value.schemaVersion !== CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION
    || !boundedString(value.intentId)
    || !boundedString(value.idempotencyKey)
    || !isConstructionIntentBasis(value.basis)
    || !isConstructionIntentCapability(value.capability)
    || !Array.isArray(value.steps)
    || value.steps.length < 2
    || value.steps.length > 16
    || !value.steps.every(isDagStep)
  ) return false;
  const stepIds = value.steps.map((step) => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) return false;
  const prior = new Set<string>();
  for (const step of value.steps) {
    if (step.inputs.some((input) => (
      input.kind === 'step-output' && !prior.has(input.stepId)
    ))) return false;
    prior.add(step.stepId);
  }
  return true;
}

function pointFromConstructionValue(value: unknown): Pt | null {
  if (
    Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1])
  ) {
    return { x: value[0], y: value[1] };
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.x === 'number'
    && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.y)
    ? { x: candidate.x, y: candidate.y }
    : null;
}

function entityForOutput(
  plan: ConstructionPlan,
  slot: ConstructionOutputSlotContract,
): ConstructionEntity {
  const outputs = plan.outputs.filter((output) => slot.roles.includes(output.role));
  if (outputs.length !== 1) {
    throw new TypeError(
      `Construction ${plan.id} output ${slot.key} is absent or branch-ambiguous.`,
    );
  }
  const output = outputs[0]!;
  const entities = plan.entities.filter((entity) => (
    entity.id === output.ref || entity.name === output.ref
  ));
  if (entities.length !== 1 || entities[0]!.kind !== slot.produces) {
    throw new TypeError(
      `Construction ${plan.id} output ${slot.key} does not match ${slot.produces}.`,
    );
  }
  return entities[0]!;
}

function finitePoint(point: Pt | undefined): point is Pt {
  return Boolean(point) && Number.isFinite(point!.x) && Number.isFinite(point!.y);
}

function outputAnchors(
  plan: ConstructionPlan,
  slots: readonly ConstructionOutputSlotContract[],
  points: ReadonlyMap<string, Pt>,
): ReadonlyMap<string, AuthoringAnchor> {
  const evaluation = evaluateConstructionPlan(plan, points);
  if (evaluation.status === 'invalid') {
    throw new TypeError(
      `Construction ${plan.id} cannot feed the DAG: ${evaluation.diagnostics[0]?.message ?? 'invalid geometry'}.`,
    );
  }
  const combined = new Map(points);
  evaluation.points.forEach((point, name) => combined.set(name, point));
  const result = new Map<string, AuthoringAnchor>();
  for (const slot of slots) {
    const entity = entityForOutput(plan, slot);
    if (slot.produces === 'point' && entity.kind === 'point') {
      const literal = 'position' in entity
        ? pointFromConstructionValue(entity.position)
        : null;
      const position = combined.get(entity.name) ?? literal ?? undefined;
      if (!finitePoint(position)) {
        throw new TypeError(`Construction ${plan.id} point output ${slot.key} is not finite.`);
      }
      result.set(slot.key, {
        name: entity.name,
        position: { x: position.x, y: position.y },
        existing: true,
      });
      continue;
    }
    if (slot.produces !== 'circle' || entity.kind !== 'circle') {
      throw new TypeError(`Construction ${plan.id} output ${slot.key} is not DAG-addressable.`);
    }
    const center = combined.get(entity.center);
    if (!finitePoint(center)) {
      throw new TypeError(`Construction ${plan.id} circle output ${slot.key} has no finite center.`);
    }
    const throughName = typeof entity.through === 'string' ? entity.through : null;
    const through = throughName ? combined.get(throughName) : undefined;
    const radius = throughName && finitePoint(through)
      ? Math.hypot(through.x - center.x, through.y - center.y)
      : typeof entity.radius === 'number' && Number.isFinite(entity.radius)
        ? entity.radius
        : NaN;
    if (!Number.isFinite(radius) || radius <= 1e-8) {
      throw new TypeError(`Construction ${plan.id} circle output ${slot.key} is degenerate.`);
    }
    const stableId = qualifiedManagedEntityReference(plan.id, entity.id);
    result.set(slot.key, {
      name: `circle:${stableId}`,
      position: { x: center.x + radius, y: center.y },
      existing: true,
      circle: {
        stableId,
        semanticEntityId: entity.id,
        sourceBindingId: `same-batch:${plan.id}:${entity.id}`,
        stmtIndex: -1,
        centerName: entity.center,
        throughName,
        center: { x: center.x, y: center.y },
        radius,
        angleDeg: 0,
        definition: throughName
          ? { kind: 'center-through', centerName: entity.center, throughName }
          : { kind: 'center-radius', centerName: entity.center, radius },
      },
    });
  }
  return result;
}

function currentPointSnapshot(geometryDoc: GeometryDoc): Map<string, Pt> {
  const points = new Map<string, Pt>();
  for (const entity of geometryDoc.semantic.ir.entities) {
    const x = entity.parameters?.x;
    const y = entity.parameters?.y;
    if (
      entity.kind === 'point'
      && entity.name
      && typeof x === 'number'
      && Number.isFinite(x)
      && typeof y === 'number'
      && Number.isFinite(y)
    ) points.set(entity.name, { x, y });
  }
  return points;
}

export function compileConstructionDagIntent(
  input: ConstructionDagCompilationInput,
): ConstructionDagCompilation {
  if (!isConstructionDagIntent(input.intent)) {
    throw new TypeError('Construction DAG intent has an invalid, cyclic, or open shape.');
  }
  assertConstructionIntentAuthority({
    source: input.source,
    geometryDoc: input.geometryDoc,
    authority: input.intent,
  });
  const allowed = new Set(input.allowedBindingIds);
  if (
    allowed.size !== input.allowedBindingIds.length
    || !allowed.has(input.intent.capability.bindingId)
  ) {
    throw new TypeError('Construction DAG create capability is outside the authorized scope.');
  }
  const scopeFingerprint = constructionAuthorizationScopeFingerprint({
    basis: input.geometryDoc.basis,
    authorizedBindingIds: input.allowedBindingIds,
    createCapabilityFingerprint: input.intent.capability.fingerprint,
  });
  if (scopeFingerprint !== input.intent.capability.scopeFingerprint) {
    throw new TypeError('Construction DAG authorization scope is stale or untrusted.');
  }

  const identitySession = createConstructionIdentityAllocatorSession({
    source: input.source,
    pointNames: input.geometryDoc.semantic.ir.entities.flatMap((entity) => (
      entity.name ? [entity.name] : []
    )),
  });
  const bindingAnchorCache: NonNullable<
    CatalogConstructionStepCompilationInput['bindingAnchorCache']
  > = new Map();
  const stepOutputs = new Map<string, ReadonlyMap<string, AuthoringAnchor>>();
  const plans: ConstructionPlan[] = [];
  const adoptions: SourceCircleAdoptionIntent[] = [];
  const points = currentPointSnapshot(input.geometryDoc);

  for (const step of input.intent.steps) {
    const spec = constructionSpecRegistry.get(step.toolId);
    if (!spec || spec.category === 'navigate') {
      throw new TypeError(`Unknown construction DAG tool ${step.toolId}.`);
    }
    const contract = constructionIntentContract(spec);
    const allocators = identitySession.forStep(
      contract.requestedNameKeys.map((key) => step.requestedNames[key]),
    );
    const resolvedInputs = step.inputs.map((candidate) => {
      if (candidate.kind === 'binding') return candidate;
      const anchor = stepOutputs.get(candidate.stepId)?.get(candidate.outputKey);
      if (!anchor) {
        throw new TypeError(
          `Construction DAG input ${candidate.stepId}.${candidate.outputKey} is unavailable.`,
        );
      }
      return { kind: 'anchor' as const, anchor };
    });
    const compilation = compileCatalogConstructionStep({
      source: input.source,
      geometryDoc: input.geometryDoc,
      allowedBindingIds: input.allowedBindingIds,
      toolId: step.toolId,
      inputs: resolvedInputs,
      requestedNames: step.requestedNames,
      parameters: step.parameters,
      allocators,
      bindingAnchorCache,
    });
    plans.push(compilation.plan);
    adoptions.push(...compilation.adoptions);
    const outputs = outputAnchors(
      compilation.plan,
      contract.outputSlots,
      points,
    );
    outputs.forEach((anchor) => {
      if (!anchor.circle) points.set(anchor.name, anchor.position);
    });
    // Preserve every evaluator-derived helper point, not only public outputs,
    // because a later Catalog plan may encode a circle using its center and
    // through names while depending on the persistent circle output itself.
    const evaluated = evaluateConstructionPlan(compilation.plan, points);
    evaluated.points.forEach((point, name) => points.set(name, point));
    stepOutputs.set(step.stepId, outputs);
    allocators.assertRequestedNamesConsumed();
  }
  if (new Set(plans.map((plan) => plan.id)).size !== plans.length) {
    throw new TypeError('Construction DAG allocated duplicate managed construction identities.');
  }
  return {
    intent: input.intent,
    plans,
    primaryConstructionId: plans[plans.length - 1]!.id,
    adoptions,
  };
}
