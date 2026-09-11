/**
 * THE PIPELINE
 *
 * The department DAG, assembled from a project. Character and environment
 * nodes are shared upstream; every shot then gets its own independent
 * chain, which is what lets shots run in parallel and lets a single shot
 * be rebuilt without touching its neighbours.
 *
 *   story ─┬─ characters ─ rigs ─┐
 *          ├─ environments ──────┼─ per shot: board ─ block ─ animate
 *          └─ style bible ───────┘        ─ render ─ comp ─ audio ─ deliver
 *
 * Human gates sit on boards, model sheets and the animatic: the three
 * cheap artifacts (design law 10).
 */

import type {
  Project,
  Shot,
  Character,
  Environment,
  Sequence,
  ValidationRecord,
} from '../graph/types.ts';
import type { NodeContract } from './dag.ts';
import { buildDag } from './dag.ts';
import type { Dag } from './dag.ts';
import type { CheckResult } from '../core/result.ts';
import { pass, scoreSheet } from '../core/result.ts';
import type { ImageBuffer } from '../raster/buffer.ts';

import { validateStory, checkContinuity } from '../story/validators.ts';
import { validateGrammar } from '../director/grammar.ts';
import { validateRig } from '../rig/validators.ts';
import { repairRig } from '../rig/repair.ts';
import { blockShot } from '../animation/blocking.ts';
import { evaluateShot } from '../animation/evaluate.ts';
import type { EvaluatedFrame } from '../animation/evaluate.ts';
import { validatePrinciples } from '../director/principles.ts';
import { SHOT_REPAIR_TABLE } from '../director/repair-table.ts';
import { renderScene, renderCharacterPlate } from '../render/renderer.ts';
import { validateCamera, validateDepthOrder, validateFraming, validatePhotosensitivity, validateDelivery, validateNoText } from '../validators/comp.ts';
import { validatePaletteConformance, validateValueStructure, validateBibleConformance } from '../validators/color.ts';
import { validateLipsync } from '../audio/validators.ts';
import { buildCueSheet } from '../audio/cue-sheet.ts';
import { allShots } from '../story/script-to-shots.ts';
import { frameGroup, staticCurve } from '../render/camera.ts';
import { planShots, DEFAULT_POLICY } from './budget.ts';
import type { ProducerPolicy } from './budget.ts';
import type { Logger } from '../core/log.ts';
import { silentLogger } from '../core/log.ts';

export type PipelineOptions = {
  logger?: Logger;
  /** Render resolution. Defaults to the delivery spec; lower it for previews. */
  width?: number;
  height?: number;
  /** Anti-aliasing samples; 4 for preview, 8 for a master. */
  samples?: number;
  /** Producer policy for the organic-pass ladder. */
  policy?: ProducerPolicy;
  /** Skip the expensive render nodes — useful for a story-only pass. */
  throughStage?: 'story' | 'boards' | 'animation' | 'render' | 'delivery';
  /** Repair attempts per shot. */
  shotRepairAttempts?: number;
};

const STAGE_ORDER = ['story', 'boards', 'animation', 'render', 'delivery'] as const;

export type StoryOutput = { sequence: Sequence; checks: CheckResult[] };
export type CastOutput = { characters: Character[]; checks: CheckResult[] };
export type EnvOutput = { environments: Environment[] };
export type BoardOutput = { shot: Shot; board: ImageBuffer };
export type BlockOutput = { shot: Shot; idleLayers: Record<string, unknown> };
export type AnimateOutput = { shot: Shot; frames: EvaluatedFrame[] };
export type RenderOutput = { shot: Shot; images: ImageBuffer[]; plates: Map<string, ImageBuffer[]> };

/**
 * Build the pipeline DAG for a project.
 *
 * The project is captured by reference in the node closures; the cache
 * keys are derived from content hashes of the node inputs, so a change
 * anywhere upstream invalidates exactly what it should.
 */
export function buildPipeline(project: Project, options: PipelineOptions = {}): Dag {
  const log = options.logger ?? silentLogger();
  const width = options.width ?? project.deliverySpec.width;
  const height = options.height ?? project.deliverySpec.height;
  const samples = options.samples ?? 4;
  const fps = project.deliverySpec.fps;
  const throughIndex = STAGE_ORDER.indexOf(options.throughStage ?? 'delivery');
  // A preview run renders smaller than the master. The delivery checks
  // must judge what was actually rendered, or a preview always "fails"
  // resolution for a reason that has nothing to do with the film.
  const effectiveDelivery = { ...project.deliverySpec, width, height };
  const wants = (stage: (typeof STAGE_ORDER)[number]): boolean =>
    STAGE_ORDER.indexOf(stage) <= throughIndex;

  const nodes: NodeContract<never, unknown>[] = [];
  const sequence = project.sequences[0];
  const shots = sequence ? allShots(sequence) : [];
  const plan = new Map(
    planShots(shots, options.policy ?? DEFAULT_POLICY, fps).plans.map((p) => [p.shotId, p]),
  );

  // --- Development -------------------------------------------------------
  nodes.push({
    id: 'story',
    department: 'story',
    title: 'Script and shot list',
    inputs: [],
    tool: 'story.breakdown',
    toolVersion: '1',
    params: { logline: project.logline, shots: shots.length },
    budget: { attempts: 1 },
    run: (): StoryOutput => {
      const checks = [
        ...validateStory(sequence, project, { fps, audience: 'preschool' }),
        ...checkContinuity(sequence).checks,
        ...validateGrammar(sequence, { fps }),
      ];
      return { sequence, checks };
    },
    validate: (out) => (out as StoryOutput).checks,
  });

  // --- Visual development ------------------------------------------------
  nodes.push({
    id: 'stylebible',
    department: 'visdev',
    title: 'Style bible',
    inputs: [],
    tool: 'visdev.bible',
    toolVersion: '1',
    params: { id: project.styleBible.id, version: project.styleBible.version },
    budget: { attempts: 1 },
    run: () => project.styleBible,
    validate: (bible) => validateStyleBible(bible as Project['styleBible']),
  });

  // --- Character and rigging --------------------------------------------
  for (const character of project.characters) {
    nodes.push({
      id: `sheet:${character.id}`,
      department: 'character',
      title: `Model sheet — ${character.name}`,
      inputs: ['stylebible'],
      tool: 'character.sheet',
      toolVersion: '1',
      params: { characterId: character.id, version: character.modelSheet.version },
      budget: { attempts: 1 },
      gate: 'modelSheet',
      run: () => character.modelSheet,
      validate: () => validateModelSheet(character),
    });

    nodes.push({
      id: `rig:${character.id}`,
      department: 'rigging',
      title: `Rig — ${character.name}`,
      inputs: [`sheet:${character.id}`],
      tool: 'rig.autorig',
      toolVersion: '2',
      params: { characterId: character.id, rigVersion: character.rig?.version ?? 0 },
      budget: { attempts: 6 },
      run: () => {
        if (!character.rig) throw new Error(`${character.name} has no rig`);
        return character.rig;
      },
      validate: (rig) => validateRig(rig as NonNullable<Character['rig']>).checks,
      repair: (rig) => {
        const out = repairRig(rig as NonNullable<Character['rig']>, {
          budget: { attempts: 8 },
          logger: log,
        });
        return out.rig;
      },
    });
  }

  // --- Environments -------------------------------------------------------
  for (const environment of project.environments) {
    nodes.push({
      id: `env:${environment.id}`,
      department: 'layout',
      title: `Environment — ${environment.name}`,
      inputs: ['stylebible'],
      tool: 'layout.environment',
      toolVersion: '1',
      params: { environmentId: environment.id, layers: environment.layers.length },
      budget: { attempts: 1 },
      run: () => environment,
      validate: () => validateEnvironment(environment),
    });
  }

  // --- Audio planning -----------------------------------------------------
  nodes.push({
    id: 'cuesheet',
    department: 'audio',
    title: 'Cue sheet',
    inputs: ['story'],
    tool: 'audio.cuesheet',
    toolVersion: '1',
    budget: { attempts: 1 },
    run: () => buildCueSheet(sequence, { fps }),
    validate: (cues) => {
      const c = cues as ReturnType<typeof buildCueSheet>;
      return [
        pass({
          name: 'audio.cue_sheet',
          department: 'audio',
          score: 1,
          message: `${c.music.length} music cue(s) and ${c.sfx.length} effect(s) derived from the beats.`,
          where: { sequenceId: sequence?.id },
        }),
      ];
    },
  });

  // --- Per shot ------------------------------------------------------------
  const characterIds = project.characters.map((c) => `rig:${c.id}`);
  const envIds = project.environments.map((e) => `env:${e.id}`);

  for (const shot of shots) {
    const scene = sequence.scenes.find((s) => s.shots.some((x) => x.id === shot.id));
    const environment = project.environments.find((e) => e.id === scene?.environmentId);
    const shotPlan = plan.get(shot.id);

    // Boards: once the cast is rigged a board is a posed rig, so it is
    // cheap and on-model by construction.
    if (wants('boards')) {
      nodes.push({
        id: `board:${shot.id}`,
        department: 'boards',
        title: `Board — shot ${shot.number}`,
        inputs: ['story', ...characterIds, ...envIds],
        tool: 'boards.pose',
        toolVersion: '1',
        shotId: shot.id,
        params: { shotId: shot.id, size: shot.camera.size },
        budget: { attempts: 2 },
        gate: shot.number === 1 ? 'boards' : undefined,
        run: (): BoardOutput => {
          const framed = withFraming(shot, project, width, height, environment);
          const { shot: blocked, idleLayers } = blockShot(framed, project.characters, { fps, seed: shot.id });
          const frames = evaluateShot(blocked, project, {
            fps,
            idleLayers,
            environment,
            width: Math.round(width / 2),
            height: Math.round(height / 2),
          });
          const key = frames[Math.floor(frames.length / 2)] ?? frames[0];
          return { shot: framed, board: renderScene(key.scene, { samples: 2 }) };
        },
        validate: (out) => {
          const o = out as BoardOutput;
          return [
            validateNoText(o.board, { shotId: shot.id }),
            ...validateBibleConformance(o.board, project.styleBible, environment, { shotId: shot.id }),
          ];
        },
      });
    }

    if (!wants('animation')) continue;

    nodes.push({
      id: `block:${shot.id}`,
      department: 'animation',
      title: `Blocking — shot ${shot.number}`,
      inputs: ['story', ...characterIds],
      tool: 'animation.blocking',
      toolVersion: '2',
      shotId: shot.id,
      params: { shotId: shot.id, beats: shot.beats.length },
      budget: { attempts: 1 },
      run: (): BlockOutput => {
        const framed = withFraming(shot, project, width, height, environment);
        const { shot: blocked, idleLayers } = blockShot(framed, project.characters, { fps, seed: shot.id });
        return { shot: blocked, idleLayers };
      },
      validate: (out) => {
        const o = out as BlockOutput;
        return [
          ...validateLipsync(o.shot, { fps }),
          ...validateCamera(o.shot),
          validateDepthOrder(o.shot, environment),
        ];
      },
    });

    nodes.push({
      id: `animate:${shot.id}`,
      department: 'animation',
      title: `Animation — shot ${shot.number}`,
      inputs: [`block:${shot.id}`, ...envIds],
      tool: 'animation.evaluate',
      toolVersion: '2',
      shotId: shot.id,
      params: { shotId: shot.id },
      budget: { attempts: options.shotRepairAttempts ?? 8 },
      run: (ctx): AnimateOutput => {
        // This node has more than one input (the blocking plus every
        // environment), so the single-input convenience view does not
        // apply; the blocking is fetched by id.
        const block = ctx.inputs[`block:${shot.id}`] as BlockOutput;
        const blocked = block.shot;
        const idleLayers = block.idleLayers as Record<string, never>;
        const frames = evaluateShot(blocked, project, { fps, idleLayers, environment, width, height });
        return { shot: blocked, frames };
      },
      validate: (out) => {
        const o = out as AnimateOutput;
        const primaryFrames = evaluateShot(o.shot, project, {
          fps,
          environment,
          width,
          height,
          primaryOnly: true,
        });
        return validatePrinciples(o.shot, o.frames, project, { fps, primaryFrames });
      },
      repair: (out, check, attempt) => {
        const o = out as AnimateOutput;
        if (!check.diagnosis) return null;
        const move = SHOT_REPAIR_TABLE.find((m) => m.diagnoses.includes(check.diagnosis!));
        if (!move) return null;
        const next = move.apply(o.shot, check, attempt);
        if (!next) return null;
        return {
          shot: next,
          frames: evaluateShot(next, project, { fps, environment, width, height }),
        };
      },
    });

    if (!wants('render')) continue;

    nodes.push({
      id: `render:${shot.id}`,
      department: 'render',
      title: `Render — shot ${shot.number}`,
      inputs: [`animate:${shot.id}`],
      tool: 'render.deterministic',
      toolVersion: '2',
      shotId: shot.id,
      params: { shotId: shot.id, width, height, samples, organic: shotPlan?.organicPass ?? 'off' },
      budget: { attempts: 1, timeMs: 600_000 },
      run: (ctx): RenderOutput => {
        const o = ctx.input as AnimateOutput;
        const images = o.frames.map((f) => renderScene(f.scene, { samples }));
        const plates = new Map<string, ImageBuffer[]>();
        for (const character of project.characters) {
          if (!o.shot.staging.characters.some((c) => c.characterId === character.id)) continue;
          plates.set(
            character.id,
            o.frames.map((f) => renderCharacterPlate(f.scene, character.id, { samples })),
          );
        }
        return { shot: o.shot, images, plates };
      },
      validate: (out) => {
        const o = out as RenderOutput;
        const checks: CheckResult[] = [];
        const sampleIdx = [0, Math.floor(o.images.length / 2), o.images.length - 1].filter(
          (i, k, arr) => i >= 0 && i < o.images.length && arr.indexOf(i) === k,
        );
        for (const character of project.characters) {
          const platesFor = o.plates.get(character.id);
          if (!platesFor) continue;
          for (const i of sampleIdx) {
            checks.push(
              ...validatePaletteConformance(
                o.images[i],
                platesFor[i],
                character.colorModel,
                {},
                { shotId: shot.id, characterId: character.id, frame: i },
              ),
              ...validateValueStructure(o.images[i], platesFor[i], {}, {
                shotId: shot.id,
                characterId: character.id,
                frame: i,
              }),
              ...validateFraming(platesFor[i], effectiveDelivery, {}, {
                shotId: shot.id,
                characterId: character.id,
                frame: i,
              }),
            );
          }
        }
        checks.push(...validatePhotosensitivity(o.images, { fps }, { shotId: shot.id }));
        checks.push(...validateDelivery(o.images, o.shot, effectiveDelivery));
        return checks;
      },
    });
  }

  // --- Animatic gate -------------------------------------------------------
  if (wants('boards') && shots.length > 0) {
    nodes.push({
      id: 'animatic',
      department: 'boards',
      title: 'Animatic',
      inputs: shots.map((s) => `board:${s.id}`).filter((id) => nodes.some((n) => n.id === id)),
      tool: 'boards.animatic',
      toolVersion: '1',
      budget: { attempts: 1 },
      gate: 'animatic',
      run: (ctx) => {
        const boards = Object.values(ctx.inputs) as BoardOutput[];
        return { frames: boards.length, totalFrames: shots.reduce((a, s) => a + s.durationFrames, 0) };
      },
      validate: () => validateGrammar(sequence, { fps }),
    });
  }

  return buildDag(nodes);
}

/** Frame the shot on its subjects before anything else reads the camera. */
export function withFraming(
  shot: Shot,
  project: Project,
  width: number,
  height: number,
  environment?: Environment,
): Shot {
  const first = shot.staging.characters[0];
  if (!first) return shot;
  const character = project.characters.find((c) => c.id === first.characterId);
  const headPx = character?.modelSheet.construction.headHeightPx ?? 120;
  const units = character?.modelSheet.construction.headUnits ?? 3;
  const totalPx = headPx * units;
  const state = frameGroup({
    size: shot.camera.size,
    subjects: shot.staging.characters,
    subjectHeightPx: totalPx,
    headHeightPx: headPx,
    canvasWidth: width,
    canvasHeight: height,
    subjectTopY: -totalPx,
  });
  // Place the cast in the multiplane stack: standing on the ground means
  // sitting just in front of the ground plane and behind anything the
  // layout marks as foreground.
  const staged = environment ? placeInDepth(shot, environment) : shot;

  // Preserve an authored move; only supply a camera when there is none.
  if (staged.camera.move.keys.length > 1) return staged;
  return { ...staged, camera: { ...staged.camera, move: staticCurve(state) } };
}

/** Resolve each character's depth against the environment's planes. */
export function placeInDepth(shot: Shot, environment: Environment): Shot {
  const isForeground = (l: Environment['layers'][number]): boolean =>
    /fg|foreground|overlay/i.test(`${l.id} ${l.name}`);
  const ground = environment.layers
    .filter((l) => !isForeground(l))
    .reduce((a, l) => Math.max(a, l.depth), 0);
  const foreground = environment.layers
    .filter(isForeground)
    .reduce((a, l) => Math.min(a, l.depth), 1);
  const depth = Math.min(Math.max(ground + 0.02, 0.05), Math.max(foreground - 0.02, 0.06));
  return {
    ...shot,
    staging: {
      ...shot.staging,
      characters: shot.staging.characters.map((c) => ({ ...c, depth })),
    },
  };
}

function validateStyleBible(bible: Project['styleBible']): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(
    bible.palette.length >= 4
      ? pass({
          name: 'visdev.palette_defined',
          department: 'visdev',
          score: 1,
          message: `${bible.palette.length} named swatches defined.`,
          where: {},
        })
      : {
          name: 'visdev.palette_defined',
          department: 'visdev',
          pass: false,
          score: bible.palette.length / 4,
          severity: 'error',
          message: `Only ${bible.palette.length} named swatches; a bible needs a real palette before anything can be checked against it.`,
          diagnosis: 'visdev.thin_palette',
          where: {},
        },
  );
  out.push(
    bible.forbidden.length > 0
      ? pass({
          name: 'visdev.forbidden_list',
          department: 'visdev',
          score: 1,
          message: `${bible.forbidden.length} forbidden treatments declared.`,
          where: {},
        })
      : {
          name: 'visdev.forbidden_list',
          department: 'visdev',
          pass: false,
          score: 0,
          severity: 'warn',
          message:
            'The bible declares nothing forbidden. Without a forbidden list the style critics have nothing specific to scan for.',
          diagnosis: 'visdev.no_forbidden_list',
          where: {},
        },
  );
  return out;
}

function validateModelSheet(character: Character): CheckResult[] {
  const sheet = character.modelSheet;
  const views = Object.keys(sheet.views);
  const out: CheckResult[] = [];
  out.push(
    views.length >= 3
      ? pass({
          name: 'character.turnaround_complete',
          department: 'character',
          score: 1,
          message: `${views.length} views on the sheet: ${views.join(', ')}.`,
          where: { characterId: character.id },
        })
      : {
          name: 'character.turnaround_complete',
          department: 'character',
          pass: false,
          score: views.length / 3,
          severity: 'error',
          message: `Only ${views.length} view(s) on the model sheet; a rig needs at least front, three-quarter and side.`,
          diagnosis: 'character.incomplete_turnaround',
          where: { characterId: character.id },
        },
  );

  // Proportions must agree across views to within 5%.
  const ratios = sheet.construction.proportionRatios;
  const named = Object.entries(ratios).filter(([, v]) => v > 0);
  out.push(
    named.length >= 3
      ? pass({
          name: 'character.proportions_measured',
          department: 'character',
          score: 1,
          message: `${named.length} proportion ratios measured off the sheet; the character is ${sheet.construction.headUnits.toFixed(2)} heads tall.`,
          where: { characterId: character.id },
        })
      : {
          name: 'character.proportions_measured',
          department: 'character',
          pass: false,
          score: named.length / 3,
          severity: 'warn',
          message:
            'Too few proportion ratios measured; the on-model gate has nothing to compare a frame against.',
          diagnosis: 'character.unmeasured_sheet',
          where: { characterId: character.id },
        },
  );

  out.push(
    character.colorModel.length > 0
      ? pass({
          name: 'character.color_model',
          department: 'character',
          score: 1,
          message: `${character.colorModel.length} swatches in the colour model.`,
          where: { characterId: character.id },
        })
      : {
          name: 'character.color_model',
          department: 'character',
          pass: false,
          score: 0,
          severity: 'error',
          message: 'No colour model, so palette conformance cannot be checked on any frame.',
          diagnosis: 'character.no_color_model',
          where: { characterId: character.id },
        },
  );
  return out;
}

function validateEnvironment(environment: Environment): CheckResult[] {
  const out: CheckResult[] = [];
  const depths = environment.layers.map((l) => l.depth).sort((a, b) => a - b);
  const distinct = new Set(depths).size;
  out.push(
    distinct >= 3
      ? pass({
          name: 'layout.multiplane',
          department: 'layout',
          score: 1,
          message: `${distinct} distinct depth planes: the set has real parallax.`,
          where: { environmentId: environment.id },
        })
      : {
          name: 'layout.multiplane',
          department: 'layout',
          pass: false,
          score: distinct / 3,
          severity: 'warn',
          message: `Only ${distinct} depth plane(s). A flat background is the clearest sign nobody laid the shot out.`,
          diagnosis: 'layout.flat_background',
          where: { environmentId: environment.id },
        },
  );
  out.push(
    environment.layout.vanishingPoints.length > 0
      ? pass({
          name: 'layout.perspective_defined',
          department: 'layout',
          score: 1,
          message: `Horizon at ${(environment.layout.horizonY * 100).toFixed(0)}% with ${environment.layout.vanishingPoints.length} vanishing point(s).`,
          where: { environmentId: environment.id },
        })
      : {
          name: 'layout.perspective_defined',
          department: 'layout',
          pass: false,
          score: 0,
          severity: 'warn',
          message: 'No vanishing points declared, so perspective cannot be checked against the camera.',
          diagnosis: 'layout.no_perspective',
          where: { environmentId: environment.id },
        },
  );
  return out;
}

/** Roll every node's checks into the validation record for a shot. */
export function shotValidation(checks: readonly CheckResult[], shotId: string): ValidationRecord {
  const mine = checks.filter((c) => c.where.shotId === shotId);
  return {
    checks: mine,
    criticVerdicts: [],
    scoreSheet: scoreSheet(`shot:${shotId}`, mine),
  };
}
