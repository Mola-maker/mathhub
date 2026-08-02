import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWorkerProvenance,
  workerImageDigestFromReference,
} from './provenance.mjs';

const image = `sha256:${'a'.repeat(64)}`;

test('derives provenance from the same immutable image reference used by Compose', () => {
  assert.equal(
    workerImageDigestFromReference(
      `registry.example/math-geohub-worker@${image}`,
      true,
    ),
    image,
  );
  assert.throws(
    () => workerImageDigestFromReference(image, true),
    /repository@sha256/,
  );
});

test('accepts Worker-observed image and source provenance', () => {
  assert.doesNotThrow(() => assertWorkerProvenance(
    { compilerImageDigest: image, sourceDigest: 'source-a' },
    { sourceHash: 'source-a' },
    image,
  ));
});

test('rejects a job routed to the wrong Worker image', () => {
  assert.throws(
    () => assertWorkerProvenance(
      { compilerImageDigest: `sha256:${'b'.repeat(64)}`, sourceDigest: 'source-a' },
      { sourceHash: 'source-a' },
      image,
    ),
    { code: 'WORKER_IMAGE_MISMATCH' },
  );
});

test('rejects source bytes that differ at the Worker boundary', () => {
  assert.throws(
    () => assertWorkerProvenance(
      { compilerImageDigest: image, sourceDigest: 'source-a' },
      { sourceHash: 'source-b' },
      image,
    ),
    { code: 'WORKER_SOURCE_MISMATCH' },
  );
});
