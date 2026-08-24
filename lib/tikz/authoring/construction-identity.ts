import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { nextPointName } from './source-builder';

const SAFE_TIKZ_NAME = /^[A-Za-z_][A-Za-z0-9:_-]*$/u;

export function isSafeTikzConstructionName(value: string): boolean {
  return value.length <= 128 && SAFE_TIKZ_NAME.test(value);
}

export interface ConstructionIdentityAllocators {
  readonly nextName: (prefix: string) => string;
  readonly nextConstructionId: (prefix: string) => string;
  readonly assertRequestedNamesConsumed: () => void;
}

export interface ConstructionIdentityAllocatorSession {
  /**
   * Create one step-local requested-name queue while retaining the document-wide
   * reserved name and managed-construction namespaces.
   */
  readonly forStep: (
    requestedNames?: readonly (string | undefined)[],
  ) => ConstructionIdentityAllocators;
}

export interface ConstructionIdentitySnapshot {
  readonly constructionIds: ReadonlySet<string>;
  readonly referenceMarkers: ReadonlySet<string>;
}

export interface ConstructionIdentityAllocatorInput {
  readonly source: string;
  readonly pointNames: Iterable<string>;
  readonly previewOnly?: boolean;
  readonly requestedNames?: readonly (string | undefined)[];
  readonly identitySnapshot?: ConstructionIdentitySnapshot;
}

function referencedConstructionMarkers(source: string): ReadonlySet<string> {
  const markers = new Set<string>();
  const pattern = /managed:([A-Za-z0-9:_.%-]+):/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const segments = match[1]!.split(':');
    for (let count = 1; count <= segments.length; count += 1) {
      markers.add(`managed:${segments.slice(0, count).join(':')}:`);
    }
  }
  return markers;
}

function referencedTikzNames(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  const parenthesized = /\(([A-Za-z_][A-Za-z0-9:_-]*)\)/gu;
  const namedPath = /\bname\s+path(?:\s+global)?\s*=\s*([A-Za-z_][A-Za-z0-9:_-]*)/gu;
  for (const pattern of [parenthesized, namedPath]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) names.add(match[1]!);
  }
  return names;
}

/** Cache the source-derived identity namespace once per authoring revision. */
export function createConstructionIdentitySnapshot(
  source: string,
): ConstructionIdentitySnapshot {
  return {
    constructionIds: new Set(
      parseManagedConstructionBlocks(source).map((block) => block.id),
    ),
    referenceMarkers: referencedConstructionMarkers(source),
  };
}

/**
 * Revision-local deterministic identity allocator shared by Canvas and AI.
 * It reserves both live managed block IDs and orphaned managed references, so
 * deleting a producer cannot make its durable identity available for takeover.
 */
export function createConstructionIdentityAllocatorSession(
  input: Omit<ConstructionIdentityAllocatorInput, 'requestedNames'>,
): ConstructionIdentityAllocatorSession {
  const identity = input.identitySnapshot
    ?? createConstructionIdentitySnapshot(input.source);
  const reservedNames = new Set([
    ...input.pointNames,
    ...referencedTikzNames(input.source),
  ]);
  const reservedConstructionIds = new Set(identity.constructionIds);
  const referenceMarkers = identity.referenceMarkers;
  const nextConstructionId = (prefix: string): string => {
    const candidatePrefix = input.previewOnly ? `preview-${prefix}` : prefix;
    const referenced = (candidate: string): boolean => (
      referenceMarkers.has(`managed:${candidate}:`)
    );
    if (
      !reservedConstructionIds.has(candidatePrefix)
      && (input.previewOnly || !referenced(candidatePrefix))
    ) {
      reservedConstructionIds.add(candidatePrefix);
      return candidatePrefix;
    }
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${candidatePrefix}-${index}`;
      if (
        !reservedConstructionIds.has(candidate)
        && (input.previewOnly || !referenced(candidate))
      ) {
        reservedConstructionIds.add(candidate);
        return candidate;
      }
    }
    throw new RangeError(`Unable to allocate construction identity for ${candidatePrefix}.`);
  };
  return {
    forStep: (stepRequestedNames = []) => {
      const requestedNames = [...stepRequestedNames];
      const definedRequestedNames = requestedNames.filter(
        (name): name is string => name !== undefined,
      );
      if (
        requestedNames.length > 32
        || definedRequestedNames.some((name) => !isSafeTikzConstructionName(name))
        || new Set(definedRequestedNames).size !== definedRequestedNames.length
      ) {
        throw new TypeError('Construction intent requestedNames must be unique TikZ-safe names.');
      }
      let requestedIndex = 0;
      const nextName = (prefix: string): string => {
        const requested = requestedNames[requestedIndex];
        if (requestedIndex < requestedNames.length) requestedIndex += 1;
        if (requested !== undefined) {
          if (reservedNames.has(requested)) {
            throw new TypeError(`Construction name ${requested} already exists in the current revision.`);
          }
          reservedNames.add(requested);
          return requested;
        }
        const name = nextPointName(reservedNames, prefix);
        reservedNames.add(name);
        return name;
      };
      return {
        nextName,
        nextConstructionId,
        assertRequestedNamesConsumed: () => {
          if (requestedIndex !== requestedNames.length) {
            throw new TypeError(
              `Construction intent supplied ${requestedNames.length - requestedIndex} unused requestedNames.`,
            );
          }
        },
      };
    },
  };
}

export function createConstructionIdentityAllocators(
  input: ConstructionIdentityAllocatorInput,
): ConstructionIdentityAllocators {
  return createConstructionIdentityAllocatorSession({
    source: input.source,
    pointNames: input.pointNames,
    ...(input.previewOnly === undefined ? {} : { previewOnly: input.previewOnly }),
    ...(input.identitySnapshot === undefined
      ? {}
      : { identitySnapshot: input.identitySnapshot }),
  }).forStep(input.requestedNames);
}
