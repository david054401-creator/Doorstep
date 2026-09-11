/**
 * Result / diagnosis types.
 *
 * Design law 4: every validator names *what* failed and *where*. A boolean is
 * never an acceptable return value from a check — the repair loop needs a
 * diagnosis it can route.
 */

export type Severity = 'info' | 'warn' | 'error' | 'fatal';

/** Points at the exact place a check failed, so a human can look at it. */
export type Locator = {
  shotId?: string;
  sequenceId?: string;
  characterId?: string;
  environmentId?: string;
  /** Absolute frame within the shot. */
  frame?: number;
  frameRange?: [number, number];
  /** Rig part or bone. */
  partId?: string;
  boneId?: string;
  /** Path into the Film Graph, e.g. "shots[3].keys[2].boneTransforms.L_forearm". */
  path?: string;
  /** Rendered evidence — a frame png, a battery contact sheet, an overlay. */
  artifactRefs?: string[];
  /** Normalised region of interest within the frame, 0..1. */
  region?: { x: number; y: number; w: number; h: number };
};

export type Evidence = {
  kind: 'frame' | 'contactSheet' | 'overlay' | 'plot' | 'json' | 'text';
  ref: string;
  caption?: string;
};

export type CheckResult = {
  /** Stable identifier, e.g. "rig.weights_normalised". */
  name: string;
  /** Which department / stage owns this check. */
  department: string;
  pass: boolean;
  /** 0..1 normalised, where 1 is perfect. Reported even on pass. */
  score: number;
  /** The measured value and the bar it had to clear. */
  measured?: number;
  threshold?: number;
  comparator?: '>=' | '<=' | '==' | 'range';
  severity: Severity;
  /** Human-readable statement of what happened. Never "check failed". */
  message: string;
  /** Machine-routable cause, keyed into the repair table. */
  diagnosis?: string;
  where: Locator;
  evidence?: Evidence[];
  /** Milliseconds the check took — the QA dashboard shows the slow ones. */
  durationMs?: number;
};

export function pass(
  init: Omit<CheckResult, 'pass' | 'severity'> & { severity?: Severity },
): CheckResult {
  return { severity: 'info', ...init, pass: true };
}

export function fail(
  init: Omit<CheckResult, 'pass' | 'severity'> & { severity?: Severity },
): CheckResult {
  return { severity: 'error', ...init, pass: false };
}

/** Build a check from a measurement and a threshold, so scores are consistent. */
export function measure(init: {
  name: string;
  department: string;
  measured: number;
  threshold: number;
  comparator: '>=' | '<=';
  /** Value at which the score reaches 0. Defaults to 2x the slack. */
  floor?: number;
  severity?: Severity;
  message: string;
  diagnosis?: string;
  where: Locator;
  evidence?: Evidence[];
}): CheckResult {
  const { measured, threshold, comparator } = init;
  const ok = comparator === '>=' ? measured >= threshold : measured <= threshold;
  const floor =
    init.floor ?? (comparator === '>=' ? threshold * 0.5 : threshold * 2 + 1e-9);
  let score: number;
  if (ok) score = 1;
  else if (comparator === '>=') {
    score = threshold === floor ? 0 : (measured - floor) / (threshold - floor);
  } else {
    score = threshold === floor ? 0 : (floor - measured) / (floor - threshold);
  }
  return {
    name: init.name,
    department: init.department,
    pass: ok,
    score: Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0)),
    measured,
    threshold,
    comparator,
    severity: init.severity ?? 'error',
    message: init.message,
    diagnosis: ok ? undefined : init.diagnosis,
    where: init.where,
    evidence: init.evidence,
  };
}

export type Ok<T> = { ok: true; value: T };
export type Err<E = EngineError> = { ok: false; error: E };
export type Result<T, E = EngineError> = Ok<T> | Err<E>;

export const ok = <T,>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E,>(error: E): Err<E> => ({ ok: false, error });

export type EngineError = {
  code: string;
  message: string;
  where?: Locator;
  cause?: unknown;
};

export function engineError(
  code: string,
  message: string,
  where?: Locator,
  cause?: unknown,
): EngineError {
  return { code, message, where, cause };
}

export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw new Error(`${r.error.code}: ${r.error.message}`);
}

/** A rolled-up verdict over many checks. This is the "score sheet". */
export type ScoreSheet = {
  subject: string;
  /** 0..1 weighted score. Displayed, never used alone to gate. */
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  /** True only if zero error/fatal failures. */
  clean: boolean;
  /** Hard invariants that did not hold. Any entry blocks delivery. */
  blocking: string[];
  checks: CheckResult[];
  generatedAt: string;
};

export function scoreSheet(subject: string, checks: readonly CheckResult[]): ScoreSheet {
  const failed = checks.filter(
    (c) => !c.pass && (c.severity === 'error' || c.severity === 'fatal'),
  );
  const warnings = checks.filter((c) => !c.pass && c.severity === 'warn');
  const weight = (c: CheckResult): number =>
    c.severity === 'fatal' ? 4 : c.severity === 'error' ? 2 : c.severity === 'warn' ? 1 : 0.5;
  let num = 0;
  let den = 0;
  for (const c of checks) {
    const w = weight(c);
    num += w * (c.pass ? 1 : Math.max(0, Math.min(1, c.score)));
    den += w;
  }
  return {
    subject,
    score: den === 0 ? 1 : num / den,
    passed: checks.filter((c) => c.pass).length,
    failed: failed.length,
    warnings: warnings.length,
    clean: failed.length === 0,
    blocking: failed.filter((c) => c.severity === 'fatal').map((c) => c.name),
    checks: [...checks],
    generatedAt: new Date().toISOString(),
  };
}

/** Merge score sheets from many subjects into one roll-up. */
export function rollUp(subject: string, sheets: readonly ScoreSheet[]): ScoreSheet {
  const checks = sheets.flatMap((s) => s.checks);
  const merged = scoreSheet(subject, checks);
  return { ...merged, blocking: [...new Set(sheets.flatMap((s) => s.blocking))] };
}
