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
 */
export const POSE_LIBRARY: LibraryPose[] = [
  {
    id: 'idle_neutral',
    name: 'Idle, neutral',
    tags: ['idle', 'neutral', 'rest'],
    emotion: 'neutral',
    intensity: 1,
    pose: {
      L_upperarm: { rotation: r(20) },
      R_upperarm: { rotation: r(-20) },
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
      L_upperarm: { rotation: r(30) },
      R_upperarm: { rotation: r(-28) },
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
      L_forearm: { rotation: r(46) },
      R_forearm: { rotation: r(-46) },
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
      L_upperarm: { rotation: r(32) },
      R_upperarm: { rotation: r(-30) },
      L_forearm: { rotation: r(34) },
      R_forearm: { rotation: r(-34) },
      L_thigh: { rotation: r(-8) },
      R_thigh: { rotation: r(8) },
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
      L_upperarm: { rotation: r(62) },
      R_upperarm: { rotation: r(-60) },
      L_forearm: { rotation: r(72) },
      R_forearm: { rotation: r(-70) },
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
      L_forearm: { rotation: r(52) },
      R_forearm: { rotation: r(-50) },
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
      L_upperarm: { rotation: r(24) },
      R_upperarm: { rotation: r(-22) },
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
      L_upperarm: { rotation: r(14) },
      R_upperarm: { rotation: r(-12) },
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
      L_upperarm: { rotation: r(40) },
      R_upperarm: { rotation: r(-38) },
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
      L_upperarm: { rotation: r(20) },
      R_upperarm: { rotation: r(-20) },
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
      L_upperarm: { rotation: r(4) },
      R_upperarm: { rotation: r(-4) },
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
      L_upperarm: { rotation: r(12) },
      R_upperarm: { rotation: r(-12) },
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

/** A locomotion cycle assembled from the library, as a Clip. */
export function walkCycle(view: ViewName, frames = 24): Clip {
  const keys: { frame: number; poseId: string }[] = [
    { frame: 0, poseId: 'walk_contact' },
    { frame: Math.round(frames * 0.25), poseId: 'walk_down' },
    { frame: Math.round(frames * 0.5), poseId: 'walk_passing' },
    { frame: Math.round(frames * 0.75), poseId: 'walk_down' },
    { frame: frames, poseId: 'walk_contact' },
  ];
  const channels = posesToChannels(
    keys.map((k) => ({ frame: k.frame, pose: mirrorAtHalf(k, frames) })),
  );
  return {
    id: makeId('clip', `walk:${view}:${frames}`),
    name: 'Walk cycle',
    tags: ['walk', 'locomotion', 'loop'],
    durationFrames: frames,
    loop: true,
    channels,
    view,
  };
}

function mirrorAtHalf(k: { frame: number; poseId: string }, frames: number): Pose {
  const base = getPose(k.poseId)?.pose ?? {};
  // The second half of a walk is the first half with the legs swapped.
  if (k.frame <= frames / 2) return base;
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
