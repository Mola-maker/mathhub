import type { SourceRange } from '../subset/ast';

/**
 * Selection identity is deliberately separate from the semantic refs used to
 * paint a highlight. Refs such as A/B may be construction inputs and must
 * never become deletion roots by accident.
 */
export type SelectionTarget =
  | {
    kind: 'entity';
    /** Revision whose semantic/source projection produced this identity. */
    sourceRevision: number;
    stableId: string;
    stmtIndex: number;
    entityKind: 'point' | 'element';
    refs: readonly string[];
    semanticEntityId?: string;
    renderPrimitiveId?: string;
    sourceBindingIds?: readonly string[];
    sourceRange?: SourceRange;
  }
  | {
    kind: 'statement';
    /** Revision whose statement/source map produced this identity. */
    sourceRevision: number;
    stmtIndex: number;
    refs: readonly string[];
    semanticEntityId?: string;
    renderPrimitiveId?: string;
    sourceBindingIds?: readonly string[];
    sourceRange?: SourceRange;
  }
  | {
    /**
     * A revision-bound source block inserted by one canvas transaction.
     * The block can contain several TikZ statements but remains one user
     * construction for selection and deletion purposes.
     */
    kind: 'source-block';
    sourceRevision: number;
    range: SourceRange;
    refs: readonly string[];
  }
  | {
    /**
     * Compatibility state used while a semantic projection catches up. It is
     * display-only and intentionally cannot be converted into a delete target.
     */
    kind: 'pending-ref';
    sourceRevision: number;
    ref: string;
  };

export function selectionRefsOf(
  targets: readonly SelectionTarget[],
): string[] {
  return [...new Set(targets.flatMap((target) => (
    target.kind === 'pending-ref' ? [target.ref] : [...target.refs]
  )))];
}

export function sourceRangesOverlap(
  first: SourceRange,
  second: SourceRange,
): boolean {
  return first.start < second.end && second.start < first.end;
}
