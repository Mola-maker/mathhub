import { describe, expect, it, vi } from 'vitest';
import {
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
});

describe('text patch helpers', () => {
  it('计算单段最小差异并只修改目标区间', () => {
    const patch = minimalTextPatch('hello world!', 'hello TikZ!');
    expect(patch).toEqual({ from: 6, to: 11, insert: 'TikZ' });
    expect(applyTextPatch('hello world!', patch!)).toBe('hello TikZ!');
  });
});
