import { describe, expect, it } from 'vitest';
import type { Scene } from '../semantics/scene';
import { DEFAULT_STYLE } from './style-resolver';
import { hitTestElement, hitTestPointHandle } from './hit-test';

const scene: Scene = {
  points: new Map([
    ['A', { name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
    ['B', { name: 'B', position: { x: 4, y: 0 }, free: true, dependsOn: [], stmtIndex: 1 }],
  ]),
  elements: [
    { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], cycle: false, stmtIndex: 2, refs: ['A', 'B'], style: DEFAULT_STYLE },
    { kind: 'circle', center: { x: 2, y: 0 }, radius: 1.5, stmtIndex: 3, refs: [], style: DEFAULT_STYLE },
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
});

