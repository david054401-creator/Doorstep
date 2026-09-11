/**
 * Transport encoding for cached artifacts.
 *
 * The cache's own docstring said "binary payloads should be written to
 * the artifact store and referenced by URI rather than inlined", and
 * nothing enforced it. What actually happened on a feature-length render
 * was worse than slow:
 *
 *  - `JSON.stringify` of a 1920x1080 frame writes `{"0":247,"1":242,...}`
 *    — roughly 30 bytes per pixel channel. A few hundred frames crosses
 *    V8's maximum string length and the process dies with "Invalid
 *    string length" twenty minutes into the run, after all the work.
 *  - `JSON.stringify` of a `Map` is `{}`. The render node returns its
 *    per-character plates in a Map, so a cache *hit* silently returned
 *    an output with no plates, and the identity gate went from measured
 *    to unmeasured depending on whether the cache was warm. A validator
 *    whose answer depends on the cache is not a validator.
 *
 * So artifacts are encoded before they are written: typed arrays go to
 * content-addressed blobs beside the entry, and the structures JSON
 * cannot represent are tagged and restored. Round-tripping is exact —
 * `tests/orchestrator.test.ts` renders a frame, puts it through the
 * cache and compares bytes.
 */

import { hashBytes } from '../core/ids.ts';
import type { Hash } from '../core/ids.ts';

const TYPED_ARRAYS = {
  Uint8Array,
  Uint8ClampedArray,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const;

type TypedArrayName = keyof typeof TYPED_ARRAYS;
export type TypedArray = InstanceType<(typeof TYPED_ARRAYS)[TypedArrayName]>;

export type BlobSink = (bytes: Uint8Array) => Hash;
export type BlobSource = (ref: Hash) => Uint8Array | undefined;

const TAG = '$film';

type Encoded =
  | { [TAG]: 'binary'; kind: TypedArrayName; ref: Hash; length: number }
  | { [TAG]: 'map'; entries: [unknown, unknown][] }
  | { [TAG]: 'set'; values: unknown[] }
  | { [TAG]: 'date'; iso: string }
  | { [TAG]: 'number'; text: string }
  | { [TAG]: 'undefined' };

function typedArrayName(value: object): TypedArrayName | null {
  for (const name of Object.keys(TYPED_ARRAYS) as TypedArrayName[]) {
    if (value instanceof TYPED_ARRAYS[name]) return name;
  }
  return null;
}

function bytesOf(value: TypedArray): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Encode a value for storage. Binary payloads are handed to `sink`,
 * which returns the content hash they were stored under.
 */
export function encodeArtifact(value: unknown, sink: BlobSink): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v === undefined) return { [TAG]: 'undefined' } satisfies Encoded;
    if (v === null || typeof v !== 'object') {
      // NaN and Infinity survive as null through JSON, which turns a
      // failed measurement into a plausible-looking zero downstream.
      if (typeof v === 'number' && !Number.isFinite(v))
        return { [TAG]: 'number', text: String(v) } satisfies Encoded;
      return v;
    }

    const kind = typedArrayName(v);
    if (kind) {
      const array = v as TypedArray;
      return {
        [TAG]: 'binary',
        kind,
        ref: sink(bytesOf(array)),
        length: array.length,
      } satisfies Encoded;
    }

    if (seen.has(v)) {
      throw new TypeError('An artifact with a cycle in it cannot be cached.');
    }
    seen.add(v);

    try {
      if (v instanceof Date) return { [TAG]: 'date', iso: v.toISOString() } satisfies Encoded;
      if (v instanceof Map) {
        return {
          [TAG]: 'map',
          entries: [...v.entries()].map(([k, val]) => [walk(k), walk(val)]),
        } satisfies Encoded;
      }
      if (v instanceof Set) {
        return { [TAG]: 'set', values: [...v].map(walk) } satisfies Encoded;
      }
      if (Array.isArray(v)) return v.map(walk);

      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined) continue; // matches JSON's own omission
        out[k] = walk(val);
      }
      return out;
    } finally {
      seen.delete(v);
    }
  };

  return walk(value);
}

/** Restore a value encoded by `encodeArtifact`. */
export function decodeArtifact(value: unknown, source: BlobSource): unknown {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);

    const tagged = v as Record<string, unknown>;
    const tag = tagged[TAG];
    if (typeof tag === 'string') {
      switch (tag) {
        case 'undefined':
          return undefined;
        case 'number':
          return Number(tagged.text);
        case 'date':
          return new Date(String(tagged.iso));
        case 'map':
          return new Map(
            (tagged.entries as [unknown, unknown][]).map(([k, val]) => [walk(k), walk(val)]),
          );
        case 'set':
          return new Set((tagged.values as unknown[]).map(walk));
        case 'binary': {
          const bytes = source(String(tagged.ref) as Hash);
          if (!bytes) {
            // A missing blob is a corrupt cache entry. Saying so beats
            // handing the pipeline an empty frame that looks like art.
            throw new Error(`Cached artifact references a blob that is not in the store: ${String(tagged.ref)}`);
          }
          const Ctor = TYPED_ARRAYS[tagged.kind as TypedArrayName];
          const length = Number(tagged.length);
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          const view = new Ctor(copy.buffer, 0, length) as TypedArray;
          return view;
        }
        default:
          break;
      }
    }

    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(tagged)) out[k] = walk(val);
    return out;
  };

  return walk(value);
}

/**
 * Approximate the in-memory footprint of an artifact without
 * serialising it. The producer's ledger wants a number, not a 400 MB
 * string it throws away.
 */
export function estimateBytes(value: unknown, depth = 0): number {
  if (depth > 64) return 0;
  if (value === null || value === undefined) return 8;
  switch (typeof value) {
    case 'boolean':
      return 4;
    case 'number':
      return 8;
    case 'string':
      return value.length * 2 + 16;
    case 'object':
      break;
    default:
      return 8;
  }

  const obj = value as object;
  if (typedArrayName(obj)) return (obj as TypedArray).byteLength + 32;
  if (obj instanceof Date) return 16;
  if (Array.isArray(obj)) {
    let total = 32;
    for (const item of obj) total += estimateBytes(item, depth + 1);
    return total;
  }
  if (obj instanceof Map) {
    let total = 48;
    for (const [k, v] of obj) total += estimateBytes(k, depth + 1) + estimateBytes(v, depth + 1);
    return total;
  }
  if (obj instanceof Set) {
    let total = 48;
    for (const v of obj) total += estimateBytes(v, depth + 1);
    return total;
  }
  let total = 32;
  for (const [k, v] of Object.entries(obj)) total += k.length * 2 + estimateBytes(v, depth + 1);
  return total;
}

export { hashBytes };
