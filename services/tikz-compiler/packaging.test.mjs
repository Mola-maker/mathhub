import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('packages provenance into both compiler runtime stages', async () => {
  const dockerfile = await readFile(
    new URL('./Dockerfile', import.meta.url),
    'utf8',
  );
  assert.equal(
    dockerfile.match(/services\/tikz-compiler\/provenance\.mjs/g)?.length,
    2,
  );
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
