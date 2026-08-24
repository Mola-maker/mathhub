import { describe, it, expect } from 'vitest';
import {
  resolveStyle,
  anchorFromRaw,
  isInteractivePresentationOption,
} from './style-resolver';

describe('resolveStyle', () => {
  it('颜色/线宽/虚线/箭头', () => {
    expect(resolveStyle('red,thick,dashed,->', 'draw')).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 1.063,
      dash: '3.985 3.985',
      arrow: '->',
    });
  });
  it('black!30 灰度与 fill 命令默认', () => {
    const s = resolveStyle('black!30', 'fill');
    expect(s.stroke).toBe('rgb(179,179,179)');
    expect(s.fill).toBe('rgb(179,179,179)');
    expect(s.fillOpacity).toBe(1);
  });
  it('line width=2pt 换算与 opacity', () => {
    expect(resolveStyle('line width=2pt,opacity=0.5', 'draw')).toMatchObject({ strokeWidth: 2.657, opacity: 0.5 });
  });
  it('path 命令不可见', () => {
    expect(resolveStyle(null, 'path').stroke).toBe('none');
  });
  it('锚点提取', () => {
    expect(anchorFromRaw('above right, red')).toBe('above right');
    expect(anchorFromRaw(null)).toBe('above');
  });
  it('does not split commas inside nested option values', () => {
    expect(resolveStyle('label={A,B},red,thick', 'draw')).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 1.063,
    });
  });
  it('interprets an option following a TeX comment', () => {
    expect(resolveStyle('red,% keep, comma\n thick', 'draw')).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 1.063,
    });
  });
  it('keeps draw, color, and fill semantics aligned with the inspector', () => {
    expect(resolveStyle('draw=red,fill', 'path')).toMatchObject({
      stroke: '#ff0000',
      fill: '#ff0000',
    });
    expect(resolveStyle('color=blue,fill', 'draw')).toMatchObject({
      stroke: '#0000ff',
      fill: '#0000ff',
    });
    expect(resolveStyle('draw=none,fill=red', 'draw')).toMatchObject({
      stroke: 'none',
      fill: '#ff0000',
    });
  });
  it('matches TikZ cap, join, miter, and custom dash defaults', () => {
    expect(resolveStyle(null, 'draw')).toMatchObject({
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      dashOffset: 0,
    });
    expect(resolveStyle(
      'line cap=rect,line join=bevel,miter limit=7,dash pattern=on 2pt off 3pt,dash phase=1pt',
      'draw',
    )).toMatchObject({
      lineCap: 'square',
      lineJoin: 'bevel',
      miterLimit: 7,
      dash: '2.657 3.985',
      dashOffset: 1.328,
    });
    expect(resolveStyle('dash=on 4pt off 1pt phase -0.5pt', 'draw')).toMatchObject({
      dash: '5.313 1.328',
      dashOffset: -0.664,
    });
  });
  it('only advertises structurally valid official stroke options as interactive', () => {
    expect(isInteractivePresentationOption('line cap=round')).toBe(true);
    expect(isInteractivePresentationOption('line join=miter')).toBe(true);
    expect(isInteractivePresentationOption('dash pattern=on 2pt off 3pt')).toBe(true);
    expect(isInteractivePresentationOption('dash=on 2pt off 3pt phase 1pt')).toBe(true);
    expect(isInteractivePresentationOption('dash pattern=off 2pt on 3pt')).toBe(false);
  });
  it('preserves the official arrows.meta tip family instead of flattening every arrow to a triangle', () => {
    expect(resolveStyle('->', 'draw')).toMatchObject({ arrow: '->', arrowTip: 'to' });
    expect(resolveStyle('->,>=Stealth', 'draw')).toMatchObject({ arrow: '->', arrowTip: 'stealth' });
    expect(resolveStyle('<->,>={Latex}', 'draw')).toMatchObject({ arrow: '<->', arrowTip: 'latex' });
    expect(isInteractivePresentationOption('>=Stealth')).toBe(true);
    expect(isInteractivePresentationOption('>=Diamond')).toBe(false);
  });
  it('keeps draw, fill, text, and whole-path opacity as separate presentation channels', () => {
    expect(resolveStyle(
      'draw opacity=.4,fill opacity=.5,text opacity=.6,opacity=.7',
      'filldraw',
    )).toMatchObject({
      strokeOpacity: 0.4,
      fillOpacity: 0.5,
      textOpacity: 0.6,
      opacity: 0.7,
    });
  });
});
