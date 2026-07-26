// Pre-flight validation + deterministic local repair for GeoGebra scripts.
//
// Two free tiers of robustness that fire BEFORE any token is spent on an LLM
// repair round-trip:
//
//   preflightFix()  — static pass over the parsed script: hallucinated command
//                     names are snapped to the real command set (case fix →
//                     edit-distance-1 fix), and bare segment names like
//                     `Intersect(AB, omega)` are rewritten to a real
//                     `segAB=Segment(A,B)` when A and B exist.
//
//   localRepair()   — driven by the engine's actual error strings: failed
//                     `Intersect(a,b)` gains an explicit index (1, then 2),
//                     a failed indexed Intersect flips its index, and
//                     "undefined variable AB" materialises the segment.
//
// Both are pure and unit-tested; the live applet stays the source of truth.

import { extractReferenceCommandNames } from '@/lib/math/geogebra-commands';
import { defLabel } from '@/lib/math/geometry-render/reorder';
import type { CommandFailure } from '@/lib/math/geometry-render/run-script';

// ── known-command set ───────────────────────────────────────────────────────

let knownCache: { names: Set<string>; lower: Map<string, string> } | null = null;

function knownCommands(): { names: Set<string>; lower: Map<string, string> } {
  if (knownCache) return knownCache;
  const names = new Set(extractReferenceCommandNames());
  const lower = new Map<string, string>();
  for (const n of names) lower.set(n.toLowerCase(), n);
  knownCache = { names, lower };
  return knownCache;
}

/** Levenshtein distance, early-exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Snap one command-name token to the known set, or null if no safe match. */
export function resolveCommandName(name: string): string | null {
  const { names, lower } = knownCommands();
  if (names.has(name)) return name;
  const ci = lower.get(name.toLowerCase());
  if (ci) return ci;
  // fuzzy: a unique edit-distance-1 neighbour (length ≥ 4 so we never "fix"
  // short user labels), distance 2 allowed from length 8.
  if (name.length < 4) return null;
  const maxD = name.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = maxD + 1;
  for (const cand of names) {
    const d = editDistance(name, cand, maxD);
    if (d < bestD) { best = cand; bestD = d; }
    else if (d === bestD && best && cand !== best) {
      // ambiguous — refuse to guess
      if (d <= maxD) best = '';
    }
  }
  return best ? best : null;
}

// All `Name(` heads in a line (top-level and nested).
const HEAD_RE = /([A-Za-z][A-Za-z0-9]{2,})\s*\(/g;

/** Labels defined anywhere in the script (assignment LHS). */
function definedLabels(commands: string[]): Set<string> {
  const out = new Set<string>();
  for (const c of commands) {
    const l = defLabel(c);
    if (l) out.add(l);
  }
  return out;
}

export interface PreflightResult {
  commands: string[];
  /** human-readable notes about what was auto-fixed */
  fixes: string[];
}

/**
 * Rewrite `Intersect(AB, …)`-style bare pair names: when `AB` is undefined but
 * points `A` and `B` are, insert `segAB=Segment(A,B)` and reference that.
 */
function fixBarePairNames(commands: string[], fixes: string[]): string[] {
  const labels = definedLabels(commands);
  const out: string[] = [];
  const inserted = new Set<string>();

  for (const cmd of commands) {
    let line = cmd;
    const m = line.match(/\bIntersect\s*\(([^)]*)\)/);
    if (m) {
      const args = m[1].split(',').map((s) => s.trim());
      for (const arg of args.slice(0, 2)) {
        const pair = arg.match(/^([A-Z])([A-Z])$/);
        if (!pair) continue;
        if (labels.has(arg)) continue;                       // a real object
        const [, p, q] = pair;
        if (!labels.has(p) || !labels.has(q)) continue;      // points unknown
        const segName = `seg${p}${q}`;
        if (!labels.has(segName) && !inserted.has(segName)) {
          out.push(`${segName}=Segment(${p},${q})`);
          inserted.add(segName);
          fixes.push(`${arg} → ${segName}=Segment(${p},${q})`);
        }
        line = line.replace(new RegExp(`([(,]\\s*)${arg}(\\s*[,)])`), `$1${segName}$2`);
      }
    }
    out.push(line);
  }
  return out;
}

/** Static pass: snap hallucinated command names, materialise bare pair names. */
export function preflightFix(commands: string[]): PreflightResult {
  const fixes: string[] = [];
  const labels = definedLabels(commands);

  const renamed = commands.map((cmd) => {
    return cmd.replace(HEAD_RE, (whole, name: string) => {
      // user-defined labels can be called like f(x) — never touch those, and
      // never touch names that already resolve.
      if (labels.has(name)) return whole;
      const fixed = resolveCommandName(name);
      if (fixed && fixed !== name) {
        fixes.push(`${name}( → ${fixed}(`);
        return whole.replace(name, fixed);
      }
      return whole;
    });
  });

  return { commands: fixBarePairNames(renamed, fixes), fixes };
}

// ── error-driven local repair ───────────────────────────────────────────────

const INTERSECT_RE = /^(\s*[A-Za-z_][\w']*\s*=\s*)Intersect\s*\(([\s\S]*)\)\s*$/;

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Candidate rewrites of one failing command, most-likely first. */
export function localRepairCandidates(cmd: string): string[] {
  const m = cmd.match(INTERSECT_RE);
  if (!m) return [];
  const [, lhs, inner] = m;
  const args = splitArgs(inner);
  if (args.length === 2) {
    // un-indexed intersect that produced nothing → try each branch
    return [
      `${lhs}Intersect(${args[0]},${args[1]},1)`,
      `${lhs}Intersect(${args[0]},${args[1]},2)`,
    ];
  }
  if (args.length === 3 && /^[12]$/.test(args[2])) {
    const flipped = args[2] === '1' ? '2' : '1';
    return [`${lhs}Intersect(${args[0]},${args[1]},${flipped})`];
  }
  return [];
}

/**
 * One deterministic repair attempt: patch each failing command with its first
 * untried candidate. Returns the patched script, or null when no failure has
 * a mechanical fix. `attempt` (0-based) walks down the candidate lists so a
 * second local round tries the next variant instead of repeating the first.
 */
export function localRepair(
  commands: string[],
  failures: CommandFailure[],
  attempt = 0,
): string[] | null {
  const failing = new Map(failures.map((f) => [f.cmd, f.error]));
  let patchedAny = false;

  const out = commands.map((cmd) => {
    if (!failing.has(cmd)) return cmd;
    const candidates = localRepairCandidates(cmd);
    const pick = candidates[attempt];
    if (!pick) return cmd;
    patchedAny = true;
    return pick;
  });

  // bare-pair materialisation is also worth one local shot when the engine
  // says a name is undefined
  if (!patchedAny) {
    const mentionsUndefined = failures.some((f) => /undefined|did not create|Unknown/i.test(f.error));
    if (mentionsUndefined && attempt === 0) {
      const fixes: string[] = [];
      const fixed = fixBarePairNames(commands, fixes);
      if (fixes.length > 0) return fixed;
    }
    return null;
  }
  return out;
}
