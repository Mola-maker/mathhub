'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, MotionConfig } from 'motion/react';
import { analyze } from '@/lib/tikz/analyze';
import { SAMPLE_TIKZ } from '@/lib/tikz/prompt/sample-code';
import { runTikzRepair } from '@/lib/tikz/repair/tikz-repair';
import { TikzCanvas } from './tikz/tikz-canvas';
import { TikzCodePanel } from './tikz/tikz-code-panel';
import { TikzStylePanel } from './tikz/tikz-style-panel';
import { TikzStepsPanel } from './tikz/tikz-steps-panel';
import { TikzToolbar } from './tikz/tikz-toolbar';
import { TikzToolPalette } from './tikz/tikz-tool-palette';
import { TikzSyntaxPanel } from './tikz/tikz-syntax-panel';
import { useTikzEngine } from './tikz/use-tikz-engine';
import { createDefaultCommandRegistry } from '@/lib/tikz/commands/default-commands';
import { buildSceneManifestAsync } from '@/lib/tikz/semantics/scene-manifest';
import {
  applyTextPatches,
  minimalTextPatch,
} from '@/lib/tikz/document/source-transaction';
import {
  buildGeometryAiContext,
  compileAiWriteProposal,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '@/lib/tikz/ir';
import {
  publishTikzWorkspaceSnapshot,
  subscribeTikzStudioOpen,
} from '@/lib/tikz/workspace/studio-events';
import { buildSceneHeatmap } from '@/lib/tikz/semantics/scene-heatmap';

type Provider = 'relay';
type Message = { role: 'user' | 'assistant'; content: string };
type ModelRow = { id: string; label?: string };

const PROVIDER_ORDER: Provider[] = ['relay'];
const PROVIDER_LABELS: Record<Provider, string> = { relay: 'api.molamaker.cn' };
const STALE_PROJECTION_MESSAGE =
  '当前源码结构未完成；请先修复语法，再让 AI 基于最新画板续画';
const LOCKED_PROJECTION_MESSAGE =
  '当前源码包含作用域级未知语法；为保护原文，AI 暂不自动写回';
function availableProviders(payload: unknown): Provider[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as { available?: unknown; providers?: unknown };
  const raw = Array.isArray(data.available)
    ? data.available
    : Array.isArray(data.providers) ? data.providers : [];
  return raw.filter((value): value is Provider => PROVIDER_ORDER.includes(value as Provider));
}

function updateLastAssistant(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  updater: (content: string) => string,
) {
  setMessages((previous) => {
    const next = [...previous];
    const last = next[next.length - 1];
    if (last?.role === 'assistant') {
      next[next.length - 1] = { ...last, content: updater(last.content) };
    } else {
      next.push({ role: 'assistant', content: updater('') });
    }
    return next;
  });
}

export function TikzStudio({
  startOpen = false,
  initialSelectionRefs = [],
  initialStmtIndex = null,
}: {
  startOpen?: boolean;
  initialSelectionRefs?: readonly string[];
  initialStmtIndex?: number | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(startOpen);
  const [pureMode, setPureMode] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider>('relay');
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [exactMode, setExactMode] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [revealUpTo, setRevealUpTo] = useState<number | undefined>(undefined);
  const [catalogError, setCatalogError] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const engine = useTikzEngine(SAMPLE_TIKZ, {
    selectionRefs: initialSelectionRefs,
    stmtIndex: initialStmtIndex,
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const commandRegistry = useMemo(
    () => createDefaultCommandRegistry(),
    [],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const scene = engine.scene;
    const activeEntityIds = engine.geometryInvalidation?.changedEntityIds ?? [];
    const activeStmtIndices = scene
      ? [
          ...scene.points.values(),
          ...scene.elements,
        ]
          .filter((item) => activeEntityIds.includes(item.stableId))
          .map((item) => item.stmtIndex)
      : [];
    const heatmap = scene
      ? buildSceneHeatmap(scene, {
          selection: engine.selection,
          selectedStmtIndex: engine.selectedStmtIndex,
          hoveredStmtIndex: engine.hoveredStmtIndex,
          activeEntityIds,
          activeStmtIndices,
        })
      : { entries: [], totals: { dependency: 0, risk: 0, activity: 0 }, maximums: { dependency: 0, risk: 0, activity: 0 } };
    publishTikzWorkspaceSnapshot({
      revision: engine.revision,
      semanticRevision: engine.semanticRevision,
      updatedAt: Date.now(),
      pointCount: scene
        ? [...scene.points.values()].filter((point) => !point.internal).length
        : 0,
      elementCount: scene?.elements.length ?? 0,
      issueCount: scene?.issues.length ?? 0,
      sourceIssueCount: engine.issues.length,
      projectionState: engine.semanticProjectionState,
      lastEditOrigin: engine.lastEditOrigin,
      heatmap,
    });
  }, [
    engine.geometryInvalidation,
    engine.hoveredStmtIndex,
    engine.issues.length,
    engine.lastEditOrigin,
    engine.revision,
    engine.scene,
    engine.selectedStmtIndex,
    engine.selection,
    engine.semanticRevision,
    engine.semanticProjectionState,
  ]);

  useEffect(() => {
    if (!engine.interactiveWritebackSafe) return;
    setCatalogError((current) => (
      current === STALE_PROJECTION_MESSAGE
      || current === LOCKED_PROJECTION_MESSAGE
        ? ''
        : current
    ));
  }, [engine.interactiveWritebackSafe]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tikz/providers', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const next = availableProviders(data);
        setProviders(next);
        setProvider((current) => (
          next.length > 0 && !next.includes(current) ? next[0] : current
        ));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setProviders([]);
        setCatalogError('模型服务目录暂不可用');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!providers.includes(provider)) {
      setModels([]);
      setModel('');
      return;
    }
    let disposed = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setCatalogError('');

    const loadModels = async (attempt: number) => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/tikz/models?provider=${encodeURIComponent(provider)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as {
          models?: ModelRow[];
          defaultModel?: string;
          listError?: string;
          source?: 'api' | 'cache' | 'stale-cache' | 'unavailable';
        };
        const nextModels = Array.isArray(data.models) ? data.models.filter((row) => row?.id) : [];
        if (nextModels.length === 0) {
          throw new Error(data.listError || '模型目录为空');
        }
        if (disposed) return;
        setModels(nextModels);
        setCatalogError(data.listError ?? '');
        setModel((current) => (
          current && nextModels.some((row) => row.id === current)
            ? current
            : data.defaultModel || nextModels[0]?.id || ''
        ));
        if (data.source === 'stale-cache' && attempt < 2) {
          retryTimer = setTimeout(() => void loadModels(attempt + 1), 3_000);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (disposed) return;
        if (attempt < 2) {
          setCatalogError('模型目录连接波动，正在自动重试…');
          retryTimer = setTimeout(
            () => void loadModels(attempt + 1),
            attempt === 0 ? 1_200 : 3_000,
          );
          return;
        }
        setModels([]);
        setModel('');
        setCatalogError('无法读取模型列表，请稍后重试');
      }
    };

    void loadModels(0);
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [provider, providers]);

  const repairCode = useCallback(async (code: string) => {
    if (repairing) return;
    const baseSource = engine.code;
    const baseRevision = engine.revision;
    setRepairing(true);
    setRepairStatus('正在检查修复…');
    try {
      const result = await runTikzRepair({
        code,
        provider,
        model,
        maxRounds: providers.includes(provider) ? 2 : 0,
      });
      if (result.code !== code) {
        const patch = minimalTextPatch(baseSource, result.code);
        if (patch) {
          const committed = engine.applySourcePatch(
            patch,
            'repair',
            baseRevision,
          );
          if (!committed) {
            setRepairStatus('画板已发生变化，请基于最新画板重新修复');
            return;
          }
        }
      }
      if (result.errorsBefore === 0) {
        setRepairStatus('无需修复');
      } else if (result.errorsAfter === 0) {
        setRepairStatus('修复完成');
      } else if (result.errorsAfter < result.errorsBefore) {
        setRepairStatus(`问题减少至 ${result.errorsAfter} 个`);
      } else {
        setRepairStatus('已保留当前最佳版本');
      }
    } catch (error) {
      setRepairStatus(error instanceof Error ? `修复失败：${error.message}` : '修复失败');
    } finally {
      setRepairing(false);
    }
  }, [engine, model, provider, providers, repairing]);

  const openStudio = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('.tz-studio')) {
      openerRef.current = active;
    }
    setMounted(true);
    setOpen(true);
  }, []);

  useEffect(() => subscribeTikzStudioOpen((request) => {
    openStudio();
    if (request.selectionRefs || request.stmtIndex !== undefined) {
      requestAnimationFrame(() => {
        engineRef.current.setSelection(
          [...(request.selectionRefs ?? [])],
          request.stmtIndex ?? null,
        );
      });
    }
  }), [openStudio]);

  const closeStudio = useCallback(() => {
    if (startOpen) {
      window.location.assign('/');
      return;
    }
    setPureMode(false);
    setOpen(false);
  }, [startOpen]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const dialog = studioRef.current;
        const focusable = dialog
          ? [...dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter((element) => (
              element.getClientRects().length > 0
              && element.getAttribute('aria-hidden') !== 'true'
            ))
          : [];
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
            return;
          }
        }
      }
      if (event.defaultPrevented) return;
      commandRegistry.dispatch({
        shortcut: event,
        event,
        scope: 'studio',
        context: { closeStudio },
      });
    };
    const dialog = studioRef.current;
    const background = [...document.body.children]
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement
        && element !== dialog
        && !element.contains(dialog)
        && element.tagName !== 'SCRIPT'
        && element.tagName !== 'STYLE'
      ))
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      }));
    background.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      background.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      requestAnimationFrame(() => {
        if (openerRef.current?.isConnected) openerRef.current.focus();
      });
    };
  }, [closeStudio, commandRegistry, open]);

  const sendProblem = useCallback(async () => {
    const problem = input.trim();
    if (!problem || streaming) return;
    if (!engine.interactiveWritebackSafe) {
      setCatalogError(
        engine.semanticProjectionState === 'stale'
          ? STALE_PROJECTION_MESSAGE
          : LOCKED_PROJECTION_MESSAGE,
      );
      return;
    }
    if (!providers.includes(provider)) {
      setCatalogError('请先配置一个可用的模型服务');
      return;
    }
    if (!model) {
      setCatalogError('请先从 api.molamaker.cn 返回的列表中选择绘图模型');
      return;
    }

    const history = messages.slice(-6);
    const baseCode = engine.code;
    const baseRevision = engine.revision;
    const sceneManifest = await buildSceneManifestAsync({
      source: baseCode,
      sourceRevision: baseRevision,
      stmts: engine.stmts,
      scene: engine.scene,
      cst: engine.projection.cst,
      issues: engine.issues,
    }, {
      maxTokens: 6_000,
      maxPoints: 160,
      maxPaths: 120,
      maxElements: 220,
      maxIssues: 32,
      maxOpaqueNodes: 96,
    });
    const documentSnapshot = engine.document.getSnapshot();
    const geometryTruths = projectTikzAnalysisToGeometryTruth({
      analysis: engine.projection,
      source: baseCode,
      hashAlgorithm: sceneManifest.hashAlgorithm,
      basis: {
        documentId: documentSnapshot.documentId,
        epoch: documentSnapshot.epoch,
        revision: baseRevision,
        sourceHash: sceneManifest.sourceHash,
        sourceId: `${documentSnapshot.documentId}:tikz`,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const inferredContextRefs = geometryTruths.semantic.ir.entities.flatMap(
      (entity) => (
        entity.name && problem.includes(entity.name) ? [entity.name] : []
      ),
    );
    const explicitContextRefs = [...new Set([
      ...engine.selection,
      ...inferredContextRefs,
    ])].slice(0, 64);
    const contextRefs = explicitContextRefs.length > 0
      ? explicitContextRefs
      : geometryTruths.semantic.ir.entities
        .map((entity) => entity.id)
        .slice(0, 64);
    const semanticKernel = buildGeometryAiContext(
      geometryTruths,
      {
        maxEntities: 220,
        maxConstraints: 160,
        maxRelations: 280,
        maxBindings: 220,
        maxOpaqueNodes: 96,
        focusRefs: contextRefs,
        focusDepth: 3,
      },
    );
    setStreaming(true);
    setCatalogError('');
    setMessages((previous) => [
      ...previous,
      { role: 'user', content: problem },
      { role: 'assistant', content: '' },
    ]);
    setInput('');

    try {
      const response = await fetch('/api/tikz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'build',
          problem,
          history,
          provider,
          model: model || undefined,
          tikzCode: baseCode,
          sourceRevision: baseRevision,
          sourceHash: sceneManifest.sourceHash,
          sceneManifest,
          semanticKernel,
          contextRefs,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let appliedAiTransactionId: string | null = null;
      let receivedAiProposal = false;
      let reportedMissingAiProposal = false;
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const payload = dataLine.slice(6);
          if (payload === '[DONE]') continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (typeof event.token === 'string') {
            updateLastAssistant(setMessages, (content) => content + event.token);
          }
          if (event.aiPatchProposal !== undefined) {
            receivedAiProposal = true;
            const compiled = compileAiWriteProposal(
              event.aiPatchProposal,
              {
                basis: semanticKernel.basis,
                bindings: semanticKernel.construction.sourceBindings.map((binding) => ({
                  bindingId: binding.id,
                  sourceId: binding.sourceId,
                  range: binding.range,
                  writable: binding.writable,
                  opaque: binding.opaque,
                  insertionPolicy: binding.insertionPolicy,
                  writeCapabilities: binding.writeCapabilities,
                  ...(binding.managedConstructionId
                    ? { managedConstructionId: binding.managedConstructionId }
                    : {}),
                  ...(binding.managedPlanKind
                    ? { managedPlanKind: binding.managedPlanKind }
                    : {}),
                  ...(binding.managedContentFingerprint
                    ? { managedContentFingerprint: binding.managedContentFingerprint }
                    : {}),
                  ...(binding.sliceHash ? { sliceHash: binding.sliceHash } : {}),
                })),
                allowedBindingIds:
                  semanticKernel.construction.authorizedBindingIds,
                source: baseCode,
              },
              {
                pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
                metadata: {
                  contextRefs,
                  clientValidated: true,
                },
              },
            );
            if (!compiled.ok) {
              updateLastAssistant(
                setMessages,
                (content) => `${content}\n\nAI proposal 与当前画板 binding 或源码前置条件不匹配，已拒绝写入。`,
              );
            } else if (compiled.transaction.transactionId === appliedAiTransactionId) {
              continue;
            } else {
              const patches = compiled.transaction.operations.flatMap((operation) => (
                operation.op === 'source-patch'
                  ? operation.patches.map((patch) => ({
                    from: patch.range.start,
                    to: patch.range.end,
                    insert: patch.insert,
                  }))
                  : []
              ));
              let candidateCode: string;
              try {
                candidateCode = applyTextPatches(baseCode, patches);
              } catch {
                updateLastAssistant(
                  setMessages,
                  (content) => `${content}\n\nAI proposal 的多个源码操作发生冲突，已拒绝写入。`,
                );
                continue;
              }
              const candidate = analyze(candidateCode);
              const invalid = candidate.issues.some(
                (issue) => issue.severity === 'error',
              );
              if (invalid) {
                updateLastAssistant(
                  setMessages,
                  (content) => `${content}\n\nAI 事务未通过语法/语义投影校验，已保留为未提交提案。`,
                );
              } else {
                const commitResult = engine.commitSourceTransaction(
                  compiled.transaction,
                  {
                    hash: sceneManifest.sourceHash,
                    algorithm: sceneManifest.hashAlgorithm,
                    source: baseCode,
                    ...(semanticKernel.basis.kernelHash
                      ? { kernelHash: semanticKernel.basis.kernelHash }
                      : {}),
                    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
                  },
                );
                if (commitResult.ok) {
                  appliedAiTransactionId = compiled.transaction.transactionId;
                } else {
                  updateLastAssistant(
                    setMessages,
                    (content) => `${content}\n\n事务未提交：${commitResult.message}（${commitResult.code}）。`,
                  );
                }
              }
            }
          }
          if (typeof event.tikzCode === 'string') {
            if (appliedAiTransactionId) continue;
            if (event.tikzCode === baseCode) continue;
            if (!receivedAiProposal && !reportedMissingAiProposal) {
              reportedMissingAiProposal = true;
              updateLastAssistant(
                setMessages,
                (content) => `${content}\n\nAI 返回了源码预览，但缺少 binding-scoped proposal；为保护当前画板，本次结果未自动写入。`,
              );
            }
            continue;
          }
          if (typeof event.error === 'string') {
            updateLastAssistant(setMessages, () => `出错了：${event.error}`);
          }
        }
        if (done) break;
      }
    } catch (error) {
      updateLastAssistant(
        setMessages,
        () => `请求失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    } finally {
      setStreaming(false);
    }
  }, [engine, input, messages, model, provider, providers, repairCode, streaming]);

  const studioContent = open
    ? (
      <MotionConfig reducedMotion="user">
        <motion.div
          ref={studioRef}
          className={`tz-studio${pureMode ? ' tz-studio--pure' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="TikZ Studio"
          initial={{ opacity: 0, scale: 0.996 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 0.34,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
        <aside className="tz-sidebar">
          <div className="tz-sidebar__head">
            <div>
              <strong>TikZ 助手</strong>
              <span>自然语言构造几何</span>
            </div>
            <button ref={closeRef} type="button" onClick={closeStudio} aria-label="关闭 TikZ Studio">×</button>
          </div>
          <div className="tz-provider-row" aria-label="模型服务">
            <button
              type="button"
              className={providers.includes(provider) ? 'is-active' : ''}
              disabled
              title="所有请求统一通过 api.molamaker.cn"
            >
              {PROVIDER_LABELS[provider]}
            </button>
          </div>
          {providers.length === 0 ? (
            <div className="tz-catalog-error" role="status">
              请在 .env.local 配置 LLM_RELAY_API_KEY，然后重启开发服务器。
            </div>
          ) : null}
          <label className="tz-model">
            <span>绘图模型</span>
            <select
              value={model}
              disabled={models.length === 0}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.length === 0 ? <option value="">暂无可用模型</option> : null}
              {models.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label || row.id}
                </option>
              ))}
            </select>
          </label>
          {catalogError ? <div className="tz-catalog-error" role="status">{catalogError}</div> : null}
          <div className="tz-chat" aria-live="polite">
            {messages.length === 0
              ? (
                <div className="tz-chat__empty">
                  试试：“作三角形 ABC 的外接圆，并标出外心与三条中垂线。”
                </div>
              )
              : null}
            {messages.map((message, index) => (
              <motion.div
                key={`${message.role}:${index}`}
                layout
                className={`tz-msg tz-msg--${message.role}`}
                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.24,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {message.content || (streaming ? '正在思考…' : '…')}
              </motion.div>
            ))}
          </div>
          <div className="tz-composer">
            <textarea
              className="tz-input"
              value={input}
              aria-label="几何构造描述"
              placeholder="描述一个几何构造，如：作三角形 ABC 的外接圆并标出外心"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendProblem();
                }
              }}
            />
            <button
              className="tz-send"
              type="button"
              onClick={() => void sendProblem()}
              disabled={streaming || !input.trim() || !model}
            >
              {streaming ? '生成中…' : '发送 ↵'}
            </button>
          </div>
        </aside>
        <main className="tz-stage">
          <TikzToolbar
            pureMode={pureMode}
            onTogglePure={() => setPureMode((value) => !value)}
            onClose={closeStudio}
            engine={engine}
            repairing={repairing}
            repairStatus={repairStatus}
            onRepair={() => void repairCode(engine.code)}
            stepsOpen={stepsOpen}
            onToggleSteps={() => setStepsOpen((value) => !value)}
            exactMode={exactMode}
            onToggleExact={() => setExactMode((value) => !value)}
          />
          <TikzToolPalette engine={engine} />
          <TikzCanvas
            engine={engine}
            revealUpTo={revealUpTo}
            exactMode={exactMode}
          />
          {stepsOpen
            ? (
              <TikzStepsPanel
                engine={engine}
                revealUpTo={revealUpTo}
                onReveal={setRevealUpTo}
                onClose={() => {
                  setStepsOpen(false);
                  setRevealUpTo(undefined);
                }}
              />
            )
            : null}
        </main>
        <aside className="tz-code" data-testid="tikz-code-panel">
          <div className="tz-code__head">
            <button
              type="button"
              className="tz-code__syntax-toggle"
              onClick={() => setSyntaxOpen((value) => !value)}
              aria-expanded={syntaxOpen}
            >
              {syntaxOpen ? '返回源码' : '官方语法库'}
            </button>
            <span>TikZ 源码</span>
            <span>唯一真源</span>
          </div>
          {syntaxOpen ? (
            <TikzSyntaxPanel
              engine={engine}
              onClose={() => setSyntaxOpen(false)}
            />
          ) : null}
          <TikzCodePanel
            document={engine.document}
            issues={engine.issues}
            statements={engine.stmts}
            hoveredStmtIndex={engine.hoveredStmtIndex}
            onHoverStatement={engine.setHoveredStmtIndex}
          />
          <TikzStylePanel engine={engine} />
        </aside>
        </motion.div>
      </MotionConfig>
    )
    : null;
  const studio = startOpen
    ? studioContent
    : mounted && studioContent
      ? createPortal(studioContent, document.body)
      : null;

  return (
    <>
      {!startOpen
        ? (
          <button
            type="button"
            className="wp-tile wp-tile--tikz"
            onClick={openStudio}
            aria-label="打开 TikZ Studio"
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openStudio();
              }
            }}
          >
            <div className="wp-tile__head">
              <span className="wp-tile__name">TikZ</span>
              <span className="wp-tile__status">
                <span className="wp-tile__dot wp-tile__dot--live" />
                tikz studio
              </span>
            </div>
            <div className="wp-tile__desc">
              用自然语言描述竞赛几何题，生成可交互的 TikZ 构造图。代码可见，构造关系可追踪。
            </div>
            <div className="wp-tile__actions">
              <span
                className="wp-tile__btn wp-tile__btn--primary"
              >
                ⛶ 打开 Studio
              </span>
            </div>
          </button>
        )
        : null}
      {studio}
    </>
  );
}
