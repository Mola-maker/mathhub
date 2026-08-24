import { createHash } from 'node:crypto';
import standardManifest from '@/lib/tikz/syntax/exact-profile.json';
import graphDrawingManifest from '@/lib/tikz/syntax/luatex-graphdrawing-profile.json';
import type { TikzExactCompilerProfileId } from './profile-selection';

export {
  isTikzExactCompilerProfileId,
  selectTikzExactCompilerProfile,
  TIKZ_EXACT_COMPILER_PROFILES,
  type TikzExactCompilerProfileId,
  type TikzExactProfileEvidence,
  type TikzExactProfileSelection,
} from './profile-selection';

export interface TikzExactCompilerProfile {
  readonly id: TikzExactCompilerProfileId;
  readonly sourcePolicy: 'tikz-untrusted-no-io/v1';
  readonly wrapperId: string;
  readonly bundleIdentityPrefix: string;
  readonly manifestDigest: string;
  readonly maxSvgBytes: number;
  readonly texEngine: 'tectonic' | 'lualatex';
}

type ExactManifest = {
  profile: TikzExactCompilerProfileId;
  sourcePolicy: 'tikz-untrusted-no-io/v1';
  wrapperId: string;
  bundleIdentityPrefix: string;
  maxSvgBytes: number;
  runtimeCapabilities: { texEngine: 'tectonic' | 'lualatex' };
};

function profileFromManifest(value: ExactManifest): TikzExactCompilerProfile {
  return Object.freeze({
    id: value.profile,
    sourcePolicy: value.sourcePolicy,
    wrapperId: value.wrapperId,
    bundleIdentityPrefix: value.bundleIdentityPrefix,
    manifestDigest: createHash('sha256')
      .update(JSON.stringify(value), 'utf8')
      .digest('hex'),
    maxSvgBytes: value.maxSvgBytes,
    texEngine: value.runtimeCapabilities.texEngine,
  });
}

const PROFILES: Readonly<Record<
  TikzExactCompilerProfileId,
  TikzExactCompilerProfile
>> = Object.freeze({
  'tikz-standard-v1': profileFromManifest(standardManifest as ExactManifest),
  'tikz-luatex-graphdrawing-v1': profileFromManifest(
    graphDrawingManifest as ExactManifest,
  ),
});

export function tikzExactCompilerProfile(
  id: TikzExactCompilerProfileId,
): TikzExactCompilerProfile {
  return PROFILES[id];
}
