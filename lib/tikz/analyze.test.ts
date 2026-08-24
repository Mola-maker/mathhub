import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { buildSceneManifest } from './semantics/scene-manifest';

const GOOD = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (M) at ($(A)!0.5!(A)$);\n\\draw (A) -- (M);\n\\end{tikzpicture}';

describe('analyze', () => {
  it('projects static graph topology into read-only points and interactive graph primitives', () => {
    const source = String.raw`\begin{tikzpicture}
\graph [nodes={draw,circle}, grow right=2cm] { A -> B -> C -> A };
\end{tikzpicture}`;
    const analysis = analyze(source);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toHaveLength(0);
    expect([...analysis.scene!.points].map(([name, point]) => [name, point.position, point.writable])).toEqual([
      ['A', { x: 0, y: 0 }, false],
      ['B', { x: 2, y: 0 }, false],
      ['C', { x: 4, y: 0 }, false],
    ]);
    expect(analysis.scene?.elements.filter((element) => element.kind === 'polyline')).toHaveLength(3);
    expect(analysis.scene?.elements.filter((element) => element.kind === 'graph-node')).toHaveLength(3);
  });

  it('projects official static graph chain groups through entry and exit nodes', () => {
    const analysis = analyze(String.raw`\begin{tikzpicture}
\graph { A -> { B -> C, D -> E } -> F };
\coordinate (O) at (0,0);
\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene?.points.get('O')?.position).toEqual({ x: 0, y: 0 });
    expect(analysis.cst.opaqueNodes).toHaveLength(0);
    expect(analysis.stmts?.find((statement) => statement.kind === 'graph')).toMatchObject({
      nodes: [
        { name: 'A' }, { name: 'B' }, { name: 'C' },
        { name: 'D' }, { name: 'E' }, { name: 'F' },
      ],
      edges: [
        { from: 'B', to: 'C', connector: '->' },
        { from: 'D', to: 'E', connector: '->' },
        { from: 'A', to: 'B', connector: '->' },
        { from: 'A', to: 'D', connector: '->' },
        { from: 'C', to: 'F', connector: '->' },
        { from: 'E', to: 'F', connector: '->' },
      ],
    });
    expect(analysis.scene?.points.get('B')?.position.x).toBe(2);
    expect(analysis.scene?.points.get('D')?.position.x).toBe(2);
    expect(analysis.scene?.points.get('B')?.position.y)
      .not.toBe(analysis.scene?.points.get('D')?.position.y);
    expect(analysis.scene?.points.get('F')?.position.x).toBe(6);
  });

  it('projects layered graphdrawing topology with stable ranks and explicit fidelity', () => {
    const analysis = analyze(String.raw`\begin{tikzpicture}
\graph [layered layout, grow right, level distance=3cm, sibling distance=2cm] {
  A -> { B -> C, D -> E } -> F
};
\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene?.points.get('A')?.position).toEqual({ x: 0, y: 0 });
    expect(analysis.scene?.points.get('B')?.position).toEqual({ x: 3, y: -1 });
    expect(analysis.scene?.points.get('D')?.position).toEqual({ x: 3, y: 1 });
    expect(analysis.scene?.points.get('C')?.position).toEqual({ x: 6, y: -1 });
    expect(analysis.scene?.points.get('E')?.position).toEqual({ x: 6, y: 1 });
    expect(analysis.scene?.points.get('F')?.position).toEqual({ x: 9, y: 0 });
    expect(analysis.scene?.elements.find((element) => element.kind === 'graph-node')).toMatchObject({
      layoutIntent: 'layered',
      layoutAlgorithm: 'layered layout',
      layoutFidelity: 'deterministic-preview',
      exactCompilerRequired: true,
    });
  });

  it('projects circular graphdrawing layouts deterministically', () => {
    const source = String.raw`\begin{tikzpicture}
\graph [circular layout, radius=2cm] { A -- B -- C -- D -- A };
\end{tikzpicture}`;
    const first = analyze(source);
    const second = analyze(source);
    expect([...first.scene!.points].map(([name, point]) => [name, point.position]))
      .toEqual([...second.scene!.points].map(([name, point]) => [name, point.position]));
    expect(first.scene?.points.get('A')?.position.x).toBeCloseTo(0, 12);
    expect(first.scene?.points.get('A')?.position.y).toBeCloseTo(2, 12);
    expect(first.scene?.points.get('C')?.position.y).toBeCloseTo(-2, 12);
  });

  it('keeps force-layout previews deterministic and non-collinear', () => {
    const source = String.raw`\begin{tikzpicture}
\graph [spring layout] { A -- B -- C -- D -- A, A -- C };
\end{tikzpicture}`;
    const first = analyze(source);
    const second = analyze(source);
    const firstPositions = [...first.scene!.points].map(([name, point]) => [name, point.position] as const);
    expect(firstPositions).toEqual(
      [...second.scene!.points].map(([name, point]) => [name, point.position] as const),
    );
    expect(new Set(firstPositions.map(([, point]) => point.y.toFixed(6))).size).toBeGreaterThan(2);
  });

  it('preserves dynamic graph syntax as local opaque exact-only source', () => {
    const analysis = analyze(String.raw`\begin{tikzpicture}
\graph { A -> "dynamic node" };
\coordinate (O) at (0,0);
\end{tikzpicture}`);
    expect(analysis.status).toBe('partial');
    expect(analysis.scene?.points.get('O')?.position).toEqual({ x: 0, y: 0 });
    expect(analysis.cst.opaqueNodes).toHaveLength(1);
    expect(analysis.cst.opaqueNodes[0]?.command).toBe('\\graph');
  });

  it('projects supported Bezier paths and rich node punctuation without degrading the document', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\\node at (A) {Euler line. Nine-point circle.};
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene).not.toBeNull();
    expect(analysis.cst.opaqueNodes).toHaveLength(0);
    expect(analysis.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('合法代码：scene 就绪、零 issue、freePointRanges 只含字面量点', () => {
    const analysis = analyze(GOOD);
    expect(analysis.scene).not.toBeNull();
    expect(analysis.issues).toEqual([]);
    expect([...analysis.freePointRanges.keys()]).toEqual(['A']);
    const range = analysis.freePointRanges.get('A')!;
    expect(GOOD.slice(range.start, range.end)).toBe('(0,0)');
  });

  it('解析失败：scene 为 null，issue 带 range', () => {
    const analysis = analyze('\\begin{tikzpicture}\\draw (0,0)');
    expect(analysis.scene).toBeNull();
    expect(analysis.issues[0].severity).toBe('error');
    expect(analysis.issues[0].range).not.toBeNull();
  });

  it('静态错误（未知引用）跳过求值', () => {
    const analysis = analyze('\\begin{tikzpicture}\\coordinate (M) at ($(Z)!0.5!(Z)$);\\end{tikzpicture}');
    expect(analysis.scene).toBeNull();
    expect(analysis.issues.length).toBeGreaterThan(0);
  });

  it('求值级错误（退化）保留场景（best-attempt）', () => {
    const analysis = analyze('\\begin{tikzpicture}\\coordinate (A) at (0,0);\\coordinate (H) at ($(A)!(A)!(A)$);\\end{tikzpicture}');
    expect(analysis.scene).not.toBeNull();
    expect(analysis.issues.some((issue) => issue.message.includes('退化'))).toBe(true);
    expect(analysis.issues.find((issue) => issue.message.includes('退化'))?.range).not.toBeNull();
  });

  it('projects an ellipse through Source, Scene and semantic analysis without an opaque fallback', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\coordinate (O) at (1,2);
\\draw[thick,blue] (O) ellipse (2 and 1);
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toHaveLength(0);
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'ellipse',
      center: { x: 1, y: 2 },
      xRadius: 2,
      yRadius: 1,
      rotationDegrees: 0,
    });
  });

  it('preserves ellipse orientation from a supported similarity scope transform', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[rotate=30]
  \\draw (1,0) ellipse (2 and 1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toHaveLength(0);
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'ellipse',
      xRadius: 2,
      yRadius: 1,
      rotationDegrees: 30,
      parameterSources: { coordinateRotationDegrees: 30 },
    });
    const ellipse = analysis.scene?.elements[0];
    if (!ellipse || ellipse.kind !== 'ellipse') throw new Error('bad ellipse');
    expect(ellipse.center.x).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(ellipse.center.y).toBeCloseTo(0.5, 12);
  });

  it('projects point center anchors while preserving shape-dependent anchors as opaque exact-only source', () => {
    const center = analyze(`\\begin{tikzpicture}
\\coordinate (A) at (1,2);
\\draw (A.center)--(3,4);
\\end{tikzpicture}`);
    expect(center.status).toBe('complete');
    expect(center.cst.opaqueNodes).toHaveLength(0);
    expect(center.scene?.elements[0]).toMatchObject({
      kind: 'polyline',
      refs: ['A'],
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    });

    const unsupported = analyze(`\\begin{tikzpicture}
\\coordinate (A) at (1,2);
\\draw (A.north)--(3,4);
\\end{tikzpicture}`);
    expect(unsupported.status).toBe('partial');
    expect(unsupported.scene?.points.get('A')?.position).toEqual({ x: 1, y: 2 });
    expect(unsupported.scene?.elements).toEqual([]);
    expect(unsupported.cst.opaqueNodes).toHaveLength(1);
  });

  it('projects nested TikZ scope CTMs without re-transforming named coordinates', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[xshift=2cm]
  \\coordinate (A) at (0,0);
  \\begin{scope}[rotate=90]
    \\draw (A) -- (1,0);
  \\end{scope}
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene?.points.get('A')?.position).toEqual({ x: 2, y: 0 });
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'polyline',
      points: [
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
    });
    expect(analysis.freePointTransforms.get('A')).toMatchObject({ e: 2, f: 0 });
  });

  it('inherits bounded scope presentation options before path-local overrides', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[red,thick]
  \\draw (0,0) -- (1,0);
  \\draw[blue] (0,1) -- (1,1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene?.elements[0]?.style).toMatchObject({
      stroke: '#ff0000',
    });
    expect(analysis.scene?.elements[1]?.style).toMatchObject({
      stroke: '#0000ff',
    });
    expect(analysis.scene?.elements[0]?.style.strokeWidth).toBeGreaterThan(1);
    expect(analysis.scene?.elements[1]?.style.strokeWidth)
      .toBe(analysis.scene?.elements[0]?.style.strokeWidth);
  });

  it('keeps singular scope transforms exact-only', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[xscale=0]
  \\draw (0,0) -- (1,0);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('partial');
    expect(analysis.scene?.elements).toEqual([]);
    expect(analysis.cst.opaqueNodes[0]).toMatchObject({ impact: 'scope' });
  });

  it('projects general affine CTMs for points, polylines, and cubic Beziers', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[cm={1,0,1,1,(2cm,3cm)}]
  \\coordinate (A) at (1,2);
  \\draw (A) -- (2,1);
  \\draw (0,0) .. controls (1,0) and (1,1) .. (2,1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toEqual([]);
    expect(analysis.scene?.points.get('A')?.position).toEqual({ x: 5, y: 5 });
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'polyline',
      points: [{ x: 5, y: 5 }, { x: 5, y: 4 }],
    });
    expect(analysis.scene?.elements[1]).toMatchObject({
      kind: 'cubic-bezier',
      start: { x: 2, y: 3 },
      control1: { x: 3, y: 3 },
      control2: { x: 4, y: 4 },
      end: { x: 5, y: 4 },
    });
  });

  it('lowers a non-uniformly transformed circle to a semantic ellipse', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[xscale=2]
  \\draw (0,0) -- (1,1);
  \\draw (0,0) circle (1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.scene?.elements).toHaveLength(2);
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 2, y: 1 }],
    });
    expect(analysis.scene?.elements[1]).toMatchObject({
      kind: 'ellipse',
      center: { x: 0, y: 0 },
      xRadius: 2,
      yRadius: 1,
      rotationDegrees: 0,
      parameterSources: {
        sourceKind: 'circle',
        coordinateTransformSimilarity: false,
      },
    });
    expect(analysis.cst.opaqueNodes).toEqual([]);
  });

  it('canonicalizes a slanted ellipse from its exact affine singular axes', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[xslant=1]
  \\draw (0,0) ellipse (2 and 1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    const ellipse = analysis.scene?.elements[0];
    if (!ellipse || ellipse.kind !== 'ellipse') throw new Error('affine ellipse missing');
    expect(ellipse.xRadius).toBeCloseTo(Math.sqrt(3 + Math.sqrt(5)), 12);
    expect(ellipse.yRadius).toBeCloseTo(Math.sqrt(3 - Math.sqrt(5)), 12);
    expect(ellipse.rotationDegrees).toBeCloseTo(13.282525588539, 11);
    expect(ellipse.parameterSources).toMatchObject({
      sourceKind: 'ellipse',
      coordinateScale: null,
      coordinateRotationDegrees: null,
      coordinateTransformSimilarity: false,
    });
  });

  it('projects a generally transformed TikZ circular arc as an exact elliptical arc', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[cm={2,0,1,1,(0,0)}]
  \\draw (1,0) arc (0:90:1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toEqual([]);
    const arc = analysis.scene?.elements[0];
    expect(arc).toMatchObject({
      kind: 'elliptical-arc',
      center: { x: 0, y: 0 },
      axisX: { x: 2, y: 0 },
      axisY: { x: 1, y: 1 },
      start: { x: 2, y: 0 },
      startAngleDeg: 0,
      endAngleDeg: 90,
      parameterSources: {
        sourceKind: 'circular-arc',
        coordinateTransformSimilarity: false,
      },
    });
    if (!arc || arc.kind !== 'elliptical-arc') throw new Error('elliptical arc missing');
    expect(arc.end.x).toBeCloseTo(1, 12);
    expect(arc.end.y).toBeCloseTo(1, 12);
  });

  it('projects an official rectangle as a closed semantic polygon with source dependencies', () => {
    const source = `\\begin{tikzpicture}
\\coordinate (A) at (-1,-2);
\\coordinate (B) at (3,4);
\\draw[fill=blue!20] (A) rectangle (B);
\\end{tikzpicture}`;
    const analysis = analyze(source, 7);
    expect(analysis.status).toBe('complete');
    expect(analysis.cst.opaqueNodes).toEqual([]);
    expect(analysis.scene?.elements[0]).toMatchObject({
      kind: 'polyline',
      cycle: true,
      refs: ['A', 'B'],
      points: [
        { x: -1, y: -2 },
        { x: 3, y: -2 },
        { x: 3, y: 4 },
        { x: -1, y: 4 },
      ],
    });
    const manifest = buildSceneManifest({ source, ...analysis });
    expect(manifest.namedPaths).toEqual([]);
    expect(manifest.elements[0]).toMatchObject({
      kind: 'polyline',
      cycle: true,
      refs: ['A', 'B'],
    });
  });

  it('keeps rectangles inside rotated scopes exact-only until corner CTM semantics are proven', () => {
    const analysis = analyze(`\\begin{tikzpicture}
\\begin{scope}[rotate=30]
  \\draw (0,0) rectangle (2,1);
\\end{scope}
\\end{tikzpicture}`);
    expect(analysis.status).toBe('partial');
    expect(analysis.scene?.elements).toEqual([]);
    expect(analysis.cst.opaqueNodes).toHaveLength(1);
  });
});
