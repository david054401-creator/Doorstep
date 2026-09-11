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
import { hashContent, stableStringify } from '../core/ids.ts';

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
      const bytes = Buffer.byteLength(stableStringify(value), 'utf8');
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
 * Filesystem cache. Values are JSON; binary payloads should be written to
 * the artifact store and referenced by URI rather than inlined.
 */
export function fileCache(root: string): Cache {
  mkdirSync(root, { recursive: true });
  const pathFor = (key: Hash): string => {
    const hex = key.replace(/^sha256:/, '');
    return join(root, hex.slice(0, 2), `${hex}.json`);
  };
  const mem = new Map<Hash, CacheEntry<unknown>>();

  return {
    get: <T,>(key: Hash) => {
      const cached = mem.get(key);
      if (cached) return cached as CacheEntry<T>;
      const path = pathFor(key);
      if (!existsSync(path)) return undefined;
      try {
        const entry = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry<T>;
        mem.set(key, entry as CacheEntry<unknown>);
        return entry;
      } catch {
        return undefined;
      }
    },
    set: <T,>(key: Hash, value: T, provenance: Provenance) => {
      const path = pathFor(key);
      mkdirSync(dirname(path), { recursive: true });
      const body = stableStringify({ key, value, provenance });
      const entry: CacheEntry<T> = {
        key,
        value,
        provenance,
        bytes: Buffer.byteLength(body, 'utf8'),
        writtenAt: new Date().toISOString(),
      };
      writeFileSync(path, JSON.stringify(entry, null, 0));
      mem.set(key, entry as CacheEntry<unknown>);
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
