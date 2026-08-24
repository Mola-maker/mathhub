import { describe, expect, it } from 'vitest';
import {
  selectTikzExactCompilerProfile,
  tikzExactCompilerProfile,
} from './compiler-profile';

describe('selectTikzExactCompilerProfile', () => {
  it('keeps ordinary graph syntax on the standard profile', () => {
    expect(selectTikzExactCompilerProfile(String.raw`
      \begin{tikzpicture}
      \graph [grow right] { a -> b -> c };
      \end{tikzpicture}
    `).profile).toBe('tikz-standard-v1');
  });

  it.each([
    String.raw`\usetikzlibrary{graphs,graphdrawing}`,
    String.raw`\usegdlibrary{force}`,
    String.raw`\graph [spring layout] { a -- b }`,
    String.raw`\graph [layered layout] { a -> b }`,
  ])('routes Lua graph drawing source to the companion profile', (source) => {
    const selection = selectTikzExactCompilerProfile(source);
    expect(selection.profile).toBe('tikz-luatex-graphdrawing-v1');
    expect(selection.evidence).not.toBeNull();
  });

  it('does not select a profile from comments', () => {
    expect(selectTikzExactCompilerProfile(String.raw`
      % \usegdlibrary{force}
      \begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
    `).profile).toBe('tikz-standard-v1');
  });

  it('does not treat ordinary label prose as a graph-drawing option key', () => {
    expect(selectTikzExactCompilerProfile(String.raw`
      \begin{tikzpicture}
      \node at (0,0) {spring layout};
      \end{tikzpicture}
    `).profile).toBe('tikz-standard-v1');
  });

  it('binds each profile to a different wrapper, bundle and manifest digest', () => {
    const standard = tikzExactCompilerProfile('tikz-standard-v1');
    const graph = tikzExactCompilerProfile('tikz-luatex-graphdrawing-v1');
    expect(graph.texEngine).toBe('lualatex');
    expect(graph.wrapperId).not.toBe(standard.wrapperId);
    expect(graph.bundleIdentityPrefix).not.toBe(standard.bundleIdentityPrefix);
    expect(graph.manifestDigest).not.toBe(standard.manifestDigest);
  });
});
