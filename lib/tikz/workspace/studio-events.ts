import type { SceneHeatmap } from '@/lib/tikz/semantics/scene-heatmap';

export const TIKZ_WORKSPACE_SNAPSHOT_EVENT = 'mathgeo:tikz-workspace-snapshot';
export const TIKZ_STUDIO_OPEN_EVENT = 'mathgeo:open-tikz-studio';
const TIKZ_WORKSPACE_SNAPSHOT_STORAGE_KEY = 'mathgeo:tikz-workspace-snapshot:v1';
const TIKZ_WORKSPACE_HISTORY_STORAGE_KEY = 'mathgeo:tikz-workspace-history:v1';

export interface TikzWorkspaceSnapshot {
  revision: number;
  semanticRevision: number | null;
  updatedAt: number;
  pointCount: number;
  elementCount: number;
  issueCount: number;
  sourceIssueCount: number;
  projectionState: 'current' | 'stale' | 'unavailable';
  lastEditOrigin: string | null;
  heatmap: SceneHeatmap;
}

export interface TikzStudioOpenRequest {
  selectionRefs?: readonly string[];
  stmtIndex?: number | null;
}

let latestSnapshot: TikzWorkspaceSnapshot | null = null;
let latestHistory: TikzWorkspaceSnapshot[] | null = null;

function isWorkspaceSnapshot(value: unknown): value is TikzWorkspaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<TikzWorkspaceSnapshot>;
  return Number.isInteger(snapshot.revision)
    && (snapshot.semanticRevision === null || Number.isInteger(snapshot.semanticRevision))
    && typeof snapshot.updatedAt === 'number'
    && Number.isInteger(snapshot.pointCount)
    && Number.isInteger(snapshot.elementCount)
    && Number.isInteger(snapshot.issueCount)
    && Number.isInteger(snapshot.sourceIssueCount)
    && (
      snapshot.projectionState === 'current'
      || snapshot.projectionState === 'stale'
      || snapshot.projectionState === 'unavailable'
    )
    && (snapshot.lastEditOrigin === null || typeof snapshot.lastEditOrigin === 'string')
    && Boolean(
      snapshot.heatmap
      && Array.isArray(snapshot.heatmap.entries)
      && snapshot.heatmap.totals
      && snapshot.heatmap.maximums,
    );
}

export function getLatestTikzWorkspaceSnapshot(): TikzWorkspaceSnapshot | null {
  if (latestSnapshot || typeof window === 'undefined') return latestSnapshot;
  try {
    const stored = window.sessionStorage.getItem(TIKZ_WORKSPACE_SNAPSHOT_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (isWorkspaceSnapshot(parsed)) latestSnapshot = parsed;
  } catch {
    // Session storage is optional telemetry persistence, never source truth.
  }
  return latestSnapshot;
}

export function getTikzWorkspaceSnapshotHistory(): readonly TikzWorkspaceSnapshot[] {
  if (latestHistory) return latestHistory;
  latestHistory = [];
  if (typeof window === 'undefined') return latestHistory;
  try {
    const stored = window.sessionStorage.getItem(TIKZ_WORKSPACE_HISTORY_STORAGE_KEY);
    if (!stored) return latestHistory;
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      latestHistory = parsed.filter(isWorkspaceSnapshot).slice(0, 5);
    }
  } catch {
    // History is optional dashboard telemetry.
  }
  return latestHistory;
}

export function publishTikzWorkspaceSnapshot(snapshot: TikzWorkspaceSnapshot): void {
  latestSnapshot = snapshot;
  if (typeof window === 'undefined') return;
  const history = getTikzWorkspaceSnapshotHistory();
  latestHistory = (
    history[0]?.revision === snapshot.revision
      ? [snapshot, ...history.slice(1)]
      : [snapshot, ...history]
  ).slice(0, 5);
  try {
    window.sessionStorage.setItem(
      TIKZ_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
    window.sessionStorage.setItem(
      TIKZ_WORKSPACE_HISTORY_STORAGE_KEY,
      JSON.stringify(latestHistory),
    );
  } catch {
    // The live event still works when storage is unavailable or quota-limited.
  }
  window.dispatchEvent(new CustomEvent<TikzWorkspaceSnapshot>(
    TIKZ_WORKSPACE_SNAPSHOT_EVENT,
    { detail: snapshot },
  ));
}

export function subscribeTikzWorkspaceSnapshot(
  listener: (snapshot: TikzWorkspaceSnapshot) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => {
    listener((event as CustomEvent<TikzWorkspaceSnapshot>).detail);
  };
  window.addEventListener(TIKZ_WORKSPACE_SNAPSHOT_EVENT, handle);
  return () => window.removeEventListener(TIKZ_WORKSPACE_SNAPSHOT_EVENT, handle);
}

export function requestTikzStudioOpen(request: TikzStudioOpenRequest = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TikzStudioOpenRequest>(
    TIKZ_STUDIO_OPEN_EVENT,
    { detail: request },
  ));
}

export function subscribeTikzStudioOpen(
  listener: (request: TikzStudioOpenRequest) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => {
    listener((event as CustomEvent<TikzStudioOpenRequest>).detail);
  };
  window.addEventListener(TIKZ_STUDIO_OPEN_EVENT, handle);
  return () => window.removeEventListener(TIKZ_STUDIO_OPEN_EVENT, handle);
}
