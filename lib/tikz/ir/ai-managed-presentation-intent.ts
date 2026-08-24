import {
  managedPresentationOptionSiteTarget,
} from '../authoring/managed-presentation';
import { compileConstructionWriterArtifact } from '../authoring/construction-ir';
import { decodeManagedConstructionPlan } from '../authoring/construction-plan-codec';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import {
  buildOptionsRaw,
  styleDraftFromRaw,
  STYLE_COLORS,
  STYLE_DASHES,
  STYLE_WIDTHS,
  type StyleDraft,
} from '../patch/style-options';
import { compileManagedInspectorStyleProposal } from './inspector-style-proposal';
import type {
  AiPatchCompileOptions,
  AiPatchProposalBasis,
  AiPatchValidationContext,
} from './ai-patch-proposal';
import type { GeometryTransactionRequest } from './transactions';

export const AI_MANAGED_PRESENTATION_INTENT_SCHEMA_VERSION =
  'managed-presentation-intent/v1' as const;

type ManagedStyleIntent = Readonly<Partial<Pick<
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

export interface AiManagedPresentationIntent {
  readonly schemaVersion: typeof AI_MANAGED_PRESENTATION_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly basis: AiPatchProposalBasis;
  readonly focusBindingIds: readonly string[];
  readonly readBindingIds: readonly string[];
  readonly operation: {
    readonly kind: 'set-managed-style';
    readonly bindingId: string;
    readonly sourceId: string;
    readonly constructionId: string;
    /** Semantic owner. The model never supplies source ranges or writer slots. */
    readonly targetEntityId: string;
    readonly style: ManagedStyleIntent;
  };
  readonly rationale?: string;
}

export type AiManagedPresentationIntentCompilation =
  | {
    readonly ok: true;
    readonly proposal: AiManagedPresentationIntent;
    readonly transaction: GeometryTransactionRequest;
  }
  | {
    readonly ok: false;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
  };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmpty) && new Set(value).size === value.length;
}

function optionalEnum(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || value === null || (typeof value === 'string' && allowed.includes(value));
}

function validOpacity(value: unknown): boolean {
  return value === undefined || value === null
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validStyle(value: unknown): value is ManagedStyleIntent {
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
    && validOpacity(value.opacity)
    && validOpacity(value.drawOpacity)
    && optionalEnum(value.lineCap, ['round', 'rect', 'butt'])
    && optionalEnum(value.lineJoin, ['round', 'bevel', 'miter'])
    && (value.doubleLine === undefined || typeof value.doubleLine === 'boolean');
}

function validBasis(value: unknown): value is AiPatchProposalBasis {
  if (!record(value)) return false;
  return nonEmpty(value.documentId)
    && nonEmpty(value.epoch)
    && Number.isInteger(value.revision)
    && (value.revision as number) >= 0
    && nonEmpty(value.sourceHash)
    && nonEmpty(value.sourceId)
    && nonEmpty(value.hashAlgorithm);
}

export function isAiManagedPresentationIntent(
  value: unknown,
): value is AiManagedPresentationIntent {
  if (!record(value) || !record(value.operation)) return false;
  return exactKeys(value, [
    'schemaVersion', 'intentId', 'idempotencyKey', 'basis',
    'focusBindingIds', 'readBindingIds', 'operation',
    ...(value.rationale === undefined ? [] : ['rationale']),
  ])
    && value.schemaVersion === AI_MANAGED_PRESENTATION_INTENT_SCHEMA_VERSION
    && nonEmpty(value.intentId)
    && nonEmpty(value.idempotencyKey)
    && validBasis(value.basis)
    && uniqueStrings(value.focusBindingIds)
    && uniqueStrings(value.readBindingIds)
    && exactKeys(value.operation, [
      'kind', 'bindingId', 'sourceId', 'constructionId', 'targetEntityId', 'style',
    ])
    && value.operation.kind === 'set-managed-style'
    && nonEmpty(value.operation.bindingId)
    && nonEmpty(value.operation.sourceId)
    && nonEmpty(value.operation.constructionId)
    && nonEmpty(value.operation.targetEntityId)
    && validStyle(value.operation.style)
    && (value.rationale === undefined || nonEmpty(value.rationale));
}

function sameBasis(left: AiPatchProposalBasis, right: AiPatchProposalBasis): boolean {
  return left.documentId === right.documentId
    && left.epoch === right.epoch
    && left.revision === right.revision
    && left.sourceHash === right.sourceHash
    && left.sourceId === right.sourceId
    && left.hashAlgorithm === right.hashAlgorithm
    && left.kernelHash === right.kernelHash
    && left.projectionHash === right.projectionHash
    && left.pluginSetDigest === right.pluginSetDigest;
}

function fail(code: string, message: string): AiManagedPresentationIntentCompilation {
  return { ok: false, errors: [{ code, message }] };
}

export function compileAiManagedPresentationIntent(
  value: unknown,
  context: AiPatchValidationContext & { readonly geometryDoc?: import('./geometry-doc').GeometryDoc },
  options: AiPatchCompileOptions = {},
): AiManagedPresentationIntentCompilation {
  if (!isAiManagedPresentationIntent(value)) {
    return fail('invalid-shape', 'Managed presentation intent has an invalid or open shape.');
  }
  if (!sameBasis(value.basis, context.basis) || !context.source || !context.geometryDoc) {
    return fail('basis-mismatch', 'Managed presentation intent is stale or detached from GeometryDoc.');
  }
  const binding = ('get' in context.bindings
    ? context.bindings.get(value.operation.bindingId)
    : context.bindings.find((item) => item.bindingId === value.operation.bindingId));
  if (
    !context.allowedBindingIds.includes(value.operation.bindingId)
    || !value.focusBindingIds.includes(value.operation.bindingId)
    || !value.readBindingIds.includes(value.operation.bindingId)
    || !binding
    || binding.sourceId !== value.operation.sourceId
    || binding.managedConstructionId !== value.operation.constructionId
    || !binding.writeCapabilities?.includes('update-managed-presentation')
  ) {
    return fail('binding-scope', 'Managed style target is outside the current focus capability.');
  }
  const blocks = parseManagedConstructionBlocks(context.source).filter((block) => (
    block.id === value.operation.constructionId
  ));
  const block = blocks[0];
  if (blocks.length !== 1 || !block) {
    return fail('precondition-failed', 'Managed construction is missing or ambiguous.');
  }
  const decoded = decodeManagedConstructionPlan(context.source, block);
  if (!decoded.ok) {
    return fail('presentation-conflict', 'Managed construction cannot be decoded for style editing.');
  }
  const artifact = compileConstructionWriterArtifact(decoded.plan);
  const sourceRecordIds = new Set(context.geometryDoc.construction.bindings.flatMap((candidate) => {
    const constructionId = candidate.metadata?.constructionId
      ?? candidate.metadata?.managedConstructionId;
    const sourceRecordId = candidate.metadata?.sourceRecordId;
    const entry = context.geometryDoc!.sourceMap.entries.find((item) => (
      item.bindingId === candidate.id
    ));
    return constructionId === value.operation.constructionId
      && typeof sourceRecordId === 'string'
      && entry?.entityIds.length === 1
      && entry.entityIds[0] === value.operation.targetEntityId
      ? [sourceRecordId]
      : [];
  }));
  const slots = artifact.slots.filter((slot) => (
    slot.optionSites.length === 1
    && slot.owners.some((owner) => (
      owner.startsWith('entity:')
      && sourceRecordIds.has(owner.slice('entity:'.length))
    ))
  ));
  if (slots.length !== 1) {
    return fail('target-ambiguous', 'Semantic target does not own exactly one style writer slot.');
  }
  const body = context.source.slice(block.tikzBodyRange.start, block.tikzBodyRange.end);
  const site = managedPresentationOptionSiteTarget(decoded.plan, body, slots[0]!.id);
  if (!site) return fail('presentation-conflict', 'Writer option site is unavailable.');
  const draft = styleDraftFromRaw(site.raw);
  const changedKeys = Object.keys(value.operation.style) as (keyof StyleDraft)[];
  const nextRaw = buildOptionsRaw(
    { ...draft, ...value.operation.style },
    site.raw,
    changedKeys,
  );
  const delegated = compileManagedInspectorStyleProposal({
    source: context.source,
    geometryDoc: context.geometryDoc,
    constructionId: value.operation.constructionId,
    bindingIds: [value.operation.bindingId],
    bodyPatch: {
      from: block.tikzBodyRange.start + site.from,
      to: block.tikzBodyRange.start + site.to,
      insert: `[${nextRaw}]`,
    },
  });
  return {
    ok: true,
    proposal: value,
    transaction: {
      ...delegated.transaction,
      origin: 'ai',
      actorId: options.actorId,
      correlationId: options.correlationId,
      metadata: {
        ...delegated.transaction.metadata,
        ...options.metadata,
        sourceEditOrigin: 'ai',
        proposalSchemaVersion: AI_MANAGED_PRESENTATION_INTENT_SCHEMA_VERSION,
        focusBindingIds: value.focusBindingIds,
        readBindingIds: value.readBindingIds,
        managedPresentationTargetEntityId: value.operation.targetEntityId,
      },
    },
  };
}
