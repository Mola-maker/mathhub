'use client';

import { useEffect, useMemo, useState } from 'react';
import { deriveSteps } from '@/lib/tikz/steps';
import {
  geometryFlowBasisMatches,
  type GeometryFlowWidget,
} from '@/lib/tikz/agent/widget-protocol';
import { AssistantMathMarkdown } from './agent-message-content';
import type { TikzEngine } from './use-tikz-engine';

function proofStatusLabel(
  proof: GeometryFlowWidget['steps'][number]['proof'],
): string | null {
  if (!proof) return null;
  if (proof.status === 'formally-proven') return '语义证明';
  if (proof.status === 'numerically-satisfied') return '数值验证';
  if (proof.status === 'counterexample') return '发现反例';
  if (proof.status === 'inconsistent') return '语义冲突';
  return '待证明';
}

function lastVisibleStep(steps: ReturnType<typeof deriveSteps>, revealUpTo: number | undefined): number {
  if (revealUpTo === undefined) return -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].stmtIndex <= revealUpTo) return index;
  }
  return -1;
}

export function TikzStepsPanel({
  engine,
  flow,
  revealUpTo,
  onReveal,
  onFlowFocus,
  onShowSourceSteps,
  onClose,
}: {
  engine: TikzEngine;
  flow?: GeometryFlowWidget | null;
  revealUpTo?: number;
  onReveal(stmtIndex: number | undefined): void;
  onFlowFocus?(refs: readonly string[]): void;
  onShowSourceSteps?(): void;
  onClose(): void;
}) {
  const [playing, setPlaying] = useState(false);
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);
  const steps = useMemo(
    () => engine.stmts && engine.scene ? deriveSteps(engine.stmts, engine.scene) : [],
    [engine.scene, engine.stmts],
  );
  const activeIndex = lastVisibleStep(steps, revealUpTo);
  const flowBasisCurrent = flow
    ? geometryFlowBasisMatches(flow, engine.geometryDoc?.basis)
    : true;

  useEffect(() => {
    setPlaying(false);
    setActiveFlowIndex(0);
    if (flow && !flowBasisCurrent) return;
    const first = flow?.steps[0];
    if (first?.entityRefs?.length) onFlowFocus?.(first.entityRefs);
  }, [flow, flowBasisCurrent, onFlowFocus]);

  useEffect(() => {
    if (flow) return;
    if (!playing || steps.length === 0) return;
    const timer = window.setInterval(() => {
      const current = lastVisibleStep(steps, revealUpTo);
      const next = current + 1;
      if (next >= steps.length) {
        setPlaying(false);
        return;
      }
      const step = steps[next];
      onReveal(step.stmtIndex);
      engine.setSelection(step.refs, step.stmtIndex);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [engine, flow, onReveal, playing, revealUpTo, steps]);

  useEffect(() => {
    if (!flow || !flowBasisCurrent || !playing || flow.steps.length === 0) return;
    const timer = window.setInterval(() => {
      const next = activeFlowIndex + 1;
      if (next >= flow.steps.length) {
        setPlaying(false);
        return;
      }
      setActiveFlowIndex(next);
      const step = flow.steps[next];
      if (step?.entityRefs?.length) {
        // Keep the state updater pure.  Focusing Canvas is an external effect
        // and must happen after the index transition, never inside React's
        // functional updater (which may be replayed in StrictMode).
        onFlowFocus?.(step.entityRefs);
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [activeFlowIndex, flow, flowBasisCurrent, onFlowFocus, playing]);

  // A stale flow is intentionally rendered as nothing.  The parent also
  // clears its state, but this local guard closes the race between a source
  // transaction and the next React commit: no stale focus, reveal, or timer
  // can escape from this panel.
  if (flow && !flowBasisCurrent) return null;

  if (flow) {
    const active = flow.steps[activeFlowIndex] ?? flow.steps[0];
    return (
      <aside className="tz-steps tz-steps--geometry-flow" aria-label="动态几何推导">
        <div className="tz-steps__head">
          <div>
            <strong>{flow.title}</strong>
            <small>语义推导 · {flow.steps.length} 步</small>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭动态几何推导">×</button>
        </div>
        <div className="tz-steps__actions">
          <button
            type="button"
            onClick={() => {
              if (activeFlowIndex >= flow.steps.length - 1) {
                setActiveFlowIndex(0);
                const first = flow.steps[0];
                if (first?.entityRefs?.length) onFlowFocus?.(first.entityRefs);
              }
              setPlaying((value) => !value);
            }}
          >
            {playing ? 'Ⅱ 暂停' : '▶ 自动演示'}
          </button>
          <button type="button" onClick={onShowSourceSteps}>源码构造步骤</button>
        </div>
        <ol>
          {flow.steps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                className={index === activeFlowIndex ? 'is-active' : ''}
                onClick={() => {
                  setPlaying(false);
                  setActiveFlowIndex(index);
                  if (step.entityRefs?.length) onFlowFocus?.(step.entityRefs);
                }}
              >
                <span>{index + 1}</span>
                <span>
                  {step.title}
                  <small>{proofStatusLabel(step.proof) ?? step.state}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {active ? (
          <section className="tz-steps__flow-detail" aria-live="polite">
            <strong>{active.title}</strong>
            <AssistantMathMarkdown
              className="tz-steps__flow-explanation"
              source={active.explanation}
            />
            {active.proof ? (
              <p className={`tz-steps__proof tz-steps__proof--${active.proof.status}`}>
                {proofStatusLabel(active.proof)}
                {active.proof.evidenceIds.length > 0
                  ? ` · ${active.proof.evidenceIds.length} 条语义证据`
                  : active.proof.residual !== undefined
                    ? ` · 残差 ${active.proof.residual.toExponential(2)}`
                    : ''}
              </p>
            ) : null}
            {active.constructionToolId ? <code>{active.constructionToolId}</code> : null}
            {active.tikz ? (
              <details>
                <summary>查看本步 TikZ</summary>
                <pre><code>{active.tikz}</code></pre>
              </details>
            ) : null}
          </section>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="tz-steps" aria-label="构造步骤">
      <div className="tz-steps__head">
        <strong>构造步骤</strong>
        <button type="button" onClick={onClose} aria-label="关闭构造步骤">×</button>
      </div>
      <div className="tz-steps__actions">
        <button
          type="button"
          disabled={steps.length === 0}
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (activeIndex >= steps.length - 1) onReveal(undefined);
              setPlaying(true);
            }
          }}
        >
          {playing ? 'Ⅱ 暂停' : '▶ 自动播放'}
        </button>
        <button type="button" onClick={() => onReveal(undefined)}>显示全部</button>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={`${step.stmtIndex}:${step.index}`}>
            <button
              type="button"
              className={step.index === activeIndex ? 'is-active' : ''}
              onClick={() => {
                setPlaying(false);
                onReveal(step.stmtIndex);
                engine.setSelection(step.refs, step.stmtIndex);
              }}
            >
              <span>{step.index + 1}</span>
              {step.title}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
