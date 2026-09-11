/**
 * Camera: shot-size framing, curve evaluation, multiplane parallax.
 *
 * Camera moves are keyed and eased like everything else. The comp validator
 * rejects linear zooms because a linear zoom is the single clearest "nobody
 * was directing this" tell in AI animation.
 */

import type { CameraCurve, CameraKey, ShotSize, Placement } from '../graph/types.ts';
import type { Mat2D, Vec2 } from '../core/math.ts';
import { mmul, mScale, mTranslate, lerp, clamp01 } from '../core/math.ts';
import { applyEase } from '../timing/easing.ts';
import { makeRng } from '../core/rng.ts';

/**
 * How much of the character's height the frame should contain, per shot size.
 * These are the standard framings; the layout validator checks against them.
 */
export const SHOT_SIZE_COVERAGE: Record<ShotSize, number> = {
  ecu: 0.18,
  cu: 0.33,
  mcu: 0.5,
  ms: 0.68,
  mls: 0.85,
  ls: 1.15,
  els: 2.4,
  ots: 0.6,
  twoShot: 1.0,
};

/** Where the subject's eyes should sit vertically, per shot size (0 = top). */
export const SHOT_SIZE_EYELINE: Record<ShotSize, number> = {
  ecu: 0.42,
  cu: 0.36,
  mcu: 0.33,
  ms: 0.3,
  mls: 0.28,
  ls: 0.3,
  els: 0.35,
  ots: 0.34,
  twoShot: 0.32,
};

export type CameraState = { position: Vec2; zoom: number; rotation: number };

export function evaluateCamera(curve: CameraCurve, frame: number, seed = 1): CameraState {
  const keys = [...curve.keys].sort((a, b) => a.frame - b.frame);
  if (keys.length === 0) {
    return { position: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
  }
  let state: CameraState;
  if (frame <= keys[0].frame) {
    state = { position: { ...keys[0].position }, zoom: keys[0].zoom, rotation: keys[0].rotation };
  } else if (frame >= keys[keys.length - 1].frame) {
    const k = keys[keys.length - 1];
    state = { position: { ...k.position }, zoom: k.zoom, rotation: k.rotation };
  } else {
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].frame <= frame) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const span = Math.max(1, b.frame - a.frame);
    const t = applyEase(clamp01((frame - a.frame) / span), b.ease);
    state = {
      position: { x: lerp(a.position.x, b.position.x, t), y: lerp(a.position.y, b.position.y, t) },
      zoom: lerp(a.zoom, b.zoom, t),
      rotation: lerp(a.rotation, b.rotation, t),
    };
  }
  if (curve.move === 'handheld' && (curve.handheldAmount ?? 0) > 0) {
    // Seeded per-frame noise: reproducible, but never a repeating loop.
    const rng = makeRng(`handheld:${seed}:${frame}`);
    const amp = curve.handheldAmount ?? 0;
    state = {
      position: {
        x: state.position.x + rng.gaussian(0, amp),
        y: state.position.y + rng.gaussian(0, amp),
      },
      zoom: state.zoom,
      rotation: state.rotation + rng.gaussian(0, amp * 0.0015),
    };
  }
  return state;
}

/**
 * Build the world→screen matrix for a camera state at a given canvas size.
 * `parallax` scales translation for multiplane depth: 0 = infinitely far
 * (does not move), 1 = at the action plane.
 */
export function cameraMatrix(
  state: CameraState,
  width: number,
  height: number,
  parallax = 1,
): Mat2D {
  let m = mTranslate(width / 2, height / 2);
  m = mmul(m, mScale(state.zoom, state.zoom));
  if (state.rotation !== 0) {
    const c = Math.cos(state.rotation);
    const s = Math.sin(state.rotation);
    m = mmul(m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
  }
  m = mmul(m, mTranslate(-state.position.x * parallax, -state.position.y * parallax));
  return m;
}

/**
 * Solve the camera keys that frame a character at the requested shot size.
 * This is what turns "MCU on MIBO, low angle" into actual numbers.
 */
export function frameSubject(options: {
  size: ShotSize;
  subject: Placement;
  subjectHeightPx: number;
  canvasHeight: number;
  /** Head-top y in world units, used to place the eyeline. */
  subjectTopY: number;
}): CameraState {
  const coverage = SHOT_SIZE_COVERAGE[options.size];
  const zoom = clampZoom(
    (options.canvasHeight * 0.82) / Math.max(1, options.subjectHeightPx * coverage),
  );
  // Eye level sits ~0.88 of the way up a stylised head.
  const eyeY = options.subjectTopY + options.subjectHeightPx * 0.1;
  const targetScreenY = SHOT_SIZE_EYELINE[options.size] * options.canvasHeight;
  const worldOffsetY = (options.canvasHeight / 2 - targetScreenY) / zoom;
  return {
    position: { x: options.subject.position.x, y: eyeY - worldOffsetY },
    zoom,
    rotation: 0,
  };
}

const clampZoom = (z: number): number => Math.max(0.05, Math.min(40, z));

/** Static camera curve at a single state. */
export function staticCurve(state: CameraState): CameraCurve {
  return {
    move: 'static',
    keys: [{ frame: 0, position: { ...state.position }, zoom: state.zoom, rotation: state.rotation, ease: 'linear' }],
  };
}

/** A two-key move with proper eases — never linear (comp invariant). */
export function moveCurve(
  from: CameraState,
  to: CameraState,
  durationFrames: number,
  move: CameraCurve['move'] = 'pan',
  ease: CameraKey['ease'] = 'easeInOut',
): CameraCurve {
  return {
    move,
    keys: [
      { frame: 0, position: { ...from.position }, zoom: from.zoom, rotation: from.rotation, ease: 'linear' },
      {
        frame: Math.max(1, durationFrames - 1),
        position: { ...to.position },
        zoom: to.zoom,
        rotation: to.rotation,
        ease,
      },
    ],
  };
}

/** Parallax factor for a background layer at a given depth. */
export const parallaxFor = (depth: number): number => clamp01(depth);
