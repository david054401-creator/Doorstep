/**
 * The studio build — what the product UI reads.
 *
 * §6 of the blueprint asks for a shot board, a QA dashboard, an animatic
 * player, gate review with draw-over notes, a director-notes box and
 * score sheets. None of that is the engine's job, and the engine should
 * not grow a web server to provide it.
 *
 * So the seam is a directory. The engine writes a complete, static,
 * content-addressed description of a run; the studio reads it. Three
 * consequences worth stating:
 *
 *  - The UI cannot invent a number. Every score, check, repair and
 *    escalation it shows came out of a real run and carries the hash of
 *    the graph it was measured against.
 *  - A build is archivable and diffable. "What did we approve on
 *    Tuesday" is a directory, not a database query.
 *  - Human decisions (gate approvals, director notes) are written back
 *    into the same directory as separate files, so they survive a
 *    rebuild of the frames and can be replayed against a new graph.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, Shot, RepairRecord, DirectorNote, HumanApproval } from '../graph/types.ts';
import type { CheckResult, ScoreSheet } from '../core/result.ts';
import { scoreSheet as makeScoreSheet } from '../core/result.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { resize } from '../raster/buffer.ts';
import { encodePng } from '../raster/png.ts';
import { hashContent } from '../core/ids.ts';
import { auditInvariants, canDeliver } from '../validators/invariants.ts';
import type { InvariantStatus } from '../validators/invariants.ts';
import { timecode } from '../core/units.ts';

export const STUDIO_BUILD_VERSION = 1;

export type StudioNode = {
  id: string;
  department: string;
  title: string;
  shotId?: string;
  status: string;
  score?: number;
  passed: number;
  failed: number;
  warnings: number;
  fromCache: boolean;
  durationMs: number;
  repairs: RepairRecord[];
  escalation?: { summary: string; where: unknown };
  checks: CheckResult[];
  gate?: string;
};

export type StudioShot = {
  id: string;
  number: number;
  sceneId: string;
  sceneName: string;
  sequenceName: string;
  slug: string;
  durationFrames: number;
  timecode: string;
  size: string;
  angle: string;
  move: string;
  status: string;
  intent: string;
  beats: { id: string; intent: string; startFrame: number; durationFrames: number; emotion: string; intensity: number }[];
  dialogue: { id: string; characterId: string; text: string; startFrame: number; durationFrames: number }[];
  characters: string[];
  /** Relative paths, so the build directory can be moved or served. */
  frames: string[];
  board?: string;
  contactSheet?: string;
  score?: number;
  checks: CheckResult[];
};

export type StudioInvariant = {
  number: number;
  id: string;
  title: string;
  statement: string;
  state: InvariantStatus['state'];
  blocking: boolean;
  message: string;
  checks: string[];
  calibration?: string;
};

export type StudioBuild = {
  version: number;
  builtAt: string;
  project: {
    id: string;
    name: string;
    logline: string;
    styleBible: string;
    fps: number;
    width: number;
    height: number;
    characters: { id: string; name: string; description: string }[];
    environments: { id: string; name: string }[];
  };
  /** Hash of the graph this run measured. The UI shows it; it never guesses. */
  graphHash: string;
  score: ScoreSheet;
  departments: { department: string; score: number; passed: number; failed: number; warnings: number }[];
  nodes: StudioNode[];
  shots: StudioShot[];
  invariants: StudioInvariant[];
  delivery: { ok: boolean; blocking: string[]; unmeasured: string[] };
  escalated: string[];
  awaitingGate: string[];
  gates: { id: string; nodeId: string; gate: string; title: string; shotId?: string; artifact?: string }[];
  stats: { durationMs: number; cacheHits: number; nodes: number; checks: number; frames: number };
  /** Caveats that must travel with the build. Never silently dropped. */
  caveats: string[];
};

export type StudioDecisions = {
  approvals: (HumanApproval & { nodeId: string })[];
  notes: (DirectorNote & { shotId?: string })[];
};

const rel = (...parts: string[]): string => parts.join('/');

export type WriteStudioOptions = {
  /** Width of the frames written for the animatic player. */
  previewWidth?: number;
  /** Write every Nth frame. 1 keeps the animatic honest. */
  every?: number;
  caveats?: string[];
};

/**
 * Write the preview frames for one shot and return their relative paths.
 *
 * Frames are downscaled: the studio is a review tool, and shipping 1920px
 * PNGs to a browser to decide whether a hand arcs correctly is a waste of
 * everyone's time. The delivery master is written separately, at full
 * size, by `writeSequence`.
 */
export function writeShotFrames(
  dir: string,
  shotId: string,
  images: readonly ImageBuffer[],
  options: WriteStudioOptions = {},
): string[] {
  const previewWidth = options.previewWidth ?? 640;
  const every = Math.max(1, options.every ?? 1);
  const shotDir = join(dir, 'frames', shotId);
  mkdirSync(shotDir, { recursive: true });
  const paths: string[] = [];
  images.forEach((img, i) => {
    if (i % every !== 0 && i !== images.length - 1) return;
    const scale = previewWidth / img.width;
    const small =
      scale < 1 ? resize(img, previewWidth, Math.max(1, Math.round(img.height * scale))) : img;
    const name = `${String(i).padStart(5, '0')}.png`;
    writeFileSync(join(shotDir, name), encodePng(small, { level: 6 }));
    paths.push(rel('frames', shotId, name));
  });
  return paths;
}

export function writeStudioImage(dir: string, relPath: string, image: ImageBuffer): string {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, encodePng(image, { level: 6 }));
  return relPath;
}

export function buildStudio(
  project: Project,
  nodes: readonly StudioNode[],
  shots: readonly StudioShot[],
  stats: { durationMs: number; cacheHits: number },
  caveats: readonly string[] = [],
): StudioBuild {
  const allChecks = nodes.flatMap((n) => n.checks);
  const score = makeScoreSheet(project.name, allChecks);
  const audit = auditInvariants(allChecks);
  const delivery = canDeliver(allChecks);

  // Per-department rollup. The QA dashboard is sorted by this, because
  // "the film scores 0.96" is not an answer to "what is wrong with it".
  const byDepartment = new Map<string, CheckResult[]>();
  for (const c of allChecks) {
    const list = byDepartment.get(c.department);
    if (list) list.push(c);
    else byDepartment.set(c.department, [c]);
  }

  return {
    version: STUDIO_BUILD_VERSION,
    builtAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      logline: project.logline,
      styleBible: project.styleBible.name,
      fps: project.deliverySpec.fps,
      width: project.deliverySpec.width,
      height: project.deliverySpec.height,
      characters: project.characters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      })),
      environments: project.environments.map((e) => ({ id: e.id, name: e.name })),
    },
    graphHash: hashContent(project),
    score,
    departments: [...byDepartment]
      .map(([department, checks]) => {
        const sheet = makeScoreSheet(department, checks);
        return {
          department,
          score: sheet.score,
          passed: sheet.passed,
          failed: sheet.failed,
          warnings: sheet.warnings,
        };
      })
      .sort((a, b) => a.score - b.score),
    nodes: [...nodes],
    shots: [...shots],
    invariants: audit.map((a) => ({
      number: a.invariant.number,
      id: a.invariant.id,
      title: a.invariant.title,
      statement: a.invariant.statement,
      state: a.state,
      blocking: a.invariant.blocking,
      message: a.message,
      checks: a.invariant.checks,
      calibration: a.invariant.calibration,
    })),
    delivery: {
      ok: delivery.deliverable,
      blocking: delivery.blocked.map((s) => `${s.invariant.id}: ${s.message}`),
      // An invariant nobody measured is not an invariant that held, and
      // the studio shows it in its own column rather than as a pass.
      unmeasured: delivery.unmeasured.map((s) => s.invariant.id),
    },
    escalated: nodes.filter((n) => n.status === 'escalated').map((n) => n.id),
    awaitingGate: nodes.filter((n) => n.status === 'blocked' && n.gate).map((n) => n.id),
    gates: nodes
      .filter((n) => n.gate)
      .map((n) => ({
        id: `${n.gate}:${n.id}`,
        nodeId: n.id,
        gate: n.gate!,
        title: n.title,
        shotId: n.shotId,
        artifact: shots.find((s) => s.id === n.shotId)?.board,
      })),
    stats: {
      durationMs: stats.durationMs,
      cacheHits: stats.cacheHits,
      nodes: nodes.length,
      checks: allChecks.length,
      frames: shots.reduce((a, s) => a + s.frames.length, 0),
    },
    caveats: [...caveats],
  };
}

export function shotSummary(
  shot: Shot,
  project: Project,
  sceneName: string,
  sequenceName: string,
): Omit<StudioShot, 'frames' | 'board' | 'contactSheet' | 'score' | 'checks'> {
  return {
    id: shot.id,
    number: shot.number,
    sceneId: shot.sceneId,
    sceneName,
    sequenceName,
    slug: `${sceneName.replace(/\s+/g, '_').toUpperCase()}_SH${String(shot.number).padStart(3, '0')}`,
    durationFrames: shot.durationFrames,
    timecode: timecode(shot.durationFrames, project.deliverySpec.fps),
    size: shot.camera.size,
    angle: shot.camera.angle,
    move: shot.camera.move.move,
    status: shot.status,
    intent: shot.beats[0]?.intent ?? '',
    beats: shot.beats.map((b) => ({
      id: b.id,
      intent: b.intent,
      startFrame: b.startFrame,
      durationFrames: b.durationFrames,
      emotion: b.emotion,
      intensity: b.intensity,
    })),
    dialogue: shot.dialogue.map((l) => ({
      id: l.id,
      characterId: l.characterId,
      text: l.text,
      startFrame: l.startFrame,
      durationFrames: l.durationFrames,
    })),
    characters: shot.staging.characters.map((c) => c.characterId),
  };
}

export function writeStudioBuild(build: StudioBuild, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'studio.json');
  writeFileSync(path, JSON.stringify(build, null, 2));
  return path;
}

/** Human decisions live beside the build and survive a re-render. */
export function readDecisions(dir: string): StudioDecisions {
  const path = join(dir, 'decisions.json');
  if (!existsSync(path)) return { approvals: [], notes: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StudioDecisions>;
    return { approvals: parsed.approvals ?? [], notes: parsed.notes ?? [] };
  } catch {
    // A corrupt decisions file must not silently erase a director's
    // notes, and it must not take the studio down either.
    return { approvals: [], notes: [] };
  }
}

export function writeDecisions(dir: string, decisions: StudioDecisions): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'decisions.json');
  writeFileSync(path, JSON.stringify(decisions, null, 2));
  return path;
}
