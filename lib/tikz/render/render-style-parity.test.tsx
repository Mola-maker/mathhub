import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { hashSource } from '../semantics/scene-manifest';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import { decodeRenderPrimitives } from './render-primitive-decoder';
import { TikzRenderPrimitiveSvg } from './render-primitive-svg';
import { NATURAL_CM_TO_CSS_PX } from './viewport';

describe('official TikZ stroke presentation parity', () => {
  it('projects cap, join, miter, dash pattern, and phase through Code -> IR -> SVG', () => {
    const source = String.raw`\begin{tikzpicture}
\draw[line width=4pt,line cap=rect,line join=bevel,miter limit=7,dash pattern=on 2pt off 3pt,dash phase=1pt,draw opacity=.4]
  (0,0) -- (1,1) -- (2,0);
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 4),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'stroke-parity',
        epoch: 'epoch-1',
        revision: 4,
        sourceHash: hashSource(source),
        sourceId: 'stroke-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);
    const viewport = { scale: NATURAL_CM_TO_CSS_PX, offsetX: 20, offsetY: 80 };
    const { container } = render(
      <svg>
        <TikzRenderPrimitiveSvg
          rendering={rendering}
          viewport={viewport}
          frame={{ width: 400, height: 200 }}
          selectedSemanticEntityIds={rendering.primitives[0]?.entityIds ?? []}
        />
      </svg>,
    );
    const path = container.querySelector('polyline');
    expect(rendering.issues).toEqual([]);
    expect(path?.getAttribute('stroke-linecap')).toBe('square');
    expect(path?.getAttribute('stroke-linejoin')).toBe('bevel');
    expect(path?.getAttribute('stroke-miterlimit')).toBe('7');
    expect(path?.getAttribute('stroke-dasharray')).toBe('2.657 3.985');
    expect(path?.getAttribute('stroke-dashoffset')).toBe('1.328');
    expect(path?.getAttribute('stroke-opacity')).toBe('0.4');
    expect(path?.getAttribute('data-selected')).toBe('true');
    expect(path?.getAttribute('stroke')).toBe('#000000');
    expect(Number(path?.getAttribute('stroke-width'))).toBe(5.313);
  });

  it('keeps To, Stealth, and Latex arrow tips distinct in interactive SVG', () => {
    const source = String.raw`\begin{tikzpicture}
\draw[->] (0,0) -- (1,0);
\draw[->,>=Stealth] (0,1) -- (1,1);
\draw[->,>={Latex}] (0,2) -- (1,2);
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 2),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'arrow-parity',
        epoch: 'epoch-1',
        revision: 2,
        sourceHash: hashSource(source),
        sourceId: 'arrow-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);
    const { container } = render(
      <svg>
        <TikzRenderPrimitiveSvg
          rendering={rendering}
          viewport={{ scale: NATURAL_CM_TO_CSS_PX, offsetX: 20, offsetY: 100 }}
          frame={{ width: 400, height: 200 }}
        />
      </svg>,
    );
    const arrows = [...container.querySelectorAll('[data-tikz-arrow-tip]')];
    expect(arrows.map((node) => node.getAttribute('data-tikz-arrow-tip')))
      .toEqual(['to', 'stealth', 'latex']);
    expect(arrows[0]?.querySelector('path')?.getAttribute('fill')).toBe('none');
    expect(arrows[1]?.querySelector('path')?.getAttribute('fill')).toBe('#000000');
  });

  it('projects a rotated TikZ ellipse into the same oriented interactive SVG surface', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[rotate=30]
  \draw[thick] (1,0) ellipse (2 and 1);
\end{scope}
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 3),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'ellipse-parity',
        epoch: 'epoch-1',
        revision: 3,
        sourceHash: hashSource(source),
        sourceId: 'ellipse-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);
    expect(rendering.primitives[0]).toMatchObject({
      kind: 'ellipse',
      rotationDegrees: 30,
    });
    const { container } = render(
      <svg>
        <TikzRenderPrimitiveSvg
          rendering={rendering}
          viewport={{ scale: 10, offsetX: 40, offsetY: 80 }}
          frame={{ width: 200, height: 160 }}
        />
      </svg>,
    );
    expect(container.querySelector('ellipse')?.getAttribute('transform'))
      .toMatch(/^rotate\(-30 /);
  });

  it('renders a general affine TikZ polyline at its projected world coordinates', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xslant=1]
  \draw (0,0) -- (1,1) -- (0,2);
\end{scope}
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 5),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'affine-parity',
        epoch: 'epoch-1',
        revision: 5,
        sourceHash: hashSource(source),
        sourceId: 'affine-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);
    expect(rendering.primitives[0]).toMatchObject({
      kind: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    });
    const { container } = render(
      <svg>
        <TikzRenderPrimitiveSvg
          rendering={rendering}
          viewport={{ scale: 10, offsetX: 20, offsetY: 80 }}
          frame={{ width: 160, height: 120 }}
        />
      </svg>,
    );
    expect(container.querySelector('polyline')?.getAttribute('points'))
      .toBe('20,80 40,70 40,60');
  });

  it('renders the exact singular-axis ellipse of a slanted source circle', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xslant=1]
  \draw[thick] (0,0) circle (1);
\end{scope}
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 6),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'affine-circle-parity',
        epoch: 'epoch-1',
        revision: 6,
        sourceHash: hashSource(source),
        sourceId: 'affine-circle-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);
    const ellipse = rendering.primitives[0];
    expect(ellipse).toMatchObject({ kind: 'ellipse' });
    if (!ellipse || ellipse.kind !== 'ellipse') throw new Error('affine ellipse missing');
    expect(ellipse.xRadius * ellipse.yRadius).toBeCloseTo(1, 12);
    const { container } = render(
      <svg>
        <TikzRenderPrimitiveSvg
          rendering={rendering}
          viewport={{ scale: 20, offsetX: 80, offsetY: 80 }}
          frame={{ width: 160, height: 160 }}
        />
      </svg>,
    );
    const node = container.querySelector('ellipse');
    expect(Number(node?.getAttribute('rx'))).toBeCloseTo(ellipse.xRadius * 20, 10);
    expect(Number(node?.getAttribute('ry'))).toBeCloseTo(ellipse.yRadius * 20, 10);
    expect(node?.getAttribute('transform')).toMatch(/^rotate\(-31\.717474411461 /u);
  });

  it('scales the official 5mm right-angle radius with the fitted picture', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,1);
\coordinate (O) at (0,0);
\coordinate (B) at (1,0);
\pic[draw] {right angle = A--O--B};
\end{tikzpicture}`;
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis: analyze(source, 1),
      source,
      hashAlgorithm: 'fnv1a64-utf8',
      basis: {
        documentId: 'angle-radius-parity',
        epoch: 'epoch-1',
        revision: 1,
        sourceHash: hashSource(source),
        sourceId: 'angle-radius-parity:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    });
    const interactive = truths.rendering.find((truth) => truth.target === 'interactive-svg');
    if (!interactive) throw new Error('interactive rendering truth missing');
    const rendering = decodeRenderPrimitives(interactive.primitives);

    function markRadiusAt(scale: number): number {
      const viewport = { scale, offsetX: 100, offsetY: 100 };
      const { container } = render(
        <svg>
          <TikzRenderPrimitiveSvg
            rendering={rendering}
            viewport={viewport}
            frame={{ width: 300, height: 200 }}
          />
        </svg>,
      );
      const path = container.querySelector('path[data-tikz-kind="right-angle"]');
      const numbers = path?.getAttribute('d')?.match(/-?(?:\d+\.?\d*|\.\d+)/gu)?.map(Number) ?? [];
      expect(numbers).toHaveLength(6);
      return Math.hypot(numbers[0]! - viewport.offsetX, numbers[1]! - viewport.offsetY);
    }

    const natural = markRadiusAt(NATURAL_CM_TO_CSS_PX);
    const doubled = markRadiusAt(NATURAL_CM_TO_CSS_PX * 2);
    expect(natural).toBeCloseTo(5 * (96 / 25.4), 5);
    expect(doubled).toBeCloseTo(natural * 2, 5);
  });
});
