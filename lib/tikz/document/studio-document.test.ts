import { describe, expect, it, vi } from 'vitest';
import {
  MAX_STUDIO_TRANSACTION_RECORDS,
  StudioDocument,
  applyTextPatch,
  minimalTextPatch,
} from './studio-document';

describe('StudioDocument', () => {
  it('无编辑器时提交 revision-bound 最小补丁', () => {
    const document = new StudioDocument('abc');
    expect(document.replaceSource('axc', 'repair')).toBe(true);
    expect(document.getSnapshot()).toMatchObject({
      source: 'axc',
      revision: 1,
      lastTransaction: {
        fromRevision: 0,
        toRevision: 1,
        origin: 'repair',
        patches: [{ from: 1, to: 2, insert: 'x' }],
      },
    });
  });

  it('有编辑器时外部写入只派发 transaction，由 editor commit 成为事实', () => {
    const document = new StudioDocument('abc');
    const dispatch = vi.fn();
    document.attachEditor(dispatch);

    expect(document.applyPatch({ from: 1, to: 2, insert: 'x' }, 'canvas', 0)).toBe(true);
    expect(document.getSnapshot().source).toBe('abc');
    expect(dispatch).toHaveBeenCalledOnce();

    document.commitFromEditor('axc', 'canvas', [1, 1, 1]);
    expect(document.getSnapshot()).toMatchObject({
      source: 'axc',
      revision: 1,
      lastTransaction: { origin: 'canvas' },
    });
  });

  it('拒绝基于陈旧 revision 的画布写回', () => {
    const document = new StudioDocument('abc');
    document.replaceSource('abcd', 'keyboard');
    expect(document.applyPatch({ from: 0, to: 1, insert: 'x' }, 'canvas', 0)).toBe(false);
    expect(document.getSnapshot().source).toBe('abcd');
  });

  it('emits one bounded lifecycle event only after source truth commits', () => {
    const document = new StudioDocument('abc', {
      documentId: 'event-document',
      epoch: 'event-epoch',
    });
    const changes = vi.fn();
    document.subscribeChanges(changes);

    document.setCstTree({} as never, 0);
    expect(changes).not.toHaveBeenCalled();
    expect(document.applyPatch(
      { from: 1, to: 2, insert: 'xyz' },
      'ai',
      0,
      {
        transactionId: 'event-transaction',
        idempotencyKey: 'event-key',
        requestFingerprint: 'event-fingerprint',
      },
    )).toBe(true);

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith({
      schemaVersion: 'tikz-studio-document-change/v1',
      documentId: 'event-document',
      epoch: 'event-epoch',
      transactionId: 'event-transaction',
      idempotencyKey: 'event-key',
      fromRevision: 0,
      toRevision: 1,
      origin: 'ai',
      motionHint: 'update',
      sourceLengthBefore: 3,
      sourceLengthAfter: 5,
      patches: [{ from: 1, to: 2, insertLength: 3 }],
      changedRangesAfter: [{ start: 1, end: 4 }],
    });
    expect(JSON.stringify(changes.mock.calls[0]?.[0])).not.toContain('xyz');
  });

  it('bounds the hot journal while retaining idempotency tombstones', () => {
    const document = new StudioDocument('');
    for (let index = 0; index < MAX_STUDIO_TRANSACTION_RECORDS + 12; index += 1) {
      const revision = document.getSnapshot().revision;
      expect(document.applyPatch(
        { from: revision, to: revision, insert: 'x' },
        'external',
        revision,
        {
          idempotencyKey: `bounded-${index}`,
          requestFingerprint: `fingerprint-${index}`,
        },
      )).toBe(true);
    }

    expect(document.getTransactionsSince(0)).toHaveLength(MAX_STUDIO_TRANSACTION_RECORDS);
    expect(document.hasAppliedIdempotencyKey('bounded-0')).toBe(true);
    const revision = document.getSnapshot().revision;
    expect(document.applyPatch(
      { from: 0, to: 0, insert: 'duplicate' },
      'external',
      revision,
      {
        idempotencyKey: 'bounded-0',
        requestFingerprint: 'fingerprint-0',
      },
    )).toBe(true);
    expect(document.getSnapshot().revision).toBe(revision);
  });
});

describe('text patch helpers', () => {
  it('计算单段最小差异并只修改目标区间', () => {
    const patch = minimalTextPatch('hello world!', 'hello TikZ!');
    expect(patch).toEqual({ from: 6, to: 11, insert: 'TikZ' });
    expect(applyTextPatch('hello world!', patch!)).toBe('hello TikZ!');
  });
});
