import {
  parseTikzReadOnlyAgentWidget,
  type TikzRenderComparisonArtifact,
  type VisualAuditWidget,
} from '@/lib/tikz/agent/widget-protocol';
import { normalizeTikzVisualAuditFidelity } from '@/lib/tikz/vision/visual-audit';
import { requestExactTikzArtifact, sha256Utf8 } from './exact-render-client';

const MAX_CAPTURE_EDGE = 1_024;
const COMPARISON_SURFACE_INSET_PX = 40;
const NON_DOCUMENT_SELECTORS = [
  '.tz-selection-marquee',
  '.tz-selection-transform-handles',
  '.tz-construction-preview',
  '.tz-selection-halo',
  '.tz-point-hit-target',
  '.tz-point-handle',
  '.tz-semantic-extent-guide',
].join(',');
const SHA256 = /^[a-f0-9]{64}$/u;

export interface TikzComparisonBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fit both renderers to one canonical surface instead of comparing the user's
 * current pan/zoom against the exact compiler's tight SVG page. Coordinates
 * remain in the interactive SVG's screen space, while the viewBox cancels the
 * current viewport and applies the same pixel inset used for the exact image.
 */
export function tikzComparisonViewBox(
  bounds: TikzComparisonBounds,
  surface: { readonly width: number; readonly height: number },
  inset = COMPARISON_SURFACE_INSET_PX,
): string | null {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height, surface.width, surface.height, inset]
      .every(Number.isFinite)
    || bounds.width < 0
    || bounds.height < 0
    || surface.width <= 0
    || surface.height <= 0
    || inset < 0
    || (bounds.width === 0 && bounds.height === 0)
  ) return null;
  const availableWidth = Math.max(1, surface.width - inset * 2);
  const availableHeight = Math.max(1, surface.height - inset * 2);
  const contentWidth = Math.max(bounds.width, 1e-6);
  const contentHeight = Math.max(bounds.height, 1e-6);
  const scale = Math.min(
    availableWidth / contentWidth,
    availableHeight / contentHeight,
  );
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const viewWidth = surface.width / scale;
  const viewHeight = surface.height / scale;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return [
    centerX - viewWidth / 2,
    centerY - viewHeight / 2,
    viewWidth,
    viewHeight,
  ].join(' ');
}

async function rasterDigest(dataUrl: string): Promise<string> {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function interactiveSurfaceBlob(root: HTMLElement): Blob | null {
  const source = root.querySelector<SVGSVGElement>('svg');
  if (!source) return null;
  const rect = root.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const documentLayer = source.querySelector<SVGGElement>(
    'g[data-layer="base"][data-render-source="geometry-truth"]',
  );
  let canonicalViewBox: string | null = null;
  if (documentLayer && typeof documentLayer.getBBox === 'function') {
    try {
      canonicalViewBox = tikzComparisonViewBox(documentLayer.getBBox(), {
        width: rect.width,
        height: rect.height,
      });
    } catch {
      canonicalViewBox = null;
    }
  }
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(NON_DOCUMENT_SELECTORS).forEach((node) => node.remove());
  clone.querySelectorAll(
    'g[data-layer="overlay"],g[data-layer="render-diagnostics"],.tz-selection-transform-preview',
  ).forEach((node) => node.remove());
  clone.querySelectorAll('[data-selected],[data-hovered]').forEach((node) => {
    node.removeAttribute('data-selected');
    node.removeAttribute('data-hovered');
  });
  // The live SVG uses non-scaling strokes for editor zoom. The canonical
  // comparison viewBox must scale geometry, strokes, dashes, and text as one
  // document surface, matching dvisvgm's fitted exact artifact.
  clone.querySelectorAll('[vector-effect]').forEach((node) => {
    node.removeAttribute('vector-effect');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(rect.width)));
  clone.setAttribute('height', String(Math.round(rect.height)));
  if (canonicalViewBox) {
    clone.setAttribute('viewBox', canonicalViewBox);
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
  clone.removeAttribute('tabindex');
  clone.removeAttribute('aria-label');
  clone.style.visibility = 'visible';
  return new Blob([new XMLSerializer().serializeToString(clone)], {
    type: 'image/svg+xml;charset=utf-8',
  });
}

async function rasterizeSurface(
  sourceBlob: Blob,
  root: HTMLElement,
  containInset = 0,
): Promise<string | null> {
  const objectUrl = URL.createObjectURL(sourceBlob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The Canvas snapshot could not be decoded.'));
      image.src = objectUrl;
    });
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    if (containInset <= 0) {
      context.drawImage(image, 0, 0, width, height);
    } else {
      const inset = Math.max(0, containInset * scale);
      const availableWidth = Math.max(1, width - inset * 2);
      const availableHeight = Math.max(1, height - inset * 2);
      const imageScale = Math.min(
        availableWidth / image.naturalWidth,
        availableHeight / image.naturalHeight,
      );
      const drawWidth = image.naturalWidth * imageScale;
      const drawHeight = image.naturalHeight * imageScale;
      context.drawImage(
        image,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    }
    return canvas.toDataURL('image/png', 0.9);
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(objectUrl);
  }
}

export interface TikzCanvasAuditSurfaces {
  readonly interactiveImageDataUrl: string;
  readonly exactImageDataUrl?: string;
  readonly exactSourceDigest?: string;
  readonly exactArtifactDigest?: string;
}

export function matchesExactCanvasSurfaceBasis(
  dataset: {
    readonly artifactDigest?: string;
    readonly sourceDigest?: string;
    readonly sourceRevision?: string;
  },
  expected: {
    readonly sourceDigest?: string;
    readonly sourceRevision?: number;
  },
): boolean {
  return typeof dataset.artifactDigest === 'string'
    && SHA256.test(dataset.artifactDigest)
    && (expected.sourceDigest === undefined || dataset.sourceDigest === expected.sourceDigest)
    && (
      expected.sourceRevision === undefined
      || dataset.sourceRevision === String(expected.sourceRevision)
    );
}

export function matchesTikzVisualAuditBasis(
  payload: {
    readonly documentId?: unknown;
    readonly epoch?: unknown;
    readonly sourceRevision?: unknown;
    readonly sourceHash?: unknown;
    readonly artifactDigest?: unknown;
  },
  expected: {
    readonly documentId: string;
    readonly epoch: string;
    readonly sourceRevision: number;
    readonly sourceHash: string;
    readonly artifactDigest?: string;
  },
): boolean {
  return payload.documentId === expected.documentId
    && payload.epoch === expected.epoch
    && payload.sourceRevision === expected.sourceRevision
    && payload.sourceHash === expected.sourceHash
    && (expected.artifactDigest === undefined
      || payload.artifactDigest === expected.artifactDigest);
}

export function matchesTikzRenderComparisonArtifact(
  value: unknown,
  expected: TikzRenderComparisonArtifact,
): value is TikzRenderComparisonArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Partial<TikzRenderComparisonArtifact>;
  return artifact.schemaVersion === 'tikz-render-comparison-artifact/v1'
    && artifact.documentId === expected.documentId
    && artifact.epoch === expected.epoch
    && artifact.sourceRevision === expected.sourceRevision
    && artifact.sourceHash === expected.sourceHash
    && artifact.mode === expected.mode
    && typeof artifact.interactiveRasterDigest === 'string'
    && artifact.interactiveRasterDigest === expected.interactiveRasterDigest
    && SHA256.test(artifact.interactiveRasterDigest)
    && artifact.exactRasterDigest === expected.exactRasterDigest
    && artifact.exactArtifactDigest === expected.exactArtifactDigest
    && (artifact.exactRasterDigest === undefined || SHA256.test(artifact.exactRasterDigest))
    && (artifact.exactArtifactDigest === undefined || SHA256.test(artifact.exactArtifactDigest));
}

export async function captureTikzCanvasSurfaces(
  root: HTMLElement,
  options: {
    readonly exactSource?: string;
    readonly exactSourceRevision?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<TikzCanvasAuditSurfaces | null> {
  const interactiveBlob = interactiveSurfaceBlob(root);
  if (!interactiveBlob) return null;
  const interactiveImageDataUrl = await rasterizeSurface(interactiveBlob, root);
  if (!interactiveImageDataUrl) return null;

  const exact = root.querySelector<HTMLImageElement>('img.tz-exact-render');
  try {
    let exactBlob: Blob;
    let exactSourceDigest: string | undefined;
    let exactArtifactDigest: string | undefined;
    const expectedExactSourceDigest = options.exactSource
      ? await sha256Utf8(options.exactSource)
      : undefined;
    if (
      exact?.src
      && matchesExactCanvasSurfaceBasis(exact.dataset, {
        ...(expectedExactSourceDigest ? { sourceDigest: expectedExactSourceDigest } : {}),
        ...(options.exactSourceRevision !== undefined
          ? { sourceRevision: options.exactSourceRevision }
          : {}),
      })
    ) {
      const response = await fetch(exact.src, { signal: options.signal });
      if (!response.ok) return { interactiveImageDataUrl };
      exactBlob = await response.blob();
      exactSourceDigest = exact.dataset.sourceDigest;
      exactArtifactDigest = exact.dataset.artifactDigest;
    } else if (options.exactSource) {
      const artifact = await requestExactTikzArtifact(options.exactSource, {
        signal: options.signal ?? new AbortController().signal,
      });
      exactBlob = new Blob([artifact.svg], { type: 'image/svg+xml;charset=utf-8' });
      exactSourceDigest = artifact.attestation.sourceDigest;
      exactArtifactDigest = artifact.attestation.artifactDigest;
    } else {
      return { interactiveImageDataUrl };
    }
    const exactImageDataUrl = await rasterizeSurface(
      exactBlob,
      root,
      COMPARISON_SURFACE_INSET_PX,
    );
    return exactImageDataUrl
      ? {
          interactiveImageDataUrl,
          exactImageDataUrl,
          ...(exactSourceDigest
            ? { exactSourceDigest }
            : {}),
          ...(exactArtifactDigest
            ? { exactArtifactDigest }
            : {}),
        }
      : { interactiveImageDataUrl };
  } catch {
    return { interactiveImageDataUrl };
  }
}

export async function requestTikzVisualAudit(input: {
  readonly model: string;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly source: string;
  readonly semanticSummary: string;
  readonly artifactDigest?: string;
  readonly signal?: AbortSignal;
}): Promise<VisualAuditWidget> {
  const root = document.querySelector<HTMLElement>('[data-testid="tikz-canvas"]');
  if (!root) throw new Error('Canvas surface is unavailable.');
  const surfaces = await captureTikzCanvasSurfaces(root, {
    exactSource: input.source,
    exactSourceRevision: input.sourceRevision,
    signal: input.signal,
  });
  if (!surfaces) throw new Error('Canvas capture is unavailable.');
  const [interactiveRasterDigest, exactRasterDigest] = await Promise.all([
    rasterDigest(surfaces.interactiveImageDataUrl),
    surfaces.exactImageDataUrl
      ? rasterDigest(surfaces.exactImageDataUrl)
      : Promise.resolve(undefined),
  ]);
  const comparisonArtifact: TikzRenderComparisonArtifact = {
    schemaVersion: 'tikz-render-comparison-artifact/v1',
    documentId: input.documentId,
    epoch: input.epoch,
    sourceRevision: input.sourceRevision,
    sourceHash: input.sourceHash,
    mode: surfaces.exactImageDataUrl ? 'interactive-vs-exact' : 'interactive-only',
    interactiveRasterDigest,
    ...(exactRasterDigest ? { exactRasterDigest } : {}),
    ...(surfaces.exactArtifactDigest
      ? { exactArtifactDigest: surfaces.exactArtifactDigest }
      : {}),
  };
  const response = await fetch('/api/tikz/visual-audit', {
    method: 'POST',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      documentId: input.documentId,
      epoch: input.epoch,
      sourceRevision: input.sourceRevision,
      sourceHash: input.sourceHash,
      semanticSummary: input.semanticSummary,
      ...surfaces,
      ...(surfaces.exactImageDataUrl && (surfaces.exactArtifactDigest || input.artifactDigest)
        ? { artifactDigest: surfaces.exactArtifactDigest ?? input.artifactDigest }
        : {}),
    }),
  });
  const payload = await response.json() as {
    assistantWidget?: unknown;
    error?: unknown;
    documentId?: unknown;
    epoch?: unknown;
    sourceRevision?: unknown;
    sourceHash?: unknown;
    artifactDigest?: unknown;
    comparisonArtifact?: unknown;
  };
  const widget = parseTikzReadOnlyAgentWidget(payload.assistantWidget);
  if (!response.ok || widget?.kind !== 'visual-audit') {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Visual audit failed.');
  }
  const expectedArtifactDigest = surfaces.exactImageDataUrl
    ? surfaces.exactArtifactDigest ?? input.artifactDigest
    : undefined;
  if (!matchesTikzVisualAuditBasis(payload, {
    documentId: input.documentId,
    epoch: input.epoch,
    sourceRevision: input.sourceRevision,
    sourceHash: input.sourceHash,
    ...(expectedArtifactDigest ? { artifactDigest: expectedArtifactDigest } : {}),
  })) throw new Error('Visual audit result no longer matches the current Canvas revision.');
  if (!matchesTikzRenderComparisonArtifact(payload.comparisonArtifact, comparisonArtifact)) {
    throw new Error('Visual audit comparison artifact no longer matches the captured surfaces.');
  }
  return {
    ...normalizeTikzVisualAuditFidelity(widget, Boolean(surfaces.exactImageDataUrl)),
    comparisonArtifact,
  };
}
