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
  // A long shot is a full-figure shot, and the eyes have to sit high
  // enough in frame for the feet to land inside it. At 0.3 a 3.8-head
  // character's feet fell about twenty pixels below the bottom edge,
  // which is exactly the wrong twenty pixels in a shot of someone
  // running.
  ls: 0.2,
  els: 0.3,
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
 *
 * `parallax` is the multiplane depth factor: 0 is infinitely far and does
 * not shift at all as the camera moves, 1 sits on the action plane and
 * shifts with it. Crucially it scales the camera's *movement away from a
 * reference*, not its absolute position — scaling the absolute position
 * would throw a distant hill thousands of units off screen simply because
 * the camera happens to be framed on a character's eyeline. The reference
 * is the shot's opening camera position, which is where every plane is
 * registered and where the layout was composed.
 */
export function cameraMatrix(
  state: CameraState,
  width: number,
  height: number,
  parallax = 1,
  reference?: Vec2,
): Mat2D {
  const ref = reference ?? state.position;
  const effective = {
    x: ref.x + (state.position.x - ref.x) * parallax,
    y: ref.y + (state.position.y - ref.y) * parallax,
  };
  let m = mTranslate(width / 2, height / 2);
  m = mmul(m, mScale(state.zoom, state.zoom));
  if (state.rotation !== 0) {
    const c = Math.cos(state.rotation);
    const s = Math.sin(state.rotation);
    m = mmul(m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
  }
  m = mmul(m, mTranslate(-effective.x, -effective.y));
  return m;
}

/**
 * Solve the camera keys that frame a character at the requested shot size.
 * This is what turns "MCU on MIBO, low angle" into actual numbers.
 */
export function frameSubject(options: {
  size: ShotSize;
  subject: Placement;
  /** Full height of the character in world units. */
  subjectHeightPx: number;
  /** Height of the head, used to place the eyeline. */
  headHeightPx?: number;
  canvasHeight: number;
  canvasWidth?: number;
  /** World y of the top of the head. Rigs are built with +y downward. */
  subjectTopY: number;
}): CameraState {
  const coverage = SHOT_SIZE_COVERAGE[options.size];
  const headHeight = options.headHeightPx ?? options.subjectHeightPx / 6;
  // Show `coverage` of the character's height across most of the frame,
  // leaving a little air top and bottom.
  const zoom = clampZoom(
    (options.canvasHeight * 0.94) / Math.max(1, options.subjectHeightPx * coverage),
  );
  // Eye level sits a little under half way down a stylised head.
  const eyeY = options.subjectTopY + headHeight * 0.45;
  const targetScreenY = SHOT_SIZE_EYELINE[options.size] * options.canvasHeight;
  // Screen y of a world point is (y - position.y) * zoom + canvasHeight / 2,
  // so putting the eyeline on target means solving that for position.y.
  const positionY = eyeY - (targetScreenY - options.canvasHeight / 2) / zoom;
  return {
    position: { x: options.subject.position.x, y: positionY },
    zoom,
    rotation: 0,
  };
}

/**
 * Frame two or more subjects together: fit their combined bounds, then
 * apply the shot size as a margin rather than a per-character coverage.
 */
export function frameGroup(options: {
  size: ShotSize;
  subjects: readonly Placement[];
  subjectHeightPx: number;
  headHeightPx?: number;
  canvasWidth: number;
  canvasHeight: number;
  subjectTopY: number;
}): CameraState {
  if (options.subjects.length === 0) {
    return { position: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
  }
  if (options.subjects.length === 1) {
    return frameSubject({ ...options, subject: options.subjects[0] });
  }
  const xs = options.subjects.map((s) => s.position.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spread = maxX - minX + options.subjectHeightPx * 0.55;
  const coverage = SHOT_SIZE_COVERAGE[options.size];
  const zoomForHeight = (options.canvasHeight * 0.94) / Math.max(1, options.subjectHeightPx * coverage);
  const zoomForWidth = (options.canvasWidth * 0.86) / Math.max(1, spread);
  const zoom = clampZoom(Math.min(zoomForHeight, zoomForWidth));
  const headHeight = options.headHeightPx ?? options.subjectHeightPx / 6;
  const eyeY = options.subjectTopY + headHeight * 0.45;
  const targetScreenY = SHOT_SIZE_EYELINE[options.size] * options.canvasHeight;
  return {
    position: {
      x: (minX + maxX) / 2,
      y: eyeY - (targetScreenY - options.canvasHeight / 2) / zoom,
    },
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
