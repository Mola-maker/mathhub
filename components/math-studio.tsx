'use client';

// Math Studio assistant with a fullscreen GeoGebra workspace.
// Inline: a launcher (provider pills + "Open Studio" button).
// Studio: a fullscreen overlay — chat sidebar (slash commands, KaTeX panel) +
// GeoGebra with all native tools.
//
// Rendering flow: ONE "build" call turns the construction steps into a GeoGebra
// script (server injects relevant OFFICIAL command signatures); the live applet
// executes it (the validator); any per-command errors GeoGebra returns drive a
// bounded "repair" call. Robustness comes from the real engine + repair loop —
// not extra LLM passes.

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { parseGgbBlock, triangleCenterFallbacks, mergeGgbScripts } from '@/lib/math/geogebra-commands';
import { isGgbModuleRaceError, type GgbApiLike } from '@/lib/math/geogebra-eval';
import { renderWithRepair, type CommandFailure } from '@/lib/math/geometry-render/run-script';
import { assistantDisplayText, extractKatexPreviewSource } from '@/lib/math/geogebra-chat';
import { extractLastGgbCommandsFromHistory, isContinuationRequest } from '@/lib/math/math-continuation';
import {
  allowsEmptyBody,
  commandUsesContinuationCanvas,
  filterCommandSpecs,
  parseStudioInput,
  type DrawingCommand,
} from '@/lib/math/math-drawing/commands';
import { formatMetaCommandResponse } from '@/lib/math/math-drawing/meta-responses';
import { ggbToTikz, type GgbObject, type TikzMode } from '@/lib/math/tikz-export/ggb-to-tikz';
import { parseGgbScript } from '@/lib/math/tikz-export/ggb-script';
import { localRepair } from '@/lib/math/geometry-render/preflight';
import { lintGeometry } from '@/lib/math/geometry-render/lint';
import { runGeometryScript } from '@/lib/math/geometry-render/run-script';
import {
  buildConstructionSteps,
  formatConstructionProtocol,
  type ConstructionStep,
} from '@/lib/math/geometry-render/steps';
import {
  isGeometryAgentContextCheckpoint,
  type GeometryAgentContextCheckpoint,
} from '@/lib/geometry/agent/conversation-context';
import {
  captureGeogebraLiveCommandSnapshot,
  type GeogebraLiveCommandReader,
} from '@/lib/geometry/adapters/geogebra-live-command-snapshot';
import {
  subscribeGeogebraLiveMutations,
  type GeogebraLiveMutationApi,
  type GeogebraLiveMutationEvent,
  type GeogebraLiveMutationSubscription,
} from '@/lib/geometry/adapters/geogebra-live-events';
import {
  GeogebraCommandTransactionBroker,
  createGeogebraAppliedScriptReceipt,
  createGeogebraObservedCommandSnapshotReceipt,
  createGeogebraReplaceScriptTransaction,
  type GeogebraCommandSnapshot,
} from '@/lib/geometry/transactions/geogebra-command-broker';

type Provider = 'relay';
type Message = { role: 'user' | 'assistant'; content: string };
type ModelRow = { id: string; label: string };

const MODEL_STORAGE_KEY = 'math-studio-draw-model';
const MSG_VISIBLE = 12;

function randomId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type GGBApi = GgbApiLike & GeogebraLiveMutationApi & {
  setErrorDialogsActive?: (flag: boolean) => void;
  setSize?: (w: number, h: number) => void;
  recalculateEnvironments?: () => void;
  newConstruction?: () => void;
  reset?: () => void;
  // read-side API used by the "Magic!" TikZ export (not in GgbApiLike, which
  // only types the write/eval surface the renderer needs).
  getAllObjectNames?: () => string[];
  getObjectType?: (name: string) => string;
  getCommandString?: (name: string, useLocalizedInput?: boolean) => string;
  getXcoord?: (name: string) => number;
  getYcoord?: (name: string) => number;
  getColor?: (name: string) => string;
  getLineThickness?: (name: string) => number;
  getLineStyle?: (name: string) => number;
  getPointSize?: (name: string) => number;
  getValue?: (name: string) => number;
  getVisible?: (name: string) => boolean;
  exists?: (name: string) => boolean;
  isDefined?: (name: string) => boolean;
  getCaption?: (name: string) => string;
  getLabelVisible?: (name: string) => boolean;
};

/** Read the live construction into the serialisable shape the transpiler wants. */
function readGgbConstruction(api: GGBApi): GgbObject[] {
  if (typeof api.getAllObjectNames !== 'function') return [];
  const names = api.getAllObjectNames() ?? [];
  const out: GgbObject[] = [];
  // Non-geometric object types that should never reach the figure.
  const SKIP = new Set(['numeric', 'text', 'boolean', 'image', 'button', 'textfield', 'list', 'function']);
  for (const name of names) {
    try {
      if (api.isDefined && !api.isDefined(name)) continue;
      const type = api.getObjectType?.(name) ?? '';
      if (SKIP.has(type)) continue;
      const o: GgbObject = {
        name,
        type,
        command: api.getCommandString?.(name) ?? '',
        visible: api.getVisible ? api.getVisible(name) : true,
        color: api.getColor?.(name),
        thickness: api.getLineThickness?.(name),
        dashed: api.getLineStyle ? api.getLineStyle(name) !== 0 : false,
      };
      if (type === 'point') {
        o.x = api.getXcoord?.(name); o.y = api.getYcoord?.(name);
        const caption = api.getCaption?.(name);
        if (caption && caption !== name) o.caption = caption;
        if (api.getLabelVisible) o.labelVisible = api.getLabelVisible(name);
      }
      out.push(o);
    } catch { /* skip an object the bundle can't read */ }
  }
  return out;
}

const GGB_WARMUP_MS = 2000;

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function clearGgbConstruction(api: GGBApi): void {
  try {
    if (typeof api.newConstruction === 'function') api.newConstruction();
    else if (typeof api.reset === 'function') api.reset();
  } catch { /* older bundle */ }
}

const PROVIDER_LABELS: Record<Provider, string> = { relay: 'api.molamaker.cn' };

const GGB_CONTAINER_ID = 'wp-ggb-applet';
const GGB_SCALE_CLASS = 'wp-ggb-scale';
const GGB_SELF = process.env.NEXT_PUBLIC_GEOGEBRA_BASE_URL?.replace(/\/+$/, '') || '/geogebra';
const GGB_OFFICIAL_CDN = 'https://www.geogebra.org/apps';
// Try the configured (CDN) source first, then fall back to the same-origin
// /geogebra bundle (public/geogebra, served by ECS) if the CDN copy is missing
// or incomplete — so a bad/partial CDN upload can't take the whole panel down.
function geogebraSources(staticPreview: boolean): Array<{ url: string; selfHosted: boolean }> {
  if (staticPreview) return [{ url: GGB_OFFICIAL_CDN, selfHosted: false }];
  return [
    { url: GGB_SELF, selfHosted: true },
    ...(GGB_SELF !== '/geogebra' ? [{ url: '/geogebra', selfHosted: true }] : []),
  ];
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const display = isUser ? msg.content : assistantDisplayText(msg.content);
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      <div
        className={isUser ? undefined : 'wp-md'}
        style={{
          maxWidth: '88%',
          padding: '9px 13px',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isUser ? 'var(--accent)' : 'var(--bg-elev)',
          border: isUser ? 'none' : '1px solid var(--rule)',
          color: isUser ? 'var(--bg)' : 'var(--ink)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12,
          lineHeight: 1.65,
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {isUser
          ? (msg.content || <span style={{ opacity: 0.5 }}>…</span>)
          : (display && display !== '…'
              ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{display}</ReactMarkdown>
              : <span style={{ opacity: 0.5 }}>…</span>)}
      </div>
    </div>
  );
}

type StreamResult = { commands: string[]; fullText: string; serverError: string };
type GeogebraProjectionSummary = {
  documentId: string;
  epoch: string;
  revision: number;
  sourceId: string;
  sourceHash: string;
  status: 'complete' | 'partial' | 'invalid';
  entities: number;
  opaqueCommands: number;
  semanticHash: string;
  relationHash: string;
  semanticComparable: boolean;
};

function projectionSummary(snapshot: GeogebraCommandSnapshot): GeogebraProjectionSummary {
  const projection = snapshot.geometryDoc;
  return {
    documentId: projection.basis.documentId,
    epoch: projection.basis.epoch,
    revision: projection.basis.revision,
    sourceId: projection.basis.sourceId!,
    sourceHash: projection.basis.sourceHash,
    status: projection.semantic.status,
    entities: projection.semantic.ir.entities.length,
    opaqueCommands: projection.construction.opaqueNodes.length,
    semanticHash: snapshot.semanticSignature.semanticHash,
    relationHash: snapshot.semanticSignature.relationHash,
    semanticComparable: snapshot.semanticSignature.comparable,
  };
}

function appletCoordOf(api: GGBApi, name: string): { x: number; y: number } | null {
  try {
    const x = api.getXcoord?.(name);
    const y = api.getYcoord?.(name);
    return typeof x === 'number'
      && Number.isFinite(x)
      && typeof y === 'number'
      && Number.isFinite(y)
      ? { x, y }
      : null;
  } catch {
    return null;
  }
}

export function MathStudio({
  startOpen = false,
  staticPreview = false,
  homeHref = '/',
}: {
  startOpen?: boolean;
  staticPreview?: boolean;
  homeHref?: string;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider>('relay');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [ggbReady, setGgbReady] = useState(false);
  const [ggbDrawReady, setGgbDrawReady] = useState(false);
  const [ggbError, setGgbError] = useState<string | null>(null);
  const [ggbAttempt, setGgbAttempt] = useState(0);
  const [error, setError] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [ggbLookup, setGgbLookup] = useState<{ count: number; commands: string[] } | null>(null);
  const [ggbEvalStats, setGgbEvalStats] = useState<{ ran: number; total: number } | null>(null);
  const [ggbRepairs, setGgbRepairs] = useState(0);
  const [contextCheckpoint, setContextCheckpoint] = useState<GeometryAgentContextCheckpoint | null>(null);
  const [geometryProjection, setGeometryProjection] = useState<GeogebraProjectionSummary | null>(null);
  const [catalogModels, setCatalogModels] = useState<ModelRow[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState<
    'api' | 'cache' | 'stale-cache' | 'unavailable' | ''
  >('');
  const [modelsError, setModelsError] = useState('');
  const [studioMounted, setStudioMounted] = useState(startOpen);
  const [studioOpen, setStudioOpen] = useState(startOpen);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [katexPanelOpen, setKatexPanelOpen] = useState(false);
  const [katexView, setKatexView] = useState<'render' | 'source'>('render');
  const [katexDraft, setKatexDraft] = useState('');
  const [perfMode, setPerfMode] = useState(false);
  const [showAllMsgs, setShowAllMsgs] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  // "Magic!" — export the current canvas to TikZ (snapshot taken on click).
  const [tikzOpen, setTikzOpen] = useState(false);
  const [tikzMode, setTikzMode] = useState<TikzMode>('tkz');
  const [tikzObjects, setTikzObjects] = useState<GgbObject[] | null>(null);
  const [tikzCopied, setTikzCopied] = useState(false);

  // Pure mode — the canvas takes the whole screen, chrome fades away.
  const [pureMode, setPureMode] = useState(false);
  // Construction protocol — the figure broken into rigorous numbered steps,
  // each replayable as a prefix of the successful script.
  const [stepsOpen, setStepsOpen] = useState(false);
  const [steps, setSteps] = useState<ConstructionStep[]>([]);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [protocolCopied, setProtocolCopied] = useState(false);
  const [narrating, setNarrating] = useState(false);
  // Auto-play: advance one step every beat until the figure completes.
  const [stepsPlaying, setStepsPlaying] = useState(false);
  // Bumped whenever a new script lands on the canvas, so an open steps panel
  // rebuilds its protocol live instead of going stale.
  const [scriptVersion, setScriptVersion] = useState(0);
  // TikZ export: prepend the construction protocol as LaTeX comments.
  const [tikzStepComments, setTikzStepComments] = useState(true);
  const ggbSources = useMemo(() => geogebraSources(staticPreview), [staticPreview]);

  const slashQuery = useMemo(() => {
    const t = input;
    if (!t.startsWith('/')) return null;
    const m = t.match(/^\/([a-z_]*)$/);
    return m ? m[1] : null;
  }, [input]);
  const paletteCommands = useMemo(
    () => (slashQuery !== null ? filterCommandSpecs(slashQuery) : []),
    [slashQuery],
  );
  const showCommandPalette = slashQuery !== null && paletteCommands.length > 0;

  const apiRef = useRef<GGBApi | null>(null);
  const pendingCommandsRef = useRef<string[] | null>(null);
  const ggbDrawReadyRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const fitRafRef = useRef<number | null>(null);
  const suppressFitUntilRef = useRef(0);
  const warmupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackBatchRef = useRef(0);
  /** Last fully-successful script — context for /continue + modify turns. */
  const lastSuccessfulRef = useRef<string[]>([]);
  /** Revision/source-hash CAS owner for the durable GeoGebra command truth. */
  const geometryBrokerRef = useRef<GeogebraCommandTransactionBroker | null>(null);
  /** Prevent our own replay/repair/reset calls from being mistaken for toolbar edits. */
  const nativeMutationSuppressionRef = useRef(0);
  const nativeMutationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeMutationSubscriptionRef = useRef<GeogebraLiveMutationSubscription | null>(null);
  const nativeMutationHandlerRef = useRef<(event: GeogebraLiveMutationEvent) => void>(() => {});
  const stepIndexRef = useRef<number | null>(null);
  const runRenderRef = useRef<(cmds: string[], ctx: { problem: string; drawingCommand: DrawingCommand }) => void>(() => {});
  const lastRenderCtxRef = useRef<{ problem: string; drawingCommand: DrawingCommand }>({ problem: '', drawingCommand: 'draw' });
  const sendingRef = useRef(false);
  const modelsReqRef = useRef(0);

  const afterLayout = useCallback(
    () => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }),
    [],
  );

  const measureCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0 && h > 0) return { w, h };
    }
    const sidebar = document.querySelector('.wp-studio__sidebar');
    const katexEl = document.querySelector('.wp-studio__katex');
    const sideW = sidebar ? Math.ceil(sidebar.getBoundingClientRect().width) : 340;
    const katexW = katexEl ? Math.ceil(katexEl.getBoundingClientRect().width) : 0;
    return {
      w: Math.max(320, Math.floor(window.innerWidth - sideW - katexW)),
      h: Math.max(240, Math.floor(window.innerHeight - 48)),
    };
  }, []);

  const fitApplet = useCallback(() => {
    const api = apiRef.current;
    if (!api || typeof api.setSize !== 'function') return;
    let { w, h } = measureCanvas();
    if (perfMode && w > 1280) { h = Math.floor(h * (1280 / w)); w = 1280; }
    const last = lastSizeRef.current;
    if (Math.abs(w - last.w) < 2 && Math.abs(h - last.h) < 2) return;
    lastSizeRef.current = { w, h };
    suppressFitUntilRef.current = performance.now() + 350;
    api.setSize(w, h);
    api.recalculateEnvironments?.();
  }, [measureCanvas, perfMode]);

  const runWithNativeMutationSuppressed = useCallback(async <T,>(
    action: () => T | Promise<T>,
  ): Promise<T> => {
    if (nativeMutationTimerRef.current) {
      clearTimeout(nativeMutationTimerRef.current);
      nativeMutationTimerRef.current = null;
    }
    nativeMutationSuppressionRef.current += 1;
    try {
      return await action();
    } finally {
      // GeoGebra can deliver update events after evalCommand/newConstruction
      // returns. Keep the guard through the next task, then refresh listeners.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      nativeMutationSuppressionRef.current = Math.max(0, nativeMutationSuppressionRef.current - 1);
      if (nativeMutationSuppressionRef.current === 0) {
        nativeMutationSubscriptionRef.current?.refresh();
      }
    }
  }, []);

  const publishGeogebraSnapshot = useCallback((
    broker: GeogebraCommandTransactionBroker,
    snapshot: GeogebraCommandSnapshot,
  ) => {
    geometryBrokerRef.current = broker;
    lastSuccessfulRef.current = [...snapshot.commands];
    setGeometryProjection(projectionSummary(snapshot));
    setScriptVersion((version) => version + 1);
  }, []);

  const restoreGeogebraSnapshot = useCallback(async (
    api: GGBApi,
    snapshot: GeogebraCommandSnapshot,
  ): Promise<void> => {
    await runWithNativeMutationSuppressed(() => {
      clearGgbConstruction(api);
      const restored = runGeometryScript(api, [...snapshot.commands]);
      if (restored.failures.length > 0) {
        throw new Error(`恢复失败：${restored.failures[0]?.cmd ?? 'unknown command'}`);
      }
      api.recalculateEnvironments?.();
    });
  }, [runWithNativeMutationSuppressed]);

  const commitLiveMutation = useCallback(async (event: GeogebraLiveMutationEvent) => {
    if (nativeMutationSuppressionRef.current > 0) return;
    const api = apiRef.current;
    if (!api || typeof api.getAllObjectNames !== 'function') return;
    const broker = geometryBrokerRef.current ?? new GeogebraCommandTransactionBroker({
      documentId: `math-studio-${randomId()}`,
      epoch: `epoch-${randomId()}`,
    });
    const before = broker.snapshot();

    if (stepIndexRef.current !== null) {
      try {
        await restoreGeogebraSnapshot(api, before);
        setError('步骤预览是只读视图；已恢复完整画板。请先退出步骤预览再编辑。');
      } catch (restoreError) {
        setError(`步骤预览恢复失败：${restoreError instanceof Error ? restoreError.message : 'unknown error'}`);
      }
      return;
    }

    try {
      const observed = captureGeogebraLiveCommandSnapshot(api as GeogebraLiveCommandReader);
      if (!observed.complete) {
        const exclusion = observed.exclusions[0];
        throw new Error(
          exclusion
            ? `${exclusion.objectName} (${exclusion.objectType})：${exclusion.reason}`
            : '画布快照不完整',
        );
      }
      const unchanged = observed.commands.length === before.commands.length
        && observed.commands.every((command, index) => command === before.commands[index]);
      if (unchanged) return;

      const transactionId = `transaction-${randomId()}`;
      const transaction = createGeogebraReplaceScriptTransaction({
        snapshot: before,
        commands: observed.commands,
        transactionId,
        origin: 'canvas',
      });
      const receipt = createGeogebraObservedCommandSnapshotReceipt({
        transactionId,
        snapshot: observed,
      });
      if (!receipt) throw new Error('原生画布观察收据不完整。');
      const committed = broker.commitObserved(
        transaction,
        receipt,
        (name) => appletCoordOf(api, name),
      );
      if (!committed.ok) throw new Error(`${committed.code}: ${committed.message}`);
      publishGeogebraSnapshot(broker, committed.snapshot);
      setError((current) => current.startsWith('原生画布') ? '' : current);
    } catch (commitError) {
      try {
        await restoreGeogebraSnapshot(api, before);
      } catch (restoreError) {
        setError(
          `原生画布变更未提交，且恢复失败：${restoreError instanceof Error ? restoreError.message : 'unknown error'}`,
        );
        return;
      }
      setError(
        `原生画布变更未提交，已恢复到 r${before.geometryDoc.basis.revision}（${event.kind}）：${commitError instanceof Error ? commitError.message : 'unknown broker error'}`,
      );
    }
  }, [publishGeogebraSnapshot, restoreGeogebraSnapshot]);

  const scheduleLiveMutation = useCallback((event: GeogebraLiveMutationEvent) => {
    if (nativeMutationSuppressionRef.current > 0) return;
    if (nativeMutationTimerRef.current) clearTimeout(nativeMutationTimerRef.current);
    const delay = event.kind === 'drag-end' ? 24 : event.kind === 'update' ? 260 : 80;
    nativeMutationTimerRef.current = setTimeout(() => {
      nativeMutationTimerRef.current = null;
      void commitLiveMutation(event);
    }, delay);
  }, [commitLiveMutation]);

  useEffect(() => { nativeMutationHandlerRef.current = scheduleLiveMutation; }, [scheduleLiveMutation]);
  useEffect(() => { stepIndexRef.current = stepIndex; }, [stepIndex]);
  useEffect(() => () => {
    nativeMutationSubscriptionRef.current?.dispose();
    nativeMutationSubscriptionRef.current = null;
    if (nativeMutationTimerRef.current) clearTimeout(nativeMutationTimerRef.current);
  }, []);

  const loadProviderModels = useCallback(async (p: Provider) => {
    const reqId = ++modelsReqRef.current;
    setModelsLoading(true);
    setModelsError('');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const r = await fetch(`/api/math/models?provider=${encodeURIComponent(p)}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json() as {
            models?: ModelRow[];
            defaultModel?: string;
            source?: 'api' | 'cache' | 'stale-cache' | 'unavailable';
            listError?: string;
            error?: string;
          };
          if (reqId !== modelsReqRef.current) return;
          if (j.error && !j.models?.length) throw new Error(j.error);
          const rows = j.models ?? [];
          if (rows.length === 0) throw new Error(j.listError || '模型目录为空');
          setCatalogModels(rows);
          setModelsSource(j.source ?? '');
          setModelsError(j.listError ?? '');
          const stored = (() => {
            try {
              const all = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) ?? '{}') as Record<string, string>;
              return all[p]?.trim() ?? '';
            } catch { return ''; }
          })();
          const pick = (stored && rows.some((m) => m.id === stored))
            ? stored
            : (j.defaultModel && rows.some((m) => m.id === j.defaultModel))
              ? j.defaultModel
              : (rows[0]?.id ?? '');
          setSelectedModel(pick);
          return;
        } catch (error) {
          if (reqId !== modelsReqRef.current) return;
          if (attempt === 2) throw error;
          setModelsError('模型目录连接波动，正在自动重试…');
          await new Promise((resolve) => {
            setTimeout(resolve, attempt === 0 ? 1_200 : 3_000);
          });
        }
      }
    } catch (e) {
      if (reqId !== modelsReqRef.current) return;
      setModelsSource('unavailable');
      setModelsError(e instanceof Error ? e.message : '无法读取模型列表，请稍后重试');
    } finally {
      if (reqId === modelsReqRef.current) setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (staticPreview) {
      setProviders([]);
      setCatalogModels([]);
      setSelectedModel('');
      setModelsSource('unavailable');
      setModelsError('GitHub Pages 静态预览：原生几何画板可用，AI 生成需要完整站点。');
      return;
    }
    fetch('/api/math/providers')
      .then((r) => r.json())
      .then((j: { available?: string[] }) => {
        const avail = (j.available ?? []) as Provider[];
        setProviders(avail);
        if (avail.length > 0 && !avail.includes(provider)) setProvider(avail[0]);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticPreview]);

  useEffect(() => {
    if (!providers.includes(provider)) return;
    void loadProviderModels(provider);
  }, [provider, providers, loadProviderModels]);

  const onModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    try {
      const all = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) ?? '{}') as Record<string, string>;
      all[provider] = modelId;
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }, [provider]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const katexSource = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const parts = [
      lastUser?.content ? extractKatexPreviewSource(lastUser.content) : '',
      lastAssistant?.content ? extractKatexPreviewSource(lastAssistant.content) : '',
    ].filter(Boolean);
    return parts.join('\n\n');
  }, [messages]);
  useEffect(() => { setKatexDraft(katexSource); }, [katexSource]);

  useEffect(() => {
    if (!ggbReady || !apiRef.current) return;
    fitApplet();
    const t = setTimeout(fitApplet, 120);
    return () => clearTimeout(t);
  }, [katexPanelOpen, ggbReady, fitApplet]);

  /** POST to the math API and collect streamed tokens + the parsed command list. */
  const streamMath = useCallback(async (
    payload: Record<string, unknown>,
    onToken: (fullText: string) => void,
    captureLookup = true,
  ): Promise<StreamResult> => {
    const r = await fetch('/api/math', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let fullText = '';
    let commands: string[] | null = null;
    let serverError = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        const raw = part.slice(6).trim();
        if (raw === '[DONE]') break;
        try {
          const frame = JSON.parse(raw) as {
            token?: string;
            model?: string;
            error?: string;
            ggbLookup?: { count: number; commands: string[] };
            ggbCommands?: { count: number; commands: string[] };
            agentContextCheckpoint?: GeometryAgentContextCheckpoint;
          };
          if (typeof frame.model === 'string') { setActiveModel(frame.model); continue; }
          if (typeof frame.error === 'string' && frame.error) { serverError = frame.error; continue; }
          if (frame.ggbLookup) { if (captureLookup) setGgbLookup({ count: frame.ggbLookup.count, commands: frame.ggbLookup.commands ?? [] }); continue; }
          if (frame.ggbCommands?.commands) { commands = frame.ggbCommands.commands; continue; }
          if (isGeometryAgentContextCheckpoint(frame.agentContextCheckpoint)) {
            setContextCheckpoint(frame.agentContextCheckpoint);
            continue;
          }
          if (typeof frame.token === 'string') { fullText += frame.token; onToken(fullText); continue; }
        } catch { /* skip malformed frame */ }
      }
    }
    return { commands: commands ?? parseGgbBlock(fullText), fullText, serverError };
  }, []);

  /** Run a script in the applet; absorb module races, repair real errors. */
  const runRenderInApplet = useCallback(async (
    commands: string[],
    ctx: { problem: string; drawingCommand: DrawingCommand },
  ) => {
    const api = apiRef.current;
    lastRenderCtxRef.current = ctx;
    if (!api || !ggbDrawReadyRef.current) { pendingCommandsRef.current = commands; return; }
    if (commands.length === 0) { setGgbEvalStats({ ran: 0, total: 0 }); return; }

    fallbackBatchRef.current += 1;
    const batchId = fallbackBatchRef.current;
    const fallbacks = (cmd: string) => triangleCenterFallbacks(cmd, batchId);

    // Live canvas snapshot for state-aware repair: the model sees the
    // evaluated geometry, not just the script it wrote.
    const snapshotCanvasState = (): string[] => {
      try {
        const names = api.getAllObjectNames?.() ?? [];
        return names.slice(0, 48).map((n) => {
          const type = api.getObjectType?.(n) ?? 'object';
          if (type === 'point') {
            const x = api.getXcoord?.(n);
            const y = api.getYcoord?.(n);
            const ok = api.isDefined ? api.isDefined(n) : true;
            return `${n}: point @ (${x?.toFixed(3)}, ${y?.toFixed(3)})${ok ? '' : ' — UNDEFINED'}`;
          }
          return `${n}: ${type}`;
        });
      } catch { return []; }
    };

    const outcome = await runWithNativeMutationSuppressed(() => renderWithRepair({
      api,
      commands,
      clear: () => clearGgbConstruction(api),
      fallbacks,
      // GeoGebra lazy-loads command modules; treat that as transient (retry in
      // place) instead of spending an LLM repair on a load race.
      isTransient: isGgbModuleRaceError,
      transientDelayMs: 1200,
      maxTransientRetries: 3,
      // Tier 1: mechanical fixes (Intersect indices, bare pair names) — free.
      localRepair,
      maxLocalRepairs: 2,
      // Semantic lint after clean passes: undefined intersections, coincident
      // points and collinear polygons enter the repair loop with precise hints.
      lint: (cmds) => lintGeometry(api, cmds),
      repair: async (cmds: string[], failures: CommandFailure[]) => {
        try {
          const res = await streamMath(
            {
              mode: 'repair', commands: cmds, failures, provider, model: selectedModel,
              drawingCommand: ctx.drawingCommand, problem: ctx.problem,
              canvasState: snapshotCanvasState(),
            },
            () => {},
            false,
          );
          return res.commands;
        } catch { return []; }
      },
      maxRepairs: 2,
    }));

    setGgbEvalStats({ ran: outcome.result.ran, total: outcome.result.total });
    setGgbRepairs(outcome.repairs);
    if (outcome.result.failures.length === 0 && outcome.commands.length > 0) {
      const broker = geometryBrokerRef.current ?? new GeogebraCommandTransactionBroker({
        documentId: `math-studio-${randomId()}`,
        epoch: `epoch-${randomId()}`,
      });
      const before = broker.snapshot();
      try {
        const transactionId = `transaction-${randomId()}`;
        const transaction = createGeogebraReplaceScriptTransaction({
          snapshot: before,
          commands: outcome.commands,
          transactionId,
          origin: outcome.repairs > 0 ? 'repair' : 'ai',
        });
        const receipt = createGeogebraAppliedScriptReceipt({
          transactionId,
          commands: outcome.commands,
          successfulCommandCount: outcome.result.ran,
          failureCount: outcome.result.failures.length,
        });
        if (!receipt) throw new Error('GeoGebra execution receipt was incomplete.');
        const committed = broker.commitApplied(
          transaction,
          receipt,
          (name) => appletCoordOf(api, name),
        );
        if (!committed.ok) {
          throw new Error(`${committed.code}: ${committed.message}`);
        }
        publishGeogebraSnapshot(broker, committed.snapshot);
        setError((prev) => (prev.startsWith('GeoGebra') ? '' : prev));
      } catch (commitError) {
        try {
          await restoreGeogebraSnapshot(api, before);
        } catch { /* the broker remains authoritative; surface the original commit error */ }
        setError(
          `语义事务未提交，画布已恢复到 r${before.geometryDoc.basis.revision}：${commitError instanceof Error ? commitError.message : 'unknown broker error'}`,
        );
      }
    } else if (outcome.result.failures.length > 0) {
      const durable = geometryBrokerRef.current?.snapshot();
      try {
        if (durable) await restoreGeogebraSnapshot(api, durable);
        else await runWithNativeMutationSuppressed(() => clearGgbConstruction(api));
      } catch { /* keep the durable broker snapshot unchanged and report execution failure */ }
      const f = outcome.result.failures[0];
      setError(`GeoGebra：${outcome.result.ran}/${outcome.result.total} 条成功${outcome.repairs ? `（纠错 ${outcome.repairs} 次）` : ''}。例：${f.cmd} → ${f.error}`);
    }
    api.recalculateEnvironments?.();
    requestAnimationFrame(() => fitApplet());
  }, [
    provider,
    selectedModel,
    streamMath,
    fitApplet,
    publishGeogebraSnapshot,
    restoreGeogebraSnapshot,
    runWithNativeMutationSuppressed,
  ]);

  useEffect(() => { runRenderRef.current = runRenderInApplet; }, [runRenderInApplet]);

  // Load GeoGebra only while the studio overlay is open. Persists across reopen.
  useEffect(() => {
    if (!studioMounted || !studioOpen) return;
    if (apiRef.current) {
      fitApplet();
      const bumps = [80, 200, 500].map((ms) => setTimeout(fitApplet, ms));
      return () => bumps.forEach(clearTimeout);
    }
    const win = window as Window & {
      GGBApplet?: new (params: Record<string, unknown>, html5: boolean) => {
        inject: (id: string) => void;
        setHTML5Codebase?: (path: string) => void;
      };
    };
    const source = ggbSources[ggbAttempt];
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled && !apiRef.current) fail(); }, 15_000);

    const markReady = () => {
      ggbDrawReadyRef.current = true;
      setGgbDrawReady(true);
      fitApplet();
      const pending = pendingCommandsRef.current;
      pendingCommandsRef.current = null;
      if (pending) runRenderRef.current(pending, lastRenderCtxRef.current);
    };

    const fail = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      nativeMutationSubscriptionRef.current?.dispose();
      nativeMutationSubscriptionRef.current = null;
      apiRef.current = null;
      document.getElementById(GGB_CONTAINER_ID)?.replaceChildren();
      if (ggbAttempt + 1 < ggbSources.length) setGgbAttempt(ggbAttempt + 1);
      else setGgbError(
        staticPreview
          ? '无法从 GeoGebra 官方 CDN 加载画板，请检查网络后 Retry。'
          : '无法加载 GeoGebra。请确认 public/geogebra/ 已解压 Math Apps Bundle（见 deploy/geogebra/SETUP.md），'
            + '或设置 NEXT_PUBLIC_GEOGEBRA_BASE_URL 指向可访问的镜像，然后重启 dev server 并 Retry。',
      );
    };

    const setupApplet = async () => {
      if (cancelled) return;
      if (!win.GGBApplet || !source) { fail(); return; }
      await afterLayout();
      if (cancelled) return;
      try {
        const container = document.getElementById(GGB_CONTAINER_ID);
        if (container) container.innerHTML = '';
        const { w, h } = measureCanvas();
        const applet = new win.GGBApplet({
          appName: 'classic', width: w, height: h,
          scaleContainerClass: GGB_SCALE_CLASS, allowUpscale: true,
          enableCAS: true, enable3d: true,
          showToolBar: true, showToolBarHelp: true, showAlgebraInput: true,
          showSuggestionButtons: true, showMenuBar: true,
          enableRightClick: true, enableLabelDrags: true, enableShiftDragZoom: true,
          showZoomButtons: true, allowStyleBar: true, showFullscreenButton: false,
          border: false, detachKeyboard: true,
          preventFocus: true, showKeyboardOnFocus: false,
          appletOnLoad: (api: GGBApi) => {
            if (cancelled) return;
            if (timer) clearTimeout(timer);
            apiRef.current = api;
            nativeMutationSubscriptionRef.current?.dispose();
            nativeMutationSubscriptionRef.current = subscribeGeogebraLiveMutations(
              api,
              (event) => nativeMutationHandlerRef.current(event),
            );
            try { api.setErrorDialogsActive?.(false); } catch { /* older bundle */ }
            setGgbReady(true);
            setGgbDrawReady(false);
            ggbDrawReadyRef.current = false;
            setGgbError(null);
            document.body.classList.add('wp-studio-ggb-open');
            if (warmupTimerRef.current) clearTimeout(warmupTimerRef.current);
            warmupTimerRef.current = setTimeout(() => { if (!cancelled && apiRef.current) markReady(); }, GGB_WARMUP_MS);
            setTimeout(fitApplet, 80);
          },
        }, true);
        if (source.selfHosted && typeof applet.setHTML5Codebase === 'function') {
          applet.setHTML5Codebase(`${source.url}/HTML5/5.0/web3d/`);
        }
        applet.inject(GGB_CONTAINER_ID);
      } catch { fail(); }
    };


    if (win.GGBApplet) {
      void setupApplet();
    } else if (!source) {
      fail();
    } else {
      document.getElementById('ggb-deploy-script')?.remove();
      const script = document.createElement('script');
      script.id = 'ggb-deploy-script';
      script.src = `${source.url}/deployggb.js`;
      script.onload = () => { void setupApplet(); };
      script.onerror = fail;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (warmupTimerRef.current) clearTimeout(warmupTimerRef.current);
    };
  }, [studioMounted, studioOpen, ggbAttempt, ggbSources, staticPreview, fitApplet, afterLayout, measureCanvas]);

  useEffect(() => {
    if (studioOpen) return;
    document.body.classList.remove('wp-studio-ggb-open');
  }, [studioOpen]);

  const retryGgb = useCallback(() => {
    nativeMutationSubscriptionRef.current?.dispose();
    nativeMutationSubscriptionRef.current = null;
    setGgbError(null);
    setGgbReady(false);
    setGgbDrawReady(false);
    ggbDrawReadyRef.current = false;
    apiRef.current = null;
    pendingCommandsRef.current = null;
    if (warmupTimerRef.current) clearTimeout(warmupTimerRef.current);
    document.getElementById(GGB_CONTAINER_ID)?.replaceChildren();
    setGgbAttempt(0);
  }, []);

  useEffect(() => {
    if (!studioOpen) return;
    fitApplet();
    const delays = [120, 350, 700].map((ms) => setTimeout(fitApplet, ms));
    const scheduleFit = () => {
      if (performance.now() < suppressFitUntilRef.current) return;
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = requestAnimationFrame(() => fitApplet());
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleFit) : null;
    if (stageRef.current) ro?.observe(stageRef.current);
    const onResize = () => scheduleFit();
    window.addEventListener('resize', onResize);
    return () => {
      delays.forEach(clearTimeout);
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [studioOpen, sidebarOpen, ggbReady, fitApplet, perfMode]);

  const pureModeRef = useRef(false);
  const stepsOpenRef = useRef(false);
  useEffect(() => { pureModeRef.current = pureMode; }, [pureMode]);
  useEffect(() => { stepsOpenRef.current = stepsOpen; }, [stepsOpen]);

  useEffect(() => {
    if (!studioOpen) return;
    // Esc unwinds one layer at a time: pure mode → steps panel → studio.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pureModeRef.current) { setPureMode(false); return; }
      if (stepsOpenRef.current) { setStepsOpen(false); return; }
      if (startOpen) {
        window.location.assign(homeHref);
        return;
      }
      setStudioOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [homeHref, startOpen, studioOpen]);

  // Pure mode resizes the stage to the viewport — refit the applet after the
  // CSS transition settles (both directions).
  useEffect(() => {
    if (!studioOpen) return;
    fitApplet();
    const bumps = [90, 240, 480].map((ms) => setTimeout(fitApplet, ms));
    return () => bumps.forEach(clearTimeout);
  }, [pureMode, studioOpen, fitApplet]);

  const resetCanvas = useCallback(() => {
    const api = apiRef.current;
    pendingCommandsRef.current = null;
    setGgbEvalStats(null);
    setGgbRepairs(0);
    if (!api) return;
    void (async () => {
      await runWithNativeMutationSuppressed(() => clearGgbConstruction(api));
      await commitLiveMutation({ kind: 'clear', objectNames: [] });
    })();
  }, [commitLiveMutation, runWithNativeMutationSuppressed]);

  const tikzResult = useMemo(() => {
    if (!tikzObjects) return null;
    const base = ggbToTikz(tikzObjects, tikzMode);
    // Annotate the LaTeX with the rigorous protocol — each construction step
    // as a comment, so the exported source documents its own figure.
    if (tikzStepComments && lastSuccessfulRef.current.length) {
      const proto = buildConstructionSteps(lastSuccessfulRef.current)
        .map((s) => `% ${s.n}. ${s.text}`)
        .join('\n');
      if (proto) return { ...base, code: `% ── 作图步骤 ──\n${proto}\n${base.code}` };
    }
    return base;
  }, [tikzObjects, tikzMode, tikzStepComments]);

  /** Snapshot the current figure and open the TikZ export panel.
   *  Primary source: the GGB command script that built it (semantic, reliable);
   *  the live applet only supplies evaluated coordinates. Falls back to reading
   *  the applet directly when there is no script (hand-drawn only). */
  const runMagicExport = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const coordOf = (name: string): { x: number; y: number } | null => {
      try {
        const x = api.getXcoord?.(name);
        const y = api.getYcoord?.(name);
        return (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) ? { x, y } : null;
      } catch { return null; }
    };
    const script = lastSuccessfulRef.current;
    const objects = script.length ? parseGgbScript(script, coordOf) : readGgbConstruction(api);
    setTikzObjects(objects);
    setTikzCopied(false);
    setTikzOpen(true);
  }, []);

  const copyTikz = useCallback(async () => {
    if (!tikzResult) return;
    const ok = await copyTextToClipboard(tikzResult.code);
    if (ok) { setTikzCopied(true); setTimeout(() => setTikzCopied(false), 1500); }
  }, [tikzResult]);

  // ── Construction protocol (rigorous steps) ───────────────────────
  // Steps come from the exact successful script, so the protocol can never
  // drift from the figure; selecting step k replays the script prefix [0..k].

  const openSteps = useCallback(() => {
    const script = lastSuccessfulRef.current;
    if (!script.length) return;
    setSteps(buildConstructionSteps(script));
    setStepIndex(null);  // null = full figure
    setStepsOpen(true);
  }, []);

  const replayPrefix = useCallback((prefix: string[]) => {
    const api = apiRef.current;
    if (!api) return;
    void runWithNativeMutationSuppressed(() => {
      clearGgbConstruction(api);
      runGeometryScript(api, prefix);
      api.recalculateEnvironments?.();
    });
  }, [runWithNativeMutationSuppressed]);

  const goToStep = useCallback((k: number | null) => {
    stepIndexRef.current = k;
    setStepIndex(k);
    if (k === null) replayPrefix(lastSuccessfulRef.current);
    else if (steps[k]) replayPrefix(steps[k].prefix);
  }, [steps, replayPrefix]);

  const closeSteps = useCallback(() => {
    setStepsOpen(false);
    setStepsPlaying(false);
    // leave the full figure on the canvas, whatever step was showing
    if (stepIndex !== null) replayPrefix(lastSuccessfulRef.current);
    stepIndexRef.current = null;
    setStepIndex(null);
  }, [stepIndex, replayPrefix]);

  const copyProtocol = useCallback(async () => {
    if (!steps.length) return;
    const ok = await copyTextToClipboard(formatConstructionProtocol(steps));
    if (ok) { setProtocolCopied(true); setTimeout(() => setProtocolCopied(false), 1500); }
  }, [steps]);

  /** Stream a worded 讲解 of the protocol into the KaTeX panel. */
  const narrateSteps = useCallback(async () => {
    if (!steps.length || narrating) return;
    setNarrating(true);
    setKatexPanelOpen(true);
    setKatexView('render');
    setKatexDraft('*讲解生成中…*');
    try {
      await streamMath(
        {
          mode: 'narrate',
          problem: lastRenderCtxRef.current.problem,
          steps: steps.map((st) => `${st.n}. ${st.text}`),
          provider,
          model: selectedModel,
        },
        (txt) => setKatexDraft(txt),
        false,
      );
    } catch (e) {
      setKatexDraft(`讲解失败：${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setNarrating(false);
    }
  }, [steps, narrating, provider, selectedModel, streamMath]);

  // Auto-play: one step per beat, like watching the construction happen.
  // Starting from the full figure rewinds to step 1 first.
  useEffect(() => {
    if (!stepsPlaying || !stepsOpen || steps.length === 0) return;
    if (stepIndex === null) { goToStep(0); return; }
    if (stepIndex >= steps.length - 1) { setStepsPlaying(false); return; }
    const t = setTimeout(() => goToStep(stepIndex + 1), 1500);
    return () => clearTimeout(t);
  }, [stepsPlaying, stepsOpen, stepIndex, steps, goToStep]);

  // A new figure rendered while the panel is open → rebuild the protocol
  // live so the listed steps always describe what's on the canvas.
  useEffect(() => {
    if (!stepsOpen) return;
    setSteps(buildConstructionSteps(lastSuccessfulRef.current));
    setStepIndex(null);
    setStepsPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptVersion]);

  // ←/→ scrub through the steps while the panel is open (and the user isn't
  // typing in an input).
  useEffect(() => {
    if (!stepsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStepsPlaying(false);
        if (stepIndex === null || stepIndex >= steps.length - 1) goToStep(null);
        else goToStep(stepIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepsPlaying(false);
        goToStep(Math.max(0, (stepIndex ?? steps.length) - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepsOpen, stepIndex, steps.length, goToStep]);

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || streaming || sendingRef.current) return;
    if (!selectedModel) { setError('请先选择作图模型'); return; }

    const parsed = parseStudioInput(raw);
    if (parsed.kind === 'meta') {
      setInput('');
      setPaletteIndex(0);
      const reply = formatMetaCommandResponse(parsed.command, {
        provider: PROVIDER_LABELS[provider],
        model: selectedModel,
        messageCount: messages.length,
        ggbReady,
        ggbDrawReady,
        lastGgbCommandCount: lastSuccessfulRef.current.length,
        streaming: false,
        lastLookupCommandCount: ggbLookup?.count ?? null,
        activeModel,
      });
      setMessages((m) => [...m, { role: 'user', content: raw }, { role: 'assistant', content: reply }]);
      return;
    }

    const drawingCommand = parsed.command;
    const problemBody = parsed.body;
    if (!problemBody && !allowsEmptyBody(drawingCommand)) {
      setError(`/${drawingCommand} 需要题目或说明文字。输入 / 查看命令帮助。`);
      return;
    }

    sendingRef.current = true;
    setInput('');
    setPaletteIndex(0);
    setError('');
    setGgbLookup(null);
    setGgbEvalStats(null);
    setGgbRepairs(0);

    const continueDrawing = commandUsesContinuationCanvas(drawingCommand)
      || isContinuationRequest(problemBody || raw, messages);
    const previousGgbCommands = lastSuccessfulRef.current.length > 0
      ? lastSuccessfulRef.current
      : extractLastGgbCommandsFromHistory(messages);

    const displayUser = parsed.kind === 'drawing' ? raw : (problemBody || raw);
    const displayHistory: Message[] = [...messages, { role: 'user', content: displayUser }];
    const history: Message[] = [
      ...messages.slice(-15),
      { role: 'user', content: displayUser },
    ];
    setMessages([...displayHistory, { role: 'assistant', content: '' }]);
    setStreaming(true);

    let res: StreamResult | null = null;
    let serverError = '';
    try {
      const payload: Record<string, unknown> = { mode: 'build', problem: problemBody, history, provider, drawingCommand };
      if (selectedModel) payload.model = selectedModel;
      if (continueDrawing && previousGgbCommands.length > 0) payload.previousGgbCommands = previousGgbCommands;
      if (geometryProjection) {
        payload.contextBasis = {
          lane: 'geogebra',
          documentId: geometryProjection.documentId,
          epoch: geometryProjection.epoch,
          revision: geometryProjection.revision,
          sourceId: geometryProjection.sourceId,
          sourceHash: geometryProjection.sourceHash,
          semanticHash: geometryProjection.semanticHash,
          relationHash: geometryProjection.relationHash,
        };
      }

      res = await streamMath(payload, (txt) => {
        setMessages((m) => { const last = m[m.length - 1]; return [...m.slice(0, -1), { ...last, content: txt }]; });
      });
      serverError = res.serverError;
      if (serverError) setError(`模型/接口错误：${serverError}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setMessages((m) => m.slice(0, -1));
      sendingRef.current = false;
      setStreaming(false);
      return;
    }

    setStreaming(false);
    sendingRef.current = false;

    let commandsToRun = res.commands;
    // Continuation: model returns the full updated script; if it omitted fresh
    // base coordinates, merge onto the previous canvas so nothing is lost.
    if (continueDrawing && previousGgbCommands.length > 0 && commandsToRun.length > 0) {
      const hasFreshCoords = commandsToRun.some((c) => /^[A-Za-z]\w*\s*=\s*\(\s*-?\d/.test(c));
      if (!hasFreshCoords) commandsToRun = mergeGgbScripts(previousGgbCommands, commandsToRun);
    }

    if (commandsToRun.length > 0) {
      await runRenderInApplet(commandsToRun, { problem: problemBody || raw, drawingCommand });
    } else if (!serverError) {
      setError('未能从回复中解析出 GeoGebra 命令。请重试或更换模型。');
    }
  }, [input, streaming, provider, selectedModel, messages, streamMath, runRenderInApplet, ggbReady, ggbDrawReady, ggbLookup, activeModel, geometryProjection]);

  const applyPaletteCommand = useCallback((name: string) => {
    setInput(`/${name} `);
    setPaletteIndex(0);
  }, []);

  const handleInputKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandPalette) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex((i) => Math.min(i + 1, paletteCommands.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && slashQuery !== null && !input.includes(' '))) {
        e.preventDefault();
        const pick = paletteCommands[paletteIndex] ?? paletteCommands[0];
        if (pick) applyPaletteCommand(pick.name);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [showCommandPalette, paletteCommands, paletteIndex, slashQuery, input, applyPaletteCommand, send]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError('');
    setShowAllMsgs(false);
    setGgbEvalStats(null);
    setGgbRepairs(0);
  }, []);

  const openStudio = useCallback(() => { setStudioMounted(true); setStudioOpen(true); }, []);

  useEffect(() => { setActiveModel(null); setGgbLookup(null); setGgbEvalStats(null); setGgbRepairs(0); }, [provider]);

  const statusKind = error ? 'error' : streaming ? 'busy' : 'ready';
  const statusText = error
    ? 'error'
    : staticPreview
      ? 'preview'
      : streaming ? 'thinking…' : 'ready';
  const studioStatus = (
    <div className={`wp-math__status wp-math__status--${statusKind}`} aria-live="polite">
      <span className="wp-math__status-dot" aria-hidden="true" />
      <span className="wp-math__status-provider">
        {staticPreview ? 'GeoGebra tools' : PROVIDER_LABELS[provider]}
      </span>
      {activeModel && <span className="wp-math__status-model" title={activeModel}>{activeModel}</span>}
      {ggbLookup && ggbLookup.count > 0 && (
        <span className="wp-math__status-ggb" title={ggbLookup.commands.slice(0, 24).join(', ')}>
          lookup:{ggbLookup.count}
        </span>
      )}
      {ggbEvalStats && ggbEvalStats.total > 0 && (
        <span className="wp-math__status-ggb" title="画布 evalCommand 成功数 / 尝试数（含纠错）">
          eval:{ggbEvalStats.ran}/{ggbEvalStats.total}{ggbRepairs > 0 ? ` ·fix:${ggbRepairs}` : ''}
        </span>
      )}
      {contextCheckpoint && (
        <span
          className="wp-math__status-ggb"
          title={`上下文保留 ${contextCheckpoint.retainedChars}/${contextCheckpoint.inputChars} 字符；对话摘要不会成为几何真相`}
        >
          ctx:{contextCheckpoint.retainedMessageCount}/{contextCheckpoint.eligibleMessageCount}
        </span>
      )}
      {geometryProjection && (
        <span
          className="wp-math__status-ggb"
          title={`GeoGebra GeometryDoc · ${geometryProjection.status} · ${geometryProjection.entities} 个实体 · ${geometryProjection.opaqueCommands} 条 opaque 命令 · semantic ${geometryProjection.semanticHash} · relations ${geometryProjection.relationHash}`}
        >
          geo:r{geometryProjection.revision} ·sig:{geometryProjection.semanticHash.slice(0, 6)}
          {!geometryProjection.semanticComparable ? '?' : ''}
        </span>
      )}
      <span className="wp-math__status-text">{statusText}</span>
    </div>
  );

  const providerPills = (
    <div className="wp-math__providers">
      <button
        className={`wp-math__pill${providers.includes(provider) ? ' wp-math__pill--active' : ''}`}
        disabled
        title={staticPreview ? 'GitHub Pages 静态预览不连接 AI 服务' : '所有请求统一通过 api.molamaker.cn'}
      >
        {staticPreview ? 'static preview' : PROVIDER_LABELS[provider]}
      </button>
    </div>
  );

  const drawingModelPicker = providers.includes(provider) ? (
    <div className="wp-math__model-row">
      <label className="wp-math__model-label" htmlFor="math-studio-draw-model">
        作图模型
        {modelsLoading && <span className="wp-math__model-probe"> · 从 api.molamaker.cn 获取中…</span>}
        {!modelsLoading && modelsSource === 'unavailable' && (
          <span className="wp-math__model-probe" title={modelsError}> · 暂未取得模型列表</span>
        )}
      </label>
      <select
        id="math-studio-draw-model"
        className="wp-math__model-select"
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={streaming || modelsLoading || catalogModels.length === 0}
      >
        {catalogModels.length === 0 && (
          <option value="">{modelsLoading ? '加载中…' : '无可用模型'}</option>
        )}
        {catalogModels.map((m) => (
          <option key={m.id} value={m.id} title={m.id}>
            {m.label !== m.id ? `${m.label} · ` : ''}{m.id}
          </option>
        ))}
      </select>
      {modelsError && !modelsLoading && (
        <p className="wp-math__model-hint" title={modelsError}>模型列表：{modelsError}</p>
      )}
    </div>
  ) : null;

  return (
    <>
      {!startOpen ? (
        <div
          className="wp-tile wp-tile--math"
          onClick={openStudio}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudio(); } }}
        >
          <div className="wp-tile__head">
            <span className="wp-tile__name">Math</span>
            <span className="wp-tile__status">
              <span className="wp-tile__dot wp-tile__dot--live" />
              geogebra
            </span>
          </div>
          <div className="wp-tile__desc">
            Describe a geometry construction and watch it drawn live in a full
            GeoGebra workspace — full toolbar, algebra view, and every native tool.
          </div>
          <div className="wp-math__tile-providers" onClick={(e) => e.stopPropagation()}>
            {providerPills}
          </div>
          <div className="wp-tile__actions">
            <button className="wp-tile__btn wp-tile__btn--primary" onClick={(e) => { e.stopPropagation(); openStudio(); }}>
              ⛶ Open Studio
            </button>
          </div>
          {providers.length === 0 && (
            <span className="wp-math__launch-note">
              {staticPreview
                ? '静态预览：GeoGebra 原生工具可用；AI 助手需要完整站点。'
                : '请在 .env.local 配置 LLM_RELAY_API_KEY，然后重启开发服务器。'}
            </span>
          )}
        </div>
      ) : null}

      {studioMounted && typeof document !== 'undefined' && createPortal(
        <div className={`wp-studio${studioOpen ? ' is-open' : ''}${perfMode ? ' wp-studio--perf' : ''}${sidebarOpen ? '' : ' wp-studio--sidebar-collapsed'}${katexPanelOpen ? ' wp-studio--katex-open' : ''}`}>
          <aside className={`wp-studio__sidebar${sidebarOpen ? '' : ' is-collapsed'}`}>
            <div className="wp-studio__bar">
              <span className="wp-studio__title">Assistant</span>
              <span className="wp-studio__bar-tools">
                <button
                  className={`wp-studio__perf${perfMode ? ' is-on' : ''}`}
                  onClick={() => setPerfMode((v) => !v)}
                  title={perfMode ? 'Performance mode ON' : 'Performance mode OFF'}
                  aria-label="Toggle performance mode"
                >⚡</button>
                <button
                  className="wp-studio__collapse"
                  onClick={() => setSidebarOpen((v) => !v)}
                  title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                  aria-label="Toggle sidebar"
                >{sidebarOpen ? '‹' : '›'}</button>
              </span>
            </div>

            {providerPills}
            {drawingModelPicker}
            {studioStatus}

            <div className="wp-studio__messages" ref={chatRef}>
              {messages.length === 0 && (
                <div className="wp-math__hint">
                  {staticPreview ? (
                    <>
                      <div>静态预览已就绪。使用右侧工具栏或代数输入直接构造几何图形。</div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>AI 助手、模型目录和服务端修复只在完整站点启用。</div>
                    </>
                  ) : (
                    <>
                      <div>输入题目，或先敲 <code>/</code> 查看斜杠命令。</div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>默认 <code>/draw</code> — 完整精确作图。例：<code>/draw 锐角三角形 ABC，外接圆 Γ，I 为内心…</code></div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>渲染后用 <code>/continue</code> 在当前图形上修改。</div>
                    </>
                  )}
                </div>
              )}
              {!showAllMsgs && messages.length > MSG_VISIBLE && (
                <button type="button" className="wp-math__more" onClick={() => setShowAllMsgs(true)}>
                  ▾ 展开更早的 {messages.length - MSG_VISIBLE} 条消息
                </button>
              )}
              {(showAllMsgs ? messages : messages.slice(-MSG_VISIBLE)).map((msg, i, arr) => (
                <MessageBubble key={messages.length - arr.length + i} msg={msg} />
              ))}
            </div>

            {error && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--signal-red, #c0392b)', padding: '6px 0' }}>
                ⚠ {error}
              </div>
            )}

            <div className="wp-math__input-row">
              {showCommandPalette && (
                <ul className="wp-math__cmd-palette" role="listbox" aria-label="斜杠命令">
                  {paletteCommands.map((cmd, i) => (
                    <li key={cmd.name} role="option" aria-selected={i === paletteIndex}>
                      <button
                        type="button"
                        className={`wp-math__cmd-item${i === paletteIndex ? ' is-active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); applyPaletteCommand(cmd.name); }}
                      >
                        <span className="wp-math__cmd-label">{cmd.label}</span>
                        <span className="wp-math__cmd-summary">{cmd.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                id="wp-math-problem"
                name="math-problem"
                className="wp-math__textarea"
                value={input}
                onChange={(e) => { setInput(e.target.value); setPaletteIndex(0); }}
                onKeyDown={handleInputKeyDown}
                placeholder={staticPreview
                  ? 'GitHub Pages 静态预览不连接 AI 服务，可直接使用右侧 GeoGebra 工具'
                  : '/draw 题目… 或输入 / 唤起命令（Enter 发送）'}
                disabled={staticPreview || streaming}
                rows={2}
              />
              <button className="wp-math__send" onClick={send} disabled={staticPreview || streaming || !input.trim() || !selectedModel}>
                {streaming ? '…' : '↵'}
              </button>
            </div>

            <div className="wp-math__actions">
              <button className="wp-math__action-btn" onClick={clearChat} disabled={streaming}>Clear chat</button>
              <button className="wp-math__action-btn" onClick={resetCanvas} disabled={!ggbReady}>Reset canvas</button>
            </div>
          </aside>

          <div
            ref={stageRef}
            className={`wp-studio__stage${pureMode ? ' is-pure' : ''}`}
            onDoubleClick={(e) => {
              // double-click on the stage chrome (bar / padding, not the live
              // applet which owns its own gestures) toggles pure mode
              if ((e.target as HTMLElement).closest('button, .wp-ggb-host')) return;
              setPureMode((v) => !v);
            }}
          >
            <div className="wp-studio__stage-bar">
              <span className="wp-studio__stage-label">GeoGebra{pureMode ? ' · 纯净模式' : ''}</span>
              <span className="wp-studio__stage-tools">
                <button
                  type="button"
                  className={`wp-studio__steps-toggle${stepsOpen ? ' is-on' : ''}`}
                  onClick={() => (stepsOpen ? closeSteps() : openSteps())}
                  disabled={!ggbReady || lastSuccessfulRef.current.length === 0}
                  title="把当前作图分解为严谨的步骤（可逐步回放）"
                  aria-label="Construction steps"
                >≡ 步骤</button>
                <button
                  type="button"
                  className="wp-studio__magic"
                  onClick={runMagicExport}
                  disabled={!ggbReady}
                  title="导出当前画布为 TikZ（tkz-euclide / 原始 PGF）"
                  aria-label="Export canvas to TikZ"
                >✨ Magic!</button>
                <button
                  type="button"
                  className={`wp-studio__katex-toggle${katexPanelOpen ? ' is-on' : ''}`}
                  onClick={() => setKatexPanelOpen((v) => !v)}
                  title={katexPanelOpen ? '关闭公式面板' : '打开公式面板（KaTeX）'}
                  aria-label="Toggle KaTeX panel"
                >∑</button>
                <button
                  type="button"
                  className={`wp-studio__pure-toggle${pureMode ? ' is-on' : ''}`}
                  onClick={() => setPureMode((v) => !v)}
                  title={pureMode ? '退出纯净模式 (Esc)' : '纯净模式 — 画布全屏（双击画布边缘也可）'}
                  aria-label="Toggle pure fullscreen canvas"
                >⛶</button>
                <button
                  className="wp-studio__close"
                  onClick={() => {
                    if (startOpen) {
                      window.location.assign(homeHref);
                      return;
                    }
                    setStudioOpen(false);
                  }}
                  title="Close studio (Esc)"
                  aria-label="Close studio"
                >×</button>
              </span>
            </div>
            <main ref={canvasRef} className={`wp-studio__canvas ${GGB_SCALE_CLASS}`}>
              {!ggbReady && !ggbError && <div className="wp-math__ggb-loading">Loading GeoGebra…</div>}
              {!ggbReady && ggbError && (
                <div className="wp-math__ggb-error">
                  <span className="wp-math__ggb-error-msg">⚠ {ggbError}</span>
                  <button className="wp-math__action-btn" onClick={retryGgb}>Retry</button>
                </div>
              )}
              <div id={GGB_CONTAINER_ID} className="wp-ggb-host" />
            </main>

            {pureMode && (
              <div className="wp-pure-hint" aria-hidden="true">纯净模式 — Esc 或 ⛶ 退出</div>
            )}

            {stepsOpen && (
              <aside className="wp-steps" aria-label="作图步骤">
                <div className="wp-steps__bar">
                  <span className="wp-steps__title">作图步骤 · {steps.length}</span>
                  <button type="button" className="wp-steps__copy" onClick={narrateSteps} disabled={!steps.length || narrating}
                    title="让模型基于这些步骤生成一篇严谨讲解（显示在 KaTeX 面板）">
                    {narrating ? '讲解中…' : '✎ 讲解'}
                  </button>
                  <button type="button" className="wp-steps__copy" onClick={copyProtocol} disabled={!steps.length}>
                    {protocolCopied ? '已复制 ✓' : '复制'}
                  </button>
                  <button type="button" className="wp-steps__close" onClick={closeSteps} aria-label="Close steps">×</button>
                </div>
                <ol className="wp-steps__list">
                  {steps.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className={`wp-steps__item${stepIndex === i ? ' is-active' : ''}${stepIndex !== null && i > stepIndex ? ' is-future' : ''}`}
                        onClick={() => { setStepsPlaying(false); goToStep(i); }}
                      >
                        <span className="wp-steps__num">{s.n}</span>
                        <span className="wp-steps__body">
                          <span className="wp-steps__text">{s.text}</span>
                          <code className="wp-steps__cmd">{s.cmd}</code>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="wp-steps__nav">
                  <button type="button" onClick={() => { setStepsPlaying(false); goToStep(0); }} disabled={!steps.length || stepIndex === 0} aria-label="First step">⏮</button>
                  <button type="button" onClick={() => { setStepsPlaying(false); goToStep(Math.max(0, (stepIndex ?? steps.length) - 1)); }} disabled={!steps.length || stepIndex === 0} aria-label="Previous step">◀</button>
                  <button
                    type="button"
                    className={`wp-steps__play${stepsPlaying ? ' is-on' : ''}`}
                    onClick={() => setStepsPlaying((v) => !v)}
                    disabled={!steps.length}
                    title={stepsPlaying ? '暂停播放' : '自动播放作图过程'}
                    aria-label={stepsPlaying ? 'Pause autoplay' : 'Play construction'}
                  >{stepsPlaying ? '❚❚' : '▶ 播放'}</button>
                  <span className="wp-steps__pos">{stepIndex === null ? '完整图形' : `${stepIndex + 1} / ${steps.length}`}</span>
                  <button type="button" onClick={() => { setStepsPlaying(false); if (stepIndex === null || stepIndex >= steps.length - 1) goToStep(null); else goToStep(stepIndex + 1); }} disabled={!steps.length || stepIndex === null} aria-label="Next step">▶</button>
                  <button type="button" onClick={() => { setStepsPlaying(false); goToStep(null); }} disabled={stepIndex === null} aria-label="Full figure">⏭</button>
                </div>
                <div className="wp-steps__hint">点击步骤回放到该步 · ← → 键也可逐步 · Esc 关闭</div>
              </aside>
            )}
          </div>

          <aside className={`wp-studio__katex${katexPanelOpen ? ' is-open' : ''}`} aria-hidden={!katexPanelOpen}>
            <div className="wp-studio__katex-bar">
              <span className="wp-studio__katex-title">KaTeX</span>
              <span className="wp-studio__katex-tabs">
                <button type="button" className={`wp-studio__katex-tab${katexView === 'render' ? ' is-active' : ''}`} onClick={() => setKatexView('render')}>渲染</button>
                <button type="button" className={`wp-studio__katex-tab${katexView === 'source' ? ' is-active' : ''}`} onClick={() => setKatexView('source')}>源码</button>
                <button type="button" className="wp-studio__katex-tab" onClick={() => { void copyTextToClipboard(katexDraft); }} disabled={!katexDraft.trim()} title="复制源码">复制</button>
              </span>
              <button type="button" className="wp-studio__katex-close" onClick={() => setKatexPanelOpen(false)} aria-label="Close KaTeX panel">×</button>
            </div>
            <div className="wp-studio__katex-body">
              {!katexDraft && (
                <p className="wp-studio__katex-empty">题目与回复中的公式会显示在这里；可在「源码」中编辑后切回「渲染」预览。</p>
              )}
              {katexDraft && katexView === 'source' && (
                <textarea
                  className="wp-studio__katex-source wp-studio__katex-editor"
                  value={katexDraft}
                  onChange={(e) => setKatexDraft(e.target.value)}
                  spellCheck={false}
                  aria-label="KaTeX 源码编辑"
                />
              )}
              {katexDraft && katexView === 'render' && (
                <div className="wp-studio__katex-render wp-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{katexDraft}</ReactMarkdown>
                </div>
              )}
            </div>
          </aside>

          {tikzOpen && tikzResult && (
            <div className="wp-tikz" role="dialog" aria-modal="true" aria-label="TikZ 导出">
              <div className="wp-tikz__backdrop" onClick={() => setTikzOpen(false)} />
              <div className="wp-tikz__panel">
                <div className="wp-tikz__bar">
                  <span className="wp-tikz__title">TikZ 导出</span>
                  <span className="wp-tikz__modes">
                    <button type="button" className={`wp-tikz__mode${tikzMode === 'tkz' ? ' is-active' : ''}`} onClick={() => setTikzMode('tkz')}>tkz-euclide</button>
                    <button type="button" className={`wp-tikz__mode${tikzMode === 'raw' ? ' is-active' : ''}`} onClick={() => setTikzMode('raw')}>原始 PGF</button>
                    <button
                      type="button"
                      className={`wp-tikz__mode${tikzStepComments ? ' is-active' : ''}`}
                      onClick={() => setTikzStepComments((v) => !v)}
                      title="在导出的 LaTeX 顶部以注释形式附上作图步骤"
                    >附步骤</button>
                  </span>
                  <button type="button" className="wp-tikz__copy" onClick={copyTikz} disabled={!tikzResult.code.trim()}>{tikzCopied ? '已复制 ✓' : '复制'}</button>
                  <button type="button" className="wp-tikz__close" onClick={() => setTikzOpen(false)} aria-label="Close TikZ panel">×</button>
                </div>
                <textarea className="wp-tikz__code" value={tikzResult.code} readOnly spellCheck={false} aria-label="TikZ 源码" />
                <div className="wp-tikz__note">{tikzResult.note}</div>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
