/**
 * Eases.
 *
 * "Slow in / slow out" is principle #6, and the validator classifies a
 * velocity profile as eased or not. So the eases here are not decoration:
 * they are the thing being measured. Each named ease maps to explicit cubic
 * Bezier control values, which is what lets the classifier recover them.
 */

import type { EaseName } from '../graph/types.ts';
import { bezierSolveT, clamp01 } from '../core/math.ts';

export type BezierHandles = { x1: number; y1: number; x2: number; y2: number };

/**
 * Control points for each named ease, in the CSS cubic-bezier convention.
 * `overshoot` and `anticipate` deliberately leave the 0..1 range — that is
 * the whole point of them.
 */
export const EASE_CURVES: Record<EaseName, BezierHandles> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  easeIn: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  easeOut: { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  easeInOut: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  easeInStrong: { x1: 0.7, y1: 0, x2: 0.95, y2: 0.35 },
  easeOutStrong: { x1: 0.05, y1: 0.65, x2: 0.3, y2: 1 },
  hold: { x1: 1, y1: 0, x2: 1, y2: 0 },
  step: { x1: 1, y1: 0, x2: 1, y2: 0 },
  overshoot: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
  anticipate: { x1: 0.36, y1: -0.6, x2: 0.66, y2: 1 },
  bounce: { x1: 0.22, y1: 1.2, x2: 0.36, y2: 1 },
  elastic: { x1: 0.16, y1: 1.9, x2: 0.5, y2: 1 },
};

export function cubicBezierEase(t: number, h: BezierHandles): number {
  const x = clamp01(t);
  const s = bezierSolveT(h.x1, h.x2, x);
  const u = 1 - s;
  return 3 * u * u * s * h.y1 + 3 * u * s * s * h.y2 + s * s * s;
}

export function applyEase(t: number, ease: EaseName, handles?: BezierHandles): number {
  const x = clamp01(t);
  if (ease === 'hold' || ease === 'step') return x >= 1 ? 1 : 0;
  if (ease === 'linear' && !handles) return x;
  if (ease === 'bounce' && !handles) return bounceOut(x);
  if (ease === 'elastic' && !handles) return elasticOut(x);
  return cubicBezierEase(x, handles ?? EASE_CURVES[ease]);
}

/** Classic bounce-out, three diminishing impacts. */
export function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  let x = clamp01(t);
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) {
    x -= 1.5 / d;
    return n * x * x + 0.75;
  }
  if (x < 2.5 / d) {
    x -= 2.25 / d;
    return n * x * x + 0.9375;
  }
  x -= 2.625 / d;
  return n * x * x + 0.984375;
}

export function elasticOut(t: number): number {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  const p = 0.3;
  return 2 ** (-10 * x) * Math.sin(((x - p / 4) * (2 * Math.PI)) / p) + 1;
}

/**
 * Classify a sampled velocity profile.
 *
 * Returns which ease family the motion belongs to plus a confidence. The
 * animation validator uses this to answer "is this eased or is it linear
 * interpolation with a coat of paint?".
 */
export type EaseClass = {
  kind: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'irregular';
  confidence: number;
  /** Ratio of peak speed to mean speed. Linear motion sits at ~1. */
  peakToMean: number;
  /** Where the speed peaks, 0..1 through the move. */
  peakPosition: number;
};

export function classifyEase(values: readonly number[]): EaseClass {
  const n = values.length;
  if (n < 3) return { kind: 'hold', confidence: 1, peakToMean: 0, peakPosition: 0 };
  const speeds: number[] = [];
  for (let i = 1; i < n; i++) speeds.push(Math.abs(values[i] - values[i - 1]));
  const total = speeds.reduce((a, b) => a + b, 0);
  if (total < 1e-9) return { kind: 'hold', confidence: 1, peakToMean: 0, peakPosition: 0 };
  const meanSpeed = total / speeds.length;
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < speeds.length; i++) {
    if (speeds[i] > peak) {
      peak = speeds[i];
      peakIdx = i;
    }
  }
  const peakToMean = peak / Math.max(1e-9, meanSpeed);
  const peakPosition = speeds.length <= 1 ? 0.5 : peakIdx / (speeds.length - 1);

  // A linear ramp has near-constant speed: peak/mean close to 1.
  if (peakToMean < 1.22) {
    return { kind: 'linear', confidence: clamp01((1.22 - peakToMean) / 0.22), peakToMean, peakPosition };
  }
  const firstHalf = speeds.slice(0, Math.floor(speeds.length / 2)).reduce((a, b) => a + b, 0);
  const secondHalf = total - firstHalf;
  const bias = (secondHalf - firstHalf) / total;
  const strength = clamp01((peakToMean - 1.22) / 1.3);
  if (peakPosition > 0.3 && peakPosition < 0.7 && Math.abs(bias) < 0.18) {
    return { kind: 'easeInOut', confidence: strength, peakToMean, peakPosition };
  }
  if (bias > 0.12) return { kind: 'easeIn', confidence: strength, peakToMean, peakPosition };
  if (bias < -0.12) return { kind: 'easeOut', confidence: strength, peakToMean, peakPosition };
  return { kind: 'irregular', confidence: strength * 0.5, peakToMean, peakPosition };
}

/** True when the profile reads as deliberately eased rather than machine-lerped. */
export function isEased(values: readonly number[]): boolean {
  const c = classifyEase(values);
  return c.kind === 'easeIn' || c.kind === 'easeOut' || c.kind === 'easeInOut' || c.kind === 'hold';
}
