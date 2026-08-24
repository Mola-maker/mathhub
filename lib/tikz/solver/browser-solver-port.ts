'use client';

import type {
  DerivedDragRequest,
  DerivedDragResult,
  SolverPort,
  SolverWorkerRequest,
  SolverWorkerResponse,
} from './protocol';

interface PendingRequest {
  resolve(result: DerivedDragResult): void;
  reject(error: Error): void;
  removeAbortListener(): void;
}

export class BrowserSolverPort implements SolverPort {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      throw new Error('当前浏览器不支持 Worker 约束求解');
    }
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
      name: 'tikz-constraint-solver',
    });
    worker.addEventListener(
      'message',
      (event: MessageEvent<SolverWorkerResponse>) => {
        if (event.data.type !== 'solve-derived-drag-result') return;
        const pending = this.pending.get(event.data.requestId);
        if (!pending) return;
        this.pending.delete(event.data.requestId);
        pending.removeAbortListener();
        if (event.data.payload) pending.resolve(event.data.payload);
        else pending.reject(new Error(event.data.error || '约束求解失败'));
      },
    );
    worker.addEventListener('error', () => {
      for (const pending of this.pending.values()) {
        pending.removeAbortListener();
        pending.reject(new Error('约束求解 Worker 异常退出'));
      }
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  solveDerivedDrag(
    request: DerivedDragRequest,
    signal?: AbortSignal,
  ): Promise<DerivedDragResult> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    const worker = this.ensureWorker();
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.removeAbortListener();
        // A Worker cannot observe a cancellation message while synchronous
        // constraint solving is running. When this was its last owned request,
        // terminate it so a cancelled drag does not retain CPU or heap until
        // the obsolete solve eventually returns. The next drag lazily creates
        // a fresh Worker.
        if (this.pending.size === 0) {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
        }
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      const message: SolverWorkerRequest = {
        type: 'solve-derived-drag',
        requestId,
        payload: request,
      };
      worker.postMessage(message);
    });
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      pending.removeAbortListener();
      pending.reject(new Error('约束求解器已释放'));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
