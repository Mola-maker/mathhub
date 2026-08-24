import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compilerEntry = fileURLToPath(new URL(
  '../services/tikz-compiler/local-dev-server.mjs',
  import.meta.url,
));
const nextEntry = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const compilerUrl = process.env.TIKZ_COMPILER_URL?.trim() || 'http://127.0.0.1:8787';
const compilerToken = process.env.TIKZ_COMPILER_TOKEN?.trim() || 'local-tikz-compiler-token';
const compilerEndpoint = new URL(compilerUrl);
const compilerIsLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
  compilerEndpoint.hostname,
);
const children = new Set();
let shuttingDown = false;

function childProcess(label, entry, args, env) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: false,
  });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      process.stderr.write(
        `[dev:tikz] ${label} exited (${signal ?? code ?? 'unknown'}).\n`,
      );
    }
  });
  child.once('error', (error) => {
    process.stderr.write(`[dev:tikz] unable to start ${label}: ${error.message}\n`);
  });
  return child;
}

async function compilerAlreadyListening() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${compilerUrl.replace(/\/+$/u, '')}/healthz`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    // A 503 still proves that the diagnostic compiler service is listening;
    // it will report the missing native runtime to the Web client.
    return response.status === 200 || response.status === 503;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function stopChildren(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      // Next.js and MiKTeX both create descendants. child.kill() only stops
      // the immediate launcher on Windows, leaving ports and TeX helpers alive
      // after Ctrl+C. Terminate each owned process tree without a shell.
      const taskkill = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'taskkill.exe',
      );
      const result = spawnSync(
        taskkill,
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      if (result.status !== 0) child.kill(signal);
    } else {
      child.kill(signal);
    }
  }
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once('SIGINT', () => stopChildren('SIGINT'));
process.once('SIGTERM', () => stopChildren('SIGTERM'));

const sharedEnvironment = {
  ...process.env,
  TIKZ_COMPILER_URL: compilerUrl,
  TIKZ_COMPILER_TOKEN: compilerToken,
};
if (await compilerAlreadyListening()) {
  process.stdout.write(`[dev:tikz] reusing compiler service at ${compilerUrl}.\n`);
} else {
  if (compilerIsLoopback) {
    childProcess('compiler', compilerEntry, [], {
      ...sharedEnvironment,
      COMPILER_TOKEN: compilerToken,
      PORT: compilerEndpoint.port || '8787',
      HOST: compilerEndpoint.hostname,
    });
  } else {
    process.stderr.write(
      `[dev:tikz] configured remote compiler ${compilerEndpoint.origin} is unavailable; refusing to bind a local service to a remote hostname.\n`,
    );
  }
}
const web = childProcess('web', nextEntry, ['dev'], sharedEnvironment);
web.once('exit', () => stopChildren('SIGTERM'));
