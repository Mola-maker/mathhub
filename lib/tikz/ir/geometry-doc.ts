import type {
  ConstructionTruth,
  GeometryRevisionBasis,
  GeometryTruthSet,
  RenderingTruth,
  SemanticTruth,
} from './model';
import {
  buildGeometrySourceMap,
  type GeometrySourceMap,
  type GeometrySourceMapEntry,
} from './source-map';
import { hashSource } from '../document/source-hash';

export const GEOMETRY_DOC_SCHEMA_VERSION = 'geometry-doc/v1' as const;

export type GeometryDocReadonly<T> =
  T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends (...arguments_: never[]) => unknown
      ? T
      : T extends readonly (infer Item)[]
        ? readonly GeometryDocReadonly<Item>[]
        : { readonly [Key in keyof T]: GeometryDocReadonly<T[Key]> };

/**
 * Revision-bound read model shared by AI, Code and Canvas.
 *
 * This object owns no mutable document state. TikZ source remains the sole
 * persistent truth and every write still enters through a source transaction.
 */
export interface GeometryDoc {
  readonly schemaVersion: typeof GEOMETRY_DOC_SCHEMA_VERSION;
  readonly basis: GeometryDocReadonly<GeometryRevisionBasis>;
  readonly semantic: GeometryDocReadonly<SemanticTruth>;
  readonly construction: GeometryDocReadonly<ConstructionTruth>;
  readonly rendering: GeometryDocReadonly<readonly RenderingTruth[]>;
  readonly sourceMap: GeometryDocReadonly<GeometrySourceMap>;
}

const BASIS_KEYS = [
  'documentId',
  'epoch',
  'revision',
  'sourceHash',
  'kernelHash',
  'projectionHash',
  'pluginSetDigest',
  'sourceId',
] as const satisfies readonly (keyof GeometryRevisionBasis)[];

export function sameGeometryRevisionBasis(
  left: GeometryRevisionBasis,
  right: GeometryRevisionBasis,
): boolean {
  return BASIS_KEYS.every((key) => left[key] === right[key]);
}

function assertSameBasis(
  expected: GeometryRevisionBasis,
  actual: GeometryRevisionBasis,
  lane: string,
): void {
  if (!sameGeometryRevisionBasis(expected, actual)) {
    throw new TypeError(`GeometryDoc ${lane} does not share the semantic revision basis.`);
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameSourceMapEntry(
  actual: GeometrySourceMapEntry,
  expected: GeometrySourceMapEntry,
): boolean {
  return actual.bindingId === expected.bindingId
    && actual.sourceId === expected.sourceId
    && actual.range.start === expected.range.start
    && actual.range.end === expected.range.end
    && actual.writable === expected.writable
    && actual.semanticTargets.length === expected.semanticTargets.length
    && actual.semanticTargets.every((target, index) => (
      target.recordType === expected.semanticTargets[index]?.recordType
      && target.id === expected.semanticTargets[index]?.id
    ))
    && sameStringList(actual.entityIds, expected.entityIds)
    && actual.renderTargets.length === expected.renderTargets.length
    && actual.renderTargets.every((target, index) => {
      const expectedTarget = expected.renderTargets[index];
      if (!expectedTarget) return false;
      return target.rendererId === expectedTarget.rendererId
        && target.target === expectedTarget.target
        && target.renderRevision === expectedTarget.renderRevision
        && sameStringList(target.primitiveIds, expectedTarget.primitiveIds);
    });
}

/** Compose existing truth lanes without copying or reinterpreting their data. */
export function createGeometryDoc(
  truths: GeometryTruthSet,
  sourceMap: GeometrySourceMap,
): GeometryDoc {
  const basis = truths.semantic.basis;
  assertSameBasis(basis, truths.construction.basis, 'construction truth');
  assertSameBasis(basis, sourceMap.basis, 'source map');
  if (!basis.sourceId) {
    throw new TypeError('GeometryDoc requires a primary sourceId in its revision basis.');
  }
  const primarySources = truths.construction.sources.filter((source) => (
    source.sourceId === basis.sourceId
  ));
  if (
    primarySources.length !== 1
    || primarySources[0]!.revision !== basis.revision
    || primarySources[0]!.hash !== basis.sourceHash
  ) {
    throw new TypeError('GeometryDoc construction truth is not bound to the primary source revision.');
  }
  const sourcesById = new Map(
    truths.construction.sources.map((source) => [source.sourceId, source] as const),
  );
  if (sourcesById.size !== truths.construction.sources.length) {
    throw new TypeError('GeometryDoc construction truth contains duplicate source IDs.');
  }
  for (const source of truths.construction.sources) {
    if (
      (source.length !== undefined && source.length !== source.text.length)
      || (
        source.hashAlgorithm === 'fnv1a64-utf8'
        && hashSource(source.text) !== source.hash
      )
    ) {
      throw new TypeError(`GeometryDoc source ${source.sourceId} has detached text or length.`);
    }
  }
  const bindingsById = new Map(
    truths.construction.bindings.map((binding) => [binding.id, binding] as const),
  );
  if (bindingsById.size !== truths.construction.bindings.length) {
    throw new TypeError('GeometryDoc construction truth contains duplicate binding IDs.');
  }
  for (const binding of truths.construction.bindings) {
    const source = sourcesById.get(binding.source.document.sourceId);
    if (
      !source
      || binding.source.document.revision !== source.revision
      || binding.source.document.hash !== source.hash
      || binding.source.document.hashAlgorithm !== source.hashAlgorithm
      || binding.source.document.offsetUnit !== source.offsetUnit
      || binding.source.document.languageId !== source.languageId
      || binding.source.document.encoding !== source.encoding
      || binding.source.document.length !== source.length
      || binding.source.range.start < 0
      || binding.source.range.end < binding.source.range.start
      || binding.source.range.end > source.text.length
      || source.text.slice(binding.source.range.start, binding.source.range.end)
        !== binding.source.verbatim
    ) {
      throw new TypeError(`GeometryDoc binding ${binding.id} is detached from its source snapshot.`);
    }
  }
  const expectedSourceMap = buildGeometrySourceMap(truths);
  const sourceMapEntryIds = new Set(sourceMap.entries.map((entry) => entry.id));
  const sourceMapBindingIds = new Set(sourceMap.entries.map((entry) => entry.bindingId));
  if (
    sourceMap.entries.length !== truths.construction.bindings.length
    || sourceMapEntryIds.size !== sourceMap.entries.length
    || sourceMapBindingIds.size !== sourceMap.entries.length
    || sourceMap.entries.some((entry, index) => (
      !bindingsById.has(entry.bindingId)
      || !expectedSourceMap.entries[index]
      || !sameSourceMapEntry(entry, expectedSourceMap.entries[index]!)
    ))
  ) {
    throw new TypeError('GeometryDoc source map does not match its construction bindings.');
  }
  const renderingByTarget = new Map<string, RenderingTruth>();
  truths.rendering.forEach((rendering, index) => {
    assertSameBasis(basis, rendering.basis, `rendering truth ${index}`);
    if (rendering.renderRevision !== basis.revision) {
      throw new TypeError(`GeometryDoc rendering truth ${index} has a stale render revision.`);
    }
    const key = `${rendering.rendererId}\u0000${rendering.target}`;
    if (renderingByTarget.has(key)) {
      throw new TypeError(`GeometryDoc rendering truth ${index} duplicates a render target.`);
    }
    renderingByTarget.set(key, rendering);
  });
  sourceMap.entries.forEach((entry) => {
    entry.renderTargets.forEach((target) => {
      const rendering = renderingByTarget.get(`${target.rendererId}\u0000${target.target}`);
      const primitiveIds = new Set(rendering?.primitives.map((primitive) => primitive.id));
      if (
        !rendering
        || target.renderRevision !== basis.revision
        || target.renderRevision !== rendering.renderRevision
        || target.primitiveIds.some((primitiveId) => !primitiveIds.has(primitiveId))
      ) {
        throw new TypeError(
          `GeometryDoc source-map entry ${entry.id} has a stale or unresolved render target.`,
        );
      }
    });
  });
  return {
    schemaVersion: GEOMETRY_DOC_SCHEMA_VERSION,
    basis,
    semantic: truths.semantic,
    construction: truths.construction,
    rendering: truths.rendering,
    sourceMap,
  };
}
