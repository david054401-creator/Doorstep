import type { CheckResult, Severity } from './types';

/** The studio's palette. Dark, because it is a room for looking at frames. */
export const C = {
  bg: '#0F0F13',
  panel: '#17171D',
  panelHi: '#1D1D24',
  border: '#2A2A33',
  text: '#E7E4DE',
  dim: '#8C8983',
  faint: '#5E5B57',
  accent: '#E4793B',
  pass: '#6BAF5C',
  warn: '#D4923B',
  fail: '#D2543F',
  fatal: '#B8332A',
  info: '#5E8FB5',
} as const;

export function severityColor(severity: Severity, pass: boolean): string {
  if (pass) return C.pass;
  switch (severity) {
    case 'fatal':
      return C.fatal;
    case 'error':
      return C.fail;
    case 'warn':
      return C.warn;
    default:
      return C.info;
  }
}

export function scoreColor(score: number): string {
  if (score >= 0.95) return C.pass;
  if (score >= 0.85) return C.warn;
  return C.fail;
}

export function stateColor(state: 'held' | 'broken' | 'unmeasured'): string {
  return state === 'held' ? C.pass : state === 'broken' ? C.fail : C.dim;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'passed':
      return C.pass;
    case 'repaired':
      return C.warn;
    case 'escalated':
    case 'failed':
      return C.fail;
    case 'blocked':
      return C.info;
    default:
      return C.dim;
  }
}

export const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * How a check reads on a dashboard. `measured` and `threshold` are the
 * whole point — "failed" is not a finding, "0.83 against a 0.95 floor"
 * is.
 */
export function measurement(check: CheckResult): string | null {
  if (check.measured === undefined || check.threshold === undefined) return null;
  const cmp = check.comparator ?? '>=';
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
  return `${fmt(check.measured)} ${cmp} ${fmt(check.threshold)}`;
}

export function locatorLabel(where: CheckResult['where']): string {
  const parts: string[] = [];
  if (where.shotId) parts.push(where.shotId);
  if (where.characterId) parts.push(where.characterId);
  if (where.partId) parts.push(where.partId);
  if (where.boneId) parts.push(where.boneId);
  if (where.frame !== undefined) parts.push(`frame ${where.frame}`);
  if (where.frameRange) parts.push(`frames ${where.frameRange[0]}–${where.frameRange[1]}`);
  if (where.path) parts.push(where.path);
  return parts.join(' · ');
}

export const assetUrl = (relPath: string): string =>
  `/studio/asset/${relPath.split('/').map(encodeURIComponent).join('/')}`;
