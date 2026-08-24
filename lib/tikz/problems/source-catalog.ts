/**
 * The problem gateway is deliberately narrower than a generic web importer.
 * This catalog is the admission policy for geometry sources: a source may be
 * searchable or usable as a local test fixture only when its provenance and
 * rights posture are explicit.  It does not grant permission to redistribute
 * source material, and it never makes a remote source writable.
 */

export const GEOMETRY_PROBLEM_SOURCE_IDS = [
  'mathnet',
  'olympiadbench',
  'geometry3k',
  'geoqa',
  'unigeo',
  'leaneuclid',
  'formalgeo',
] as const;

export type GeometryProblemSourceId = typeof GEOMETRY_PROBLEM_SOURCE_IDS[number];

export type GeometryProblemSourceAccessMode =
  | 'live-search'
  | 'registry-only'
  | 'restricted-opt-in';

export type GeometryProblemSourceTestRole =
  | 'live-search-smoke'
  | 'registry-fixture'
  | 'formal-proof-fixture'
  | 'restricted-license-gate';

export type GeometryProblemLicenseId =
  | 'CC-BY-4.0'
  | 'Apache-2.0'
  | 'MIT'
  | 'GPL-3.0'
  | 'unknown';

export interface GeometryProblemLicenseDeclaration {
  readonly id: GeometryProblemLicenseId;
  readonly label: string;
  readonly basis: 'dataset-card' | 'repository' | 'unknown';
  readonly url?: string;
  readonly note?: string;
}

export type GeometryProblemSourceMaterialRights =
  | 'allowed'
  | 'conditional'
  | 'review-required'
  | 'blocked'
  | 'unknown';

export type GeometryProblemUsageDecision =
  | 'allowed'
  | 'review-required'
  | 'blocked';

export interface GeometryProblemSourceDescriptor {
  readonly id: GeometryProblemSourceId;
  readonly label: string;
  /** Maintainer or project landing page, not a mirror or search result. */
  readonly projectUrl: string;
  /** Dataset card, official download page, or official repository location. */
  readonly datasetUrl: string;
  readonly accessMode: GeometryProblemSourceAccessMode;
  readonly testRole: GeometryProblemSourceTestRole;
  readonly datasetLicense: GeometryProblemLicenseDeclaration;
  readonly codeLicense: GeometryProblemLicenseDeclaration;
  /** Rights in the underlying statements, diagrams, and derived annotations. */
  readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
  readonly redistribution: GeometryProblemUsageDecision;
  readonly commercial: GeometryProblemUsageDecision;
  readonly training: GeometryProblemUsageDecision;
  readonly note: string;
}

const UNKNOWN_LICENSE: GeometryProblemLicenseDeclaration = {
  id: 'unknown',
  label: 'Unknown — verify the upstream terms for the selected revision.',
  basis: 'unknown',
};

const REVIEW_ALL: Pick<
  GeometryProblemSourceDescriptor,
  'redistribution' | 'commercial' | 'training'
> = {
  redistribution: 'review-required',
  commercial: 'review-required',
  training: 'review-required',
};

/**
 * Closed by `satisfies`: adding an id to the union without adding a policy
 * entry is a compile-time error.  Keep this object read-only; adapters may
 * consult it but may not mutate the admission policy at runtime.
 */
export const GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP = Object.freeze({
  mathnet: {
    id: 'mathnet',
    label: 'MathNet',
    projectUrl: 'https://mathnet.mit.edu/index2.html',
    datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
    accessMode: 'live-search',
    testRole: 'live-search-smoke',
    datasetLicense: {
      id: 'CC-BY-4.0',
      label: 'Creative Commons Attribution 4.0 International',
      basis: 'dataset-card',
      url: 'https://huggingface.co/datasets/ShadenA/MathNet',
      note: 'The dataset card declares CC-BY-4.0; original competition rights may remain with their owners.',
    },
    codeLicense: UNKNOWN_LICENSE,
    sourceMaterialRights: 'conditional',
    ...REVIEW_ALL,
    note: 'Live search is limited to attributed references. Do not copy or redistribute the underlying competition text or diagrams without review.',
  },
  olympiadbench: {
    id: 'olympiadbench',
    label: 'OlympiadBench',
    projectUrl: 'https://github.com/OpenBMB/OlympiadBench',
    datasetUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
    accessMode: 'live-search',
    testRole: 'live-search-smoke',
    datasetLicense: {
      id: 'Apache-2.0',
      label: 'Apache License 2.0 (dataset card)',
      basis: 'dataset-card',
      url: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
      note: 'The card license does not by itself clear the rights in original competition questions or diagrams.',
    },
    codeLicense: {
      id: 'MIT',
      label: 'MIT License',
      basis: 'repository',
      url: 'https://github.com/OpenBMB/OlympiadBench',
    },
    sourceMaterialRights: 'review-required',
    ...REVIEW_ALL,
    note: 'Use remote rows as attributed, bounded references. Original question and image rights require separate review.',
  },
  geometry3k: {
    id: 'geometry3k',
    label: 'Geometry3K (Inter-GPS)',
    projectUrl: 'https://lupantech.github.io/inter-gps/',
    datasetUrl: 'https://lupantech.github.io/inter-gps/#dataset',
    accessMode: 'registry-only',
    testRole: 'registry-fixture',
    datasetLicense: UNKNOWN_LICENSE,
    codeLicense: UNKNOWN_LICENSE,
    sourceMaterialRights: 'review-required',
    ...REVIEW_ALL,
    note: 'Registry-only until the official dataset terms and diagram/text provenance are verified. Keep local fixtures independently authored or hash-only.',
  },
  geoqa: {
    id: 'geoqa',
    label: 'GeoQA',
    projectUrl: 'https://github.com/chen-judge/GeoQA',
    datasetUrl: 'https://github.com/chen-judge/GeoQA',
    accessMode: 'registry-only',
    testRole: 'registry-fixture',
    datasetLicense: UNKNOWN_LICENSE,
    codeLicense: UNKNOWN_LICENSE,
    sourceMaterialRights: 'review-required',
    ...REVIEW_ALL,
    note: 'Registry-only pending upstream dataset and diagram rights verification. The gateway must not infer permission from repository availability.',
  },
  unigeo: {
    id: 'unigeo',
    label: 'UniGeo',
    projectUrl: 'https://github.com/chen-judge/UniGeo',
    datasetUrl: 'https://github.com/chen-judge/UniGeo',
    accessMode: 'registry-only',
    testRole: 'registry-fixture',
    datasetLicense: UNKNOWN_LICENSE,
    codeLicense: UNKNOWN_LICENSE,
    sourceMaterialRights: 'review-required',
    ...REVIEW_ALL,
    note: 'Registry-only pending terms for the calculation/proving material and its source diagrams. Treat derived annotations as source-adjacent material.',
  },
  leaneuclid: {
    id: 'leaneuclid',
    label: 'LeanEuclid',
    projectUrl: 'https://github.com/loganrjmurphy/LeanEuclid',
    datasetUrl: 'https://github.com/loganrjmurphy/LeanEuclid',
    accessMode: 'registry-only',
    testRole: 'formal-proof-fixture',
    datasetLicense: UNKNOWN_LICENSE,
    codeLicense: {
      id: 'MIT',
      label: 'MIT License',
      basis: 'repository',
      url: 'https://github.com/loganrjmurphy/LeanEuclid',
    },
    sourceMaterialRights: 'review-required',
    ...REVIEW_ALL,
    note: 'The repository code is MIT, but the benchmark includes Euclid and derived UniGeo material; source-problem rights remain review-required.',
  },
  formalgeo: {
    id: 'formalgeo',
    label: 'FormalGeo',
    projectUrl: 'https://github.com/FormalGeo/FormalGeo',
    datasetUrl: 'https://github.com/FormalGeo/FormalGeo#datasets',
    accessMode: 'restricted-opt-in',
    testRole: 'restricted-license-gate',
    datasetLicense: UNKNOWN_LICENSE,
    codeLicense: {
      id: 'GPL-3.0',
      label: 'GNU General Public License v3.0 (current repository policy)',
      basis: 'repository',
      url: 'https://github.com/FormalGeo/FormalGeo',
      note: 'The upstream notice says releases before 2026-05-01 remain MIT; review the exact revision before use.',
    },
    sourceMaterialRights: 'review-required',
    redistribution: 'review-required',
    commercial: 'blocked',
    training: 'blocked',
    note: 'Disabled by default. An adapter must explicitly opt in, pin a revision, and accept the applicable GPL/non-commercial and dataset terms.',
  },
} satisfies Readonly<Record<GeometryProblemSourceId, GeometryProblemSourceDescriptor>>);

// `readonly` protects TypeScript callers only. Freeze the nested policy
// objects as well so a JavaScript adapter cannot loosen a decision at runtime.
for (const descriptor of Object.values(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP)) {
  Object.freeze(descriptor.datasetLicense);
  Object.freeze(descriptor.codeLicense);
  Object.freeze(descriptor);
}

export const GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS = Object.freeze(
  GEOMETRY_PROBLEM_SOURCE_IDS.map((id) => GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP[id]),
);

/** A short alias for consumers that treat the catalog as a list. */
export const GEOMETRY_PROBLEM_SOURCE_LIST = GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS;

export function isGeometryProblemSourceId(value: string): value is GeometryProblemSourceId {
  return (GEOMETRY_PROBLEM_SOURCE_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a source only through the closed catalog. Unknown ids fail loudly so
 * a typo can never silently select a less restrictive adapter or policy.
 */
export function getGeometryProblemSourceDescriptor(
  id: string,
): GeometryProblemSourceDescriptor {
  if (!isGeometryProblemSourceId(id)) {
    throw new Error(`Unknown geometry problem source: ${id}`);
  }
  return GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP[id];
}

/** Alias kept for callers that read the catalog as a source registry. */
export const getGeometryProblemSource = getGeometryProblemSourceDescriptor;
