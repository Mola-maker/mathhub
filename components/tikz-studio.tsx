'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { analyze } from '@/lib/tikz/analyze';
import { SAMPLE_TIKZ } from '@/lib/tikz/prompt/sample-code';
import { runTikzRepair } from '@/lib/tikz/repair/tikz-repair';
import { TikzCanvas } from './tikz/tikz-canvas';
import { TikzCodePanel } from './tikz/tikz-code-panel';
import { TikzStylePanel } from './tikz/tikz-style-panel';
import { TikzStepsPanel } from './tikz/tikz-steps-panel';
import { TikzToolbar } from './tikz/tikz-toolbar';
import { useTikzEngine } from './tikz/use-tikz-engine';

type Provider = 'anthropic' | 'deepseek' | 'coze' | 'dashscope';
type Message = { role: 'user' | 'assistant'; content: string };
type ModelRow = { id: string; label?: string; probe?: { ok?: boolean } };

const PROVIDER_ORDER: Provider[] = ['anthropic', 'deepseek', 'dashscope', 'coze'];
const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  dashscope: '通义千问',
  coze: 'Coze',
};

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

export function TikzStudio({ startOpen = false }: { startOpen?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(startOpen);
  const [pureMode, setPureMode] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [revealUpTo, setRevealUpTo] = useState<number | undefined>(undefined);
  const [catalogError, setCatalogError] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const engine = useTikzEngine(SAMPLE_TIKZ);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const controller = new AbortController();
    setCatalogError('');
    fetch(`/api/tikz/models?provider=${encodeURIComponent(provider)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: { models?: ModelRow[]; defaultModel?: string }) => {
        const nextModels = Array.isArray(data.models) ? data.models.filter((row) => row?.id) : [];
        setModels(nextModels);
        setModel((current) => (
          current && nextModels.some((row) => row.id === current)
            ? current
            : data.defaultModel || nextModels[0]?.id || ''
        ));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setModels([]);
        setModel('');
        setCatalogError('无法读取模型列表');
      });
    return () => controller.abort();
  }, [provider, providers]);

  const repairCode = useCallback(async (code: string) => {
    if (repairing) return;
    setRepairing(true);
    setRepairStatus('正在检查修复…');
    try {
      const result = await runTikzRepair({
        code,
        provider,
        model,
        maxRounds: providers.includes(provider) ? 2 : 0,
      });
      if (result.code !== code) engine.setCode(result.code);
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
    setMounted(true);
    setOpen(true);
  }, []);

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
      if (event.key === 'Escape') closeStudio();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeStudio, open]);

  const sendProblem = useCallback(async () => {
    const problem = input.trim();
    if (!problem || streaming) return;
    if (!providers.includes(provider)) {
      setCatalogError('请先配置一个可用的模型服务');
      return;
    }

    const history = messages.slice(-6);
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
          tikzCode: engine.code,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let generatedCode: string | null = null;
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
          if (typeof event.tikzCode === 'string') {
            generatedCode = event.tikzCode;
            engine.setCode(event.tikzCode);
          }
          if (typeof event.error === 'string') {
            updateLastAssistant(setMessages, () => `出错了：${event.error}`);
          }
        }
        if (done) break;
      }
      if (
        generatedCode
        && analyze(generatedCode).issues.some((issue) => issue.severity === 'error')
      ) {
        await repairCode(generatedCode);
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

  const studio = mounted && open
    ? createPortal(
      <div
        className={`tz-studio${pureMode ? ' tz-studio--pure' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="TikZ Studio"
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
            {PROVIDER_ORDER.map((name) => (
              <button
                key={name}
                type="button"
                className={provider === name ? 'is-active' : ''}
                disabled={!providers.includes(name)}
                onClick={() => setProvider(name)}
              >
                {PROVIDER_LABELS[name]}
              </button>
            ))}
          </div>
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
                  {row.label || row.id}{row.probe?.ok === false ? ' · 未探测' : ''}
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
              <div key={`${message.role}:${index}`} className={`tz-msg tz-msg--${message.role}`}>
                {message.content || (streaming ? '正在思考…' : '…')}
              </div>
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
              disabled={streaming || !input.trim()}
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
          />
          <TikzCanvas engine={engine} revealUpTo={revealUpTo} />
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
            <span>TikZ 源码</span>
            <span>唯一真源</span>
          </div>
          <TikzCodePanel
            code={engine.code}
            issues={engine.issues}
            onChange={engine.setCode}
          />
          <TikzStylePanel engine={engine} />
        </aside>
      </div>,
      document.body,
    )
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
