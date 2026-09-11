/**
 * Idle layers: breath, blink, weight shift, eye darts.
 *
 * "She looks dead" is the most common note on rigged animation, and it
 * almost always means the character is perfectly still between actions.
 * These layers are additive, low amplitude, and always on. They are
 * seeded, so a rebuild produces the same performance.
 */

import type { Channel, Line, Viseme } from '../graph/types.ts';
import type { Pose } from '../rig/skeleton.ts';
import { makeChannel } from '../timing/curves.ts';
import type { Rng } from '../core/rng.ts';
import { makeRng } from '../core/rng.ts';
import { rad } from '../core/math.ts';
import { DEFAULT_FPS } from '../core/units.ts';

export type IdleOptions = {
  fps?: number;
  /** Breaths per minute. Calm 12-16, agitated 20-26. */
  breathRate?: number;
  breathAmount?: number;
  /** Mean frames between blinks. Humans blink every 2-6 seconds. */
  blinkIntervalFrames?: number;
  /** Frames a blink lasts. */
  blinkFrames?: number;
  /** Weight shifts per minute. */
  weightShiftRate?: number;
  weightShiftAmount?: number;
  seed?: string | number;
};

export type IdleLayer = {
  /** Additive channels layered under the acting. */
  channels: Channel[];
  /** Frames on which the eyes are closed. */
  blinkFrames: number[];
  /** Swap-set overrides per frame, e.g. eyes closed on a blink. */
  swapOverrides: Map<number, Record<string, string>>;
};

/**
 * Build the idle layer for a shot.
 *
 * Breath is a slow sine on the chest and shoulders. Blinks are Poisson-ish
 * around the mean interval, never on a metronome. Weight shifts move the
 * hips and counter-rotate the spine, which is what stops a standing
 * character looking pinned to the floor.
 */
export function buildIdleLayer(durationFrames: number, options: IdleOptions = {}): IdleLayer {
  const fps = options.fps ?? DEFAULT_FPS;
  const rng = makeRng(options.seed ?? 'idle');
  const breathRate = options.breathRate ?? 14;
  const breathAmount = options.breathAmount ?? 1;
  const blinkInterval = options.blinkIntervalFrames ?? Math.round(fps * 3.4);
  const blinkLen = options.blinkFrames ?? Math.max(3, Math.round(fps / 6));
  const shiftRate = options.weightShiftRate ?? 5;
  const shiftAmount = options.weightShiftAmount ?? 1;

  const channels: Channel[] = [];

  // Breath: chest lifts and the shoulders follow a beat later.
  const breathPeriod = Math.max(4, Math.round((60 / breathRate) * fps));
  const breathKeys: [number, number][] = [];
  const shoulderKeys: [number, number][] = [];
  for (let f = 0; f <= durationFrames + breathPeriod; f += Math.max(2, Math.round(breathPeriod / 4))) {
    const phase = (f / breathPeriod) * Math.PI * 2;
    breathKeys.push([f, Math.sin(phase) * rad(0.9) * breathAmount]);
    shoulderKeys.push([f + Math.round(breathPeriod * 0.12), Math.sin(phase) * rad(1.4) * breathAmount]);
  }
  channels.push(makeChannel('bone:chest.rotation', breathKeys, 'easeInOut', true));
  channels.push(makeChannel('bone:spine.rotation', breathKeys.map(([f, v]) => [f, v * 0.5] as [number, number]), 'easeInOut', true));
  channels.push(makeChannel('bone:L_upperarm.rotation', shoulderKeys.map(([f, v]) => [f, -v] as [number, number]), 'easeInOut', true));
  channels.push(makeChannel('bone:R_upperarm.rotation', shoulderKeys, 'easeInOut', true));

  // Weight shift: hips drift, spine counters so the head stays put.
  const shiftPeriod = Math.max(fps, Math.round((60 / shiftRate) * fps));
  const hipKeys: [number, number][] = [];
  const counterKeys: [number, number][] = [];
  for (let f = 0; f <= durationFrames + shiftPeriod; f += shiftPeriod) {
    const jitter = rng.range(-0.25, 0.25) * shiftPeriod;
    const at = Math.max(0, Math.round(f + jitter));
    const amount = rng.range(-1, 1) * rad(1.8) * shiftAmount;
    hipKeys.push([at, amount]);
    counterKeys.push([at, -amount * 0.65]);
  }
  channels.push(makeChannel('bone:hips.rotation', hipKeys, 'easeInOut', true));
  channels.push(makeChannel('bone:neck.rotation', counterKeys, 'easeInOut', true));

  // Head micro-motion, so a held pose never truly freezes.
  const headKeys: [number, number][] = [];
  const step = Math.max(6, Math.round(fps * 0.6));
  for (let f = 0; f <= durationFrames + step; f += step) {
    headKeys.push([f, rng.gaussian(0, rad(0.55))]);
  }
  channels.push(makeChannel('bone:head.rotation', headKeys, 'easeInOut', true));

  // Blinks.
  const blinks = scheduleBlinks(durationFrames, blinkInterval, rng);
  const swapOverrides = new Map<number, Record<string, string>>();
  const closedFrames: number[] = [];
  for (const start of blinks) {
    for (let f = start; f < start + blinkLen && f < durationFrames; f++) {
      closedFrames.push(f);
      swapOverrides.set(f, { ...(swapOverrides.get(f) ?? {}), eyes: 'closed' });
    }
  }

  return { channels, blinkFrames: closedFrames, swapOverrides };
}

/**
 * Blink scheduling. Real blinks cluster: an interval drawn from an
 * exponential-ish distribution around the mean, with a hard refractory
 * period so two never collide.
 */
export function scheduleBlinks(durationFrames: number, meanInterval: number, rng: Rng): number[] {
  const out: number[] = [];
  const refractory = Math.max(6, Math.round(meanInterval * 0.25));
  let f = Math.round(meanInterval * rng.range(0.2, 0.8));
  let guard = 0;
  while (f < durationFrames && guard++ < 1000) {
    out.push(f);
    const gap = Math.max(refractory, Math.round(-meanInterval * Math.log(1 - rng.next() * 0.95)));
    f += gap;
  }
  return out;
}

/**
 * Eye darts: the eyes lead every head turn and flick between points of
 * interest during a hold. "Think before act" is expressed here.
 */
export function eyeDarts(
  durationFrames: number,
  options: { fps?: number; seed?: string | number; intensity?: number } = {},
): Channel[] {
  const fps = options.fps ?? DEFAULT_FPS;
  const rng = makeRng(options.seed ?? 'darts');
  const intensity = options.intensity ?? 1;
  const keys: [number, number][] = [];
  let f = 0;
  let guard = 0;
  while (f < durationFrames && guard++ < 500) {
    keys.push([f, rng.range(-1, 1) * rad(2.4) * intensity]);
    // A dart is fast; the hold after it is long.
    keys.push([f + 2, rng.range(-1, 1) * rad(2.4) * intensity]);
    f += Math.round(rng.range(0.8, 2.6) * fps);
  }
  return [makeChannel('swap:eyes.offset', keys, 'step', true)];
}

/**
 * Merge the idle swap overrides with the acting swaps for one frame.
 * A blink wins over an expression; a viseme wins over a resting mouth.
 */
export function resolveSwaps(
  base: Record<string, string>,
  idle: IdleLayer,
  frame: number,
  viseme?: Viseme,
): Record<string, string> {
  const out = { ...base, ...(idle.swapOverrides.get(frame) ?? {}) };
  if (viseme) out.mouth = viseme;
  return out;
}

/** A tiny resting pose used when no acting pose is authored. */
export function restingPose(): Pose {
  return {};
}

export type { Line };
