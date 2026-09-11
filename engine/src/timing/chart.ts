/**
 * The timing engine.
 *
 * Timing charts, ones/twos policy, holds, and the frame-count ranges per
 * action class. These ranges are the "learned ranges" the Timing principle
 * validator checks against — they start as craft defaults and are meant to
 * be re-fit from your own approved footage.
 */

import type { TimingChart, Beat } from '../graph/types.ts';

export type ActionClass =
  | 'blink'
  | 'headTurn'
  | 'lookAt'
  | 'gesture'
  | 'reach'
  | 'step'
  | 'walkCycle'
  | 'runCycle'
  | 'jump'
  | 'land'
  | 'react'
  | 'takeDouble'
  | 'settle'
  | 'idle'
  | 'anticipation'
  | 'overshoot'
  | 'dialogueBeat';

/** Frame ranges at 24fps: [min, typical, max]. */
export const TIMING_RANGES: Record<ActionClass, [number, number, number]> = {
  blink: [3, 5, 8],
  headTurn: [4, 8, 16],
  lookAt: [3, 6, 12],
  gesture: [8, 14, 28],
  reach: [8, 12, 24],
  step: [8, 12, 18],
  walkCycle: [16, 24, 36],
  runCycle: [8, 12, 18],
  jump: [10, 16, 28],
  land: [2, 4, 8],
  react: [4, 8, 16],
  takeDouble: [12, 18, 30],
  settle: [4, 8, 14],
  idle: [24, 48, 120],
  anticipation: [2, 5, 12],
  overshoot: [2, 3, 6],
  dialogueBeat: [6, 12, 48],
};

/** Scale the ranges to a non-24fps delivery. */
export function rangeFor(cls: ActionClass, fps = 24): [number, number, number] {
  const [a, b, c] = TIMING_RANGES[cls];
  const k = fps / 24;
  return [Math.round(a * k), Math.round(b * k), Math.round(c * k)];
}

export function inRange(cls: ActionClass, frames: number, fps = 24): boolean {
  const [min, , max] = rangeFor(cls, fps);
  return frames >= min && frames <= max;
}

/**
 * Ones-or-twos policy.
 *
 * Series 2D runs on twos as a default and steps to ones for fast action,
 * because twos read as *deliberate* and ones read as *expensive*. Getting
 * this backwards is what makes cheap animation look cheap.
 */
export type SteppingPolicy = {
  /** Speed in rig units per frame above which we step to ones. */
  onesAboveSpeed: number;
  /** Never step to twos during a move shorter than this. */
  minTwosSpan: number;
  /** Dialogue mouth channels always run on ones. */
  onesForDialogue: boolean;
};

export const DEFAULT_STEPPING: SteppingPolicy = {
  onesAboveSpeed: 9,
  minTwosSpan: 4,
  onesForDialogue: true,
};

/**
 * Decide stepping per frame range from a motion speed profile.
 * Returns contiguous runs, which is what a TimingChart stores.
 */
export function solveStepping(
  speedPerFrame: readonly number[],
  startFrame: number,
  policy: SteppingPolicy = DEFAULT_STEPPING,
): TimingChart['stepping'] {
  if (speedPerFrame.length === 0) return [];
  const raw: (1 | 2)[] = speedPerFrame.map((s) => (s > policy.onesAboveSpeed ? 1 : 2));
  // Collapse runs shorter than minTwosSpan into their neighbour.
  const runs: { step: 1 | 2; start: number; end: number }[] = [];
  let cur = raw[0];
  let start = 0;
  for (let i = 1; i <= raw.length; i++) {
    if (i === raw.length || raw[i] !== cur) {
      runs.push({ step: cur, start, end: i - 1 });
      if (i < raw.length) {
        cur = raw[i];
        start = i;
      }
    }
  }
  const merged: typeof runs = [];
  for (const run of runs) {
    const len = run.end - run.start + 1;
    if (merged.length && len < policy.minTwosSpan) {
      merged[merged.length - 1].end = run.end;
      continue;
    }
    if (merged.length && merged[merged.length - 1].step === run.step) {
      merged[merged.length - 1].end = run.end;
      continue;
    }
    merged.push({ ...run });
  }
  return merged.map((r) => ({
    startFrame: startFrame + r.start,
    endFrame: startFrame + r.end,
    step: r.step,
  }));
}

/** Which step applies at a given frame. */
export function stepAt(chart: TimingChart, frame: number): 1 | 2 {
  for (const s of chart.stepping) {
    if (frame >= s.startFrame && frame <= s.endFrame) return s.step;
  }
  return 1;
}

/**
 * Snap a frame to its stepped sample. On twos, frames 4 and 5 both read the
 * pose authored at 4 — that is the whole mechanic.
 */
export function steppedFrame(chart: TimingChart, frame: number): number {
  for (const s of chart.stepping) {
    if (frame >= s.startFrame && frame <= s.endFrame) {
      if (s.step === 1) return frame;
      return s.startFrame + Math.floor((frame - s.startFrame) / 2) * 2;
    }
  }
  return frame;
}

export function isHeld(chart: TimingChart, frame: number): { held: boolean; moving: boolean } {
  for (const h of chart.holds) {
    if (frame >= h.startFrame && frame <= h.endFrame) return { held: true, moving: h.moving };
  }
  return { held: false, moving: false };
}

/**
 * Build a timing chart from beats. Every beat gets an anticipation window,
 * an action window and a settle; holds fill the gaps between beats and are
 * always *moving* holds, never frozen.
 */
export function chartFromBeats(beats: readonly Beat[], durationFrames: number, fps = 24): TimingChart {
  const stepping: TimingChart['stepping'] = [];
  const holds: TimingChart['holds'] = [];
  const breakdowns: number[] = [];

  const sorted = [...beats].sort((a, b) => a.startFrame - b.startFrame);
  let cursor = 0;
  for (const beat of sorted) {
    const start = Math.max(0, beat.startFrame);
    const end = Math.min(durationFrames - 1, beat.startFrame + beat.durationFrames - 1);
    if (start > cursor + 1) {
      holds.push({ startFrame: cursor, endFrame: start - 1, moving: true });
      stepping.push({ startFrame: cursor, endFrame: start - 1, step: 2 });
    }
    // Fast, high-intensity beats run on ones.
    const step: 1 | 2 = beat.intensity >= 4 || beat.durationFrames <= rangeFor('react', fps)[1] ? 1 : 2;
    stepping.push({ startFrame: start, endFrame: end, step });
    const mid = Math.round((start + end) / 2);
    if (mid > start && mid < end) breakdowns.push(mid);
    cursor = end + 1;
  }
  if (cursor < durationFrames) {
    holds.push({ startFrame: cursor, endFrame: durationFrames - 1, moving: true });
    stepping.push({ startFrame: cursor, endFrame: durationFrames - 1, step: 2 });
  }
  stepping.sort((a, b) => a.startFrame - b.startFrame);
  return { stepping, holds, breakdowns: [...new Set(breakdowns)].sort((a, b) => a - b) };
}

/** Total frames covered by holds, as a fraction of the shot. */
export function holdFraction(chart: TimingChart, durationFrames: number): number {
  if (durationFrames <= 0) return 0;
  let n = 0;
  for (const h of chart.holds) n += Math.max(0, h.endFrame - h.startFrame + 1);
  return Math.min(1, n / durationFrames);
}

/** Fraction of the shot that runs on twos. */
export function twosFraction(chart: TimingChart, durationFrames: number): number {
  if (durationFrames <= 0) return 0;
  let n = 0;
  for (const s of chart.stepping) {
    if (s.step === 2) n += Math.max(0, s.endFrame - s.startFrame + 1);
  }
  return Math.min(1, n / durationFrames);
}

export const emptyChart = (): TimingChart => ({ stepping: [], holds: [], breakdowns: [] });
