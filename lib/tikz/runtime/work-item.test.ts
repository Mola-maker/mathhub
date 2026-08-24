import { describe, expect, it } from 'vitest';
import {
  canAdvanceTikzAsyncWorkItem,
  parseTikzAsyncWorkItem,
  sameTikzAsyncWorkBasis,
  tikzAsyncWorkItemOwnsBasis,
  type TikzAsyncWorkItem,
} from './work-item';

const basis = {
  documentId: 'document-1',
  epoch: 'epoch-1',
  sourceId: 'document-1:tikz',
  revision: 4,
  sourceHash: 'source-hash',
  pluginSetDigest: 'plugin-set',
  kernelHash: 'kernel-hash',
  projectionHash: 'projection-hash',
};

const running: TikzAsyncWorkItem<'visual-audit'> = {
  schemaVersion: 'tikz-async-work-item/v1',
  itemId: 'visual-audit:1',
  kind: 'visual-audit',
  basis,
  status: 'running',
  requestedAt: 1,
  updatedAt: 1,
  ownerRunId: 'run-1',
  ownerMessageId: 'assistant:1',
};

describe('TikzAsyncWorkItem', () => {
  it('binds asynchronous work to the complete source and semantic basis', () => {
    expect(sameTikzAsyncWorkBasis(basis, { ...basis })).toBe(true);
    expect(sameTikzAsyncWorkBasis(basis, { ...basis, revision: 5 })).toBe(false);
    expect(sameTikzAsyncWorkBasis(basis, {
      ...basis,
      projectionHash: 'other-projection',
    })).toBe(false);
    expect(tikzAsyncWorkItemOwnsBasis(
      running.itemId,
      running.itemId,
      basis,
      basis,
    )).toBe(true);
    expect(tikzAsyncWorkItemOwnsBasis(
      'visual-audit:2',
      running.itemId,
      basis,
      basis,
    )).toBe(false);
  });

  it('allows forward progress and rejects late or post-terminal regressions', () => {
    const ready: TikzAsyncWorkItem<'visual-audit'> = {
      ...running,
      status: 'ready',
      updatedAt: 2,
      completedAt: 2,
    };
    expect(canAdvanceTikzAsyncWorkItem(running, ready)).toBe(true);
    expect(canAdvanceTikzAsyncWorkItem(ready, {
      ...running,
      updatedAt: 3,
    })).toBe(false);
    expect(canAdvanceTikzAsyncWorkItem(running, {
      ...running,
      itemId: 'visual-audit:2',
      updatedAt: 2,
    })).toBe(false);
  });

  it('parses only bounded work items with a valid revision basis', () => {
    expect(parseTikzAsyncWorkItem(running, 'visual-audit')).toEqual(running);
    expect(parseTikzAsyncWorkItem({
      ...running,
      basis: { ...basis, revision: -1 },
    }, 'visual-audit')).toBeNull();
    expect(parseTikzAsyncWorkItem(running, 'exact-render')).toBeNull();
  });
});
