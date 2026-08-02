import {
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import OSS from 'ali-oss';
import { CompilerError } from './compiler-core.mjs';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const STS_FETCH_TIMEOUT_MS = 5_000;

function assertArtifactKey(key) {
  if (!/^tikz\/v1\/(?:public|private)\/[a-f0-9]{64}\.svg$/.test(key)) {
    throw new CompilerError('非法 artifact key', 400, 'INVALID_ARTIFACT_KEY');
  }
}

function immutableArtifactError(key) {
  return new CompilerError(
    `Immutable artifact bytes do not match existing object: ${key}`,
    409,
    'ARTIFACT_IMMUTABILITY_VIOLATION',
  );
}

function assertArtifactVisibility(key, visibility) {
  if (
    (visibility !== 'public' && visibility !== 'private')
    || !key.startsWith(`tikz/v1/${visibility}/`)
  ) {
    throw new CompilerError(
      'Artifact key namespace does not match visibility',
      400,
      'ARTIFACT_VISIBILITY_MISMATCH',
    );
  }
}

function objectAlreadyExists(error) {
  return error?.status === 409
    || error?.statusCode === 409
    || error?.code === 'FileAlreadyExists'
    || error?.code === 'ObjectAlreadyExists';
}

function lowerCaseHeaders(result) {
  const input = result?.res?.headers ?? result?.headers ?? {};
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim(),
    ]),
  );
}

async function refreshStsToken(url, bearerToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: bearerToken
        ? { Authorization: `Bearer ${bearerToken}` }
        : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`STS broker returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const accessKeyId = payload.accessKeyId ?? payload.AccessKeyId;
    const accessKeySecret = payload.accessKeySecret ?? payload.AccessKeySecret;
    const stsToken = (
      payload.stsToken
      ?? payload.securityToken
      ?? payload.SecurityToken
    );
    if (!accessKeyId || !accessKeySecret || !stsToken) {
      throw new Error('STS broker response is incomplete');
    }
    return { accessKeyId, accessKeySecret, stsToken };
  } finally {
    clearTimeout(timer);
  }
}

export class LocalArtifactStore {
  constructor(root = process.env.ARTIFACT_LOCAL_DIR || '/artifacts') {
    this.root = resolve(root);
  }

  pathFor(key) {
    assertArtifactKey(key);
    const file = resolve(join(this.root, ...key.split('/')));
    if (!file.startsWith(`${this.root}${sep}`)) {
      throw new CompilerError('artifact 路径越界', 400, 'INVALID_ARTIFACT_KEY');
    }
    return file;
  }

  async put({ key, svg, visibility }) {
    assertArtifactVisibility(key, visibility);
    const file = this.pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    const payload = Buffer.from(svg, 'utf8');
    await writeFile(temporary, payload);
    try {
      // Publish a fully written file atomically without replacing an existing
      // content-addressed artifact.
      await link(temporary, file);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(file);
      if (!existing.equals(payload)) {
        throw immutableArtifactError(key);
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { artifactKey: key, artifactUrl: null };
  }

  async get(key) {
    return readFile(this.pathFor(key));
  }
}

export class OssArtifactStore {
  constructor(options = {}) {
    const region = options.region ?? process.env.OSS_REGION;
    const bucket = options.bucket ?? process.env.OSS_BUCKET;
    const accessKeyId = options.accessKeyId ?? process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = (
      options.accessKeySecret
      ?? process.env.OSS_ACCESS_KEY_SECRET
    );
    if (!region || !bucket || !accessKeyId || !accessKeySecret) {
      throw new CompilerError(
        'OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET are required',
        503,
        'OSS_NOT_CONFIGURED',
      );
    }
    this.client = options.client ?? new OSS({
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      stsToken: options.stsToken ?? process.env.OSS_STS_TOKEN,
      endpoint: options.endpoint ?? process.env.OSS_ENDPOINT,
      secure: true,
      internal: (options.internal ?? process.env.OSS_INTERNAL) === 'true',
      refreshSTSToken: process.env.OSS_STS_REFRESH_URL
        ? () => refreshStsToken(
          process.env.OSS_STS_REFRESH_URL,
          process.env.OSS_STS_REFRESH_TOKEN,
        )
        : undefined,
      refreshSTSTokenInterval: Number(
        process.env.OSS_STS_REFRESH_INTERVAL_MS ?? 300_000,
      ),
    });
    this.cdnBaseUrl = (
      options.cdnBaseUrl
      ?? process.env.OSS_CDN_BASE_URL
      ?? ''
    ).replace(/\/+$/, '');
    this.allowPublicAcl = (
      options.allowPublicAcl
      ?? process.env.OSS_ALLOW_PUBLIC_ACL
    ) === 'true';
  }

  async put({ key, svg, visibility }) {
    assertArtifactKey(key);
    assertArtifactVisibility(key, visibility);
    const payload = Buffer.from(svg, 'utf8');
    try {
      await this.client.put(key, payload, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': visibility === 'public'
            ? IMMUTABLE_CACHE
            : 'private, no-store',
          'x-oss-object-acl': (
            visibility === 'public' && this.allowPublicAcl
              ? 'public-read'
              : 'private'
          ),
          // PutObject does not support If-None-Match. OSS exposes this
          // documented create-only header for atomic non-overwriting uploads.
          'x-oss-forbid-overwrite': 'true',
        },
      });
    } catch (error) {
      if (!objectAlreadyExists(error)) throw error;
      const existing = await this.get(key);
      if (!existing.equals(payload)) {
        throw immutableArtifactError(key);
      }
      await this.assertExistingPublicationPolicy(key, visibility);
    }
    return {
      artifactKey: key,
      artifactUrl: visibility === 'public' && this.cdnBaseUrl
        ? `${this.cdnBaseUrl}/${key}`
        : null,
    };
  }

  async assertExistingPublicationPolicy(key, visibility) {
    const [head, acl] = await Promise.all([
      this.client.head(key),
      this.client.getACL(key),
    ]);
    const headers = lowerCaseHeaders(head);
    const expectedCacheControl = visibility === 'public'
      ? IMMUTABLE_CACHE
      : 'private, no-store';
    const expectedAcl = visibility === 'public' && this.allowPublicAcl
      ? 'public-read'
      : 'private';
    if (
      headers['content-type']?.toLowerCase()
        !== 'image/svg+xml; charset=utf-8'
      || headers['cache-control'] !== expectedCacheControl
      || acl?.acl !== expectedAcl
    ) {
      throw new CompilerError(
        `Existing artifact metadata does not match publication policy: ${key}`,
        409,
        'ARTIFACT_PUBLICATION_POLICY_MISMATCH',
      );
    }
  }

  async get(key) {
    assertArtifactKey(key);
    const result = await this.client.get(key);
    return Buffer.isBuffer(result.content)
      ? result.content
      : Buffer.from(result.content);
  }
}

export function createArtifactStore() {
  const driver = process.env.ARTIFACT_DRIVER || 'local';
  if (driver === 'local') return new LocalArtifactStore();
  if (driver === 'oss') return new OssArtifactStore();
  throw new CompilerError(
    `Unsupported ARTIFACT_DRIVER: ${driver}`,
    503,
    'ARTIFACT_DRIVER_INVALID',
  );
}
