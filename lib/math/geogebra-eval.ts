/** Minimal GeoGebra applet API surface used by Math Studio eval helpers. */
export type GgbApiLike = {
  evalCommand: (cmd: string) => boolean | void;
  evalCommandGetErrorString?: (cmd: string) => string;
  getErrorString?: () => string;
  /** True if an object with this label exists. Present in the GWT classic bundle. */
  exists?: (label: string) => boolean;
};

export function formatGgbThrownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// Scripting/styling commands (SetColor, SetCaption, ShowLabel, Zoom…) return
// `false` from evalCommand even when they succeed, and create no object — so
// neither the boolean nor an existence check is meaningful for them.
const SCRIPTING_CMD = /^\s*(Set|Show|Hide|Delete|Zoom|Pan|Start|Pause|Select|Update|Center|Turtle)\w*\s*\(/;

/** The assignment target label, e.g. "D" in `D=Intersect(a,b)`. Null for void/auto-named.
 *  Primes are part of GGB labels (`A'=Reflect(A,l)`) — without them in the
 *  pattern, every primed assignment skipped existence-checking entirely. */
function targetLabel(cmd: string): string | null {
  const m = cmd.match(/^\s*([A-Za-z][\w']*)\s*=(?!=)/);
  return m ? m[1] : null;
}

/**
 * Detect failure when the bundle has no evalCommandGetErrorString. The GWT
 * "classic" bundle we self-host exposes only evalCommand (boolean) + exists():
 * the boolean alone is unreliable (false on successful scripting commands), so
 * the robust signal is whether the named object now exists. WITHOUT this,
 * evalCommand's result was ignored and every command reported success — which
 * silently disabled the entire repair loop in production.
 */
function detectByExec(api: GgbApiLike, cmd: string): string {
  let ret: boolean | void;
  try {
    ret = api.evalCommand(cmd);
  } catch (err) {
    return formatGgbThrownError(err);
  }
  const errStr = (api.getErrorString?.() ?? '').trim();
  if (errStr) return errStr;
  const label = targetLabel(cmd);
  if (label && typeof api.exists === 'function') {
    return api.exists(label) ? '' : `command did not create object "${label}"`;
  }
  if (SCRIPTING_CMD.test(cmd)) return '';
  return ret === false ? `command failed: ${cmd}` : '';
}

/** Run one evalCommand; return error string (empty = ok). Never throw. */
export function evalGgbCommand(api: GgbApiLike, cmd: string): string {
  if (typeof api.evalCommandGetErrorString === 'function') {
    try {
      return api.evalCommandGetErrorString(cmd).trim();
    } catch {
      return detectByExec(api, cmd);
    }
  }
  return detectByExec(api, cmd);
}

export function isGgbModuleRaceError(msg: string): boolean {
  return /not loaded yet|discrete commands not loaded/i.test(msg);
}

export type EvalStepResult = {
  ok: boolean;
  error?: string;
  /** Primary or fallback chain succeeded for this logical command. */
  logicalOk: boolean;
};

/** Try one command; on TriangleCenter failure use perpendicular-bisector fallback. */
export function evalGgbStep(
  api: GgbApiLike,
  cmd: string,
  fallbacks: string[] | null,
): EvalStepResult {
  const err = evalGgbCommand(api, cmd);
  if (!err) return { ok: true, logicalOk: true };
  if (!fallbacks?.length) return { ok: false, error: err, logicalOk: false };

  for (const fb of fallbacks) {
    const fbErr = evalGgbCommand(api, fb);
    if (fbErr) {
      if (isGgbModuleRaceError(fbErr)) return { ok: false, error: fbErr, logicalOk: false };
      return { ok: false, error: `${cmd} → ${err}; fallback ${fb} → ${fbErr}`, logicalOk: false };
    }
  }
  return { ok: true, logicalOk: true };
}
