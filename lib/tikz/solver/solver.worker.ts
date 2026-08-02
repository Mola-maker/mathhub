/// <reference lib="webworker" />

import { solveDerivedDrag } from './derived-drag';
import type { SolverWorkerRequest, SolverWorkerResponse } from './protocol';

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener('message', (event: MessageEvent<SolverWorkerRequest>) => {
  if (event.data.type !== 'solve-derived-drag') return;
  let response: SolverWorkerResponse;
  try {
    response = {
      type: 'solve-derived-drag-result',
      requestId: event.data.requestId,
      payload: solveDerivedDrag(event.data.payload),
    };
  } catch (error) {
    response = {
      type: 'solve-derived-drag-result',
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : '约束求解失败',
    };
  }
  worker.postMessage(response);
});

export {};
