/**
 * The pose and performance library.
 *
 * Acting comes from selecting and combining curated, on-model poses — not
 * from asking a model to invent a body. Every pose here is expressed as
 * bone rotations, so it is on-model by construction and the rig's own
 * limits keep it inside the validated range.
 */

import type { Pose } from '../rig/skeleton.ts';
import type { ExpressionName, Viseme, Clip, ViewName } from '../graph/types.ts';
import { rad } from '../core/math.ts';
import { blendPoses, addPose } from '../rig/skeleton.ts';
import { makeId } from '../core/ids.ts';

const r = rad;

export type LibraryPose = {
  id: string;
  name: string;
  /** Semantic tags the blocking stage searches on. */
  tags: string[];
  /** Emotion this pose reads as, if any. */
  emotion?: ExpressionName;
  /** 1..5; poses come in intensity families. */
  intensity?: number;
  pose: Pose;
  /** Swap-set selections that belong with this pose. */
  swaps?: Record<string, string>;
  /** Line of action strength this pose is authored to hit. */
  lineOfActionHint?: string;
};

/**
 * Base poses. These are the vocabulary; the blocking stage picks from them
 * and the timing engine moves between them.
 *
 * No pose in here is left/right symmetric, and that is deliberate rather
 * than decorative. A perfectly mirrored pose — both arms out at the same
 * angle, weight evenly on both feet — reads as a mannequin, and it is
 * the single most recognisable tell of animation done by a machine.
 * `principle.no_twinning` measures it, so the library it draws from had
 * better not twin: every mirror pair here differs by enough to read
 * (roughly 6 degrees and up), with the difference chosen to serve the
 * pose. Scared shields harder with one arm; determined puts the weight
 * on one leg; idle lets one hand fall closer to the body.
 */
export const POSE_LIBRARY: LibraryPose[] = [
  {
    id: 'idle_neutral',
    name: 'Idle, neutral',
    tags: ['idle', 'neutral', 'rest'],
    emotion: 'neutral',
    intensity: 1,
    pose: {
      L_upperarm: { rotation: r(22) },
      R_upperarm: { rotation: r(-14) },
      R_forearm: { rotation: r(9) },
      spine: { rotation: r(1) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'idle_shy',
    name: 'Idle, shy',
    tags: ['idle', 'shy', 'small'],
    emotion: 'sad',
    intensity: 2,
    pose: {
      spine: { rotation: r(6) },
      chest: { rotation: r(5) },
      neck: { rotation: r(9) },
      head: { rotation: r(8) },
      L_upperarm: { rotation: r(34) },
      R_upperarm: { rotation: r(-30) },
      L_forearm: { rotation: r(28) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'sad_droop',
    name: 'Sad, drooping',
    tags: ['sad', 'droop', 'defeated'],
    emotion: 'sad',
    intensity: 3,
    pose: {
      hips: { rotation: r(3) },
      spine: { rotation: r(12) },
      chest: { rotation: r(8) },
      neck: { rotation: r(16) },
      head: { rotation: r(14) },
      L_upperarm: { rotation: r(34) },
      R_upperarm: { rotation: r(-21) },
      L_ear: { rotation: r(34) },
      R_ear: { rotation: r(-34) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
    lineOfActionHint: 'Single C-curve folding forward and down.',
  },
  {
    id: 'happy_open',
    name: 'Happy, open',
    tags: ['happy', 'open', 'delight'],
    emotion: 'happy',
    intensity: 3,
    pose: {
      spine: { rotation: r(-6) },
      chest: { rotation: r(-4) },
      head: { rotation: r(-5) },
      L_upperarm: { rotation: r(-42) },
      R_upperarm: { rotation: r(46) },
      L_forearm: { rotation: r(24) },
      R_forearm: { rotation: r(-20) },
    },
    swaps: { eyes: 'open', mouth: 'C' },
    lineOfActionHint: 'Reverse C, chest lifted and open.',
  },
  {
    id: 'happy_leap',
    name: 'Happy, leaping',
    tags: ['happy', 'jump', 'excited'],
    emotion: 'happy',
    intensity: 5,
    pose: {
      root: { translate: { x: 0, y: -34 } },
      spine: { rotation: r(-10) },
      L_upperarm: { rotation: r(-118) },
      R_upperarm: { rotation: r(122) },
      L_thigh: { rotation: r(-30) },
      R_thigh: { rotation: r(18) },
      L_shin: { rotation: r(-40) },
      R_shin: { rotation: r(-14) },
    },
    swaps: { eyes: 'wide', mouth: 'D' },
    lineOfActionHint: 'Long diagonal from trailing foot to leading hand.',
  },
  {
    id: 'surprise_recoil',
    name: 'Surprised, recoiling',
    tags: ['surprised', 'recoil', 'take'],
    emotion: 'surprised',
    intensity: 4,
    pose: {
      spine: { rotation: r(14) },
      chest: { rotation: r(10) },
      neck: { rotation: r(-12) },
      head: { rotation: r(-10) },
      L_upperarm: { rotation: r(-58) },
      R_upperarm: { rotation: r(62) },
      L_forearm: { rotation: r(53) },
      R_forearm: { rotation: r(-37) },
      L_ear: { rotation: r(-30) },
      R_ear: { rotation: r(30) },
    },
    swaps: { eyes: 'wide', mouth: 'D' },
  },
  {
    id: 'think_chin',
    name: 'Thinking, hand to chin',
    tags: ['thinking', 'consider', 'pause'],
    emotion: 'thinking',
    intensity: 2,
    pose: {
      neck: { rotation: r(-8) },
      head: { rotation: r(-12) },
      R_upperarm: { rotation: r(96) },
      R_forearm: { rotation: r(-104) },
      L_upperarm: { rotation: r(26) },
      spine: { rotation: r(3) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'determined_set',
    name: 'Determined, set',
    tags: ['determined', 'resolve', 'stand'],
    emotion: 'determined',
    intensity: 4,
    pose: {
      hips: { rotation: r(-3) },
      spine: { rotation: r(-8) },
      chest: { rotation: r(-6) },
      head: { rotation: r(-4) },
      L_upperarm: { rotation: r(36) },
      R_upperarm: { rotation: r(-23) },
      L_forearm: { rotation: r(40) },
      R_forearm: { rotation: r(-26) },
      L_thigh: { rotation: r(-11) },
      R_thigh: { rotation: r(4) },
    },
    swaps: { eyes: 'open', mouth: 'B' },
    lineOfActionHint: 'Vertical with a slight forward lean; feet planted wide.',
  },
  {
    id: 'scared_shrink',
    name: 'Scared, shrinking',
    tags: ['scared', 'shrink', 'hide'],
    emotion: 'scared',
    intensity: 4,
    pose: {
      spine: { rotation: r(18) },
      chest: { rotation: r(14) },
      neck: { rotation: r(12) },
      head: { rotation: r(10) },
      L_upperarm: { rotation: r(68) },
      R_upperarm: { rotation: r(-49) },
      L_forearm: { rotation: r(80) },
      R_forearm: { rotation: r(-57) },
      L_thigh: { rotation: r(-14) },
      L_shin: { rotation: r(-18) },
      L_ear: { rotation: r(44) },
      R_ear: { rotation: r(-44) },
    },
    swaps: { eyes: 'wide', mouth: 'E' },
  },
  {
    id: 'angry_lean',
    name: 'Angry, leaning in',
    tags: ['angry', 'confront', 'lean'],
    emotion: 'angry',
    intensity: 4,
    pose: {
      hips: { rotation: r(-6) },
      spine: { rotation: r(-16) },
      chest: { rotation: r(-10) },
      neck: { rotation: r(6) },
      head: { rotation: r(6) },
      L_upperarm: { rotation: r(48) },
      R_upperarm: { rotation: r(-52) },
      L_forearm: { rotation: r(52) },
      R_forearm: { rotation: r(-56) },
    },
    swaps: { eyes: 'open', mouth: 'A' },
  },
  {
    id: 'gesture_point',
    name: 'Point ahead',
    tags: ['gesture', 'point', 'show'],
    emotion: 'neutral',
    intensity: 3,
    pose: {
      chest: { rotation: r(-6) },
      R_upperarm: { rotation: r(-84) },
      R_forearm: { rotation: r(14) },
      R_hand: { rotation: r(8) },
      L_upperarm: { rotation: r(24) },
      head: { rotation: r(-6) },
    },
    swaps: { eyes: 'open', mouth: 'B' },
  },
  {
    id: 'gesture_present',
    name: 'Present with both hands',
    tags: ['gesture', 'present', 'offer'],
    emotion: 'happy',
    intensity: 3,
    pose: {
      L_upperarm: { rotation: r(-54) },
      R_upperarm: { rotation: r(58) },
      L_forearm: { rotation: r(58) },
      R_forearm: { rotation: r(-39) },
      spine: { rotation: r(-3) },
    },
    swaps: { eyes: 'open', mouth: 'C' },
  },
  {
    id: 'gesture_wave',
    name: 'Wave',
    tags: ['gesture', 'wave', 'greet'],
    emotion: 'happy',
    intensity: 3,
    pose: {
      R_upperarm: { rotation: r(-142) },
      R_forearm: { rotation: r(-22) },
      R_hand: { rotation: r(18) },
      L_upperarm: { rotation: r(22) },
      head: { rotation: r(-7) },
      spine: { rotation: r(3) },
    },
    swaps: { eyes: 'open', mouth: 'C' },
  },
  {
    id: 'look_around',
    name: 'Looking around',
    tags: ['search', 'look', 'scan'],
    emotion: 'thinking',
    intensity: 2,
    pose: {
      neck: { rotation: r(-18) },
      head: { rotation: r(-20) },
      chest: { rotation: r(-6) },
      L_upperarm: { rotation: r(27) },
      R_upperarm: { rotation: r(-15) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'stand_up',
    name: 'Rising to stand',
    tags: ['stand', 'rise', 'transition'],
    emotion: 'determined',
    intensity: 3,
    pose: {
      hips: { translate: { x: 0, y: -4 } },
      spine: { rotation: r(-10) },
      L_thigh: { rotation: r(-14) },
      R_thigh: { rotation: r(-10) },
      L_shin: { rotation: r(-10) },
      L_upperarm: { rotation: r(18) },
      R_upperarm: { rotation: r(-5) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'sit_ground',
    name: 'Sitting on the ground',
    tags: ['sit', 'rest', 'ground'],
    emotion: 'neutral',
    intensity: 1,
    pose: {
      root: { translate: { x: 0, y: 56 } },
      hips: { rotation: r(6) },
      L_thigh: { rotation: r(-82) },
      R_thigh: { rotation: r(-78) },
      L_shin: { rotation: r(-74) },
      R_shin: { rotation: r(-70) },
      spine: { rotation: r(6) },
      L_upperarm: { rotation: r(45) },
      R_upperarm: { rotation: r(-29) },
    },
    swaps: { eyes: 'open', mouth: 'X' },
  },
  {
    id: 'walk_contact',
    name: 'Walk, contact',
    tags: ['walk', 'locomotion', 'contact'],
    intensity: 2,
    pose: {
      L_thigh: { rotation: r(-28) },
      R_thigh: { rotation: r(24) },
      L_shin: { rotation: r(-4) },
      R_shin: { rotation: r(-22) },
      L_upperarm: { rotation: r(23) },
      R_upperarm: { rotation: r(-14) },
      spine: { rotation: r(-2) },
    },
  },
  {
    id: 'walk_passing',
    name: 'Walk, passing',
    tags: ['walk', 'locomotion', 'passing'],
    intensity: 2,
    pose: {
      root: { translate: { x: 0, y: -6 } },
      L_thigh: { rotation: r(-4) },
      R_thigh: { rotation: r(-2) },
      L_shin: { rotation: r(-2) },
      R_shin: { rotation: r(-46) },
      L_upperarm: { rotation: r(6) },
      R_upperarm: { rotation: r(-1) },
    },
  },
  {
    id: 'walk_down',
    name: 'Walk, down',
    tags: ['walk', 'locomotion', 'down'],
    intensity: 2,
    pose: {
      root: { translate: { x: 0, y: 5 } },
      L_thigh: { rotation: r(-16) },
      R_thigh: { rotation: r(12) },
      L_shin: { rotation: r(-14) },
      R_shin: { rotation: r(-8) },
      L_upperarm: { rotation: r(15) },
      R_upperarm: { rotation: r(-7) },
    },
  },
  {
    // The fourth walk key. Without it the cycle passes through "down"
    // twice and the body bobs on a symmetric sine, which is the flat,
    // mechanical walk everyone recognises. Up is higher than passing and
    // the trailing leg is already extending.
    id: 'walk_up',
    name: 'Walk, up',
    tags: ['walk', 'locomotion', 'up'],
    intensity: 2,
    pose: {
      root: { translate: { x: 0, y: -9 } },
      L_thigh: { rotation: r(6) },
      R_thigh: { rotation: r(-14) },
      L_shin: { rotation: r(-26) },
      R_shin: { rotation: r(-6) },
      L_upperarm: { rotation: r(-4) },
      R_upperarm: { rotation: r(11) },
    },
  },
  {
    // A run is not a fast walk. The torso leans into it, the knees come
    // up much higher, the arms drive from a bent elbow, and there is an
    // airborne frame where neither foot is down.
    id: 'run_contact',
    name: 'Run, contact',
    tags: ['run', 'locomotion', 'contact'],
    intensity: 4,
    pose: {
      spine: { rotation: r(-11) },
      chest: { rotation: r(-6) },
      L_thigh: { rotation: r(-42) },
      R_thigh: { rotation: r(34) },
      L_shin: { rotation: r(-18) },
      R_shin: { rotation: r(-52) },
      L_upperarm: { rotation: r(48) },
      R_upperarm: { rotation: r(-36) },
      L_forearm: { rotation: r(-74) },
      R_forearm: { rotation: r(66) },
    },
  },
  {
    id: 'run_down',
    name: 'Run, down',
    tags: ['run', 'locomotion', 'down'],
    intensity: 4,
    pose: {
      root: { translate: { x: 0, y: 11 } },
      spine: { rotation: r(-14) },
      chest: { rotation: r(-7) },
      L_thigh: { rotation: r(-22) },
      R_thigh: { rotation: r(26) },
      L_shin: { rotation: r(-30) },
      R_shin: { rotation: r(-64) },
      L_upperarm: { rotation: r(34) },
      R_upperarm: { rotation: r(-24) },
      L_forearm: { rotation: r(-62) },
      R_forearm: { rotation: r(58) },
    },
  },
  {
    id: 'run_passing',
    name: 'Run, passing',
    tags: ['run', 'locomotion', 'passing'],
    intensity: 4,
    pose: {
      root: { translate: { x: 0, y: -4 } },
      spine: { rotation: r(-12) },
      L_thigh: { rotation: r(-6) },
      R_thigh: { rotation: r(-2) },
      L_shin: { rotation: r(-8) },
      // Not -96. That is exactly the validated knee limit, and authoring
      // a pose against the stop leaves the skin no headroom: the calf
      // loses 3.4% of its area in a single frame getting there, which
      // the volume check sees and an audience reads as a pop.
      R_shin: { rotation: r(-86) },
      L_upperarm: { rotation: r(10) },
      R_upperarm: { rotation: r(-4) },
      L_forearm: { rotation: r(-52) },
      R_forearm: { rotation: r(44) },
    },
  },
  {
    // The airborne key. A run has one; a walk never does, and leaving it
    // out is what makes a "run" read as a hurried walk.
    id: 'run_up',
    name: 'Run, airborne',
    tags: ['run', 'locomotion', 'up', 'airborne'],
    intensity: 4,
    pose: {
      root: { translate: { x: 0, y: -22 } },
      spine: { rotation: r(-9) },
      L_thigh: { rotation: r(22) },
      R_thigh: { rotation: r(-38) },
      L_shin: { rotation: r(-58) },
      R_shin: { rotation: r(-12) },
      L_upperarm: { rotation: r(-26) },
      R_upperarm: { rotation: r(40) },
      L_forearm: { rotation: r(48) },
      R_forearm: { rotation: r(-70) },
    },
  },
];

const BY_ID = new Map(POSE_LIBRARY.map((p) => [p.id, p]));

export function getPose(id: string): LibraryPose | undefined {
  return BY_ID.get(id);
}

/**
 * Select a pose for a beat. Matching is on emotion first, then tags, then
 * intensity distance — the same ordering a director would use.
 */
export function selectPose(query: {
  emotion?: ExpressionName;
  tags?: string[];
  intensity?: number;
  exclude?: string[];
}): LibraryPose {
  const exclude = new Set(query.exclude ?? []);
  const scored = POSE_LIBRARY.filter((p) => !exclude.has(p.id)).map((p) => {
    let score = 0;
    if (query.emotion && p.emotion === query.emotion) score += 10;
    for (const t of query.tags ?? []) {
      if (p.tags.includes(t)) score += 4;
    }
    if (query.intensity !== undefined && p.intensity !== undefined) {
      score += 3 - Math.min(3, Math.abs(p.intensity - query.intensity));
    }
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  return scored[0]?.p ?? POSE_LIBRARY[0];
}

/** Scale a pose's deviation from rest — the "exaggeration" dial. */
export function scalePose(pose: Pose, factor: number): Pose {
  const out: Pose = {};
  for (const [k, t] of Object.entries(pose)) {
    out[k] = {
      rotation: (t.rotation ?? 0) * factor,
      translate: t.translate
        ? { x: t.translate.x * factor, y: t.translate.y * factor }
        : undefined,
      scale: t.scale
        ? { x: 1 + (t.scale.x - 1) * factor, y: 1 + (t.scale.y - 1) * factor }
        : undefined,
    };
  }
  return out;
}

/** Restrict a pose to bones that exist on this rig. */
export function retargetPose(pose: Pose, boneIds: ReadonlySet<string>): Pose {
  const out: Pose = {};
  for (const [k, v] of Object.entries(pose)) {
    if (boneIds.has(k)) out[k] = v;
  }
  return out;
}

export type LocomotionKind = 'walk' | 'run';

/**
 * The natural period of a cycle, in frames.
 *
 * A walk is about half a second a step and a run about a third, and
 * getting this wrong is the difference between a character who walks and
 * one who mimes walking. Both are quantised to even frames so the
 * half-cycle mirror lands on a key rather than between two.
 */
export function cyclePeriod(kind: LocomotionKind, fps: number): number {
  const seconds = kind === 'run' ? 0.55 : 1;
  return Math.max(6, Math.round((seconds * fps) / 2) * 2);
}

/**
 * The four keys of a locomotion cycle, in order, over one period.
 *
 * Contact, down, passing, up, contact — the classical breakdown. The
 * second half is the first half with the legs and arms swapped, which is
 * what makes one authored half-cycle into a whole step.
 */
export function cyclePoses(
  kind: LocomotionKind,
  frames: number,
): { frame: number; pose: Pose }[] {
  const prefix = kind === 'run' ? 'run' : 'walk';
  const keys: { frame: number; poseId: string }[] = [
    { frame: 0, poseId: `${prefix}_contact` },
    { frame: Math.round(frames * 0.125), poseId: `${prefix}_down` },
    { frame: Math.round(frames * 0.25), poseId: `${prefix}_passing` },
    { frame: Math.round(frames * 0.375), poseId: `${prefix}_up` },
    { frame: Math.round(frames * 0.5), poseId: `${prefix}_contact` },
    { frame: Math.round(frames * 0.625), poseId: `${prefix}_down` },
    { frame: Math.round(frames * 0.75), poseId: `${prefix}_passing` },
    { frame: Math.round(frames * 0.875), poseId: `${prefix}_up` },
    { frame: frames, poseId: `${prefix}_contact` },
  ];
  return keys.map((k) => ({ frame: k.frame, pose: mirrorAtHalf(k, frames) }));
}

/** A locomotion cycle assembled from the library, as a Clip. */
export function locomotionCycle(kind: LocomotionKind, view: ViewName, frames = 24): Clip {
  return {
    id: makeId('clip', `${kind}:${view}:${frames}`),
    name: kind === 'run' ? 'Run cycle' : 'Walk cycle',
    tags: [kind, 'locomotion', 'loop'],
    durationFrames: frames,
    loop: true,
    channels: posesToChannels(cyclePoses(kind, frames)),
    view,
  };
}

export function walkCycle(view: ViewName, frames = 24): Clip {
  return locomotionCycle('walk', view, frames);
}

export function runCycle(view: ViewName, frames = 14): Clip {
  return locomotionCycle('run', view, frames);
}

function mirrorAtHalf(k: { frame: number; poseId: string }, frames: number): Pose {
  const base = getPose(k.poseId)?.pose ?? {};
  // The second half of a cycle is the first half with the limbs
  // swapped. The frame *at* the half mark is the opposite contact, so
  // the test is strict on one side and not the other; getting it wrong
  // produces a cycle that limps.
  if (k.frame < frames / 2 || k.frame >= frames) return base;
  const swapped: Pose = {};
  for (const [bone, t] of Object.entries(base)) {
    const other = bone.startsWith('L_')
      ? `R_${bone.slice(2)}`
      : bone.startsWith('R_')
        ? `L_${bone.slice(2)}`
        : bone;
    swapped[other] = t;
  }
  return swapped;
}

/** Convert a list of (frame, pose) into per-bone rotation channels. */
export function posesToChannels(
  keys: readonly { frame: number; pose: Pose }[],
): Clip['channels'] {
  const targets = new Map<string, { frame: number; value: number }[]>();
  for (const k of keys) {
    for (const [bone, t] of Object.entries(k.pose)) {
      push(targets, `bone:${bone}.rotation`, k.frame, t.rotation ?? 0);
      if (t.translate) {
        push(targets, `bone:${bone}.translate.x`, k.frame, t.translate.x);
        push(targets, `bone:${bone}.translate.y`, k.frame, t.translate.y);
      }
      if (t.scale) {
        push(targets, `bone:${bone}.scale.x`, k.frame, t.scale.x);
        push(targets, `bone:${bone}.scale.y`, k.frame, t.scale.y);
      }
    }
  }
  return [...targets.entries()].map(([target, kf]) => ({
    target,
    keyframes: kf
      .sort((a, b) => a.frame - b.frame)
      .map((k) => ({ frame: k.frame, value: k.value, ease: 'easeInOut' as const })),
  }));
}

function push(
  map: Map<string, { frame: number; value: number }[]>,
  key: string,
  frame: number,
  value: number,
): void {
  const list = map.get(key);
  if (list) list.push({ frame, value });
  else map.set(key, [{ frame, value }]);
}

export { blendPoses, addPose };
export type { Viseme };
