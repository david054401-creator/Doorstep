/**
 * Content addressing and provenance.
 *
 * Design law 7: every artifact is immutable, content-addressed, and carries
 * provenance. Two runs that produce the same bytes produce the same id, which
 * is what makes the DAG cache and the "did anything actually change?" question
 * answerable.
 */

import { createHash, randomUUID } from 'node:crypto';

export type Hash = string; // "sha256:<hex40>"
export type Id = string;

/** Stable JSON: object keys sorted, numbers normalised, undefined dropped. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // -0 and 0 must serialise identically.
    const v = Object.is(value, -0) ? 0 : value;
    // Collapse float noise below the level any validator cares about.
    return Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(12));
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { __bytes: Buffer.from(value).toString('base64') };
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (src[key] === undefined) continue;
    out[key] = normalise(src[key]);
  }
  return out;
}

export function hashBytes(bytes: Uint8Array | Buffer): Hash {
  return `sha256:${createHash('sha256').update(bytes).digest('hex').slice(0, 40)}`;
}

export function hashString(text: string): Hash {
  return hashBytes(Buffer.from(text, 'utf8'));
}

/** The canonical content hash of any graph node or artifact payload. */
export function hashContent(value: unknown): Hash {
  return hashString(stableStringify(value));
}

/** Combine input hashes + tool identity + params into a cache key. */
export function cacheKey(parts: {
  tool: string;
  toolVersion: string;
  inputs: readonly Hash[];
  params: unknown;
}): Hash {
  return hashContent({
    tool: parts.tool,
    toolVersion: parts.toolVersion,
    inputs: [...parts.inputs].sort(),
    params: parts.params,
  });
}

let counter = 0;

/**
 * Readable, sortable ids. Deterministic mode (used by tests and by any
 * reproducible build) derives ids from a seed instead of time/randomness.
 */
export function makeId(prefix: string, seed?: string): Id {
  if (seed !== undefined) {
    return `${prefix}_${hashString(seed).slice(7, 19)}`;
  }
  counter = (counter + 1) % 0xffff;
  const t = Date.now().toString(36);
  const c = counter.toString(36).padStart(3, '0');
  const r = randomUUID().replace(/-/g, '').slice(0, 6);
  return `${prefix}_${t}${c}${r}`;
}

export function resetIdCounter(): void {
  counter = 0;
}

export type Provenance = {
  /** Tool or model that produced the artifact. */
  tool: string;
  toolVersion: string;
  /** Model id when a generative model was involved. */
  model?: string;
  /** Full parameter set, hashed into the cache key. */
  params?: Record<string, unknown>;
  seed?: number;
  /** Content hashes of every input. */
  inputs: Hash[];
  /** ISO timestamp. Excluded from content hashing. */
  createdAt: string;
  /** Wall-clock cost of producing this artifact. */
  durationMs?: number;
  costUsd?: number;
};

export function provenance(
  init: Omit<Provenance, 'createdAt'> & { createdAt?: string },
): Provenance {
  return { ...init, createdAt: init.createdAt ?? new Date().toISOString() };
}
