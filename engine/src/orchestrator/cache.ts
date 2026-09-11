/**
 * Content-addressed artifact cache.
 *
 * A node whose inputs, tool and parameters are unchanged is not run
 * again — which is what makes iterating on shot 12 cheap after shot 11
 * was approved. Entries are immutable and carry provenance, so any
 * artifact in the store can be traced to exactly what produced it.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Hash, Provenance } from '../core/ids.ts';
import { hashContent, hashBytes } from '../core/ids.ts';
import { encodeArtifact, decodeArtifact, estimateBytes } from './serialize.ts';

export type CacheEntry<T = unknown> = {
  key: Hash;
  value: T;
  provenance: Provenance;
  /** Bytes on disk, for the producer's ledger. */
  bytes: number;
  writtenAt: string;
};

export type Cache = {
  get<T>(key: Hash): CacheEntry<T> | undefined;
  set<T>(key: Hash, value: T, provenance: Provenance): CacheEntry<T>;
  has(key: Hash): boolean;
  delete(key: Hash): void;
  /** Total bytes held. */
  size(): number;
  keys(): Hash[];
  clear(): void;
};

/** In-memory cache. Always available, never persisted. */
export function memoryCache(): Cache {
  const store = new Map<Hash, CacheEntry<unknown>>();
  return {
    get: <T,>(key: Hash) => store.get(key) as CacheEntry<T> | undefined,
    set: <T,>(key: Hash, value: T, provenance: Provenance) => {
      // Measured, not serialised. Stringifying a few hundred frames to
      // find out how big they are costs more than rendering them.
      const bytes = estimateBytes(value);
      const entry: CacheEntry<T> = { key, value, provenance, bytes, writtenAt: new Date().toISOString() };
      store.set(key, entry as CacheEntry<unknown>);
      return entry;
    },
    has: (key) => store.has(key),
    delete: (key) => void store.delete(key),
    size: () => [...store.values()].reduce((a, e) => a + e.bytes, 0),
    keys: () => [...store.keys()],
    clear: () => store.clear(),
  };
}

/**
 * Filesystem cache.
 *
 * The metadata of an entry is JSON; its binary payloads are not. Pixel
 * buffers are written as content-addressed blobs beside the entry and
 * referenced by hash — which is what the design law about immutable,
 * content-addressed artifacts actually implies, and what stops a long
 * render from dying on V8's maximum string length. Blobs dedupe across
 * entries, so a repair that changes one frame does not rewrite the
 * other three hundred.
 *
 * `FILM_CACHE_MAX_ENTRY_MB` caps a single entry. Over the cap the entry
 * is kept in memory and not persisted: a cache miss on the next run
 * costs time, and that is always the better trade against a crash.
 */
export function fileCache(root: string, options: { maxEntryMb?: number } = {}): Cache {
  mkdirSync(root, { recursive: true });
  const maxEntryBytes =
    (options.maxEntryMb ?? Number(process.env.FILM_CACHE_MAX_ENTRY_MB ?? 256)) * 1024 * 1024;
  const pathFor = (key: Hash): string => {
    const hex = key.replace(/^sha256:/, '');
    return join(root, hex.slice(0, 2), `${hex}.json`);
  };
  const blobPathFor = (ref: Hash): string => {
    const hex = ref.replace(/^sha256:/, '');
    return join(root, 'blobs', hex.slice(0, 2), `${hex}.bin`);
  };
  const putBlob = (bytes: Uint8Array): Hash => {
    const ref = hashBytes(bytes);
    const path = blobPathFor(ref);
    // Content-addressed: identical bytes are written once.
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    return ref;
  };
  const getBlob = (ref: Hash): Uint8Array | undefined => {
    const path = blobPathFor(ref);
    if (!existsSync(path)) return undefined;
    const buf = readFileSync(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  const mem = new Map<Hash, CacheEntry<unknown>>();

  return {
    get: <T,>(key: Hash) => {
      const cached = mem.get(key);
      if (cached) return cached as CacheEntry<T>;
      const path = pathFor(key);
      if (!existsSync(path)) return undefined;
      try {
        const stored = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry<unknown>;
        const entry: CacheEntry<T> = {
          ...stored,
          value: decodeArtifact(stored.value, getBlob) as T,
        };
        mem.set(key, entry as CacheEntry<unknown>);
        return entry;
      } catch {
        // A corrupt or truncated entry is a miss, never a crash and
        // never a partially-decoded artifact handed to the pipeline.
        return undefined;
      }
    },
    set: <T,>(key: Hash, value: T, provenance: Provenance) => {
      const bytes = estimateBytes(value);
      const entry: CacheEntry<T> = {
        key,
        value,
        provenance,
        bytes,
        writtenAt: new Date().toISOString(),
      };
      mem.set(key, entry as CacheEntry<unknown>);
      if (bytes > maxEntryBytes) return entry;

      const path = pathFor(key);
      mkdirSync(dirname(path), { recursive: true });
      try {
        const encoded = encodeArtifact(value, putBlob);
        writeFileSync(
          path,
          JSON.stringify(
            { key, value: encoded, provenance, bytes, writtenAt: entry.writtenAt },
            null,
            0,
          ),
        );
      } catch {
        // Persisting is an optimisation. Failing to persist must not
        // fail the run that produced the artifact.
        if (existsSync(path)) rmSync(path);
      }
      return entry;
    },
    has: (key) => mem.has(key) || existsSync(pathFor(key)),
    delete: (key) => {
      mem.delete(key);
      const path = pathFor(key);
      if (existsSync(path)) rmSync(path);
    },
    size: () => {
      let total = 0;
      const walk = (dir: string): void => {
        if (!existsSync(dir)) return;
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          const s = statSync(p);
          if (s.isDirectory()) walk(p);
          else total += s.size;
        }
      };
      walk(root);
      return total;
    },
    keys: () => {
      const out: Hash[] = [];
      const walk = (dir: string): void => {
        if (!existsSync(dir)) return;
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (name.endsWith('.json')) out.push(`sha256:${name.replace('.json', '')}`);
        }
      };
      walk(root);
      return out;
    },
    clear: () => {
      mem.clear();
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
    },
  };
}

/** A cache that never hits. Useful for forcing a full rebuild. */
export function nullCache(): Cache {
  return {
    get: () => undefined,
    set: <T,>(key: Hash, value: T, provenance: Provenance) => ({
      key,
      value,
      provenance,
      bytes: 0,
      writtenAt: new Date().toISOString(),
    }),
    has: () => false,
    delete: () => {},
    size: () => 0,
    keys: () => [],
    clear: () => {},
  };
}

export { hashContent };
