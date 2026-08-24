import { PGF_TIKZ_VERSION } from './types';

/**
 * Research observation, not a capability claim.  The exact compiler and
 * generated catalog remain pinned until every migration gate is evidenced.
 */
export const PGF_TIKZ_UPSTREAM_AUDIT_2026_08_23 = {
  schemaVersion: 'pgf-tikz-upstream-audit/v1',
  observedAt: '2026-08-23',
  supportedBaseline: PGF_TIKZ_VERSION,
  latestObservedRelease: '3.1.12',
  latestReleaseUrl: 'https://github.com/pgf-tikz/pgf/releases/tag/3.1.12',
  status: 'migration-required',
  compatibilityNotes: [
    'PGF/TikZ 3.1.12 requires TeX support for braced input syntax from Web2C 2020 or newer.',
    'The upstream release changes bp-to-pt scaling precision and therefore exact PDF literals.',
    'Lua graph drawing remains a separate LuaTeX-capable compiler profile.',
  ],
  migrationGates: [
    'pin-release-commit-and-source-digest',
    'regenerate-capability-registry-and-shards',
    'verify-engine-and-web2c-minimums',
    'run-upstream-manual-example-suite-in-isolation',
    'refresh-exact-profile-and-container-digests',
    'run-interactive-exact-differential-fixtures',
  ],
} as const;
