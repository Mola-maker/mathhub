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
import { TikzSelectionTransform } from './tikz/tikz-selection-transform';
import { TikzSyntaxPanel } from './tikz/tikz-syntax-panel';
import { AgentRunSteps } from './tikz/agent-run-steps';
import { requestTikzVisualAudit } from './tikz/visual-audit-client';
import {
  AgentMessageWidgets,
  parseAgentMessageWidget,
  type AgentMessageWidget,
} from './tikz/agent-message-widgets';
import {
  AssistantMessageContent,
  assistantHistoryText,
} from './tikz/agent-message-content';
import { useTikzEngine } from './tikz/use-tikz-engine';
import { createDefaultCommandRegistry } from '@/lib/tikz/commands/default-commands';
import { buildSceneManifest } from '@/lib/tikz/semantics/scene-manifest';
import {
  applyTextPatches,
  minimalTextPatch,
} from '@/lib/tikz/document/source-transaction';
import { hashSource } from '@/lib/tikz/document/source-hash';
import {
  buildGeometryAiContext,
  compileAiWriteProposal,
  TIKZ_PLUGIN_SET_DIGEST,
} from '@/lib/tikz/ir';
import {
  subscribeTikzStudioOpen,
} from '@/lib/tikz/workspace/studio-events';
import { matchesAiTransactionAttestation } from '@/lib/tikz/transactions/transaction-attestation';
import {
  isTikzAgentEvent,
  tikzAgentEvent,
  type TikzAgentEvent,
} from '@/lib/tikz/agent/protocol';
import { projectGeometryFlowEntityRefs } from '@/lib/tikz/agent/flow-projection';
import {
  emptyTikzAgentRun,
  reduceTikzAgentRun,
  type TikzAgentRunState,
} from '@/lib/tikz/agent/run-reducer';
import {
  geometryFlowBasisMatches,
  type GeometryFlowWidget,
} from '@/lib/tikz/agent/widget-protocol';
import {
  acknowledgeTikzAgentProposalCommit,
  fetchTikzAgentRunReplay,
  rejectTikzAgentProposal,
  type TikzAgentReplayProposalSummary,
} from '@/lib/tikz/agent/run-replay-client';
import { compactTikzConversationHistory } from '@/lib/tikz/agent/conversation-history';
import {
  canAdvanceTikzAsyncWorkItem,
  createTikzAsyncWorkItemId,
  sameTikzAsyncWorkBasis,
  type TikzAsyncWorkItem,
} from '@/lib/tikz/runtime/work-item';

type Provider = 'relay';
export type TikzStudioMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  steps?: TikzAgentEvent[];
  widgets?: AgentMessageWidget[];
  run?: TikzAgentRunState;
  recovery?: AgentRunRecoveryState;
};
type Message = TikzStudioMessage;
export type AgentRunRecoveryState = {
  readonly status: 'replayed' | 'pending-revalidation' | 'terminal' | 'unavailable';
  readonly runId: string;
  readonly lastSequence: number;
  readonly proposal?: Pick<
    TikzAgentReplayProposalSummary,
    'transactionId' | 'beforeRevision' | 'afterRevision'
  >;
  readonly detail: string;
};
type ModelRow = { id: string; label?: string };

const PROVIDER_ORDER: Provider[] = ['relay'];
const PROVIDER_LABELS: Record<Provider, string> = { relay: 'api.molamaker.cn' };
const MAX_ASSISTANT_CONTENT_CHARS = 64 * 1024;
const MAX_AGENT_STEPS_PER_MESSAGE = 64;
const MAX_AGENT_WIDGETS_PER_MESSAGE = 8;
const MAX_CHAT_MESSAGES = 50;
const MAX_SSE_FRAME_CHARS = 64 * 1024;
const MAX_SSE_BUFFER_CHARS = 384 * 1024;
const MAX_SSE_TOTAL_BYTES = 512 * 1024;
const AGENT_RUN_TIMEOUT_MS = 150_000;
const STALE_PROJECTION_MESSAGE =
  '当前源码结构未完成；请先修复语法，再让 AI 基于最新画板续画';
const LOCKED_PROJECTION_MESSAGE =
  '当前源码包含作用域级未知语法；为保护原文，AI 暂不自动写回';
let fallbackMessageSequence = 0;

function createChatTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackMessageSequence += 1;
  return `${Date.now().toString(36)}-${fallbackMessageSequence.toString(36)}`;
}

export function claimTikzAgentTurn(
  admission: { current: string | null },
  clientTurnId: string,
): boolean {
  if (admission.current) return false;
  admission.current = clientTurnId;
  return true;
}

/**
 * Project a durable Agent terminal into user-visible chat when the provider
 * produced no displayable text. Terminal events are authoritative lifecycle
 * state, but the timeline alone must never make a failed turn look like a
 * successful empty answer.
 */
export function assistantFallbackForTikzAgentTerminal(
  event: TikzAgentEvent,
): string | null {
  if (event.type === 'run.failed') {
    return `请求失败：${event.detail?.trim() || event.title}`;
  }
  if (event.type !== 'run.completed') return null;
  if (event.outcome === 'answer') {
    return '本轮已结束，但模型没有返回可展示的最终答复；画板未改变，请重试。';
  }
  if (event.outcome === 'mutation') {
    return '画板与 TikZ 源码的修改已完成。';
  }
  if (event.outcome === 'unapplied-candidate') {
    return event.detail?.trim() || `${event.title}；画板未改变。`;
  }
  return null;
}

function ensureAssistantTerminalFallback(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  assistantMessageId: string,
  event: TikzAgentEvent,
) {
  const fallback = assistantFallbackForTikzAgentTerminal(event);
  if (!fallback) return;
  updateAssistantMessage(
    setMessages,
    assistantMessageId,
    (content) => content.trim().length > 0 ? content : fallback,
  );
}

function availableProviders(payload: unknown): Provider[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as { available?: unknown; providers?: unknown };
  const raw = Array.isArray(data.available)
    ? data.available
    : Array.isArray(data.providers) ? data.providers : [];
  return raw.filter((value): value is Provider => PROVIDER_ORDER.includes(value as Provider));
}

export function isVisualAuditAvailable(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const providers = (payload as { providers?: unknown }).providers;
  if (!providers || typeof providers !== 'object') return false;
  const relay = (providers as Record<string, unknown>).relay;
  return Boolean(
    relay
    && typeof relay === 'object'
    && (relay as { visionConfigured?: unknown }).visionConfigured === true,
  );
}

export function reduceTikzStudioAssistantContent(
  previous: readonly Message[],
  assistantMessageId: string,
  updater: (content: string) => string,
): Message[] | readonly Message[] {
  const index = previous.findIndex((message) => (
    message.id === assistantMessageId && message.role === 'assistant'
  ));
  // A late stream/VLM/recovery callback must never fall through to the
  // newest turn. If its bounded chat entry was evicted, discard it.
  if (index < 0) return previous;
  const next = [...previous];
  const target = next[index]!;
  const proposed = updater(target.content);
  const bounded = proposed.length > MAX_ASSISTANT_CONTENT_CHARS
    ? `${proposed.slice(0, MAX_ASSISTANT_CONTENT_CHARS)}\n\n[回复过长，已截断]`
    : proposed;
  next[index] = {
    ...target,
    content: target.content && !bounded.includes(target.content)
      ? `${target.content}\n\n${bounded}`.slice(0, MAX_ASSISTANT_CONTENT_CHARS)
      : bounded,
  };
  return next;
}

function updateAssistantMessage(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  assistantMessageId: string,
  updater: (content: string) => string,
) {
  setMessages((previous) => {
    const next = reduceTikzStudioAssistantContent(previous, assistantMessageId, updater);
    return next === previous ? previous : [...next];
  });
}

interface AssistantTokenBuffer {
  push(token: string): void;
  flush(): void;
  dispose(): void;
}

/** Batch provider deltas so a long answer does not clone React state per token. */
function createAssistantTokenBuffer(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  assistantMessageId: string,
): AssistantTokenBuffer {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending) return;
    const chunk = pending;
    pending = '';
    updateAssistantMessage(setMessages, assistantMessageId, (content) => content + chunk);
  };
  return {
    push(token) {
      pending += token;
      if (pending.length >= 2_048) flush();
      else timer ??= setTimeout(flush, 32);
    },
    flush,
    dispose() {
      flush();
    },
  };
}

export function reduceTikzStudioAgentStep(
  previous: readonly Message[],
  step: TikzAgentEvent,
  assistantMessageId: string,
): Message[] | readonly Message[] {
  const runIndex = previous.findIndex((message) => (
    message.role === 'assistant'
    && (message.runId === step.runId || message.run?.runId === step.runId)
  ));
  const targetIndex = runIndex >= 0
    ? runIndex
    : previous.findIndex((message) => (
        message.id === assistantMessageId && message.role === 'assistant'
      ));
  if (targetIndex < 0) return previous;
  const target = previous[targetIndex]!;
  if (
    (target.runId && target.runId !== step.runId)
    || (target.run && target.run.runId !== step.runId)
  ) return previous;
  const currentRun = target.run ?? emptyTikzAgentRun(step.runId);
  const run = reduceTikzAgentRun(currentRun, step);
  if (run === currentRun) return previous;
  const next = [...previous];
  next[targetIndex] = {
    ...target,
    runId: step.runId,
    steps: [...run.steps].slice(-MAX_AGENT_STEPS_PER_MESSAGE),
    run,
  };
  return next;
}

function appendAgentStep(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  step: TikzAgentEvent,
  assistantMessageId: string,
) {
  setMessages((previous) => {
    const next = reduceTikzStudioAgentStep(previous, step, assistantMessageId);
    if (next === previous) return previous;
    return [...next];
  });
}

function findRunAssistantIndex(
  messages: readonly Message[],
  assistantMessageId: string,
  runId?: string,
): number {
  if (runId) {
    const runIndex = messages.findIndex((message) => (
      message.role === 'assistant'
      && (message.runId === runId || message.run?.runId === runId)
    ));
    if (runIndex >= 0) return runIndex;
  }
  return messages.findIndex((message) => (
    message.id === assistantMessageId && message.role === 'assistant'
  ));
}

function updateAgentRecovery(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  recovery: AgentRunRecoveryState,
  assistantMessageId: string,
) {
  setMessages((previous) => {
    const index = findRunAssistantIndex(previous, assistantMessageId, recovery.runId);
    if (index < 0) return previous;
    const target = previous[index]!;
    if (target.runId && target.runId !== recovery.runId) return previous;
    const next = [...previous];
    next[index] = { ...target, runId: recovery.runId, recovery };
    return next;
  });
}

export function reduceTikzStudioAgentWidget(
  previous: readonly Message[],
  widget: AgentMessageWidget,
  assistantMessageId: string,
): Message[] | readonly Message[] {
  const index = findRunAssistantIndex(previous, assistantMessageId);
  if (index < 0) return previous;
  const next = [...previous];
  const target = next[index]!;
  const currentWidgets = target.widgets ?? [];
  if (widget.kind === 'visual-audit' && widget.workItem) {
    const workItemIndex = currentWidgets.findIndex((candidate) => (
      candidate.kind === 'visual-audit'
      && candidate.workItem?.itemId === widget.workItem?.itemId
    ));
    if (workItemIndex >= 0) {
      const currentWidget = currentWidgets[workItemIndex]!;
      if (
        currentWidget.kind !== 'visual-audit'
        || !currentWidget.workItem
        || !canAdvanceTikzAsyncWorkItem(currentWidget.workItem, widget.workItem)
      ) return previous;
      const widgets = [...currentWidgets];
      widgets[workItemIndex] = widget;
      next[index] = { ...target, widgets };
      return next;
    }
  }
  next[index] = {
    ...target,
    widgets: [...currentWidgets, widget].slice(-MAX_AGENT_WIDGETS_PER_MESSAGE),
  };
  return next;
}

function appendAgentWidget(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  widget: AgentMessageWidget,
  assistantMessageId: string,
) {
  setMessages((previous) => {
    const next = reduceTikzStudioAgentWidget(previous, widget, assistantMessageId);
    return next === previous ? previous : [...next];
  });
}

function updateMutationWidget(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  assistantMessageId: string,
  title: string,
  detail: string,
) {
  setMessages((previous) => {
    const index = findRunAssistantIndex(previous, assistantMessageId);
    if (index < 0) return previous;
    const target = previous[index]!;
    if (!target.widgets) return previous;
    const widgets = [...target.widgets];
    const widgetIndex = widgets.findLastIndex((widget) => widget.kind === 'mutation');
    if (widgetIndex < 0) return previous;
    const mutation = widgets[widgetIndex]!;
    if (mutation.kind !== 'mutation') return previous;
    widgets[widgetIndex] = { ...mutation, title, detail };
    const next = [...previous];
    next[index] = { ...target, widgets };
    return next;
  });
}

export function explicitGeometryAiContextRefs(
  selectionRefs: readonly string[],
  inspectorSemanticEntityId: string | null | undefined,
  inferredRefs: readonly string[],
): string[] {
  return [...new Set([
    ...selectionRefs,
    ...(inspectorSemanticEntityId ? [inspectorSemanticEntityId] : []),
    ...inferredRefs,
  ])].slice(0, 64);
}

export function inferredGeometryAiContextRefs(
  problem: string,
  entities: readonly {
    id: string;
    kind: string;
    name?: string;
    parameters?: Record<string, unknown>;
    tags?: readonly string[];
    metadata?: Record<string, unknown>;
  }[],
): string[] {
  const refs: string[] = [];
  const edgeCandidates: string[] = [];
  const ninePointCircleCandidates: string[] = [];
  const ninePointCenterCandidates: string[] = [];
  const mentionsNinePointCircle = /(?:\u4e5d\u70b9\u5706|nine[\s-]?point\s+circle|euler\s+circle)/iu
    .test(problem);
  const requestsAnnotation = /(?:\u6807\u7b7e|\u6807\u6ce8|\u547d\u540d|\u6587\u5b57|label|annotat(?:e|ion))/iu
    .test(problem);
  const mentionsNinePointCenter = /(?:\u4e5d\u70b9\u5706\u5fc3|nine[\s-]?point\s+cent(?:er|re)|euler\s+cent(?:er|re))/iu
    .test(problem);
  const namedInProblem = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u')
      .test(problem);
  };
  for (const entity of entities) {
    if (entity.name && namedInProblem(entity.name)) refs.push(entity.name);
    const constructionKind = typeof entity.metadata?.constructionKind === 'string'
      ? entity.metadata.constructionKind
      : typeof entity.metadata?.planKind === 'string'
        ? entity.metadata.planKind
        : undefined;
    const belongsToNinePointCircle = entity.tags?.includes('nine-point-circle')
      || constructionKind === 'nine-point-circle';
    if (belongsToNinePointCircle && entity.kind === 'circle') {
      ninePointCircleCandidates.push(entity.id);
    }
    if (
      belongsToNinePointCircle
      && entity.kind === 'point'
      && entity.tags?.includes('center')
    ) {
      ninePointCenterCandidates.push(entity.id);
    }
    if (!['polyline', 'segment', 'line', 'ray', 'vector'].includes(entity.kind)) continue;
    const references = entity.parameters?.references;
    if (!Array.isArray(references) || references.length !== 2) continue;
    const [from, to] = references;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const escapedTo = to.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const explicitPair = new RegExp(
      `(?:${escapedFrom}\\s*(?:--|[-–—])\\s*${escapedTo}|${escapedTo}\\s*(?:--|[-–—])\\s*${escapedFrom}|(?:线段|直线|射线|边)\\s*(?:${escapedFrom}${escapedTo}|${escapedTo}${escapedFrom}))`,
      'iu',
    );
    if (explicitPair.test(problem)) edgeCandidates.push(entity.id);
  }
  if (edgeCandidates.length === 1) refs.push(edgeCandidates[0]);
  // Construction names such as "nine-point circle" are semantic aliases, not
  // necessarily TikZ node names. Resolve them against the GeometryDoc tags so
  // a follow-up turn can focus the durable managed output instead of exposing
  // the whole document and asking the model to guess a binding. Ambiguity stays
  // fail-closed: multiple matching constructions require a Canvas selection.
  if (mentionsNinePointCircle && ninePointCircleCandidates.length === 1) {
    refs.push(ninePointCircleCandidates[0]!);
  }
  // A label is a separate managed construction anchored at a point. When the
  // user asks to annotate the unique nine-point circle, include its declared
  // center output alongside the circle. The host still allocates the label and
  // Broker-proves the point binding; no TikZ text or range is inferred here.
  if (
    (mentionsNinePointCenter || (mentionsNinePointCircle && requestsAnnotation))
    && ninePointCenterCandidates.length === 1
  ) {
    refs.push(ninePointCenterCandidates[0]!);
  }
  return [...new Set(refs)].slice(0, 64);
}

export function isCommittedGeometryProjection(
  engine: ReturnType<typeof useTikzEngine>,
  expectedRevision: number,
  expectedSource: string,
): boolean {
  return engine.revision === expectedRevision
    && engine.code === expectedSource
    && engine.geometryDoc?.basis.revision === expectedRevision
    && engine.geometryDoc.basis.pluginSetDigest === TIKZ_PLUGIN_SET_DIGEST;
}

async function waitForCommittedGeometryProjection(
  engineRef: { current: ReturnType<typeof useTikzEngine> },
  expectedRevision: number,
  expectedSource: string,
  signal: AbortSignal,
): Promise<ReturnType<typeof useTikzEngine> | null> {
  const deadline = Date.now() + 4_000;
  while (!signal.aborted && Date.now() < deadline) {
    const current = engineRef.current;
    if (isCommittedGeometryProjection(current, expectedRevision, expectedSource)) {
      return current;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  }
  return null;
}

async function consumeCommitVerificationStream(
  response: Response,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  terminalRunIds: Set<string>,
  assistantMessageId: string,
  expectedRunId: string,
): Promise<boolean> {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const tokenBuffer = createAssistantTokenBuffer(setMessages, assistantMessageId);
  let buffer = '';
  let totalBytes = 0;
  let terminalSeen = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      totalBytes += value?.byteLength ?? 0;
      if (totalBytes > MAX_SSE_TOTAL_BYTES) {
        throw new Error('AI 提交验证响应超过总量上限');
      }
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_SSE_BUFFER_CHARS) {
        throw new Error('AI 提交验证响应超过安全上限');
      }
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.length > MAX_SSE_FRAME_CHARS) {
          throw new Error('AI 提交验证事件超过安全上限');
        }
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
        if (
          event.aiPatchProposal !== undefined
          || event.sourceTransaction !== undefined
        ) {
          throw new Error('只读提交验证返回了未授权写入提案');
        }
        if (typeof event.token === 'string') {
          tokenBuffer.push(event.token);
        }
        if (event.agentEvent !== undefined || event.assistantWidget !== undefined || event.error !== undefined) {
          tokenBuffer.flush();
        }
        if (isTikzAgentEvent(event.agentEvent)) {
          if (event.agentEvent.runId !== expectedRunId) {
            throw new Error('AI 提交验证流包含了其他运行的事件');
          }
          if (!terminalRunIds.has(event.agentEvent.runId)) {
            appendAgentStep(setMessages, event.agentEvent, assistantMessageId);
          }
          if (
            event.agentEvent.type === 'run.completed'
            || event.agentEvent.type === 'run.failed'
          ) {
            terminalRunIds.add(event.agentEvent.runId);
            terminalSeen = true;
            ensureAssistantTerminalFallback(
              setMessages,
              assistantMessageId,
              event.agentEvent,
            );
          }
        }
        const widget = parseAgentMessageWidget(event.assistantWidget, 'host-sse');
        if (widget) appendAgentWidget(setMessages, widget, assistantMessageId);
        if (typeof event.error === 'string') throw new Error(event.error);
      }
      if (done) break;
    }
  } finally {
    tokenBuffer.dispose();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return terminalSeen;
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
  const [modelCatalogRequest, setModelCatalogRequest] = useState(0);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [visualAuditAvailable, setVisualAuditAvailable] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [activeGeometryFlow, setActiveGeometryFlow] = useState<GeometryFlowWidget | null>(null);
  const [exactMode, setExactMode] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [selectionTransformOpen, setSelectionTransformOpen] = useState(false);
  const [revealUpTo, setRevealUpTo] = useState<number | undefined>(undefined);
  const [catalogError, setCatalogError] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const agentTurnAdmissionRef = useRef<string | null>(null);
  const agentControllerRef = useRef<AbortController | null>(null);
  const recoveryControllerRef = useRef<AbortController | null>(null);
  const repairControllerRef = useRef<AbortController | null>(null);
  const componentMountedRef = useRef(false);
  const visualAuditControllersRef = useRef(new Map<string, {
    readonly controller: AbortController;
    readonly basis: TikzAsyncWorkItem<'visual-audit'>['basis'];
  }>());
  const engine = useTikzEngine(SAMPLE_TIKZ, {
    selectionRefs: initialSelectionRefs,
    stmtIndex: initialStmtIndex,
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    if (engine.selectionTargets.length === 0 || engine.activeTool !== 'select') {
      setSelectionTransformOpen(false);
    }
  }, [engine.activeTool, engine.selectionTargets.length]);
  const commandRegistry = useMemo(
    () => createDefaultCommandRegistry(),
    [],
  );
  const focusGeometryFlowRefs = useCallback((refs: readonly string[]) => {
    const current = engineRef.current;
    // Flow refs are only meaningful for the exact host-attested snapshot
    // that produced the flow.  Never focus/reveal a later or forked document.
    if (!geometryFlowBasisMatches(activeGeometryFlow, current.geometryDoc?.basis)) return;
    const projection = projectGeometryFlowEntityRefs(current.geometryDoc, refs);
    current.setSelection([...projection.entityIds], null);
    if (projection.revealThroughStatementIndex !== null) {
      setRevealUpTo(projection.revealThroughStatementIndex);
      setStepsOpen(true);
    }
  }, [activeGeometryFlow]);

  useEffect(() => {
    if (!activeGeometryFlow) return;
    if (geometryFlowBasisMatches(activeGeometryFlow, engine.geometryDoc?.basis)) return;
    // A source transaction, epoch fork, or semantic recompile invalidates the
    // flow.  Closing it also prevents the panel's autoplay effect from
    // retaining a stale callback while React commits the new projection.
    setActiveGeometryFlow(null);
    setStepsOpen(false);
  }, [activeGeometryFlow, engine.geometryDoc]);

  useEffect(() => {
    componentMountedRef.current = true;
    setMounted(true);
    return () => {
      componentMountedRef.current = false;
      agentControllerRef.current?.abort();
      agentControllerRef.current = null;
      agentTurnAdmissionRef.current = null;
      recoveryControllerRef.current?.abort();
      recoveryControllerRef.current = null;
      repairControllerRef.current?.abort();
      repairControllerRef.current = null;
      for (const audit of visualAuditControllersRef.current.values()) {
        audit.controller.abort(new DOMException('TikZ Studio closed', 'AbortError'));
      }
      visualAuditControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const basis = engine.geometryDoc?.basis;
    const currentBasis = basis
      ? {
          documentId: basis.documentId,
          epoch: basis.epoch,
          sourceId: basis.sourceId,
          revision: engine.revision,
          sourceHash: hashSource(engine.code),
          pluginSetDigest: basis.pluginSetDigest,
          ...(basis.kernelHash ? { kernelHash: basis.kernelHash } : {}),
          ...(basis.projectionHash ? { projectionHash: basis.projectionHash } : {}),
        }
      : null;
    for (const audit of visualAuditControllersRef.current.values()) {
      if (!currentBasis || !sameTikzAsyncWorkBasis(audit.basis, currentBasis)) {
        audit.controller.abort(new DOMException(
          'Canvas revision changed during visual audit',
          'AbortError',
        ));
      }
    }
  }, [engine.code, engine.geometryDoc, engine.revision]);

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
        setVisualAuditAvailable(isVisualAuditAvailable(data));
        setProviders(next);
        setProvider((current) => (
          next.length > 0 && !next.includes(current) ? next[0] : current
        ));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setProviders([]);
        setVisualAuditAvailable(false);
        setCatalogError('模型服务目录暂不可用');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!providers.includes(provider)) {
      setModels([]);
      setModel('');
      setModelCatalogLoading(false);
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    setModelCatalogLoading(true);
    setCatalogError('正在读取 api.molamaker.cn 模型目录…');

    const loadModels = async () => {
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
          source?:
            | 'api'
            | 'cache'
            | 'stale-cache'
            | 'configured-fallback'
            | 'unavailable';
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
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (disposed) return;
        setCatalogError('无法刷新模型列表；当前已加载模型仍可继续使用');
      } finally {
        if (!disposed) setModelCatalogLoading(false);
      }
    };

    void loadModels();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [modelCatalogRequest, provider, providers]);

  const repairCode = useCallback(async (code: string) => {
    if (repairing) return;
    repairControllerRef.current?.abort();
    const controller = new AbortController();
    repairControllerRef.current = controller;
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
        signal: controller.signal,
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
      if (controller.signal.aborted) {
        setRepairStatus('修复已取消');
        return;
      }
      setRepairStatus(error instanceof Error ? `修复失败：${error.message}` : '修复失败');
    } finally {
      if (repairControllerRef.current === controller) {
        repairControllerRef.current = null;
      }
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

  const stopAgentRun = useCallback(() => {
    const controller = agentControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort(new DOMException('用户停止了本轮 Agent 运行', 'AbortError'));
  }, []);

  const closeStudio = useCallback(() => {
    const activeAgentController = agentControllerRef.current;
    activeAgentController?.abort(
      new DOMException('用户关闭了 TikZ Studio', 'AbortError'),
    );
    // Keep the owning controller/admission identity until its catch/finally
    // has replayed the durable cancellation terminal. Clearing it here used
    // to strand the hidden message and its tool cards in `running` forever.
    if (!activeAgentController) {
      agentTurnAdmissionRef.current = null;
      recoveryControllerRef.current?.abort();
      recoveryControllerRef.current = null;
      setStreaming(false);
    }
    repairControllerRef.current?.abort();
    repairControllerRef.current = null;
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
    if (!problem || streaming || agentTurnAdmissionRef.current) return;
    if (!engine.interactiveWritebackSafe) {
      setCatalogError(
        `${engine.semanticProjectionState === 'stale'
          ? STALE_PROJECTION_MESSAGE
          : LOCKED_PROJECTION_MESSAGE}；AI 仍可解释和诊断，但不会自动写入。`,
      );
    }
    if (!providers.includes(provider)) {
      setCatalogError('请先配置一个可用的模型服务');
      return;
    }
    if (!model) {
      setCatalogError('请先从 api.molamaker.cn 返回的列表中选择绘图模型');
      return;
    }

    const history = compactTikzConversationHistory(messages
      .map(({ role, content }) => ({
        role,
        content: role === 'assistant' ? assistantHistoryText(content) : content,
      }))
      .filter((message) => message.content.trim().length > 0));
    const baseCode = engine.code;
    const baseRevision = engine.revision;
    const sceneManifest = buildSceneManifest({
      source: baseCode,
      sourceRevision: baseRevision,
      stmts: engine.stmts,
      // Re-evaluate from source statements so AI receives the same canonical
      // point:/element: identity lane as GeometryDoc. UI continuity UUIDs must
      // never escape into the shared AI/Code/Canvas protocol.
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
    const geometryDoc = engine.geometryDoc;
    const geometryContextReady = Boolean(
      geometryDoc
      && geometryDoc.basis.revision === baseRevision
      && geometryDoc.basis.sourceHash === sceneManifest.sourceHash
      && geometryDoc.basis.pluginSetDigest === TIKZ_PLUGIN_SET_DIGEST,
    );
    const inferredContextRefs = geometryContextReady && geometryDoc
      ? inferredGeometryAiContextRefs(problem, geometryDoc.semantic.ir.entities)
      : [];
    const explicitContextRefs = explicitGeometryAiContextRefs(
      engine.selection,
      engine.inspectorSelection.semanticEntityId,
      inferredContextRefs,
    );
    const contextRefs = explicitContextRefs.length > 0
      ? explicitContextRefs
      : geometryContextReady && geometryDoc
        ? geometryDoc.semantic.ir.entities
        .map((entity) => entity.id)
        .slice(0, 64)
        : [];
    const semanticKernel = geometryContextReady && geometryDoc
      ? buildGeometryAiContext(
        geometryDoc,
      {
        maxEntities: 220,
        maxConstraints: 160,
        maxRelations: 280,
        maxBindings: 220,
        maxOpaqueNodes: 96,
        focusRefs: contextRefs,
        focusDepth: 3,
      },
      )
      : undefined;
    const clientTurnId = createChatTurnId();
    const userMessageId = `user:${clientTurnId}`;
    const assistantMessageId = `assistant:${clientTurnId}`;
    // React state is not an atomic admission lock. Claim the turn
    // synchronously so a double click/key repeat cannot start two requests
    // before `streaming` is rendered.
    if (!claimTikzAgentTurn(agentTurnAdmissionRef, clientTurnId)) return;
    setStreaming(true);
    setCatalogError('');
    setMessages((previous) => previous.concat([
      { id: userMessageId, role: 'user', content: problem } satisfies Message,
      { id: assistantMessageId, role: 'assistant', content: '' } satisfies Message,
    ]).slice(-MAX_CHAT_MESSAGES));
    setInput('');

    const controller = new AbortController();
    agentControllerRef.current?.abort();
    recoveryControllerRef.current?.abort();
    agentControllerRef.current = controller;
    const timeoutId = window.setTimeout(
      () => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')),
      AGENT_RUN_TIMEOUT_MS,
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let tokenBuffer: AssistantTokenBuffer | null = null;
    let activeAgentRunId = '';
    let activeAgentResumeToken = '';
    let lastAgentSequence = -1;
    const terminalRunIds = new Set<string>();
    try {
      const response = await fetch('/api/tikz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
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

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      tokenBuffer = createAssistantTokenBuffer(setMessages, assistantMessageId);
      let buffer = '';
      let totalBytes = 0;
      let appliedAiTransactionId: string | null = null;
      let activeProposalTransactionId = '';
      let receivedAiProposal = false;
      let reportedMissingAiProposal = false;
      let clientAgentSequence = 1_000_000;
      const finishRejectedAgentRun = async (title: string, detail?: string) => {
        if (!activeAgentRunId || terminalRunIds.has(activeAgentRunId)) return false;
        if (!activeAgentResumeToken || !activeProposalTransactionId) return false;
        try {
          const disposition = await rejectTikzAgentProposal({
            runId: activeAgentRunId,
            resumeToken: activeAgentResumeToken,
            transactionId: activeProposalTransactionId,
            reason: detail ? `${title}: ${detail}` : title,
            signal: controller.signal,
          });
          for (const dispositionEvent of disposition.events) {
            lastAgentSequence = Math.max(lastAgentSequence, dispositionEvent.sequence);
            appendAgentStep(setMessages, dispositionEvent, assistantMessageId);
          }
          terminalRunIds.add(activeAgentRunId);
          return true;
        } catch {
          // Leave the run non-terminal locally. The EOF recovery lane will
          // replay the durable pending proposal instead of inventing a client
          // terminal that the server never observed.
          return false;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        totalBytes += value?.byteLength ?? 0;
        if (totalBytes > MAX_SSE_TOTAL_BYTES) {
          throw new Error('AI 流式响应超过总量上限');
        }
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > MAX_SSE_BUFFER_CHARS) {
          throw new Error('AI 流式响应超过安全上限');
        }
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (frame.length > MAX_SSE_FRAME_CHARS) {
            throw new Error('AI 流式事件超过安全上限');
          }
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
            tokenBuffer.push(event.token);
          }
          if (
            event.agentEvent !== undefined
            || event.assistantWidget !== undefined
            || event.diagnostic !== undefined
            || event.aiPatchProposal !== undefined
            || event.error !== undefined
          ) {
            tokenBuffer.flush();
          }
          if (isTikzAgentEvent(event.agentEvent)) {
            if (activeAgentRunId && activeAgentRunId !== event.agentEvent.runId) {
              throw new Error('AI 流包含了多个运行标识，已隔离本轮结果');
            }
            activeAgentRunId = event.agentEvent.runId;
            lastAgentSequence = Math.max(lastAgentSequence, event.agentEvent.sequence);
            if (terminalRunIds.has(event.agentEvent.runId)) continue;
            appendAgentStep(setMessages, event.agentEvent, assistantMessageId);
            if (event.agentEvent.type === 'run.completed' || event.agentEvent.type === 'run.failed') {
              terminalRunIds.add(event.agentEvent.runId);
              ensureAssistantTerminalFallback(
                setMessages,
                assistantMessageId,
                event.agentEvent,
              );
            }
          }
          if (
            event.agentRunRecovery
            && typeof event.agentRunRecovery === 'object'
            && !Array.isArray(event.agentRunRecovery)
          ) {
            const recovery = event.agentRunRecovery as Record<string, unknown>;
            if (
              recovery.schemaVersion === 'tikz-agent-run-recovery/v1'
              && recovery.runId === activeAgentRunId
              && typeof recovery.resumeToken === 'string'
              && recovery.resumeToken.length <= 256
            ) {
              activeAgentResumeToken = recovery.resumeToken;
            }
          }
          const assistantWidget = parseAgentMessageWidget(event.assistantWidget, 'host-sse');
          if (assistantWidget) {
            if (
              assistantWidget.kind === 'geometry-flow'
              && !geometryFlowBasisMatches(
                assistantWidget,
                engineRef.current.geometryDoc?.basis,
              )
            ) {
              // Do not let a model-authored or stale flow enter chat/sidebar
              // state.  Its entity refs are not a write/focus authority.
              updateAssistantMessage(
                setMessages,
                assistantMessageId,
                (content) => `${content}${content ? '\n\n' : ''}动态推导已丢弃：当前画板已变化，请基于最新画板重新请求。`,
              );
              continue;
            }
            appendAgentWidget(setMessages, assistantWidget, assistantMessageId);
            if (assistantWidget.kind === 'geometry-flow') {
              setActiveGeometryFlow(assistantWidget);
              setStepsOpen(true);
            }
          }
          if (typeof event.diagnostic === 'string' && !assistantWidget) {
            updateAssistantMessage(
              setMessages,
              assistantMessageId,
              (content) => `${content}${content ? '\n\n' : ''}提示：${event.diagnostic}`,
            );
          }
          if (event.aiPatchProposal !== undefined) {
            if (
              event.sourceTransactionAttestation
              && typeof event.sourceTransactionAttestation === 'object'
              && !Array.isArray(event.sourceTransactionAttestation)
              && typeof (event.sourceTransactionAttestation as Record<string, unknown>)
                .transactionId === 'string'
            ) {
              activeProposalTransactionId = String(
                (event.sourceTransactionAttestation as Record<string, unknown>).transactionId,
              );
            }
            if (!semanticKernel || !geometryDoc) {
              await finishRejectedAgentRun('当前对话没有可写画板上下文');
              updateAssistantMessage(
                setMessages,
                assistantMessageId,
                (content) => `${content}\n\n当前对话没有可写的 GeometryDoc 上下文，修改未执行。`,
              );
              continue;
            }
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
                  ...(binding.managedSyntaxKind
                    ? { managedSyntaxKind: binding.managedSyntaxKind }
                    : {}),
                  ...(binding.managedContentFingerprint
                    ? { managedContentFingerprint: binding.managedContentFingerprint }
                    : {}),
                  ...(binding.managedPresentationFingerprint
                    ? {
                      managedPresentationFingerprint:
                        binding.managedPresentationFingerprint,
                    }
                    : {}),
                  ...(binding.managedWriterId
                    ? {
                      managedWriterId: binding.managedWriterId,
                    }
                    : {}),
                  ...(binding.managedWriterRevision !== undefined
                    ? {
                      managedWriterRevision: binding.managedWriterRevision,
                    }
                    : {}),
                  ...(binding.managedWriterSlotIds
                    ? { managedWriterSlotIds: binding.managedWriterSlotIds }
                    : {}),
                  ...(binding.managedWriterSlotSemanticFingerprints
                    ? {
                      managedWriterSlotSemanticFingerprints:
                        binding.managedWriterSlotSemanticFingerprints,
                    }
                    : {}),
                  ...(binding.managedAttachmentsFingerprint
                    ? {
                      managedAttachmentsFingerprint:
                        binding.managedAttachmentsFingerprint,
                    }
                    : {}),
                  ...(binding.createCapabilityFingerprint
                    ? {
                      createCapabilityFingerprint:
                        binding.createCapabilityFingerprint,
                    }
                    : {}),
                  ...(binding.sliceHash ? { sliceHash: binding.sliceHash } : {}),
                })),
                allowedBindingIds:
                  semanticKernel.construction.authorizedBindingIds,
                source: baseCode,
                geometryDoc,
              },
              {
                pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
                metadata: {
                  contextRefs,
                  focusEntityIds: semanticKernel.focus.closureEntityIds,
                  requestedReadBindingIds:
                    semanticKernel.construction.authorizedBindingIds,
                  ...(activeAgentRunId ? { agentRunId: activeAgentRunId } : {}),
                  clientValidated: true,
                },
              },
            );
            if (!compiled.ok) {
              await finishRejectedAgentRun('AI 操作与当前画板不匹配');
              updateAssistantMessage(
                setMessages,
                assistantMessageId,
                (content) => `${content}\n\nAI proposal 与当前画板 binding 或源码前置条件不匹配，已拒绝写入。`,
              );
            } else if (compiled.transaction.transactionId === appliedAiTransactionId) {
              continue;
            } else {
              const transactionMatches = await matchesAiTransactionAttestation(
                event.sourceTransactionAttestation,
                compiled.transaction,
              );
              if (!transactionMatches) {
                await finishRejectedAgentRun('服务端与浏览器事务结果不一致');
                updateAssistantMessage(
                  setMessages,
                  assistantMessageId,
                  (content) => `${content}\n\n服务端与当前浏览器的 writer/事务结果不一致，已拒绝写入；请刷新页面后重试。`,
                );
                continue;
              }
              const transaction = compiled.transaction;
              const patches = transaction.operations.flatMap((operation) => (
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
                await finishRejectedAgentRun('AI 源码补丁发生冲突');
                updateAssistantMessage(
                  setMessages,
                  assistantMessageId,
                  (content) => `${content}\n\nAI proposal 的多个源码操作发生冲突，已拒绝写入。`,
                );
                continue;
              }
              const candidate = analyze(candidateCode);
              const invalid = candidate.issues.some(
                (issue) => issue.severity === 'error',
              );
              if (invalid) {
                await finishRejectedAgentRun('AI 操作未通过语法与语义投影');
                updateAssistantMessage(
                  setMessages,
                  assistantMessageId,
                  (content) => `${content}\n\nAI 事务未通过语法/语义投影校验，已保留为未提交提案。`,
                );
              } else {
                if (activeAgentRunId) {
                  appendAgentStep(setMessages, tikzAgentEvent(
                    activeAgentRunId,
                    clientAgentSequence++,
                    { type: 'commit.started', title: '正在提交到画板事务 Broker' },
                  ), assistantMessageId);
                }
                const commitResult = engine.commitSourceTransaction(
                  transaction,
                  {
                    hash: sceneManifest.sourceHash,
                    algorithm: sceneManifest.hashAlgorithm,
                    source: baseCode,
                    ...(semanticKernel.basis.kernelHash
                      ? { kernelHash: semanticKernel.basis.kernelHash }
                      : {}),
                    ...(semanticKernel.basis.projectionHash
                      ? { projectionHash: semanticKernel.basis.projectionHash }
                      : {}),
                    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
                    authorizedBindingIds:
                      semanticKernel.construction.authorizedBindingIds,
                    authorizationScopeFingerprint:
                      semanticKernel.construction.authorizationScopeFingerprint,
                    createCapabilityFingerprint:
                      semanticKernel.construction.sourceBindings.find((binding) => (
                        binding.id === 'binding:document:tikzpicture-body-end'
                      ))?.createCapabilityFingerprint,
                  },
                );
                if (commitResult.ok) {
                  appliedAiTransactionId = transaction.transactionId;
                  // A proof-flow stage may intentionally reveal only a source
                  // prefix. Once a mutation commits, the new revision must be
                  // presented and visually audited as one complete document.
                  setRevealUpTo(undefined);
                  setStepsOpen(false);
                  appendAgentWidget(setMessages, {
                    kind: 'mutation',
                    title: '画板与源码已提交，正在复核',
                    detail: '本次修改已作为一个原子事务提交；Agent 正在读取最新 GeometryDoc。',
                    revision: baseRevision + 1,
                  }, assistantMessageId);
                  if (activeAgentRunId && !terminalRunIds.has(activeAgentRunId)) {
                    appendAgentStep(setMessages, tikzAgentEvent(
                      activeAgentRunId,
                      clientAgentSequence++,
                      {
                        type: 'commit.completed',
                        title: 'Canvas 与 TikZ 源码已同步更新',
                        outcome: 'mutation',
                      },
                    ), assistantMessageId);
                    const latest = await waitForCommittedGeometryProjection(
                      engineRef,
                      baseRevision + 1,
                      candidateCode,
                      controller.signal,
                    );
                    if (!latest?.geometryDoc) {
                      updateMutationWidget(
                        setMessages,
                        assistantMessageId,
                        '画板与源码已同步',
                        '原子事务已提交；最新 GeometryDoc 仍在刷新，可继续使用画板。',
                      );
                      try {
                        const disposition = await acknowledgeTikzAgentProposalCommit({
                          runId: activeAgentRunId,
                          resumeToken: activeAgentResumeToken,
                          transactionId: transaction.transactionId,
                          afterRevision: baseRevision + 1,
                          afterSourceHash: hashSource(candidateCode),
                          transactionAttestation: event.sourceTransactionAttestation,
                          reason: '源码事务已成功；最新 GeometryDoc 投影仍在刷新。',
                          signal: controller.signal,
                        });
                        for (const dispositionEvent of disposition.events) {
                          lastAgentSequence = Math.max(
                            lastAgentSequence,
                            dispositionEvent.sequence,
                          );
                          appendAgentStep(
                            setMessages,
                            dispositionEvent,
                            assistantMessageId,
                          );
                        }
                        terminalRunIds.add(activeAgentRunId);
                      } catch {
                        // Keep the run recoverable instead of fabricating a
                        // client-only mutation terminal.
                      }
                      continue;
                    }
                    const committedGeometryDoc = latest.geometryDoc;
                    // Let the reveal reset and the committed GeometryTruth
                    // paint before capturing the read-only VLM surfaces.
                    await new Promise<void>((resolve) => {
                      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                    });
                    const verificationManifest = buildSceneManifest({
                      source: latest.code,
                      sourceRevision: latest.revision,
                      stmts: latest.stmts,
                      cst: latest.projection.cst,
                      issues: latest.issues,
                    }, {
                      maxTokens: 6_000,
                      maxPoints: 160,
                      maxPaths: 120,
                      maxElements: 220,
                      maxIssues: 32,
                      maxOpaqueNodes: 96,
                    });
                    const verificationInferredRefs = inferredGeometryAiContextRefs(
                      problem,
                      committedGeometryDoc.semantic.ir.entities,
                    );
                    const verificationExplicitRefs = explicitGeometryAiContextRefs(
                      latest.selection,
                      latest.inspectorSelection.semanticEntityId,
                      verificationInferredRefs,
                    );
                    const verificationRefs = verificationExplicitRefs.length > 0
                      ? verificationExplicitRefs
                      : committedGeometryDoc.semantic.ir.entities
                        .map((entity) => entity.id)
                        .slice(0, 64);
                    const verificationKernel = buildGeometryAiContext(
                      committedGeometryDoc,
                      {
                        maxEntities: 220,
                        maxConstraints: 160,
                        maxRelations: 280,
                        maxBindings: 220,
                        maxOpaqueNodes: 96,
                        focusRefs: verificationRefs,
                        focusDepth: 3,
                      },
                    );
                    const auditSummary = JSON.stringify(verificationKernel).slice(0, 24_000);
                    if (visualAuditAvailable) {
                      const requestedAt = Date.now();
                      const visualAuditWorkItem: TikzAsyncWorkItem<'visual-audit'> = {
                        schemaVersion: 'tikz-async-work-item/v1',
                        itemId: createTikzAsyncWorkItemId('visual-audit'),
                        kind: 'visual-audit',
                        basis: {
                          documentId: committedGeometryDoc.basis.documentId,
                          epoch: committedGeometryDoc.basis.epoch,
                          sourceId: committedGeometryDoc.basis.sourceId,
                          revision: latest.revision,
                          sourceHash: verificationManifest.sourceHash,
                          pluginSetDigest: committedGeometryDoc.basis.pluginSetDigest,
                          ...(committedGeometryDoc.basis.kernelHash
                            ? { kernelHash: committedGeometryDoc.basis.kernelHash }
                            : {}),
                          ...(committedGeometryDoc.basis.projectionHash
                            ? { projectionHash: committedGeometryDoc.basis.projectionHash }
                            : {}),
                        },
                        status: 'running',
                        requestedAt,
                        updatedAt: requestedAt,
                        ...(activeAgentRunId ? { ownerRunId: activeAgentRunId } : {}),
                        ownerMessageId: assistantMessageId,
                      };
                      const visualAuditController = new AbortController();
                      const abortVisualAuditWithRun = () => {
                        visualAuditController.abort(
                          controller.signal.reason
                            ?? new DOMException('Agent run cancelled', 'AbortError'),
                        );
                      };
                      controller.signal.addEventListener(
                        'abort',
                        abortVisualAuditWithRun,
                        { once: true },
                      );
                      visualAuditControllersRef.current.set(
                        visualAuditWorkItem.itemId,
                        {
                          controller: visualAuditController,
                          basis: visualAuditWorkItem.basis,
                        },
                      );
                      appendAgentWidget(setMessages, {
                        kind: 'visual-audit',
                        title: 'VLM 视觉复核',
                        status: 'pending',
                        summary: `正在检查 revision ${latest.revision} 的交互与精确渲染。`,
                        observations: [],
                        workItem: visualAuditWorkItem,
                      }, assistantMessageId);
                      const visualAuditBasisStillCurrent = () => (
                        engineRef.current.revision === latest.revision
                        && engineRef.current.geometryDoc?.basis.documentId
                          === committedGeometryDoc.basis.documentId
                        && engineRef.current.geometryDoc?.basis.epoch
                          === committedGeometryDoc.basis.epoch
                        && engineRef.current.geometryDoc?.basis.sourceHash
                          === verificationManifest.sourceHash
                      );
                      const cancelVisualAuditWorkItem = (summary: string) => {
                        if (!componentMountedRef.current) return;
                        const completedAt = Date.now();
                        appendAgentWidget(setMessages, {
                          kind: 'visual-audit',
                          title: 'VLM 视觉复核',
                          status: 'warning',
                          summary,
                          observations: ['视觉审计没有写权限；取消不会回滚或修改已提交的语义事务。'],
                          workItem: {
                            ...visualAuditWorkItem,
                            status: 'cancelled',
                            updatedAt: completedAt,
                            completedAt,
                          },
                        }, assistantMessageId);
                      };
                      void requestTikzVisualAudit({
                        model,
                        documentId: committedGeometryDoc.basis.documentId,
                        epoch: committedGeometryDoc.basis.epoch,
                        sourceRevision: latest.revision,
                        sourceHash: verificationManifest.sourceHash,
                        source: latest.code,
                        semanticSummary: auditSummary,
                        signal: visualAuditController.signal,
                      }).then((widget) => {
                        if (visualAuditController.signal.aborted) {
                          cancelVisualAuditWorkItem(controller.signal.aborted
                            ? '本轮已停止，视觉复核随之取消。'
                            : '画板 revision 已变化，旧视觉复核已取消。');
                          return;
                        }
                        if (!visualAuditBasisStillCurrent()) {
                          cancelVisualAuditWorkItem('画板 revision 已变化，旧视觉复核结果已隔离。');
                          return;
                        }
                        const completedAt = Date.now();
                        appendAgentWidget(setMessages, {
                          ...widget,
                          workItem: {
                            ...visualAuditWorkItem,
                            status: 'ready',
                            updatedAt: completedAt,
                            completedAt,
                          },
                        }, assistantMessageId);
                      }).catch((auditError: unknown) => {
                        if (visualAuditController.signal.aborted) {
                          cancelVisualAuditWorkItem(controller.signal.aborted
                            ? '本轮已停止，视觉复核随之取消。'
                            : '画板 revision 已变化，旧视觉复核已取消。');
                          return;
                        }
                        if (!visualAuditBasisStillCurrent()) {
                          cancelVisualAuditWorkItem('画板 revision 已变化，旧视觉复核结果已隔离。');
                          return;
                        }
                        const completedAt = Date.now();
                        appendAgentWidget(setMessages, {
                          kind: 'visual-audit',
                          title: 'VLM 视觉复核',
                          status: 'warning',
                          summary: auditError instanceof Error
                            ? auditError.message
                            : '视觉复核暂不可用。',
                          observations: ['语义事务已提交；视觉审计失败不会回滚或修改画板。'],
                          workItem: {
                            ...visualAuditWorkItem,
                            status: 'failed',
                            updatedAt: completedAt,
                            completedAt,
                            errorCode: 'VISUAL_AUDIT_FAILED',
                          },
                        }, assistantMessageId);
                      }).finally(() => {
                        controller.signal.removeEventListener(
                          'abort',
                          abortVisualAuditWithRun,
                        );
                        const currentAudit = visualAuditControllersRef.current.get(
                          visualAuditWorkItem.itemId,
                        );
                        if (currentAudit?.controller === visualAuditController) {
                          visualAuditControllersRef.current.delete(
                            visualAuditWorkItem.itemId,
                          );
                        }
                      });
                    }
                    try {
                      const verificationResponse = await fetch('/api/tikz', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: controller.signal,
                        body: JSON.stringify({
                          mode: 'verify-commit',
                          problem,
                          history,
                          provider,
                          model: model || undefined,
                          tikzCode: latest.code,
                          sourceRevision: latest.revision,
                          sourceHash: verificationManifest.sourceHash,
                          sceneManifest: verificationManifest,
                          semanticKernel: verificationKernel,
                          contextRefs: verificationRefs,
                          commitObservation: {
                            schemaVersion: 'tikz-agent-commit-observation/v1',
                            runId: activeAgentRunId,
                            transactionId: transaction.transactionId,
                            beforeRevision: baseRevision,
                            afterRevision: latest.revision,
                            beforeSourceHash: sceneManifest.sourceHash,
                            afterSourceHash: verificationManifest.sourceHash,
                            transactionAttestation: event.sourceTransactionAttestation,
                            resumeToken: activeAgentResumeToken,
                          },
                        }),
                      });
                      const terminal = await consumeCommitVerificationStream(
                        verificationResponse,
                        setMessages,
                        terminalRunIds,
                        assistantMessageId,
                        activeAgentRunId,
                      );
                      if (terminal) {
                        updateMutationWidget(
                          setMessages,
                          assistantMessageId,
                          '画板、源码与语义已同步',
                          '原子事务已提交，并已在最新 GeometryDoc 中完成复核。',
                        );
                      }
                      if (!terminal && !terminalRunIds.has(activeAgentRunId)) {
                        updateMutationWidget(
                          setMessages,
                          assistantMessageId,
                          '画板与源码已同步',
                          '原子事务已提交；自动验证流提前结束，正在从持久化运行记录恢复终态。',
                        );
                      }
                    } catch (verificationError) {
                      updateMutationWidget(
                        setMessages,
                        assistantMessageId,
                        '画板与源码已同步',
                        `原子事务已提交；自动语义复核暂不可用，正在恢复服务端终态。${
                          verificationError instanceof Error
                            ? `（${verificationError.message}）`
                            : ''
                        }`,
                      );
                    }
                  }
                } else {
                  await finishRejectedAgentRun(
                    '画板已变化，本次修改未提交',
                    commitResult.message,
                  );
                  updateAssistantMessage(
                    setMessages,
                    assistantMessageId,
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
              updateAssistantMessage(
                setMessages,
                assistantMessageId,
                (content) => `${content}\n\nAI 返回了源码预览，但缺少 binding-scoped proposal；为保护当前画板，本次结果未自动写入。`,
              );
            }
            continue;
          }
          if (typeof event.error === 'string') {
            updateAssistantMessage(
              setMessages,
              assistantMessageId,
              (content) => `${content}${content ? '\n\n' : ''}请求失败：${event.error}`,
            );
          }
        }
        if (done) break;
      }
      if (activeAgentRunId && !terminalRunIds.has(activeAgentRunId)) {
        throw new Error('AI 流式连接提前结束');
      }
    } catch (error) {
      // A provider stream can terminate after the server has durably written
      // Agent events.  Use the separate recovery capability only for the
      // still-current request; an aborted request superseded by a new turn
      // must not append stale events into the new assistant message.
      const canRecover = agentControllerRef.current === controller
        && activeAgentRunId.length > 0
        && activeAgentResumeToken.length > 0
        && !terminalRunIds.has(activeAgentRunId);
      const cancellationRequested = controller.signal.aborted
        && controller.signal.reason instanceof DOMException
        && controller.signal.reason.name === 'AbortError';
      let recovered = false;
      let recoveryNotice = '';
      if (canRecover) {
        const recoveryController = new AbortController();
        recoveryControllerRef.current = recoveryController;
        const recoveryTimeoutId = window.setTimeout(
          () => recoveryController.abort(new DOMException('Agent 恢复超时', 'TimeoutError')),
          150_000,
        );
        try {
          let replay: Awaited<ReturnType<typeof fetchTikzAgentRunReplay>>;
          for (;;) {
            replay = await fetchTikzAgentRunReplay({
              runId: activeAgentRunId,
              resumeToken: activeAgentResumeToken,
              afterSequence: lastAgentSequence,
              signal: recoveryController.signal,
            });
            for (const replayedEvent of replay.events) {
              lastAgentSequence = Math.max(lastAgentSequence, replayedEvent.sequence);
              appendAgentStep(setMessages, replayedEvent, assistantMessageId);
              if (
                replayedEvent.type === 'run.completed'
                || replayedEvent.type === 'run.failed'
              ) {
                terminalRunIds.add(replayedEvent.runId);
                ensureAssistantTerminalFallback(
                  setMessages,
                  assistantMessageId,
                  replayedEvent,
                );
              }
            }
            if (replay.terminal) terminalRunIds.add(replay.terminal.runId);
            const replayHasPendingProposal = Boolean(
              replay.proposal && !terminalRunIds.has(replay.runId),
            );
            if (
              terminalRunIds.has(replay.runId)
              || replayHasPendingProposal
              || recoveryController.signal.aborted
            ) break;
            // A disconnected build can briefly be non-terminal without a
            // verification claim while the server persists cancellation or a
            // provider failure. Keep polling until terminal/proposal instead
            // of treating `verificationPending=false` as completion. The
            // two-second cadence remains below the replay API's 60/min limit.
            await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
          }
          if (agentControllerRef.current === controller && !recoveryController.signal.aborted) {
            const pendingProposal = replay.proposal && !terminalRunIds.has(replay.runId)
              ? {
                  transactionId: replay.proposal.transactionId,
                  beforeRevision: replay.proposal.beforeRevision,
                  afterRevision: replay.proposal.afterRevision,
                }
              : undefined;
            updateAgentRecovery(setMessages, {
              status: pendingProposal
                ? 'pending-revalidation'
                : terminalRunIds.has(replay.runId) ? 'terminal' : 'replayed',
              runId: replay.runId,
              lastSequence: replay.lastSequence,
              ...(pendingProposal ? { proposal: pendingProposal } : {}),
              detail: pendingProposal
                ? '已恢复待重新验证提案；当前画板可能已变化，不会自动提交旧事务，请基于最新状态重新发送。'
                : terminalRunIds.has(replay.runId)
                  ? '已恢复服务端终态；本次恢复不会修改 Canvas 或 TikZ 源码。'
                : '已恢复 Agent 进度；本次恢复不会修改 Canvas 或 TikZ 源码。',
            }, assistantMessageId);
            recoveryNotice = pendingProposal
              ? '连接已中断，已恢复待重新验证提案；不会自动写入，请基于最新画板重新发送。'
              : terminalRunIds.has(replay.runId)
                ? cancellationRequested
                  ? '本轮已取消并恢复服务端终态；Canvas 与 TikZ 源码未改变。'
                  : '连接已中断，已恢复服务端 Agent 终态；Canvas 与 TikZ 源码未被恢复流程修改。'
                : '连接已中断，已恢复服务端 Agent 进度；Canvas 与 TikZ 源码未被恢复流程修改。';
            recovered = true;
          }
        } catch (recoveryError) {
          if (agentControllerRef.current === controller && !recoveryController.signal.aborted) {
            updateAgentRecovery(setMessages, {
              status: 'unavailable',
              runId: activeAgentRunId,
              lastSequence: lastAgentSequence,
              detail: 'Agent 进度恢复暂不可用；当前 Canvas 与 TikZ 源码保持不变，请基于最新状态重试。',
            }, assistantMessageId);
          }
          // Do not surface the opaque capability or raw replay payload in the
          // chat.  The original stream error remains the user-facing error.
          void recoveryError;
        } finally {
          window.clearTimeout(recoveryTimeoutId);
          recoveryController.abort();
          if (recoveryControllerRef.current === recoveryController) {
            recoveryControllerRef.current = null;
          }
        }
      }
      if (agentControllerRef.current !== controller) return;
      updateAssistantMessage(
        setMessages,
        assistantMessageId,
        (content) => `${content}${content ? '\n\n' : ''}${recovered
          ? recoveryNotice
          : cancellationRequested
            ? '本轮已取消，画板未改变。'
            : `请求失败：${error instanceof Error ? error.message : '未知错误'}`}`,
      );
    } finally {
      tokenBuffer?.dispose();
      window.clearTimeout(timeoutId);
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (agentControllerRef.current === controller) {
        agentControllerRef.current = null;
        setStreaming(false);
      }
      if (agentTurnAdmissionRef.current === clientTurnId) {
        agentTurnAdmissionRef.current = null;
      }
    }
  }, [engine, input, messages, model, provider, providers, streaming, visualAuditAvailable]);

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
            <button
              type="button"
              disabled={!providers.includes(provider) || modelCatalogLoading}
              onClick={() => setModelCatalogRequest((current) => current + 1)}
              aria-label="刷新模型列表"
              title="重新读取 api.molamaker.cn 模型目录"
            >
              {modelCatalogLoading ? '刷新中…' : '刷新模型'}
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
            {messages.map((message) => (
              <motion.div
                key={message.id}
                layout
                className={`tz-msg tz-msg--${message.role}`}
                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.24,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <AgentRunSteps
                  steps={message.steps ?? []}
                  toolCalls={message.run?.toolCalls ?? []}
                />
                {message.recovery ? (
                  <div className="tz-agent-widget tz-agent-widget--warning tz-agent-recovery" role="status">
                    <strong>
                      {message.recovery.status === 'pending-revalidation'
                        ? '待重新验证的 Agent 提案'
                        : message.recovery.status === 'unavailable'
                          ? 'Agent 进度恢复不可用'
                          : 'Agent 进度已恢复'}
                    </strong>
                    <span>{message.recovery.detail}</span>
                    <small>
                      run {message.recovery.runId} · sequence {message.recovery.lastSequence}
                      {message.recovery.proposal
                        ? ` · transaction ${message.recovery.proposal.transactionId}`
                        : ''}
                    </small>
                  </div>
                ) : null}
                {message.role === 'assistant' ? (
                  <AssistantMessageContent
                    content={message.content}
                    pending={streaming && message.id === messages.at(-1)?.id}
                    onChooseClarification={(choice) => {
                      setInput(choice.value);
                      requestAnimationFrame(() => composerInputRef.current?.focus());
                    }}
                  />
                ) : message.content}
                <AgentMessageWidgets
                  widgets={message.widgets ?? []}
                  onLocateCanvas={() => document.querySelector('[data-testid="tikz-canvas"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  onOpenExactPreview={() => setExactMode(true)}
                  onOpenSource={() => document.querySelector('[data-testid="tikz-code-panel"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  onFocusEntityRefs={(refs) => {
                    focusGeometryFlowRefs(refs);
                    document.querySelector('[data-testid="tikz-canvas"]')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }}
                />
              </motion.div>
            ))}
          </div>
          <div className="tz-composer">
            <textarea
              ref={composerInputRef}
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
              onClick={() => {
                if (streaming) stopAgentRun();
                else void sendProblem();
              }}
              disabled={!streaming && (!input.trim() || !model)}
              title={streaming ? '停止当前 Agent 运行' : '发送请求'}
            >
              {streaming ? '停止 ■' : '发送 ↵'}
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
          <div className="tz-canvas-stack">
            <TikzCanvas
              engine={engine}
              revealUpTo={revealUpTo}
              exactMode={exactMode}
              onSelectionTransformRequest={setSelectionTransformOpen}
            />
            <TikzSelectionTransform
              engine={engine}
              open={selectionTransformOpen}
              onOpenChange={setSelectionTransformOpen}
            />
          </div>
          {stepsOpen
            ? (
              <TikzStepsPanel
                engine={engine}
                flow={activeGeometryFlow}
                revealUpTo={revealUpTo}
                onReveal={setRevealUpTo}
                onFlowFocus={focusGeometryFlowRefs}
                onShowSourceSteps={() => setActiveGeometryFlow(null)}
                onClose={() => {
                  setStepsOpen(false);
                  setActiveGeometryFlow(null);
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
