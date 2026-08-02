import { describe, expect, it } from 'vitest';
import type { Scene } from '../semantics/scene';
import { DEFAULT_STYLE } from './style-resolver';
import { hitTestElement, hitTestPointHandle } from './hit-test';

const scene: Scene = {
  sourceRevision: 0,
  points: new Map([
    ['A', { stableId: 'point-a', name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
    ['B', { stableId: 'point-b', name: 'B', position: { x: 4, y: 0 }, free: true, dependsOn: [], stmtIndex: 1 }],
  ]),
  elements: [
    { stableId: 'line-ab', kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], cycle: false, stmtIndex: 2, refs: ['A', 'B'], style: DEFAULT_STYLE },
    { stableId: 'circle-1', kind: 'circle', center: { x: 2, y: 0 }, radius: 1.5, definition: null, stmtIndex: 3, refs: [], style: DEFAULT_STYLE },
    { stableId: 'label-a', kind: 'label', at: { x: 0, y: 0 }, text: '$A$', anchor: 'above', stmtIndex: 4, refs: ['A'], style: DEFAULT_STYLE },
  ],
  issues: [],
  graphOrder: [],
};
const viewport = { scale: 10, offsetX: 0, offsetY: 0 };

describe('hit-test', () => {
  it('最近手柄命中与半径约束', () => {
    expect(hitTestPointHandle({ x: 3, y: 2 }, scene, viewport, 10)).toBe('A');
    expect(hitTestPointHandle({ x: 30, y: 40 }, scene, viewport, 10)).toBeNull();
  });

  it('线段命中（含容差）与圆周命中', () => {
    expect(hitTestElement({ x: 20, y: 3 }, scene, viewport, 6)?.stmtIndex).toBe(2);
    expect(hitTestElement({ x: 20, y: -15 }, scene, viewport, 6)?.stmtIndex).toBe(3);
    expect(hitTestElement({ x: 20, y: 30 }, scene, viewport, 6)).toBeNull();
  });

  it('按照标签实际偏移后的可见边界命中', () => {
    expect(hitTestElement({ x: 0, y: -10 }, scene, viewport, 2)).toMatchObject({
      stmtIndex: 4,
      kind: 'label',
    });
    expect(hitTestElement({ x: 0, y: 5 }, scene, viewport, 2)?.kind).not.toBe('label');
  });
});
