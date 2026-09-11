/**
 * Blocking: beats to key poses to curves.
 *
 * This is where intent becomes motion. Each beat selects an on-model pose
 * from the library, the action template shapes the move into it
 * (anticipation, action, overshoot, settle), and the result is written to
 * the Film Graph as explicit keys plus channels — never as pixels, and
 * never as an opaque blob a critic cannot read.
 */

import type {
  Shot,
  Rig,
  KeyPose,
  Channel,
  Beat,
  Character,
  TimingChart,
} from '../graph/types.ts';
import type { Pose } from '../rig/skeleton.ts';
import { evaluatePose, indexSkeleton } from '../rig/skeleton.ts';
import { selectPose, retargetPose, scalePose, posesToChannels } from './pose-library.ts';
import type { LibraryPose } from './pose-library.ts';
import { applyActionShape, shapeFor } from '../timing/templates.ts';
import { chartFromBeats, solveStepping, rangeFor } from '../timing/chart.ts';
import type { ActionClass } from '../timing/chart.ts';
import { makeChannel, setKey, sampleChannel } from '../timing/curves.ts';
import { buildIdleLayer } from './idle.ts';
import type { IdleLayer } from './idle.ts';
import { buildOverlapChannels } from './secondary.ts';
import { lipsyncLine } from './lipsync.ts';
import { lineOfAction } from '../geom/silhouette.ts';
import { makeId } from '../core/ids.ts';
import { DEFAULT_FPS } from '../core/units.ts';
import { clamp } from '../core/math.ts';

export type BlockingOptions = {
  fps?: number;
  /** Exaggeration multiplier applied to library poses. */
  exaggeration?: number;
  /** Add breath, blink and weight-shift layers. */
  idle?: boolean;
  seed?: string | number;
};

export type BlockingResult = {
  shot: Shot;
  idleLayers: Record<string, IdleLayer>;
};

/** Map a beat to the action class whose timing range governs it. */
export function actionClassFor(beat: Beat): ActionClass {
  const a = beat.action.toLowerCase();
  if (/\b(jump|leap|hop)\b/.test(a)) return 'jump';
  if (/\b(land|lands|landing)\b/.test(a)) return 'land';
  if (/\b(run|runs|dash|sprint)\b/.test(a)) return 'runCycle';
  if (/\b(walk|walks|steps?)\b/.test(a)) return 'walkCycle';
  if (/\b(turn|turns|looks? (at|around|up|down))\b/.test(a)) return 'headTurn';
  if (/\b(reach|reaches|grab|grabs|picks? up)\b/.test(a)) return 'reach';
  if (/\b(gasp|starts?|recoils?|jolts?)\b/.test(a)) return 'takeDouble';
  if (/\bsays:/.test(a)) return 'dialogueBeat';
  if (/\b(react|reacts|blinks?)\b/.test(a)) return 'react';
  if (/\b(sits?|stands?|rises?)\b/.test(a)) return 'gesture';
  return beat.intensity >= 4 ? 'react' : 'gesture';
}

/** Tags a beat suggests, used to narrow the pose search. */
export function tagsFor(beat: Beat): string[] {
  const a = beat.action.toLowerCase();
  const tags: string[] = [];
  if (/\b(sit|sits|sitting)\b/.test(a)) tags.push('sit');
  if (/\b(stand|stands|rises?|stood)\b/.test(a)) tags.push('stand');
  if (/\b(walk|walks)\b/.test(a)) tags.push('walk');
  if (/\b(point|points)\b/.test(a)) tags.push('point');
  if (/\b(wave|waves)\b/.test(a)) tags.push('wave');
  if (/\b(look|looks|search|searches)\b/.test(a)) tags.push('search');
  if (/\b(jump|jumps|leap|bounce|bounces)\b/.test(a)) tags.push('jump');
  if (/\bsays:/.test(a)) tags.push('gesture');
  if (tags.length === 0) tags.push('idle');
  return tags;
}

/**
 * Block one shot.
 *
 * Every beat gets a key pose with a stated intent and a measured line of
 * action. Poses are selected so consecutive beats never repeat the same
 * pose — flat, repeated staging is the clearest "nobody directed this"
 * signal there is.
 */
export function blockShot(
  shot: Shot,
  characters: readonly Character[],
  options: BlockingOptions = {},
): BlockingResult {
  const fps = options.fps ?? DEFAULT_FPS;
  const exaggeration = options.exaggeration ?? 1;
  const seed = options.seed ?? shot.id;

  const rigByChar = new Map<string, Rig>();
  for (const c of characters) if (c.rig) rigByChar.set(c.id, c.rig);

  const keys: KeyPose[] = [];
  const channelsByChar = new Map<string, Map<string, Channel>>();
  const idleLayers: Record<string, IdleLayer> = {};

  // Lipsync first: the mouth track is independent of the body blocking.
  const dialogue = shot.dialogue.map((l) => lipsyncLine(l, fps));

  const beatsByChar = new Map<string, Beat[]>();
  for (const beat of shot.beats) {
    const id = beat.characterId ?? shot.staging.characters[0]?.characterId;
    if (!id) continue;
    const list = beatsByChar.get(id);
    if (list) list.push(beat);
    else beatsByChar.set(id, [beat]);
  }

  for (const [characterId, beats] of beatsByChar) {
    const rig = rigByChar.get(characterId);
    const boneIds = new Set(rig ? rig.skeleton.map((b) => b.id) : []);
    const channels = new Map<string, Channel>();
    const usedPoses: string[] = [];
    let previousPose: Pose = {};

    beats.sort((a, b) => a.startFrame - b.startFrame);

    for (const beat of beats) {
      const cls = actionClassFor(beat);
      const chosen: LibraryPose = selectPose({
        emotion: beat.emotion,
        tags: tagsFor(beat),
        intensity: beat.intensity,
        // Never pick the same pose two beats running.
        exclude: usedPoses.slice(-1),
      });
      usedPoses.push(chosen.id);

      const target = scalePose(
        boneIds.size ? retargetPose(chosen.pose, boneIds) : chosen.pose,
        exaggeration * (0.75 + beat.intensity * 0.08),
      );
      const shape = shapeFor(cls, beat.intensity, fps);
      // The move must fit in the beat: scale the template down if not.
      const needed =
        shape.anticipationFrames + shape.actionFrames + shape.overshootFrames + shape.settleFrames;
      const fit = needed > beat.durationFrames ? beat.durationFrames / needed : 1;
      const fitted = {
        ...shape,
        anticipationFrames: Math.max(1, Math.round(shape.anticipationFrames * fit)),
        actionFrames: Math.max(1, Math.round(shape.actionFrames * fit)),
        overshootFrames: Math.max(0, Math.round(shape.overshootFrames * fit)),
        settleFrames: Math.max(1, Math.round(shape.settleFrames * fit)),
      };

      // A library pose states the bones it cares about and says nothing
      // about the rest. Treating an unstated bone as "return to rest" makes
      // every limb pop out and snap back between beats, which shows up as a
      // V-shaped effector path and fails the arc test — correctly. Carry
      // the previous value forward instead, and let the pose override only
      // what it actually specifies.
      const carried: Pose = { ...previousPose, ...target };
      const bones = new Set([...Object.keys(previousPose), ...Object.keys(carried)]);
      let landmarks = {
        antic: beat.startFrame,
        action: beat.startFrame + fitted.actionFrames,
        peak: beat.startFrame + fitted.actionFrames,
        settle: beat.startFrame + beat.durationFrames,
      };
      for (const bone of bones) {
        const from = previousPose[bone]?.rotation ?? 0;
        const to = carried[bone]?.rotation ?? 0;
        const key = `bone:${bone}.rotation`;
        const existing = channels.get(key) ?? makeChannel(key, [], 'easeInOut');
        const applied = applyActionShape(existing, {
          startFrame: beat.startFrame,
          fromValue: from,
          toValue: to,
          shape: fitted,
        });
        channels.set(key, applied.channel);
        landmarks = applied.landmarks;

        // Root translation, when the pose calls for it.
        const fromT = previousPose[bone]?.translate;
        const toT = carried[bone]?.translate;
        if (fromT || toT) {
          for (const axis of ['x', 'y'] as const) {
            const tk = `bone:${bone}.translate.${axis}`;
            const ex = channels.get(tk) ?? makeChannel(tk, [], 'easeInOut');
            channels.set(
              tk,
              applyActionShape(ex, {
                startFrame: beat.startFrame,
                fromValue: fromT?.[axis] ?? 0,
                toValue: toT?.[axis] ?? 0,
                shape: fitted,
              }).channel,
            );
          }
        }
      }

      // Record the key pose in the graph, with its line of action measured
      // from the actual posed skeleton rather than asserted.
      let loa: KeyPose['lineOfAction'];
      let silhouetteScore: number | undefined;
      if (rig) {
        const posed = evaluatePose(rig.skeleton, carried, indexSkeleton(rig.skeleton));
        const pts = [...posed.bones.values()].flatMap((b) => [b.head, b.tail]);
        const axis = lineOfAction(pts);
        loa = [axis.from, axis.to];
        silhouetteScore = axis.strength;
      }

      keys.push({
        id: makeId('key', `${shot.id}:${characterId}:${beat.id}`),
        frame: landmarks.action,
        characterId,
        poseId: chosen.id,
        boneTransforms: Object.fromEntries(
          Object.entries(carried).map(([b, t]) => [b, { rotation: t.rotation, translate: t.translate }]),
        ),
        swaps: chosen.swaps,
        lineOfAction: loa,
        silhouetteScore,
        intent: beat.intent,
        kind: 'key',
      });

      // Breakdown between the antic and the action reads the arc.
      if (landmarks.action - landmarks.antic >= 4) {
        keys.push({
          id: makeId('key', `${shot.id}:${characterId}:${beat.id}:bd`),
          frame: Math.round((landmarks.antic + landmarks.action) / 2),
          characterId,
          boneTransforms: {},
          intent: `Breakdown: carry the arc from the anticipation into "${beat.intent}".`,
          kind: 'breakdown',
        });
      }

      previousPose = carried;
    }

    // Hold the last pose to the end of the shot so nothing snaps back.
    for (const [key, channel] of channels) {
      const last = channel.keyframes[channel.keyframes.length - 1];
      if (last && last.frame < shot.durationFrames - 1) {
        channels.set(
          key,
          setKey(channel, { frame: shot.durationFrames - 1, value: last.value, ease: 'easeInOut' }),
        );
      }
    }

    if (options.idle !== false) {
      const layer = buildIdleLayer(shot.durationFrames, {
        fps,
        seed: `${seed}:${characterId}`,
        breathRate: 12 + Math.max(...beats.map((b) => b.intensity), 1) * 2,
      });
      idleLayers[characterId] = layer;
      for (const c of layer.channels) channels.set(`${c.target}#idle`, c);
    }

    if (rig) {
      const primary = [...channels.values()].filter((c) => !c.additive);
      const { channels: overlap } = buildOverlapChannels(rig.skeleton, primary);
      for (const c of overlap) channels.set(`${c.target}#overlap`, c);
    }

    channelsByChar.set(characterId, channels);
  }

  const curves: Channel[] = [];
  for (const map of channelsByChar.values()) curves.push(...map.values());

  const timing = buildTimingChart(shot, curves, fps);

  return {
    shot: {
      ...shot,
      dialogue,
      keys: keys.sort((a, b) => a.frame - b.frame),
      curves,
      timing,
      secondary: deriveSecondaryDeclarations(characters, curves),
      status: 'blocked',
    },
    idleLayers,
  };
}

function deriveSecondaryDeclarations(
  characters: readonly Character[],
  curves: readonly Channel[],
): Shot['secondary'] {
  const out: Shot['secondary'] = [];
  for (const c of characters) {
    if (!c.rig) continue;
    const { declared } = buildOverlapChannels(c.rig.skeleton, curves);
    out.push(...declared);
  }
  return out;
}

/**
 * Timing chart from the actual motion: fast passages run on ones, the rest
 * on twos, holds are moving holds.
 */
export function buildTimingChart(shot: Shot, curves: readonly Channel[], fps: number): TimingChart {
  const base = chartFromBeats(shot.beats, shot.durationFrames, fps);
  const primary = curves.filter((c) => !c.additive && c.target.endsWith('.rotation'));
  if (primary.length === 0) return base;

  // Aggregate angular speed across every bone, in degrees per frame.
  const speeds = new Array<number>(Math.max(1, shot.durationFrames)).fill(0);
  for (const c of primary) {
    const samples = sampleChannel(c, 0, shot.durationFrames - 1);
    for (let f = 1; f < samples.length; f++) {
      speeds[f] += Math.abs(samples[f] - samples[f - 1]) * (180 / Math.PI);
    }
  }
  const stepping = solveStepping(speeds, 0);
  return { ...base, stepping: stepping.length ? stepping : base.stepping };
}

export const clampExaggeration = (v: number): number => clamp(v, 0.25, 2.5);
export { rangeFor };
