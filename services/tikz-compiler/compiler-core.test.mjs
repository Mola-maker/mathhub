import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CompilerError,
  compileCacheKeyDigest,
  compilerInputIdentity,
  createCompiler,
  sanitizeCompiledSvg,
  validateTikzSource,
  wrapTikzDocument,
} from './compiler-core.mjs';

const source = String.raw`
  \begin{tikzpicture}
  \draw (0,0) -- (1,1);
  \end{tikzpicture}
`;

test('validates the single TikZ environment and rejects TeX file access', () => {
  assert.equal(validateTikzSource(source), source);
  assert.throws(
    () => validateTikzSource(String.raw`\begin{tikzpicture}\input{secret}\end{tikzpicture}`),
    (error) => error instanceof CompilerError
      && error.code === 'SOURCE_POLICY_VIOLATION'
      && error.diagnostics?.[0]?.rule === 'blocked-control-sequence',
  );
  assert.throws(
    () => validateTikzSource(String.raw`\begin{tikzpicture}\directlua{os.execute('id')}\end{tikzpicture}`),
    (error) => error instanceof CompilerError
      && error.code === 'SOURCE_POLICY_VIOLATION'
      && error.diagnostics?.[0]?.command === String.raw`\directlua`,
  );
});

test('the pinned exact wrapper preloads the static graph syntax libraries', () => {
  const wrapped = wrapTikzDocument(String.raw`\begin{tikzpicture}\graph { a -> b };\end{tikzpicture}`);
  assert.match(wrapped, /\\usetikzlibrary\{[^}]*graphs[^}]*graphs\.standard[^}]*\}/);
  assert.doesNotMatch(wrapped, /graphdrawing/);
});

test('sanitizes active SVG while preserving local fragment references', () => {
  const clean = sanitizeCompiledSvg(
    '<svg onload="bad()"><script>bad()</script><image href="https://evil/x"/>'
      + '<use href="#glyph"/><path style="fill:url(https://evil/y)"/></svg>',
  );
  assert.doesNotMatch(clean, /onload|script|image|https:\/\/evil/);
  assert.match(clean, /href="#glyph"/);
});

test('cache identity changes with the exact profile manifest', () => {
  const identity = compilerInputIdentity('worker-image');
  const common = {
    compilerImageDigest: 'worker-image',
    visibility: 'private',
    submittedSourceDigest: 'source-digest',
    ...identity,
  };
  assert.notEqual(
    compileCacheKeyDigest(common),
    compileCacheKeyDigest({
      ...common,
      profileManifestDigest: 'different-profile-manifest',
    }),
  );
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

test('native pdflatex mode emits DVI so pgfsys-dvisvgm specials remain intact', async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args });
    if (command === 'fake-pdflatex') {
      await writeFile(`${options.cwd}/input.dvi`, 'dvi', 'utf8');
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
    engine: 'pdflatex',
    tectonicPath: 'fake-pdflatex',
    dvisvgmPath: 'fake-dvisvgm',
    execute,
    timeoutMs: 1_000,
  });

  const result = await compiler.render(source);

  assert.equal(result.renderer, 'pdflatex-dvi-dvisvgm-local-dev');
  assert.ok(calls[0].args.includes('-output-format=dvi'));
  assert.ok(calls[1].args.includes('input.dvi'));
  assert.ok(calls[1].args.includes('--no-fonts'));
  assert.ok(calls[1].args.includes('--exact'));
  assert.ok(!calls[1].args.includes('--pdf'));
});

test('native pdflatex failures retain stdout diagnostics before MiKTeX notices', async () => {
  const compiler = createCompiler({
    engine: 'pdflatex',
    tectonicPath: 'fake-pdflatex',
    dvisvgmPath: 'fake-dvisvgm',
    execute: async () => ({
      exitCode: 1,
      signal: null,
      stdout: 'input.tex:42: Undefined control sequence.',
      stderr: 'pdflatex: major issue: check for updates',
    }),
    timeoutMs: 1_000,
  });

  await assert.rejects(
    () => compiler.render(source),
    (error) => (
      error?.code === 'PDFLATEX_FAILED'
      && error.message.indexOf('input.tex:42')
        < error.message.indexOf('pdflatex: major issue')
    ),
  );
});

test('native xelatex mode emits XDV and converts Unicode text as paths', async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args });
    if (command === 'fake-xelatex') {
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
    engine: 'xelatex',
    tectonicPath: 'fake-xelatex',
    dvisvgmPath: 'fake-dvisvgm',
    execute,
    timeoutMs: 1_000,
  });

  const result = await compiler.render('\\begin{tikzpicture}\\node {九点圆};\\end{tikzpicture}');

  assert.equal(result.renderer, 'xelatex-xdv-dvisvgm-local-dev');
  assert.ok(calls[0].args.includes('-no-pdf'));
  assert.ok(calls[1].args.includes('--no-fonts'));
  assert.ok(calls[1].args.includes('--exact'));
  assert.ok(calls[1].args.includes('input.xdv'));
});

test('native MiKTeX modes can disable the interactive package installer', async () => {
  for (const [engine, outputName] of [
    ['pdflatex', 'input.dvi'],
    ['xelatex', 'input.xdv'],
    ['lualatex', 'input.dvi'],
  ]) {
    const calls = [];
    const execute = async (command, args, options) => {
      calls.push({ command, args });
      if (command === `fake-${engine}`) {
        await writeFile(`${options.cwd}/${outputName}`, outputName, 'utf8');
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
      engine,
      compilerPath: `fake-${engine}`,
      dvisvgmPath: 'fake-dvisvgm',
      disablePackageInstaller: true,
      execute,
      timeoutMs: 1_000,
    });

    await compiler.render(source);

    assert.equal(calls[0].command, `fake-${engine}`);
    assert.ok(
      calls[0].args.includes('--disable-installer'),
      `${engine} must never open MiKTeX's package installer`,
    );
    assert.ok(!calls[1].args.includes('--disable-installer'));
  }
});
