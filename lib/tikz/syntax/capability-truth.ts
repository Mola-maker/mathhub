import type {
  TikzCapabilityLaneTruth,
  TikzCapabilityTruth,
  TikzLibraryName,
  TikzSyntaxCapability,
} from './types';
import exactProfile from './exact-profile.json';

/** Libraries explicitly loaded and exercised by the pinned exact wrapper. */
export const VERIFIED_EXACT_TIKZ_LIBRARIES = new Set<TikzLibraryName>([
  ...exactProfile.verifiedLibraries as TikzLibraryName[],
]);

function lane(
  status: TikzCapabilityLaneTruth['status'],
  reason: string,
  ...evidence: string[]
): TikzCapabilityLaneTruth {
  return { status, reason, evidence };
}

function exactTruth(entry: TikzSyntaxCapability): TikzCapabilityLaneTruth {
  const tags = new Set(entry.securityRisk.tags);
  if (
    tags.has('file-io')
    || tags.has('shell-escape')
    || tags.has('network-reference')
    || tags.has('external-process')
  ) {
    return lane(
      'blocked',
      'The isolated compiler policy forbids this external I/O or process surface.',
      'compiler-policy:no-shell-escape',
      'compiler-policy:no-file-io',
    );
  }
  if (tags.has('lua-runtime')) {
    return lane(
      'blocked',
      'The current exact profile preserves graph syntax but deliberately does not execute Lua graph-drawing algorithms.',
      `compiler-profile:${exactProfile.profile}`,
      `compiler-runtime:graph-drawing-${exactProfile.runtimeCapabilities.graphDrawing}`,
      `compiler-profile-required:${exactProfile.requiredCompanionProfiles.luaGraphDrawing}`,
    );
  }
  if (entry.recognition === 'driver') {
    return lane(
      'conditional',
      'Output depends on a driver capability that is not verified by the current profile.',
      'compiler-profile:driver-dependent',
    );
  }
  if (
    entry.library
    && entry.library !== 'core'
    && !VERIFIED_EXACT_TIKZ_LIBRARIES.has(entry.library)
  ) {
    return lane(
      'conditional',
      'The official library is preserved, but this pinned compiler profile has no fixture proving it yet.',
      'compiler-profile:unprobed-library',
    );
  }
  return lane(
    'verified',
    'The construct belongs to the pinned isolated Tectonic+dvisvgm profile.',
    `compiler-profile:${exactProfile.profile}`,
    `compiler-engine:${exactProfile.runtimeCapabilities.texEngine}`,
    'compiler-attestation:source-digest',
  );
}

/**
 * Convert broad manual-chapter declarations into product truth.
 *
 * Manual chapters are wider than our interactive subset, so a declaration of
 * semantic/interactive support is intentionally projected as partial. PGF
 * basic/system macros remain preserve/exact surfaces and are never advertised
 * as editable Canvas objects.
 */
export function capabilityTruthFor(
  entry: Omit<TikzSyntaxCapability, 'truth'>,
): TikzCapabilityTruth {
  const lowerLayer = entry.layer === 'basic-layer' || entry.layer === 'system-layer';
  return {
    preserve: lane(
      'verified',
      'Source text and opaque statements remain byte-preserved across typed transactions.',
      'lossless-cst',
      'opaque-source-barrier',
    ),
    syntax: entry.recognition === 'static'
      ? lane(
        'verified',
        'The pinned catalog can classify this official surface without executing TeX.',
        'pgf-3.1.11a-catalog',
      )
      : lane(
        'partial',
        'The outer surface is classified, while TeX expansion or driver behavior stays opaque.',
        'pgf-3.1.11a-catalog',
        'dynamic-expansion-barrier',
      ),
    semantic: entry.capabilities.semantic && !lowerLayer
      ? lane(
        'partial',
        'A typed subset is projected into GeometryDoc; the full manual chapter is broader.',
        'tikz-subset-parser',
        'geometry-doc-adapter',
      )
      : lane(
        'blocked',
        'No GeometryDoc adapter claims semantic understanding for this complete surface.',
        'opaque-semantic-node',
      ),
    interactive: entry.capabilities.interactive && !lowerLayer
      ? lane(
        'partial',
        'Supported entities have renderer, hit-test and writer plugins; unsupported forms stay read-only.',
        'render-primitive-plugin',
        'broker-replayed-writer',
      )
      : lane(
        'blocked',
        'No reversible Canvas writer exists for this complete surface.',
        'writeback-policy:never',
      ),
    exact: exactTruth(entry as TikzSyntaxCapability),
  };
}

export function withCapabilityTruth(
  entry: Omit<TikzSyntaxCapability, 'truth'>,
): TikzSyntaxCapability {
  const truth = capabilityTruthFor(entry);
  return {
    ...entry,
    truth,
    capabilities: {
      preserve: truth.preserve.status === 'verified',
      syntax: truth.syntax.status === 'verified' || truth.syntax.status === 'partial',
      semantic: truth.semantic.status === 'verified' || truth.semantic.status === 'partial',
      interactive:
        truth.interactive.status === 'verified' || truth.interactive.status === 'partial',
      exact: truth.exact.status === 'verified',
    },
  };
}
