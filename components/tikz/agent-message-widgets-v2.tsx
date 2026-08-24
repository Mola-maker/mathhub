'use client';

import { useState } from 'react';
import {
  parseTikzReadOnlyAgentWidget,
  type FunctionPlotWidget,
  type GeometryFlowWidget,
  type GeometryProblemSearchWidget,
  type TikzReadOnlyAgentWidget,
  type VisualAuditWidget,
} from '@/lib/tikz/agent/widget-protocol';
import { AssistantMathMarkdown } from './agent-message-content';

export type AgentMessageWidget =
  | { readonly kind: 'rejection'; readonly title: string; readonly detail: string }
  | {
      readonly kind: 'code-example';
      readonly title: string;
      readonly code: string;
      readonly lineCount: number;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: 'mutation';
      readonly title: string;
      readonly detail: string;
      readonly revision: number;
  }
  | TikzReadOnlyAgentWidget;

/**
 * Model text and host-produced SSE payloads share the same widget envelope,
 * but only the latter may carry a problem-search card.  Keep the default
 * model/untrusted path closed and make the host boundary explicit at call
 * sites that consume the same-origin SSE stream.
 */
export type AgentMessageWidgetOrigin = 'model' | 'host-sse';

export function parseAgentMessageWidget(
  value: unknown,
  origin: AgentMessageWidgetOrigin = 'model',
): AgentMessageWidget | null {
  if (!value || typeof value !== 'object') return null;
  const widget = value as Record<string, unknown>;
  if (widget.kind === 'rejection') {
    return typeof widget.title === 'string' && typeof widget.detail === 'string'
      ? { kind: 'rejection', title: widget.title, detail: widget.detail }
      : null;
  }
  if (widget.kind === 'code-example') {
    return typeof widget.title === 'string'
      && typeof widget.code === 'string'
      && typeof widget.lineCount === 'number'
      && Number.isSafeInteger(widget.lineCount)
      ? {
          kind: 'code-example',
          title: widget.title,
          code: widget.code,
          lineCount: widget.lineCount,
          ...(widget.truncated === true ? { truncated: true } : {}),
        }
      : null;
  }
  if (widget.kind === 'mutation') {
    return typeof widget.title === 'string'
      && typeof widget.detail === 'string'
      && typeof widget.revision === 'number'
      && Number.isSafeInteger(widget.revision)
      ? {
          kind: 'mutation',
          title: widget.title,
          detail: widget.detail,
          revision: widget.revision,
        }
      : null;
  }
  return parseTikzReadOnlyAgentWidget(value, {
    trustedHostProblemSearch: origin === 'host-sse',
    trustedHostGeometryProof: origin === 'host-sse',
  });
}

const PLOT_COLORS: Record<FunctionPlotWidget['series'][number]['color'], string> = {
  blue: '#007aff',
  red: '#ff3b30',
  green: '#34c759',
  orange: '#ff9500',
  purple: '#af52de',
  gray: '#8e8e93',
};

function FunctionPlotCard({ widget }: { widget: FunctionPlotWidget }) {
  const [zoom, setZoom] = useState(1);
  const points = widget.series.flatMap((series) => series.points);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  const centerX = (rawMinX + rawMaxX) / 2;
  const centerY = (rawMinY + rawMaxY) / 2;
  const spanX = Math.max(1e-6, rawMaxX - rawMinX) / zoom;
  const spanY = Math.max(1e-6, rawMaxY - rawMinY) / zoom;
  const minX = centerX - spanX / 2;
  const maxX = centerX + spanX / 2;
  const minY = centerY - spanY / 2;
  const maxY = centerY + spanY / 2;
  const mapX = (x: number) => 18 + ((x - minX) / (maxX - minX)) * 284;
  const mapY = (y: number) => 162 - ((y - minY) / (maxY - minY)) * 144;

  return (
    <section className="tz-agent-widget tz-agent-widget--plot">
      <header>
        <strong>{widget.title}</strong>
        <AssistantMathMarkdown
          className="tz-function-plot__expression"
          source={`$${widget.expression}$`}
        />
      </header>
      <svg viewBox="0 0 320 180" role="img" aria-label={`${widget.title} 函数图`}>
        <rect x="18" y="18" width="284" height="144" rx="12" className="tz-function-plot__surface" />
        {minY <= 0 && maxY >= 0
          ? <line x1="18" y1={mapY(0)} x2="302" y2={mapY(0)} className="tz-function-plot__axis" />
          : null}
        {minX <= 0 && maxX >= 0
          ? <line x1={mapX(0)} y1="18" x2={mapX(0)} y2="162" className="tz-function-plot__axis" />
          : null}
        {widget.series.map((series) => (
          <polyline
            key={series.label}
            className="tz-function-plot__stroke"
            points={series.points.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(' ')}
            fill="none"
            stroke={PLOT_COLORS[series.color]}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="tz-function-plot__controls">
        <label>
          缩放
          <input
            aria-label="函数图缩放"
            type="range"
            min="1"
            max="4"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <span>{widget.series.map((series) => series.label).join(' · ')}</span>
      </div>
    </section>
  );
}

function geometryStepProvenanceLabel(
  provenance: GeometryFlowWidget['steps'][number]['provenance'],
): string | null {
  if (provenance === 'source-solution') return '题源解答';
  if (provenance === 'semantic-kernel') return '当前画板事实';
  if (provenance === 'agent-inference') return 'AI 推导';
  return null;
}

function geometryStepProofLabel(
  status: NonNullable<GeometryFlowWidget['steps'][number]['proof']>['status'],
): string {
  if (status === 'formally-proven') return '语义证明';
  if (status === 'numerically-satisfied') return '数值验证';
  if (status === 'counterexample') return '发现反例';
  if (status === 'inconsistent') return '语义冲突';
  return '待证明';
}

function GeometryFlowCard({
  widget,
  onFocusEntityRefs,
}: {
  widget: GeometryFlowWidget;
  onFocusEntityRefs?(refs: readonly string[]): void;
}) {
  const [activeId, setActiveId] = useState(widget.steps[0]?.id ?? '');
  const active = widget.steps.find((step) => step.id === activeId) ?? widget.steps[0];

  return (
    <section className="tz-agent-widget tz-agent-widget--flow">
      <header>
        <strong>{widget.title}</strong>
        {widget.sourceUrl
          ? <a href={widget.sourceUrl} target="_blank" rel="noreferrer">{widget.source ?? '查看题源'}</a>
          : widget.source ? <small>{widget.source}</small> : null}
      </header>
      <div className="tz-geometry-flow__rail" role="tablist" aria-label="几何推导步骤">
        {widget.steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={step.id === activeId}
            className={`tz-geometry-flow__step tz-geometry-flow__step--${step.state}`}
            onClick={() => {
              setActiveId(step.id);
              if (step.entityRefs && step.entityRefs.length > 0) {
                onFocusEntityRefs?.(step.entityRefs);
              }
            }}
          >
            <span>{index + 1}</span>
            {step.title}
          </button>
        ))}
      </div>
      {active ? (
        <div className="tz-geometry-flow__detail" role="tabpanel">
          <strong>{active.title}</strong>
          {geometryStepProvenanceLabel(active.provenance)
            ? (
              <span className={`tz-geometry-flow__provenance tz-geometry-flow__provenance--${active.provenance}`}>
                {geometryStepProvenanceLabel(active.provenance)}
              </span>
            )
            : null}
          {active.proof ? (
            <span className={`tz-geometry-flow__proof tz-geometry-flow__proof--${active.proof.status}`}>
              {geometryStepProofLabel(active.proof.status)}
            </span>
          ) : null}
          <AssistantMathMarkdown
            className="tz-geometry-flow__explanation"
            source={active.explanation}
          />
          <div className="tz-geometry-flow__actions">
            {active.constructionToolId ? <code>{active.constructionToolId}</code> : null}
            {active.entityRefs && active.entityRefs.length > 0 && onFocusEntityRefs
              ? (
                <button type="button" onClick={() => onFocusEntityRefs(active.entityRefs ?? [])}>
                  定位本步图元
                </button>
              )
              : null}
          </div>
          {active.proof ? (
            <small className="tz-geometry-flow__proof-detail">
              {active.proof.evidenceIds.length > 0
                ? `${active.proof.evidenceIds.length} 条 GeometryDoc 证据`
                : active.proof.residual !== undefined
                  ? `归一化残差 ${active.proof.residual.toExponential(2)}`
                  : '当前 revision 尚无闭合证明证据'}
              {active.proof.diagnostic ? ` · ${active.proof.diagnostic}` : ''}
            </small>
          ) : null}
          {active.tikz ? <small>本步源码已收纳到右侧动态推导面板。</small> : null}
        </div>
      ) : null}
      {widget.license ? (
        <small className="tz-geometry-flow__license">
          题源许可：{widget.licenseId ?? widget.license}
          {widget.contentHash ? ` · 内容指纹 ${widget.contentHash.slice(0, 8)}` : ''}
          {widget.datasetUrl
            ? <>{' · '}<a href={widget.datasetUrl} target="_blank" rel="noreferrer">数据集说明</a></>
            : null}
        </small>
      ) : null}
    </section>
  );
}

function VisualAuditCard({ widget }: { widget: VisualAuditWidget }) {
  const fidelity = widget.fidelity === 'matched'
    ? '交互/精确一致'
    : widget.fidelity === 'drift'
      ? '检测到双渲染偏差'
      : '仅检查交互画面';
  return (
    <section
      className={`tz-agent-widget tz-agent-widget--audit tz-agent-widget--audit-${widget.status}`}
      data-work-item-id={widget.workItem?.itemId}
      data-work-item-status={widget.workItem?.status}
      data-source-revision={widget.workItem?.basis.revision}
      data-agent-run-id={widget.workItem?.ownerRunId}
    >
      <header>
        <strong>{widget.title}</strong>
        <span>{widget.status === 'passed' ? fidelity : widget.status === 'warning' ? fidelity : '检查中'}</span>
      </header>
      <p>{widget.summary}</p>
      {widget.observations.length > 0 ? (
        <details>
          <summary>查看视觉观察（{widget.observations.length}）</summary>
          <ul>{widget.observations.map((observation) => <li key={observation}>{observation}</li>)}</ul>
        </details>
      ) : null}
      {widget.comparisonArtifact ? (
        <details>
          <summary>可验证渲染对比</summary>
          <dl>
            <div>
              <dt>模式</dt>
              <dd>{widget.comparisonArtifact.mode === 'interactive-vs-exact'
                ? '交互 / 精确双渲染'
                : '仅交互渲染'}</dd>
            </div>
            <div>
              <dt>Interactive</dt>
              <dd>{widget.comparisonArtifact.interactiveRasterDigest.slice(0, 12)}</dd>
            </div>
            {widget.comparisonArtifact.exactRasterDigest ? (
              <div>
                <dt>Exact</dt>
                <dd>{widget.comparisonArtifact.exactRasterDigest.slice(0, 12)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Revision</dt>
              <dd>{widget.comparisonArtifact.sourceRevision}</dd>
            </div>
          </dl>
        </details>
      ) : null}
      <small>
        视觉模型只提供观察，不会修改 Canvas、GeometryDoc 或 TikZ 源码。
        {widget.workItem
          ? ` · revision ${widget.workItem.basis.revision} · ${widget.workItem.status}`
          : ''}
      </small>
    </section>
  );
}

const PROBLEM_SOURCE_LABELS: Record<GeometryProblemSearchWidget['results'][number]['source'], string> = {
  mathnet: 'MathNet',
  olympiadbench: 'OlympiadBench',
  geometry3k: 'Geometry3K',
  geoqa: 'GeoQA',
  unigeo: 'UniGeo',
  leaneuclid: 'LeanEuclid',
  formalgeo: 'FormalGeo',
};

function sourceRightsLabel(
  rights: GeometryProblemSearchWidget['results'][number]['rights']['sourceMaterialRights'],
): string {
  if (rights === 'allowed') return '目录标记允许，仍需准入核验';
  if (rights === 'conditional') return '题源权利有附加条件';
  if (rights === 'blocked') return '禁止直接使用';
  return '题源权利待审查';
}

function GeometryProblemSearchCard({ widget }: { widget: GeometryProblemSearchWidget }) {
  return (
    <section className="tz-agent-widget tz-agent-widget--problems">
      <header>
        <div>
          <strong>{widget.title}</strong>
          <small>“{widget.query}”</small>
        </div>
        <span>只读题源</span>
      </header>
      <ol className="tz-problem-search__results">
        {widget.results.map((result) => (
          <li key={result.id}>
            <div className="tz-problem-search__heading">
              <strong>{result.title}</strong>
              <span>{PROBLEM_SOURCE_LABELS[result.source]}</span>
            </div>
            <p>{result.statementPreview}</p>
            {result.topics.length > 0 ? (
              <div className="tz-problem-search__topics" aria-label="题目主题">
                {result.topics.map((topic) => <span key={topic}>{topic}</span>)}
              </div>
            ) : null}
            <footer>
              <span>{result.licenseId}（数据集卡）· {sourceRightsLabel(result.rights.sourceMaterialRights)}</span>
              <span>快照 {result.contentHash.slice(0, 8)}</span>
              {result.hasImages ? <span>含 {result.assetCount || '未核验'} 个题图引用</span> : null}
              <a href={result.sourceUrl} target="_blank" rel="noreferrer">查看题源</a>
            </footer>
          </li>
        ))}
      </ol>
      {widget.sourceStatus && widget.sourceStatus.length > 0 ? (
        <details className="tz-problem-search__status">
          <summary>数据源状态</summary>
          <ul>
            {widget.sourceStatus.map((status) => (
              <li key={status.id}>
                <strong>{PROBLEM_SOURCE_LABELS[status.id]}</strong>
                <span>{status.enabled ? status.detail : `未启用：${status.detail}`}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <small>题源内容是只读、未固定 revision 的外部参考；数据集卡许可证不自动清除原竞赛题面与图片权利，也不会授予 Canvas 或 TikZ 写权限。</small>
    </section>
  );
}

export function AgentMessageWidgets({
  widgets,
  onLocateCanvas,
  onOpenExactPreview,
  onOpenSource,
  onFocusEntityRefs,
}: {
  widgets: readonly AgentMessageWidget[];
  onLocateCanvas(): void;
  onOpenExactPreview(): void;
  onOpenSource(): void;
  onFocusEntityRefs?(refs: readonly string[]): void;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  if (widgets.length === 0) return null;

  return (
    <div className="tz-agent-widgets" aria-label="AI 结果">
      {widgets.map((widget, index) => {
        if (widget.kind === 'function-plot') {
          return <FunctionPlotCard key={`${widget.kind}:${index}`} widget={widget} />;
        }
        if (widget.kind === 'geometry-flow') {
          return (
            <GeometryFlowCard
              key={`${widget.kind}:${index}`}
              widget={widget}
              onFocusEntityRefs={onFocusEntityRefs}
            />
          );
        }
        if (widget.kind === 'visual-audit') {
          return <VisualAuditCard key={`${widget.kind}:${index}`} widget={widget} />;
        }
        if (widget.kind === 'problem-search') {
          return <GeometryProblemSearchCard key={`${widget.kind}:${index}`} widget={widget} />;
        }
        if (widget.kind === 'code-example') {
          return (
            <details className="tz-agent-widget" key={`${widget.kind}:${index}`}>
              <summary>
                <strong>{widget.title}</strong>
                <span>{widget.lineCount} 行 · 默认折叠</span>
              </summary>
              <pre><code>{widget.code}</code></pre>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(widget.code).then(() => setCopiedIndex(index))}
              >
                {copiedIndex === index ? '已复制' : '复制代码'}
              </button>
              {widget.truncated ? <small>内容过长，已仅保留前 24,000 字符。</small> : null}
            </details>
          );
        }
        if (widget.kind === 'mutation') {
          return (
            <section
              className="tz-agent-widget tz-agent-widget--success tz-agent-widget--result"
              key={`${widget.kind}:${index}`}
              role="status"
              aria-label="构造结果"
            >
              <header>
                <span className="tz-result-widget__mark" aria-hidden="true">✓</span>
                <strong>{widget.title}</strong>
                <small>revision {widget.revision}</small>
              </header>
              <p>{widget.detail}</p>
              <div className="tz-agent-widget__actions">
                <button type="button" onClick={onLocateCanvas}>定位画板</button>
                <button type="button" onClick={onOpenExactPreview}>精准预览</button>
                <button type="button" onClick={onOpenSource}>查看源码</button>
              </div>
            </section>
          );
        }
        return (
          <section className="tz-agent-widget tz-agent-widget--warning" key={`${widget.kind}:${index}`}>
            <strong>{widget.title}</strong>
            <p>{widget.detail}</p>
            <small>0 项已应用，Canvas 与 TikZ 源码保持不变。</small>
          </section>
        );
      })}
    </div>
  );
}
