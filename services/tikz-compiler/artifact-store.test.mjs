import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalArtifactStore, OssArtifactStore } from './artifact-store.mjs';

const digest = 'a'.repeat(64);
const publicKey = `tikz/v1/public/${digest}.svg`;
const privateKey = `tikz/v1/private/${digest}.svg`;
const svg = '<svg><path /></svg>';

test('publishes equal bytes into isolated public and private namespaces', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tikz-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalArtifactStore(root);

  await store.put({ key: publicKey, svg, visibility: 'public' });
  await store.put({ key: privateKey, svg, visibility: 'private' });

  assert.equal(
    (await readFile(store.pathFor(publicKey))).toString('utf8'),
    svg,
  );
  assert.equal(
    (await readFile(store.pathFor(privateKey))).toString('utf8'),
    svg,
  );
  assert.notEqual(store.pathFor(publicKey), store.pathFor(privateKey));
});

test('does not replace an existing immutable local object', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tikz-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalArtifactStore(root);

  await store.put({ key: privateKey, svg, visibility: 'private' });
  await assert.rejects(
    store.put({
      key: privateKey,
      svg: '<svg><circle /></svg>',
      visibility: 'private',
    }),
    { code: 'ARTIFACT_IMMUTABILITY_VIOLATION' },
  );
});

test('uses OSS create-only semantics and verifies an existing object', async () => {
  const calls = [];
  const client = {
    async put(key, payload, options) {
      calls.push({ key, payload, options });
      const error = new Error('exists');
      error.status = 409;
      error.code = 'FileAlreadyExists';
      throw error;
    },
    async get() {
      return { content: Buffer.from(svg, 'utf8') };
    },
    async head() {
      return {
        res: {
          headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        },
      };
    },
    async getACL() {
      return { acl: 'private' };
    },
  };
  const store = new OssArtifactStore({
    region: 'oss-test',
    bucket: 'test',
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    client,
  });

  await store.put({ key: publicKey, svg, visibility: 'public' });
  assert.equal(
    calls[0].options.headers['x-oss-forbid-overwrite'],
    'true',
  );
});

test('fails closed when an existing OSS object has the wrong policy', async () => {
  const client = {
    async put() {
      const error = new Error('exists');
      error.status = 409;
      throw error;
    },
    async get() {
      return { content: Buffer.from(svg, 'utf8') };
    },
    async head() {
      return {
        res: {
          headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'private, no-store',
          },
        },
      };
    },
    async getACL() {
      return { acl: 'private' };
    },
  };
  const store = new OssArtifactStore({
    region: 'oss-test',
    bucket: 'test',
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    client,
  });

  await assert.rejects(
    store.put({ key: publicKey, svg, visibility: 'public' }),
    { code: 'ARTIFACT_PUBLICATION_POLICY_MISMATCH' },
  );
});
