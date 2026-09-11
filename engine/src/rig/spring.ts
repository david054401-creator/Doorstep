/**
 * Spring bones — hair, ears, tails, cloth tips.
 *
 * This is how "follow-through and overlapping action" becomes a property of
 * the rig instead of something an animator has to remember. The solver is a
 * damped harmonic oscillator integrated with semi-implicit Euler at a fixed
 * timestep, so it is frame-rate independent and perfectly reproducible.
 */

import type { Bone, SpringSettings } from '../graph/types.ts';
import type { Pose } from './skeleton.ts';
import { clamp, wrapAngle } from '../core/math.ts';

export type SpringState = Record<string, { angle: number; velocity: number }>;

export const DEFAULT_SPRING: SpringSettings = {
  stiffness: 120,
  damping: 12,
  mass: 1,
  gravity: 0.15,
  maxAngle: 0.9,
};

export function initSpringState(bones: readonly Bone[]): SpringState {
  const s: SpringState = {};
  for (const b of bones) {
    if (b.spring) s[b.id] = { angle: 0, velocity: 0 };
  }
  return s;
}

/**
 * Advance the spring simulation one frame.
 *
 * `driverDelta` is how much the parent chain rotated since the last frame;
 * the spring lags behind it, which is exactly the overlap the animation
 * validator later measures as a 2-6 frame phase lag.
 */
export function stepSprings(
  bones: readonly Bone[],
  state: SpringState,
  driverDelta: Record<string, number>,
  dt: number,
  substeps = 4,
): { state: SpringState; pose: Pose } {
  const next: SpringState = { ...state };
  const pose: Pose = {};
  const h = dt / substeps;

  for (const bone of bones) {
    const cfg = bone.spring;
    if (!cfg) continue;
    const cur = next[bone.id] ?? { angle: 0, velocity: 0 };
    let angle = cur.angle;
    let velocity = cur.velocity;
    // The driver's rotation this frame acts as an impulse on the spring,
    // in the opposite direction (inertia).
    const impulse = -(driverDelta[bone.id] ?? 0);
    velocity += impulse / Math.max(0.01, cfg.mass);

    const k = cfg.stiffness;
    const c = cfg.damping;
    const m = Math.max(0.01, cfg.mass);
    // Gravity pulls toward the rest-down direction.
    const gravityTorque = -Math.sin(bone.restRotation + angle) * cfg.gravity * 9.81;

    for (let s = 0; s < substeps; s++) {
      const accel = (-k * angle - c * velocity) / m + gravityTorque;
      velocity += accel * h;
      angle += velocity * h;
      if (angle > cfg.maxAngle) {
        angle = cfg.maxAngle;
        velocity *= -0.3;
      } else if (angle < -cfg.maxAngle) {
        angle = -cfg.maxAngle;
        velocity *= -0.3;
      }
    }
    // Guard against numeric blow-up; a spring that explodes is a broken frame.
    if (!Number.isFinite(angle) || !Number.isFinite(velocity)) {
      angle = 0;
      velocity = 0;
    }
    angle = clamp(angle, -cfg.maxAngle, cfg.maxAngle);
    velocity = clamp(velocity, -50, 50);
    next[bone.id] = { angle, velocity };
    pose[bone.id] = { rotation: wrapAngle(angle) };
  }
  return { state: next, pose };
}

/**
 * Run the spring sim across a whole shot and return a per-frame additive pose
 * track. Springs are simulated forward from a settled state so frame 0 does
 * not pop — the pre-roll is discarded.
 */
export function simulateSprings(
  bones: readonly Bone[],
  driverRotationsPerFrame: readonly Record<string, number>[],
  fps: number,
  preRollFrames = 12,
): Pose[] {
  const dt = 1 / fps;
  let state = initSpringState(bones);
  const springBones = bones.filter((b) => b.spring);
  if (springBones.length === 0) return driverRotationsPerFrame.map(() => ({}));

  const firstFrame = driverRotationsPerFrame[0] ?? {};
  for (let i = 0; i < preRollFrames; i++) {
    const delta: Record<string, number> = {};
    for (const b of springBones) delta[b.id] = 0;
    void firstFrame;
    state = stepSprings(bones, state, delta, dt).state;
  }

  const out: Pose[] = [];
  let prev = driverRotationsPerFrame[0] ?? {};
  for (const frame of driverRotationsPerFrame) {
    const delta: Record<string, number> = {};
    for (const b of springBones) {
      const parent = b.parent;
      const now = parent ? (frame[parent] ?? 0) : 0;
      const before = parent ? (prev[parent] ?? 0) : 0;
      delta[b.id] = wrapAngle(now - before);
    }
    const stepped = stepSprings(bones, state, delta, dt);
    state = stepped.state;
    out.push(stepped.pose);
    prev = frame;
  }
  return out;
}
