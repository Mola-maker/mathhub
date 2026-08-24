'use client';

import { useMemo, useState } from 'react';
import type { SelectionTransform } from '@/lib/tikz/authoring/selection-transform';
import type { TikzEngine } from './use-tikz-engine';

type TransformMode = SelectionTransform['kind'];

function numeric(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function transformFromInputs(
  mode: TransformMode,
  first: string,
  second: string,
): SelectionTransform | null {
  if (mode === 'translate') {
    const dx = numeric(first);
    const dy = numeric(second);
    return dx === null || dy === null ? null : { kind: 'translate', dx, dy };
  }
  if (mode === 'rotate') {
    const degrees = numeric(first);
    return degrees === null ? null : { kind: 'rotate', degrees, center: 'selection' };
  }
  if (mode === 'scale') {
    const factor = numeric(first);
    return factor === null || Math.abs(factor) < 1e-9
      ? null
      : { kind: 'scale', factor, center: 'selection' };
  }
  return second === 'vertical'
    ? { kind: 'reflect', lineStart: { x: 0, y: 0 }, lineEnd: { x: 0, y: 1 } }
    : { kind: 'reflect', lineStart: { x: 0, y: 0 }, lineEnd: { x: 1, y: 0 } };
}

export function TikzSelectionTransform({
  engine,
  open,
  onOpenChange,
}: {
  engine: TikzEngine;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  if (!open || engine.selectionTargets.length === 0) return null;

  return (
    <TikzSelectionTransformControls
      engine={engine}
      onOpenChange={onOpenChange}
    />
  );
}

function TikzSelectionTransformControls({
  engine,
  onOpenChange,
}: {
  engine: TikzEngine;
  onOpenChange(open: boolean): void;
}) {
  const [mode, setMode] = useState<TransformMode>('translate');
  const [first, setFirst] = useState('1');
  const [second, setSecond] = useState('0');
  const [status, setStatus] = useState('');
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const selectionCount = engine.selectionTargets.length;
  const transform = useMemo(
    () => transformFromInputs(mode, first, second),
    [first, mode, second],
  );
  const capability = useMemo(
    () => transform
      ? engine.selectionTransformCapability(transform)
      : {
        status: 'blocked' as const,
        variableEntityIds: [],
        externalImpactedEntityIds: [],
        patchCount: 0,
        reason: mode === 'scale' ? '缩放比例必须是非零数字。' : '请输入有效数字。',
      },
    [engine, mode, transform],
  );

  const apply = () => {
    if (!transform || capability.status === 'blocked') {
      setStatus(capability.reason ?? '当前选区不能应用此变换。');
      return;
    }
    if (capability.externalImpactedEntityIds.length > 0 && !impactConfirmed) {
      setStatus('请先确认选区外影响，再应用变换。');
      return;
    }
    const result = impactConfirmed
      ? engine.transformSelection(transform, capability.externalImpactedEntityIds)
      : engine.transformSelection(transform);
    setStatus(result.committed
      ? '变换已同步到画板与 TikZ 源码。'
      : result.message ?? '变换未应用。');
  };

  return (
    <section className="tz-selection-transform" aria-label="选区变换">
      <div className="tz-selection-transform__summary">
        <strong>{selectionCount} 个对象</strong>
        <span>
          {capability.variableEntityIds.length} 个驱动点 · {capability.patchCount} 处源码改写
          {capability.externalImpactedEntityIds.length > 0
            ? ` · 另影响 ${capability.externalImpactedEntityIds.length} 个对象`
            : ''}
        </span>
        <div className="tz-selection-transform__summary-actions">
          <button
            type="button"
            onClick={() => {
              engine.setSelectionTargets([]);
              onOpenChange(false);
            }}
          >
            清除
          </button>
          <button
            type="button"
            aria-label="收起选区变换"
            onClick={() => onOpenChange(false)}
          >
            收起
          </button>
        </div>
      </div>
      <div className="tz-selection-transform__controls">
        <select
          aria-label="变换类型"
          value={mode}
          onChange={(event) => {
            const next = event.target.value as TransformMode;
            setMode(next);
            setFirst(next === 'scale' ? '1.2' : next === 'rotate' ? '30' : '1');
            setSecond(next === 'reflect' ? 'horizontal' : '0');
            setStatus('');
            setImpactConfirmed(false);
          }}
        >
          <option value="translate">平移</option>
          <option value="rotate">绕选区中心旋转</option>
          <option value="scale">绕选区中心缩放</option>
          <option value="reflect">关于坐标轴反射</option>
        </select>
        {mode === 'translate'
          ? (
            <>
              <label>Δx<input aria-label="水平位移" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
              <label>Δy<input aria-label="垂直位移" value={second} onChange={(event) => setSecond(event.target.value)} /></label>
            </>
          )
          : mode === 'reflect'
            ? (
              <select aria-label="反射轴" value={second} onChange={(event) => setSecond(event.target.value)}>
                <option value="horizontal">x 轴</option>
                <option value="vertical">y 轴</option>
              </select>
            )
            : (
              <label>
                {mode === 'rotate' ? '角度' : '比例'}
                <input
                  aria-label={mode === 'rotate' ? '旋转角度' : '缩放比例'}
                  value={first}
                  onChange={(event) => setFirst(event.target.value)}
                />
              </label>
            )}
        <button type="button" disabled={capability.status === 'blocked'} onClick={apply}>
          应用到 {capability.variableEntityIds.length} 个驱动点
        </button>
      </div>
      {capability.status === 'warning'
        ? (
          <label className="tz-selection-transform__warning">
            <input
              type="checkbox"
              checked={impactConfirmed}
              onChange={(event) => {
                setImpactConfirmed(event.target.checked);
                setStatus('');
              }}
            />
            确认同步更新选区外 {capability.externalImpactedEntityIds.length} 个依赖对象
          </label>
        )
        : null}
      {capability.status === 'blocked'
        ? <p className="tz-selection-transform__error">{capability.reason}</p>
        : null}
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
