'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashSource } from '@/lib/tikz/document/source-hash';
import {
  selectTikzExactCompilerProfile,
  type TikzExactCompilerProfileId,
} from '@/lib/tikz/exact/profile-selection';
import {
  createTikzAsyncWorkItemId,
  sameTikzAsyncWorkBasis,
  tikzAsyncWorkItemOwnsBasis,
  type TikzAsyncWorkBasis,
  type TikzAsyncWorkItem,
} from '@/lib/tikz/runtime/work-item';
import {
  ExactTikzClientError,
  requestExactTikzArtifact,
  type ExactTikzAttestation,
  type ExactTikzDiagnostic,
} from './exact-render-client';

export type { ExactTikzAttestation, ExactTikzDiagnostic } from './exact-render-client';

export interface ExactTikzRenderBasis extends TikzAsyncWorkBasis {
  readonly pluginSetDigest: string;
}

export interface ExactTikzRenderItem
  extends Omit<TikzAsyncWorkItem<'exact-render'>, 'basis' | 'status'> {
  readonly basis: ExactTikzRenderBasis;
  readonly profile: TikzExactCompilerProfileId;
  readonly status: 'queued' | 'running' | 'ready' | 'failed';
  readonly jobId?: string;
  readonly artifactDigest?: string;
}

export interface ExactTikzRender {
  imageUrl: string;
  status: 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  loading: boolean;
  error: string;
  errorCode: string;
  diagnostics: ExactTikzDiagnostic[];
  attestation: ExactTikzAttestation | null;
  item: ExactTikzRenderItem | null;
  retry(): void;
}

const DEBOUNCE_MS = 350;

export function sameExactTikzRenderBasis(
  first: ExactTikzRenderBasis,
  second: ExactTikzRenderBasis,
): boolean {
  return sameTikzAsyncWorkBasis(first, second);
}

export function exactTikzRenderItemOwnsBasis(
  activeItemId: string | null,
  itemId: string,
  capturedBasis: ExactTikzRenderBasis,
  currentBasis: ExactTikzRenderBasis,
): boolean {
  return tikzAsyncWorkItemOwnsBasis(
    activeItemId,
    itemId,
    capturedBasis,
    currentBasis,
  );
}

export function useExactTikzRender(
  code: string,
  basis: ExactTikzRenderBasis,
  enabled: boolean,
): ExactTikzRender {
  const [rendered, setRendered] = useState<{
    code: string;
    svg: string;
    itemId: string;
    basis: ExactTikzRenderBasis;
    attestation: ExactTikzAttestation | null;
  } | null>(null);
  const [item, setItem] = useState<ExactTikzRenderItem | null>(null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [diagnostics, setDiagnostics] = useState<ExactTikzDiagnostic[]>([]);
  const [imageAsset, setImageAsset] = useState<{
    readonly itemId: string;
    readonly url: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeItemIdRef = useRef<string | null>(null);
  const currentBasisRef = useRef(basis);
  currentBasisRef.current = basis;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const {
    documentId,
    epoch,
    sourceId,
    revision,
    sourceHash,
    pluginSetDigest,
  } = basis;

  useEffect(() => {
    if (!enabled) {
      activeItemIdRef.current = null;
      setError('');
      setErrorCode('');
      setDiagnostics([]);
      setRendered(null);
      setItem(null);
      return;
    }

    const controller = new AbortController();
    const itemId = createTikzAsyncWorkItemId('exact-render');
    const requestedAt = Date.now();
    const requestedProfile = selectTikzExactCompilerProfile(code).profile;
    const capturedBasis: ExactTikzRenderBasis = {
      documentId,
      epoch,
      sourceId,
      revision,
      sourceHash,
      pluginSetDigest,
    };
    activeItemIdRef.current = itemId;
    setItem({
      schemaVersion: 'tikz-async-work-item/v1',
      itemId,
      kind: 'exact-render',
      basis: capturedBasis,
      profile: requestedProfile,
      status: 'queued',
      requestedAt,
      updatedAt: requestedAt,
    });
    setError('');
    setErrorCode('');
    setDiagnostics([]);

    if (capturedBasis.sourceHash !== hashSource(code)) {
      const message = '精确渲染请求的源码哈希与当前 revision 不一致';
      setError(message);
      setErrorCode('EXACT_SOURCE_BASIS_MISMATCH');
      setItem((current) => current?.itemId === itemId
        ? {
            ...current,
            status: 'failed',
            updatedAt: Date.now(),
            completedAt: Date.now(),
            errorCode: 'EXACT_SOURCE_BASIS_MISMATCH',
          }
        : current);
      return () => {
        controller.abort();
        if (activeItemIdRef.current === itemId) activeItemIdRef.current = null;
      };
    }

    const timer = window.setTimeout(() => {
      const run = async () => {
        const artifact = await requestExactTikzArtifact(code, {
          signal: controller.signal,
          onStatus: (nextStatus) => {
            if (!exactTikzRenderItemOwnsBasis(
              activeItemIdRef.current,
              itemId,
              capturedBasis,
              currentBasisRef.current,
            )) return;
            setItem((current) => current?.itemId === itemId
              ? {
                  ...current,
                  status: current.status === 'running' && nextStatus === 'queued'
                    ? 'running'
                    : nextStatus,
                  updatedAt: Date.now(),
                }
              : current);
          },
        });
        if (
          !controller.signal.aborted
          && exactTikzRenderItemOwnsBasis(
            activeItemIdRef.current,
            itemId,
            capturedBasis,
            currentBasisRef.current,
          )
        ) {
          setRendered({
            code,
            svg: artifact.svg,
            itemId,
            basis: capturedBasis,
            attestation: artifact.attestation,
          });
          setItem((current) => current?.itemId === itemId
            ? {
                ...current,
                status: 'ready',
                updatedAt: Date.now(),
                completedAt: Date.now(),
                jobId: artifact.attestation.jobId,
                artifactDigest: artifact.attestation.artifactDigest,
                profile: artifact.attestation.profile,
              }
            : current);
        }
      };

      void run()
        .catch((requestError: unknown) => {
          if (
            controller.signal.aborted
            || !exactTikzRenderItemOwnsBasis(
              activeItemIdRef.current,
              itemId,
              capturedBasis,
              currentBasisRef.current,
            )
          ) return;
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'TikZ 精确渲染失败',
          );
          setErrorCode(requestError instanceof ExactTikzClientError ? requestError.code : '');
          setDiagnostics(requestError instanceof ExactTikzClientError
            ? [...requestError.diagnostics]
            : []);
          setItem((current) => current?.itemId === itemId
            ? {
                ...current,
                status: 'failed',
                updatedAt: Date.now(),
                completedAt: Date.now(),
                errorCode: requestError instanceof ExactTikzClientError
                  ? requestError.code
                  : '',
              }
            : current);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeItemIdRef.current === itemId) activeItemIdRef.current = null;
    };
  }, [
    attempt,
    code,
    documentId,
    enabled,
    epoch,
    pluginSetDigest,
    revision,
    sourceHash,
    sourceId,
  ]);

  const currentItem = item && sameExactTikzRenderBasis(item.basis, basis)
    ? item
    : null;
  const currentRendered = rendered
    && rendered.code === code
    && rendered.itemId === currentItem?.itemId
    && sameExactTikzRenderBasis(rendered.basis, basis)
    ? rendered
    : null;

  const currentSvgAsset = useMemo(
    () => currentRendered
      ? { itemId: currentRendered.itemId, svg: currentRendered.svg }
      : null,
    [currentRendered],
  );
  useEffect(() => {
    if (!currentSvgAsset) {
      setImageAsset(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([currentSvgAsset.svg], {
      type: 'image/svg+xml;charset=utf-8',
    }));
    setImageAsset({ itemId: currentSvgAsset.itemId, url });
    return () => URL.revokeObjectURL(url);
  }, [currentSvgAsset]);

  const currentImageUrl = currentRendered
    && imageAsset?.itemId === currentRendered.itemId
    ? imageAsset.url
    : '';

  return {
    imageUrl: currentImageUrl,
    status: currentItem?.status ?? 'idle',
    loading: currentItem?.status === 'queued' || currentItem?.status === 'running',
    error: currentItem ? error : '',
    errorCode: currentItem ? errorCode : '',
    diagnostics: currentItem ? diagnostics : [],
    attestation: currentRendered?.attestation ?? null,
    item: currentItem,
    retry,
  };
}
