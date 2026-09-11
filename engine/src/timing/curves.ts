/**
 * Animation channels: keyframes, evaluation, sampling, and curve surgery.
 *
 * A Channel is the only place continuous motion is expressed. Repair moves
 * like "tighten the eases" or "add an overshoot" are edits to these arrays,
 * which is precisely why director notes can be applied surgically.
 */

import type { Channel, Keyframe, EaseName } from '../graph/types.ts';
import { applyEase } from './easing.ts';
import type { BezierHandles } from './easing.ts';
import { clamp01, lerp, derivative } from '../core/math.ts';

export function evaluateChannel(channel: Channel, frame: number): number {
  const keys = channel.keyframes;
  if (keys.length === 0) return channel.additive ? 0 : 0;
  if (keys.length === 1) return keys[0].value;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.frame - a.frame;
  if (span <= 0) return b.value;
  const raw = clamp01((frame - a.frame) / span);
  const handles: BezierHandles | undefined = b.handles
    ? { x1: b.handles.outX, y1: b.handles.outY, x2: b.handles.inX, y2: b.handles.inY }
    : undefined;
  return lerp(a.value, b.value, applyEase(raw, b.ease, handles));
}

/** Sample a channel across a frame range, inclusive of both ends. */
export function sampleChannel(channel: Channel, start: number, end: number): number[] {
  const out: number[] = [];
  for (let f = start; f <= end; f++) out.push(evaluateChannel(channel, f));
  return out;
}

export function channelBounds(channel: Channel): { start: number; end: number } {
  if (channel.keyframes.length === 0) return { start: 0, end: 0 };
  return {
    start: channel.keyframes[0].frame,
    end: channel.keyframes[channel.keyframes.length - 1].frame,
  };
}

export function makeChannel(
  target: string,
  keys: readonly (readonly [number, number] | Keyframe)[],
  defaultEase: EaseName = 'easeInOut',
  additive = false,
): Channel {
  const keyframes: Keyframe[] = keys.map((k) =>
    Array.isArray(k)
      ? { frame: k[0], value: k[1], ease: defaultEase }
      : (k as Keyframe),
  );
  keyframes.sort((a, b) => a.frame - b.frame);
  return { target, keyframes, additive };
}

export function sortChannel(channel: Channel): Channel {
  return { ...channel, keyframes: [...channel.keyframes].sort((a, b) => a.frame - b.frame) };
}

/** Insert or replace a key. */
export function setKey(channel: Channel, key: Keyframe): Channel {
  const keys = channel.keyframes.filter((k) => k.frame !== key.frame);
  keys.push(key);
  keys.sort((a, b) => a.frame - b.frame);
  return { ...channel, keyframes: keys };
}

export function removeKey(channel: Channel, frame: number): Channel {
  return { ...channel, keyframes: channel.keyframes.filter((k) => k.frame !== frame) };
}

/** Shift every key by a frame offset — the overlap/lag repair move. */
export function offsetChannel(channel: Channel, frames: number): Channel {
  return {
    ...channel,
    keyframes: channel.keyframes.map((k) => ({ ...k, frame: k.frame + frames })),
  };
}

/** Scale the time axis about a pivot frame — the "too floaty" retime. */
export function retimeChannel(channel: Channel, factor: number, pivot = 0): Channel {
  return {
    ...channel,
    keyframes: channel.keyframes.map((k) => ({
      ...k,
      frame: Math.round(pivot + (k.frame - pivot) * factor),
    })),
  };
}

/** Scale amplitude about a base value — the "exaggeration" repair move. */
export function scaleChannel(channel: Channel, factor: number, base?: number): Channel {
  const b = base ?? (channel.keyframes[0]?.value ?? 0);
  return {
    ...channel,
    keyframes: channel.keyframes.map((k) => ({ ...k, value: b + (k.value - b) * factor })),
  };
}

/** Replace every ease on the channel. */
export function setEases(channel: Channel, ease: EaseName): Channel {
  return { ...channel, keyframes: channel.keyframes.map((k) => ({ ...k, ease, handles: undefined })) };
}

/**
 * Add anticipation: a small counter-move inserted before the main action.
 * `frames` is the lead-in; `amount` is a fraction of the main move's range.
 */
export function addAnticipation(channel: Channel, actionFrame: number, frames: number, amount: number): Channel {
  const keys = [...channel.keyframes].sort((a, b) => a.frame - b.frame);
  const i = keys.findIndex((k) => k.frame >= actionFrame);
  if (i <= 0) return channel;
  const start = keys[i - 1];
  const target = keys[i];
  const range = target.value - start.value;
  if (Math.abs(range) < 1e-9) return channel;
  const anticFrame = Math.max(start.frame + 1, actionFrame - frames);
  if (anticFrame <= start.frame || anticFrame >= target.frame) return channel;
  const anticKey: Keyframe = {
    frame: anticFrame,
    value: start.value - range * amount,
    ease: 'easeOut',
  };
  const out = keys.filter((k) => k.frame !== anticFrame);
  out.push(anticKey);
  out.sort((a, b) => a.frame - b.frame);
  // The main action now accelerates out of the antic.
  return {
    ...channel,
    keyframes: out.map((k) => (k.frame === target.frame ? { ...k, ease: 'easeInStrong' } : k)),
  };
}

/**
 * Add overshoot and settle after a move: the pose passes the target, then
 * comes back. This is what makes an action land instead of arriving.
 */
export function addOvershoot(
  channel: Channel,
  landingFrame: number,
  overshootFrames: number,
  settleFrames: number,
  amount: number,
): Channel {
  const keys = [...channel.keyframes].sort((a, b) => a.frame - b.frame);
  const i = keys.findIndex((k) => k.frame === landingFrame);
  if (i < 1) return channel;
  const prev = keys[i - 1];
  const land = keys[i];
  const range = land.value - prev.value;
  if (Math.abs(range) < 1e-9) return channel;

  const peakFrame = landingFrame + overshootFrames;
  const settleFrame = peakFrame + settleFrames;
  const out = keys.filter((k) => k.frame !== peakFrame && k.frame !== settleFrame);
  const landIdx = out.findIndex((k) => k.frame === landingFrame);
  if (landIdx >= 0) out[landIdx] = { ...out[landIdx], ease: 'easeOutStrong' };
  out.push({ frame: peakFrame, value: land.value + range * amount, ease: 'easeOut' });
  out.push({ frame: settleFrame, value: land.value, ease: 'easeInOut' });
  out.sort((a, b) => a.frame - b.frame);
  return { ...channel, keyframes: out };
}

/**
 * Insert a breakdown key between two keys. `favor` biases it toward the
 * earlier (0) or later (1) key — the timing-chart decision an animator makes
 * on paper.
 */
export function addBreakdown(channel: Channel, a: number, b: number, favor = 0.5, offset = 0): Channel {
  const keys = [...channel.keyframes].sort((k, l) => k.frame - l.frame);
  const ka = keys.find((k) => k.frame === a);
  const kb = keys.find((k) => k.frame === b);
  if (!ka || !kb || b - a < 2) return channel;
  const frame = Math.round(a + (b - a) * favor);
  if (frame <= a || frame >= b) return channel;
  const value = lerp(ka.value, kb.value, favor) + offset;
  return setKey(channel, { frame, value, ease: 'easeInOut' });
}

/** Hold a value across a range by pinning keys at both ends. */
export function addHold(channel: Channel, start: number, end: number): Channel {
  const v = evaluateChannel(channel, start);
  let out = channel;
  out = setKey(out, { frame: start, value: v, ease: 'easeInOut' });
  out = setKey(out, { frame: end, value: v, ease: 'hold' });
  return {
    ...out,
    keyframes: out.keyframes.filter((k) => k.frame <= start || k.frame >= end),
  };
}

/**
 * Moving hold: instead of freezing, the pose drifts slightly. A frozen hold
 * is the single most common reason a character "looks dead".
 */
export function addMovingHold(channel: Channel, start: number, end: number, drift: number): Channel {
  const v = evaluateChannel(channel, start);
  let out: Channel = {
    ...channel,
    keyframes: channel.keyframes.filter((k) => k.frame <= start || k.frame >= end),
  };
  out = setKey(out, { frame: start, value: v, ease: 'easeInOut' });
  const mid = Math.round((start + end) / 2);
  if (mid > start && mid < end) out = setKey(out, { frame: mid, value: v + drift, ease: 'easeInOut' });
  out = setKey(out, { frame: end, value: v + drift * 0.35, ease: 'easeInOut' });
  return out;
}

/** Quantise a channel onto twos (or any step), for the ones/twos policy. */
export function steppedSample(channel: Channel, start: number, end: number, step: 1 | 2): number[] {
  const out: number[] = [];
  for (let f = start; f <= end; f++) {
    const held = start + Math.floor((f - start) / step) * step;
    out.push(evaluateChannel(channel, held));
  }
  return out;
}

/** Velocity profile of a channel over a range — what the ease classifier eats. */
export function velocityProfile(channel: Channel, start: number, end: number): number[] {
  return derivative(sampleChannel(channel, start, end));
}

/** Find frames where velocity jumps discontinuously (the "hitch" detector). */
export function hitchFrames(
  channel: Channel,
  start: number,
  end: number,
  tolerance = 3.5,
): number[] {
  const vel = velocityProfile(channel, start, end);
  const accel = derivative(vel);
  const mags = accel.map(Math.abs);
  const mean = mags.reduce((a, b) => a + b, 0) / Math.max(1, mags.length);
  if (mean < 1e-9) return [];
  const keyFrames = new Set(channel.keyframes.map((k) => k.frame));
  const out: number[] = [];
  for (let i = 1; i < mags.length - 1; i++) {
    const f = start + i;
    if (keyFrames.has(f) || keyFrames.has(f - 1) || keyFrames.has(f + 1)) continue;
    if (mags[i] > mean * tolerance) out.push(f);
  }
  return out;
}

/** Merge additive channels into a base channel at sample time. */
export function evaluateStack(channels: readonly Channel[], target: string, frame: number): number {
  let base = 0;
  let found = false;
  let additive = 0;
  for (const c of channels) {
    if (c.target !== target) continue;
    if (c.additive) additive += evaluateChannel(c, frame);
    else {
      base = evaluateChannel(c, frame);
      found = true;
    }
  }
  return (found ? base : 0) + additive;
}

/** Every distinct target across a channel set. */
export function channelTargets(channels: readonly Channel[]): string[] {
  return [...new Set(channels.map((c) => c.target))].sort();
}
