'use client';

import { patchStyleOptions } from '@/lib/tikz/patch/source-patch';
import {
  buildOptionsRaw,
  STYLE_ARROWS,
  STYLE_COLORS,
  STYLE_DASHES,
  STYLE_WIDTHS,
  styleDraftFromRaw,
  type StyleDraft,
} from '@/lib/tikz/patch/style-options';
import type { Statement } from '@/lib/tikz/subset/ast';
import type { TikzEngine } from './use-tikz-engine';

type StyleStatement = Extract<Statement, { kind: 'path' | 'node' | 'pic' }>;
type StylePanelEngine = Pick<
  TikzEngine,
  'code' | 'stmts' | 'selectedStmtIndex' | 'applyPatch'
>;

function supportsStyle(statement: Statement | undefined): statement is StyleStatement {
  return statement?.kind === 'path' || statement?.kind === 'node' || statement?.kind === 'pic';
}

function commandLength(statement: StyleStatement): number {
  return statement.kind === 'path' ? statement.command.length : statement.kind.length;
}

export function TikzStylePanel({ engine }: { engine: StylePanelEngine }) {
  const index = engine.selectedStmtIndex;
  const statement = index === null ? undefined : engine.stmts?.[index];

  if (!supportsStyle(statement)) {
    return (
      <section className="tz-style" aria-label="图形样式">
        <div className="tz-style__title">图形样式</div>
        <p>在画布中点击一个图形元素以调整样式。</p>
      </section>
    );
  }

  const statementIndex = index as number;
  const draft = styleDraftFromRaw(statement.options?.raw ?? null);
  const insertPos = statement.range.start + commandLength(statement) + 1;
  const update = (patch: Partial<StyleDraft>) => {
    const next = buildOptionsRaw({ ...draft, ...patch });
    engine.applyPatch(patchStyleOptions(
      engine.code,
      statement.options?.range ?? null,
      next,
      insertPos,
    ));
  };

  return (
    <section className="tz-style" aria-label="图形样式">
      <div className="tz-style__title">
        <span>图形样式</span>
        <small>语句 {statementIndex + 1}</small>
      </div>
      <div className="tz-style__grid">
        <label>
          <span>颜色</span>
          <select aria-label="颜色" value={draft.color} onChange={(event) => update({ color: event.target.value })}>
            {STYLE_COLORS.map((color) => <option key={color}>{color}</option>)}
          </select>
        </label>
        <label>
          <span>线宽</span>
          <select aria-label="线宽" value={draft.width ?? ''} onChange={(event) => update({ width: event.target.value || null })}>
            <option value="">默认</option>
            {STYLE_WIDTHS.map((width) => <option key={width}>{width}</option>)}
          </select>
        </label>
        <label>
          <span>线型</span>
          <select aria-label="线型" value={draft.dash ?? ''} onChange={(event) => update({ dash: event.target.value || null })}>
            <option value="">实线</option>
            {STYLE_DASHES.map((dash) => <option key={dash}>{dash}</option>)}
          </select>
        </label>
        <label>
          <span>箭头</span>
          <select aria-label="箭头" value={draft.arrow ?? ''} onChange={(event) => update({ arrow: event.target.value || null })}>
            <option value="">无</option>
            {STYLE_ARROWS.map((arrow) => <option key={arrow}>{arrow}</option>)}
          </select>
        </label>
      </div>
      <div className="tz-style__checks">
        <label>
          <input type="checkbox" checked={draft.fill} onChange={(event) => update({ fill: event.target.checked })} />
          填充
        </label>
        <label>
          <span>透明度</span>
          <input
            aria-label="填充透明度"
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={draft.opacity ?? 1}
            disabled={!draft.fill}
            onChange={(event) => update({ opacity: Number(event.target.value) })}
          />
        </label>
      </div>
    </section>
  );
}
