import { describe, expect, it } from 'vitest';
import {
  createGeometryDoc,
  GEOMETRY_DOC_SCHEMA_VERSION,
  sameGeometryRevisionBasis,
} from './geometry-doc';
import {
  GEOMETRY_IR_SCHEMA_VERSION,
  type GeometryRevisionBasis,
  type GeometryTruthSet,
} from './model';
import {
  GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
  type GeometrySourceMap,
} from './source-map';
import { hashSource } from '../document/source-hash';

const SOURCE = '';
const BASIS: GeometryRevisionBasis = {
  documentId: 'doc-1',
  epoch: 'epoch-1',
  revision: 7,
  sourceHash: hashSource(SOURCE),
  sourceId: 'doc-1:tikz',
  pluginSetDigest: 'tikz-adapter@1',
};

function truthSet(basis: GeometryRevisionBasis = BASIS): GeometryTruthSet {
  return {
    semantic: {
      kind: 'semantic',
      basis,
      status: 'complete',
      ir: {
        schemaVersion: GEOMETRY_IR_SCHEMA_VERSION,
        entities: [],
        constraints: [],
        relations: [],
        styles: [],
        sourceBindings: [],
      },
      diagnostics: [],
    },
    construction: {
      kind: 'construction',
      basis,
      status: 'complete',
      sources: [{
        sourceId: 'doc-1:tikz',
        languageId: 'tikz',
        revision: basis.revision,
        hash: basis.sourceHash,
        hashAlgorithm: 'fnv1a64-utf8',
        offsetUnit: 'utf16-code-unit',
        length: SOURCE.length,
        text: SOURCE,
      }],
      bindings: [],
      opaqueNodes: [],
      diagnostics: [],
    },
    rendering: [{
      kind: 'rendering',
      basis,
      renderRevision: 7,
      rendererId: 'interactive-svg',
      target: 'svg',
      status: 'complete',
      primitives: [],
      artifacts: [],
      diagnostics: [],
    }],
  };
}

function sourceMap(basis: GeometryRevisionBasis = BASIS): GeometrySourceMap {
  return {
    schemaVersion: GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
    basis,
    entries: [],
  };
}

describe('GeometryDoc v1', () => {
  it('composes all read lanes over one revision basis', () => {
    const truths = truthSet();
    const map = sourceMap();
    const doc = createGeometryDoc(truths, map);

    expect(doc.schemaVersion).toBe(GEOMETRY_DOC_SCHEMA_VERSION);
    expect(doc.basis).toBe(BASIS);
    expect(doc.semantic).toBe(truths.semantic);
    expect(doc.construction).toBe(truths.construction);
    expect(doc.rendering).toBe(truths.rendering);
    expect(doc.sourceMap).toBe(map);
  });

  it('rejects a source map from another source revision', () => {
    const mismatched = { ...BASIS, revision: BASIS.revision + 1 };

    expect(() => createGeometryDoc(truthSet(), sourceMap(mismatched)))
      .toThrow(/source map does not share the semantic revision basis/u);
    expect(sameGeometryRevisionBasis(BASIS, mismatched)).toBe(false);
  });

  it('rejects a rendering lane from another plugin projection', () => {
    const truths = truthSet();
    const rendering = [{
      ...truths.rendering[0]!,
      basis: { ...BASIS, pluginSetDigest: 'other-plugin@1' },
    }];

    expect(() => createGeometryDoc({ ...truths, rendering }, sourceMap()))
      .toThrow(/rendering truth 0 does not share the semantic revision basis/u);
  });

  it('rejects stale rendering revisions and source-map render links', () => {
    const truths = truthSet();
    const staleRendering = [{
      ...truths.rendering[0]!,
      renderRevision: BASIS.revision - 1,
    }];
    expect(() => createGeometryDoc({ ...truths, rendering: staleRendering }, sourceMap()))
      .toThrow(/stale render revision/u);

    const staleMap: GeometrySourceMap = {
      ...sourceMap(),
      entries: [{
        id: 'source-map:binding-1',
        bindingId: 'binding-1',
        sourceId: 'doc-1:tikz',
        range: { start: 0, end: 1 },
        writable: false,
        semanticTargets: [],
        entityIds: [],
        renderTargets: [{
          rendererId: 'interactive-svg',
          target: 'svg',
          renderRevision: BASIS.revision - 1,
          primitiveIds: [],
        }],
      }],
    };
    expect(() => createGeometryDoc(truths, staleMap))
      .toThrow(/source map does not match its construction bindings/u);
  });
});
