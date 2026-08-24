import { describe, expect, it } from 'vitest';
import { parseTikzCst } from './tikz-cst';

describe('parseTikzCst', () => {
  it('保留注释、嵌套组和语义statement边界', () => {
    const source = String.raw`\begin{tikzpicture}
% keep
\draw[red] (0,0) -- ({1+2},3);
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.errorRanges).toEqual([]);
    expect(cst.statements).toHaveLength(1);
    expect(source.slice(cst.statements[0].range.start, cst.statements[0].range.end))
      .toContain('\\draw[red]');
  });

  it('未知命令保留为opaque node并标注影响域', () => {
    const source = String.raw`\begin{tikzpicture}
\tikzset{every node/.style={red}};
\foreach \x in {1,2} {\draw (0,0)--(\x,1);};
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.opaqueNodes.some((node) => node.command === '\\tikzset')).toBe(true);
    expect(cst.opaqueNodes.some((node) => node.impact === 'document')).toBe(true);
    expect(cst.safeForInteractiveWriteback).toBe(false);
  });

  it('不会把 opaque foreach 内部语句误当作独立 semantic statement', () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \x in {1,2} {\draw (0,0)--(\x,1);};
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.statements).toHaveLength(1);
    expect(cst.statements[0]).toMatchObject({
      command: '\\foreach',
      kind: 'opaque',
    });
  });

  it('把 scope 与内部语句视为一个不安全的 opaque 区域', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xshift=2cm]
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{scope}
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.opaqueNodes).toHaveLength(0);
    expect(cst.statements).toHaveLength(2);
    expect(cst.statements.map((node) => node.command)).toEqual(['\\coordinate', '\\draw']);
    expect(cst.statements[0]?.coordinateTransform).toMatchObject({ e: 2, f: 0 });
    expect(cst.safeForInteractiveWriteback).toBe(true);
  });

  it('keeps a scope with dynamic inherited styles exact-only', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xshift=2cm,every node/.style={red}]
  \draw (0,0) -- (1,0);
\end{scope}
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.opaqueNodes).toHaveLength(1);
    expect(cst.opaqueNodes[0]).toMatchObject({
      command: '\\begin{scope}',
      impact: 'scope',
    });
    expect(cst.safeForInteractiveWriteback).toBe(false);
  });

  it('projects static non-similarity CTMs including literal circles as affine ellipses', () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xscale=2,yslant=.5]
  \coordinate (A) at (1,2);
  \draw (A)--(2,1);
  \draw (0,0) circle (1);
\end{scope}
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.statements).toHaveLength(3);
    expect(cst.statements[0]).toMatchObject({
      kind: 'semantic',
      coordinateTransform: { a: 2, b: 0.5, c: 0, d: 1 },
    });
    expect(cst.statements[1]).toMatchObject({ kind: 'semantic' });
    expect(cst.statements[2]).toMatchObject({ kind: 'semantic' });
    expect(cst.opaqueNodes).toEqual([]);
    expect(cst.safeForInteractiveWriteback).toBe(true);
  });

  it('keeps circle-through under a non-similarity CTM local-opaque', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (1,0);
\begin{scope}[xscale=2]
  \draw (0,0) circle [through=(A)];
\end{scope}
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.statements[1]).toMatchObject({ kind: 'opaque', impact: 'local' });
    expect(cst.opaqueNodes).toHaveLength(1);
    expect(cst.safeForInteractiveWriteback).toBe(true);
  });

  it('keeps unsupported node anchors lossless and blocks only their interactive statement', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\draw (A.north)--(1,0);
\draw (A.center)--(2,0);
\end{tikzpicture}`;
    const cst = parseTikzCst(source);
    expect(cst.statements).toHaveLength(3);
    expect(cst.statements[1]).toMatchObject({ kind: 'opaque', command: '\\draw' });
    expect(cst.statements[2]).toMatchObject({ kind: 'semantic', command: '\\draw' });
    expect(source.slice(cst.statements[1]!.range.start, cst.statements[1]!.range.end))
      .toContain('(A.north)');
  });
});
