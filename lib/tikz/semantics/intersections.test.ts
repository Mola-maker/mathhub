import { describe, it, expect } from 'vitest';
import { intersectPaths, type GeomPath } from './intersections';

const seg = (x1: number, y1: number, x2: number, y2: number): GeomPath => ({ type: 'poly', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false });
const circ = (x: number, y: number, r: number): GeomPath => ({ type: 'circle', center: { x, y }, radius: r });

describe('intersectPaths', () => {
  it('线段相交 / 平行不相交', () => {
    expect(intersectPaths(seg(0, 0, 4, 4), seg(0, 4, 4, 0))).toHaveLength(1);
    expect(intersectPaths(seg(0, 0, 4, 4), seg(0, 4, 4, 0))[0]).toMatchObject({ x: 2, y: 2 });
    expect(intersectPaths(seg(0, 0, 4, 0), seg(0, 1, 4, 1))).toHaveLength(0);
  });
  it('线段×圆：两交点并沿 first 排序；相切 1 点；相离 0 点', () => {
    const pts = intersectPaths(seg(-3, 0, 3, 0), circ(0, 0, 2));
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(-2, 9); expect(pts[1].x).toBeCloseTo(2, 9);
    expect(intersectPaths(seg(-3, 2, 3, 2), circ(0, 0, 2))).toHaveLength(1);
    expect(intersectPaths(seg(-3, 3, 3, 3), circ(0, 0, 2))).toHaveLength(0);
  });
  it('圆×圆：2/1/0 交点', () => {
    expect(intersectPaths(circ(0, 0, 2), circ(3, 0, 2))).toHaveLength(2);
    expect(intersectPaths(circ(0, 0, 2), circ(4, 0, 2))).toHaveLength(1);
    expect(intersectPaths(circ(0, 0, 2), circ(5, 0, 2))).toHaveLength(0);
    expect(intersectPaths(circ(0, 0, 2), circ(0, 0, 2))).toHaveLength(0); // 同心重合视为退化
  });
  it('交点在线段端点外不计（TikZ 语义：路径段而非无限直线）', () => {
    expect(intersectPaths(seg(0, 0, 1, 1), seg(2, 0, 3, 1))).toHaveLength(0);
  });
});