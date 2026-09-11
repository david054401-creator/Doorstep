/**
 * Shot evaluation: Film Graph to per-frame poses and scenes.
 *
 * This is the single place where a shot becomes concrete. The renderer and
 * every validator read from here, so what is measured is exactly what is
 * rendered — there is no second code path that could disagree.
 */

import type {
  Shot,
  Character,
  Environment,
  Project,
  Viseme,
  ViewName,
  Placement,
} from '../graph/types.ts';
import type { Pose } from '../rig/skeleton.ts';
import { evaluateStack, channelTargets } from '../timing/curves.ts';
import { steppedFrame } from '../timing/chart.ts';
import { visemeAt } from './lipsync.ts';
import type { IdleLayer } from './idle.ts';
import { resolveSwaps } from './idle.ts';
import { poseRig, prepareRig, defaultSwaps } from '../rig/rig.ts';
import type { PreparedRig, PosedRig } from '../rig/rig.ts';
import { evaluateCamera, cameraMatrix, parallaxFor } from '../render/camera.ts';
import type { Scene as DrawScene, DrawLayer } from '../render/scene.ts';
import { emptyScene } from '../render/scene.ts';
import { parseHex } from '../core/color.ts';
import type { NamedSwatch, RGB } from '../core/color.ts';
import type { Vec2 } from '../core/math.ts';
import { mmul, mTranslate, mScale } from '../core/math.ts';
import { simulateSprings } from '../rig/spring.ts';
import { DEFAULT_FPS } from '../core/units.ts';

export type EvaluatedFrame = {
  frame: number;
  /** Per-character posed rig. */
  characters: Map<string, { posed: PosedRig; pose: Pose; view: ViewName; swaps: Record<string, string> }>;
  scene: DrawScene;
};

export type EvaluateOptions = {
  fps?: number;
  idleLayers?: Record<string, IdleLayer>;
  /** Honour the ones/twos chart. Off for validators that need true motion. */
  applyStepping?: boolean;
  /** Include background layers from the environment. */
  environment?: Environment;
  /**
   * Drop additive channels (breath, blink drift, overlap) and evaluate only
   * the authored action. Arcs, twinning and foot contact are properties of
   * the performance, not of the idle texture layered over it, so they are
   * measured against this track.
   */
  primaryOnly?: boolean;
  /** Canvas size; defaults to the delivery spec. */
  width?: number;
  height?: number;
  background?: string;
};

/** Extract a bone pose from the shot's channels at one frame. */
export function poseAtFrame(
  shot: Shot,
  characterId: string,
  frame: number,
  primaryOnly = false,
): Pose {
  const pose: Pose = {};
  const source = primaryOnly ? shot.curves.filter((c) => !c.additive) : shot.curves;
  const targets = channelTargets(source);
  for (const target of targets) {
    const m = /^bone:([^.]+)\.(rotation|translate\.[xy]|scale\.[xy])$/.exec(
      target.replace(/#.*$/, ''),
    );
    if (!m) continue;
    const [, bone, prop] = m;
    const value = evaluateStack(
      source.map((c) => ({ ...c, target: c.target.replace(/#.*$/, '') })),
      target.replace(/#.*$/, ''),
      frame,
    );
    const entry = (pose[bone] ??= {});
    if (prop === 'rotation') entry.rotation = value;
    else if (prop === 'translate.x') entry.translate = { x: value, y: entry.translate?.y ?? 0 };
    else if (prop === 'translate.y') entry.translate = { x: entry.translate?.x ?? 0, y: value };
    else if (prop === 'scale.x') entry.scale = { x: value, y: entry.scale?.y ?? 1 };
    else if (prop === 'scale.y') entry.scale = { x: entry.scale?.x ?? 1, y: value };
  }
  void characterId;
  return pose;
}

/**
 * Evaluate a whole shot into per-frame scenes.
 *
 * Spring bones are simulated across the shot rather than sampled
 * per-frame, because a spring's state depends on its history — that is the
 * entire point of it.
 */
export function evaluateShot(
  shot: Shot,
  project: Pick<Project, 'characters' | 'deliverySpec' | 'styleBible'>,
  options: EvaluateOptions = {},
): EvaluatedFrame[] {
  const fps = options.fps ?? project.deliverySpec.fps ?? DEFAULT_FPS;
  const width = options.width ?? project.deliverySpec.width;
  const height = options.height ?? project.deliverySpec.height;
  const background = parseHex(options.background ?? '#FFFFFF');

  const charById = new Map(project.characters.map((c) => [c.id, c]));
  const prepared = new Map<string, PreparedRig>();
  for (const c of project.characters) if (c.rig) prepared.set(c.id, prepareRig(c.rig));

  // Pre-compute the raw pose track per character.
  const poseTrack = new Map<string, Pose[]>();
  for (const placement of shot.staging.characters) {
    const poses: Pose[] = [];
    for (let f = 0; f < shot.durationFrames; f++) {
      const sampleFrame = options.applyStepping === false ? f : steppedFrame(shot.timing, f);
      poses.push(poseAtFrame(shot, placement.characterId, sampleFrame, options.primaryOnly));
    }
    poseTrack.set(placement.characterId, poses);
  }

  // Spring simulation, driven by each spring bone's parent rotation.
  const springTrack = new Map<string, Pose[]>();
  for (const placement of shot.staging.characters) {
    const character = charById.get(placement.characterId);
    if (!character?.rig) continue;
    const poses = poseTrack.get(placement.characterId) ?? [];
    const driver = poses.map((p) =>
      Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.rotation ?? 0])),
    );
    springTrack.set(
      placement.characterId,
      simulateSprings(character.rig.skeleton, driver, fps),
    );
  }

  // Every multiplane layer is registered against the shot's opening camera
  // position: that is where the layout was composed, and parallax measures
  // departure from it.
  const cameraReference = shot.camera.move.keys[0]?.position ?? { x: 0, y: 0 };

  const frames: EvaluatedFrame[] = [];
  for (let f = 0; f < shot.durationFrames; f++) {
    const scene = emptyScene(width, height, background, f);
    const camState = evaluateCamera(shot.camera.move, f, hashSeed(shot.id));
    scene.camera = cameraMatrix(camState, width, height, 1, cameraReference);

    // Background planes, with parallax by depth.
    if (options.environment) {
      const palette = [
        ...options.environment.colorKey,
        ...project.styleBible.palette,
      ];
      for (const layer of options.environment.layers) {
        const px = parallaxFor(layer.parallax ?? layer.depth);
        const layerCam = cameraMatrix(camState, width, height, px, cameraReference);
        scene.layers.push(bgLayer(layer, layerCam, palette));
      }
    }

    const characters = new Map<
      string,
      { posed: PosedRig; pose: Pose; view: ViewName; swaps: Record<string, string> }
    >();

    for (const placement of shot.staging.characters) {
      const character = charById.get(placement.characterId);
      const prep = prepared.get(placement.characterId);
      if (!character?.rig || !prep) continue;

      const base = poseTrack.get(placement.characterId)?.[f] ?? {};
      const spring = springTrack.get(placement.characterId)?.[f] ?? {};
      const pose: Pose = { ...base };
      for (const [bone, t] of Object.entries(spring)) {
        pose[bone] = { ...pose[bone], rotation: (pose[bone]?.rotation ?? 0) + (t.rotation ?? 0) };
      }

      const idle = options.primaryOnly ? undefined : options.idleLayers?.[placement.characterId];
      const viseme: Viseme | undefined = shot.dialogue.length ? visemeAt(shot.dialogue, f) : undefined;
      const swaps = resolveSwaps(
        { ...defaultSwaps(character.rig), ...keySwapsAt(shot, placement.characterId, f) },
        idle ?? { channels: [], blinkFrames: [], swapOverrides: new Map() },
        f,
        viseme,
      );

      const posed = poseRig(character.rig, pose, {
        view: placement.view,
        swaps,
        colorModel: character.colorModel,
        prepared: prep,
        ownerId: character.id,
        transform: placementTransform(placement),
        zBase: Math.round(placement.depth * 1000),
      });
      characters.set(character.id, { posed, pose, view: placement.view, swaps });
      scene.layers.push({ ...posed.layer, z: 500 + Math.round(placement.depth * 100) });
    }

    frames.push({ frame: f, characters, scene });
  }
  return frames;
}

function placementTransform(placement: Placement): (p: Vec2) => Vec2 {
  const m = mmul(
    mTranslate(placement.position.x, placement.position.y),
    mScale(placement.facingRight ? placement.scale : -placement.scale, placement.scale),
  );
  return (p: Vec2) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
}

/**
 * Resolve a fill that may be a swatch name or a literal hex.
 *
 * Backgrounds reference the colour script by name, not by value: that is
 * what makes the palette-conformance check meaningful and what lets a
 * colour key change once and propagate everywhere.
 */
function resolveFill(name: string | undefined, palette: readonly NamedSwatch[]): RGB | undefined {
  if (!name) return undefined;
  if (name.startsWith('#')) return parseHex(name);
  const hit = palette.find((s) => s.name === name);
  return hit ? parseHex(hit.hex) : undefined;
}

function bgLayer(
  layer: Environment['layers'][number],
  camera: ReturnType<typeof cameraMatrix>,
  palette: readonly NamedSwatch[],
): DrawLayer {
  return {
    id: `bg_${layer.id}`,
    kind: 'bg',
    // Depth 0 is the far plane and must be painted first. Inverting this
    // paints the sky over the ground.
    z: Math.round(layer.depth * 400),
    shapes: (layer.contours ?? []).map((c, i) => ({
      id: `${layer.id}_${i}`,
      contours: [c.map((p) => ({ x: p.x, y: p.y }))],
      fill: resolveFill(layer.fill, palette),
      z: i,
      tag: layer.name,
    })),
    images: layer.asset
      ? [
          {
            id: `${layer.id}_img`,
            uri: layer.asset.uri,
            transform: camera,
            opacity: 1,
            z: 0,
            tag: layer.name,
            blur: layer.blur,
          },
        ]
      : [],
    opacity: 1,
    blend: 'normal',
    blur: layer.blur,
    haze: layer.haze ? { color: '#CFE3EE', amount: layer.haze } : undefined,
    parallax: layer.parallax ?? layer.depth,
    camera,
  };
}

/** Swap-set selections authored on a key pose, held until the next key. */
export function keySwapsAt(shot: Shot, characterId: string, frame: number): Record<string, string> {
  let active: Record<string, string> = {};
  for (const key of shot.keys) {
    if (key.characterId !== characterId) continue;
    if (key.frame > frame) break;
    if (key.swaps) active = { ...active, ...key.swaps };
  }
  return active;
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** World-space path of one bone's tip across the shot. Arc metrics read this. */
export function effectorPath(
  frames: readonly EvaluatedFrame[],
  characterId: string,
  boneId: string,
): Vec2[] {
  const out: Vec2[] = [];
  for (const f of frames) {
    const entry = f.characters.get(characterId);
    const bone = entry?.posed.posed.bones.get(boneId);
    if (bone) out.push({ ...bone.tail });
  }
  return out;
}

/** Per-frame area of one part, for the volume-conservation invariant. */
export function partAreaTrack(
  frames: readonly EvaluatedFrame[],
  characterId: string,
  partId: string,
): number[] {
  const out: number[] = [];
  for (const f of frames) {
    const contours = f.characters.get(characterId)?.posed.partContours.get(partId);
    if (!contours) {
      out.push(0);
      continue;
    }
    let area = 0;
    for (const c of contours) {
      let a = 0;
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        a += c[j].x * c[i].y - c[i].x * c[j].y;
      }
      area += Math.abs(a / 2);
    }
    out.push(area);
  }
  return out;
}
