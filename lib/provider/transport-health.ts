export const PROVIDER_TRANSPORT_HEALTH_SCHEMA_VERSION =
  'provider-transport-health/v1' as const;

const FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 30_000;

interface ProviderTransportFailureState {
  readonly consecutiveFailures: number;
  readonly lastFailureAt: number;
  readonly openUntil: number | null;
}

type ProviderTransportRuntime = typeof globalThis & {
  __mathGeoHubProviderTransportFailures?: Map<string, ProviderTransportFailureState>;
};

export interface ProviderTransportGate {
  readonly schemaVersion: typeof PROVIDER_TRANSPORT_HEALTH_SCHEMA_VERSION;
  readonly origin: string;
  readonly status: 'closed' | 'open';
  readonly consecutiveFailures: number;
  readonly retryAfterMs: number;
}

const runtime = globalThis as ProviderTransportRuntime;
const failures = runtime.__mathGeoHubProviderTransportFailures ?? new Map();
runtime.__mathGeoHubProviderTransportFailures = failures;

function providerOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.trim().replace(/\/+$/u, '');
  }
}

export function providerTransportGate(
  baseUrl: string,
  now = Date.now(),
): ProviderTransportGate {
  const origin = providerOrigin(baseUrl);
  const failure = failures.get(origin);
  if (!failure) {
    return {
      schemaVersion: PROVIDER_TRANSPORT_HEALTH_SCHEMA_VERSION,
      origin,
      status: 'closed',
      consecutiveFailures: 0,
      retryAfterMs: 0,
    };
  }
  if (failure.openUntil !== null && failure.openUntil <= now) {
    failures.delete(origin);
    return {
      schemaVersion: PROVIDER_TRANSPORT_HEALTH_SCHEMA_VERSION,
      origin,
      status: 'closed',
      consecutiveFailures: 0,
      retryAfterMs: 0,
    };
  }
  const retryAfterMs = failure.openUntil === null
    ? 0
    : Math.max(1, failure.openUntil - now);
  return {
    schemaVersion: PROVIDER_TRANSPORT_HEALTH_SCHEMA_VERSION,
    origin,
    status: retryAfterMs > 0 ? 'open' : 'closed',
    consecutiveFailures: failure.consecutiveFailures,
    retryAfterMs,
  };
}

/** Record only DNS/TCP/TLS/timeout failures. HTTP/model errors prove reachability. */
export function recordProviderTransportFailure(
  baseUrl: string,
  now = Date.now(),
): ProviderTransportGate {
  const origin = providerOrigin(baseUrl);
  const previous = failures.get(origin);
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  failures.set(origin, {
    consecutiveFailures,
    lastFailureAt: now,
    openUntil: consecutiveFailures >= FAILURE_THRESHOLD
      ? now + COOLDOWN_MS
      : null,
  });
  return providerTransportGate(baseUrl, now);
}

export function recordProviderTransportSuccess(baseUrl: string): void {
  failures.delete(providerOrigin(baseUrl));
}

/** Explicit reset is useful for provider configuration changes and isolated tests. */
export function resetProviderTransportHealth(baseUrl?: string): void {
  if (baseUrl) failures.delete(providerOrigin(baseUrl));
  else failures.clear();
}
