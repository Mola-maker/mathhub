import { describe, expect, it } from 'vitest';
import { buildOptionsRaw, styleDraftFromRaw, type StyleDraft } from './style-options';

describe('style options', () => {
  it('从草稿组装 options 原文并省略默认值', () => {
    const draft: StyleDraft = {
      color: 'red',
      drawColor: null,
      drawEnabled: false,
      width: 'thick',
      dash: null,
      arrow: '<->',
      fill: false,
      fillColor: null,
      opacity: null,
      drawOpacity: null,
      textOpacity: null,
      lineCap: null,
      lineJoin: null,
      roundedCorners: null,
      doubleLine: false,
      rotate: null,
      scale: null,
    };
    expect(buildOptionsRaw(draft)).toBe('red,thick,<->');
  });

  it('组装填充与透明度', () => {
    expect(buildOptionsRaw({
      color: 'blue',
      drawColor: null,
      drawEnabled: false,
      width: null,
      dash: 'dashed',
      arrow: null,
      fill: true,
      fillColor: null,
      opacity: 0.3,
      drawOpacity: null,
      textOpacity: null,
      lineCap: null,
      lineJoin: null,
      roundedCorners: null,
      doubleLine: false,
      rotate: null,
      scale: null,
    })).toBe('blue,dashed,fill=blue,fill opacity=0.3');
  });

  it('从现有 options 恢复可编辑草稿', () => {
    expect(styleDraftFromRaw('red,very thick,dotted,->,fill=red,fill opacity=0.4'))
      .toEqual({
        color: 'red',
        drawColor: null,
        drawEnabled: false,
        width: 'very thick',
        dash: 'dotted',
        arrow: '->',
        fill: true,
        fillColor: 'red',
        opacity: 0.4,
        drawOpacity: null,
        textOpacity: null,
        lineCap: null,
        lineJoin: null,
        roundedCorners: null,
        doubleLine: false,
        rotate: null,
        scale: null,
      });
  });

  it('更新受管样式时保留 circle through、定位与字体等原始选项', () => {
    expect(buildOptionsRaw(
      {
        color: 'blue',
        drawColor: null,
        drawEnabled: false,
        width: 'thick',
        dash: null,
        arrow: null,
        fill: false,
        fillColor: null,
        opacity: null,
        drawOpacity: null,
        textOpacity: null,
        lineCap: null,
        lineJoin: null,
        roundedCorners: null,
        doubleLine: false,
        rotate: null,
        scale: null,
      },
      'draw,circle through=(D),above right,font=\\fontsize{8}{8},red',
      ['color', 'width'],
    )).toBe(
      'draw,circle through=(D),above right,font=\\fontsize{8}{8},blue,thick',
    );
  });

  it('round-trips advanced stroke, opacity, and transform options', () => {
    const raw = buildOptionsRaw({
      color: 'purple',
      drawColor: null,
      drawEnabled: false,
      width: 'thick',
      dash: null,
      arrow: null,
      fill: true,
      fillColor: 'orange',
      opacity: 0.25,
      drawOpacity: 0.8,
      textOpacity: 0.7,
      lineCap: 'round',
      lineJoin: 'bevel',
      roundedCorners: '3pt',
      doubleLine: true,
      rotate: 15,
      scale: 1.2,
    });
    expect(styleDraftFromRaw(raw)).toMatchObject({
      fillColor: 'orange',
      drawOpacity: 0.8,
      textOpacity: 0.7,
      lineCap: 'round',
      lineJoin: 'bevel',
      roundedCorners: '3pt',
      doubleLine: true,
      rotate: 15,
      scale: 1.2,
    });
  });

  it('understands canonical draw color and bare fill while preserving custom colors', () => {
    const draft = styleDraftFromRaw('draw=teal!70!black,fill,rounded corners');

    expect(draft.color).toBe('black');
    expect(draft.drawColor).toBe('teal!70!black');
    expect(draft.drawEnabled).toBe(true);
    expect(draft.fill).toBe(true);
    expect(draft.roundedCorners).toBe('2pt');
    expect(buildOptionsRaw(draft)).toContain('teal!70!black');
    expect(buildOptionsRaw(draft)).toContain('fill=teal!70!black');
  });

  it('preserves unrelated symbolic and spaced options during a targeted edit', () => {
    const existing = 'draw=none,fill = red,draw opacity=\\alpha,thick';
    const draft = styleDraftFromRaw(existing);

    expect(buildOptionsRaw(
      { ...draft, width: 'very thick' },
      existing,
      ['width'],
    )).toBe('draw=none,fill = red,draw opacity=\\alpha,very thick');
  });

  it('keeps draw and general color independent during a targeted stroke edit', () => {
    const existing = 'draw=red,color=blue,fill = red';
    const draft = styleDraftFromRaw(existing);

    expect(buildOptionsRaw(
      { ...draft, drawColor: 'green' },
      existing,
      ['drawColor'],
    )).toBe('draw=green,color=blue,fill = red');
  });

  it('preserves untouched separators and line breaks byte-for-byte', () => {
    const existing = '\n  draw = red,\n  color = blue,  thick,\n  custom/.style={x,y}\n';
    const draft = styleDraftFromRaw(existing);

    expect(buildOptionsRaw(
      { ...draft, width: 'very thick' },
      existing,
      ['width'],
    )).toBe(
      '\n  draw = red,\n  color = blue,  very thick,\n  custom/.style={x,y}\n',
    );
  });

  it('preserves nested pgfkeys mini-languages and duplicate dispatch order', () => {
    const existing = String.raw`red,postaction={decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}},red,thick`;
    const draft = styleDraftFromRaw(existing);

    expect(buildOptionsRaw(
      { ...draft, width: 'very thick' },
      existing,
      ['width'],
    )).toBe(
      String.raw`red,postaction={decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}},red,very thick`,
    );
  });

  it('updates an option after a comment without deleting the comment', () => {
    const existing = 'red,% keep this note\r\n  thick,postaction={decorate,x={1,2}}';
    const draft = styleDraftFromRaw(existing);

    expect(buildOptionsRaw(
      { ...draft, width: 'very thick' },
      existing,
      ['width'],
    )).toBe(
      'red,% keep this note\r\n  very thick,postaction={decorate,x={1,2}}',
    );
  });
});
