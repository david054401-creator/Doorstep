/**
 * The Film Graph store.
 *
 * Immutable, content-addressed versions with provenance, a continuity
 * ledger of locked assets, and build-system invalidation: changing a
 * model sheet marks every shot that references it for re-validation.
 *
 * The filesystem backend is the reference. A Postgres or Supabase
 * backend implements the same interface; nothing above this file knows
 * the difference.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, ContinuityEntry, Version } from './types.ts';
import type { Hash, Provenance } from '../core/ids.ts';
import { hashContent, provenance as makeProvenance } from '../core/ids.ts';
import { parseProject } from './schema.ts';

export type GraphVersion = {
  hash: Hash;
  project: Project;
  provenance: Provenance;
  /** Sequential revision number, for a readable history. */
  revision: number;
  /** What changed relative to the previous revision. */
  summary: string;
};

export type GraphStore = {
  /** Commit a new immutable version. */
  commit(project: Project, summary: string, provenance?: Partial<Provenance>): GraphVersion;
  /** The current head. */
  head(): GraphVersion | undefined;
  /** A specific version by hash. */
  at(hash: Hash): GraphVersion | undefined;
  /** Full history, oldest first. */
  history(): GraphVersion[];
  /** Everything invalidated by the change between two versions. */
  diff(fromHash: Hash, toHash: Hash): InvalidationReport;
};

export type InvalidationReport = {
  /** Assets whose content changed. */
  changed: { assetId: string; kind: ContinuityEntry['kind']; from?: Version; to?: Version }[];
  /** Shots that must be re-validated because something they use changed. */
  invalidatedShots: string[];
  /** A sentence per change, for the event log and the shot board. */
  reasons: string[];
};

export function memoryStore(): GraphStore {
  // The store keeps the authoritative list; `save` is the persistence
  // hook only. An in-memory store has nothing to persist to, so pushing
  // here as well would record every commit twice.
  return makeStore({ load: () => [], save: () => {} });
}

export function fileStore(root: string): GraphStore {
  mkdirSync(root, { recursive: true });
  const indexPath = join(root, 'index.json');
  const readIndex = (): { hash: Hash; revision: number; summary: string }[] =>
    existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];

  return makeStore({
    load: () =>
      readIndex().map((entry) => {
        const raw = JSON.parse(readFileSync(join(root, `${entry.hash.replace('sha256:', '')}.json`), 'utf8'));
        return {
          hash: entry.hash,
          revision: entry.revision,
          summary: entry.summary,
          project: parseProject(raw.project),
          provenance: raw.provenance as Provenance,
        };
      }),
    save: (v) => {
      writeFileSync(
        join(root, `${v.hash.replace('sha256:', '')}.json`),
        JSON.stringify({ project: v.project, provenance: v.provenance }, null, 0),
      );
      const index = readIndex();
      index.push({ hash: v.hash, revision: v.revision, summary: v.summary });
      writeFileSync(indexPath, JSON.stringify(index, null, 2));
    },
  });
}

function makeStore(io: { load: () => GraphVersion[]; save: (v: GraphVersion) => void }): GraphStore {
  let cache: GraphVersion[] | null = null;
  const all = (): GraphVersion[] => {
    cache ??= io.load();
    return cache;
  };

  return {
    commit(project, summary, prov) {
      const versions = all();
      const hash = hashContent(stripVolatile(project));
      const existing = versions.find((v) => v.hash === hash);
      if (existing) return existing;
      const version: GraphVersion = {
        hash,
        project,
        revision: versions.length + 1,
        summary,
        provenance: makeProvenance({
          tool: prov?.tool ?? 'graph.commit',
          toolVersion: prov?.toolVersion ?? '1',
          inputs: versions.length ? [versions[versions.length - 1].hash] : [],
          ...prov,
        }),
      };
      versions.push(version);
      io.save(version);
      return version;
    },
    head: () => all()[all().length - 1],
    at: (hash) => all().find((v) => v.hash === hash),
    history: () => [...all()],
    diff(fromHash, toHash) {
      const from = all().find((v) => v.hash === fromHash);
      const to = all().find((v) => v.hash === toHash);
      if (!from || !to) {
        return { changed: [], invalidatedShots: [], reasons: ['One of the versions is unknown.'] };
      }
      return invalidationBetween(from.project, to.project);
    },
  };
}

/** Fields that change on every save but mean nothing to the content. */
function stripVolatile(project: Project): unknown {
  return { ...project, updatedAt: '' };
}

/**
 * Build-system invalidation.
 *
 * An upstream change marks everything downstream dirty. This is how
 * "changing a model sheet re-validates every shot that uses it" becomes
 * automatic rather than a thing someone has to remember.
 */
export function invalidationBetween(before: Project, after: Project): InvalidationReport {
  const changed: InvalidationReport['changed'] = [];
  const reasons: string[] = [];

  const bibleBefore = hashContent(before.styleBible);
  const bibleAfter = hashContent(after.styleBible);
  const bibleChanged = bibleBefore !== bibleAfter;
  if (bibleChanged) {
    changed.push({
      assetId: after.styleBible.id,
      kind: 'styleBible',
      from: before.styleBible.version,
      to: after.styleBible.version,
    });
    reasons.push(
      `The style bible changed (v${before.styleBible.version} to v${after.styleBible.version}); everything downstream of it is dirty.`,
    );
  }

  const changedCharacters = new Set<string>();
  for (const a of after.characters) {
    const b = before.characters.find((c) => c.id === a.id);
    if (!b) {
      changedCharacters.add(a.id);
      changed.push({ assetId: a.id, kind: 'modelSheet', to: a.modelSheet.version });
      reasons.push(`${a.name} is new to the project.`);
      continue;
    }
    if (hashContent(b.modelSheet) !== hashContent(a.modelSheet)) {
      changedCharacters.add(a.id);
      changed.push({
        assetId: a.modelSheet.id,
        kind: 'modelSheet',
        from: b.modelSheet.version,
        to: a.modelSheet.version,
      });
      reasons.push(`${a.name}'s model sheet changed; every shot they appear in must be re-validated.`);
    }
    if (a.rig && b.rig && hashContent(a.rig) !== hashContent(b.rig)) {
      changedCharacters.add(a.id);
      changed.push({ assetId: a.rig.id, kind: 'rig', from: b.rig.version, to: a.rig.version });
      reasons.push(`${a.name}'s rig changed; their animation must be re-evaluated.`);
    }
  }

  const changedEnvironments = new Set<string>();
  for (const a of after.environments) {
    const b = before.environments.find((e) => e.id === a.id);
    if (!b || hashContent(a) !== hashContent(b)) {
      changedEnvironments.add(a.id);
      changed.push({ assetId: a.id, kind: 'environment' });
      reasons.push(`Environment "${a.name}" changed; every shot set there must be re-rendered.`);
    }
  }

  // Which shots depend on what changed?
  const invalidated = new Set<string>();
  for (const sequence of after.sequences) {
    for (const scene of sequence.scenes) {
      const envDirty = changedEnvironments.has(scene.environmentId);
      for (const shot of scene.shots) {
        const shotBefore = findShot(before, shot.id);
        if (bibleChanged || envDirty) {
          invalidated.add(shot.id);
          continue;
        }
        if (shot.staging.characters.some((c) => changedCharacters.has(c.characterId))) {
          invalidated.add(shot.id);
          continue;
        }
        if (!shotBefore || hashContent(stripShotVolatile(shotBefore)) !== hashContent(stripShotVolatile(shot))) {
          invalidated.add(shot.id);
        }
      }
    }
  }

  return { changed, invalidatedShots: [...invalidated].sort(), reasons };
}

function findShot(project: Project, shotId: string) {
  for (const s of project.sequences) {
    for (const sc of s.scenes) {
      const hit = sc.shots.find((x) => x.id === shotId);
      if (hit) return hit;
    }
  }
  return undefined;
}

function stripShotVolatile(shot: Project['sequences'][number]['scenes'][number]['shots'][number]) {
  return { ...shot, validation: undefined, repairs: [], frames: undefined, status: 'planned' };
}

/**
 * Lock an asset into the continuity ledger.
 *
 * A locked asset is the truth every shot references (design law 2). The
 * ledger records which shots use which version, so the invalidation
 * report above can be exact rather than conservative.
 */
export function lockAsset(
  project: Project,
  entry: Omit<ContinuityEntry, 'lockedAt'>,
): Project {
  const entries = project.continuity.entries.filter(
    (e) => !(e.assetId === entry.assetId && e.kind === entry.kind),
  );
  entries.push({ ...entry, lockedAt: new Date().toISOString() });
  return { ...project, continuity: { ...project.continuity, entries } };
}

/** Record which locked versions a shot was built against. */
export function stampLockedAssets(project: Project, shotId: string): Project {
  const locked: Record<string, Version> = {};
  for (const e of project.continuity.entries) locked[e.assetId] = e.version;
  return {
    ...project,
    sequences: project.sequences.map((seq) => ({
      ...seq,
      scenes: seq.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) =>
          shot.id === shotId ? { ...shot, lockedAssets: locked } : shot,
        ),
      })),
    })),
  };
}

/** Shots whose locked versions no longer match the ledger. */
export function staleShots(project: Project): { shotId: string; reason: string }[] {
  const current = new Map(project.continuity.entries.map((e) => [e.assetId, e.version]));
  const out: { shotId: string; reason: string }[] = [];
  for (const seq of project.sequences) {
    for (const scene of seq.scenes) {
      for (const shot of scene.shots) {
        for (const [assetId, version] of Object.entries(shot.lockedAssets)) {
          const now = current.get(assetId);
          if (now !== undefined && now !== version) {
            out.push({
              shotId: shot.id,
              reason: `Built against ${assetId} v${version}; the ledger now locks v${now}.`,
            });
          }
        }
      }
    }
  }
  return out;
}

/** List the version files in a file store, for the CLI. */
export function listVersions(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort();
}
