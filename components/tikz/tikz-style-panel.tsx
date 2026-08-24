'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  labelTextPatch,
  replaceLabelAnchorRaw,
} from '@/lib/tikz/authoring/property-patch';
import {
  coordinateLiteralPatch,
  styleOptionsPatch,
} from '@/lib/tikz/patch/source-patch';
import type { TextPatch } from '@/lib/tikz/document/source-transaction';
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
import { anchorFromRaw } from '@/lib/tikz/render/style-resolver';
import { TIKZ_MOTION, TIKZ_TAP } from './tikz-motion';
import type {
  InspectorSourcePatchResult,
  TikzEngine,
} from './use-tikz-engine';

type InspectorTab = 'geometry' | 'style' | 'relations';
type StyleStatement = Extract<Statement, { kind: 'path' | 'node' | 'pic' }>;
type CoordinateStatement = Extract<Statement, { kind: 'coordinate' }>;
const INSPECTOR_TABS: readonly [InspectorTab, string][] = [
  ['geometry', '几何'],
  ['style', '样式'],
  ['relations', '关系'],
];

function supportsStyle(statement: Statement | undefined): statement is StyleStatement {
  return statement?.kind === 'path' || statement?.kind === 'node' || statement?.kind === 'pic';
}

function applyInspectorPatch(
  engine: TikzEngine,
  patch: TextPatch,
  propertyKind: 'style' | 'semantic',
): InspectorSourcePatchResult {
  if (typeof engine.applyInspectorSourcePatch === 'function') {
    return engine.applyInspectorSourcePatch(
      patch,
      propertyKind,
      'style',
      engine.revision,
    );
  }
  return {
    ok: false,
    code: 'direct-commit-rejected',
    message: 'Inspector 缺少 typed proposal 入口，已拒绝直接修改源码。',
  };
}

function commandLength(statement: StyleStatement): number {
  return statement.kind === 'path' ? statement.command.length : statement.kind.length;
}

function finiteNumberOrNull(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function StyleRange({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onCommit(value: number): void;
}) {
  const [preview, setPreview] = useState(value);
  useEffect(() => setPreview(value), [value]);
  const commit = (next: number) => {
    if (next !== value) onCommit(next);
  };
  return (
    <input
      aria-label={label}
      type="range"
      min={min}
      max={max}
      step={step}
      value={preview}
      disabled={disabled}
      onChange={(event) => setPreview(Number(event.target.value))}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          commit(Number(event.currentTarget.value));
        }
      }}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
    />
  );
}

function PointCoordinateEditor({
  engine,
  statement,
}: {
  engine: TikzEngine;
  statement: CoordinateStatement;
}) {
  const semanticWriteEnabled = (
    !engine.inspectorSelection
    || engine.inspectorSelection.writeCapability.mode === 'direct'
  );
  const literal = statement.at.kind === 'literal'
    && typeof statement.at.x === 'number'
    && typeof statement.at.y === 'number'
    ? statement.at
    : null;
  const [x, setX] = useState(literal ? String(literal.x) : '');
  const [y, setY] = useState(literal ? String(literal.y) : '');
  // Resync on the coordinates themselves, not on `literal`'s identity: the
  // statement is re-projected on every revision, so depending on the object
  // would overwrite in-progress typing with each keystroke elsewhere. Both
  // fields are guaranteed numbers above, so undefined means "not a literal".
  const literalX = literal?.x;
  const literalY = literal?.y;
  useEffect(() => {
    setX(literalX === undefined ? '' : String(literalX));
    setY(literalY === undefined ? '' : String(literalY));
  }, [literalX, literalY]);

  if (!literal) {
    return (
      <div className="tz-inspector__constraint">
        <div className="tz-inspector__entity-heading">
          <strong>{statement.name}</strong>
          <span>派生点</span>
        </div>
        <p>移动该点时，求解器会反求上游自由度，不会把表达式静默冻结成坐标。</p>
        <code>{engine.code.slice(statement.at.range.start, statement.at.range.end)}</code>
      </div>
    );
  }

  const commit = () => {
    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      setX(String(literal.x));
      setY(String(literal.y));
      return;
    }
    if (nextX === literal.x && nextY === literal.y) return;
    applyInspectorPatch(
      engine,
      coordinateLiteralPatch(engine.code, literal.range, { x: nextX, y: nextY }),
      'semantic',
    );
  };

  return (
    <div className="tz-inspector__point">
      <div className="tz-inspector__entity-heading">
        <strong>自由点 {statement.name}</strong>
        <span>2 个自由度</span>
      </div>
      <p>可在画板拖拽，也可输入竞赛作图需要的精确坐标。</p>
      {!semanticWriteEnabled
        ? (
          <p className="tz-inspector__warning">
            该点属于受管构造；坐标需要通过语义重编译修改，不能直接改生成源码。
          </p>
        )
        : null}
      <div className="tz-inspector__grid">
        <label>
          <span>X</span>
          <input
            aria-label="点 X 坐标"
            inputMode="decimal"
            value={x}
            disabled={!semanticWriteEnabled}
            onChange={(event) => setX(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
        <label>
          <span>Y</span>
          <input
            aria-label="点 Y 坐标"
            inputMode="decimal"
            value={y}
            disabled={!semanticWriteEnabled}
            onChange={(event) => setY(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
      </div>
    </div>
  );
}

function LabelTextEditor({
  engine,
  statement,
}: {
  engine: TikzEngine;
  statement: Extract<Statement, { kind: 'node' }>;
}) {
  const semanticWriteEnabled = (
    !engine.inspectorSelection
    || engine.inspectorSelection.writeCapability.mode === 'direct'
  );
  const [text, setText] = useState(statement.text);
  useEffect(() => setText(statement.text), [statement.text]);
  const commit = () => {
    if (text === statement.text) return;
    applyInspectorPatch(
      engine,
      labelTextPatch(engine.code, statement.range, text),
      'semantic',
    );
  };
  return (
    <>
      <label className="tz-inspector__field">
        <span>标签内容</span>
        <input
          aria-label="标签内容"
          value={text}
          disabled={!semanticWriteEnabled}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <label className="tz-inspector__field">
        <span>标签位置</span>
        <select
          aria-label="标签位置"
          value={anchorFromRaw(statement.options?.raw ?? null)}
          onChange={(event) => {
            const nextRaw = replaceLabelAnchorRaw(
              statement.options?.raw ?? null,
              event.target.value,
            );
            applyInspectorPatch(
              engine,
              styleOptionsPatch(
                engine.code,
                statement.options?.range ?? null,
                nextRaw,
                statement.range.start + statement.kind.length + 1,
              ),
              'style',
            );
          }}
        >
          <option value="above">上</option>
          <option value="below">下</option>
          <option value="left">左</option>
          <option value="right">右</option>
          <option value="above left">左上</option>
          <option value="above right">右上</option>
          <option value="below left">左下</option>
          <option value="below right">右下</option>
          <option value="center">居中</option>
        </select>
      </label>
    </>
  );
}

function GeometryPanel({
  engine,
  statement,
}: {
  engine: TikzEngine;
  statement: Statement | undefined;
}) {
  const resolved = engine.inspectorSelection;
  if (!statement && !resolved?.semanticEntity && !resolved?.renderPrimitive) {
    return (
      <div className="tz-inspector__empty">
        <span aria-hidden="true">⌖</span>
        <strong>选择一个几何对象</strong>
        <p>查看定义、坐标和自由度；拖动派生点时会保持构造关系。</p>
      </div>
    );
  }
  if (statement?.kind === 'coordinate') {
    return <PointCoordinateEditor engine={engine} statement={statement} />;
  }
  const legacyRefs = statement?.kind === 'path'
    ? statement.specs.flatMap((spec) => (
      spec.type === 'polyline'
        ? spec.points.flatMap((point) => point.kind === 'ref' ? [point.name] : [])
        : spec.type === 'cubic-bezier'
          ? [spec.start, spec.control1, spec.control2, spec.end]
            .flatMap((point) => point.kind === 'ref' ? [point.name] : [])
        : spec.type === 'circular-arc'
          ? (spec.start.kind === 'ref' ? [spec.start.name] : [])
        : []
    ))
    : statement?.kind === 'pic'
      ? statement.points
      : [];
  const refs = resolved?.refs.length ? resolved.refs : legacyRefs;
  const semanticKind = resolved?.semanticKind;
  const sourceRange = resolved?.sourceRange ?? statement?.range;
  const sourceLength = sourceRange
    ? sourceRange.end - sourceRange.start
    : null;
  return (
    <div className="tz-inspector__definition">
      <div className="tz-inspector__entity-heading">
        <strong>
          {semanticKind
            ? `语义图元 · ${semanticKind}`
            : statement?.kind === 'path'
              ? '路径图元'
              : statement?.kind === 'node'
                ? '标签'
                : '角标记'}
        </strong>
        <span>语句 {engine.selectedStmtIndex === null ? '—' : engine.selectedStmtIndex + 1}</span>
      </div>
      <dl>
        <div>
          <dt>定义类型</dt>
          <dd>{semanticKind ?? statement?.kind ?? 'semantic'}</dd>
        </div>
        {resolved?.semanticEntityId
          ? (
            <div>
              <dt>语义实体</dt>
              <dd>{resolved.semanticEntityId}</dd>
            </div>
          )
          : null}
        {resolved?.renderPrimitiveId
          ? (
            <div>
              <dt>渲染图元</dt>
              <dd>{resolved.renderPrimitiveId}</dd>
            </div>
          )
          : null}
        <div>
          <dt>源码绑定</dt>
          <dd>
            {resolved?.sourceBindingIds.length
              ? resolved.sourceBindingIds.join(', ')
              : '无显式绑定'}
          </dd>
        </div>
        {resolved
          ? (
            <div>
              <dt>写回策略</dt>
              <dd>{resolved.writeCapability.mode}</dd>
            </div>
          )
          : null}
        <div>
          <dt>引用对象</dt>
          <dd>{refs.length > 0 ? refs.join(', ') : '无命名引用'}</dd>
        </div>
        <div>
          <dt>源码覆盖</dt>
          <dd>{sourceLength === null ? '未绑定' : `${sourceLength} 字符`}</dd>
        </div>
      </dl>
      {sourceRange && resolved && !resolved.statementRangeValidated
        ? (
          <p className="tz-inspector__warning">
            当前源码范围未匹配到同 revision 的语句；为避免写错对象，属性写回已停用。
          </p>
        )
        : null}
    </div>
  );
}

function RawStyleEditor({
  engine,
  statement,
  insertPos,
}: {
  engine: TikzEngine;
  statement: StyleStatement;
  insertPos: number;
}) {
  const original = statement.options?.raw ?? '';
  const [raw, setRaw] = useState(original);
  useEffect(() => setRaw(original), [original]);
  const commit = () => {
    if (raw === original) return;
    applyInspectorPatch(
      engine,
      styleOptionsPatch(
        engine.code,
        statement.options?.range ?? null,
        raw.trim(),
        insertPos,
      ),
      'style',
    );
  };
  return (
    <details className="tz-inspector__advanced">
      <summary>高级 TikZ options</summary>
      <p>保留未知 key、library 样式与宏；仅替换当前语句的 options 区间。</p>
      <textarea
        aria-label="高级 TikZ options"
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          }
        }}
      />
      <small>⌘/Ctrl + Enter 应用</small>
    </details>
  );
}

function StyleEditor({
  engine,
  statement,
}: {
  engine: TikzEngine;
  statement: Statement | undefined;
}) {
  const [writeStatus, setWriteStatus] = useState('');
  if (!supportsStyle(statement)) {
    return (
      <div className="tz-inspector__empty">
        <span aria-hidden="true">✦</span>
        <strong>该对象没有可写样式</strong>
        <p>请选择线、圆、多边形、角标记或标签。</p>
      </div>
    );
  }
  if (
    engine.inspectorSelection
    && engine.inspectorSelection.writeCapability.mode === 'read-only'
  ) {
    return (
      <div className="tz-inspector__empty">
        <span aria-hidden="true">🔒</span>
        <strong>该样式绑定为只读</strong>
        <p>当前 source binding 未通过 revision、hash 或写策略校验。</p>
      </div>
    );
  }

  const statementIndex = engine.selectedStmtIndex as number;
  const draft = styleDraftFromRaw(statement.options?.raw ?? null);
  const insertPos = statement.range.start + commandLength(statement) + 1;
  const strokeColor = draft.drawColor ?? draft.color;
  const strokeColorIsPreset = (STYLE_COLORS as readonly string[]).includes(strokeColor);
  const fillColor = draft.fillColor ?? strokeColor;
  const fillColorIsPreset = (STYLE_COLORS as readonly string[]).includes(fillColor);
  const update = (patch: Partial<StyleDraft>) => {
    const targetedPatch: Partial<StyleDraft> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'color') && draft.drawEnabled) {
      targetedPatch.drawColor = patch.color ?? draft.drawColor;
      delete targetedPatch.color;
    }
    const next = buildOptionsRaw(
      { ...draft, ...targetedPatch },
      statement.options?.raw ?? null,
      Object.keys(targetedPatch) as (keyof StyleDraft)[],
    );
    const applied = applyInspectorPatch(
      engine,
      styleOptionsPatch(
        engine.code,
        statement.options?.range ?? null,
        next,
        insertPos,
      ),
      'style',
    );
    setWriteStatus(
      applied.ok
        ? ''
        : applied.message
          ?? '样式事务未通过 source binding 写策略校验。',
    );
  };

  return (
    <div className="tz-inspector__style-editor">
      {writeStatus
        ? <p className="tz-inspector__warning">{writeStatus}</p>
        : null}
      <div className="tz-inspector__presets" aria-label="样式预设">
        <motion.button type="button" whileTap={TIKZ_TAP} onClick={() => update({ color: 'black', width: null, dash: null })}>构造线</motion.button>
        <motion.button type="button" whileTap={TIKZ_TAP} onClick={() => update({ color: 'gray', width: 'thin', dash: 'dashed' })}>辅助线</motion.button>
        <motion.button type="button" whileTap={TIKZ_TAP} onClick={() => update({ color: 'blue', width: 'very thick', dash: null })}>强调</motion.button>
      </div>
      <div className="tz-inspector__grid">
        <label>
          <span>描边颜色</span>
          <select aria-label="颜色" value={strokeColor} onChange={(event) => update({ color: event.target.value })}>
            {!strokeColorIsPreset
              ? <option value={strokeColor}>{strokeColor} · 源码</option>
              : null}
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
      <div className="tz-inspector__checks">
        <label>
          <input type="checkbox" checked={draft.fill} onChange={(event) => update({ fill: event.target.checked })} />
          填充图形
        </label>
        <label>
          <span>填充透明度</span>
          <StyleRange
            label="填充透明度"
            min={0.1}
            max={1}
            step={0.1}
            value={draft.opacity ?? 1}
            disabled={!draft.fill}
            onCommit={(opacity) => update({ opacity })}
          />
        </label>
      </div>
      <details className="tz-inspector__advanced" open>
        <summary>Paint 与轮廓</summary>
        <div className="tz-inspector__grid">
          <label>
              <span>填充颜色</span>
              <select
                aria-label="填充颜色"
                value={fillColor}
                disabled={!draft.fill}
                onChange={(event) => update({ fillColor: event.target.value })}
              >
                {!fillColorIsPreset
                  ? <option value={fillColor}>{fillColor} · 源码</option>
                  : null}
                {STYLE_COLORS.map((color) => <option key={color}>{color}</option>)}
              </select>
          </label>
          <label>
            <span>线帽</span>
            <select
              aria-label="线帽"
              value={draft.lineCap ?? ''}
              onChange={(event) => update({
                lineCap: (event.target.value || null) as StyleDraft['lineCap'],
              })}
            >
              <option value="">默认</option>
              <option value="round">round</option>
              <option value="rect">rect</option>
              <option value="butt">butt</option>
            </select>
          </label>
          <label>
            <span>连接</span>
            <select
              aria-label="线连接"
              value={draft.lineJoin ?? ''}
              onChange={(event) => update({
                lineJoin: (event.target.value || null) as StyleDraft['lineJoin'],
              })}
            >
              <option value="">默认</option>
              <option value="round">round</option>
              <option value="bevel">bevel</option>
              <option value="miter">miter</option>
            </select>
          </label>
          <label>
            <span>圆角半径</span>
            <input
              key={draft.roundedCorners ?? 'rounded-corners-default'}
              aria-label="圆角半径"
              defaultValue={draft.roundedCorners ?? ''}
              placeholder="如 2pt"
              onBlur={(event) => update({
                roundedCorners: event.target.value.trim() || null,
              })}
            />
          </label>
        </div>
        <div className="tz-inspector__checks tz-inspector__checks--stacked">
          <label>
            <input
              type="checkbox"
              checked={draft.doubleLine}
              onChange={(event) => update({ doubleLine: event.target.checked })}
            />
            双线
          </label>
          <label>
            <span>描边透明度</span>
            <StyleRange
              label="描边透明度"
              min={0}
              max={1}
              step={0.05}
              value={draft.drawOpacity ?? 1}
              onCommit={(drawOpacity) => update({ drawOpacity })}
            />
          </label>
          <label>
            <span>文本透明度</span>
            <StyleRange
              label="文本透明度"
              min={0}
              max={1}
              step={0.05}
              value={draft.textOpacity ?? 1}
              onCommit={(textOpacity) => update({ textOpacity })}
            />
          </label>
        </div>
      </details>
      <details className="tz-inspector__advanced">
        <summary>Transform</summary>
        <div className="tz-inspector__grid">
          <label>
            <span>旋转角度</span>
            <input
              key={draft.rotate ?? 'rotate-default'}
              aria-label="旋转角度"
              type="number"
              step="1"
              defaultValue={draft.rotate ?? ''}
              onBlur={(event) => {
                const value = finiteNumberOrNull(event.target.value);
                if (value !== undefined) update({ rotate: value });
              }}
            />
          </label>
          <label>
            <span>缩放</span>
            <input
              key={draft.scale ?? 'scale-default'}
              aria-label="缩放"
              type="number"
              step="0.05"
              defaultValue={draft.scale ?? ''}
              onBlur={(event) => {
                const value = finiteNumberOrNull(event.target.value);
                if (value !== undefined) update({ scale: value });
              }}
            />
          </label>
        </div>
      </details>
      {statement.kind === 'node'
        ? <LabelTextEditor engine={engine} statement={statement} />
        : null}
      <RawStyleEditor
        engine={engine}
        statement={statement}
        insertPos={insertPos}
      />
      <div className="tz-inspector__source-note">样式修改将精准写回语句 {statementIndex + 1}，并在源码中短暂高亮。</div>
    </div>
  );
}

function RelationsPanel({ engine }: { engine: TikzEngine }) {
  const relation = useMemo(() => {
    const selectedEntity = engine.inspectorSelection?.semanticEntity;
    const ir = engine.geometryTruth?.semantic.ir;
    if (selectedEntity && ir) {
      const labelOf = (entityId: string) => {
        const entity = ir.entities.find((candidate) => candidate.id === entityId);
        return entity?.name ?? entityId;
      };
      const ancestors = new Set<string>();
      const descendants = new Set<string>();
      for (const semanticRelation of ir.relations) {
        const participants = semanticRelation.participants.flatMap(
          (participant) => participant.entityId
            ? [{ role: participant.role, entityId: participant.entityId }]
            : [],
        );
        const selectedParticipants = participants.filter(
          (participant) => participant.entityId === selectedEntity.id,
        );
        if (selectedParticipants.length === 0) continue;
        if (semanticRelation.kind === 'construction-dependency') {
          const inputCountValue = semanticRelation.properties?.inputs;
          const outputCountValue = semanticRelation.properties?.outputs;
          const inputCount = (
            typeof inputCountValue === 'number'
            && Number.isInteger(inputCountValue)
            && inputCountValue >= 0
          )
            ? inputCountValue
            : 0;
          const outputCount = (
            typeof outputCountValue === 'number'
            && Number.isInteger(outputCountValue)
            && outputCountValue >= 0
          )
            ? outputCountValue
            : Math.max(0, participants.length - inputCount);
          const inputs = participants.slice(0, inputCount);
          const outputs = participants.slice(
            inputCount,
            inputCount + outputCount,
          );
          if (outputs.some((item) => item.entityId === selectedEntity.id)) {
            for (const input of inputs) ancestors.add(labelOf(input.entityId));
          }
          if (inputs.some((item) => item.entityId === selectedEntity.id)) {
            for (const output of outputs) {
              descendants.add(labelOf(output.entityId));
            }
          }
          continue;
        }
        const dependent = participants.find((participant) => (
          participant.role === 'dependent'
          || participant.role === 'from'
        ));
        const dependency = participants.find((participant) => (
          participant.role === 'dependency'
          || participant.role === 'to'
        ));
        if (
          semanticRelation.kind === 'depends-on'
          && dependent?.entityId === selectedEntity.id
          && dependency
        ) {
          ancestors.add(labelOf(dependency.entityId));
          continue;
        }
        if (
          semanticRelation.kind === 'depends-on'
          && dependency?.entityId === selectedEntity.id
          && dependent
        ) {
          descendants.add(labelOf(dependent.entityId));
          continue;
        }
        for (const participant of participants) {
          if (participant.entityId === selectedEntity.id) continue;
          ancestors.add(
            `${semanticRelation.kind} · ${labelOf(participant.entityId)}`,
          );
        }
      }
      for (const constraint of ir.constraints) {
        if (!constraint.arguments.some(
          (argument) => argument.entityId === selectedEntity.id,
        )) continue;
        ancestors.add(`constraint · ${constraint.kind}`);
      }
      return {
        ancestors: [...ancestors],
        descendants: [...descendants],
        free: selectedEntity.tags?.includes('free')
          ? [selectedEntity.name ?? selectedEntity.id]
          : [],
      };
    }
    const selected = new Set(engine.selection);
    const scene = engine.scene;
    if (!scene || selected.size === 0) {
      return { ancestors: [] as string[], descendants: [] as string[], free: [] as string[] };
    }
    const ancestors = new Set<string>();
    const visitedAncestors = new Set<string>();
    const visitAncestors = (name: string) => {
      if (visitedAncestors.has(name)) return;
      visitedAncestors.add(name);
      const point = scene.points.get(name);
      for (const dependency of point?.dependsOn ?? []) {
        const normalized = dependency;
        const dependencyPoint = scene.points.get(normalized);
        if (!dependencyPoint?.internal) ancestors.add(normalized);
        if (!normalized.startsWith('path:')) visitAncestors(normalized);
      }
    };
    for (const name of selected) visitAncestors(name);

    const descendants = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const point of scene.points.values()) {
        if (point.internal) continue;
        if (selected.has(point.name) || descendants.has(point.name)) continue;
        if (point.dependsOn.some((name) => selected.has(name) || descendants.has(name))) {
          descendants.add(point.name);
          changed = true;
        }
      }
    }
    const free = [...selected].filter((name) => scene.points.get(name)?.free);
    return {
      ancestors: [...ancestors],
      descendants: [...descendants],
      free,
    };
  }, [
    engine.geometryTruth,
    engine.inspectorSelection,
    engine.scene,
    engine.selection,
  ]);

  if (
    engine.inspectorSelection?.state === 'none'
    && engine.selection.length === 0
  ) {
    return (
      <div className="tz-inspector__empty">
        <span aria-hidden="true">⌘</span>
        <strong>关系图等待选择</strong>
        <p>选择对象后可查看 ancestors、descendants 与自由度。</p>
      </div>
    );
  }

  return (
    <div className="tz-relations">
      <div className="tz-relations__selection">
        <span>{engine.inspectorSelection?.label ?? engine.selection.join(', ')}</span>
      </div>
      <RelationGroup title="上游构造" values={relation.ancestors} empty="无上游依赖 · 自由对象" />
      <RelationGroup title="下游对象" values={relation.descendants} empty="没有依赖该对象的后代" />
      <div className="tz-relations__constraint">
        <strong>自由度</strong>
        <span>
          {relation.free.length > 0
            ? `${relation.free.join(', ')} 可直接拖拽`
            : '派生对象 · 拖动时由求解器保持约束'}
        </span>
      </div>
      {engine.selectedStmtIndex !== null
        ? (
          <button
            type="button"
            className="tz-relations__jump"
            onClick={() => {
              document.querySelector<HTMLElement>('.tz-cm .cm-editor')?.focus();
            }}
          >
            跳到对应源码 · 语句 {engine.selectedStmtIndex + 1}
          </button>
        )
        : null}
    </div>
  );
}

function RelationGroup({
  title,
  values,
  empty,
}: {
  title: string;
  values: readonly string[];
  empty: string;
}) {
  return (
    <div className="tz-relations__group">
      <strong>{title}</strong>
      {values.length > 0
        ? <div>{values.map((value) => <span key={value}>{value}</span>)}</div>
        : <p>{empty}</p>}
    </div>
  );
}

export function TikzStylePanel({ engine }: { engine: TikzEngine }) {
  const [tab, setTab] = useState<InspectorTab>('geometry');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [secondaryDeleteArmed, setSecondaryDeleteArmed] = useState(false);
  const managedConstructionDeleteId =
    engine.inspectorSelection.writeCapability.mode === 'managed-recompile'
      ? engine.inspectorSelection.writeCapability.managedConstructionId
      : undefined;
  const managedConstructionDelete = Boolean(
    managedConstructionDeleteId
    || engine.inspectorSelection.sourceBindingIds.some((bindingId) => (
      bindingId.startsWith('binding:managed:')
    )),
  );
  useEffect(() => {
    setSecondaryDeleteArmed(false);
    setDeleteStatus('');
  }, [engine.inspectorSelection?.key, engine.selectedStmtIndex]);
  const statement = engine.inspectorSelection?.statement
    ?? (
      engine.inspectorSelection
        ? undefined
        : engine.selectedStmtIndex === null
          ? undefined
          : engine.stmts?.[engine.selectedStmtIndex]
    );

  return (
    <motion.section
      layout
      className="tz-inspector"
      aria-label="对象检查器"
      transition={TIKZ_MOTION.softSpring}
    >
      <div className="tz-inspector__head">
        <div>
          <strong>对象检查器</strong>
          <span>
            {engine.inspectorSelection?.label
              ?? (engine.selection.length > 0 ? engine.selection.join(', ') : '未选择')}
          </span>
        </div>
        <div className="tz-inspector__tabs" role="tablist" aria-label="检查器标签">
          {INSPECTOR_TABS.map(([id, label], index) => (
            <motion.button
              key={id}
              id={`tz-inspector-tab-${id}`}
              data-inspector-tab={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls="tz-inspector-panel"
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? 'is-active' : ''}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? INSPECTOR_TABS.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + INSPECTOR_TABS.length)
                      % INSPECTOR_TABS.length;
                const next = INSPECTOR_TABS[nextIndex][0];
                setTab(next);
                requestAnimationFrame(() => {
                  document.querySelector<HTMLButtonElement>(
                    `[data-inspector-tab="${next}"]`,
                  )?.focus();
                });
              }}
              whileTap={TIKZ_TAP}
            >
              {tab === id
                ? (
                  <motion.span
                    className="tz-inspector__tab-indicator"
                    layoutId="tz-inspector-tab-indicator"
                    transition={TIKZ_MOTION.spring}
                  />
                )
                : null}
              {label}
            </motion.button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={[
            tab,
            engine.inspectorSelection?.key
              ?? engine.selectedStmtIndex
              ?? 'empty',
            engine.interactiveWritebackSafe,
          ].join(':')}
          id="tz-inspector-panel"
          className="tz-inspector__body"
          role="tabpanel"
          aria-labelledby={`tz-inspector-tab-${tab}`}
          {...TIKZ_MOTION.listItem}
          transition={TIKZ_MOTION.spring}
        >
          {!engine.interactiveWritebackSafe
          ? (
            <div className="tz-inspector__warning">
              {engine.semanticProjectionState === 'stale'
                ? `当前源码结构未完成；正在只读显示 revision ${engine.semanticRevision ?? '—'} 的最近有效语义投影。`
                : engine.writebackBlockedReason === 'unsafe-opaque'
                  ? '当前源码包含会影响作用域的 opaque TikZ。为保护未知源码，属性写回已锁定；精确渲染仍可使用。'
                  : '当前没有可写的语义投影；请先建立或修复 TikZ 源码。'}
            </div>
          )
          : tab === 'geometry'
            ? <GeometryPanel engine={engine} statement={statement} />
            : tab === 'style'
              ? <StyleEditor engine={engine} statement={statement} />
              : <RelationsPanel engine={engine} />}
        </motion.div>
      </AnimatePresence>
      {engine.selectionTargets.length > 0
        ? (
          <div className="tz-inspector__actions">
            <button
              className="tz-inspector__danger"
              type="button"
              onClick={() => {
                setSecondaryDeleteArmed(false);
                const deleted = engine.deleteSelection('block');
                setDeleteStatus(
                  deleted
                    ? managedConstructionDelete
                      ? `已原子删除受管构造 ${managedConstructionDeleteId ?? ''}`.trim()
                      : '已安全删除所选对象'
                    : managedConstructionDelete
                      ? '该受管构造仍有外部下游；请使用“删除构造及外部下游”并确认'
                      : '当前对象仍有下游；如果确实需要，请使用二次确认级联删除',
                );
              }}
            >
              {managedConstructionDelete ? '删除整个受管构造' : '安全删除对象'}
            </button>
            <button
              type="button"
              title={managedConstructionDelete
                ? '二次确认后删除整个受管构造，以及源码图中位于该构造之外的全部下游。'
                : '二次确认后删除所选对象和依赖它的全部下游。'}
              onClick={() => {
                if (!secondaryDeleteArmed) {
                  setSecondaryDeleteArmed(true);
                  setDeleteStatus(
                    managedConstructionDelete
                      ? '再次点击将级联删除整个受管构造及其外部下游'
                      : '再次点击将删除当前对象及其全部下游',
                  );
                  return;
                }
                const cascaded = engine.deleteSelection('cascade');
                setSecondaryDeleteArmed(false);
                setDeleteStatus(
                  cascaded
                    ? managedConstructionDelete
                      ? '已删除整个受管构造及其外部下游'
                      : '已删除所选对象及其全部下游'
                    : '无法安全级联删除当前选择',
                );
              }}
            >
              {secondaryDeleteArmed
                ? '确认级联删除'
                : managedConstructionDelete
                  ? '删除构造及外部下游'
                  : '级联删除对象及下游'}
            </button>
            <kbd>
              {managedConstructionDelete
                ? 'Delete / Backspace · 安全整块'
                : 'Delete / Backspace'}
            </kbd>
            {deleteStatus
              ? <span role="status">{deleteStatus}</span>
              : null}
          </div>
        )
        : null}
    </motion.section>
  );
}
