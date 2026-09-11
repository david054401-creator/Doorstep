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
import { selectPose, retargetPose, scalePose, posesToChannels, cyclePoses, cyclePeriod } from './pose-library.ts';
import type { LibraryPose, LocomotionKind } from './pose-library.ts';
import { applyActionShape, shapeFor } from '../timing/templates.ts';
import { chartFromBeats, solveStepping, rangeFor } from '../timing/chart.ts';
import type { ActionClass } from '../timing/chart.ts';
import { makeChannel, setKey, sampleChannel, evaluateChannel } from '../timing/curves.ts';
import { buildIdleLayer } from './idle.ts';
import type { IdleLayer } from './idle.ts';
import { buildOverlapChannels } from './secondary.ts';
import { lipsyncLine } from './lipsync.ts';
import { lineOfAction } from '../geom/silhouette.ts';
import { makeId } from '../core/ids.ts';
import { DEFAULT_FPS } from '../core/units.ts';
import { clamp } from '../core/math.ts';
import type { Vec2 } from '../core/math.ts';

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

/**
 * Tags a beat suggests, used to narrow the pose search.
 *
 * This has to agree with `actionClassFor`. When it did not — the class
 * recognised "runs" and the tag list did not — a beat that said *MIBO
 * runs toward the tree* fell through to `idle`, the search returned a
 * standing pose, and the shot then translated a standing character
 * sideways with both feet planted. The foot-slide check caught it at
 * 11.8 px/frame, which is a character on a skateboard.
 */
export function tagsFor(beat: Beat): string[] {
  const a = beat.action.toLowerCase();
  const tags: string[] = [];
  if (/\b(sit|sits|sitting|kneels?|crouch|crouches)\b/.test(a)) tags.push('sit');
  if (/\b(stand|stands|rises?|stood|gets? up)\b/.test(a)) tags.push('stand');
  if (/\b(run|runs|running|ran|dash|dashes|sprints?|races?|charges?|bolts?)\b/.test(a))
    tags.push('run', 'locomotion');
  if (/\b(walk|walks|walking|steps?|strolls?|wanders?|approach|approaches)\b/.test(a))
    tags.push('walk', 'locomotion');
  if (/\b(point|points|pointing)\b/.test(a)) tags.push('point');
  if (/\b(wave|waves|waving|greets?|beckons?)\b/.test(a)) tags.push('wave');
  if (/\b(look|looks|search|searches|scan|scans|peers?|watch|watches)\b/.test(a))
    tags.push('search');
  if (/\b(jump|jumps|leap|leaps|bounce|bounces|hops?|spring|springs)\b/.test(a)) tags.push('jump');
  if (/\b(reach|reaches|grab|grabs|picks? up|takes?|offers?|holds? out)\b/.test(a))
    tags.push('present');
  if (/\b(think|thinks|wonders?|considers?|hesitates?|pauses?)\b/.test(a)) tags.push('consider');
  if (/\b(recoil|recoils|gasps?|starts?|jolts?|flinch|flinches)\b/.test(a)) tags.push('recoil');
  if (/\b(hide|hides|shrinks?|cowers?|shields?)\b/.test(a)) tags.push('shrink');
  if (/\b(slump|slumps|droops?|sags?|sighs?)\b/.test(a)) tags.push('droop');
  if (/\b(confront|confronts|glares?|looms?|advances? on)\b/.test(a)) tags.push('confront');
  if (/\bsays:/.test(a)) tags.push('gesture');
  if (tags.length === 0) tags.push('idle');
  return tags;
}

/** Locomotion classes get a cycle, not a single destination pose. */
export function locomotionKindFor(cls: ActionClass): LocomotionKind | null {
  if (cls === 'runCycle') return 'run';
  if (cls === 'walkCycle') return 'walk';
  return null;
}

/**
 * The bones a locomotion cycle owns outright for its whole duration.
 *
 * Animation is layered: the legs carry the character across the ground
 * and the upper body acts. A line spoken mid-run must not be allowed to
 * reach down and reposition the legs, or the run stops being a run for
 * as long as the character is talking.
 */
export const LOCOMOTION_BONES = new Set([
  'root',
  'L_thigh',
  'R_thigh',
  'L_shin',
  'R_shin',
  'L_foot',
  'R_foot',
]);

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

    for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
      const beat = beats[beatIndex];
      // A beat's move has to land before the next beat starts writing to
      // the same channels. Beats overlap routinely — a line begins partway
      // through the action it is spoken over — and without this clamp the
      // next beat's opening key lands mid-move and snaps the pose to its
      // destination in a single frame. That pop is invisible in the graph
      // and glaring on screen, and it is what the arc validator catches.
      const next = beats[beatIndex + 1];
      const cls = actionClassFor(beat);
      const locomotion = locomotionKindFor(cls);
      const untilShotEnd = Math.max(2, Math.min(beat.durationFrames, shot.durationFrames - beat.startFrame));
      // A locomotion beat is a sustained state, not a one-shot move, so
      // it runs for as long as it was written for. Everything else has
      // to land before the next beat starts writing the same channels.
      const window =
        locomotion || !next
          ? untilShotEnd
          : Math.max(2, Math.min(beat.durationFrames, next.startFrame - beat.startFrame));
      if (locomotion) {
        // A cycle, not a destination.
        //
        // Everything else in this loop moves the character from one pose
        // to another over the beat. Locomotion does not work that way: a
        // walk is a repeating four-key cycle, and interpolating from a
        // standing pose to a single "walk pose" and holding it there is
        // what produces a character who glides across the ground with
        // their legs frozen mid-stride.
        const period = cyclePeriod(locomotion, fps);
        const cycle = cyclePoses(locomotion, period);
        const emitted: { frame: number; pose: Pose }[] = [];
        for (let base = 0; base < window; base += period) {
          for (const step of cycle) {
            // The closing contact of one period is the opening contact
            // of the next; emitting both puts two keys on one frame.
            if (step.frame === period && base + period < window) continue;
            const frame = beat.startFrame + base + step.frame;
            if (frame > beat.startFrame + window) break;
            emitted.push({
              frame,
              pose: scalePose(
                boneIds.size ? retargetPose(step.pose, boneIds) : step.pose,
                exaggeration,
              ),
            });
          }
        }

        // Ease into the cycle from wherever the character was standing,
        // rather than snapping onto the first contact.
        const blendIn = Math.max(1, Math.round(period / 4));
        const cycleBones = new Set(emitted.flatMap((e) => Object.keys(e.pose)));
        const allBones = new Set([...Object.keys(previousPose), ...cycleBones]);
        // If an acting beat plays over this run, it takes the upper body
        // and the cycle keeps the legs.
        const overlapped = beats.some(
          (b) =>
            b !== beat &&
            locomotionKindFor(actionClassFor(b)) === null &&
            b.startFrame < beat.startFrame + window &&
            b.startFrame + b.durationFrames > beat.startFrame,
        );
        for (const bone of allBones) {
          if (overlapped && !LOCOMOTION_BONES.has(bone)) continue;
          for (const [suffix, read] of [
            ['rotation', (t?: Pose[string]) => t?.rotation],
            ['translate.x', (t?: Pose[string]) => t?.translate?.x],
            ['translate.y', (t?: Pose[string]) => t?.translate?.y],
          ] as const) {
            // Forward travel is solved separately, by the foot lock
            // below. Writing it here as well would fight it.
            if (bone === 'root' && suffix === 'translate.x') continue;
            const wanted = emitted.some((e) => read(e.pose[bone]) !== undefined);
            if (!wanted && read(previousPose[bone]) === undefined) continue;
            const key = `bone:${bone}.${suffix}`;
            let channel = channels.get(key) ?? makeChannel(key, [], 'easeInOut');
            channel = setKey(channel, {
              frame: beat.startFrame,
              value: read(previousPose[bone]) ?? 0,
              // Ease in and out of the blend. An `easeOut` here leaves
              // the standing pose at full speed, which drags the foot
              // across the ground before the cycle has even started.
              ease: 'easeInOut',
            });
            for (const e of emitted) {
              if (e.frame <= beat.startFrame + blendIn && e.frame !== emitted[0].frame) continue;
              channel = setKey(channel, {
                frame: Math.max(beat.startFrame + blendIn, e.frame),
                value: read(e.pose[bone]) ?? 0,
                // A cycle key is a pose the body passes through, so the
                // interpolation across it is smooth rather than settling.
                ease: 'easeInOut',
              });
            }
            channels.set(key, channel);
          }
        }

        // Foot lock: measure the motion that was actually built, then
        // move the root to cancel the contact foot's drift.
        //
        // This is the whole difference between a run and a slide, and
        // the two obvious ways to get it are both wrong. Picking a
        // stride length by eye is how every skating character in the
        // history of the medium got made. Deriving one from the contact
        // pose assumes the legs sweep the foot cleanly from front to
        // back, which authored cycle keys do not: they are snapshots,
        // and the foot moves between them however the interpolation
        // takes it.
        //
        // So this reads the channels that were just written, evaluates
        // the real skeleton frame by frame, and corrects against what
        // the body is actually doing. During the airborne phase of a
        // run neither foot is down and there is nothing to measure, so
        // the root coasts at the ground speed it last had — which is
        // what a body in the air does.
        const lockFrom = beat.startFrame;
        const lockTo = emitted[emitted.length - 1]?.frame ?? beat.startFrame;
        if (rig && lockTo > lockFrom) {
          const ix = indexSkeleton(rig.skeleton);
          const rotationKeys = [...channels.entries()].filter(([k]) =>
            k.startsWith('bone:') && k.endsWith('.rotation'),
          );
          const translateYKeys = [...channels.entries()].filter(([k]) =>
            k.startsWith('bone:') && k.endsWith('.translate.y'),
          );
          const feetAt = (f: number): { L: Vec2; R: Vec2 } | null => {
            const pose: Pose = {};
            for (const [key, channel] of rotationKeys) {
              const bone = key.slice('bone:'.length, -'.rotation'.length);
              pose[bone] = { ...pose[bone], rotation: evaluateChannel(channel, f) };
            }
            for (const [key, channel] of translateYKeys) {
              const bone = key.slice('bone:'.length, -'.translate.y'.length);
              pose[bone] = { ...pose[bone], translate: { x: 0, y: evaluateChannel(channel, f) } };
            }
            const posed = evaluatePose(rig.skeleton, pose, ix);
            const L = posed.bones.get('L_foot')?.tail;
            const R = posed.bones.get('R_foot')?.tail;
            return L && R ? { L, R } : null;
          };

          const samples: ({ L: Vec2; R: Vec2 } | null)[] = [];
          for (let f = lockFrom; f <= lockTo; f++) samples.push(feetAt(f));
          const ys = samples.flatMap((x) => (x ? [x.L.y, x.R.y] : []));
          if (ys.length > 0) {
            const ground = Math.max(...ys);
            const tolerance = Math.max(4, (ground - Math.min(...ys)) * 0.12);
            const base = previousPose.root?.translate?.x ?? 0;
            let correction = 0;
            let coast = 0;
            let rootX = makeChannel('bone:root.translate.x', [], 'linear');
            rootX = setKey(rootX, { frame: lockFrom, value: base, ease: 'linear' });
            for (let i = 1; i < samples.length; i++) {
              const a = samples[i - 1];
              const b = samples[i];
              if (a && b) {
                // Which foot is carrying the weight? Not simply the
                // lower one: at the moment of a step both are down, and
                // picking the one that is about to swing makes the root
                // chase it and drags the other foot out from under the
                // character. The planted foot is the one that is not
                // moving.
                const candidates = (['L', 'R'] as const).filter(
                  (side) =>
                    ground - a[side].y < tolerance && ground - b[side].y < tolerance,
                );
                if (candidates.length > 0) {
                  const support = candidates.reduce((best, side) =>
                    Math.abs(b[side].x - a[side].x) < Math.abs(b[best].x - a[best].x) ? side : best,
                  );
                  coast = -(b[support].x - a[support].x);
                }
              }
              correction += coast;
              rootX = setKey(rootX, {
                frame: lockFrom + i,
                value: base + correction,
                ease: 'linear',
              });
            }
            channels.set('bone:root.translate.x', rootX);
            const finalOffset = base + correction;
            for (const e of emitted) {
              e.pose.root = {
                ...e.pose.root,
                translate: {
                  x: evaluateChannel(rootX, e.frame),
                  y: e.pose.root?.translate?.y ?? 0,
                },
              };
            }
            previousPose = {
              ...previousPose,
              root: {
                ...previousPose.root,
                translate: { x: finalOffset, y: previousPose.root?.translate?.y ?? 0 },
              },
            };
          }
        }

        // One recorded key pose per cycle key: the graph should say what
        // the walk is made of, not just that a walk happened.
        emitted.forEach((e, i) => {
          keys.push({
            id: makeId('key', `${shot.id}:${characterId}:${beat.id}:cy${i}`),
            frame: e.frame,
            characterId,
            poseId: `${locomotion}_cycle`,
            boneTransforms: Object.fromEntries(
              Object.entries(e.pose).map(([b, t]) => [b, { rotation: t.rotation, translate: t.translate }]),
            ),
            intent:
              i === 0
                ? beat.intent
                : `${locomotion === 'run' ? 'Run' : 'Walk'} cycle, key ${i + 1} of ${emitted.length}.`,
            kind: i % 2 === 0 ? 'key' : 'breakdown',
          });
        });

        usedPoses.push(`${locomotion}_cycle`);
        previousPose = { ...previousPose, ...(emitted[emitted.length - 1]?.pose ?? {}) };
        continue;
      }

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
      const fit = needed > window ? window / needed : 1;
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
      // Bones a cycle is driving right now are not this beat's to move.
      const insideCycle = beats.some(
        (b) =>
          locomotionKindFor(actionClassFor(b)) !== null &&
          b.startFrame <= beat.startFrame &&
          b.startFrame + b.durationFrames > beat.startFrame,
      );
      const bones = new Set(
        [...Object.keys(previousPose), ...Object.keys(carried)].filter(
          (b) => !insideCycle || !LOCOMOTION_BONES.has(b),
        ),
      );
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
