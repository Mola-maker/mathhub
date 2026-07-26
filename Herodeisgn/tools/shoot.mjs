// Screenshot the running dev server for design review. Saves two PNGs:
//   shots/initial.png — right after navigation (entrance animation mid-flight)
//   shots/final.png   — after the entrance timeline settles
//
// Usage:
//   node tools/shoot.mjs [--url=http://localhost:5173]

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='));
const url = urlArg ? urlArg.slice('--url='.length) : 'http://localhost:5173';

const chromePath =
  'C:/Users/22494/AppData/Local/ms-playwright/chromium-1224/chrome-win64/chrome.exe';
const outDir = path.resolve('shots');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 800 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Forward console errors so silent failures show up in the script output.
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    console.log(`[page ${m.type()}]`, m.text());
  }
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'networkidle' });

// Initial: right after networkidle, animation likely just started.
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, 'initial.png'), fullPage: false });

// Final: wait for entrance animation to settle.
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(outDir, 'final.png'), fullPage: false });

// Also a full-page version in case content extends beyond viewport.
await page.screenshot({ path: path.join(outDir, 'full.png'), fullPage: true });

await browser.close();
console.log(`✔ wrote ${path.join(outDir, 'initial.png')}`);
console.log(`✔ wrote ${path.join(outDir, 'final.png')}`);
console.log(`✔ wrote ${path.join(outDir, 'full.png')}`);