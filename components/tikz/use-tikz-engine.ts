'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze, type AnalysisIssue } from '@/lib/tikz/analyze';
import { CM_TO_PX, type Viewport } from '@/lib/tikz/render/viewport';
import type { Scene } from '@/lib/tikz/semantics/scene';
import type { SourceRange, Statement } from '@/lib/tikz/subset/ast';

const EMPTY_EPHEMERAL_STYLES: Readonly<Record<string, never>> = Object.freeze({});

export interface TikzEngine {
  code: string;
  scene: Scene | null;
  stmts: Statement[] | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
  selection: string[];
  selectedStmtIndex: number | null;
  activeTool: string;
  viewport: Viewport;
  ephemeralStyles: Readonly<Record<string, never>>;
  setCode(next: string): void;
  applyPatch(next: string): void;
  setSelection(refs: string[], stmtIndex?: number | null): void;
  setActiveTool(id: string): void;
  setViewport(viewport: Viewport): void;
}

export function useTikzEngine(initialCode: string): TikzEngine {
  const [code, setCodeState] = useState(initialCode);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedStmtIndex, setSelectedStmtIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [viewport, setViewport] = useState<Viewport>({
    scale: CM_TO_PX,
    offsetX: 260,
    offsetY: 220,
  });
  const analysis = useMemo(() => analyze(code), [code]);
  const lastGood = useRef<Scene | null>(analysis.scene);

  useEffect(() => {
    if (analysis.scene) lastGood.current = analysis.scene;
  }, [analysis.scene]);

  const setCode = useCallback((next: string) => {
    setCodeState(next);
  }, []);

  const select = useCallback((refs: string[], stmtIndex: number | null = null) => {
    setSelection(refs);
    setSelectedStmtIndex(stmtIndex);
  }, []);

  return {
    code,
    scene: analysis.scene ?? lastGood.current,
    stmts: analysis.stmts,
    issues: analysis.issues,
    freePointRanges: analysis.freePointRanges,
    selection,
    selectedStmtIndex,
    activeTool,
    viewport,
    ephemeralStyles: EMPTY_EPHEMERAL_STYLES,
    setCode,
    applyPatch: setCode,
    setSelection: select,
    setActiveTool,
    setViewport,
  };
}
