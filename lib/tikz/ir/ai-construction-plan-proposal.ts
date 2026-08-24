import {
  compileConstructionWriterArtifact,
  validateConstructionPlan,
  type ConstructionPoint,
  type ConstructionPlan,
} from '../authoring/construction-ir';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import { validateConstructionPlanSemanticFootprint } from '../authoring/construction-plan-footprint';
import {
  constructionPlanSyntaxKind,
  validateConstructionPlanWriterSafety,
} from '../authoring/construction-plan-codec';
import { evaluateConstructionPlan } from '../authoring/construction-eval';
import { createConstructionPreviewIR } from '../authoring/preview-ir';
import {
  managedConstructionPlanRecompilePatches,
  ManagedConstructionRecompileError,
} from '../authoring/managed-construction-recompile';
import { insertBeforeTikzEndPatch } from '../authoring/source-builder';
import {
  managedConstructionDocumentReferenceIssueKey,
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
} from '../semantics/managed-construction';
import { analyze } from '../analyze';
import type { TextPatch } from '../document/source-transaction';
import type {
  GeometryPrecondition,
  GeometryResourceReference,
  GeometryTransactionRequest,
} from './transactions';
import {
  type AiPatchBindingContext,
  type AiPatchCompileOptions,
  type AiPatchProposalBasis,
  type AiPatchValidationContext,
} from './ai-patch-proposal';

export const AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION =
  'construction-plan-proposal/v1' as const;

export type AiConstructionPlanOperation =
  | {
    readonly operationId: string;
    readonly kind: 'create-managed-construction';
    readonly bindingId: string;
    readonly sourceId: string;
    readonly plan: ConstructionPlan;
  }
  | {
    readonly operationId: string;
    readonly kind: 'replace-managed-construction';
    readonly bindingId: string;
    readonly sourceId: string;
    readonly constructionId: string;
    readonly expectedPlanKind: string;
    readonly expectedSyntaxKind: string;
    readonly expectedContentFingerprint: string;
    readonly expectedPresentationFingerprint?: string;
    readonly expectedWriterId: string;
    readonly expectedWriterRevision: number;
    readonly expectedWriterSlotIds: readonly string[];
    readonly expectedWriterSlotSemanticFingerprints: readonly string[];
    readonly expectedAttachmentsFingerprint?: string;
    readonly expectedRange: { readonly start: number; readonly end: number };
    readonly previousPlan: ConstructionPlan;
    readonly plan: ConstructionPlan;
  };

export interface AiConstructionPlanProposal {
  readonly schemaVersion: typeof AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly idempotencyKey: string;
  readonly basis: AiPatchProposalBasis;
  readonly focusBindingIds: readonly string[];
  readonly readBindingIds: readonly string[];
  readonly operation: AiConstructionPlanOperation;
  readonly rationale?: string;
}

export interface AiConstructionPlanProposalError {
  readonly code:
    | 'invalid-shape'
    | 'basis-mismatch'
    | 'binding-scope'
    | 'write-capability'
    | 'plan-invalid'
    | 'precondition-failed'
    | 'presentation-conflict'
    | 'compile-failed';
  readonly message: string;
}

export type AiConstructionPlanProposalCompilation =
  | {
    readonly ok: true;
    readonly proposal: AiConstructionPlanProposal;
    readonly transaction: GeometryTransactionRequest;
  }
  | {
    readonly ok: false;
    readonly errors: readonly AiConstructionPlanProposalError[];
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every(nonEmpty)
    && new Set(value).size === value.length;
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

type ConstructionPlanBindingContext = AiPatchBindingContext;

function isBindingContextMap(
  value: AiPatchValidationContext['bindings'],
): value is ReadonlyMap<string, AiPatchBindingContext> {
  const candidate = value as ReadonlyMap<string, AiPatchBindingContext>;
  return !Array.isArray(value)
    && typeof candidate.get === 'function'
    && typeof candidate.has === 'function';
}

function bindingMap(
  bindings: AiPatchValidationContext['bindings'],
): ReadonlyMap<string, ConstructionPlanBindingContext> {
  if (isBindingContextMap(bindings)) {
    return bindings as ReadonlyMap<string, ConstructionPlanBindingContext>;
  }
  return new Map(
    bindings.map((binding) => [binding.bindingId, binding as ConstructionPlanBindingContext]),
  );
}

function sourceRange(
  sourceId: string,
  range: { readonly start: number; readonly end: number },
): GeometryResourceReference {
  return { kind: 'source-range', sourceId, range };
}

function sourcePrecondition(
  sourceId: string,
  patch: TextPatch,
  source: string,
): GeometryPrecondition {
  return {
    kind: 'source-slice-equals',
    sourceId,
    range: { start: patch.from, end: patch.to },
    text: source.slice(patch.from, patch.to),
  };
}

function validatePlan(value: unknown): value is ConstructionPlan {
  return validateConstructionPlan(value).length === 0;
}

function operationShapeError(value: unknown): string | null {
  if (!isRecord(value)) return 'One typed construction operation is required.';
  if (!nonEmpty(value.operationId) || !nonEmpty(value.bindingId) || !nonEmpty(value.sourceId)) {
    return 'operationId, bindingId and sourceId are required.';
  }
  if (value.kind === 'create-managed-construction') {
    return value.plan === undefined ? 'create-managed-construction requires plan.' : null;
  }
  if (value.kind !== 'replace-managed-construction') {
    return 'Unsupported typed construction operation kind.';
  }
  const hasCompleteWriterProof = nonEmpty(value.expectedWriterId)
    && integer(value.expectedWriterRevision)
    && Array.isArray(value.expectedWriterSlotIds)
    && value.expectedWriterSlotIds.length > 0
    && value.expectedWriterSlotIds.every(nonEmpty)
    && Array.isArray(value.expectedWriterSlotSemanticFingerprints)
    && value.expectedWriterSlotSemanticFingerprints.length
      === value.expectedWriterSlotIds.length
    && value.expectedWriterSlotSemanticFingerprints.every(nonEmpty);
  const hasAnyPresentationProofField = value.expectedPresentationFingerprint !== undefined
    || value.expectedAttachmentsFingerprint !== undefined;
  const hasCompletePresentationProof = nonEmpty(value.expectedPresentationFingerprint)
    && nonEmpty(value.expectedAttachmentsFingerprint);
  if (
    !nonEmpty(value.constructionId)
    || !nonEmpty(value.expectedPlanKind)
    || !nonEmpty(value.expectedSyntaxKind)
    || !nonEmpty(value.expectedContentFingerprint)
    || !hasCompleteWriterProof
    || (hasAnyPresentationProofField && !hasCompletePresentationProof)
    || !isRecord(value.expectedRange)
    || !integer(value.expectedRange.start)
    || !integer(value.expectedRange.end)
    || value.expectedRange.end < value.expectedRange.start
    || value.previousPlan === undefined
    || value.plan === undefined
  ) {
    return 'replace-managed-construction requires construction identity, plan/syntax kinds, CAS range/fingerprint, previousPlan and plan.';
  }
  return null;
}

function planInputScopeError(
  plan: ConstructionPlan,
  source: string,
  revision: number,
  readBindingIds: readonly string[],
  bindings: ReadonlyMap<string, AiPatchBindingContext>,
): string | null {
  const readBindings = readBindingIds.flatMap((id) => {
    const binding = bindings.get(id);
    return binding ? [binding] : [];
  });
  const rangeIsReadable = (range: { start: number; end: number }): boolean => (
    readBindings.some((binding) => (
      binding.range.start <= range.start
      && binding.range.end >= range.end
    ))
  );
  const analysis = analyze(source, revision);
  const pointRanges = new Map<string, { start: number; end: number }>();
  analysis.scene?.points.forEach((point) => {
    const range = analysis.stmts?.[point.stmtIndex]?.range;
    if (range) pointRanges.set(point.name, range);
  });
  const managedTargets = new Map<string, { start: number; end: number }>();
  for (const block of parseManagedConstructionBlocks(source)) {
    if (block.metadataStatus !== 'valid' || block.integrityStatus !== 'valid') continue;
    for (const record of block.records) {
      if (record.recordType !== 'entity') continue;
      managedTargets.set(`managed:${block.id}:${record.id}`, block.range);
    }
  }
  for (const input of plan.inputs) {
    const range = input.ref.startsWith('managed:')
      ? managedTargets.get(input.ref)
      : pointRanges.get(input.ref);
    if (!range) {
      return `Plan input ${input.id} references ${input.ref}, which is absent from the trusted source snapshot.`;
    }
    if (!rangeIsReadable(range)) {
      return `Plan input ${input.id} references ${input.ref} outside the proposal read-binding scope.`;
    }
  }
  return null;
}

function planNamespaceConflictError(
  plan: ConstructionPlan,
  source: string,
  revision: number,
  replacementConstructionId: string | null,
): string | null {
  let compiledSource: string;
  try {
    compiledSource = [
      '\\begin{tikzpicture}',
      ...compileNewManagedConstructionPlan(plan).lines,
      '\\end{tikzpicture}',
    ].join('\n');
  } catch (error) {
    return error instanceof Error
      ? `Trusted construction writer rejected the plan: ${error.message}`
      : 'Trusted construction writer rejected the plan.';
  }
  const compiledAnalysis = analyze(compiledSource, 0);
  if (!compiledAnalysis.stmts) {
    return 'Trusted construction writer output could not be projected to the TikZ semantic subset.';
  }
  const writerCoordinates: string[] = [];
  const writerNamedPaths: string[] = [];
  for (const statement of compiledAnalysis.stmts) {
    if (statement.kind === 'coordinate' || statement.kind === 'let-coordinate') {
      writerCoordinates.push(statement.name);
      continue;
    }
    if (statement.kind !== 'path') continue;
    if (statement.namePath) writerNamedPaths.push(statement.namePath);
    for (const binding of statement.intersections?.bindings ?? []) {
      writerCoordinates.push(binding.name);
    }
  }
  const duplicateWriterCoordinate = writerCoordinates
    .find((name, index, all) => all.indexOf(name) !== index);
  if (duplicateWriterCoordinate) {
    return `Trusted construction writer defines coordinate ${duplicateWriterCoordinate} more than once.`;
  }
  const duplicateWriterNamedPath = writerNamedPaths
    .find((name, index, all) => all.indexOf(name) !== index);
  if (duplicateWriterNamedPath) {
    return `Trusted construction writer defines named path ${duplicateWriterNamedPath} more than once.`;
  }
  const declaredPointNames = new Set(
    plan.entities
      .filter((entity) => entity.kind === 'point')
      .map((entity) => entity.name),
  );
  const compilerPrivateCoordinates = new Set(
    plan.kind === 'circumcircle'
    || plan.kind === 'nine-point-circle'
    || plan.kind === 'cyclic-quadrilateral'
    || plan.kind === 'simson-line'
      ? [
        `mg-${plan.id}-m1`,
        `mg-${plan.id}-m2`,
        `mg-${plan.id}-q1`,
        `mg-${plan.id}-q2`,
        ...(plan.kind === 'nine-point-circle'
          ? [
            `mg-${plan.id}-orthocenter-o`,
            `mg-${plan.id}-orthocenter-m1`,
            `mg-${plan.id}-orthocenter-m2`,
            `mg-${plan.id}-orthocenter-q1`,
            `mg-${plan.id}-orthocenter-q2`,
          ]
          : []),
      ]
      : [],
  );
  const undeclaredWriterCoordinate = writerCoordinates.find((name) => (
    !declaredPointNames.has(name)
    && !compilerPrivateCoordinates.has(name)
  ));
  if (undeclaredWriterCoordinate) {
    return `Trusted construction writer coordinate ${undeclaredWriterCoordinate} is not declared by a semantic point entity.`;
  }
  const missingWriterCoordinate = [...declaredPointNames].find((name) => (
    !writerCoordinates.includes(name)
    || compilerPrivateCoordinates.has(name)
  ));
  if (missingWriterCoordinate) {
    return `Semantic point entity ${missingWriterCoordinate} is not defined by a matching trusted writer coordinate.`;
  }

  const analysis = analyze(source, revision);
  const managedBlocks = parseManagedConstructionBlocks(source);
  const ownedRange = replacementConstructionId === null
    ? null
    : managedBlocks.find((block) => block.id === replacementConstructionId)?.range ?? null;
  const occupied = new Map<string, string>();
  for (const statement of analysis.stmts ?? []) {
    if (
      ownedRange
      && statement.range.start >= ownedRange.start
      && statement.range.end <= ownedRange.end
    ) continue;
    if (statement.kind === 'coordinate' || statement.kind === 'let-coordinate') {
      occupied.set(statement.name, 'coordinate');
      continue;
    }
    if (statement.kind === 'path') {
      if (statement.namePath) occupied.set(statement.namePath, 'named path');
      for (const binding of statement.intersections?.bindings ?? []) {
        occupied.set(binding.name, 'intersection coordinate');
      }
    }
  }
  for (const block of managedBlocks) {
    if (
      block.id === replacementConstructionId
      || block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
    ) continue;
    for (const record of block.records) {
      if (record.recordType !== 'entity') continue;
      occupied.set(record.id, `managed entity in ${block.id}`);
      occupied.set(record.name, `managed entity in ${block.id}`);
    }
  }
  const desired = new Set([
    ...plan.entities.flatMap((entity) => [entity.id, entity.name]),
    ...plan.outputs.map((output) => output.ref),
    ...writerCoordinates,
    ...writerNamedPaths,
  ]);
  for (const name of desired) {
    const owner = occupied.get(name);
    if (owner) {
      return `Construction plan name ${name} collides with an existing ${owner} outside its owned managed block.`;
    }
  }
  return null;
}

const EVALUATED_PLAN_KINDS = new Set<ConstructionPlan['kind']>([
  'midpoint',
  'perpendicular-foot',
  'parallel-line',
  'perpendicular-line',
  'perpendicular-bisector',
  'angle-bisector',
  'circumcircle',
  'nine-point-circle',
  'simson-line',
  'fermat-point',
  'tangent-at-point',
  'reflect-point',
  'reflect-line',
  'rotate-90',
  'homothety-2',
  'inversion-point',
  'radical-axis',
  'cyclic-quadrilateral',
  'complete-quadrilateral',
]);

function isConstructionPointObject(
  point: ConstructionPoint,
): point is { readonly x: number; readonly y: number } {
  return 'x' in point && 'y' in point;
}

function planPointSnapshot(
  plan: ConstructionPlan,
  source: string,
  revision: number,
): ReadonlyMap<string, { x: number; y: number }> | null {
  const scene = analyze(source, revision).scene;
  if (!scene) return null;
  const points = new Map(
    [...scene.points.entries()].map(([name, point]) => [name, point.position] as const),
  );
  for (const entity of plan.entities) {
    if (entity.kind !== 'point' || entity.position === undefined) continue;
    const position = isConstructionPointObject(entity.position)
      ? entity.position
      : { x: entity.position[0], y: entity.position[1] };
    points.set(entity.name, { x: position.x, y: position.y });
  }
  return points;
}

function introducedDocumentReferenceError(
  previousSource: string,
  nextSource: string,
): string | null {
  const previous = new Set(
    managedConstructionDocumentReferenceIssues(previousSource)
      .map(managedConstructionDocumentReferenceIssueKey),
  );
  return managedConstructionDocumentReferenceIssues(nextSource)
    .find((item) => !previous.has(managedConstructionDocumentReferenceIssueKey(item)))
    ?.message ?? null;
}

/**
 * Compile untrusted AI semantic intent through the same ConstructionPlan
 * writer used by Canvas. Managed blocks remain raw-read-only; the trusted
 * compiler lowers this typed operation to one whole-block/source insertion.
 */
export function compileAiConstructionPlanProposal(
  value: unknown,
  context: AiPatchValidationContext,
  options: AiPatchCompileOptions = {},
): AiConstructionPlanProposalCompilation {
  const errors: AiConstructionPlanProposalError[] = [];
  if (!isRecord(value) || value.schemaVersion !== AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION) {
    return { ok: false, errors: [{ code: 'invalid-shape', message: 'Unsupported construction plan proposal.' }] };
  }
  const candidate = value as Partial<AiConstructionPlanProposal>;
  if (!nonEmpty(candidate.proposalId) || !nonEmpty(candidate.idempotencyKey)) {
    errors.push({ code: 'invalid-shape', message: 'proposalId and idempotencyKey are required.' });
  }
  if (!isRecord(candidate.basis)
    || !nonEmpty(candidate.basis.documentId)
    || !nonEmpty(candidate.basis.epoch)
    || !integer(candidate.basis.revision)
    || !nonEmpty(candidate.basis.sourceHash)
    || !nonEmpty(candidate.basis.sourceId)
    || !nonEmpty(candidate.basis.hashAlgorithm)
    || !sameBasis(candidate.basis as AiPatchProposalBasis, context.basis)) {
    errors.push({ code: 'basis-mismatch', message: 'Proposal basis is stale or belongs to another document.' });
  }
  if (!uniqueStrings(candidate.focusBindingIds) || !uniqueStrings(candidate.readBindingIds)) {
    errors.push({ code: 'binding-scope', message: 'focusBindingIds/readBindingIds must be unique string arrays.' });
  } else {
    const read = new Set(candidate.readBindingIds);
    if (candidate.focusBindingIds.some((id) => !read.has(id))) {
      errors.push({ code: 'binding-scope', message: 'focusBindingIds must be a subset of readBindingIds.' });
    }
  }
  const operationError = operationShapeError(candidate.operation);
  if (operationError) errors.push({ code: 'invalid-shape', message: operationError });
  if (errors.length > 0) return { ok: false, errors };

  const proposal = candidate as AiConstructionPlanProposal;
  const bindings = bindingMap(context.bindings);
  const allowed = new Set(context.allowedBindingIds);
  if (
    !uniqueStrings(context.allowedBindingIds)
    || proposal.readBindingIds.some((id) => !allowed.has(id) || !bindings.has(id))
    || !proposal.readBindingIds.includes(proposal.operation.bindingId)
  ) {
    errors.push({ code: 'binding-scope', message: 'Construction operation is outside the trusted read scope.' });
  }
  const binding = bindings.get(proposal.operation.bindingId);
  if (!binding || proposal.operation.sourceId !== context.basis.sourceId || binding.sourceId !== context.basis.sourceId) {
    errors.push({ code: 'binding-scope', message: 'Construction operation binding/source identity is invalid.' });
  }
  if (!validatePlan(proposal.operation.plan)) {
    const issues = validateConstructionPlan(proposal.operation.plan);
    errors.push({
      code: 'plan-invalid',
      message: issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join('; '),
    });
  } else {
    const writerIssues = validateConstructionPlanWriterSafety(proposal.operation.plan);
    if (writerIssues.length > 0) {
      errors.push({
        code: 'plan-invalid',
        message: writerIssues
          .slice(0, 8)
          .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; '),
      });
    }
    const footprintIssues = validateConstructionPlanSemanticFootprint(
      proposal.operation.plan,
    );
    if (footprintIssues.length > 0) {
      errors.push({
        code: 'plan-invalid',
        message: footprintIssues
          .slice(0, 8)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; '),
      });
    }
  }
  if (
    proposal.operation.kind === 'replace-managed-construction'
    && !validatePlan(proposal.operation.previousPlan)
  ) {
    const issues = validateConstructionPlan(proposal.operation.previousPlan);
    errors.push({
      code: 'plan-invalid',
      message: `previousPlan: ${issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    });
  } else if (proposal.operation.kind === 'replace-managed-construction') {
    const writerIssues = validateConstructionPlanWriterSafety(proposal.operation.previousPlan);
    if (writerIssues.length > 0) {
      errors.push({
        code: 'plan-invalid',
        message: `previousPlan: ${writerIssues
          .slice(0, 8)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      });
    }
    const footprintIssues = validateConstructionPlanSemanticFootprint(
      proposal.operation.previousPlan,
    );
    if (footprintIssues.length > 0) {
      errors.push({
        code: 'plan-invalid',
        message: `previousPlan: ${footprintIssues
          .slice(0, 8)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      });
    }
  }
  if (context.source === undefined) {
    errors.push({ code: 'precondition-failed', message: 'Trusted source text is required for semantic recompile.' });
  }
  if (context.source !== undefined && context.hashSource && context.hashSource(context.source) !== context.basis.sourceHash) {
    errors.push({ code: 'basis-mismatch', message: 'Trusted source does not match basis.sourceHash.' });
  }
  if (errors.length > 0 || !binding || context.source === undefined) return { ok: false, errors };

  const operation = proposal.operation;
  const inputScopeError = planInputScopeError(
    operation.plan,
    context.source,
    context.basis.revision,
    proposal.readBindingIds,
    bindings,
  );
  if (inputScopeError) {
    return {
      ok: false,
      errors: [{ code: 'binding-scope', message: inputScopeError }],
    };
  }
  const namespaceError = planNamespaceConflictError(
    operation.plan,
    context.source,
    context.basis.revision,
    operation.kind === 'replace-managed-construction'
      ? operation.constructionId
      : null,
  );
  if (namespaceError) {
    return {
      ok: false,
      errors: [{ code: 'precondition-failed', message: namespaceError }],
    };
  }
  if (
    operation.plan.kind === 'primitive'
    || operation.plan.kind === 'rectangle-by-opposite-corners'
  ) {
    const points = planPointSnapshot(
      operation.plan,
      context.source,
      context.basis.revision,
    );
    if (!points) {
      return {
        ok: false,
        errors: [{
          code: 'precondition-failed',
          message: 'Current source cannot produce the point snapshot required for Canvas preview.',
        }],
      };
    }
    const preview = createConstructionPreviewIR(operation.plan, points);
    if (preview.status !== 'valid') {
      return {
        ok: false,
        errors: [{
          code: 'plan-invalid',
          message: preview.diagnostics
            .slice(0, 8)
            .map((item) => `${item.path}: ${item.message}`)
            .join('; '),
        }],
      };
    }
  }
  if (EVALUATED_PLAN_KINDS.has(operation.plan.kind)) {
    const points = planPointSnapshot(
      operation.plan,
      context.source,
      context.basis.revision,
    );
    if (!points) {
      return {
        ok: false,
        errors: [{
          code: 'precondition-failed',
          message: 'Current source cannot produce the point snapshot required for construction evaluation.',
        }],
      };
    }
    const evaluated = evaluateConstructionPlan(operation.plan, points);
    if (evaluated.status !== 'valid') {
      return {
        ok: false,
        errors: [{
          code: 'plan-invalid',
          message: evaluated.diagnostics
            .slice(0, 8)
            .map((item) => `${item.path}: ${item.message}`)
            .join('; '),
        }],
      };
    }
  }
  let patch: TextPatch;
  try {
    if (operation.kind === 'create-managed-construction') {
      if (!binding.writeCapabilities?.includes('create-managed-construction')) {
        throw new ManagedConstructionRecompileError('Binding does not authorize managed construction creation.');
      }
      if (parseManagedConstructionBlocks(context.source).some((block) => block.id === operation.plan.id)) {
        throw new ManagedConstructionRecompileError(`Managed construction ${operation.plan.id} already exists.`);
      }
      patch = insertBeforeTikzEndPatch(
        context.source,
        compileNewManagedConstructionPlan(operation.plan).lines,
      );
    } else {
      if (!binding.writeCapabilities?.includes('replace-managed-construction')) {
        throw new ManagedConstructionRecompileError('Binding does not authorize managed construction replacement.');
      }
      if (
        binding.managedConstructionId !== operation.constructionId
        || binding.managedPlanKind !== operation.expectedPlanKind
        || binding.managedSyntaxKind !== operation.expectedSyntaxKind
        || binding.managedContentFingerprint !== operation.expectedContentFingerprint
        || binding.managedPresentationFingerprint
          !== operation.expectedPresentationFingerprint
        || binding.managedWriterId !== operation.expectedWriterId
        || binding.managedWriterRevision
          !== operation.expectedWriterRevision
        || JSON.stringify(binding.managedWriterSlotIds)
          !== JSON.stringify(operation.expectedWriterSlotIds)
        || JSON.stringify(binding.managedWriterSlotSemanticFingerprints)
          !== JSON.stringify(operation.expectedWriterSlotSemanticFingerprints)
        || binding.managedAttachmentsFingerprint
          !== operation.expectedAttachmentsFingerprint
        || binding.range.start !== operation.expectedRange.start
        || binding.range.end !== operation.expectedRange.end
      ) {
        throw new ManagedConstructionRecompileError('Managed construction binding precondition does not match the proposal.');
      }
      const previousSyntaxKind = constructionPlanSyntaxKind(operation.previousPlan);
      const nextSyntaxKind = constructionPlanSyntaxKind(operation.plan);
      if (
        operation.previousPlan.id !== operation.constructionId
        || operation.plan.id !== operation.constructionId
        || operation.previousPlan.kind !== operation.expectedPlanKind
        || operation.plan.kind !== operation.expectedPlanKind
        || previousSyntaxKind !== operation.expectedSyntaxKind
        || nextSyntaxKind !== operation.expectedSyntaxKind
      ) {
        throw new ManagedConstructionRecompileError(
          'Replacement must preserve construction identity, plan kind and concrete managed syntax kind.',
        );
      }
      const replacementPatches = managedConstructionPlanRecompilePatches(
        context.source,
        operation.constructionId,
        operation.plan,
        {
          expectedContentFingerprint: operation.expectedContentFingerprint,
          expectedRange: operation.expectedRange,
          expectedPlanKind: operation.expectedPlanKind,
          expectedCanonicalPlan: operation.previousPlan,
          expectedWriterId: operation.expectedWriterId,
          expectedWriterRevision: operation.expectedWriterRevision,
          expectedWriterSlotIds: operation.expectedWriterSlotIds,
          expectedWriterSlotSemanticFingerprints:
            operation.expectedWriterSlotSemanticFingerprints,
          ...(operation.expectedPresentationFingerprint
            ? {
              expectedPresentationFingerprint:
                operation.expectedPresentationFingerprint,
              expectedAttachmentsFingerprint:
                operation.expectedAttachmentsFingerprint!,
            }
            : {}),
        },
      );
      const replacement = replacementPatches[0];
      if (!replacement) {
        throw new ManagedConstructionRecompileError('Typed recompiler returned no source patch.');
      }
      const replacementBlocks = parseManagedConstructionBlocks(replacement.insert);
      const replacementBlock = replacementBlocks.length === 1
        ? replacementBlocks[0]
        : undefined;
      if (
        !replacementBlock
        || replacementBlock.id !== operation.constructionId
        || replacementBlock.planKind !== operation.expectedPlanKind
        || replacementBlock.kind !== operation.expectedSyntaxKind
      ) {
        throw new ManagedConstructionRecompileError(
          'Typed recompiler output did not preserve the concrete managed construction kind.',
        );
      }
      patch = replacement;
    }
  } catch (error) {
    const code = error instanceof ManagedConstructionRecompileError
      && error.code === 'presentation-conflict'
      ? 'presentation-conflict' as const
      : 'compile-failed' as const;
    return {
      ok: false,
      errors: [{
        code,
        message: error instanceof Error ? error.message : 'Construction plan compilation failed.',
      }],
    };
  }

  const nextSource = context.source.slice(0, patch.from)
    + patch.insert
    + context.source.slice(patch.to);
  const referenceError = introducedDocumentReferenceError(context.source, nextSource);
  if (referenceError) {
    return {
      ok: false,
      errors: [{ code: 'precondition-failed', message: referenceError }],
    };
  }

  const range = { start: patch.from, end: patch.to };
  const operationWriterArtifact = compileConstructionWriterArtifact(operation.plan);
  const precondition = sourcePrecondition(context.basis.sourceId, patch, context.source);
  const resource = sourceRange(context.basis.sourceId, range);
  const transaction: GeometryTransactionRequest = {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: proposal.proposalId,
    idempotencyKey: proposal.idempotencyKey,
    documentId: proposal.basis.documentId,
    documentEpoch: proposal.basis.epoch,
    origin: 'ai',
    stage: 'proposed',
    expectedRevision: proposal.basis.revision,
    sourceHash: proposal.basis.sourceHash,
    ...(options.expectedKernelHash ?? proposal.basis.kernelHash
      ? { expectedKernelHash: options.expectedKernelHash ?? proposal.basis.kernelHash }
      : {}),
    ...(proposal.basis.projectionHash
      ? { expectedProjectionHash: proposal.basis.projectionHash }
      : {}),
    ...(options.pluginSetDigest ?? proposal.basis.pluginSetDigest
      ? { pluginSetDigest: options.pluginSetDigest ?? proposal.basis.pluginSetDigest }
      : {}),
    readSet: [resource],
    writeSet: [resource],
    preconditions: [precondition],
    operations: [{
      operationId: operation.operationId,
      op: 'source-patch',
      patches: [{
        sourceId: context.basis.sourceId,
        range,
        insert: patch.insert,
        expectedText: context.source.slice(patch.from, patch.to),
      }],
      preconditions: [precondition],
    }],
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    metadata: {
      ...(options.metadata ?? {}),
      proposalSchemaVersion: AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION,
      proposalId: proposal.proposalId,
      focusBindingIds: proposal.focusBindingIds,
      readBindingIds: proposal.readBindingIds,
      bindingId: operation.bindingId,
      constructionPlanKind: operation.plan.kind,
      constructionSyntaxKind: constructionPlanSyntaxKind(operation.plan),
      constructionPlanId: operation.plan.id,
      managedConstructionOperationKind: operation.kind,
      semanticWrite: true,
      ...(operation.kind === 'replace-managed-construction'
        ? {
          managedConstructionRecompileProof: {
            schemaVersion: 'managed-construction-recompile-proof/v1',
            mode: operation.expectedPresentationFingerprint
              ? 'lossless-presentation'
              : 'canonical',
            constructionId: operation.constructionId,
            previousContentFingerprint:
              operation.expectedContentFingerprint,
            writerId: operation.expectedWriterId,
            writerRevision: operation.expectedWriterRevision,
            slotIds: operation.expectedWriterSlotIds,
            slotSemanticFingerprints:
              operation.expectedWriterSlotSemanticFingerprints,
            ...(operation.expectedPresentationFingerprint
              ? {
                presentationFingerprint:
                  operation.expectedPresentationFingerprint,
                attachmentsFingerprint:
                  operation.expectedAttachmentsFingerprint!,
              }
              : {}),
          },
        }
        : {
          managedConstructionCreateProof: {
            schemaVersion: 'managed-construction-create-proof/v1',
            constructionId: operation.plan.id,
            planKind: operation.plan.kind,
            syntaxKind: constructionPlanSyntaxKind(operation.plan),
            writerId: operationWriterArtifact.writerId,
            writerRevision: operationWriterArtifact.writerRevision,
            slotIds: operationWriterArtifact.slots.map((slot) => slot.id),
            slotSemanticFingerprints:
              operationWriterArtifact.slots.map((slot) => slot.semanticFingerprint),
          },
        }),
    },
  };
  return { ok: true, proposal, transaction };
}

export function isAiConstructionPlanProposal(
  value: unknown,
): value is AiConstructionPlanProposal {
  return isRecord(value)
    && value.schemaVersion === AI_CONSTRUCTION_PLAN_PROPOSAL_SCHEMA_VERSION;
}
