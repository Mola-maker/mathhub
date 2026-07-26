import { describe, expect, it } from 'vitest';
import { detectPreviewOnly, extractTikzBlock, sanitizeTikz } from './extract-tikz';

describe('extractTikzBlock', () => {
  it('从 ```tikz 围栏提取', () => {
    expect(extractTikzBlock('前言\n```tikz\n\\begin{tikzpicture}\\end{tikzpicture}\n```\n后语'))
      .toBe('\\begin{tikzpicture}\\end{tikzpicture}');
  });

  it('兼容 ```latex 围栏与裸环境', () => {
    expect(extractTikzBlock('```latex\n\\begin{tikzpicture}\\draw (0,0);\n```'))
      .toContain('\\begin{tikzpicture}');
    expect(extractTikzBlock('直接给：\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture} 完毕'))
      .toContain('\\end{tikzpicture}');
  });

  it('找不到返回 null', () => {
    expect(extractTikzBlock('没有代码')).toBeNull();
  });
});

describe('sanitizeTikz', () => {
  it('剥离危险与 preamble 命令并记录', () => {
    const { code, stripped } = sanitizeTikz(
      '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{tikzpicture}\n\\input{evil}\n\\draw (0,0);\n\\end{tikzpicture}',
    );
    expect(code).not.toContain('\\input');
    expect(code).not.toContain('\\usepackage');
    expect(code).not.toContain('{evil}');
    expect(stripped).toContain('\\input');
  });

  it('剥离宏定义、write18 和无花括号 include', () => {
    const { code, stripped } = sanitizeTikz(
      '\\begin{tikzpicture}\n\\def\\x{bad}\n\\write18{touch pwned}\n\\include evil.tex\n\\end{tikzpicture}',
    );
    expect(code).not.toContain('touch pwned');
    expect(code).not.toContain('evil.tex');
    expect(stripped).toEqual(expect.arrayContaining(['\\def', '\\write18', '\\include']));
  });
});

describe('detectPreviewOnly', () => {
  it('识别子集外特性', () => {
    expect(detectPreviewOnly('\\begin{tikzpicture}\\foreach \\x in {1,2}{}\\end{tikzpicture}'))
      .toContain('\\foreach');
    expect(detectPreviewOnly('\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}'))
      .toEqual([]);
  });
});

