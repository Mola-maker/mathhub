import { afterEach, describe, expect, it } from 'vitest';
import {
  providerTransportGate,
  recordProviderTransportFailure,
  recordProviderTransportSuccess,
  resetProviderTransportHealth,
} from './transport-health';

const relay = 'https://api.molamaker.cn/v1';

afterEach(() => resetProviderTransportHealth());

describe('provider transport health', () => {
  it('opens only after consecutive transport failures and automatically probes later', () => {
    expect(recordProviderTransportFailure(relay, 1_000)).toMatchObject({
      status: 'closed',
      consecutiveFailures: 1,
    });
    expect(recordProviderTransportFailure(relay, 2_000)).toMatchObject({
      status: 'open',
      consecutiveFailures: 2,
      retryAfterMs: 30_000,
    });
    expect(providerTransportGate('https://api.molamaker.cn', 20_000)).toMatchObject({
      status: 'open',
      retryAfterMs: 12_000,
    });
    expect(providerTransportGate(relay, 32_000)).toMatchObject({
      status: 'closed',
      consecutiveFailures: 0,
    });
  });

  it('closes immediately after any HTTP response proves transport reachability', () => {
    recordProviderTransportFailure(relay, 1_000);
    recordProviderTransportFailure(relay, 2_000);
    recordProviderTransportSuccess(relay);
    expect(providerTransportGate(relay, 2_001)).toMatchObject({
      status: 'closed',
      consecutiveFailures: 0,
    });
  });
});
