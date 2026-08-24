import { describe, expect, it } from 'vitest';
import { __hostFunctionWidgetTest, hostFunctionPlotWidget } from './host-function-widget';

describe('trusted host function widget', () => {
  it('samples two explicit functions without eval', () => {
    const widget = hostFunctionPlotWidget('用交互函数图 Widget 展示 y=x^2 和 y=2x 的交点。');
    expect(widget?.series).toHaveLength(2);
    expect(widget?.series[0]?.points).toHaveLength(161);
    expect(widget?.expression).toContain('y=x^2');
  });

  it('supports bounded arithmetic, implicit multiplication and common functions', () => {
    expect(__hostFunctionWidgetTest.evaluate('2x+1', 3)).toBe(7);
    expect(__hostFunctionWidgetTest.evaluate('sin(pi/2)', 0)).toBeCloseTo(1);
    expect(__hostFunctionWidgetTest.evaluate('sqrt(x^2)', -4)).toBe(4);
  });

  it('rejects unknown code-like expressions', () => {
    expect(__hostFunctionWidgetTest.evaluate('globalThis.alert(1)', 0)).toBeNull();
    expect(hostFunctionPlotWidget('解释 y=x^2，不需要 Widget。')).toBeNull();
  });
});
