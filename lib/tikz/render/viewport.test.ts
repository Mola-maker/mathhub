import { describe, expect, it } from 'vitest';
import { fitViewport, sceneToScreen, screenToScene } from './viewport';

describe('viewport', () => {
  it('y 轴翻转 + 往返一致', () => {
    const viewport = { scale: 40, offsetX: 100, offsetY: 80 };
    const screen = sceneToScreen({ x: 2, y: 3 }, viewport);
    expect(screen).toEqual({ x: 180, y: -40 });
    expect(screenToScene(screen, viewport)).toEqual({ x: 2, y: 3 });
  });

  it('fitViewport 居中且留 padding，scale 有界', () => {
    const viewport = fitViewport([{ x: 0, y: 0 }, { x: 4, y: 2 }], 800, 600, 40);
    expect(viewport.scale).toBeLessThanOrEqual(240);
    expect(sceneToScreen({ x: 2, y: 1 }, viewport).x).toBeCloseTo(400, 3);
    expect(fitViewport([], 800, 600).scale).toBe(40);
  });

  it('退化边界和无效画布尺寸仍返回有限视口', () => {
    const pointViewport = fitViewport([{ x: 3, y: -2 }], 320, 200);
    expect(Number.isFinite(pointViewport.scale)).toBe(true);
    expect(sceneToScreen({ x: 3, y: -2 }, pointViewport)).toEqual({ x: 160, y: 100 });
    expect(fitViewport([{ x: 0, y: 0 }], 0, 0)).toEqual({
      scale: 40,
      offsetX: 0.5,
      offsetY: 0.5,
    });
  });
});

