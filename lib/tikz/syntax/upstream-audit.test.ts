import { describe, expect, it } from 'vitest';
import { PGF_TIKZ_VERSION } from './types';
import { PGF_TIKZ_UPSTREAM_AUDIT_2026_08_23 } from './upstream-audit';

describe('PGF/TikZ upstream migration audit', () => {
  it('does not present a newly observed upstream release as a verified compiler profile', () => {
    expect(PGF_TIKZ_UPSTREAM_AUDIT_2026_08_23).toMatchObject({
      supportedBaseline: PGF_TIKZ_VERSION,
      latestObservedRelease: '3.1.12',
      status: 'migration-required',
    });
    expect(PGF_TIKZ_UPSTREAM_AUDIT_2026_08_23.migrationGates.length)
      .toBeGreaterThanOrEqual(5);
  });
});
