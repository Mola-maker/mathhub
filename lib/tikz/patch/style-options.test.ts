import { describe, expect, it } from 'vitest';
import { buildOptionsRaw, styleDraftFromRaw, type StyleDraft } from './style-options';

describe('style options', () => {
  it('从草稿组装 options 原文并省略默认值', () => {
    const draft: StyleDraft = {
      color: 'red',
      width: 'thick',
      dash: null,
      arrow: '<->',
      fill: false,
      opacity: null,
    };
    expect(buildOptionsRaw(draft)).toBe('red,thick,<->');
  });

  it('组装填充与透明度', () => {
    expect(buildOptionsRaw({
      color: 'blue',
      width: null,
      dash: 'dashed',
      arrow: null,
      fill: true,
      opacity: 0.3,
    })).toBe('blue,dashed,fill=blue,fill opacity=0.3');
  });

  it('从现有 options 恢复可编辑草稿', () => {
    expect(styleDraftFromRaw('red,very thick,dotted,->,fill=red,fill opacity=0.4'))
      .toEqual({
        color: 'red',
        width: 'very thick',
        dash: 'dotted',
        arrow: '->',
        fill: true,
        opacity: 0.4,
      });
  });
});
