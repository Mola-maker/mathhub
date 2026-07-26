// Execute a GeoGebra script against the live applet and drive the repair loop.
//
// This is the robustness core: the REAL GeoGebra engine validates every
// command (via geogebra-eval), and the exact error strings it returns feed a
// bounded repair. Pure enough to unit-test with a fake GgbApi.

import { evalGgbCommand, evalGgbStep, type GgbApiLike } from '@/lib/math/geogebra-eval';

/** A command GeoGebra rejected, with its exact error string. */
export type CommandFailure = { cmd: string; error: string };

/** Resolve deterministic fallback commands for one failing command (e.g. TriangleCenter). */
export type FallbackResolver = (cmd: string) => string[] | null;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RunResult = {
  /** Commands that executed without error (directly or via a fallback chain). */
  ran: number;
  total: number;
  failures: CommandFailure[];
};

/** Run each command once; collect the ones GeoGebra rejected. Never throws. */
export function runGeometryScript(
  api: GgbApiLike,
  commands: string[],
  fallbacks?: FallbackResolver,
): RunResult {
  const failures: CommandFailure[] = [];
  let ran = 0;
  for (const cmd of commands) {
    if (fallbacks) {
      const step = evalGgbStep(api, cmd, fallbacks(cmd));
      if (step.logicalOk) ran += 1;
      else failures.push({ cmd, error: step.error ?? 'error' });
    } else {
      const err = evalGgbCommand(api, cmd);
      if (err) failures.push({ cmd, error: err });
      else ran += 1;
    }
  }
  return { ran, total: commands.length, failures };
}

export type RenderWithRepairOptions = {
  api: GgbApiLike;
  commands: string[];
  /** Reset the canvas before each (re)run so retries start clean. */
  clear: () => void;
  /** Ask the backend to repair; resolve to the corrected script ([] to give up). */
  repair: (commands: string[], failures: CommandFailure[]) => Promise<string[]>;
  /** Max repair round-trips (default 2). */
  maxRepairs?: number;
  /** Optional deterministic fallbacks (e.g. TriangleCenter kernel race). */
  fallbacks?: FallbackResolver;
  /**
   * Errors to treat as TRANSIENT (e.g. GeoGebra lazy-module load race): the
   * same script is re-run after a delay rather than sent to the LLM repair —
   * an LLM cannot fix a load race.
   */
  isTransient?: (err: string) => boolean;
  /** Delay before a transient re-run (default 1200ms). */
  transientDelayMs?: number;
  /** Max transient re-runs per attempt (default 0 = off). */
  maxTransientRetries?: number;
  /**
   * Deterministic repair tier: patch the failing script mechanically (e.g.
   * flip an Intersect index) — tried BEFORE each LLM round, costs nothing.
   * `attempt` walks candidate lists across local rounds.
   */
  localRepair?: (commands: string[], failures: CommandFailure[], attempt: number) => string[] | null;
  /** Max local-repair rounds (default 2). */
  maxLocalRepairs?: number;
  /**
   * Semantic lint, run only after a CLEAN engine pass: degeneracies (undefined
   * intersections, coincident points, collinear polygons) come back as repair-
   * ready failures so "succeeded but wrong" figures enter the repair loop too.
   */
  lint?: (commands: string[]) => CommandFailure[];
};

export type RenderOutcome = {
  /** The final (best) script that is left on the canvas. */
  commands: string[];
  result: RunResult;
  repairs: number;
};

/** Clear + run, re-running while every remaining failure is transient. */
async function runOnce(opts: RenderWithRepairOptions, commands: string[]): Promise<RunResult> {
  opts.clear();
  let res = runGeometryScript(opts.api, commands, opts.fallbacks);
  const maxT = opts.maxTransientRetries ?? 0;
  let t = 0;
  while (
    opts.isTransient
    && t < maxT
    && res.failures.length > 0
    && res.failures.every((f) => opts.isTransient!(f.error))
  ) {
    await delay(opts.transientDelayMs ?? 1200);
    opts.clear();
    res = runGeometryScript(opts.api, commands, opts.fallbacks);
    t += 1;
  }
  // A clean engine pass still has to survive the geometry lint: degenerate
  // figures are failures the repair tiers can act on.
  if (res.failures.length === 0 && opts.lint) {
    try {
      const semantic = opts.lint(commands);
      if (semantic.length > 0) res = { ...res, failures: semantic };
    } catch { /* lint must never break rendering */ }
  }
  return res;
}

/**
 * Render commands; while GeoGebra reports REPAIRABLE failures, request a fixed
 * script and re-run — up to maxRepairs times. Always keeps the best attempt
 * (fewest failures) and leaves THAT on the canvas, so a regressing repair never
 * makes the figure worse than an earlier attempt. Transient (load-race) errors
 * are retried in place and never sent to the LLM.
 */
export async function renderWithRepair(opts: RenderWithRepairOptions): Promise<RenderOutcome> {
  const maxRepairs = opts.maxRepairs ?? 2;
  const maxLocal = opts.maxLocalRepairs ?? 2;
  /** Failures the LLM could actually fix (excludes transient races). */
  const repairable = (r: RunResult) => r.failures.filter((f) => !(opts.isTransient?.(f.error)));

  let bestCommands = opts.commands;
  let bestResult = await runOnce(opts, bestCommands);
  let bestIsOnCanvas = true;
  let repairs = 0;
  let localRounds = 0;

  // Tier 1 — deterministic local repair: zero latency, zero tokens. Each round
  // patches the failing lines mechanically and keeps the result only when it
  // strictly improves.
  while (
    opts.localRepair
    && localRounds < maxLocal
    && repairable(bestResult).length > 0
  ) {
    const patched = opts.localRepair(bestCommands, repairable(bestResult), localRounds);
    localRounds += 1;
    if (!patched) break;
    const result = await runOnce(opts, patched);
    if (result.failures.length < bestResult.failures.length) {
      bestCommands = patched;
      bestResult = result;
      bestIsOnCanvas = true;
    } else {
      bestIsOnCanvas = false;
    }
    if (repairable(bestResult).length === 0) break;
  }

  // Tier 2 — LLM repair, bounded as before.
  while (repairable(bestResult).length > 0 && repairs < maxRepairs) {
    const fixed = await opts.repair(bestCommands, repairable(bestResult));
    if (fixed.length === 0) break;
    repairs += 1;
    const result = await runOnce(opts, fixed);
    if (result.failures.length < bestResult.failures.length) {
      bestCommands = fixed;
      bestResult = result;
      bestIsOnCanvas = true;
    } else {
      // Regression or no improvement — keep the prior best; canvas now shows a
      // worse attempt and must be restored below.
      bestIsOnCanvas = false;
    }
    if (repairable(bestResult).length === 0) break;
  }

  if (!bestIsOnCanvas) {
    bestResult = await runOnce(opts, bestCommands);
  }
  return { commands: bestCommands, result: bestResult, repairs };
}
