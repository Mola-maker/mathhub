import type { GeometryEntity, JsonObject } from '../ir/model';
import type { GeometryDoc } from '../ir/geometry-doc';
import { qualifiedManagedEntityReference } from '../ir/persistent-entity-reference';
import {
  parseManagedConstructionBlocks,
  type ManagedConstructionSemanticRecord,
} from '../semantics/managed-construction';
import type { SceneCircleDefinition } from '../semantics/scene';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  constructionIntentContract,
  constructionSpecRegistry,
  createCatalogConstructionPlan,
  type ConstructionInputSlot,
} from './construction-catalog';
import { createConstructionIdentityAllocators } from './construction-identity';
import type { ConstructionIdentityAllocators } from './construction-identity';
import type {
  ConstructionPlan,
  SourceCircleAdoptionIntent,
} from './construction-ir';
import type { AuthoringAnchor } from './source-builder';
import { constructionAuthorizationScopeFingerprint } from './construction-authorization';

export const CONSTRUCTION_INTENT_SCHEMA_VERSION = 'construction-intent/v1' as const;

export interface ConstructionIntentBasis {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly hashAlgorithm: 'fnv1a64-utf8';
  readonly kernelHash: string;
  readonly projectionHash: string;
  readonly pluginSetDigest: string;
  readonly constructionCatalogDigest: string;
}

/** Public create-only wire protocol. No plan, writer, range, or managed ID is caller supplied. */
export interface ConstructionIntent {
  readonly schemaVersion: typeof CONSTRUCTION_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly basis: ConstructionIntentBasis;
  readonly operation: 'create';
  readonly capability: {
    readonly bindingId: 'binding:document:tikzpicture-body-end';
    readonly fingerprint: string;
    readonly scopeFingerprint: string;
  };
  readonly toolId: string;
  /** Ordered by the Catalog's fixed/variadic slot ABI. */
  readonly bindingIds: readonly string[];
  /** Closed keys declared by the selected tool; construction IDs remain Broker-owned. */
  readonly requestedNames: Readonly<Record<string, string>>;
  /** Immediately narrowed by the selected Catalog parameter schema. */
  readonly parameters: JsonObject;
}

export interface ConstructionIntentCompilationInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly allowedBindingIds: readonly string[];
  readonly intent: ConstructionIntent;
}

export interface ConstructionIntentCompilation {
  readonly intent: ConstructionIntent;
  readonly plan: ConstructionPlan;
  readonly inputBindingIds: readonly string[];
  readonly adoptions: readonly SourceCircleAdoptionIntent[];
}

export interface ConstructionIntentAuthority {
  readonly basis: ConstructionIntentBasis;
  readonly capability: ConstructionIntent['capability'];
}

export type ResolvedConstructionStepInput =
  | { readonly kind: 'binding'; readonly bindingId: string }
  | { readonly kind: 'anchor'; readonly anchor: AuthoringAnchor };

export interface CatalogConstructionStepCompilationInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly allowedBindingIds: readonly string[];
  readonly toolId: string;
  readonly inputs: readonly ResolvedConstructionStepInput[];
  readonly requestedNames: Readonly<Record<string, string>>;
  readonly parameters: JsonObject;
  readonly allocators: ConstructionIdentityAllocators;
  /** Reuses one raw-circle adoption when multiple DAG steps consume it. */
  readonly bindingAnchorCache?: Map<string, {
    readonly expectedKind: ConstructionInputSlot['accepts'];
    readonly anchor: AuthoringAnchor;
    readonly adoption?: SourceCircleAdoptionIntent;
  }>;
}

export interface CatalogConstructionStepCompilation {
  readonly plan: ConstructionPlan;
  readonly adoptions: readonly SourceCircleAdoptionIntent[];
}

type ManagedEntityRecord = Extract<
  ManagedConstructionSemanticRecord,
  { recordType: 'entity' }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function nonEmptyBounded(value: unknown, maximum = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= 1_000_000_000;
}

const SAFE_LABEL_TEXT = /^[\p{L}\p{N}\p{M}\p{Zs}\t.,:!?+\-=()\/'"\u00b7\u00b0\u00d7\u00f7_]+$/u;

function safeLabelText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && SAFE_LABEL_TEXT.test(value)
    && !value.toLowerCase().includes('@mathgeo');
}

export function isConstructionIntentBasis(value: unknown): value is ConstructionIntentBasis {
  if (!isRecord(value)) return false;
  return exactKeys(value, [
    'constructionCatalogDigest', 'documentId', 'epoch', 'hashAlgorithm',
    'kernelHash', 'pluginSetDigest', 'projectionHash', 'revision', 'sourceHash',
    'sourceId',
  ])
    && nonEmptyBounded(value.documentId)
    && nonEmptyBounded(value.epoch)
    && Number.isInteger(value.revision)
    && (value.revision as number) >= 0
    && nonEmptyBounded(value.sourceId)
    && nonEmptyBounded(value.sourceHash)
    && value.hashAlgorithm === 'fnv1a64-utf8'
    && nonEmptyBounded(value.kernelHash)
    && nonEmptyBounded(value.projectionHash)
    && nonEmptyBounded(value.pluginSetDigest, 4096)
    && nonEmptyBounded(value.constructionCatalogDigest);
}

export function isConstructionIntentCapability(
  value: unknown,
): value is ConstructionIntent['capability'] {
  return isRecord(value)
    && exactKeys(value, ['bindingId', 'fingerprint', 'scopeFingerprint'])
    && value.bindingId === 'binding:document:tikzpicture-body-end'
    && nonEmptyBounded(value.fingerprint)
    && nonEmptyBounded(value.scopeFingerprint);
}

export function isConstructionIntent(value: unknown): value is ConstructionIntent {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      'basis', 'bindingIds', 'capability', 'idempotencyKey', 'intentId',
      'operation', 'parameters', 'requestedNames', 'schemaVersion', 'toolId',
    ])
    || value.schemaVersion !== CONSTRUCTION_INTENT_SCHEMA_VERSION
    || value.operation !== 'create'
    || !nonEmptyBounded(value.intentId)
    || !nonEmptyBounded(value.idempotencyKey)
    || !nonEmptyBounded(value.toolId, 128)
    || !Array.isArray(value.bindingIds)
    || value.bindingIds.length > 64
    || value.bindingIds.some((id) => !nonEmptyBounded(id))
    || new Set(value.bindingIds).size !== value.bindingIds.length
    || !isRecord(value.requestedNames)
    || Object.keys(value.requestedNames).length > 32
    || Object.entries(value.requestedNames).some(([key, name]) => (
      !nonEmptyBounded(key, 128) || !nonEmptyBounded(name, 128)
    ))
    || !isRecord(value.parameters)
    || Object.keys(value.parameters).length > 32
    || !isConstructionIntentBasis(value.basis)
    || !isConstructionIntentCapability(value.capability)
  ) return false;
  return true;
}

export function assertConstructionIntentAuthority(input: {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly authority: ConstructionIntentAuthority;
}): void {
  const { basis } = input.geometryDoc;
  const intentBasis = input.authority.basis;
  const sources = input.geometryDoc.construction.sources.filter((candidate) => (
    candidate.sourceId === basis.sourceId
  ));
  if (
    sources.length !== 1
    || sources[0]!.text !== input.source
    || sources[0]!.revision !== basis.revision
    || sources[0]!.hash !== basis.sourceHash
    || sources[0]!.hashAlgorithm !== intentBasis.hashAlgorithm
    || input.geometryDoc.semantic.status !== 'complete'
    || !basis.kernelHash
    || !basis.projectionHash
    || intentBasis.documentId !== basis.documentId
    || intentBasis.epoch !== basis.epoch
    || intentBasis.revision !== basis.revision
    || intentBasis.sourceId !== basis.sourceId
    || intentBasis.sourceHash !== basis.sourceHash
    || intentBasis.kernelHash !== basis.kernelHash
    || intentBasis.projectionHash !== basis.projectionHash
    || intentBasis.pluginSetDigest !== basis.pluginSetDigest
    || intentBasis.constructionCatalogDigest !== CONSTRUCTION_CATALOG_DIGEST
  ) {
    throw new TypeError('Construction intent basis or Catalog identity is stale.');
  }
  const insertion = input.geometryDoc.construction.bindings.find((binding) => (
    binding.id === input.authority.capability.bindingId
  ));
  const capabilities = insertion?.metadata?.writeCapabilities;
  if (
    !insertion
    || !insertion.writable
    || !Array.isArray(capabilities)
    || !capabilities.includes('create-managed-construction-batch')
    || insertion.metadata?.capabilityFingerprint !== input.authority.capability.fingerprint
  ) {
    throw new TypeError('Construction intent create capability is absent or stale.');
  }
}

function entityForBinding(
  geometryDoc: GeometryDoc,
  bindingId: string,
  expectedKind: ConstructionInputSlot['accepts'],
): { entity: GeometryEntity; range: { start: number; end: number } } {
  const entry = geometryDoc.sourceMap.entries.find((candidate) => (
    candidate.bindingId === bindingId
  ));
  if (!entry) {
    throw new TypeError(`Construction binding ${bindingId} is absent from the current GeometryDoc.`);
  }
  const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
    entry.entityIds.includes(entity.id) && entity.kind === expectedKind
  ));
  if (matches.length !== 1) {
    throw new TypeError(
      `Construction binding ${bindingId} must resolve to exactly one ${expectedKind} entity.`,
    );
  }
  return { entity: matches[0] as GeometryEntity, range: entry.range };
}

function pointAnchor(entity: GeometryEntity): AuthoringAnchor {
  const x = entity.parameters?.x;
  const y = entity.parameters?.y;
  if (!entity.name || !finiteCoordinate(x) || !finiteCoordinate(y)) {
    throw new TypeError(`Point entity ${entity.id} has no unique finite named position.`);
  }
  return { name: entity.name, position: { x, y }, existing: true };
}

function managedCircleRecord(
  source: string,
  bindingId: string,
  geometryDoc: GeometryDoc,
): { constructionId: string; record: Extract<ManagedEntityRecord, { kind: 'circle' }> } | null {
  const binding = geometryDoc.construction.bindings.find((candidate) => (
    candidate.id === bindingId
  ));
  const constructionId = binding?.metadata?.constructionId;
  const sourceRecordId = binding?.metadata?.sourceRecordId;
  if (typeof constructionId !== 'string' || typeof sourceRecordId !== 'string') {
    return null;
  }
  const blocks = parseManagedConstructionBlocks(source).filter((block) => (
    block.id === constructionId
    && block.metadataStatus === 'valid'
    && block.integrityStatus === 'valid'
  ));
  const record = blocks.length === 1
    ? blocks[0]!.records.find((candidate) => (
      candidate.recordType === 'entity'
      && candidate.id === sourceRecordId
      && candidate.kind === 'circle'
    ))
    : undefined;
  if (!record || record.recordType !== 'entity' || record.kind !== 'circle') {
    throw new TypeError(`Circle binding ${bindingId} has no authoritative managed circle record.`);
  }
  return { constructionId, record };
}

function rawCircleDefinition(value: unknown): SceneCircleDefinition | null {
  if (!isRecord(value)) return null;
  if (
    value.kind === 'center-through'
    && exactKeys(value, ['centerName', 'kind', 'throughName'])
    && nonEmptyBounded(value.centerName, 128)
    && nonEmptyBounded(value.throughName, 128)
  ) {
    return {
      kind: 'center-through',
      centerName: value.centerName,
      throughName: value.throughName,
    };
  }
  if (
    value.kind === 'center-radius'
    && exactKeys(value, ['centerName', 'kind', 'radius'])
    && nonEmptyBounded(value.centerName, 128)
    && finiteCoordinate(value.radius)
    && value.radius > 0
  ) {
    return {
      kind: 'center-radius',
      centerName: value.centerName,
      radius: value.radius,
    };
  }
  return null;
}

function rawCircleAdoption(
  source: string,
  geometryDoc: GeometryDoc,
  bindingId: string,
  range: { readonly start: number; readonly end: number },
  entity: GeometryEntity,
  nextConstructionId: (prefix: string) => string,
): SourceCircleAdoptionIntent {
  const binding = geometryDoc.construction.bindings.find((candidate) => (
    candidate.id === bindingId
  ));
  const stableId = entity.metadata?.persistentSourceReference;
  const definition = rawCircleDefinition(entity.parameters?.circleDefinition);
  if (
    bindingId !== `binding:${entity.id}`
    || !binding
    || !binding.writable
    || binding.targets.length !== 1
    || binding.targets[0]?.recordType !== 'entity'
    || binding.targets[0].id !== entity.id
    || binding.source.document.sourceId !== geometryDoc.basis.sourceId
    || binding.source.document.revision !== geometryDoc.basis.revision
    || binding.source.document.hash !== geometryDoc.basis.sourceHash
    || binding.source.range.start !== range.start
    || binding.source.range.end !== range.end
    || range.start < 0
    || range.end <= range.start
    || range.end > source.length
    || binding.source.verbatim !== source.slice(range.start, range.end)
    || !nonEmptyBounded(stableId)
    || !definition
  ) {
    throw new TypeError(
      `Circle binding ${bindingId} has no current Broker-verifiable raw-circle adoption capability.`,
    );
  }
  return {
    constructionId: nextConstructionId('source-circle'),
    sourceEntityId: entity.id,
    sourceBindingId: bindingId,
    managedEntityId: 'circle',
    sourceStableId: stableId,
    range: { ...range },
    definition,
  };
}

function circleDefinition(
  record: Extract<ManagedEntityRecord, { kind: 'circle' }>,
): SceneCircleDefinition {
  // Test the value, not the key: the center-radius variant declares
  // `through?: never`, so the key can be present with an undefined value. An
  // ambiguous or degenerate circle fails closed rather than being assigned a
  // guessed definition.
  if (typeof record.through === 'string' && record.through.length > 0) {
    return {
      kind: 'center-through',
      centerName: record.center,
      throughName: record.through,
    };
  }
  if (typeof record.radius === 'number' && Number.isFinite(record.radius)) {
    return { kind: 'center-radius', centerName: record.center, radius: record.radius };
  }
  throw new TypeError(
    `Managed circle ${record.id} has neither a through point nor a finite radius.`,
  );
}

function pointPositionByName(
  geometryDoc: GeometryDoc,
  name: string,
): { x: number; y: number } {
  const matches = geometryDoc.semantic.ir.entities.filter((entity) => (
    entity.kind === 'point'
    && entity.name === name
    && finiteCoordinate(entity.parameters?.x)
    && finiteCoordinate(entity.parameters?.y)
  ));
  if (matches.length !== 1) {
    throw new TypeError(`Circle witness point ${name} is not unique in the current GeometryDoc.`);
  }
  return {
    x: matches[0]!.parameters!.x as number,
    y: matches[0]!.parameters!.y as number,
  };
}

function circleAnchor(
  source: string,
  geometryDoc: GeometryDoc,
  bindingId: string,
  range: { start: number; end: number },
  entity: GeometryEntity,
  angleDegrees: number,
  nextConstructionId: (prefix: string) => string,
): {
  readonly anchor: AuthoringAnchor;
  readonly adoption?: SourceCircleAdoptionIntent;
} {
  const managed = managedCircleRecord(source, bindingId, geometryDoc);
  const adoption = managed
    ? null
    : rawCircleAdoption(
      source,
      geometryDoc,
      bindingId,
      range,
      entity,
      nextConstructionId,
    );
  const definition = managed
    ? circleDefinition(managed.record)
    : adoption!.definition;
  const center = pointPositionByName(geometryDoc, definition.centerName);
  const throughName = definition.kind === 'center-through' ? definition.throughName : null;
  const radius = definition.kind === 'center-through'
    ? (() => {
      const through = pointPositionByName(geometryDoc, definition.throughName);
      return Math.hypot(through.x - center.x, through.y - center.y);
    })()
    : definition.radius;
  if (!Number.isFinite(radius) || radius <= 1e-8) {
    throw new TypeError(`Circle entity ${entity.id} is degenerate in the current GeometryDoc.`);
  }
  const angle = angleDegrees * Math.PI / 180;
  const stableId = managed
    ? qualifiedManagedEntityReference(managed.constructionId, managed.record.id)
    : qualifiedManagedEntityReference(
      adoption!.constructionId,
      adoption!.managedEntityId,
    );
  return {
    anchor: {
      name: `circle:${stableId}`,
      position: {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      },
      existing: true,
      circle: {
        stableId,
        semanticEntityId: entity.id,
        sourceBindingId: bindingId,
        stmtIndex: -1,
        sourceRange: range,
        centerName: definition.centerName,
        throughName,
        center,
        radius,
        angleDeg: angleDegrees,
        definition,
      },
    },
    ...(adoption ? { adoption } : {}),
  };
}

function contractParameters(
  schema: ReturnType<typeof constructionIntentContract>['parameterSchema'],
  parameters: JsonObject,
): { point?: { x: number; y: number }; angleDegrees?: number; labelText?: string } {
  if (schema === 'none') {
    if (!exactKeys(parameters, [])) throw new TypeError('This construction tool accepts no parameters.');
    return {};
  }
  if (schema === 'point-position') {
    if (
      !exactKeys(parameters, ['x', 'y'])
      || !finiteCoordinate(parameters.x)
      || !finiteCoordinate(parameters.y)
    ) throw new TypeError('Free-point intent requires finite x and y parameters.');
    return { point: { x: parameters.x, y: parameters.y } };
  }
  if (schema === 'label-text') {
    if (!exactKeys(parameters, ['text']) || !safeLabelText(parameters.text)) {
      throw new TypeError(
        'Label intent requires one bounded plain-text parameter without TeX controls or structural delimiters.',
      );
    }
    return { labelText: parameters.text };
  }
  if (!exactKeys(parameters, ['angleDegrees']) || !finiteCoordinate(parameters.angleDegrees)) {
    throw new TypeError('Circle-location intent requires one finite angleDegrees parameter.');
  }
  return { angleDegrees: parameters.angleDegrees };
}

/**
 * Compile one trusted Catalog step with a revision-shared identity allocator.
 * Binding inputs are resolved from the current GeometryDoc; anchor inputs are
 * outputs of an earlier step in the same already-topologically-validated DAG.
 */
export function compileCatalogConstructionStep(
  input: CatalogConstructionStepCompilationInput,
): CatalogConstructionStepCompilation {
  const allowed = new Set(input.allowedBindingIds);
  if (allowed.size !== input.allowedBindingIds.length) {
    throw new TypeError('Construction authorization contains duplicate binding IDs.');
  }
  const spec = constructionSpecRegistry.get(input.toolId);
  if (!spec || spec.category === 'navigate') {
    throw new TypeError(`Unknown construction tool ${input.toolId}.`);
  }
  const contract = constructionIntentContract(spec);
  if (input.inputs.length < contract.minInputs || input.inputs.length > contract.maxInputs) {
    throw new TypeError(
      `Construction tool ${spec.id} accepts ${contract.minInputs}-${contract.maxInputs} inputs.`,
    );
  }
  const requestedNameKeys = Object.keys(input.requestedNames);
  if (requestedNameKeys.some((key) => !contract.requestedNameKeys.includes(key))) {
    throw new TypeError(`Construction tool ${spec.id} received an undeclared requested name.`);
  }
  const parameters = contractParameters(contract.parameterSchema, input.parameters);
  const anchors: AuthoringAnchor[] = [];
  const adoptions: SourceCircleAdoptionIntent[] = [];
  if (contract.parameterSchema === 'point-position') {
    if (input.inputs.length !== 0) {
      throw new TypeError('Free-point construction steps may not declare semantic inputs.');
    }
    anchors.push({
      name: input.allocators.nextName('P'),
      position: parameters.point!,
      existing: false,
    });
  } else {
    input.inputs.forEach((candidate, index) => {
      const expectedKind = contract.inputKinds[index] ?? contract.repeatedInputKind;
      if (!expectedKind) {
        throw new TypeError(`Construction tool ${spec.id} has no input slot ${index}.`);
      }
      if (candidate.kind === 'anchor') {
        const isCircle = Boolean(candidate.anchor.circle);
        if (
          (expectedKind === 'circle' && !isCircle)
          || (expectedKind === 'point' && isCircle)
        ) {
          throw new TypeError(
            `Construction tool ${spec.id} input ${index} requires one ${expectedKind} output.`,
          );
        }
        anchors.push(expectedKind === 'circle'
          ? {
            ...candidate.anchor,
            circle: {
              ...candidate.anchor.circle!,
              angleDeg: parameters.angleDegrees ?? 0,
            },
          }
          : candidate.anchor);
        return;
      }
      if (!allowed.has(candidate.bindingId)) {
        throw new TypeError(
          `Construction binding ${candidate.bindingId} is outside the authorized scope.`,
        );
      }
      const cached = input.bindingAnchorCache?.get(candidate.bindingId);
      if (cached) {
        if (cached.expectedKind !== expectedKind) {
          throw new TypeError(
            `Construction binding ${candidate.bindingId} was reused with incompatible input kinds.`,
          );
        }
        anchors.push(expectedKind === 'circle'
          ? {
            ...cached.anchor,
            circle: {
              ...cached.anchor.circle!,
              angleDeg: parameters.angleDegrees ?? 0,
            },
          }
          : cached.anchor);
        return;
      }
      const resolved = entityForBinding(input.geometryDoc, candidate.bindingId, expectedKind);
      if (expectedKind === 'point') {
        const anchor = pointAnchor(resolved.entity);
        anchors.push(anchor);
        input.bindingAnchorCache?.set(candidate.bindingId, {
          expectedKind,
          anchor,
        });
        return;
      }
      const resolvedCircle = circleAnchor(
        input.source,
        input.geometryDoc,
        candidate.bindingId,
        resolved.range,
        resolved.entity,
        parameters.angleDegrees ?? 0,
        input.allocators.nextConstructionId,
      );
      anchors.push(resolvedCircle.anchor);
      if (resolvedCircle.adoption) adoptions.push(resolvedCircle.adoption);
      input.bindingAnchorCache?.set(candidate.bindingId, {
        expectedKind,
        anchor: resolvedCircle.anchor,
        ...(resolvedCircle.adoption ? { adoption: resolvedCircle.adoption } : {}),
      });
    });
  }
  const validation = spec.validate?.(anchors);
  if (validation) throw new TypeError(validation);
  const plan = createCatalogConstructionPlan(spec, {
    anchors,
    nextName: input.allocators.nextName,
    nextConstructionId: input.allocators.nextConstructionId,
    ...(parameters.labelText ? { labelText: parameters.labelText } : {}),
  });
  return { plan, adoptions };
}

export function compileConstructionIntent(
  input: ConstructionIntentCompilationInput,
): ConstructionIntentCompilation {
  if (!isConstructionIntent(input.intent)) {
    throw new TypeError('Construction intent has an invalid or open runtime shape.');
  }
  assertConstructionIntentAuthority({
    source: input.source,
    geometryDoc: input.geometryDoc,
    authority: input.intent,
  });
  const allowed = new Set(input.allowedBindingIds);
  if (!allowed.has(input.intent.capability.bindingId)) {
    throw new TypeError('Construction intent create capability is outside the authorized scope.');
  }
  const scopeFingerprint = constructionAuthorizationScopeFingerprint({
    basis: input.geometryDoc.basis,
    authorizedBindingIds: input.allowedBindingIds,
    createCapabilityFingerprint: input.intent.capability.fingerprint,
  });
  if (scopeFingerprint !== input.intent.capability.scopeFingerprint) {
    throw new TypeError('Construction intent authorization scope is stale or untrusted.');
  }
  const spec = constructionSpecRegistry.get(input.intent.toolId);
  if (!spec || spec.category === 'navigate') {
    throw new TypeError(`Unknown construction tool ${input.intent.toolId}.`);
  }
  const contract = constructionIntentContract(spec);
  const pointNames = input.geometryDoc.semantic.ir.entities.flatMap((entity) => (
    entity.name ? [entity.name] : []
  ));
  const requestedNames = contract.requestedNameKeys.map((key) => (
    input.intent.requestedNames[key]
  ));
  const allocators = createConstructionIdentityAllocators({
    source: input.source,
    pointNames,
    requestedNames,
  });
  const step = compileCatalogConstructionStep({
    source: input.source,
    geometryDoc: input.geometryDoc,
    allowedBindingIds: input.allowedBindingIds,
    toolId: input.intent.toolId,
    inputs: input.intent.bindingIds.map((bindingId) => ({
      kind: 'binding' as const,
      bindingId,
    })),
    requestedNames: input.intent.requestedNames,
    parameters: input.intent.parameters,
    allocators,
  });
  allocators.assertRequestedNamesConsumed();
  return {
    intent: input.intent,
    plan: step.plan,
    inputBindingIds: input.intent.bindingIds,
    adoptions: step.adoptions,
  };
}
