/**
 * Inverse kinematics: analytic two-bone (arms, legs) and FABRIK for longer
 * chains (spines, tails). Both are deterministic and respect bone limits.
 */

import type { Bone, Point } from '../graph/types.ts';
import type { Pose } from './skeleton.ts';
import type { Vec2 } from '../core/math.ts';
import {
  vsub,
  vlen,
  vdist,
  vnorm,
  vangle,
  clamp,
  wrapAngle,
  vadd,
  vmul,
  vcross,
} from '../core/math.ts';
import { evaluatePose, indexSkeleton } from './skeleton.ts';

export type IKResult = {
  pose: Pose;
  /** Distance from the effector to the target after solving. */
  residual: number;
  /** True when the target was outside the chain's reach. */
  outOfReach: boolean;
  iterations: number;
};

/**
 * Analytic two-bone IK. `bendPositive` chooses the elbow/knee direction, which
 * is what keeps a character's knees from inverting when a foot target moves.
 */
export function solveTwoBone(
  root: Vec2,
  len1: number,
  len2: number,
  target: Vec2,
  bendPositive: boolean,
): { angle1: number; angle2: number; outOfReach: boolean } {
  const toTarget = vsub(target, root);
  const dist = clamp(vlen(toTarget), 1e-6, len1 + len2 - 1e-6);
  const outOfReach = vlen(toTarget) > len1 + len2 || vlen(toTarget) < Math.abs(len1 - len2);
  const baseAngle = vangle(toTarget);

  // Law of cosines.
  const cosA = clamp((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1, 1);
  const cosB = clamp((len1 * len1 + len2 * len2 - dist * dist) / (2 * len1 * len2), -1, 1);
  const a = Math.acos(cosA);
  const b = Math.acos(cosB);
  const sign = bendPositive ? 1 : -1;
  return {
    angle1: wrapAngle(baseAngle - sign * a),
    angle2: wrapAngle(sign * (Math.PI - b)),
    outOfReach,
  };
}

/**
 * Solve a chain toward a target, writing rotations into a pose.
 * Two-bone chains take the analytic path; longer chains use FABRIK followed
 * by an angle extraction pass so the result is still expressed as rotations
 * (the graph never stores raw positions — structure first).
 */
export function solveChain(
  bones: readonly Bone[],
  chain: readonly string[],
  target: Point,
  pose: Pose,
  options: { poleTarget?: Point; iterations?: number; weight?: number } = {},
): IKResult {
  const iterations = options.iterations ?? 12;
  const weight = clamp(options.weight ?? 1, 0, 1);
  if (chain.length < 2) return { pose, residual: 0, outOfReach: false, iterations: 0 };

  const ix = indexSkeleton(bones);
  const basePosed = evaluatePose(bones, pose, ix);
  const first = basePosed.bones.get(chain[0]);
  if (!first) return { pose, residual: 0, outOfReach: false, iterations: 0 };

  const tgt: Vec2 = { x: target.x, y: target.y };
  const out: Pose = { ...pose };

  if (chain.length === 2) {
    const b0 = basePosed.bones.get(chain[0])!;
    const b1 = basePosed.bones.get(chain[1])!;
    const len1 = vdist(b0.head, b0.tail);
    const len2 = vdist(b1.head, b1.tail);
    // Parent world rotation, so we can express the solve as local rotations.
    const parentRot = b0.worldRotation - (out[chain[0]]?.rotation ?? 0);
    const bendPositive = options.poleTarget
      ? vcross(vsub(tgt, b0.head), vsub({ x: options.poleTarget.x, y: options.poleTarget.y }, b0.head)) < 0
      : vcross(vsub(b1.tail, b0.head), vsub(b0.tail, b0.head)) <= 0;
    const rest0 = b0.bone.restRotation;
    const rest1 = b1.bone.restRotation;
    const s = solveTwoBone(b0.head, len1, len2, tgt, bendPositive);
    const local0 = wrapAngle(s.angle1 - parentRot - rest0);
    const local1 = wrapAngle(s.angle2 - (rest1 - rest0));
    out[chain[0]] = {
      ...out[chain[0]],
      rotation: blendAngle(out[chain[0]]?.rotation ?? 0, applyLimits(b0.bone, local0), weight),
    };
    out[chain[1]] = {
      ...out[chain[1]],
      rotation: blendAngle(out[chain[1]]?.rotation ?? 0, applyLimits(b1.bone, local1), weight),
    };
    const check = evaluatePose(bones, out, ix);
    const eff = check.bones.get(chain[chain.length - 1])!;
    return {
      pose: out,
      residual: vdist(eff.tail, tgt),
      outOfReach: s.outOfReach,
      iterations: 1,
    };
  }

  // FABRIK on the posed joint positions.
  const joints: Vec2[] = [];
  for (const id of chain) joints.push(basePosed.bones.get(id)!.head);
  joints.push(basePosed.bones.get(chain[chain.length - 1])!.tail);
  const lengths: number[] = [];
  for (let i = 0; i < joints.length - 1; i++) lengths.push(vdist(joints[i], joints[i + 1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const origin = joints[0];
  const outOfReach = vdist(origin, tgt) > total;

  let iter = 0;
  if (outOfReach) {
    const dir = vnorm(vsub(tgt, origin));
    for (let i = 1; i < joints.length; i++) {
      joints[i] = vadd(joints[i - 1], vmul(dir, lengths[i - 1]));
    }
    iter = 1;
  } else {
    for (; iter < iterations; iter++) {
      // Backward pass.
      joints[joints.length - 1] = tgt;
      for (let i = joints.length - 2; i >= 0; i--) {
        const d = vnorm(vsub(joints[i], joints[i + 1]));
        joints[i] = vadd(joints[i + 1], vmul(d, lengths[i]));
      }
      // Forward pass.
      joints[0] = origin;
      for (let i = 1; i < joints.length; i++) {
        const d = vnorm(vsub(joints[i], joints[i - 1]));
        joints[i] = vadd(joints[i - 1], vmul(d, lengths[i - 1]));
      }
      if (vdist(joints[joints.length - 1], tgt) < 0.01) break;
    }
  }

  // Convert joint positions back into local rotations.
  let parentWorld = basePosed.bones.get(chain[0])!.worldRotation - (pose[chain[0]]?.rotation ?? 0);
  for (let i = 0; i < chain.length; i++) {
    const bone = ix.byId.get(chain[i])!;
    const desiredWorld = vangle(vsub(joints[i + 1], joints[i]));
    const local = wrapAngle(desiredWorld - parentWorld - bone.restRotation);
    const limited = applyLimits(bone, local);
    out[chain[i]] = {
      ...out[chain[i]],
      rotation: blendAngle(pose[chain[i]]?.rotation ?? 0, limited, weight),
    };
    parentWorld = wrapAngle(parentWorld + limited + bone.restRotation);
  }

  const check = evaluatePose(bones, out, ix);
  const eff = check.bones.get(chain[chain.length - 1])!;
  return { pose: out, residual: vdist(eff.tail, tgt), outOfReach, iterations: iter };
}

function applyLimits(bone: Bone, rotation: number): number {
  return bone.limits ? clamp(rotation, bone.limits.min, bone.limits.max) : rotation;
}

function blendAngle(from: number, to: number, t: number): number {
  return t >= 1 ? to : wrapAngle(from + wrapAngle(to - from) * t);
}
