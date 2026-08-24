import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Scene } from '../semantics/scene';
import { DEFAULT_STYLE } from './style-resolver';
import { TikzSceneSvg } from './svg-renderer';

const scene: Scene = {
  sourceRevision: 0,
  points: new Map([
    ['A', { stableId: 'point-a', name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
    ['B', { stableId: 'point-b', name: 'B', position: { x: 4, y: 0 }, free: true, dependsOn: [], stmtIndex: 1 }],
    ['M', { stableId: 'point-m', name: 'M', position: { x: 2, y: 0 }, free: false, dependsOn: ['A', 'B'], stmtIndex: 2 }],
  ]),
  elements: [
    { stableId: 'line-ab', kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], cycle: false, stmtIndex: 3, refs: ['A', 'B'], style: DEFAULT_STYLE },
    { stableId: 'circle-1', kind: 'circle', center: { x: 2, y: 0 }, radius: 1.5, radiusSource: null, definition: null, stmtIndex: 4, refs: ['M'], style: DEFAULT_STYLE },
    { stableId: 'label-a', kind: 'label', at: { x: 0, y: 0 }, text: '$A$', anchor: 'above', stmtIndex: 5, refs: ['A'], style: DEFAULT_STYLE },
  ],
  issues: [],
  graphOrder: ['A', 'B', 'M'],
};
const viewport = { scale: 10, offsetX: 100, offsetY: 100 };

describe('TikzSceneSvg', () => {
  it('元素渲染为 SVG 并带语义 data 属性', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={viewport} /></svg>);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('points')).toBe('100,100 140,100');
    expect(line?.getAttribute('data-tikz-refs')).toBe('A B');
    const circle = container.querySelector('circle[data-tikz-kind="circle"]');
    expect(circle?.getAttribute('r')).toBe('15');
  });

  it('overlay 层渲染自由/派生点手柄，自由点实心、派生点空心', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={viewport} /></svg>);
    const handles = container.querySelectorAll('[data-tikz-point]');
    expect(handles).toHaveLength(3);
    expect(container.querySelector('[data-tikz-point="A"]')?.getAttribute('data-tikz-free')).toBe('true');
    expect(container.querySelector('[data-tikz-point="M"]')?.getAttribute('data-tikz-free')).toBe('false');
    expect(container.querySelector('.tz-point-handle')?.getAttribute('opacity')).toBe('0');
  });

  it('keeps coordinate hit targets interactive without painting them into visual truth', () => {
    const { container } = render(
      <svg><TikzSceneSvg scene={scene} viewport={viewport} selection={['A']} /></svg>,
    );
    expect(container.querySelector('[data-tikz-point="B"]')?.getAttribute('fill')).toBe('transparent');
    expect(
      container.querySelector('[data-tikz-handle="A"] .tz-point-handle')?.getAttribute('opacity'),
    ).toBe('1');
    expect(
      container.querySelector('[data-tikz-handle="B"] .tz-point-handle')?.getAttribute('opacity'),
    ).toBe('0');
  });

  it('label 去掉 $ 定界符渲染纯文本', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={viewport} /></svg>);
    expect(container.querySelector('text')?.textContent).toBe('A');
  });

  it('selection 中的 ref 高亮', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={viewport} selection={['A']} /></svg>);
    expect(container.querySelector('[data-tikz-refs="A B"]')?.getAttribute('data-selected')).toBe('true');
  });

  it('箭头以显式 path 渲染而不是 marker', () => {
    const line = scene.elements[0];
    if (line.kind !== 'polyline') throw new Error('fixture 首元素应为 polyline');
    const arrowScene: Scene = {
      ...scene,
      elements: [{
        ...line,
        style: { ...DEFAULT_STYLE, arrow: '<->' },
      }],
    };
    const { container } = render(<svg><TikzSceneSvg scene={arrowScene} viewport={viewport} /></svg>);
    expect(container.querySelectorAll('[data-tikz-decoration="arrows"] path')).toHaveLength(2);
    expect(container.querySelector('marker')).toBeNull();
  });

  it('uses TikZ butt/miter defaults instead of forcing rounded geometry', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={viewport} /></svg>);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke-linecap')).toBe('butt');
    expect(line?.getAttribute('stroke-linejoin')).toBe('miter');
    expect(line?.getAttribute('stroke-miterlimit')).toBe('10');
  });

  it('renders affine elliptical arcs as an exact transformed unit SVG arc', () => {
    const arcScene: Scene = {
      ...scene,
      points: new Map(),
      elements: [{
        stableId: 'affine-arc',
        kind: 'elliptical-arc',
        center: { x: 0, y: 0 },
        axisX: { x: 2, y: 0 },
        axisY: { x: 1, y: 1 },
        xRadius: 2.288245611270737,
        yRadius: 0.8740320488976422,
        rotationDegrees: 13.282525588539,
        startAngleDeg: 0,
        endAngleDeg: 90,
        start: { x: 2, y: 0 },
        end: { x: 1, y: 1 },
        parameterSources: {
          sourceKind: 'circular-arc',
          startAngle: { range: { start: 0, end: 1 }, value: 0 },
          endAngle: { range: { start: 2, end: 4 }, value: 90 },
          radius: { range: { start: 5, end: 6 }, value: 1 },
          coordinateTransformSimilarity: false,
        },
        stmtIndex: 0,
        refs: [],
        style: DEFAULT_STYLE,
      }],
      graphOrder: [],
    };
    const { container } = render(
      <svg><TikzSceneSvg scene={arcScene} viewport={viewport} /></svg>,
    );
    const path = container.querySelector('[data-tikz-kind="elliptical-arc"]');
    expect(path?.getAttribute('d')).toContain('A 1 1 0 0 1');
    expect(path?.getAttribute('transform')).toBe('matrix(20 0 10 -10 100 100)');
  });

});
