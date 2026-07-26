'use client';

import { useEffect, useMemo, useState } from 'react';
import { deriveSteps } from '@/lib/tikz/steps';
import type { TikzEngine } from './use-tikz-engine';

function lastVisibleStep(steps: ReturnType<typeof deriveSteps>, revealUpTo: number | undefined): number {
  if (revealUpTo === undefined) return -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].stmtIndex <= revealUpTo) return index;
  }
  return -1;
}

export function TikzStepsPanel({
  engine,
  revealUpTo,
  onReveal,
  onClose,
}: {
  engine: TikzEngine;
  revealUpTo?: number;
  onReveal(stmtIndex: number | undefined): void;
  onClose(): void;
}) {
  const [playing, setPlaying] = useState(false);
  const steps = useMemo(
    () => engine.stmts && engine.scene ? deriveSteps(engine.stmts, engine.scene) : [],
    [engine.scene, engine.stmts],
  );
  const activeIndex = lastVisibleStep(steps, revealUpTo);

  useEffect(() => {
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
  }, [engine, onReveal, playing, revealUpTo, steps]);

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
