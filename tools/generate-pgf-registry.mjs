#!/usr/bin/env node

/**
 * Generate a PGF/TikZ source registry from an explicit local checkout.
 *
 * This script is intentionally offline. It never fetches a repository, runs
 * git, executes TeX, or evaluates a macro. Static pgfkeys/pgfkeysdef,
 * declaration commands, environments, libraries, and pgf math functions are
 * classified. Dynamic and unrecognized source is emitted as provenance-rich
 * opaque entries instead of being silently dropped or described as complete.
 *
 * Usage:
 *   node tools/generate-pgf-registry.mjs \
 *     --checkout C:\\src\\pgf \
 *     --version 3.1.11a \
 *     --sha 839974a3f895bfb86f5a8bc155f0886c918f1bff \
 *     --output lib/tikz/syntax/generated/pgf-3.1.11a-registry.ts
 *
 * A build-time bundle can be emitted without placing the complete registry in
 * a browser/Next.js module:
 *
 *   node tools/generate-pgf-registry.mjs \
 *     --checkout C:\\src\\pgf \
 *     --version 3.1.11a \
 *     --sha 839974a3f895bfb86f5a8bc155f0886c918f1bff \
 *     --format sharded-json \
 *     --output .tmp/pgf-3.1.11a-registry
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPOSITORY = 'https://github.com/pgf-tikz/pgf';
const MANUAL = 'https://pgf-tikz.github.io/pgf/pgfmanual.pdf';
const TYPESCRIPT_FORMAT = 'typescript';
const SHARDED_JSON_FORMAT = 'sharded-json';
const SHARDED_BUNDLE_SCHEMA = 'pgf-upstream-registry-bundle/v1';
const SHARD_SCHEMA = 'pgf-upstream-registry-shard/v1';
const MAX_ENTRIES_PER_SHARD = 512;
const STATUS_ORDER = ['static', 'unsupported', 'dynamic'];
const SURFACE_ORDER = ['command', 'environment', 'key', 'handler', 'library', 'pgf-function'];

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node tools/generate-pgf-registry.mjs --checkout <local-pgf> --version <version> --sha <40-hex-sha> [--format typescript] [--output <file>]');
  console.error('       node tools/generate-pgf-registry.mjs --checkout <local-pgf> --version <version> --sha <40-hex-sha> --format sharded-json --output <directory>');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      usage();
      process.exit(0);
    }
    if (!token.startsWith('--')) usage(`unknown argument ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  if (!args.checkout) usage('--checkout is required and must be a local directory');
  if (!args.version) usage('--version is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.version)) usage('--version may contain only letters, digits, dot, underscore, and hyphen');
  if (!args.sha) usage('--sha is required; the generator does not infer or fetch provenance');
  if (!/^[0-9a-f]{40}$/i.test(args.sha)) usage('--sha must be a full 40-character hexadecimal SHA');
  const format = args.format ?? TYPESCRIPT_FORMAT;
  if (format !== TYPESCRIPT_FORMAT && format !== SHARDED_JSON_FORMAT) {
    usage(`--format must be ${TYPESCRIPT_FORMAT} or ${SHARDED_JSON_FORMAT}`);
  }
  if (format === SHARDED_JSON_FORMAT && !args.output) {
    usage('--output is required for --format sharded-json and must name an output directory');
  }
  const defaultOutput = format === SHARDED_JSON_FORMAT
    ? path.join('lib', 'tikz', 'syntax', 'generated', `pgf-${args.version}-registry-sharded`)
    : path.join('lib', 'tikz', 'syntax', 'generated', `pgf-${args.version}-registry.ts`);
  return {
    checkout: path.resolve(args.checkout),
    version: args.version,
    sha: args.sha,
    format,
    output: path.resolve(args.output ?? defaultOutput),
  };
}

function walkCodeTex(root) {
  const files = [];
  const visit = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'node_modules') continue;
      const full = path.join(directory, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile() && item.name.endsWith('.code.tex')) files.push(full);
    }
  };
  visit(root);
  return files.sort(stableCompare);
}

function relativePosix(root, filename) {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || relative.startsWith('/')) {
    throw new Error(`source path escapes the explicit PGF checkout: ${filename}`);
  }
  return relative;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function sourceOrigin(config, relativePath, line) {
  return {
    repository: REPOSITORY,
    version: config.version,
    sha: config.sha,
    path: relativePath,
    ...(line ? { line: [line, line] } : {}),
  };
}

function stableSuffix(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function uniqueRegistryEntries(entries) {
  const byId = new Map();
  let duplicateCount = 0;
  let collisionCount = 0;
  for (const original of entries) {
    const signature = JSON.stringify(original);
    const existing = byId.get(original.id);
    if (!existing) {
      byId.set(original.id, { entry: original, signature });
      continue;
    }
    if (existing.signature === signature) {
      duplicateCount += 1;
      continue;
    }
    collisionCount += 1;
    const suffix = stableSuffix(signature);
    let candidateId = `${original.id}:collision-${suffix}`;
    let ordinal = 2;
    while (byId.has(candidateId)) {
      const candidate = byId.get(candidateId);
      if (candidate.signature === signature) {
        duplicateCount += 1;
        candidateId = null;
        break;
      }
      candidateId = `${original.id}:collision-${suffix}-${ordinal}`;
      ordinal += 1;
    }
    if (candidateId) {
      const entry = { ...original, id: candidateId };
      byId.set(candidateId, { entry, signature });
    }
  }
  return {
    entries: [...byId.values()].map((value) => value.entry),
    duplicateCount,
    collisionCount,
  };
}

function stableCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSafeRelativePath(relativePath, label) {
  if (
    !relativePath
    || relativePath.startsWith('/')
    || relativePath.includes('\\')
    || relativePath.split('/').includes('..')
    || path.posix.basename(relativePath) !== relativePath
  ) {
    throw new Error(`${label} must be a safe relative basename: ${relativePath}`);
  }
}

function safeOutputChild(outputDirectory, relativePath) {
  assertSafeRelativePath(relativePath, 'generated shard file');
  const root = path.resolve(outputDirectory);
  const candidate = path.resolve(root, relativePath);
  if (path.dirname(candidate) !== root) {
    throw new Error(`generated shard path escapes output directory: ${relativePath}`);
  }
  return candidate;
}

function sourceFileInventory(config, files) {
  const paths = files
    .map((filename) => relativePosix(config.checkout, filename))
    .sort(stableCompare);
  const serializedPaths = jsonBytes(paths);
  return {
    count: paths.length,
    digest: `sha256:${sha256Digest(serializedPaths)}`,
    basis: 'sorted-posix-relative-paths-json',
    paths,
  };
}

function removeGeneratedBundleFiles(outputDirectory) {
  const manifestPath = safeOutputChild(outputDirectory, 'manifest.json');
  let isGeneratedBundle = false;
  if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      isGeneratedBundle = existing?.schema === SHARDED_BUNDLE_SCHEMA;
    } catch {
      // A caller-owned or incomplete manifest is left untouched.
    }
  }
  if (!isGeneratedBundle) return;
  // Only remove the generator's own safe, content-addressed files. Unrelated
  // files and directories in an explicitly supplied output directory remain.
  for (const item of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
    if (!item.isFile()) continue;
    if (item.name === 'manifest.json' || /^[0-9a-f]{64}\.json$/i.test(item.name)) {
      fs.unlinkSync(safeOutputChild(outputDirectory, item.name));
    }
  }
}

function buildShards(entries) {
  const grouped = new Map();
  for (const entryValue of entries) {
    const groupKey = `${entryValue.status}\u0000${entryValue.surface}`;
    const group = grouped.get(groupKey);
    if (group) group.push(entryValue);
    else grouped.set(groupKey, [entryValue]);
  }

  const shards = [];
  for (const status of STATUS_ORDER) {
    for (const surface of SURFACE_ORDER) {
      const group = grouped.get(`${status}\u0000${surface}`);
      if (!group || group.length === 0) continue;
      const ordered = group.slice().sort((left, right) => stableCompare(left.id, right.id));
      for (let offset = 0; offset < ordered.length; offset += MAX_ENTRIES_PER_SHARD) {
        const ordinal = Math.floor(offset / MAX_ENTRIES_PER_SHARD) + 1;
        const id = `${status}-${surface}-${String(ordinal).padStart(4, '0')}`;
        const shard = {
          schema: SHARD_SCHEMA,
          id,
          surface,
          status,
          entries: ordered.slice(offset, offset + MAX_ENTRIES_PER_SHARD),
        };
        const serialized = jsonBytes(shard);
        const digestHex = sha256Digest(serialized);
        const digest = `sha256:${digestHex}`;
        const file = `${digestHex}.json`;
        const entryCount = shard.entries.length;
        shards.push({
          id,
          file,
          digest,
          count: entryCount,
          entryCount,
          byteSize: Buffer.byteLength(serialized, 'utf8'),
          surface,
          status,
          shard,
          serialized,
        });
      }
    }
  }
  return shards;
}

function extractBalanced(source, openOffset) {
  if (source[openOffset] !== '{') return null;
  let depth = 0;
  let escaped = false;
  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return { value: source.slice(openOffset + 1, index), end: index + 1 };
    }
  }
  return null;
}

function nextGroup(source, start) {
  const openOffset = source.indexOf('{', start);
  if (openOffset < 0) return null;
  const balanced = extractBalanced(source, openOffset);
  return balanced ? { openOffset, ...balanced } : null;
}

function splitTopLevel(value, delimiter = ',') {
  const parts = [];
  let depth = 0;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function namespaceForFile(relativePath, library) {
  if (library) return `/tikz/${library}`;
  if (relativePath.includes('/math/')) return '/pgf/math';
  if (relativePath.includes('/utilities/')) return '/pgf';
  return '/tikz';
}

function fileLibrary(relativePath) {
  const basename = path.posix.basename(relativePath);
  const tikz = basename.match(/^tikzlibrary(.+)\.code\.tex$/);
  if (tikz) return tikz[1];
  const pgf = basename.match(/^pgflibrary(.+)\.code\.tex$/);
  return pgf ? pgf[1] : null;
}

function securityFor(expansion, status) {
  if (status === 'dynamic' || expansion === 'dynamic') {
    return {
      level: 'high',
      tags: ['untrusted-tex', 'macro-expansion', 'resource-exhaustion', 'external-process'],
      summary: 'Dynamic TeX source is preserved but not statically interpreted.',
      mitigations: ['Use isolated exact TeX with expansion/resource budgets.', 'Never expose the entry to Canvas writeback.'],
    };
  }
  if (expansion !== 'none') {
    return {
      level: 'moderate',
      tags: ['untrusted-tex', 'macro-expansion', 'resource-exhaustion'],
      summary: 'Macro or key-handler expansion can consume TeX resources.',
      mitigations: ['Bound expansion depth, CPU, memory, and output size.', 'Compile outside the Next.js process.'],
    };
  }
  return {
    level: 'low',
    tags: ['user-content'],
    summary: 'Declarative user TikZ remains untrusted input.',
    mitigations: ['Compile in the isolated TeX service.', 'Apply request and artifact size limits.'],
  };
}

function lanesFor(status, surface) {
  if (status !== 'static') return { preserve: true, parse: 'opaque', preview: 'opaque', exact: 'server' };
  if (surface === 'command' || surface === 'environment') return { preserve: true, parse: 'partial', preview: 'opaque', exact: 'server' };
  return { preserve: true, parse: 'partial', preview: 'opaque', exact: 'server' };
}

function diagnostic(config, relativePath, line, code, message) {
  return { code, message, source: sourceOrigin(config, relativePath, line) };
}

function entry(config, relativePath, line, values) {
  const status = values.status ?? 'static';
  const expansion = values.effects?.expansion ?? 'none';
  const output = {
    id: `pgf-${config.version}:${values.surface}:${values.identity}:${stableSuffix(`${relativePath}:${line}:${values.identity}`)}`,
    title: values.title ?? values.identity,
    surface: values.surface,
    status,
    upstream: sourceOrigin(config, relativePath, line),
    namespaces: values.namespaces ?? [namespaceForFile(relativePath, values.library)],
    ...(values.keyPath ? { keyPath: values.keyPath } : {}),
    valueGrammar: values.valueGrammar ?? { kind: 'opaque', description: 'Static scanner did not infer a richer grammar.' },
    effects: values.effects ?? { scope: 'local', expansion, outputs: [] },
    lanes: values.lanes ?? lanesFor(status, values.surface),
    writeback: values.writeback ?? (status === 'static' ? 'transaction-only' : 'never'),
    security: values.security ?? securityFor(expansion, status),
    ...(values.diagnostics?.length ? { diagnostics: values.diagnostics } : {}),
    ...(values.notes?.length ? { notes: values.notes } : {}),
  };
  return output;
}

function keyPathFromSegment(segment, defaultNamespace) {
  const trimmed = segment.trim();
  if (!trimmed || trimmed.startsWith('%')) return null;
  const left = trimmed.split('=')[0].trim();
  if (!left || left.startsWith('#')) return null;
  const value = left.startsWith('/') ? left : `${defaultNamespace}/${left}`;
  return value.replace(/\s+/g, ' ');
}

function grammarForKey(keyPath, segment) {
  const lower = segment.toLocaleLowerCase();
  if (/\/(?:\.code|\.style|\.code\s+\d+\s+args|\.add\s+code)/.test(keyPath)) {
    return { kind: 'balanced-group', description: 'Executable pgfkeys handler body' };
  }
  if (keyPath.endsWith('/.is family')) return { kind: 'none', description: 'Key family declaration' };
  if (keyPath.endsWith('/.initial') || keyPath.endsWith('/.default')) return { kind: 'token', description: 'Default/initial key value' };
  if (lower.includes('key value') || lower.includes('=') || keyPath.includes('intersections')) return { kind: 'key-value', description: 'Comma-separated pgfkeys list' };
  return { kind: 'token', description: 'Token or balanced value' };
}

function expansionForBody(body) {
  if (/\\(?:foreach|pgffor|tikz@scan|pgfutil@ifnextchar)/.test(body)) return 'foreach';
  if (/\\(?:csname|expandafter|def|gdef|edef|xdef|let|futurelet)/.test(body)) return 'macro';
  if (/\\(?:pgf|tikz)/.test(body)) return 'tex';
  return 'none';
}

function scanPgfkeys(config, source, relativePath, entries, manifestDiagnostics) {
  const defaultNamespace = namespaceForFile(relativePath, fileLibrary(relativePath));
  const commandPattern = /\\(?:pgfkeys(?:def|edef|also)?|tikzset)\b/g;
  let match;
  while ((match = commandPattern.exec(source)) !== null) {
    const first = nextGroup(source, match.index + match[0].length);
    if (!first) {
      manifestDiagnostics.push(diagnostic(config, relativePath, lineAt(source, match.index), 'malformed-source', `${match[0]} is missing a balanced key group.`));
      continue;
    }
    const keyBody = first.value;
    const expectsSecond = /\\pgfkeys(?:def|edef)/.test(match[0]);
    const second = expectsSecond ? nextGroup(source, first.end) : null;
    if (expectsSecond && !second) {
      manifestDiagnostics.push(diagnostic(config, relativePath, lineAt(source, match.index), 'malformed-source', `${match[0]} is missing its balanced handler body.`));
      continue;
    }
    const body = second?.value ?? keyBody;
    for (const segment of splitTopLevel(keyBody)) {
      const keyPath = keyPathFromSegment(segment, defaultNamespace);
      if (!keyPath) continue;
      const dynamic = /\\(?:csname|expandafter)|#\d/.test(keyPath) || /\\(?:csname|expandafter)/.test(body);
      const surface = /\/(?:\.code|\.style|\.is family|\.initial|\.default|\.store in|\.add code)/.test(keyPath) ? 'handler' : 'key';
      const status = dynamic ? 'dynamic' : 'static';
      const expansion = dynamic ? 'dynamic' : expansionForBody(body);
      const diagnostics = dynamic
        ? [diagnostic(config, relativePath, lineAt(source, match.index), 'dynamic-key-path', 'Key path or handler body uses dynamic TeX construction; exact rendering is retained but Canvas writeback is disabled.')]
        : undefined;
      entries.push(entry(config, relativePath, lineAt(source, match.index), {
        identity: keyPath,
        title: `${surface} ${keyPath}`,
        surface,
        keyPath,
        status,
        valueGrammar: grammarForKey(keyPath, segment),
        effects: { scope: 'local', expansion, outputs: [] },
        writeback: status === 'static' ? 'transaction-only' : 'never',
        security: securityFor(expansion, status),
        diagnostics,
        library: fileLibrary(relativePath),
      }));
    }
  }
}

function scanCommands(config, source, relativePath, entries) {
  const pattern = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|def|gdef|edef|xdef|let)\s*(?:\{)?\\([A-Za-z@:_-]+)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const macroName = match[1];
    const declaration = match[0].match(/^\\([A-Za-z@]+)/)?.[1] ?? '';
    const dynamic = /^(?:def|gdef|edef|xdef|let)$/.test(declaration);
    const status = dynamic ? 'dynamic' : 'static';
    const diagnostics = dynamic
      ? [diagnostic(config, relativePath, lineAt(source, match.index), 'dynamic-macro', `\\${declaration} defines \\${macroName}; the body is retained but not expanded statically.`)]
      : undefined;
    entries.push(entry(config, relativePath, lineAt(source, match.index), {
      identity: `\\${macroName}`,
      title: `macro \\${macroName}`,
      surface: 'command',
      status,
      namespaces: [namespaceForFile(relativePath, fileLibrary(relativePath))],
      valueGrammar: { kind: 'balanced-group', description: 'Macro arguments and balanced TeX body' },
      effects: { scope: 'group', expansion: dynamic ? 'dynamic' : 'macro', outputs: [] },
      writeback: 'never',
      security: securityFor(dynamic ? 'dynamic' : 'macro', status),
      diagnostics,
    }));
  }
}

function scanEnvironments(config, source, relativePath, entries) {
  const pattern = /\\(?:newenvironment|renewenvironment|provideenvironment)\s*\{([^}]+)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    entries.push(entry(config, relativePath, lineAt(source, match.index), {
      identity: match[1].trim(),
      title: `environment ${match[1].trim()}`,
      surface: 'environment',
      namespaces: [namespaceForFile(relativePath, fileLibrary(relativePath))],
      valueGrammar: { kind: 'balanced-group', description: 'Balanced begin/end TeX bodies' },
      effects: { scope: 'group', expansion: 'dynamic', outputs: [] },
      status: 'dynamic',
      writeback: 'never',
      security: securityFor('dynamic', 'dynamic'),
      diagnostics: [diagnostic(config, relativePath, lineAt(source, match.index), 'dynamic-macro', 'Environment begin/end bodies require TeX execution and are preserved as dynamic source.')],
    }));
  }
}

function scanPgfFunctions(config, source, relativePath, entries) {
  const pattern = /\\pgfmathdeclarefunction\*?\s*\{([^}]+)\}\s*\{([^}]*)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    entries.push(entry(config, relativePath, lineAt(source, match.index), {
      identity: match[1].trim(),
      title: `PGF math function ${match[1].trim()}`,
      surface: 'pgf-function',
      namespaces: ['/pgf/math'],
      valueGrammar: { kind: 'expression', description: `Declared arity ${match[2].trim() || 'unknown'}` },
      effects: { scope: 'local', expansion: 'macro', outputs: [{ kind: 'number', sourceBound: true }] },
      status: 'static',
      lanes: { preserve: true, parse: 'partial', preview: 'opaque', exact: 'server' },
      writeback: 'never',
      security: securityFor('macro', 'static'),
    }));
  }
}

function scanFile(config, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const relativePath = relativePosix(config.checkout, filename);
  const entries = [];
  const manifestDiagnostics = [];
  const library = fileLibrary(relativePath);
  if (library) {
    entries.push(entry(config, relativePath, 1, {
      identity: library,
      title: `${library} library`,
      surface: 'library',
      namespaces: [namespaceForFile(relativePath, library)],
      valueGrammar: { kind: 'none', description: `Load source with \\usetikzlibrary{${library}} or \\usepgflibrary{${library}}` },
      effects: { scope: 'document', expansion: 'macro', outputs: [{ kind: 'library-load', sourceBound: true }] },
      lanes: { preserve: true, parse: 'partial', preview: 'opaque', exact: 'server' },
      writeback: 'transaction-only',
      security: securityFor('macro', 'static'),
    }));
  }
  scanPgfkeys(config, source, relativePath, entries, manifestDiagnostics);
  scanCommands(config, source, relativePath, entries);
  scanEnvironments(config, source, relativePath, entries);
  scanPgfFunctions(config, source, relativePath, entries);

  const hasDynamic = /\\(?:csname|expandafter|futurelet|pgfutil@ifnextchar|foreach)\b/.test(source);
  if (hasDynamic) {
    const line = lineAt(source, source.search(/\\(?:csname|expandafter|futurelet|pgfutil@ifnextchar|foreach)\b/));
    entries.push(entry(config, relativePath, line, {
      identity: `dynamic-${relativePath}`,
      title: `dynamic constructs in ${relativePath}`,
      surface: 'handler',
      status: 'dynamic',
      namespaces: [namespaceForFile(relativePath, library)],
      valueGrammar: { kind: 'dynamic', description: 'Macro-generated syntax or execution product' },
      effects: { scope: 'group', expansion: 'dynamic', outputs: [] },
      lanes: { preserve: true, parse: 'opaque', preview: 'opaque', exact: 'server' },
      writeback: 'never',
      security: securityFor('dynamic', 'dynamic'),
      diagnostics: [diagnostic(config, relativePath, line, 'dynamic-macro', 'Dynamic control flow is retained with provenance; the static registry does not claim macro coverage.')],
    }));
  }
  if (entries.length === 0) {
    entries.push(entry(config, relativePath, 1, {
      identity: `unsupported-${relativePath}`,
      title: `unclassified source in ${relativePath}`,
      surface: 'handler',
      status: 'unsupported',
      namespaces: [namespaceForFile(relativePath, library)],
      valueGrammar: { kind: 'opaque', description: 'No statically recognized registry surface' },
      effects: { scope: 'group', expansion: 'dynamic', outputs: [] },
      lanes: { preserve: true, parse: 'opaque', preview: 'opaque', exact: 'server' },
      writeback: 'never',
      security: securityFor('dynamic', 'unsupported'),
      diagnostics: [diagnostic(config, relativePath, 1, 'unrecognized-source', 'No supported static pattern matched this .code.tex file; source remains opaque and exact-renderable.')],
    }));
  }
  return { entries, manifestDiagnostics };
}

function writeTypeScriptRegistry(config, registry, entryCount, fileCount) {
  const name = `PGF_${config.version.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_REGISTRY`;
  const json = JSON.stringify(registry, null, 2);
  const output = `/** Generated offline from an explicit local PGF checkout. Do not hand-edit. */\nimport { validatePgfUpstreamRegistry, type PgfUpstreamRegistry } from '../upstream-registry';\n\nconst RAW_REGISTRY = ${json} as const satisfies PgfUpstreamRegistry;\n\nexport const ${name} = validatePgfUpstreamRegistry(RAW_REGISTRY);\nexport const PGF_TIKZ_UPSTREAM_REGISTRY = ${name};\n`;
  fs.mkdirSync(path.dirname(config.output), { recursive: true });
  fs.writeFileSync(config.output, output, 'utf8');
  console.log(`Wrote ${entryCount} registry entries from ${fileCount} local .code.tex files to ${config.output}`);
}

function writeShardedJsonBundle(config, entries, diagnostics, fileCount, deduplication, files) {
  if (fs.existsSync(config.output) && !fs.statSync(config.output).isDirectory()) {
    throw new Error(`sharded-json output exists but is not a directory: ${config.output}`);
  }
  fs.mkdirSync(config.output, { recursive: true });
  removeGeneratedBundleFiles(config.output);

  const builtShards = buildShards(entries);
  const shards = builtShards.map(({ shard, serialized, ...metadata }) => {
    const destination = safeOutputChild(config.output, metadata.file);
    fs.writeFileSync(destination, serialized, 'utf8');
    return metadata;
  });
  const fileInventory = sourceFileInventory(config, files);
  const scopeDiagnostic = diagnostic(
    config,
    'tex/generic/pgf',
    1,
    'unsupported-surface',
    'Static registry inventory is exhaustive only for the scanned .code.tex files; PGF manual prose, driver code, Lua graph-drawing code, and other upstream surfaces are outside this bundle.',
  );
  const manifest = {
    schema: SHARDED_BUNDLE_SCHEMA,
    format: SHARDED_JSON_FORMAT,
    upstream: { repository: REPOSITORY, version: config.version, sha: config.sha, manual: MANUAL },
    generatedBy: 'tools/generate-pgf-registry.mjs (offline static-source-scan)',
    scanner: {
      mode: 'static-source-scan',
      dynamicMacrosPreserved: true,
      networkAccess: 'disabled',
      texExecution: 'disabled',
      checkout: 'explicit-local-directory',
      sourceExtensions: ['.code.tex'],
      include: ['**/*.code.tex'],
      exclude: ['.git/**', 'node_modules/**'],
      filesScanned: fileCount,
      fileInventory,
      deduplication,
    },
    totalEntries: entries.length,
    maxEntriesPerShard: MAX_ENTRIES_PER_SHARD,
    shardDigest: { algorithm: 'sha256', basis: 'canonical-json-utf8-with-final-newline' },
    shards,
    diagnostics: [...diagnostics, scopeDiagnostic],
  };
  const manifestFile = safeOutputChild(config.output, 'manifest.json');
  fs.writeFileSync(manifestFile, jsonBytes(manifest), 'utf8');
  console.log(`Wrote ${entries.length} registry entries from ${fileCount} local .code.tex files to ${config.output} (${shards.length} shards, max ${MAX_ENTRIES_PER_SHARD} entries/shard)`);
}

function generate(config) {
  if (!fs.existsSync(config.checkout) || !fs.statSync(config.checkout).isDirectory()) {
    throw new Error(`local PGF checkout does not exist or is not a directory: ${config.checkout}`);
  }
  const files = walkCodeTex(config.checkout);
  if (files.length === 0) throw new Error(`no .code.tex files found below local checkout: ${config.checkout}`);
  const entries = [];
  const diagnostics = [];
  for (const file of files) {
    const scanned = scanFile(config, file);
    entries.push(...scanned.entries);
    diagnostics.push(...scanned.manifestDiagnostics);
  }
  const unique = uniqueRegistryEntries(entries);
  if (unique.duplicateCount > 0 || unique.collisionCount > 0) {
    diagnostics.push(diagnostic(
      config,
      'tex/generic/pgf',
      1,
      'scanner-entry-deduplication',
      `Static scan collapsed ${unique.duplicateCount} exact duplicate entries and disambiguated ${unique.collisionCount} stable-ID collisions.`,
    ));
  }
  const registry = {
    manifest: {
      schema: 'pgf-upstream-registry/v1',
      upstream: { repository: REPOSITORY, version: config.version, sha: config.sha, manual: MANUAL },
      generatedBy: 'tools/generate-pgf-registry.mjs (offline static-source-scan)',
      scanner: { mode: 'static-source-scan', dynamicMacrosPreserved: true, networkAccess: 'disabled' },
      diagnostics,
    },
    entries: unique.entries,
  };
  if (config.format === SHARDED_JSON_FORMAT) {
    writeShardedJsonBundle(
      config,
      unique.entries,
      diagnostics,
      files.length,
      { exactDuplicates: unique.duplicateCount, idCollisions: unique.collisionCount },
      files,
    );
    return;
  }
  writeTypeScriptRegistry(config, registry, unique.entries.length, files.length);
}

const config = parseArgs(process.argv.slice(2));
try {
  generate(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
