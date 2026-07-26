'use client';

import type { TikzEngine } from './use-tikz-engine';

export function TikzToolbar({
  engine,
  pureMode,
  onTogglePure,
  onClose,
}: {
  engine: TikzEngine;
  pureMode: boolean;
  onTogglePure(): void;
  onClose(): void;
}) {
  const pointCount = engine.scene?.points.size ?? 0;
  const elementCount = engine.scene?.elements.length ?? 0;
  return (
    <div className="tz-toolbar" aria-label="TikZ Studio 工具栏">
      <button type="button" onClick={onClose} aria-label="关闭 TikZ Studio">← 返回</button>
      <span className="tz-toolbar__brand">TikZ Studio</span>
      <span className="tz-pill">{pointCount} 点 · {elementCount} 图元</span>
      <span className={`tz-pill${engine.issues.length ? ' tz-pill--warn' : ' tz-pill--ok'}`}>
        {engine.issues.length ? `${engine.issues.length} 个问题` : '构造有效'}
      </span>
      <span className="tz-toolbar__spacer" />
      <button type="button" disabled title="精确 TeX 预览将在下一阶段启用">
        ✨ 精确预览
      </button>
      <button type="button" onClick={onTogglePure} aria-pressed={pureMode}>
        {pureMode ? '退出纯净' : '纯净模式'}
      </button>
    </div>
  );
}

