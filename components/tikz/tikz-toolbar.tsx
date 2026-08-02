'use client';

import { AnimatePresence, motion } from 'motion/react';
import { TIKZ_HOVER, TIKZ_MOTION, TIKZ_TAP } from './tikz-motion';
import type { TikzEngine } from './use-tikz-engine';

export function TikzToolbar({
  engine,
  pureMode,
  onTogglePure,
  onClose,
  repairing = false,
  repairStatus = '',
  onRepair,
  stepsOpen = false,
  onToggleSteps,
  exactMode = false,
  onToggleExact,
}: {
  engine: TikzEngine;
  pureMode: boolean;
  onTogglePure(): void;
  onClose(): void;
  repairing?: boolean;
  repairStatus?: string;
  onRepair?(): void;
  stepsOpen?: boolean;
  onToggleSteps?(): void;
  exactMode?: boolean;
  onToggleExact?(): void;
}) {
  const pointCount = engine.scene
    ? [...engine.scene.points.values()].filter((point) => !point.internal).length
    : 0;
  const elementCount = engine.scene?.elements.length ?? 0;
  const projectionLabel = engine.projection.status === 'complete'
    ? '构造有效'
    : engine.projection.status === 'partial'
      ? `${engine.projection.cst.opaqueNodes.length} 个 opaque 区域`
      : `${engine.issues.length || engine.projection.cst.errorRanges.length} 个问题`;
  return (
    <motion.div
      layout
      className="tz-toolbar"
      aria-label="TikZ Studio 工具栏"
      transition={TIKZ_MOTION.softSpring}
    >
      <motion.button
        type="button"
        onClick={onClose}
        aria-label="关闭 TikZ Studio"
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        ← 工作台
      </motion.button>
      <span className="tz-toolbar__brand">TikZ Studio</span>
      <motion.span layout className="tz-pill">{pointCount} 点 · {elementCount} 图元</motion.span>
      <motion.span
        layout
        className={`tz-pill${engine.projection.status === 'complete' ? ' tz-pill--ok' : ' tz-pill--warn'}`}
      >
        {projectionLabel}
      </motion.span>
      <AnimatePresence>
        {repairStatus
          ? (
            <motion.span
              key="repair-status"
              className="tz-pill"
              role="status"
              {...TIKZ_MOTION.status}
              transition={TIKZ_MOTION.spring}
            >
              {repairStatus}
            </motion.span>
          )
          : null}
      </AnimatePresence>
      <span className="tz-toolbar__spacer" />
      <motion.button
        type="button"
        disabled={repairing}
        onClick={onRepair}
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        {repairing ? '修复中…' : '🔧 修复'}
      </motion.button>
      <motion.button
        type="button"
        onClick={onToggleSteps}
        aria-pressed={stepsOpen}
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        ☷ 步骤
      </motion.button>
      <motion.button
        type="button"
        onClick={onToggleExact}
        aria-pressed={exactMode}
        title="使用真实 TeX/TikZ 编译器生成 SVG"
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        {exactMode ? '↩ 交互预览' : '⌁ 精确预览'}
      </motion.button>
      <motion.button
        type="button"
        onClick={onTogglePure}
        aria-pressed={pureMode}
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        {pureMode ? '退出纯净' : '纯净模式'}
      </motion.button>
    </motion.div>
  );
}
