import type { VisualAuditWidget } from '@/lib/tikz/agent/widget-protocol';

export const TIKZ_VISUAL_AUDIT_SCHEMA_VERSION = 'tikz-visual-audit/v3' as const;
export const MAX_VISUAL_AUDIT_IMAGE_BYTES = 1_500 * 1024;
export const MAX_VISUAL_AUDIT_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_VISUAL_AUDIT_SEMANTIC_CHARS = 24_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_HASH = /^[a-f0-9]{16}$/u;
const BASIS_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export interface TikzVisualAuditRequest {
  readonly model: string;
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly artifactDigest?: string;
  readonly interactiveImageDataUrl: string;
  readonly exactImageDataUrl?: string;
  readonly semanticSummary: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function parseTikzVisualAuditRequest(value: unknown): TikzVisualAuditRequest | null {
  if (!record(value)) return null;
  const exactImage = value.exactImageDataUrl;
  if (
    !text(value.model, 200)
    || !text(value.documentId, 160)
    || !BASIS_ID.test(value.documentId)
    || !text(value.epoch, 160)
    || !BASIS_ID.test(value.epoch)
    || !Number.isSafeInteger(value.sourceRevision)
    || (value.sourceRevision as number) < 0
    || !text(value.sourceHash, 16)
    || !SOURCE_HASH.test(value.sourceHash)
    || !text(value.semanticSummary, MAX_VISUAL_AUDIT_SEMANTIC_CHARS)
    || !text(value.interactiveImageDataUrl, Math.ceil(MAX_VISUAL_AUDIT_IMAGE_BYTES * 1.4) + 128)
    || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u.test(value.interactiveImageDataUrl)
    || (exactImage !== undefined && (
      !text(exactImage, Math.ceil(MAX_VISUAL_AUDIT_IMAGE_BYTES * 1.4) + 128)
      || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u.test(exactImage)
    ))
    || (value.artifactDigest !== undefined && (
      !text(value.artifactDigest, 64)
      || !SHA256.test(value.artifactDigest)
    ))
    || ((exactImage !== undefined) !== (value.artifactDigest !== undefined))
  ) return null;
  const imageBytes = (dataUrl: string) => {
    const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Math.floor((encoded.length * 3) / 4);
  };
  const interactiveBytes = imageBytes(value.interactiveImageDataUrl);
  const exactBytes = typeof exactImage === 'string' ? imageBytes(exactImage) : 0;
  if (
    interactiveBytes > MAX_VISUAL_AUDIT_IMAGE_BYTES
    || exactBytes > MAX_VISUAL_AUDIT_IMAGE_BYTES
    || interactiveBytes + exactBytes > MAX_VISUAL_AUDIT_TOTAL_IMAGE_BYTES
  ) return null;
  return {
    model: value.model,
    documentId: value.documentId,
    epoch: value.epoch,
    sourceRevision: value.sourceRevision as number,
    sourceHash: value.sourceHash,
    semanticSummary: value.semanticSummary,
    interactiveImageDataUrl: value.interactiveImageDataUrl,
    ...(typeof exactImage === 'string' ? { exactImageDataUrl: exactImage } : {}),
    ...(typeof value.artifactDigest === 'string'
      ? { artifactDigest: value.artifactDigest }
      : {}),
  };
}

export function visualAuditSystemPrompt(): string {
  return [
    'You are a read-only visual QA observer for a geometry editor.',
    'The Geometry Semantic Kernel is the only truth. Images are observational evidence, never write authority.',
    'Image 1 is always the interactive Canvas render. Image 2, when present, is the exact TeX/TikZ render of the same source revision.',
    'Compare visible labels, clipping, overlaps, line contrast, missing objects, and obvious layout anomalies against the semantic summary.',
    'When Image 2 exists, explicitly compare object placement, stroke/dash weight, labels, bounding-box padding, and clipping between both surfaces.',
    'When Image 2 is absent, fidelity MUST be not-compared; never claim matched or drift from an interactive-only image.',
    'Do not propose source patches, TikZ code, coordinates, transactions, or hidden chain-of-thought.',
    `Return one JSON object: {"schemaVersion":"${TIKZ_VISUAL_AUDIT_SCHEMA_VERSION}","status":"passed|warning","fidelity":"matched|drift|not-compared","summary":"...","observations":["..."]}.`,
    'Use at most 12 short observations. If the image is insufficient, return warning and explain the uncertainty.',
  ].join('\n');
}

function responseJson(value: string): unknown {
  const fenced = /```(?:json|tikz-visual-audit)?\s*([\s\S]*?)```/iu.exec(value)?.[1];
  try {
    return JSON.parse((fenced ?? value).trim()) as unknown;
  } catch {
    return null;
  }
}

export function parseTikzVisualAuditResponse(
  value: string,
  options: { readonly exactImageProvided?: boolean } = {},
): VisualAuditWidget | null {
  const parsed = responseJson(value);
  if (!record(parsed) || parsed.schemaVersion !== TIKZ_VISUAL_AUDIT_SCHEMA_VERSION) return null;
  if (
    (parsed.status !== 'passed' && parsed.status !== 'warning')
    || !['matched', 'drift', 'not-compared'].includes(String(parsed.fidelity))
    || !text(parsed.summary, 1_000)
    || !Array.isArray(parsed.observations)
    || parsed.observations.length > 12
    || !parsed.observations.every((entry) => text(entry, 256))
  ) return null;
  // Fidelity is a comparison claim. Without the exact TeX raster there is no
  // second surface to compare against, so provider output must not be allowed
  // to present "matched" (or "drift") as an exact-rendering conclusion.
  // Keep the visual observations useful while lowering the claim at the host
  // boundary. The browser also applies the same guard defensively.
  const fidelity = options.exactImageProvided === false
    ? 'not-compared'
    : parsed.fidelity as VisualAuditWidget['fidelity'];
  return {
    kind: 'visual-audit',
    title: 'VLM 视觉复核',
    status: parsed.status,
    fidelity,
    summary: parsed.summary,
    observations: parsed.observations as string[],
  };
}

/**
 * Apply the same no-exact-surface guard to a parsed widget at any host edge.
 * Provider output is observational data and cannot upgrade an interactive-only
 * capture into an exact-fidelity claim.
 */
export function normalizeTikzVisualAuditFidelity(
  widget: VisualAuditWidget,
  exactImageProvided: boolean,
): VisualAuditWidget {
  return exactImageProvided
    ? widget
    : { ...widget, fidelity: 'not-compared' };
}
