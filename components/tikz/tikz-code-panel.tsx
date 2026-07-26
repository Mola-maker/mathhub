'use client';

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { AnalysisIssue } from '@/lib/tikz/analyze';
import { tikzStreamLanguage } from '@/lib/tikz/editor/tikz-stream-language';

export function TikzCodePanel({
  code,
  issues,
  onChange,
}: {
  code: string;
  issues: AnalysisIssue[];
  onChange(next: string): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalUpdateRef = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          tikzStreamLanguage,
          syntaxHighlighting(defaultHighlightStyle),
          linter(() => []),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'TikZ 源码编辑器',
            spellcheck: 'false',
            autocapitalize: 'off',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || externalUpdateRef.current) return;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              onChangeRef.current(update.state.doc.toString());
            }, 300);
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // The editor is intentionally constructed once; prop synchronization uses
    // the effects below so selection/history survive React renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) return;
    externalUpdateRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: code },
    });
    externalUpdateRef.current = false;
  }, [code]);

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

  return <div ref={hostRef} className="tz-cm" data-testid="tikz-cm" />;
}

