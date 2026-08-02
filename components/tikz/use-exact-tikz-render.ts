'use client';

import { useEffect, useMemo, useState } from 'react';

export interface ExactTikzRender {
  imageUrl: string;
  loading: boolean;
  error: string;
  attestation: ExactTikzAttestation | null;
}

export interface ExactTikzAttestation {
  schemaVersion: 'tikz-artifact-attestation/v1';
  jobId: string;
  sourceDigest: string;
  cacheKeyDigest: string;
  artifactDigest: string;
  profile: 'tikz-standard-v1';
  visibility: 'public' | 'private';
  renderer: string;
  compilerImageDigest: string;
  mediaType: 'image/svg+xml';
  svgBytes: number;
  completedAt: number;
}

const DEBOUNCE_MS = 350;
const JOB_TIMEOUT_MS = 180_000;
const JOB_ID = /^j_[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isExactTikzAttestation(
  value: unknown,
  expectedJobId: string,
): value is ExactTikzAttestation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ExactTikzAttestation>;
  return record.schemaVersion === 'tikz-artifact-attestation/v1'
    && record.jobId === expectedJobId
    && JOB_ID.test(record.jobId)
    && typeof record.sourceDigest === 'string'
    && SHA256.test(record.sourceDigest)
    && typeof record.cacheKeyDigest === 'string'
    && SHA256.test(record.cacheKeyDigest)
    && expectedJobId === `j_${record.cacheKeyDigest}`
    && typeof record.artifactDigest === 'string'
    && SHA256.test(record.artifactDigest)
    && record.profile === 'tikz-standard-v1'
    && (record.visibility === 'public' || record.visibility === 'private')
    && typeof record.renderer === 'string'
    && record.renderer.length > 0
    && typeof record.compilerImageDigest === 'string'
    && record.compilerImageDigest.length > 0
    && record.mediaType === 'image/svg+xml'
    && typeof record.svgBytes === 'number'
    && Number.isSafeInteger(record.svgBytes)
    && record.svgBytes > 0
    && typeof record.completedAt === 'number'
    && Number.isSafeInteger(record.completedAt)
    && record.completedAt > 0;
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get('Retry-After')?.trim() ?? '';
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(250, Math.min(5_000, seconds * 1_000));
  }
  return 1_000;
}

export function useExactTikzRender(
  code: string,
  enabled: boolean,
): ExactTikzRender {
  const [rendered, setRendered] = useState<{
    code: string;
    svg: string;
    attestation: ExactTikzAttestation | null;
  }>({ code: '', svg: '', attestation: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      const run = async () => {
        let response = await fetch('/api/tikz/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          signal: controller.signal,
        });
        let payload = await response.json() as {
          jobId?: unknown;
          status?: unknown;
          svg?: unknown;
          attestation?: unknown;
          error?: unknown;
        };
        const deadline = Date.now() + JOB_TIMEOUT_MS;

        while (
          response.status === 202
          && typeof payload.jobId === 'string'
          && (payload.status === 'queued' || payload.status === 'running')
        ) {
          if (Date.now() >= deadline) {
            throw new Error('TikZ 精确渲染任务等待超时');
          }
          await wait(retryDelayMs(response), controller.signal);
          response = await fetch(
            `/api/tikz/render/${encodeURIComponent(payload.jobId)}`,
            { signal: controller.signal, cache: 'no-store' },
          );
          payload = await response.json() as typeof payload;
        }

        if (
          !response.ok
          || typeof payload.svg !== 'string'
          || typeof payload.jobId !== 'string'
          || !isExactTikzAttestation(payload.attestation, payload.jobId)
        ) {
          throw new Error(
            typeof payload.error === 'string'
              ? payload.error
              : `HTTP ${response.status}`,
          );
        }
        if (!controller.signal.aborted) {
          setRendered({
            code,
            svg: payload.svg,
            attestation: payload.attestation,
          });
        }
      };

      void run()
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'TikZ 精确渲染失败',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [code, enabled]);

  const imageUrl = useMemo(
    () => (
      rendered.code === code && rendered.svg
        ? svgDataUrl(rendered.svg)
        : ''
    ),
    [code, rendered],
  );
  return {
    imageUrl,
    loading,
    error,
    attestation: rendered.code === code ? rendered.attestation : null,
  };
}
