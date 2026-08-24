import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type RegistryShardMetadata = {
  id: string;
  file: string;
  digest: string;
  entryCount: number;
  byteSize: number;
  surface: string;
  status: string;
};

type RegistryManifest = {
  schema: string;
  upstream: { sha: string };
  scanner: { filesScanned: number };
  totalEntries: number;
  shards: RegistryShardMetadata[];
  diagnostics: Array<{ code: string; message: string }>;
};

const bundleDirectory = path.resolve(
  process.cwd(),
  'lib/tikz/syntax/generated/pgf-3.1.11a-registry-sharded',
);

describe('generated official PGF/TikZ registry bundle', () => {
  it('keeps every content-addressed shard bound to the pinned upstream inventory', () => {
    const manifest = JSON.parse(readFileSync(
      path.join(bundleDirectory, 'manifest.json'),
      'utf8',
    )) as RegistryManifest;

    expect(manifest.schema).toBe('pgf-upstream-registry-bundle/v1');
    expect(manifest.upstream.sha).toBe('0a859c80b47a1f3e07b8164aec6de861c4118e2a');
    expect(manifest.scanner.filesScanned).toBe(184);
    expect(manifest.totalEntries).toBe(14_987);
    expect(manifest.shards).toHaveLength(34);

    let totalEntries = 0;
    for (const shard of manifest.shards) {
      const bytes = readFileSync(path.join(bundleDirectory, shard.file));
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const payload = JSON.parse(bytes.toString('utf8')) as {
        schema: string;
        id: string;
        surface: string;
        status: string;
        entries: unknown[];
      };
      expect(bytes.byteLength).toBe(shard.byteSize);
      expect(digest).toBe(shard.digest);
      expect(payload.schema).toBe('pgf-upstream-registry-shard/v1');
      expect(payload.id).toBe(shard.id);
      expect(payload.surface).toBe(shard.surface);
      expect(payload.status).toBe(shard.status);
      expect(payload.entries).toHaveLength(shard.entryCount);
      totalEntries += payload.entries.length;
    }
    expect(totalEntries).toBe(manifest.totalEntries);
    expect(manifest.diagnostics.some((diagnostic) => (
      diagnostic.code === 'unsupported-surface'
      && diagnostic.message.includes('Lua graph-drawing')
    ))).toBe(true);
  });
});
