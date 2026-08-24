'use client';

import { useMemo, useState } from 'react';
import { insertBeforeTikzEndPatch } from '@/lib/tikz/authoring/source-builder';
import {
  TIKZ_LAYERS,
  TIKZ_SYNTAX_CAPABILITIES,
  TIKZ_CATALOG_SOURCE,
  queryTikzSyntaxCapabilities,
  type TikzCapabilityLaneTruth,
  type TikzLayer,
  type TikzSyntaxCapability,
} from '@/lib/tikz/syntax';
import type { TikzEngine } from './use-tikz-engine';

const LAYER_LABELS: Record<TikzLayer, string> = {
  core: 'TikZ 核心',
  'graph-drawing': '图布局',
  libraries: '官方库',
  'data-visualization': '数据可视化',
  utilities: '工具',
  'math-engine': '数学引擎',
  'object-engine': '对象引擎',
  'basic-layer': 'PGF 基础层',
  'system-layer': '系统/驱动层',
};

function insertableExample(entry: TikzSyntaxCapability): string | null {
  const example = entry.examples?.find((candidate) => (
    candidate.trimStart().startsWith('\\')
    && candidate.trimEnd().endsWith(';')
    && !candidate.includes('...')
    && !candidate.includes('\\begin{tikzpicture}')
    && !candidate.includes('\\end{tikzpicture}')
  ));
  return example ?? null;
}

function capabilityLabel(lane: TikzCapabilityLaneTruth, label: string): string {
  const status = {
    verified: '已验证',
    partial: '部分支持',
    conditional: '条件支持',
    blocked: '当前阻止',
  }[lane.status];
  return `${label} · ${status}`;
}

export function TikzSyntaxPanel({
  engine,
  onClose,
}: {
  engine: TikzEngine;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<TikzLayer | 'all'>('all');
  const [selectedId, setSelectedId] = useState('core:paths');
  const [status, setStatus] = useState('');
  const results = useMemo(() => queryTikzSyntaxCapabilities({
    text: query,
    layer: layer === 'all' ? undefined : layer,
    limit: 80,
  }), [layer, query]);
  const selected = (
    results.find((entry) => entry.id === selectedId)
    ?? results[0]
    ?? TIKZ_SYNTAX_CAPABILITIES[0]
  );
  const example = selected ? insertableExample(selected) : null;

  const copyExample = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('示例已复制');
    } catch {
      setStatus('浏览器没有授予剪贴板权限');
    }
  };

  const insertExample = (value: string) => {
    try {
      const patch = insertBeforeTikzEndPatch(engine.code, [value]);
      const committed = engine.applySourcePatch(
        patch,
        'external',
        engine.revision,
      );
      setStatus(committed ? '已通过源码事务插入' : '源码已变化，请重试');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法插入示例');
    }
  };

  return (
    <section className="tz-syntax-panel" aria-label="PGF/TikZ 官方语法目录">
      <header className="tz-syntax-panel__head">
        <div>
          <strong>PGF/TikZ 语法库</strong>
          <span>
            {TIKZ_CATALOG_SOURCE.version} · {TIKZ_SYNTAX_CAPABILITIES.length} 个能力条目
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭语法库">×</button>
      </header>

      <div className="tz-syntax-panel__filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 draw、matrix、intersections、driver…"
          aria-label="搜索 TikZ 语法"
        />
        <select
          value={layer}
          onChange={(event) => setLayer(event.target.value as TikzLayer | 'all')}
          aria-label="TikZ 语法层"
        >
          <option value="all">全部层</option>
          {TIKZ_LAYERS.map((value) => (
            <option key={value} value={value}>{LAYER_LABELS[value]}</option>
          ))}
        </select>
      </div>

      <div className="tz-syntax-panel__body">
        <nav className="tz-syntax-panel__results" aria-label="语法搜索结果">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === selected?.id ? 'is-active' : ''}
              onClick={() => {
                setSelectedId(entry.id);
                setStatus('');
              }}
            >
              <strong>{entry.title}</strong>
              <span>{LAYER_LABELS[entry.layer]}{entry.library ? ` · ${entry.library}` : ''}</span>
            </button>
          ))}
          {results.length === 0 ? <p>没有匹配条目</p> : null}
        </nav>

        {selected ? (
          <article className="tz-syntax-panel__detail">
            <div className="tz-syntax-panel__eyebrow">
              {selected.id} · {selected.recognition}
            </div>
            <h3>{selected.title}</h3>
            <div className="tz-syntax-panel__capabilities" aria-label="能力等级">
              <span className={`is-${selected.truth.preserve.status}`} title={selected.truth.preserve.reason}>
                {capabilityLabel(selected.truth.preserve, '源码保真')}
              </span>
              <span className={`is-${selected.truth.syntax.status}`} title={selected.truth.syntax.reason}>
                {capabilityLabel(selected.truth.syntax, '语法识别')}
              </span>
              <span className={`is-${selected.truth.semantic.status}`} title={selected.truth.semantic.reason}>
                {capabilityLabel(selected.truth.semantic, '语义理解')}
              </span>
              <span className={`is-${selected.truth.interactive.status}`} title={selected.truth.interactive.reason}>
                {capabilityLabel(selected.truth.interactive, '画板编辑')}
              </span>
              <span className={`is-${selected.truth.exact.status}`} title={selected.truth.exact.reason}>
                {capabilityLabel(selected.truth.exact, '精准编译')}
              </span>
            </div>
            <p>{selected.officialRef.section}</p>
            <p className={`tz-syntax-panel__risk is-${selected.securityRisk.level}`}>
              安全等级：{selected.securityRisk.level} · {selected.securityRisk.summary}
            </p>
            {selected.notes?.map((note) => <p key={note}>{note}</p>)}
            {selected.examples?.map((item) => (
              <div className="tz-syntax-panel__example" key={item}>
                <code>{item}</code>
                <button type="button" onClick={() => void copyExample(item)}>复制</button>
              </div>
            ))}
            <div className="tz-syntax-panel__actions">
              <a
                href={selected.officialRef.source}
                target="_blank"
                rel="noreferrer"
              >
                查看固定版本官方源码 ↗
              </a>
              {example ? (
                <button type="button" onClick={() => insertExample(example)}>
                  插入到源码
                </button>
              ) : null}
            </div>
            {status ? <div className="tz-syntax-panel__status" role="status">{status}</div> : null}
          </article>
        ) : null}
      </div>

      <footer>
        保真保存与精确编译不等于画板可拖拽；每个条目分别声明语义和交互能力。
      </footer>
    </section>
  );
}
