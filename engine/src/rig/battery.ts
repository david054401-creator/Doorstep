/**
 * The 20-pose range-of-motion battery.
 *
 * A rig is not "done" when it loads. It is done when it survives being
 * pushed through the extremes an animator will actually reach for. These
 * twenty poses are chosen to break rigs: full reaches, deep crouches,
 * extreme twists, and the squash/stretch limits.
 */

import type { Pose } from './skeleton.ts';
import { rad } from '../core/math.ts';

export type BatteryPose = {
  id: string;
  name: string;
  /** What this pose is designed to break. */
  probes: string[];
  pose: Pose;
  /** Expected to be inside squash-and-stretch tolerance rather than rigid. */
  tagSquashStretch?: boolean;
};

const r = rad;

/** Poses are expressed for a standard biped/preschool bone naming. */
export const POSE_BATTERY: BatteryPose[] = [
  {
    id: 'p00_rest',
    name: 'T-rest',
    probes: ['identity vs model sheet', 'baseline geometry'],
    pose: {},
  },
  {
    id: 'p01_arms_up',
    name: 'Arms overhead',
    probes: ['shoulder range', 'armpit tearing', 'z-order arm over head'],
    pose: {
      L_upperarm: { rotation: r(-145) },
      R_upperarm: { rotation: r(145) },
      L_forearm: { rotation: r(20) },
      R_forearm: { rotation: r(-20) },
    },
  },
  {
    id: 'p02_arms_down',
    name: 'Arms at sides',
    probes: ['shoulder lower limit', 'arm/body overlap'],
    pose: { L_upperarm: { rotation: r(28) }, R_upperarm: { rotation: r(-28) } },
  },
  {
    id: 'p03_reach_forward',
    name: 'Reach forward',
    probes: ['elbow inversion', 'forearm weights'],
    pose: {
      L_upperarm: { rotation: r(-70) },
      L_forearm: { rotation: r(85) },
      L_hand: { rotation: r(15) },
    },
  },
  {
    id: 'p04_elbow_full',
    name: 'Elbow fully bent',
    probes: ['inverted triangles at elbow', 'self-intersection'],
    pose: { L_upperarm: { rotation: r(-40) }, L_forearm: { rotation: r(148) } },
  },
  {
    id: 'p05_crouch',
    name: 'Deep crouch',
    probes: ['knee inversion', 'hip/thigh tearing', 'foot contact'],
    pose: {
      hips: { translate: { x: 0, y: 28 } },
      L_thigh: { rotation: r(-72) },
      R_thigh: { rotation: r(-72) },
      L_shin: { rotation: r(-115) },
      R_shin: { rotation: r(-115) },
      L_foot: { rotation: r(38) },
      R_foot: { rotation: r(38) },
    },
  },
  {
    id: 'p06_step_forward',
    name: 'Contact pose (walk)',
    probes: ['leg split', 'hip rotation', 'foot slide baseline'],
    pose: {
      L_thigh: { rotation: r(-30) },
      R_thigh: { rotation: r(26) },
      L_shin: { rotation: r(-6) },
      R_shin: { rotation: r(-24) },
      L_upperarm: { rotation: r(22) },
      R_upperarm: { rotation: r(-22) },
      spine: { rotation: r(-3) },
    },
  },
  {
    id: 'p07_run_extreme',
    name: 'Run extreme',
    probes: ['max leg range', 'torso lean', 'arm counter-swing'],
    pose: {
      spine: { rotation: r(-16) },
      chest: { rotation: r(-8) },
      L_thigh: { rotation: r(-62) },
      R_thigh: { rotation: r(54) },
      L_shin: { rotation: r(-40) },
      R_shin: { rotation: r(-95) },
      L_upperarm: { rotation: r(-58) },
      R_upperarm: { rotation: r(62) },
      L_forearm: { rotation: r(70) },
      R_forearm: { rotation: r(-70) },
    },
  },
  {
    id: 'p08_twist_left',
    name: 'Torso twist left',
    probes: ['spine chain', 'shoulder follow', 'z-order flip'],
    pose: { hips: { rotation: r(-14) }, spine: { rotation: r(-24) }, chest: { rotation: r(-18) }, neck: { rotation: r(-10) } },
  },
  {
    id: 'p09_twist_right',
    name: 'Torso twist right',
    probes: ['spine chain mirrored', 'twinning detection baseline'],
    pose: { hips: { rotation: r(14) }, spine: { rotation: r(24) }, chest: { rotation: r(18) }, neck: { rotation: r(10) } },
  },
  {
    id: 'p10_head_turn_max',
    name: 'Head turn max',
    probes: ['neck limit', 'head/neck seam', 'ear spring anchor'],
    pose: { neck: { rotation: r(-32) }, head: { rotation: r(-36) } },
  },
  {
    id: 'p11_head_tilt',
    name: 'Head tilt + look up',
    probes: ['neck stretch', 'chin/neck intersection'],
    pose: { neck: { rotation: r(22) }, head: { rotation: r(30) } },
  },
  {
    id: 'p12_squash',
    name: 'Squash (landing)',
    probes: ['volume conservation', 'mesh quality under compression'],
    tagSquashStretch: true,
    pose: {
      // Conserves volume exactly: 1.26 * (1/1.26) = 1.
      root: { scale: { x: 1.26, y: 1 / 1.26 } },
      hips: { translate: { x: 0, y: 14 } },
      // Deliberately moderate: this pose tests volume conservation under
      // squash, not leg range. p05 already pushes the knees to their limit,
      // and stacking both would confound the two measurements.
      L_thigh: { rotation: r(-26) },
      R_thigh: { rotation: r(-26) },
      L_shin: { rotation: r(-38) },
      R_shin: { rotation: r(-38) },
    },
  },
  {
    id: 'p13_stretch',
    name: 'Stretch (launch)',
    probes: ['volume conservation', 'limb elongation artefacts'],
    tagSquashStretch: true,
    pose: {
      // Conserves volume exactly: 0.84 * (1/0.84) = 1.
      root: { scale: { x: 0.84, y: 1 / 0.84 } },
      L_upperarm: { rotation: r(-150) },
      R_upperarm: { rotation: r(150) },
      L_thigh: { rotation: r(8) },
      R_thigh: { rotation: r(8) },
    },
  },
  {
    id: 'p14_lean_forward',
    name: 'Lean forward',
    probes: ['hip hinge', 'silhouette readability at extreme'],
    pose: { hips: { rotation: r(-26) }, spine: { rotation: r(-28) }, chest: { rotation: r(-12) }, head: { rotation: r(24) } },
  },
  {
    id: 'p15_lean_back',
    name: 'Lean back',
    probes: ['spine reverse limit', 'back-arch tearing'],
    pose: { hips: { rotation: r(18) }, spine: { rotation: r(30) }, chest: { rotation: r(20) }, head: { rotation: r(-22) } },
  },
  {
    id: 'p16_point',
    name: 'Point across body',
    probes: ['arm crossing torso', 'z-order self-occlusion'],
    pose: {
      R_upperarm: { rotation: r(-108) },
      R_forearm: { rotation: r(38) },
      R_hand: { rotation: r(12) },
      chest: { rotation: r(-12) },
    },
  },
  {
    id: 'p17_both_hands_face',
    name: 'Hands to face',
    probes: ['extreme elbow + overlap', 'hand/head intersection'],
    pose: {
      L_upperarm: { rotation: r(-112) },
      R_upperarm: { rotation: r(112) },
      L_forearm: { rotation: r(122) },
      R_forearm: { rotation: r(-122) },
    },
  },
  {
    id: 'p18_one_leg',
    name: 'Balance on one leg',
    probes: ['hip counter-rotation', 'raised knee inversion'],
    pose: {
      hips: { rotation: r(8) },
      L_thigh: { rotation: r(-88) },
      L_shin: { rotation: r(-96) },
      L_foot: { rotation: r(28) },
      R_thigh: { rotation: r(4) },
      spine: { rotation: r(-6) },
    },
  },
  {
    id: 'p19_wave',
    name: 'Wave (asymmetric)',
    probes: ['appeal/asymmetry baseline', 'far-arm z-order'],
    pose: {
      R_upperarm: { rotation: r(-158) },
      R_forearm: { rotation: r(-26) },
      R_hand: { rotation: r(22) },
      L_upperarm: { rotation: r(22) },
      head: { rotation: r(-8) },
      spine: { rotation: r(4) },
    },
  },
];

/** Only the poses whose bones exist in this rig, so quadrupeds do not fail on arms. */
export function applicableBattery(boneIds: ReadonlySet<string>): BatteryPose[] {
  return POSE_BATTERY.filter((p) => {
    const targets = Object.keys(p.pose);
    if (targets.length === 0) return true;
    return targets.some((t) => boneIds.has(t));
  }).map((p) => ({
    ...p,
    pose: Object.fromEntries(Object.entries(p.pose).filter(([k]) => boneIds.has(k))),
  }));
}

/** Quadruped-specific battery, since the biped poses do not apply. */
export const QUADRUPED_BATTERY: BatteryPose[] = [
  { id: 'q00_rest', name: 'Rest', probes: ['baseline'], pose: {} },
  {
    id: 'q01_gallop',
    name: 'Gallop extreme',
    probes: ['leg range', 'spine flex'],
    pose: {
      spine: { rotation: r(-14) },
      FL_upper: { rotation: r(-60) },
      FR_upper: { rotation: r(-40) },
      BL_upper: { rotation: r(50) },
      BR_upper: { rotation: r(38) },
      FL_lower: { rotation: r(-50) },
      BL_lower: { rotation: r(60) },
    },
  },
  {
    id: 'q02_sit',
    name: 'Sit',
    probes: ['hip fold', 'tail clearance'],
    pose: { BL_upper: { rotation: r(78) }, BR_upper: { rotation: r(78) }, BL_lower: { rotation: r(90) }, BR_lower: { rotation: r(90) }, hips: { translate: { x: 0, y: 40 } } },
  },
  {
    id: 'q03_head_down',
    name: 'Head down',
    probes: ['neck range', 'ear springs'],
    pose: { neck: { rotation: r(42) }, head: { rotation: r(28) } },
  },
];
