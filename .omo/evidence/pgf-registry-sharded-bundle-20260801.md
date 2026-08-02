# PGF registry sharded bundle evidence

Date: 2026-08-02 (implementation snapshot for the 2026-08-01 architecture tranche)

## Scope

`tools/generate-pgf-registry.mjs` retains its default TypeScript output and
adds the explicit `--format sharded-json` build output. Shards are grouped by
entry `status` and `surface`, capped at 512 entries, and named by the SHA-256
digest of their complete deterministic JSON bytes. The output directory is
owned by the generator only for `manifest.json` and generated 64-hex shard
filenames; manifest references are safe relative basenames.

## Offline sizing smoke

Invocation (local MiKTeX PGF source; no TeX executable, network, Docker,
project tests, build, lint, or typecheck invoked):

```powershell
$out = 'C:\Users\22494\AppData\Local\Temp\pgf-registry-sharded-smoke-20260802021000000'
node tools/generate-pgf-registry.mjs `
  --checkout 'C:\Program Files\MiKTeX\tex\generic\pgf' `
  --version 3.1.11a `
  --sha 839974a3f895bfb86f5a8bc155f0886c918f1bff `
  --format sharded-json `
  --output $out
```

Binary observables captured from `$out/manifest.json` and the referenced
shards:

- generator output: `14,654` entries from `180` `.code.tex` files, `33`
  shards, `maxEntriesPerShard=512`;
- `manifest.schema=pgf-upstream-registry-bundle/v1` and every shard has
  `schema=pgf-upstream-registry-shard/v1`;
- the sum of manifest shard `count` values is `14,654`;
- all `33` shard files exist, each has at most `512` entries, and each
  descriptor carries matching `count`/`entryCount`, UTF-8 `byteSize`,
  `surface`, and `status`; each file's `Get-FileHash -Algorithm SHA256`
  equals the manifest `sha256:<hex>` digest;
- every manifest shard `file` is a basename with no slash or `..` component;
- `scanner.fileInventory.count=180` with digest
  `sha256:0fd9e0ad2f109d1a3d215b936aed1061030f0046aa0dd2bad606eedf8b1847ad`;
- scanner include/exclude rules are recorded as `**/*.code.tex`, `.git/**`,
  and `node_modules/**`; a typed `unsupported-surface` diagnostic explicitly
  records that manual prose, driver, Lua graph-drawing, and other upstream
  surfaces are outside this `.code.tex` inventory;
- generated directory size is `26,960,570` bytes (`25.71 MiB`), with the
  manifest at `25,686` bytes and largest shard at `1,002,409` bytes.

## Determinism smoke

The same invocation was repeated into
`C:\Users\22494\AppData\Local\Temp\pgf-registry-sharded-smoke-repeat-20260802021100000`.
Both directories contained `34` files with identical sorted names and
identical SHA-256 hashes (`SameNames=True`, `SameHashes=True`).

## Compatibility smoke

Invocation:

```powershell
$out = 'C:\Users\22494\AppData\Local\Temp\pgf-registry-typescript-compat-20260802021200000.ts'
node tools/generate-pgf-registry.mjs `
  --checkout 'C:\Program Files\MiKTeX\tex\generic\pgf' `
  --version 3.1.11a `
  --sha 839974a3f895bfb86f5a8bc155f0886c918f1bff `
  --format typescript `
  --output $out
```

The command emitted the legacy TypeScript header/import and a `26,932,282`
byte registry artifact in system temp, preserving the default format path.

## Static script check

`node --check tools/generate-pgf-registry.mjs` exited `0`.
