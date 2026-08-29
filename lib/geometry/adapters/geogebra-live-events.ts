export type GeogebraLiveMutationKind =
  | 'add'
  | 'remove'
  | 'rename'
  | 'update'
  | 'clear'
  | 'drag-end';

export interface GeogebraLiveMutationEvent {
  readonly kind: GeogebraLiveMutationKind;
  readonly objectNames: readonly string[];
}

type AddRemoveUpdateListener = (name: string) => void;
type RenameListener = (oldName: string, newName: string) => void;
type ClearListener = () => void;
type ClientListener = (event: unknown) => void;

export interface GeogebraLiveMutationApi {
  registerAddListener?: (listener: AddRemoveUpdateListener) => void;
  unregisterAddListener?: (listener: AddRemoveUpdateListener) => void;
  registerRemoveListener?: (listener: AddRemoveUpdateListener) => void;
  unregisterRemoveListener?: (listener: AddRemoveUpdateListener) => void;
  registerUpdateListener?: (listener: AddRemoveUpdateListener) => void;
  unregisterUpdateListener?: (listener: AddRemoveUpdateListener) => void;
  registerRenameListener?: (listener: RenameListener) => void;
  unregisterRenameListener?: (listener: RenameListener) => void;
  registerClearListener?: (listener: ClearListener) => void;
  unregisterClearListener?: (listener: ClearListener) => void;
  registerClientListener?: (listener: ClientListener) => void;
  unregisterClientListener?: (listener: ClientListener) => void;
}

export interface GeogebraLiveMutationSubscription {
  readonly refresh: () => void;
  readonly dispose: () => void;
}

function clientEventType(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as { type?: unknown };
      return typeof parsed.type === 'string' ? parsed.type : '';
    } catch {
      return '';
    }
  }
  if (value && typeof value === 'object') {
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' ? type : '';
  }
  return '';
}

/** Bind stable function identities so every listener can be unregistered.
 * Clear refreshes the global listener set because GeoGebra clears update
 * listeners when a construction is reset or a file is opened. */
export function subscribeGeogebraLiveMutations(
  api: GeogebraLiveMutationApi,
  onMutation: (event: GeogebraLiveMutationEvent) => void,
): GeogebraLiveMutationSubscription {
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const add: AddRemoveUpdateListener = (name) => onMutation({ kind: 'add', objectNames: [name] });
  const remove: AddRemoveUpdateListener = (name) => onMutation({ kind: 'remove', objectNames: [name] });
  const update: AddRemoveUpdateListener = (name) => onMutation({ kind: 'update', objectNames: [name] });
  const rename: RenameListener = (oldName, newName) => onMutation({
    kind: 'rename',
    objectNames: [oldName, newName],
  });
  const clear: ClearListener = () => {
    onMutation({ kind: 'clear', objectNames: [] });
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 0);
  };
  const client: ClientListener = (event) => {
    if (clientEventType(event) === 'dragEnd') {
      onMutation({ kind: 'drag-end', objectNames: [] });
    }
  };

  const unregister = () => {
    try { api.unregisterAddListener?.(add); } catch { /* older bundle */ }
    try { api.unregisterRemoveListener?.(remove); } catch { /* older bundle */ }
    try { api.unregisterUpdateListener?.(update); } catch { /* older bundle */ }
    try { api.unregisterRenameListener?.(rename); } catch { /* older bundle */ }
    try { api.unregisterClearListener?.(clear); } catch { /* older bundle */ }
    try { api.unregisterClientListener?.(client); } catch { /* older bundle */ }
  };
  const register = () => {
    try { api.registerAddListener?.(add); } catch { /* older bundle */ }
    try { api.registerRemoveListener?.(remove); } catch { /* older bundle */ }
    try { api.registerUpdateListener?.(update); } catch { /* older bundle */ }
    try { api.registerRenameListener?.(rename); } catch { /* older bundle */ }
    try { api.registerClearListener?.(clear); } catch { /* older bundle */ }
    try { api.registerClientListener?.(client); } catch { /* older bundle */ }
  };
  const refresh = () => {
    if (disposed) return;
    unregister();
    register();
  };
  register();
  return {
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unregister();
    },
  };
}
