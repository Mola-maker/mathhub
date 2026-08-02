import type { Analysis } from '../analyze';

export type SemanticProjectionState = 'current' | 'stale' | 'unavailable';
export type ProjectionWritebackBlockedReason =
  | 'cst-error'
  | 'semantic-error'
  | 'unsafe-opaque'
  | 'no-valid-projection';

export interface ProjectionGateResult {
  current: Analysis;
  semantic: Analysis | null;
  state: SemanticProjectionState;
  semanticRevision: number | null;
  writebackAllowed: boolean;
  writebackReason: ProjectionWritebackBlockedReason | null;
}

export function isUsableSemanticProjection(
  projection: Analysis | null | undefined,
): projection is Analysis {
  return Boolean(
    projection
    && projection.status !== 'invalid'
    && projection.scene
    && projection.stmts,
  );
}

/**
 * Resolve Semantic Truth without rolling back Construction Truth.
 *
 * Invalid source remains the current document. A previous valid projection is
 * exposed only as a revision-labelled, read-only view until parsing recovers.
 */
export function resolveProjectionGate(
  current: Analysis,
  lastUsable: Analysis | null,
): ProjectionGateResult {
  if (isUsableSemanticProjection(current)) {
    const writebackAllowed = current.cst.safeForInteractiveWriteback;
    return {
      current,
      semantic: current,
      state: 'current',
      semanticRevision: current.sourceRevision,
      writebackAllowed,
      writebackReason: writebackAllowed ? null : 'unsafe-opaque',
    };
  }
  if (isUsableSemanticProjection(lastUsable)) {
    return {
      current,
      semantic: lastUsable,
      state: 'stale',
      semanticRevision: lastUsable.sourceRevision,
      writebackAllowed: false,
      writebackReason: current.cst.errorRanges.length > 0
        ? 'cst-error'
        : 'semantic-error',
    };
  }
  return {
    current,
    semantic: null,
    state: 'unavailable',
    semanticRevision: null,
    writebackAllowed: false,
    writebackReason: 'no-valid-projection',
  };
}
