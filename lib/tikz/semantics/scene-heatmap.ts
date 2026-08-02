import type { Scene } from './scene';

export type SceneHeatmapMetric = 'dependency' | 'risk' | 'activity';

export interface SceneHeatmapEntry {
  id: string;
  label: string;
  kind: 'point' | 'element';
  stmtIndex: number;
  selectionRefs: readonly string[];
  dependency: number;
  risk: number;
  activity: number;
  signals: readonly string[];
}

export interface SceneHeatmap {
  entries: readonly SceneHeatmapEntry[];
  totals: Record<SceneHeatmapMetric, number>;
  maximums: Record<SceneHeatmapMetric, number>;
}

export interface SceneHeatmapOptions {
  selection?: readonly string[];
  selectedStmtIndex?: number | null;
  hoveredStmtIndex?: number | null;
  activeEntityIds?: readonly string[];
  activeStmtIndices?: readonly number[];
}

function normalize(
  entries: readonly SceneHeatmapEntry[],
  metric: SceneHeatmapMetric,
  maximum: number,
): SceneHeatmapEntry[] {
  return entries.map((entry) => ({
    ...entry,
    [metric]: maximum > 0 ? Math.min(1, entry[metric] / maximum) : 0,
  }));
}

export function buildSceneHeatmap(
  scene: Scene,
  options: SceneHeatmapOptions = {},
): SceneHeatmap {
  const selected = new Set(options.selection ?? []);
  const activeEntities = new Set(options.activeEntityIds ?? []);
  const activeStatements = new Set(options.activeStmtIndices ?? []);
  const issueCounts = new Map<number, number>();
  for (const issue of scene.issues) {
    issueCounts.set(issue.stmtIndex, (issueCounts.get(issue.stmtIndex) ?? 0) + 1);
  }
  const referencedBy = new Map<string, number>();
  for (const element of scene.elements) {
    for (const reference of element.refs) {
      referencedBy.set(reference, (referencedBy.get(reference) ?? 0) + 1);
    }
  }

  const raw: SceneHeatmapEntry[] = [];
  for (const point of scene.points.values()) {
    if (point.internal) continue;
    const signals: string[] = [];
    const dependency = (
      point.dependsOn.length
      + (referencedBy.get(point.name) ?? 0)
      + (point.constraint ? 2 : 0)
    );
    const risk = issueCounts.get(point.stmtIndex) ?? 0;
    const recentlyChanged = activeEntities.has(point.stableId)
      || activeStatements.has(point.stmtIndex);
    const activity = selected.has(point.name)
      ? 1
      : options.hoveredStmtIndex === point.stmtIndex
        ? 0.72
        : recentlyChanged
          ? 0.84
          : 0;
    if (point.constraint) signals.push('constraint');
    if (point.dependsOn.length > 0) signals.push(`${point.dependsOn.length} upstream`);
    if ((referencedBy.get(point.name) ?? 0) > 0) {
      signals.push(`${referencedBy.get(point.name)} downstream`);
    }
    if (risk > 0) signals.push(`${risk} issue`);
    if (selected.has(point.name)) signals.push('selected');
    if (recentlyChanged) signals.push('changed in last transaction');
    raw.push({
      id: point.stableId,
      label: point.name,
      kind: 'point',
      stmtIndex: point.stmtIndex,
      selectionRefs: [point.name],
      dependency,
      risk,
      activity,
      signals,
    });
  }
  scene.elements.forEach((element, index) => {
    const risk = issueCounts.get(element.stmtIndex) ?? 0;
    const elementSelected = options.selectedStmtIndex === element.stmtIndex
      || element.refs.some((reference) => selected.has(reference));
    const recentlyChanged = activeEntities.has(element.stableId)
      || activeStatements.has(element.stmtIndex);
    const activity = elementSelected
      ? 1
      : options.hoveredStmtIndex === element.stmtIndex
        ? 0.72
        : recentlyChanged
          ? 0.84
          : 0;
    raw.push({
      id: element.stableId,
      label: `${element.kind} ${index + 1}`,
      kind: 'element',
      stmtIndex: element.stmtIndex,
      selectionRefs: element.refs,
      dependency: element.refs.length,
      risk,
      activity,
      signals: [
        ...(element.refs.length > 0 ? [`${element.refs.length} refs`] : []),
        ...(risk > 0 ? [`${risk} issue`] : []),
        ...(elementSelected ? ['selected'] : []),
        ...(recentlyChanged ? ['changed in last transaction'] : []),
      ],
    });
  });

  const rawMaximums = {
    dependency: Math.max(0, ...raw.map((entry) => entry.dependency)),
    risk: Math.max(0, ...raw.map((entry) => entry.risk)),
    activity: Math.max(0, ...raw.map((entry) => entry.activity)),
  };
  let normalized = normalize(raw, 'dependency', rawMaximums.dependency);
  normalized = normalize(normalized, 'risk', rawMaximums.risk);
  return {
    entries: normalized,
    totals: {
      dependency: raw.reduce((sum, entry) => sum + entry.dependency, 0),
      risk: raw.reduce((sum, entry) => sum + entry.risk, 0),
      activity: raw.reduce((sum, entry) => sum + entry.activity, 0),
    },
    maximums: rawMaximums,
  };
}
