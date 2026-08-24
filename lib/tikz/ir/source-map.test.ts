import { describe, expect, it } from 'vitest';
import type { GeometrySourceMap } from './source-map';
import { sourceBindingRangeMap } from './source-map';

const sourceMap = {
  schemaVersion: 'geometry-source-map/v1',
  basis: {
    documentId: 'doc',
    epoch: 'epoch',
    revision: 4,
    sourceHash: 'hash',
    sourceId: 'doc:tikz',
    pluginSetDigest: 'plugins',
  },
  entries: [{
    id: 'source-map:binding:point:A',
    bindingId: 'binding:point:A',
    sourceId: 'doc:tikz',
    range: { start: 20, end: 46 },
    writable: true,
    semanticTargets: [{ recordType: 'entity', id: 'point:A' }],
    entityIds: ['point:A'],
    renderTargets: [],
  }],
} satisfies GeometrySourceMap;

describe('sourceBindingRangeMap', () => {
  it('uses attested binding ids instead of UI Scene stable ids', () => {
    expect(sourceBindingRangeMap(sourceMap, 4).get('binding:point:A')).toEqual({
      start: 20,
      end: 46,
    });
    expect(sourceBindingRangeMap(sourceMap, 4).has('binding:tz_runtime_A')).toBe(false);
  });

  it('fails closed for a stale semantic revision', () => {
    expect(sourceBindingRangeMap(sourceMap, 5).size).toBe(0);
  });
});
