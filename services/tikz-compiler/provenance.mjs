import { createHash } from 'node:crypto';
import {
  CompilerError,
  TIKZ_COMPILER_PROFILE,
} from './compiler-core.mjs';

const PRODUCTION_IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMMUTABLE_IMAGE_REFERENCE = /^(?<repository>[^@\s]+)@(?<digest>sha256:[a-f0-9]{64})$/;
const DEVELOPMENT_IMAGE_ID = /^dev-[a-z0-9][a-z0-9._-]{2,127}$/;

export function workerImageDigestFromReference(reference, production = false) {
  const configured = reference?.trim() ?? '';
  const immutable = IMMUTABLE_IMAGE_REFERENCE.exec(configured);
  if (immutable?.groups?.digest) return immutable.groups.digest;
  if (production) {
    throw new Error(
      'COMPILER_WORKER_IMAGE_REF must be a repository@sha256 reference in production',
    );
  }
  if (!configured) {
    return TIKZ_COMPILER_PROFILE === 'tikz-luatex-graphdrawing-v1'
      ? 'dev-texlive-luatex-graphdrawing-dvisvgm'
      : 'dev-tectonic-0.17.0-dvisvgm';
  }
  if (
    !PRODUCTION_IMAGE_DIGEST.test(configured)
    && !DEVELOPMENT_IMAGE_ID.test(configured)
  ) {
    throw new Error('COMPILER_WORKER_IMAGE_REF is invalid');
  }
  return configured;
}

export function compilerWorkerImageDigest() {
  const configured = process.env.COMPILER_WORKER_IMAGE_REF?.trim() ?? '';
  if (process.env.NODE_ENV === 'production') {
    if (!configured) {
      throw new Error(
        'COMPILER_WORKER_IMAGE_REF is required in production',
      );
    }
  }
  return workerImageDigestFromReference(
    configured,
    process.env.NODE_ENV === 'production',
  );
}

export function compilerRedisPrefix(workerImageDigest) {
  const base = process.env.REDIS_PREFIX ?? 'math-geohub:tikz';
  const namespace = createHash('sha256')
    .update(workerImageDigest, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `${base}:image:${namespace}`;
}

export function assertWorkerProvenance(job, result, workerImageDigest) {
  if (job.compilerImageDigest !== workerImageDigest) {
    throw new CompilerError(
      'Compile job does not match this Worker image',
      409,
      'WORKER_IMAGE_MISMATCH',
    );
  }
  const submittedSourceDigest = job.submittedSourceDigest ?? job.sourceDigest;
  const executedSourceDigest = result.executedSourceDigest ?? result.sourceHash;
  if (
    job.sourceDigest !== submittedSourceDigest
    || result.sourceHash !== executedSourceDigest
    || executedSourceDigest !== submittedSourceDigest
  ) {
    throw new CompilerError(
      'Worker-observed source digest does not match the compile job',
      409,
      'WORKER_SOURCE_MISMATCH',
    );
  }
  const identityFields = [
    'cacheKeyVersion',
    'profile',
    'sourcePolicy',
    'wrapperId',
    'wrapperDigest',
    'bundleIdentity',
    'profileManifestDigest',
  ];
  const hasExplicitInputIdentity = identityFields.some(
    (field) => job[field] !== undefined || result[field] !== undefined,
  );
  if (
    hasExplicitInputIdentity
    && (
      identityFields.some((field) => job[field] !== result[field])
      || typeof result.executedDocumentDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(result.executedDocumentDigest)
    )
  ) {
    throw new CompilerError(
      'Worker input envelope does not match the compile job',
      409,
      'WORKER_INPUT_IDENTITY_MISMATCH',
    );
  }
}
