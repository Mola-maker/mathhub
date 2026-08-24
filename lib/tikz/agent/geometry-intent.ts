import type { ConstructionIntent } from '../authoring/construction-intent';
import { isSafeTikzConstructionName } from '../authoring/construction-identity';
import type {
  ConstructionDagIntent,
  ConstructionDagInput,
  ConstructionDagStep,
} from '../authoring/construction-dag-intent';
import type { SelectionTransform } from '../authoring/selection-transform';
import type { GeometryAiContext } from '../ir/ai-context';
import type { AiManagedPresentationIntent } from '../ir/ai-managed-presentation-intent';
import type { AiSemanticDeleteIntent } from '../ir/ai-semantic-delete-intent';
import type { AiSelectionTransformIntent } from '../ir/ai-selection-transform-intent';
import type { HostSemanticActionBatch } from '../ir/host-semantic-action-batch';
import type { JsonObject, JsonValue } from '../ir/model';
import type { GeometryProofState } from '../semantics/geometry-proof-state';
import type { GeometryProofPlanArtifact } from '../semantics/geometry-proof-plan';
import {
  STYLE_COLORS,
  STYLE_DASHES,
  STYLE_WIDTHS,
  type StyleDraft,
} from '../patch/style-options';

export const GEOMETRY_INTENT_SCHEMA_VERSION = 'geometry-intent/v2' as const;

export type GeometryIntentStyle = Readonly<Partial<Pick<
  StyleDraft,
  | 'color'
  | 'width'
  | 'dash'
  | 'fill'
  | 'fillColor'
  | 'opacity'
  | 'drawOpacity'
  | 'lineCap'
  | 'lineJoin'
  | 'doubleLine'
>>>;

export interface GeometryConstructIntentOperation {
  readonly kind: 'construct';
  readonly toolId: string;
  /** Exact semantic IDs are preferred; unique visible names are accepted. */
  readonly inputRefs: readonly string[];
  readonly requestedNames: Readonly<Record<string, string>>;
  readonly parameters: JsonObject;
  /** Required by the host for proof-solving construction turns. */
  readonly proofContext?: GeometryIntentProofContext;
}

export type GeometryIntentProofRole =
  | 'auxiliary-construction'
  | 'goal-construction'
  | 'verification-construction';

/**
 * References a read-only proof observation from the same Agent run. The model
 * never supplies its basis, evidence records, statuses, or write authority.
 */
export interface GeometryIntentProofContext {
  readonly role: GeometryIntentProofRole;
  readonly observationCallId: string;
  readonly obligationIds: readonly string[];
}

export type GeometryConstructDagInput =
  | { readonly kind: 'entity'; readonly ref: string }
  | {
    readonly kind: 'step-output';
    readonly stepId: string;
    readonly outputKey: string;
  };

export interface GeometryConstructDagStep {
  readonly stepId: string;
  readonly toolId: string;
  readonly inputs: readonly GeometryConstructDagInput[];
  readonly requestedNames: Readonly<Record<string, string>>;
  readonly parameters: JsonObject;
}

export interface GeometryConstructDagIntentOperation {
  readonly kind: 'construct-dag';
  /** Source ordered, acyclic Catalog steps. Host allocates every output identity. */
  readonly steps: readonly GeometryConstructDagStep[];
  /** Required by the host for proof-solving construction turns. */
  readonly proofContext?: GeometryIntentProofContext;
}

export interface GeometryPresentIntentOperation {
  readonly kind: 'present';
  /** Semantic entity to style or annotate; never a source binding or range. */
  readonly targetRef: string;
  readonly style?: GeometryIntentStyle;
  readonly label?: {
    /** Existing point used as the label anchor. */
    readonly anchorRef: string;
    readonly text: string;
  };
}

export type GeometryIntentTransform =
  | {
    readonly kind: 'translate';
    readonly dx: number;
    readonly dy: number;
  }
  | {
    readonly kind: 'rotate';
    readonly degrees: number;
    /** Omit to rotate around the current rendered selection center. */
    readonly centerRef?: string;
  }
  | {
    readonly kind: 'scale';
    readonly factor: number;
    /** Omit to scale around the current rendered selection center. */
    readonly centerRef?: string;
  }
  | {
    readonly kind: 'reflect';
    readonly lineStartRef: string;
    readonly lineEndRef: string;
  };

export interface GeometryTransformIntentOperation {
  readonly kind: 'transform';
  /** Exact semantic IDs are preferred; unique visible names are accepted. */
  readonly targetRefs: readonly string[];
  readonly transform: GeometryIntentTransform;
}

export interface GeometryDeleteIntentOperation {
  readonly kind: 'delete';
  /** Exact semantic IDs are preferred; unique visible names are accepted. */
  readonly targetRefs: readonly string[];
}

/**
 * The only model-facing write language.
 *
 * It deliberately contains no revision, source range, binding, construction
 * identity, writer slot, capability fingerprint or transaction fields. The
 * host resolves those from the current revision-bound GeometryAiContext.
 */
export interface GeometryIntent {
  readonly schemaVersion: typeof GEOMETRY_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly operation:
    | GeometryConstructIntentOperation
    | GeometryConstructDagIntentOperation
    | GeometryPresentIntentOperation
    | GeometryTransformIntentOperation
    | GeometryDeleteIntentOperation;
}

export type GeometryIntentLoweredProposal =
  | ConstructionIntent
  | ConstructionDagIntent
  | AiManagedPresentationIntent
  | AiSemanticDeleteIntent
  | AiSelectionTransformIntent
  | HostSemanticActionBatch;

export interface GeometryIntentProofObservation {
  readonly callId: string;
  readonly proofState: GeometryProofState;
  readonly proofPlan: GeometryProofPlanArtifact;
}

export interface GeometryIntentLoweringOptions {
  /** Current host-owned run identity used to reject cross-run proof artifacts. */
  readonly runId?: string;
  /** Host policy derived from the user request, never from model output. */
  readonly requireProofObservation?: boolean;
  /** Successful build-proof-state observations from this same Agent run. */
  readonly proofObservations?: readonly GeometryIntentProofObservation[];
}

export type GeometryIntentLoweringResult =
  | {
    readonly ok: true;
    readonly intent: GeometryIntent;
    readonly proposal: GeometryIntentLoweredProposal;
  }
  | {
    readonly ok: false;
    readonly code:
      | 'invalid-shape'
      | 'basis-unavailable'
      | 'tool-unavailable'
      | 'reference-unresolved'
      | 'reference-ambiguous'
      | 'input-mismatch'
      | 'capability-unavailable'
      | 'target-ambiguous'
      | 'delete-invalid'
      | 'transform-invalid'
      | 'proof-observation-required'
      | 'proof-observation-invalid'
      | 'proof-obligation-contradicted';
    readonly message: string;
  };

type GeometryAiEntity = GeometryAiContext['entities'][number];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function boundedUniqueStrings(value: unknown, maximum = 64): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => boundedString(item))
    && new Set(value).size === value.length;
}

function optionalEnum(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined
    || (typeof value === 'string' && allowed.includes(value));
}

function optionalOpacity(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validStyle(value: unknown): value is GeometryIntentStyle {
  if (!record(value)) return false;
  const allowedKeys = [
    'color', 'width', 'dash', 'fill', 'fillColor', 'opacity', 'drawOpacity',
    'lineCap', 'lineJoin', 'doubleLine',
  ];
  const keys = Object.keys(value);
  return keys.length > 0
    && keys.every((key) => allowedKeys.includes(key))
    && optionalEnum(value.color, STYLE_COLORS)
    && optionalEnum(value.width, STYLE_WIDTHS)
    && optionalEnum(value.dash, STYLE_DASHES)
    && optionalEnum(value.fillColor, STYLE_COLORS)
    && (value.fill === undefined || typeof value.fill === 'boolean')
    && optionalOpacity(value.opacity)
    && optionalOpacity(value.drawOpacity)
    && optionalEnum(value.lineCap, ['round', 'rect', 'butt'])
    && optionalEnum(value.lineJoin, ['round', 'bevel', 'miter'])
    && (value.doubleLine === undefined || typeof value.doubleLine === 'boolean');
}

const SAFE_LABEL_TEXT = /^[\p{L}\p{N}\p{M}\p{Zs}\t.,:!?+\-=()\/'"\u00b7\u00b0\u00d7\u00f7_]+$/u;

function safeLabelText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && SAFE_LABEL_TEXT.test(value)
    && !value.toLowerCase().includes('@mathgeo');
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

function validJsonObject(value: unknown): value is JsonObject {
  return record(value) && validJsonValue(value, 0, { remaining: 128 });
}

function validRequestedNames(value: unknown): value is Readonly<Record<string, string>> {
  if (!record(value) || Object.keys(value).length > 32) return false;
  const entries = Object.entries(value);
  return entries.every(([key, name]) => (
    boundedString(key, 128)
    && boundedString(name, 128)
    && isSafeTikzConstructionName(name)
  )) && new Set(entries.map(([, name]) => name)).size === entries.length;
}

function requestedNamesContractConflict(
  toolId: string,
  requestedNames: Readonly<Record<string, string>>,
  declaredKeys: readonly string[],
  usedNames?: Set<string>,
): GeometryIntentLoweringResult | null {
  const undeclaredKey = Object.keys(requestedNames).find((key) => !declaredKeys.includes(key));
  if (undeclaredKey) {
    return fail(
      'input-mismatch',
      `Construction tool ${toolId} does not advertise requestedNames.${undeclaredKey}.`,
    );
  }
  if (usedNames) {
    for (const name of Object.values(requestedNames)) {
      if (usedNames.has(name)) {
        return fail(
          'input-mismatch',
          `Construction DAG requested TikZ name ${name} more than once.`,
        );
      }
      usedNames.add(name);
    }
  }
  return null;
}

const PROOF_ROLES: readonly GeometryIntentProofRole[] = [
  'auxiliary-construction',
  'goal-construction',
  'verification-construction',
];

function validProofContext(value: unknown): value is GeometryIntentProofContext {
  return record(value)
    && exactKeys(value, ['obligationIds', 'observationCallId', 'role'])
    && PROOF_ROLES.includes(value.role as GeometryIntentProofRole)
    && boundedString(value.observationCallId, 128)
    && boundedUniqueStrings(value.obligationIds, 16)
    && value.obligationIds.length > 0;
}

function validDagInput(value: unknown): value is GeometryConstructDagInput {
  if (!record(value)) return false;
  if (value.kind === 'entity') {
    return exactKeys(value, ['kind', 'ref']) && boundedString(value.ref);
  }
  return value.kind === 'step-output'
    && exactKeys(value, ['kind', 'outputKey', 'stepId'])
    && boundedString(value.stepId, 128)
    && boundedString(value.outputKey, 128);
}

function validDagStep(value: unknown): value is GeometryConstructDagStep {
  return record(value)
    && exactKeys(value, [
      'inputs', 'parameters', 'requestedNames', 'stepId', 'toolId',
    ])
    && boundedString(value.stepId, 128)
    && boundedString(value.toolId, 128)
    && Array.isArray(value.inputs)
    && value.inputs.length <= 64
    && value.inputs.every(validDagInput)
    && validRequestedNames(value.requestedNames)
    && validJsonObject(value.parameters);
}

function validTransform(value: unknown): value is GeometryIntentTransform {
  if (!record(value)) return false;
  if (value.kind === 'translate') {
    return exactKeys(value, ['dx', 'dy', 'kind'])
      && typeof value.dx === 'number'
      && Number.isFinite(value.dx)
      && typeof value.dy === 'number'
      && Number.isFinite(value.dy);
  }
  if (value.kind === 'rotate') {
    return exactKeys(value, [
      'degrees', 'kind', ...(value.centerRef === undefined ? [] : ['centerRef']),
    ])
      && typeof value.degrees === 'number'
      && Number.isFinite(value.degrees)
      && (value.centerRef === undefined || boundedString(value.centerRef));
  }
  if (value.kind === 'scale') {
    return exactKeys(value, [
      'factor', 'kind', ...(value.centerRef === undefined ? [] : ['centerRef']),
    ])
      && typeof value.factor === 'number'
      && Number.isFinite(value.factor)
      && value.factor > 0
      && (value.centerRef === undefined || boundedString(value.centerRef));
  }
  if (value.kind === 'reflect') {
    return exactKeys(value, ['kind', 'lineEndRef', 'lineStartRef'])
      && boundedString(value.lineStartRef)
      && boundedString(value.lineEndRef)
      && value.lineStartRef !== value.lineEndRef;
  }
  return false;
}

export function isGeometryIntent(value: unknown): value is GeometryIntent {
  if (
    !record(value)
    || !exactKeys(value, ['intentId', 'operation', 'schemaVersion'])
    || value.schemaVersion !== GEOMETRY_INTENT_SCHEMA_VERSION
    || !boundedString(value.intentId, 192)
    || !record(value.operation)
  ) return false;
  const operation = value.operation;
  if (operation.kind === 'construct') {
    return exactKeys(operation, [
      'inputRefs', 'kind', 'parameters', 'requestedNames', 'toolId',
      ...(operation.proofContext === undefined ? [] : ['proofContext']),
    ])
      && boundedString(operation.toolId, 128)
      && boundedUniqueStrings(operation.inputRefs)
      && validRequestedNames(operation.requestedNames)
      && validJsonObject(operation.parameters)
      && (operation.proofContext === undefined || validProofContext(operation.proofContext));
  }
  if (operation.kind === 'construct-dag') {
    if (
      !exactKeys(operation, [
        'kind', 'steps',
        ...(operation.proofContext === undefined ? [] : ['proofContext']),
      ])
      || !Array.isArray(operation.steps)
      || operation.steps.length < 2
      || operation.steps.length > 16
      || !operation.steps.every(validDagStep)
      || (operation.proofContext !== undefined && !validProofContext(operation.proofContext))
    ) return false;
    const ids = operation.steps.map((step) => step.stepId);
    if (new Set(ids).size !== ids.length) return false;
    const prior = new Set<string>();
    for (const step of operation.steps) {
      if (step.inputs.some((input) => (
        input.kind === 'step-output' && !prior.has(input.stepId)
      ))) return false;
      prior.add(step.stepId);
    }
    return true;
  }
  if (operation.kind === 'transform') {
    return exactKeys(operation, ['kind', 'targetRefs', 'transform'])
      && boundedUniqueStrings(operation.targetRefs)
      && operation.targetRefs.length > 0
      && validTransform(operation.transform);
  }
  if (operation.kind === 'delete') {
    return exactKeys(operation, ['kind', 'targetRefs'])
      && boundedUniqueStrings(operation.targetRefs)
      && operation.targetRefs.length > 0;
  }
  if (operation.kind !== 'present') return false;
  if (!exactKeys(operation, [
    'kind', 'targetRef',
    ...(operation.style === undefined ? [] : ['style']),
    ...(operation.label === undefined ? [] : ['label']),
  ])) return false;
  if (!boundedString(operation.targetRef)) return false;
  if (operation.style === undefined && operation.label === undefined) return false;
  if (operation.style !== undefined && !validStyle(operation.style)) return false;
  return operation.label === undefined || (
    record(operation.label)
    && exactKeys(operation.label, ['anchorRef', 'text'])
    && boundedString(operation.label.anchorRef)
    && safeLabelText(operation.label.text)
  );
}

function fail(
  code: Extract<GeometryIntentLoweringResult, { ok: false }>['code'],
  message: string,
): GeometryIntentLoweringResult {
  return { ok: false, code, message };
}

function proofBasisMatches(
  context: GeometryAiContext,
  proofState: GeometryProofState,
): boolean {
  const basis = proofState.basis;
  return basis.documentId === context.basis.documentId
    && basis.epoch === context.basis.epoch
    && basis.revision === context.basis.revision
    && (basis.sourceId === undefined || basis.sourceId === context.basis.sourceId)
    && basis.sourceHash === context.basis.sourceHash
    && (basis.kernelHash === undefined || basis.kernelHash === context.basis.kernelHash)
    && (basis.projectionHash === undefined
      || basis.projectionHash === context.basis.projectionHash)
    && (basis.pluginSetDigest === undefined
      || basis.pluginSetDigest === context.basis.pluginSetDigest);
}

function proofContextConflict(
  proofContext: GeometryIntentProofContext | undefined,
  context: GeometryAiContext,
  options: GeometryIntentLoweringOptions,
): GeometryIntentLoweringResult | null {
  if (!proofContext) {
    return options.requireProofObservation
      ? fail(
        'proof-observation-required',
        'This proof-solving construction requires one current build-proof-state observation.',
      )
      : null;
  }
  const matches = (options.proofObservations ?? []).filter((observation) => (
    observation.callId === proofContext.observationCallId
  ));
  if (matches.length !== 1 || !proofBasisMatches(context, matches[0]!.proofState)) {
    return fail(
      'proof-observation-invalid',
      'The referenced proof observation is absent, ambiguous, or stale for the current GeometryDoc.',
    );
  }
  const proofPlan = matches[0]!.proofPlan;
  if (
    proofPlan.schemaVersion !== 'geometry-proof-plan/v1'
    || !proofPlan.authoritativeForWrite
    || proofPlan.owner.observationCallId !== proofContext.observationCallId
    || (options.runId !== undefined && proofPlan.owner.runId !== options.runId)
    || !proofBasisMatches(context, { ...matches[0]!.proofState, basis: proofPlan.basis })
  ) {
    return fail(
      'proof-observation-invalid',
      'The proof-plan artifact is absent, non-authoritative, cross-run, or stale.',
    );
  }
  const plannedGoalIds = new Set(proofPlan.goals.map((goal) => goal.claimId));
  if (proofContext.obligationIds.some((claimId) => !plannedGoalIds.has(claimId))) {
    return fail(
      'proof-observation-invalid',
      'The proof context references an obligation absent from the immutable proof plan.',
    );
  }
  const obligations = new Map(matches[0]!.proofState.obligations.map((obligation) => (
    [obligation.claimId, obligation] as const
  )));
  const selected = proofContext.obligationIds.map((claimId) => obligations.get(claimId));
  if (selected.some((obligation) => obligation === undefined)) {
    return fail(
      'proof-observation-invalid',
      'The proof context references an obligation absent from the current observation.',
    );
  }
  if (selected.some((obligation) => (
    obligation?.status === 'counterexample' || obligation?.status === 'inconsistent'
  ))) {
    return fail(
      'proof-obligation-contradicted',
      'The requested auxiliary construction is attached to a contradicted proof obligation.',
    );
  }
  return null;
}

function scopedEntityMatches(
  context: GeometryAiContext,
  reference: string,
): readonly GeometryAiEntity[] {
  const scoped = new Set([
    ...context.focus.resolvedEntityIds,
    ...context.focus.closureEntityIds,
  ]);
  const entities = context.entities.filter((entity) => scoped.has(entity.id));
  const exact = entities.filter((entity) => entity.id === reference);
  return exact.length > 0
    ? exact
    : entities.filter((entity) => entity.name === reference);
}

function resolveEntity(
  context: GeometryAiContext,
  reference: string,
): GeometryAiEntity | GeometryIntentLoweringResult {
  const matches = scopedEntityMatches(context, reference);
  if (matches.length === 0) {
    return fail(
      'reference-unresolved',
      `Semantic reference ${reference} is absent from the current authorized geometry scope.`,
    );
  }
  if (matches.length !== 1) {
    return fail(
      'reference-ambiguous',
      `Semantic reference ${reference} is ambiguous; use one exact entity id.`,
    );
  }
  return matches[0]!;
}

function bindingForEntity(
  context: GeometryAiContext,
  entityId: string,
): GeometryAiContext['construction']['sourceBindings'][number] | null {
  const authorized = new Set(context.construction.authorizedBindingIds);
  const candidates = context.construction.sourceBindings.filter((binding) => (
    authorized.has(binding.id)
    && binding.id !== 'binding:document:tikzpicture-body-end'
    && binding.entityIds.length === 1
    && binding.entityIds[0] === entityId
  ));
  if (candidates.length === 1) return candidates[0]!;
  const records = candidates.filter((binding) => binding.managedSourceRecordId);
  if (records.length === 1) return records[0]!;
  const direct = candidates.filter((binding) => binding.id === `binding:${entityId}`);
  return direct.length === 1 ? direct[0]! : null;
}

function insertionBinding(
  context: GeometryAiContext,
): GeometryAiContext['construction']['sourceBindings'][number] | null {
  const authorized = new Set(context.construction.authorizedBindingIds);
  const matches = context.construction.sourceBindings.filter((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
    && authorized.has(binding.id)
    && binding.writable
    && binding.writeCapabilities.includes('create-managed-construction')
    && typeof binding.createCapabilityFingerprint === 'string'
    && binding.createCapabilityFingerprint.length > 0
  ));
  return matches.length === 1 ? matches[0]! : null;
}

function constructionBasis(
  context: GeometryAiContext,
): ConstructionIntent['basis'] | null {
  const basis = context.basis;
  if (
    basis.hashAlgorithm !== 'fnv1a64-utf8'
    || !basis.kernelHash
    || !basis.projectionHash
    || !basis.pluginSetDigest
  ) return null;
  return {
    documentId: basis.documentId,
    epoch: basis.epoch,
    revision: basis.revision,
    sourceId: basis.sourceId,
    sourceHash: basis.sourceHash,
    hashAlgorithm: 'fnv1a64-utf8',
    kernelHash: basis.kernelHash,
    projectionHash: basis.projectionHash,
    pluginSetDigest: basis.pluginSetDigest,
    constructionCatalogDigest: context.construction.constructionCatalogDigest,
  };
}

function lowerConstruction(
  intent: GeometryIntent,
  context: GeometryAiContext,
  options: GeometryIntentLoweringOptions,
): GeometryIntentLoweringResult {
  if (intent.operation.kind !== 'construct') {
    return fail('invalid-shape', 'Expected a construct geometry intent.');
  }
  const operation = intent.operation;
  const basis = constructionBasis(context);
  const insertion = insertionBinding(context);
  if (!basis) return fail('basis-unavailable', 'Current GeometryDoc has no complete write basis.');
  if (!insertion) {
    return fail('capability-unavailable', 'Current document has no managed construction insertion capability.');
  }
  const tool = context.construction.intentTools.find((candidate) => (
    candidate.toolId === operation.toolId
  ));
  if (!tool) {
    return fail('tool-unavailable', `Construction tool ${operation.toolId} is not advertised by the current Catalog.`);
  }
  const requestedNameConflict = requestedNamesContractConflict(
    operation.toolId,
    operation.requestedNames,
    tool.requestedNameKeys,
  );
  if (requestedNameConflict) return requestedNameConflict;
  const proofConflict = proofContextConflict(operation.proofContext, context, options);
  if (proofConflict) return proofConflict;
  if (operation.inputRefs.length < tool.minInputs || operation.inputRefs.length > tool.maxInputs) {
    return fail(
      'input-mismatch',
      `Construction tool ${operation.toolId} requires ${tool.minInputs}-${tool.maxInputs} inputs.`,
    );
  }
  const bindingIds: string[] = [];
  for (let index = 0; index < operation.inputRefs.length; index += 1) {
    const reference = operation.inputRefs[index]!;
    const resolved = resolveEntity(context, reference);
    if ('ok' in resolved) return resolved;
    const expectedKind = tool.inputKinds[index] ?? tool.repeatedInputKind;
    if (!expectedKind || resolved.kind !== expectedKind) {
      return fail(
        'input-mismatch',
        `Input ${reference} must resolve to one ${expectedKind ?? 'declared'} entity.`,
      );
    }
    const binding = bindingForEntity(context, resolved.id);
    if (!binding) {
      return fail(
        'target-ambiguous',
        `Entity ${resolved.id} has no unique authorized construction binding.`,
      );
    }
    bindingIds.push(binding.id);
  }
  if (new Set(bindingIds).size !== bindingIds.length) {
    return fail('input-mismatch', 'A construction input binding may not be reused in the same intent.');
  }
  const proposal: ConstructionIntent = {
    schemaVersion: 'construction-intent/v1',
    intentId: intent.intentId,
    idempotencyKey: intent.intentId,
    basis,
    operation: 'create',
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint: insertion.createCapabilityFingerprint!,
      scopeFingerprint: context.construction.authorizationScopeFingerprint,
    },
    toolId: operation.toolId,
    bindingIds,
    requestedNames: operation.requestedNames,
    parameters: operation.parameters,
  };
  return { ok: true, intent, proposal };
}

function lowerConstructionDag(
  intent: GeometryIntent,
  context: GeometryAiContext,
  options: GeometryIntentLoweringOptions,
): GeometryIntentLoweringResult {
  if (intent.operation.kind !== 'construct-dag') {
    return fail('invalid-shape', 'Expected a construct-dag geometry intent.');
  }
  const basis = constructionBasis(context);
  const insertion = insertionBinding(context);
  if (!basis) return fail('basis-unavailable', 'Current GeometryDoc has no complete write basis.');
  if (!insertion) {
    return fail('capability-unavailable', 'Current document has no managed construction insertion capability.');
  }
  const proofConflict = proofContextConflict(intent.operation.proofContext, context, options);
  if (proofConflict) return proofConflict;
  const priorTools = new Map<string, GeometryAiContext['construction']['intentTools'][number]>();
  const requestedTikzNames = new Set<string>();
  const steps: ConstructionDagStep[] = [];
  for (const step of intent.operation.steps) {
    const tool = context.construction.intentTools.find((candidate) => (
      candidate.toolId === step.toolId
    ));
    if (!tool) {
      return fail(
        'tool-unavailable',
        `Construction DAG tool ${step.toolId} is not advertised by the current Catalog.`,
      );
    }
    const requestedNameConflict = requestedNamesContractConflict(
      step.toolId,
      step.requestedNames,
      tool.requestedNameKeys,
      requestedTikzNames,
    );
    if (requestedNameConflict) return requestedNameConflict;
    if (step.inputs.length < tool.minInputs || step.inputs.length > tool.maxInputs) {
      return fail(
        'input-mismatch',
        `Construction DAG tool ${step.toolId} requires ${tool.minInputs}-${tool.maxInputs} inputs.`,
      );
    }
    const inputs: ConstructionDagInput[] = [];
    for (let index = 0; index < step.inputs.length; index += 1) {
      const candidate = step.inputs[index]!;
      const expectedKind = tool.inputKinds[index] ?? tool.repeatedInputKind;
      if (!expectedKind) {
        return fail(
          'input-mismatch',
          `Construction DAG tool ${step.toolId} has no input contract at ${index}.`,
        );
      }
      if (candidate.kind === 'entity') {
        const resolved = resolveEntity(context, candidate.ref);
        if ('ok' in resolved) return resolved;
        if (resolved.kind !== expectedKind) {
          return fail(
            'input-mismatch',
            `Construction DAG input ${candidate.ref} must resolve to one ${expectedKind} entity.`,
          );
        }
        const binding = bindingForEntity(context, resolved.id);
        if (!binding) {
          return fail(
            'target-ambiguous',
            `Entity ${resolved.id} has no unique authorized construction binding.`,
          );
        }
        inputs.push({ kind: 'binding', bindingId: binding.id });
        continue;
      }
      const producer = priorTools.get(candidate.stepId);
      const output = producer?.outputSlots.find((slot) => slot.key === candidate.outputKey);
      if (!producer || !output) {
        return fail(
          'input-mismatch',
          `Construction DAG output ${candidate.stepId}.${candidate.outputKey} is not advertised.`,
        );
      }
      if (output.produces !== expectedKind) {
        return fail(
          'input-mismatch',
          `Construction DAG output ${candidate.stepId}.${candidate.outputKey} produces ${output.produces}, not ${expectedKind}.`,
        );
      }
      inputs.push({
        kind: 'step-output',
        stepId: candidate.stepId,
        outputKey: candidate.outputKey,
      });
    }
    steps.push({
      stepId: step.stepId,
      toolId: step.toolId,
      inputs,
      requestedNames: step.requestedNames,
      parameters: step.parameters,
    });
    priorTools.set(step.stepId, tool);
  }
  const proposal: ConstructionDagIntent = {
    schemaVersion: 'construction-dag-intent/v1',
    intentId: intent.intentId,
    idempotencyKey: intent.intentId,
    basis,
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint: insertion.createCapabilityFingerprint!,
      scopeFingerprint: context.construction.authorizationScopeFingerprint,
    },
    steps,
  };
  return { ok: true, intent, proposal };
}

function styleProposal(
  intent: GeometryIntent,
  context: GeometryAiContext,
  target: GeometryAiEntity,
  style: GeometryIntentStyle,
): AiManagedPresentationIntent | null {
  const matches = context.construction.sourceBindings.filter((binding) => (
    context.construction.authorizedBindingIds.includes(binding.id)
    && binding.writeCapabilities.includes('update-managed-presentation')
    && typeof binding.managedConstructionId === 'string'
    && binding.managedPresentationTargets?.some((candidate) => (
      candidate.entityId === target.id
    ))
  ));
  if (matches.length !== 1) return null;
  const binding = matches[0]!;
  return {
    schemaVersion: 'managed-presentation-intent/v1',
    intentId: `${intent.intentId}:style`,
    idempotencyKey: `${intent.intentId}:style`,
    basis: context.basis,
    focusBindingIds: [binding.id],
    readBindingIds: [binding.id],
    operation: {
      kind: 'set-managed-style',
      bindingId: binding.id,
      sourceId: binding.sourceId,
      constructionId: binding.managedConstructionId!,
      targetEntityId: target.id,
      style,
    },
    rationale: 'Host-resolved GeometryIntent/v2 presentation target.',
  };
}

function labelProposal(
  intent: GeometryIntent,
  context: GeometryAiContext,
  anchor: GeometryAiEntity,
  text: string,
): ConstructionIntent | null {
  const basis = constructionBasis(context);
  const insertion = insertionBinding(context);
  const binding = bindingForEntity(context, anchor.id);
  const labelTool = context.construction.intentTools.find((tool) => (
    tool.toolId === 'label'
    && tool.parameterSchema === 'label-text'
    && tool.minInputs === 1
    && tool.maxInputs === 1
  ));
  if (!basis || !insertion || !binding || !labelTool || anchor.kind !== 'point') return null;
  return {
    schemaVersion: 'construction-intent/v1',
    intentId: `${intent.intentId}:label`,
    idempotencyKey: `${intent.intentId}:label`,
    basis,
    operation: 'create',
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint: insertion.createCapabilityFingerprint!,
      scopeFingerprint: context.construction.authorizationScopeFingerprint,
    },
    toolId: 'label',
    bindingIds: [binding.id],
    requestedNames: {},
    parameters: { text },
  };
}

function managedOwnerForEntity(
  context: GeometryAiContext,
  entityId: string,
): string | null {
  const owners = new Set(context.construction.sourceBindings.flatMap((binding) => (
    context.construction.authorizedBindingIds.includes(binding.id)
    && binding.entityIds.includes(entityId)
    && binding.managedConstructionId
      ? [binding.managedConstructionId]
      : []
  )));
  return owners.size === 1 ? [...owners][0]! : null;
}

function lowerPresentation(
  intent: GeometryIntent,
  context: GeometryAiContext,
): GeometryIntentLoweringResult {
  if (intent.operation.kind !== 'present') {
    return fail('invalid-shape', 'Expected a presentation geometry intent.');
  }
  const operation = intent.operation;
  const target = resolveEntity(context, operation.targetRef);
  if ('ok' in target) return target;
  const style = operation.style
    ? styleProposal(intent, context, target, operation.style)
    : null;
  if (operation.style && !style) {
    return fail(
      'target-ambiguous',
      `Entity ${target.id} does not own one authorized managed presentation slot.`,
    );
  }
  const anchor = operation.label
    ? resolveEntity(context, operation.label.anchorRef)
    : null;
  if (anchor && 'ok' in anchor) return anchor;
  const label = operation.label && anchor
    ? labelProposal(intent, context, anchor, operation.label.text)
    : null;
  if (operation.label && !label) {
    return fail(
      'capability-unavailable',
      'The requested label anchor has no unique authorized label construction capability.',
    );
  }
  if (operation.label && anchor && target.id !== anchor.id) {
    const targetOwner = managedOwnerForEntity(context, target.id);
    const anchorOwner = managedOwnerForEntity(context, anchor.id);
    if (!targetOwner || targetOwner !== anchorOwner) {
      return fail(
        'target-ambiguous',
        'The annotation target and label anchor must belong to the same managed construction.',
      );
    }
  }
  if (style && label) {
    const styleOwner = style.operation.constructionId;
    const labelBinding = context.construction.sourceBindings.find((binding) => (
      binding.id === label.bindingIds[0]
    ));
    if (!labelBinding?.managedConstructionId || labelBinding.managedConstructionId !== styleOwner) {
      return fail(
        'target-ambiguous',
        'Style target and label anchor must belong to the same managed construction.',
      );
    }
    const proposal: HostSemanticActionBatch = {
      schemaVersion: 'host-semantic-action-batch/v1',
      batchId: intent.intentId,
      idempotencyKey: intent.intentId,
      styleIntent: style,
      labelIntent: label,
    };
    return { ok: true, intent, proposal };
  }
  return { ok: true, intent, proposal: style ?? label! };
}

function pointPosition(
  entity: GeometryAiEntity,
): { readonly x: number; readonly y: number } | null {
  const x = entity.parameters?.x;
  const y = entity.parameters?.y;
  return entity.kind === 'point'
    && typeof x === 'number'
    && Number.isFinite(x)
    && typeof y === 'number'
    && Number.isFinite(y)
    ? { x, y }
    : null;
}

function resolvePointPosition(
  context: GeometryAiContext,
  reference: string,
): { readonly position: { readonly x: number; readonly y: number } }
  | GeometryIntentLoweringResult {
  const entity = resolveEntity(context, reference);
  if ('ok' in entity) return entity;
  const position = pointPosition(entity);
  return position
    ? { position }
    : fail(
      'transform-invalid',
      `Transform reference ${reference} must resolve to one positioned point.`,
    );
}

function lowerTransform(
  intent: GeometryIntent,
  context: GeometryAiContext,
): GeometryIntentLoweringResult {
  if (intent.operation.kind !== 'transform') {
    return fail('invalid-shape', 'Expected a transform geometry intent.');
  }
  const selectedEntityIds: string[] = [];
  for (const reference of intent.operation.targetRefs) {
    const entity = resolveEntity(context, reference);
    if ('ok' in entity) return entity;
    selectedEntityIds.push(entity.id);
  }
  if (new Set(selectedEntityIds).size !== selectedEntityIds.length) {
    return fail('target-ambiguous', 'Transform targets must resolve to distinct semantic entities.');
  }

  const requested = intent.operation.transform;
  let transform: SelectionTransform;
  if (requested.kind === 'translate') {
    transform = requested;
  } else if (requested.kind === 'rotate' || requested.kind === 'scale') {
    const center = requested.centerRef === undefined
      ? 'selection'
      : resolvePointPosition(context, requested.centerRef);
    if (center !== 'selection' && 'ok' in center) return center;
    transform = requested.kind === 'rotate'
      ? {
        kind: 'rotate',
        degrees: requested.degrees,
        center: center === 'selection' ? center : center.position,
      }
      : {
        kind: 'scale',
        factor: requested.factor,
        center: center === 'selection' ? center : center.position,
      };
  } else {
    const lineStart = resolvePointPosition(context, requested.lineStartRef);
    if ('ok' in lineStart) return lineStart;
    const lineEnd = resolvePointPosition(context, requested.lineEndRef);
    if ('ok' in lineEnd) return lineEnd;
    if (
      lineStart.position.x === lineEnd.position.x
      && lineStart.position.y === lineEnd.position.y
    ) {
      return fail('transform-invalid', 'Reflection axis points must be geometrically distinct.');
    }
    transform = {
      kind: 'reflect',
      lineStart: lineStart.position,
      lineEnd: lineEnd.position,
    };
  }

  const proposal: AiSelectionTransformIntent = {
    schemaVersion: 'ai-selection-transform-intent/v1',
    intentId: intent.intentId,
    idempotencyKey: intent.intentId,
    basis: context.basis,
    authorizationScopeFingerprint:
      context.construction.authorizationScopeFingerprint,
    selectedEntityIds,
    transform,
  };
  return { ok: true, intent, proposal };
}

function lowerDelete(
  intent: GeometryIntent,
  context: GeometryAiContext,
): GeometryIntentLoweringResult {
  if (intent.operation.kind !== 'delete') {
    return fail('invalid-shape', 'Expected a delete geometry intent.');
  }
  const selectedEntityIds: string[] = [];
  for (const reference of intent.operation.targetRefs) {
    const entity = resolveEntity(context, reference);
    if ('ok' in entity) return entity;
    selectedEntityIds.push(entity.id);
  }
  if (new Set(selectedEntityIds).size !== selectedEntityIds.length) {
    return fail('target-ambiguous', 'Delete targets must resolve to distinct semantic entities.');
  }
  const proposal: AiSemanticDeleteIntent = {
    schemaVersion: 'ai-semantic-delete-intent/v1',
    intentId: intent.intentId,
    idempotencyKey: intent.intentId,
    basis: context.basis,
    authorizationScopeFingerprint:
      context.construction.authorizationScopeFingerprint,
    selectedEntityIds,
    mode: 'block',
  };
  return { ok: true, intent, proposal };
}

export function lowerGeometryIntent(
  value: unknown,
  context: GeometryAiContext,
  options: GeometryIntentLoweringOptions = {},
): GeometryIntentLoweringResult {
  if (!isGeometryIntent(value)) {
    return fail('invalid-shape', 'GeometryIntent/v2 has an invalid or open runtime shape.');
  }
  if (value.operation.kind === 'construct') return lowerConstruction(value, context, options);
  if (value.operation.kind === 'construct-dag') return lowerConstructionDag(value, context, options);
  if (value.operation.kind === 'transform') return lowerTransform(value, context);
  if (value.operation.kind === 'delete') return lowerDelete(value, context);
  return lowerPresentation(value, context);
}
