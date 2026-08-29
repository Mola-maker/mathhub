import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeGeogebraLiveMutations,
  type GeogebraLiveMutationApi,
  type GeogebraLiveMutationEvent,
} from './geogebra-live-events';

describe('subscribeGeogebraLiveMutations', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('uses stable listener identities and forwards drag-end boundaries', () => {
    const registered = new Map<string, (...args: never[]) => void>();
    const unregistered = new Map<string, (...args: never[]) => void>();
    const api: GeogebraLiveMutationApi = {};
    for (const kind of ['Add', 'Remove', 'Update', 'Rename', 'Clear', 'Client'] as const) {
      Object.assign(api, {
        [`register${kind}Listener`]: (listener: (...args: never[]) => void) => {
          registered.set(kind, listener);
        },
        [`unregister${kind}Listener`]: (listener: (...args: never[]) => void) => {
          unregistered.set(kind, listener);
        },
      });
    }
    const events: GeogebraLiveMutationEvent[] = [];
    const subscription = subscribeGeogebraLiveMutations(api, (event) => events.push(event));

    registered.get('Add')?.('A' as never);
    registered.get('Rename')?.('A' as never, 'B' as never);
    registered.get('Client')?.('{"type":"dragEnd"}' as never);
    registered.get('Client')?.({ type: 'mouseDown' } as never);
    subscription.dispose();

    expect(events).toEqual([
      { kind: 'add', objectNames: ['A'] },
      { kind: 'rename', objectNames: ['A', 'B'] },
      { kind: 'drag-end', objectNames: [] },
    ]);
    for (const kind of registered.keys()) {
      expect(unregistered.get(kind)).toBe(registered.get(kind));
    }
  });

  it('re-registers listeners after clear because GeoGebra drops update listeners', () => {
    vi.useFakeTimers();
    const registerUpdateListener = vi.fn();
    const unregisterUpdateListener = vi.fn();
    let clearListener: (() => void) | undefined;
    const subscription = subscribeGeogebraLiveMutations({
      registerUpdateListener,
      unregisterUpdateListener,
      registerClearListener: (listener) => { clearListener = listener; },
    }, () => {});

    clearListener?.();
    vi.runAllTimers();

    expect(registerUpdateListener).toHaveBeenCalledTimes(2);
    expect(unregisterUpdateListener).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
});
