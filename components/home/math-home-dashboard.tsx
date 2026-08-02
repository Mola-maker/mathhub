'use client';

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { MotionConfig, motion } from 'motion/react';
import { analyze } from '@/lib/tikz/analyze';
import { SAMPLE_TIKZ } from '@/lib/tikz/prompt/sample-code';
import {
  buildSceneHeatmap,
  type SceneHeatmapMetric,
} from '@/lib/tikz/semantics/scene-heatmap';
import {
  PGF_TIKZ_VERSION,
  summarizeTikzSyntaxCapabilities,
} from '@/lib/tikz/syntax';
import {
  getLatestTikzWorkspaceSnapshot,
  getTikzWorkspaceSnapshotHistory,
  subscribeTikzWorkspaceSnapshot,
  type TikzWorkspaceSnapshot,
} from '@/lib/tikz/workspace/studio-events';

const CAPABILITY_SUMMARY = summarizeTikzSyntaxCapabilities();
const HEATMAP_METRICS: readonly {
  id: SceneHeatmapMetric;
  label: string;
  description: string;
}[] = [
  { id: 'dependency', label: '依赖', description: '上游、下游和约束密度' },
  { id: 'risk', label: '风险', description: '语义诊断与退化构造' },
  { id: 'activity', label: '活动', description: '当前选择和最近源码事务' },
];

function initialSnapshot(): TikzWorkspaceSnapshot {
  const result = analyze(SAMPLE_TIKZ, 0);
  const scene = result.scene;
  return {
    revision: 0,
    semanticRevision: 0,
    updatedAt: 0,
    pointCount: scene?.points.size ?? 0,
    elementCount: scene?.elements.length ?? 0,
    issueCount: scene?.issues.length ?? 0,
    sourceIssueCount: result.issues.length,
    projectionState: 'current',
    lastEditOrigin: null,
    heatmap: scene
      ? buildSceneHeatmap(scene)
      : { entries: [], totals: { dependency: 0, risk: 0, activity: 0 }, maximums: { dependency: 0, risk: 0, activity: 0 } },
  };
}

function formatSnapshotTime(updatedAt: number): string {
  if (updatedAt === 0) return '初始工作区';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(updatedAt);
}

function coverageLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function buildTikzHref(request: {
  selectionRefs?: readonly string[];
  stmtIndex?: number | null;
} = {}): string {
  const query = new URLSearchParams();
  if (request.selectionRefs?.length) {
    query.set('selection', request.selectionRefs.join(','));
  }
  if (request.stmtIndex !== undefined && request.stmtIndex !== null) {
    query.set('stmtIndex', String(request.stmtIndex));
  }
  const suffix = query.toString();
  return suffix ? `/tikz?${suffix}` : '/tikz';
}

function StudioLauncherCard({
  href,
  name,
  kind,
  description,
  status,
}: {
  href: string;
  name: string;
  kind: 'tikz' | 'math';
  description: string;
  status: string;
}) {
  return (
    <Link
      className={`geo-home__studio-card geo-home__studio-card--${kind}`}
      href={href}
      aria-label={`打开 ${name}`}
    >
      <span className="geo-home__studio-accent" aria-hidden="true" />
      <span className="geo-home__studio-head">
        <strong>{name}</strong>
        <em><i aria-hidden="true" />{status}</em>
      </span>
      <span className="geo-home__studio-description">{description}</span>
      <span className="geo-home__studio-action">
        打开 Studio
        <b aria-hidden="true">↗</b>
      </span>
    </Link>
  );
}

export function MathHomeDashboard() {
  const [snapshot, setSnapshot] = useState<TikzWorkspaceSnapshot>(initialSnapshot);
  const [activity, setActivity] = useState<TikzWorkspaceSnapshot[]>([]);
  const [metric, setMetric] = useState<SceneHeatmapMetric>('dependency');

  useEffect(() => {
    const latest = getLatestTikzWorkspaceSnapshot();
    const history = getTikzWorkspaceSnapshotHistory();
    if (latest) {
      setSnapshot(latest);
    }
    if (history.length > 0) setActivity([...history]);
    return subscribeTikzWorkspaceSnapshot((next) => {
      setSnapshot(next);
      setActivity((current) => (
        current[0]?.revision === next.revision
          ? [next, ...current.slice(1)]
          : [next, ...current].slice(0, 5)
      ));
    });
  }, []);

  const heatmapEntries = useMemo(
    () => [...snapshot.heatmap.entries]
      .sort((left, right) => right[metric] - left[metric])
      .slice(0, 42),
    [metric, snapshot.heatmap.entries],
  );
  const activeMetric = HEATMAP_METRICS.find((item) => item.id === metric)
    ?? HEATMAP_METRICS[0];

  return (
    <MotionConfig reducedMotion="user">
      <main className="geo-home">
        <header className="geo-home__topbar">
          <a className="geo-home__brand" href="#" aria-label="Math GeoHub 首页">
            <span aria-hidden="true">M</span>
            <strong>Math GeoHub</strong>
          </a>
          <button
            type="button"
            className="geo-home__command"
            onClick={() => window.location.assign('/tikz')}
          >
            <span aria-hidden="true">⌕</span>
            描述或继续一个 TikZ 构造
            <kbd>打开 Studio</kbd>
          </button>
          <span className="geo-home__relay">
            <i aria-hidden="true" />
            api.molamaker.cn
          </span>
        </header>

        <nav className="geo-home__nav" aria-label="主导航">
          <div className="geo-home__nav-group">
            <span>Workspace</span>
            <a className="is-active" href="#overview"><b aria-hidden="true">⌂</b>首页</a>
            <a href="#studios"><b aria-hidden="true">⌘</b>画板</a>
            <a href="#health"><b aria-hidden="true">◫</b>场景健康</a>
            <a href="#capabilities"><b aria-hidden="true">⌗</b>语法能力</a>
          </div>
          <div className="geo-home__nav-group">
            <span>Studios</span>
            <Link href="/tikz">
              <b className="geo-home__nav-dot geo-home__nav-dot--tikz" aria-hidden="true" />
              TikZ Studio
            </Link>
            <Link href="/math">
              <b className="geo-home__nav-dot geo-home__nav-dot--math" aria-hidden="true" />
              GeoGebra
            </Link>
          </div>
          <footer>
            <strong>PGF/TikZ {PGF_TIKZ_VERSION}</strong>
            <span>{CAPABILITY_SUMMARY.total} capabilities · {CAPABILITY_SUMMARY.libraryCount} libraries</span>
          </footer>
        </nav>

        <section className="geo-home__main" id="overview">
          <div className="geo-home__heading">
            <div>
              <span>Competition Geometry Workspace</span>
              <h1>继续你的几何工作</h1>
              <p>项目级状态放在这里；进入画板后，只保留构造、源码与精确渲染。</p>
            </div>
            <Link className="geo-home__primary-action" href="/tikz">
              新建 TikZ 构造
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <section className="geo-home__section" id="studios">
            <div className="geo-home__section-head">
              <div>
                <h2>继续工作</h2>
                <span>最近使用的画板</span>
              </div>
            </div>
            <div className="geo-home__studios">
              <StudioLauncherCard
                href="/tikz"
                name="TikZ Studio"
                kind="tikz"
                status={`${snapshot.revision} revisions`}
                description="AI、代码与画板通过语义事务协同，适合竞赛几何构造与可复用 LaTeX。"
              />
              <StudioLauncherCard
                href="/math"
                name="GeoGebra Studio"
                kind="math"
                status="ready"
                description="快速动态构图、代数视图与原生工具，并可进入 TikZ 导出工作流。"
              />
            </div>
          </section>

          <section className="geo-home__section" id="health">
            <div className="geo-home__section-head">
              <div>
                <h2>场景健康</h2>
                <span>当前 TikZ 工作区的只读语义投影</span>
              </div>
              <Link href="/tikz">
                在 Studio 中查看
              </Link>
            </div>
            <article className="geo-home__heatmap">
              <header>
                <div>
                  <strong>语义热力图</strong>
                  <span>{activeMetric.description}</span>
                </div>
                <div className="geo-home__heatmap-tabs" role="group" aria-label="热力图指标">
                  {HEATMAP_METRICS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={metric === item.id}
                      className={metric === item.id ? 'is-active' : ''}
                      onClick={() => setMetric(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </header>
              <div className="geo-home__heatmap-body">
                <div className="geo-home__heatmap-grid">
                  {heatmapEntries.map((entry) => (
                    <motion.a
                      layout
                      key={entry.id}
                      href={buildTikzHref({
                        selectionRefs: entry.selectionRefs,
                        stmtIndex: entry.stmtIndex,
                      })}
                      className={[
                        'geo-home__heatmap-cell',
                        `geo-home__heatmap-cell--${entry.kind}`,
                        entry[metric] >= 0.55 ? 'is-hot' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ '--heat': entry[metric] } as CSSProperties}
                      title={`${entry.label} · ${entry.signals.join(' · ') || '无额外信号'}`}
                      aria-label={`${entry.label}，${activeMetric.label} ${Math.round(entry[metric] * 100)}%`}
                      whileHover={{ y: -1, scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      <i aria-hidden="true" />
                      <span>{entry.label.slice(0, 4)}</span>
                    </motion.a>
                  ))}
                </div>
                <dl className="geo-home__scene-stats">
                  <div><dt>Semantic</dt><dd>{snapshot.semanticRevision ?? '—'}</dd></div>
                  <div><dt>Points</dt><dd>{snapshot.pointCount}</dd></div>
                  <div><dt>Elements</dt><dd>{snapshot.elementCount}</dd></div>
                  <div className={snapshot.issueCount > 0 ? 'is-warning' : ''}>
                    <dt>Issues</dt><dd>{snapshot.issueCount}</dd>
                  </div>
                </dl>
              </div>
              <footer>
                <span><i aria-hidden="true" />0</span>
                <span className="geo-home__heatmap-legend" aria-hidden="true" />
                <span>100</span>
                <strong>{heatmapEntries.length} objects</strong>
              </footer>
            </article>
          </section>
        </section>

        <aside className="geo-home__rail" aria-label="工作区摘要">
          <section>
            <header>
              <h2>当前工作区</h2>
              <span className={`geo-home__state geo-home__state--${snapshot.projectionState}`}>
                {snapshot.projectionState}
              </span>
            </header>
            <dl className="geo-home__summary">
              <div><dt>最后更新</dt><dd>{formatSnapshotTime(snapshot.updatedAt)}</dd></div>
              <div><dt>最后入口</dt><dd>{snapshot.lastEditOrigin ?? 'initial'}</dd></div>
              <div><dt>源码 / 语义问题</dt><dd>{snapshot.sourceIssueCount} / {snapshot.issueCount}</dd></div>
            </dl>
          </section>

          <section id="capabilities">
            <header>
              <h2>官方语法能力</h2>
              <span>{CAPABILITY_SUMMARY.total}</span>
            </header>
            <div className="geo-home__coverage">
              {(['preserve', 'syntax', 'semantic', 'interactive', 'exact'] as const).map((dimension) => {
                const coverage = CAPABILITY_SUMMARY.capabilityCoverage[dimension];
                return (
                  <div key={dimension}>
                    <span><b>{dimension}</b><em>{coverageLabel(coverage.ratio)}</em></span>
                    <i aria-hidden="true"><b style={{ width: coverageLabel(coverage.ratio) }} /></i>
                  </div>
                );
              })}
            </div>
            <p>
              保真与精确编译不等于可直接操纵。画板只对已投影到 Geometry IR 的能力开放写回。
            </p>
          </section>

          <section>
            <header>
              <h2>本次会话</h2>
              <span>{activity.length}</span>
            </header>
            <ol className="geo-home__activity">
              {(activity.length > 0 ? activity : [snapshot]).map((item, index) => (
                <li key={`${item.revision}:${item.updatedAt}:${index}`}>
                  <i aria-hidden="true" />
                  <div>
                    <strong>Revision {item.revision}</strong>
                    <span>{item.lastEditOrigin ?? 'initial'} · {formatSnapshotTime(item.updatedAt)}</span>
                  </div>
                  <b>{item.pointCount + item.elementCount}</b>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>
    </MotionConfig>
  );
}
