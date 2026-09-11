/**
 * Reading an engine build from disk.
 *
 * Server only — it imports `node:fs`, so a client component that reached
 * for it would fail the build rather than ship a broken bundle.
 *
 * The studio never computes a score, a check or a verdict. It reads what
 * the engine measured and shows it. Everything in this file is therefore
 * about locating a build and failing legibly when there isn't one —
 * "no build found" is a real state a review tool has to render well,
 * not an exception to throw at a director.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import type { StudioBuild, StudioDecisions } from './types';
import { STUDIO_BUILD_VERSION } from './types';

/**
 * Where the build lives. `FILM_STUDIO_BUILD` wins; otherwise the
 * conventional locations, nearest first.
 */
export function buildDirectory(): string {
  const configured = process.env.FILM_STUDIO_BUILD;
  if (configured) return resolve(configured);
  return resolve(process.cwd(), 'out', 'studio');
}

export type BuildState =
  | { ok: true; build: StudioBuild; directory: string; decisions: StudioDecisions }
  | { ok: false; directory: string; reason: string; hint: string };

export async function loadBuild(): Promise<BuildState> {
  const directory = buildDirectory();
  const manifest = join(directory, 'studio.json');

  let raw: string;
  try {
    raw = await readFile(manifest, 'utf8');
  } catch {
    return {
      ok: false,
      directory,
      reason: `No build at ${manifest}.`,
      hint: 'cd engine && node bin/film.mjs studio --out ../out/studio',
    };
  }

  let build: StudioBuild;
  try {
    build = JSON.parse(raw) as StudioBuild;
  } catch (e) {
    return {
      ok: false,
      directory,
      reason: `${manifest} is not valid JSON: ${(e as Error).message}`,
      hint: 'Re-run the build rather than hand-editing the manifest.',
    };
  }

  if (build.version !== STUDIO_BUILD_VERSION) {
    // Rendering a build format you do not understand is how a review
    // tool ends up quietly showing the wrong numbers.
    return {
      ok: false,
      directory,
      reason: `This build is format version ${build.version}; the studio reads version ${STUDIO_BUILD_VERSION}.`,
      hint: 'Rebuild with a matching engine, or check out the engine revision that wrote it.',
    };
  }

  return { ok: true, build, directory, decisions: await loadDecisions(directory) };
}

export async function loadDecisions(directory: string): Promise<StudioDecisions> {
  try {
    const raw = await readFile(join(directory, 'decisions.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StudioDecisions>;
    return { approvals: parsed.approvals ?? [], notes: parsed.notes ?? [] };
  } catch {
    return { approvals: [], notes: [] };
  }
}

/**
 * Resolve a path inside the build directory, refusing anything that
 * escapes it. Build directories are configurable and asset paths come
 * from the URL, so this is the one place traversal can happen.
 */
export function resolveAsset(relPath: string): string | null {
  const root = buildDirectory();
  const target = resolve(root, normalize(relPath));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export async function assetExists(relPath: string): Promise<boolean> {
  const target = resolveAsset(relPath);
  if (!target) return false;
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

export function shotById(build: StudioBuild, shotId: string) {
  return build.shots.find((s) => s.id === shotId);
}

export function nodesForShot(build: StudioBuild, shotId: string) {
  return build.nodes.filter((n) => n.shotId === shotId);
}
