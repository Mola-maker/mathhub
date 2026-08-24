import type {
  GeometryChangeAnnotation,
  GeometryOperation,
  GeometryTransactionRequest,
  GeometryWorkspaceEdit,
} from './transactions';
import { GEOMETRY_WORKSPACE_EDIT_SCHEMA_VERSION } from './transactions';

const MAX_ANNOTATIONS = 256;
const MAX_LABEL_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 1_200;
const MAX_SEMANTIC_TARGETS = 512;
const ANNOTATION_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u;

export interface GeometryWorkspaceEditAnnotationInput
  extends GeometryChangeAnnotation {
  readonly operationId: string;
  readonly patchAnnotations?: readonly GeometryChangeAnnotation[];
}

export interface GeometryWorkspaceEditIssue {
  readonly code:
    | 'invalid-shape'
    | 'invalid-annotation'
    | 'operation-mismatch'
    | 'patch-mismatch'
    | 'unreferenced-annotation';
  readonly path: string;
  readonly message: string;
}

function annotation(
  value: GeometryChangeAnnotation,
): GeometryChangeAnnotation {
  return {
    label: value.label,
    ...(value.description ? { description: value.description } : {}),
    ...(value.needsConfirmation !== undefined
      ? { needsConfirmation: value.needsConfirmation }
      : {}),
    ...(value.semanticTargetIds
      ? { semanticTargetIds: [...value.semanticTargetIds] }
      : {}),
  };
}

/**
 * Build review metadata from the already-compiled operations.
 *
 * This function never creates or rewrites source patches. It only adds stable
 * references to the transaction's existing operation/patch order.
 */
export function createGeometryWorkspaceEdit(
  operations: readonly GeometryOperation[],
  inputs: readonly GeometryWorkspaceEditAnnotationInput[],
): GeometryWorkspaceEdit {
  if (operations.length !== inputs.length) {
    throw new Error('GeometryWorkspaceEdit requires one annotation input per operation.');
  }
  const changeAnnotations: Record<string, GeometryChangeAnnotation> = {};
  const operationAnnotations = operations.map((operation, operationIndex) => {
    const input = inputs[operationIndex];
    if (!input || input.operationId !== operation.operationId) {
      throw new Error('GeometryWorkspaceEdit annotation order must match operation order.');
    }
    const annotationId = `change-${operationIndex + 1}`;
    changeAnnotations[annotationId] = annotation(input);
    if (operation.op !== 'source-patch') {
      if (input.patchAnnotations !== undefined) {
        throw new Error('Only source-patch operations may have patch annotations.');
      }
      return { operationId: operation.operationId, annotationId };
    }
    if (input.patchAnnotations?.length !== operation.patches.length) {
      throw new Error('Source-patch annotations must match the exact patch count.');
    }
    const patchAnnotationIds = operation.patches.map((_, patchIndex) => {
      const patchAnnotationId = `${annotationId}-patch-${patchIndex + 1}`;
      changeAnnotations[patchAnnotationId] = annotation(input.patchAnnotations![patchIndex]!);
      return patchAnnotationId;
    });
    return {
      operationId: operation.operationId,
      annotationId,
      patchAnnotationIds,
    };
  });
  return {
    schemaVersion: GEOMETRY_WORKSPACE_EDIT_SCHEMA_VERSION,
    failureHandling: 'atomic',
    changeAnnotations,
    operationAnnotations,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validAnnotation(value: unknown): value is GeometryChangeAnnotation {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => ![
    'label', 'description', 'needsConfirmation', 'semanticTargetIds',
  ].includes(key))) return false;
  if (
    typeof value.label !== 'string'
    || value.label.trim().length === 0
    || value.label.length > MAX_LABEL_LENGTH
    || (value.description !== undefined && (
      typeof value.description !== 'string'
      || value.description.length > MAX_DESCRIPTION_LENGTH
    ))
    || (value.needsConfirmation !== undefined
      && typeof value.needsConfirmation !== 'boolean')
  ) return false;
  if (value.semanticTargetIds === undefined) return true;
  if (
    !Array.isArray(value.semanticTargetIds)
    || value.semanticTargetIds.length > MAX_SEMANTIC_TARGETS
    || value.semanticTargetIds.some((id) => (
      typeof id !== 'string' || id.length === 0 || id.length > 256
    ))
  ) return false;
  return new Set(value.semanticTargetIds).size === value.semanticTargetIds.length;
}

export function validateGeometryWorkspaceEdit(
  request: GeometryTransactionRequest,
): readonly GeometryWorkspaceEditIssue[] {
  const edit = request.workspaceEdit as unknown;
  if (edit === undefined) return [];
  const issues: GeometryWorkspaceEditIssue[] = [];
  if (!record(edit)) {
    return [{
      code: 'invalid-shape',
      path: 'workspaceEdit',
      message: 'GeometryWorkspaceEdit must be an object.',
    }];
  }
  if (
    edit.schemaVersion !== GEOMETRY_WORKSPACE_EDIT_SCHEMA_VERSION
    || edit.failureHandling !== 'atomic'
    || !record(edit.changeAnnotations)
    || !Array.isArray(edit.operationAnnotations)
  ) {
    issues.push({
      code: 'invalid-shape',
      path: 'workspaceEdit',
      message: 'GeometryWorkspaceEdit must use v1, atomic failure handling and closed annotation collections.',
    });
    return issues;
  }
  const annotations = edit.changeAnnotations;
  const operationAnnotations = edit.operationAnnotations;
  const annotationIds = Object.keys(annotations);
  if (
    annotationIds.length === 0
    || annotationIds.length > MAX_ANNOTATIONS
    || annotationIds.some((id) => !ANNOTATION_ID.test(id))
  ) {
    issues.push({
      code: 'invalid-annotation',
      path: 'workspaceEdit.changeAnnotations',
      message: 'Change annotation IDs/count are outside the closed v1 contract.',
    });
  }
  annotationIds.forEach((id) => {
    if (!validAnnotation(annotations[id])) {
      issues.push({
        code: 'invalid-annotation',
        path: `workspaceEdit.changeAnnotations.${id}`,
        message: 'Change annotation is malformed or exceeds its bounded fields.',
      });
    }
  });
  if (operationAnnotations.length !== request.operations.length) {
    issues.push({
      code: 'operation-mismatch',
      path: 'workspaceEdit.operationAnnotations',
      message: 'Every transaction operation must have exactly one ordered annotation entry.',
    });
    return issues;
  }
  const referenced = new Set<string>();
  const operationIds = new Set<string>();
  request.operations.forEach((operation, operationIndex) => {
    const candidate = operationAnnotations[operationIndex];
    const path = `workspaceEdit.operationAnnotations.${operationIndex}`;
    if (!record(candidate)) {
      issues.push({
        code: 'operation-mismatch', path,
        message: 'Operation annotation must be an object.',
      });
      return;
    }
    if (
      candidate.operationId !== operation.operationId
      || typeof candidate.annotationId !== 'string'
      || !Object.prototype.hasOwnProperty.call(annotations, candidate.annotationId)
      || operationIds.has(operation.operationId)
    ) {
      issues.push({
        code: 'operation-mismatch', path,
        message: 'Operation annotation does not match the compiled operation identity/order.',
      });
      return;
    }
    operationIds.add(operation.operationId);
    referenced.add(candidate.annotationId);
    if (operation.op !== 'source-patch') {
      if (candidate.patchAnnotationIds !== undefined) {
        issues.push({
          code: 'patch-mismatch', path: `${path}.patchAnnotationIds`,
          message: 'Non-source operations cannot declare patch annotations.',
        });
      }
      return;
    }
    if (
      !Array.isArray(candidate.patchAnnotationIds)
      || candidate.patchAnnotationIds.length !== operation.patches.length
    ) {
      issues.push({
        code: 'patch-mismatch', path: `${path}.patchAnnotationIds`,
        message: 'Patch annotation order/count must exactly match source patches.',
      });
      return;
    }
    candidate.patchAnnotationIds.forEach((id) => {
      if (
        typeof id !== 'string'
        || !Object.prototype.hasOwnProperty.call(annotations, id)
        || referenced.has(id)
      ) {
        issues.push({
          code: 'patch-mismatch', path: `${path}.patchAnnotationIds`,
          message: 'Patch annotation IDs must be unique and reference declared annotations.',
        });
        return;
      }
      referenced.add(id);
    });
  });
  annotationIds.forEach((id) => {
    if (!referenced.has(id)) {
      issues.push({
        code: 'unreferenced-annotation',
        path: `workspaceEdit.changeAnnotations.${id}`,
        message: 'Unreferenced change annotations are not allowed.',
      });
    }
  });
  return issues;
}
