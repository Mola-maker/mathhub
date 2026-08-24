import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('packages compiler identity inputs into both runtime stages', async () => {
  const dockerfile = await readFile(
    new URL('./Dockerfile', import.meta.url),
    'utf8',
  );
  assert.equal(
    dockerfile.match(/services\/tikz-compiler\/provenance\.mjs/g)?.length,
    3,
  );
  assert.equal(
    dockerfile.match(/lib\/tikz\/syntax\/exact-profile\.json/g)?.length,
    3,
  );
  assert.equal(
    dockerfile.match(/lib\/tikz\/syntax\/luatex-graphdrawing-profile\.json/g)
      ?.length,
    3,
  );
  assert.match(dockerfile, /FROM api AS api-graphdrawing/u);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS worker-graphdrawing/u);
  assert.match(dockerfile, /ENV TIKZ_COMPILER_PROFILE=tikz-luatex-graphdrawing-v1/u);
  assert.match(dockerfile, /texlive-luatex/u);
  assert.match(dockerfile, /warmup-graphdrawing\.tex/u);
});

test('production Compose uses one immutable Worker reference for image and proof', async () => {
  const compose = await readFile(
    new URL('../../deploy/ecs/compose.production.yaml', import.meta.url),
    'utf8',
  );
  assert.equal(
    compose.match(/image: \$\{COMPILER_WORKER_IMAGE_REF:/g)?.length,
    1,
  );
  assert.equal(
    compose.match(/COMPILER_WORKER_IMAGE_REF: \$\{COMPILER_WORKER_IMAGE_REF:/g)
      ?.length,
    2,
  );
  assert.doesNotMatch(
    compose,
    /COMPILER_WORKER_(?:DIGEST|IMAGE_DIGEST)/,
  );
});

test('local Compose explicitly permits the development Worker identity', async () => {
  const compose = await readFile(new URL('./compose.yaml', import.meta.url), 'utf8');
  assert.equal(
    compose.match(/NODE_ENV: development/g)?.length,
    2,
  );
  assert.equal(
    compose.match(/COMPILER_WORKER_IMAGE_REF: dev-tectonic-/g)?.length,
    2,
  );
});

test('one-command local Studio selects an available native exact engine without hiding its identity', async () => {
  const [packageJson, launcher, localServer] = await Promise.all([
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../../tools/dev-tikz-studio.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./local-dev-server.mjs', import.meta.url), 'utf8'),
  ]);
  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(scripts['dev:tikz'], 'node tools/dev-tikz-studio.mjs');
  assert.match(launcher, /TIKZ_COMPILER_URL/);
  assert.match(launcher, /TIKZ_COMPILER_TOKEN/);
  assert.match(launcher, /local-dev-server\.mjs/);
  assert.match(launcher, /node_modules\/next\/dist\/bin\/next/);
  assert.match(localServer, /TIKZ_LOCAL_TEX_ENGINE/);
  assert.match(localServer, /\['tectonic', 'xelatex', 'pdflatex'\]/);
  assert.match(localServer, /compilerPath:\s*selectedCompilerRuntime/);
  assert.match(localServer, /local-\$\{selectedEngine\}-native-dev/);
  assert.match(localServer, /MIKTEX_LOG_DIR/);
  assert.match(localServer, /probeExecutable\(dvisvgmPath\)/);
  assert.match(localServer, /graphdrawing profile requires TIKZ_LOCAL_TEX_ENGINE=lualatex/);
});
