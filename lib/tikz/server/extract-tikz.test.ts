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

  it('从无标签围栏中只提取含 TikZ/TeX 命令的代码', () => {
    expect(extractTikzBlock('说明\n```\n\\draw (0,0)--(1,1);\n```\n结束'))
      .toBe('\\draw (0,0)--(1,1);');
    expect(extractTikzBlock('说明\n```\n普通 Markdown\n```\n结束')).toBeNull();
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

  it('将历史伪 through 语法规范化为标准 TikZ', () => {
    const { code } = sanitizeTikz(
      '\\begin{tikzpicture}\\draw (O) circle [through=(A)];\\end{tikzpicture}',
    );
    expect(code).toContain('\\node[draw,circle through=(A)] at (O) {}');
    expect(code).not.toContain('[through=');
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
