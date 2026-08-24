import { describe, expect, it } from 'vitest';
import {
  exactTikzRenderItemOwnsBasis,
  sameExactTikzRenderBasis,
  type ExactTikzRenderBasis,
} from './use-exact-tikz-render';

const basis: ExactTikzRenderBasis = {
  documentId: 'document-1',
  epoch: 'epoch-1',
  sourceId: 'document-1:tikz',
  revision: 7,
  sourceHash: '0123456789abcdef',
  pluginSetDigest: 'plugin-set-1',
};

describe('sameExactTikzRenderBasis', () => {
  it('requires document, epoch, source, revision, hash, and plugin set identity', () => {
    expect(sameExactTikzRenderBasis(basis, { ...basis })).toBe(true);
    expect(sameExactTikzRenderBasis(basis, { ...basis, revision: 8 })).toBe(false);
    expect(sameExactTikzRenderBasis(basis, {
      ...basis,
      sourceHash: 'fedcba9876543210',
    })).toBe(false);
    expect(sameExactTikzRenderBasis(basis, { ...basis, epoch: 'epoch-2' })).toBe(false);
    expect(sameExactTikzRenderBasis(basis, {
      ...basis,
      pluginSetDigest: 'plugin-set-2',
    })).toBe(false);
  });

  it('rejects a late artifact when either item identity or revision basis changed', () => {
    expect(exactTikzRenderItemOwnsBasis('exact:1', 'exact:1', basis, basis)).toBe(true);
    expect(exactTikzRenderItemOwnsBasis('exact:2', 'exact:1', basis, basis)).toBe(false);
    expect(exactTikzRenderItemOwnsBasis(
      'exact:1',
      'exact:1',
      basis,
      { ...basis, revision: 8 },
    )).toBe(false);
  });
});
