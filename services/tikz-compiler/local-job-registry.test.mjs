import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalJobRegistry } from './local-job-registry.mjs';

function job(status, completedAt, artifact = null) {
  return {
    public: {
      id: `${status}-${completedAt}`,
      status,
      ...(completedAt === undefined ? {} : { completedAt }),
    },
    artifact,
    artifactDigest: artifact ? 'digest' : null,
  };
}

describe('LocalJobRegistry', () => {
  it('deduplicates active/success jobs and makes failed jobs immediately retryable', () => {
    let now = 10_000;
    const registry = new LocalJobRegistry({ now: () => now });
    registry.set('queued', job('queued'));
    registry.set('success', job('succeeded', now, Buffer.from('svg')));
    registry.set('failed', job('failed', now));

    assert.equal(registry.getForSubmission('queued')?.public.status, 'queued');
    assert.equal(registry.getForSubmission('success')?.public.status, 'succeeded');
    assert.equal(registry.getForSubmission('failed'), null);
    assert.equal(registry.get('failed'), null);
  });

  it('expires terminal jobs without timers while preserving queued/running work', () => {
    let now = 1_000;
    const registry = new LocalJobRegistry({
      now: () => now,
      successTtlMs: 100,
      failedTtlMs: 20,
    });
    registry.set('success', job('succeeded', now, Buffer.alloc(1_024)));
    registry.set('failed', job('failed', now));
    registry.set('queued', job('queued'));
    registry.set('running', job('running'));

    now += 21;
    assert.equal(registry.get('failed'), null);
    assert.equal(registry.get('success')?.public.status, 'succeeded');
    now += 80;
    assert.equal(registry.get('success'), null);
    assert.equal(registry.get('queued')?.public.status, 'queued');
    assert.equal(registry.get('running')?.public.status, 'running');
  });

  it('evicts the oldest terminal artifact before refusing active-only capacity', () => {
    let now = 5_000;
    const registry = new LocalJobRegistry({ now: () => now, maxEntries: 2 });
    registry.set('old', job('succeeded', 4_000, Buffer.alloc(2_048)));
    registry.set('new', job('succeeded', 4_500, Buffer.alloc(2_048)));
    assert.equal(registry.set('queued', job('queued')), true);
    assert.equal(registry.get('old'), null);
    assert.equal(registry.get('new')?.public.status, 'succeeded');

    const activeOnly = new LocalJobRegistry({ now: () => now, maxEntries: 2 });
    activeOnly.set('q1', job('queued'));
    activeOnly.set('q2', job('running'));
    assert.equal(activeOnly.set('q3', job('queued')), false);
    assert.equal(activeOnly.size, 2);
  });
});
