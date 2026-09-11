/**
 * Providers from configuration, not from code.
 *
 * A platform cannot require an edit to `registry.ts` to plug in a voice
 * model. `film.config.json` at the project root names the providers and
 * the engine loads them — a built-in by name, or any ES module that
 * default-exports a factory.
 *
 * Three rules the loader keeps, which are the same three the engine
 * keeps everywhere else:
 *
 *  - A provider that fails to load is reported, never silently dropped.
 *    Falling back to the deterministic path without saying so is how a
 *    build claims a quality it never had.
 *  - Secrets come from the environment. A config file that carries an
 *    API key ends up in version control.
 *  - The resolved set is described in the build's caveats, so a score
 *    sheet always states which of its numbers a model contributed to.
 */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, isAbsolute } from 'node:path';
import type { ProviderSet } from './types.ts';
import { deterministicProviders } from './registry.ts';

export type ProviderSlot = keyof ProviderSet;

export const PROVIDER_SLOTS: ProviderSlot[] = [
  'image',
  'inbetween',
  'segment',
  'pose',
  'tts',
  'music',
  'sfx',
];

export type ProviderSpec =
  | string
  | {
      /** A built-in name, or a module path exporting a factory by default. */
      use: string;
      /** Passed to the factory. Never put secrets here; use `envKey`. */
      options?: Record<string, unknown>;
      /** Environment variable holding the credential, read at load time. */
      envKey?: string;
    };

export type FilmConfig = {
  /** Project graph to build when no path is given on the command line. */
  project?: string;
  /** Where builds are written. */
  out?: string;
  providers?: Partial<Record<ProviderSlot, ProviderSpec>>;
  critics?: {
    /** Rubric ids a critic may block on once calibrated. */
    gating?: string[];
    calibration?: string;
  };
  /** Substrate used for the production render. */
  substrate?: 'ts_native' | 'blender_gp';
  /** Thresholds that override the built-in defaults, per check name. */
  thresholds?: Record<string, number>;
};

export const CONFIG_FILENAME = 'film.config.json';

export type LoadedConfig = {
  config: FilmConfig;
  /** Absolute path the config was read from, or null when defaulted. */
  path: string | null;
  /** Directory every relative path in the config resolves against. */
  root: string;
};

/** Find and read the config, walking up from `from` to the filesystem root. */
export function loadConfig(from: string = process.cwd()): LoadedConfig {
  let dir = resolve(from);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      try {
        return {
          config: JSON.parse(readFileSync(candidate, 'utf8')) as FilmConfig,
          path: candidate,
          root: dir,
        };
      } catch (e) {
        throw new Error(`${candidate} is not valid JSON: ${(e as Error).message}`);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { config: {}, path: null, root: resolve(from) };
    dir = parent;
  }
}

export type ResolvedProviders = {
  set: ProviderSet;
  /** One line per slot: what was asked for and what was actually loaded. */
  report: string[];
  /** Slots that were configured and could not be loaded. */
  failures: { slot: ProviderSlot; use: string; reason: string }[];
};

/**
 * Build a provider set from config.
 *
 * Every slot starts on its deterministic baseline, so a configured
 * provider replaces a working path rather than filling an empty one:
 * when it fails to load the build still runs, and the failure is in the
 * report rather than in the frames.
 */
export async function resolveProviders(
  loaded: LoadedConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProviders> {
  const set: ProviderSet = { ...deterministicProviders() };
  const report: string[] = [];
  const failures: ResolvedProviders['failures'] = [];
  const configured = loaded.config.providers ?? {};

  for (const slot of PROVIDER_SLOTS) {
    const spec = configured[slot];
    if (!spec) {
      report.push(`${slot}: deterministic baseline (nothing configured)`);
      continue;
    }
    const normal = typeof spec === 'string' ? { use: spec } : spec;
    if (normal.envKey && !env[normal.envKey]) {
      const reason = `${normal.envKey} is not set`;
      failures.push({ slot, use: normal.use, reason });
      report.push(`${slot}: ${normal.use} NOT loaded — ${reason}; using the deterministic baseline`);
      continue;
    }
    try {
      const factory = await loadFactory(normal.use, loaded.root);
      const provider = await factory({
        ...(normal.options ?? {}),
        ...(normal.envKey ? { credential: env[normal.envKey] } : {}),
      });
      if (!provider || typeof provider !== 'object') {
        throw new Error('the factory returned nothing usable');
      }
      (set as Record<string, unknown>)[slot] = provider;
      const named = provider as { name?: string; model?: string };
      report.push(`${slot}: ${named.name ?? normal.use} (${named.model ?? 'unversioned'})`);
    } catch (e) {
      const reason = (e as Error).message;
      failures.push({ slot, use: normal.use, reason });
      report.push(`${slot}: ${normal.use} NOT loaded — ${reason}; using the deterministic baseline`);
    }
  }

  return { set, report, failures };
}

type Factory = (options: Record<string, unknown>) => unknown | Promise<unknown>;

const BUILT_INS: Record<string, () => Factory> = {
  deterministic: () => () => undefined, // the baseline is already in place
};

async function loadFactory(use: string, root: string): Promise<Factory> {
  const builtIn = BUILT_INS[use];
  if (builtIn) return builtIn();
  const specifier = use.startsWith('.') || isAbsolute(use)
    ? pathToFileURL(resolve(root, use)).href
    : use;
  const mod = (await import(specifier)) as { default?: unknown };
  if (typeof mod.default !== 'function') {
    throw new Error(`${use} must default-export a factory function`);
  }
  return mod.default as Factory;
}

/** The caveats a build carries when providers are missing or failed. */
export function providerCaveats(resolved: ResolvedProviders): string[] {
  const out: string[] = [];
  for (const f of resolved.failures) {
    out.push(
      `The ${f.slot} provider "${f.use}" failed to load (${f.reason}). The deterministic baseline was used instead, and any check that would have measured it is reported as unmeasured rather than passed.`,
    );
  }
  return out;
}
