'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { linter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import {
  EditorState,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import type { AnalysisIssue } from '@/lib/tikz/analyze';
import {
  studioEditOrigin,
  studioTransactionMetadata,
  type StudioDocument,
} from '@/lib/tikz/document/studio-document';
import { tikzStreamLanguage } from '@/lib/tikz/editor/tikz-stream-language';
import { parseManagedConstructionBlocks } from '@/lib/tikz/semantics/managed-construction';
import type { Statement } from '@/lib/tikz/subset/ast';

interface SourcePulse {
  id: string;
  origin: 'ai' | 'canvas' | 'style' | 'repair' | 'external';
  ranges: readonly { from: number; to: number }[];
}

const addSourcePulse = StateEffect.define<SourcePulse>();
const clearSourcePulse = StateEffect.define<string>();
const setSourceHover = StateEffect.define<{ from: number; to: number } | null>();
const setManagedMetadataExpanded = StateEffect.define<boolean>();

/**
 * Managed semantic records are persistent protocol bytes, not author-facing
 * TikZ.  The editor therefore projects each attached record run as one compact
 * placeholder by default.  The underlying EditorState document is never
 * changed, so source offsets, Broker replay and exact compilation still see
 * the canonical bytes.
 */
class ManagedMetadataSummaryWidget extends WidgetType {
  constructor(readonly recordCount: number) {
    super();
  }

  eq(other: ManagedMetadataSummaryWidget): boolean {
    return other.recordCount === this.recordCount;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'tz-source-managed-summary';
    element.textContent = `内部语义 ${this.recordCount} 条（已折叠）`;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}

interface ManagedMetadataProjection {
  readonly decorations: DecorationSet;
  readonly recordCount: number;
}

function managedMetadataProjection(source: string): ManagedMetadataProjection {
  let recordCount = 0;
  const ranges: Range<Decoration>[] = [];
  for (const block of parseManagedConstructionBlocks(source)) {
    // Detached/malformed metadata must stay visible so the author can diagnose
    // it. Only the exact, replayable projection is safe to collapse.
    if (
      block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
      || block.semanticRecordRanges.length === 0
    ) continue;
    const first = block.semanticRecordRanges[0]!;
    const last = block.semanticRecordRanges.at(-1)!;
    recordCount += block.semanticRecordRanges.length;
    ranges.push(Decoration.replace({
      block: true,
      inclusive: false,
      widget: new ManagedMetadataSummaryWidget(block.semanticRecordRanges.length),
    }).range(first.start, last.end));
  }
  return {
    decorations: Decoration.set(ranges, true),
    recordCount,
  };
}

interface ManagedMetadataDisplayState {
  readonly expanded: boolean;
  readonly decorations: DecorationSet;
}

const managedMetadataDisplayField = StateField.define<ManagedMetadataDisplayState>({
  create(state) {
    return {
      expanded: false,
      decorations: managedMetadataProjection(state.doc.toString()).decorations,
    };
  },
  update(value, transaction) {
    let expanded = value.expanded;
    for (const effect of transaction.effects) {
      if (effect.is(setManagedMetadataExpanded)) expanded = effect.value;
    }
    if (!transaction.docChanged && expanded === value.expanded) return value;
    return {
      expanded,
      decorations: expanded
        ? Decoration.none
        : managedMetadataProjection(transaction.state.doc.toString()).decorations,
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

const sourcePulseField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(addSourcePulse)) {
        const mark = Decoration.mark({
          class: `tz-source-pulse tz-source-pulse--${effect.value.origin}`,
          attributes: {
            'data-transaction-id': effect.value.id,
          },
          pulseId: effect.value.id,
        });
        const additions: Range<Decoration>[] = effect.value.ranges.map((range) => (
          mark.range(range.from, range.to)
        ));
        next = next.update({ add: additions, sort: true });
      } else if (effect.is(clearSourcePulse)) {
        const pulseId = effect.value;
        next = next.update({
          filter: (_from, _to, decoration) => decoration.spec.pulseId !== pulseId,
        });
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const sourceHoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSourceHover)) continue;
      next = effect.value
        ? Decoration.set([
          Decoration.mark({
            class: 'tz-source-hover',
          }).range(effect.value.from, effect.value.to),
        ])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function TikzCodePanel({
  document,
  issues,
  statements,
  hoveredStmtIndex,
  onHoverStatement,
}: {
  document: StudioDocument;
  issues: AnalysisIssue[];
  statements?: readonly Statement[] | null;
  hoveredStmtIndex?: number | null;
  onHoverStatement?(statementIndex: number | null): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pulseTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const documentRef = useRef(document);
  const statementsRef = useRef(statements);
  const hoverCallbackRef = useRef(onHoverStatement);
  const [managedMetadataExpanded, setManagedMetadataExpandedState] = useState(false);
  documentRef.current = document;
  statementsRef.current = statements;
  hoverCallbackRef.current = onHoverStatement;
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const activeDocument = documentRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: activeDocument.getSnapshot().source,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          tikzStreamLanguage,
          syntaxHighlighting(defaultHighlightStyle),
          sourcePulseField,
          sourceHoverField,
          managedMetadataDisplayField,
          EditorView.domEventHandlers({
            mousemove(event, currentView) {
              const position = currentView.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              });
              if (position === null) return;
              const index = statementsRef.current?.findIndex((statement) => (
                position >= statement.range.start && position <= statement.range.end
              )) ?? -1;
              hoverCallbackRef.current?.(index >= 0 ? index : null);
            },
            mouseleave() {
              hoverCallbackRef.current?.(null);
            },
          }),
          linter(() => []),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'TikZ 源码编辑器',
            spellcheck: 'false',
            autocapitalize: 'off',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const patches: Array<{ from: number; to: number; insert: string }> = [];
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              patches.push({ from: fromA, to: toA, insert: inserted.toString() });
            });
            const origin = update.transactions
              .map((transaction) => transaction.annotation(studioEditOrigin))
              .find((value) => value !== undefined) ?? 'keyboard';
            const transactionMetadata = update.transactions
              .map((transaction) => transaction.annotation(studioTransactionMetadata))
              .find((value) => value !== undefined);
            documentRef.current.commitFromEditor(
              update.state.doc.toString(),
              origin,
              update.changes.desc.toJSON(),
              patches,
              syntaxTree(update.state),
              transactionMetadata,
            );
          }),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '12px',
              backgroundColor: 'transparent',
            },
            '.cm-scroller': {
              fontFamily: 'var(--font-mono)',
              lineHeight: '1.65',
            },
            '.cm-content': { padding: '12px 0' },
            '.cm-gutters': {
              backgroundColor: 'rgba(37,31,26,0.035)',
              color: 'var(--muted)',
              borderRight: '1px solid var(--rule)',
            },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    activeDocument.setCstTree(
      syntaxTree(view.state),
      activeDocument.getSnapshot().revision,
    );
    const detach = activeDocument.attachEditor((spec) => view.dispatch(spec));
    // The Map identity never changes — it is created once by useRef — so reading
    // it here is what the cleanup wants: the timers pending at unmount, not the
    // ones that existed when this effect ran.
    const pulseTimers = pulseTimersRef.current;
    return () => {
      detach();
      for (const timer of pulseTimers.values()) clearTimeout(timer);
      pulseTimers.clear();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setManagedMetadataExpanded.of(managedMetadataExpanded),
    });
  }, [managedMetadataExpanded]);

  useEffect(() => {
    const view = viewRef.current;
    const transaction = snapshot.lastTransaction;
    if (
      !view
      || !transaction
      || transaction.origin === 'keyboard'
      || !transaction.changedRangesAfter?.length
    ) return;

    const docLength = view.state.doc.length;
    const ranges = transaction.changedRangesAfter
      .map((range) => {
        const from = Math.max(0, Math.min(range.start, docLength));
        const fallbackTo = Math.min(from + 1, docLength);
        const to = Math.max(
          from,
          Math.min(range.end > range.start ? range.end : fallbackTo, docLength),
        );
        return { from, to };
      })
      .filter((range) => range.to > range.from);
    if (ranges.length === 0) return;

    const origin = transaction.origin === 'external'
      ? 'ai'
      : transaction.origin;
    view.dispatch({
      effects: addSourcePulse.of({
        id: transaction.transactionId,
        origin,
        ranges,
      }),
    });
    const timer = setTimeout(() => {
      const currentView = viewRef.current;
      if (currentView) {
        currentView.dispatch({
          effects: clearSourcePulse.of(transaction.transactionId),
        });
      }
      pulseTimersRef.current.delete(transaction.transactionId);
    }, 1_200);
    pulseTimersRef.current.set(transaction.transactionId, timer);
  }, [snapshot.lastTransaction]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const statement = hoveredStmtIndex === null || hoveredStmtIndex === undefined
      ? null
      : statements?.[hoveredStmtIndex] ?? null;
    if (!statement) {
      view.dispatch({ effects: setSourceHover.of(null) });
      return;
    }
    const length = view.state.doc.length;
    const from = Math.max(0, Math.min(statement.range.start, length));
    const to = Math.max(from, Math.min(statement.range.end, length));
    view.dispatch({
      effects: setSourceHover.of(to > from ? { from, to } : null),
    });
  }, [hoveredStmtIndex, statements]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const length = view.state.doc.length;
    const diagnostics: Diagnostic[] = issues
      .filter((issue) => issue.range)
      .map((issue) => {
        const from = Math.max(0, Math.min(issue.range!.start, length));
        const to = Math.max(from, Math.min(Math.max(issue.range!.end, from + 1), length));
        return {
          from,
          to,
          severity: issue.severity === 'error' ? 'error' : 'warning',
          message: issue.message,
        };
      });
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [issues]);

  const managedRecordCount = useMemo(
    () => managedMetadataProjection(snapshot.source).recordCount,
    [snapshot.source],
  );

  return (
    <>
      {managedRecordCount > 0 ? (
        <div className="tz-code__metadata-toolbar" data-testid="tikz-managed-metadata-toolbar">
          <span>内部语义协议已保留，不参与普通源码阅读</span>
          <button
            type="button"
            className="tz-code__metadata-toggle"
            aria-pressed={managedMetadataExpanded}
            onClick={() => setManagedMetadataExpandedState((value) => !value)}
            title="仅切换编辑器显示；不会修改 TikZ 唯一真源"
          >
            {managedMetadataExpanded
              ? `折叠 ${managedRecordCount} 条内部语义`
              : `展开 ${managedRecordCount} 条内部语义`}
          </button>
        </div>
      ) : null}
      <div ref={hostRef} className="tz-cm" data-testid="tikz-cm" />
    </>
  );
}
