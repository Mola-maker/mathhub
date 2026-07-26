import { describe, it, expect } from 'vitest';
import { resolveStyle, anchorFromRaw } from './style-resolver';

describe('resolveStyle', () => {
  it('颜色/线宽/虚线/箭头', () => {
    expect(resolveStyle('red,thick,dashed,->', 'draw')).toMatchObject({ stroke: '#ff0000', strokeWidth: 1.4, dash: '6 4', arrow: '->' });
  });
  it('black!30 灰度与 fill 命令默认', () => {
    const s = resolveStyle('black!30', 'fill');
    expect(s.stroke).toBe('rgba(37,31,26,0.3)');
    expect(s.fill).toBe('rgba(37,31,26,0.3)');
  });
  it('line width=2pt 换算与 opacity', () => {
    expect(resolveStyle('line width=2pt,opacity=0.5', 'draw')).toMatchObject({ strokeWidth: 2.666, opacity: 0.5 });
  });
  it('path 命令不可见', () => {
    expect(resolveStyle(null, 'path').stroke).toBe('none');
  });
  it('锚点提取', () => {
    expect(anchorFromRaw('above right, red')).toBe('above right');
    expect(anchorFromRaw(null)).toBe('above');
  });
});