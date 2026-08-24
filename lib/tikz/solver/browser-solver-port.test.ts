import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSolverPort } from './browser-solver-port';

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();
  private readonly listeners = new Map<string, EventListener>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe('BrowserSolverPort', () => {
  it('terminates an unobservable synchronous Worker when its last request is cancelled', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const port = new BrowserSolverPort();
    const controller = new AbortController();
    const pending = port.solveDerivedDrag({
      source: '\\coordinate (H) at ($(A)!(C)!(B)$);',
      sourceRevision: 2,
      pointName: 'H',
      target: { x: 1, y: 0 },
    }, controller.signal);

    expect(FakeWorker.instances).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();

    const second = port.solveDerivedDrag({
      source: '\\coordinate (H) at ($(A)!(C)!(B)$);',
      sourceRevision: 2,
      pointName: 'H',
      target: { x: 2, y: 0 },
    });
    expect(FakeWorker.instances).toHaveLength(2);
    port.dispose();
    await expect(second).rejects.toThrow('约束求解器已释放');
  });
});
