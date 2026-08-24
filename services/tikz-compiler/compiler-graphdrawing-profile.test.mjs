import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

process.env.TIKZ_COMPILER_PROFILE = 'tikz-luatex-graphdrawing-v1';
const {
  compilerInputIdentity,
  createCompiler,
  TIKZ_COMPILER_PROFILE,
  TIKZ_WRAPPER_ID,
} = await import('./compiler-core.mjs?profile=graphdrawing');

const source = String.raw`
  \begin{tikzpicture}
  \graph [spring layout] { a -- b -- c -- a };
  \end{tikzpicture}
`;

test('Lua graph drawing profile binds wrapper, runtime and artifact identity', async () => {
  const calls = [];
  let executedDocument = '';
  const compiler = createCompiler({
    lualatexPath: 'fake-lualatex',
    dvisvgmPath: 'fake-dvisvgm',
    timeoutMs: 1_000,
    execute: async (command, args, options) => {
      calls.push({ command, args });
      if (command === 'fake-lualatex') {
        executedDocument = await readFile(`${options.cwd}/input.tex`, 'utf8');
        await writeFile(`${options.cwd}/input.dvi`, 'dvi', 'utf8');
      } else {
        await writeFile(
          `${options.cwd}/output.svg`,
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
          'utf8',
        );
      }
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    },
  });

  const result = await compiler.render(source);
  const identity = compilerInputIdentity('sha256:graph-worker');

  assert.equal(TIKZ_COMPILER_PROFILE, 'tikz-luatex-graphdrawing-v1');
  assert.equal(TIKZ_WRAPPER_ID, 'tikz-standalone-luatex-dvisvgm/v1');
  assert.match(executedDocument, /\\usetikzlibrary\{[^}]*graphdrawing[^}]*\}/u);
  assert.match(executedDocument, /\\usegdlibrary\{trees,layered,force,circular,routing\}/u);
  assert.deepEqual(calls[0], {
    command: 'fake-lualatex',
    args: [
      '--output-format=dvi',
      '--no-shell-escape',
      '--halt-on-error',
      '--interaction=nonstopmode',
      '--file-line-error',
      'input.tex',
    ],
  });
  assert.ok(calls[1].args.includes('input.dvi'));
  assert.equal(result.renderer, 'lualatex-dvi-dvisvgm');
  assert.equal(result.profile, TIKZ_COMPILER_PROFILE);
  assert.equal(
    identity.bundleIdentity,
    'texlive-luatex-immutable-tree@sha256:graph-worker',
  );
});
