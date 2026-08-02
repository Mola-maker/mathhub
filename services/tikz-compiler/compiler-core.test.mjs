import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CompilerError,
  createCompiler,
  sanitizeCompiledSvg,
  validateTikzSource,
} from './compiler-core.mjs';

const source = String.raw`
  \begin{tikzpicture}
  \draw (0,0) -- (1,1);
  \end{tikzpicture}
`;

test('validates the single TikZ environment and rejects TeX file access', () => {
  assert.equal(validateTikzSource(source), source.trim());
  assert.throws(
    () => validateTikzSource(String.raw`\begin{tikzpicture}\input{secret}\end{tikzpicture}`),
    (error) => error instanceof CompilerError && error.code === 'FORBIDDEN_COMMAND',
  );
});

test('sanitizes active SVG while preserving local fragment references', () => {
  const clean = sanitizeCompiledSvg(
    '<svg onload="bad()"><script>bad()</script><image href="https://evil/x"/>'
      + '<use href="#glyph"/><path style="fill:url(https://evil/y)"/></svg>',
  );
  assert.doesNotMatch(clean, /onload|script|image|https:\/\/evil/);
  assert.match(clean, /href="#glyph"/);
});

test('serial compiler caches a successful content-addressed result', async () => {
  const calls = [];
  const execute = async (command, _args, options) => {
    calls.push(command);
    if (command === 'fake-tectonic') {
      await writeFile(`${options.cwd}/input.xdv`, 'xdv', 'utf8');
    } else {
      await writeFile(
        `${options.cwd}/output.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
        'utf8',
      );
    }
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  const compiler = createCompiler({
    tectonicPath: 'fake-tectonic',
    dvisvgmPath: 'fake-dvisvgm',
    execute,
    timeoutMs: 1_000,
  });

  const first = await compiler.render(source);
  const second = await compiler.render(source);

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.sourceHash, second.sourceHash);
  assert.deepEqual(calls, ['fake-tectonic', 'fake-dvisvgm']);
});
