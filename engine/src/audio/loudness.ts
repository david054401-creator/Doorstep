/**
 * ITU-R BS.1770-4 loudness.
 *
 * Invariant 10 is stated in LUFS, so this is the real measurement: the
 * K-weighting pre-filter and RLB high-pass, mean square over 400ms blocks
 * with 75% overlap, absolute gating at -70 LUFS and relative gating at
 * -10 LU below the ungated level.
 */

import type { AudioBuffer } from './wav.ts';
import { applyBiquad, truePeak } from './wav.ts';
import type { Biquad } from './wav.ts';

/** Stage 1: high-shelf, modelling the acoustic effect of the head. */
export function shelvingFilter(sampleRate: number): Biquad {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/** Stage 2: RLB high-pass. */
export function highPassFilter(sampleRate: number): Biquad {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/** Per-channel weights: L, R, C = 1; surrounds = 1.41. */
const CHANNEL_WEIGHTS = [1, 1, 1, 1.41, 1.41];

export type LoudnessResult = {
  /** Integrated loudness in LUFS. */
  integrated: number;
  /** Loudness range in LU (a simple 10th-95th percentile of short-term). */
  range: number;
  /** True peak in dBTP. */
  truePeakDb: number;
  /** Peak momentary loudness, LUFS. */
  maxMomentary: number;
  /** Short-term loudness per 3-second window. */
  shortTerm: number[];
};

export function measureLoudness(audio: AudioBuffer): LoudnessResult {
  const sr = audio.sampleRate;
  const shelf = shelvingFilter(sr);
  const hp = highPassFilter(sr);
  const weighted = audio.channels.map((ch) => applyBiquad(applyBiquad(ch, shelf), hp));

  const blockSamples = Math.round(sr * 0.4);
  const step = Math.round(blockSamples / 4); // 75% overlap
  const blocks: number[] = [];
  const length = audio.length;

  for (let start = 0; start + blockSamples <= length; start += step) {
    let sum = 0;
    for (let c = 0; c < weighted.length; c++) {
      const w = CHANNEL_WEIGHTS[Math.min(c, CHANNEL_WEIGHTS.length - 1)];
      const ch = weighted[c];
      let s = 0;
      for (let i = start; i < start + blockSamples; i++) s += ch[i] * ch[i];
      sum += w * (s / blockSamples);
    }
    blocks.push(sum);
  }
  if (blocks.length === 0) {
    return { integrated: -Infinity, range: 0, truePeakDb: -Infinity, maxMomentary: -Infinity, shortTerm: [] };
  }

  const toLufs = (meanSquare: number): number =>
    meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;

  // Absolute gate at -70 LUFS.
  const absGated = blocks.filter((b) => toLufs(b) > -70);
  if (absGated.length === 0) {
    return { integrated: -Infinity, range: 0, truePeakDb: -Infinity, maxMomentary: -Infinity, shortTerm: [] };
  }
  const ungated = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  // Relative gate at -10 LU below the ungated level.
  const relativeThreshold = toLufs(ungated) - 10;
  const gated = absGated.filter((b) => toLufs(b) > relativeThreshold);
  const pool = gated.length ? gated : absGated;
  const integrated = toLufs(pool.reduce((a, b) => a + b, 0) / pool.length);

  // Short-term over 3-second windows.
  const stSamples = Math.round(sr * 3);
  const shortTerm: number[] = [];
  for (let start = 0; start + stSamples <= length; start += Math.round(sr)) {
    let sum = 0;
    for (let c = 0; c < weighted.length; c++) {
      const w = CHANNEL_WEIGHTS[Math.min(c, CHANNEL_WEIGHTS.length - 1)];
      const ch = weighted[c];
      let s = 0;
      for (let i = start; i < start + stSamples; i++) s += ch[i] * ch[i];
      sum += w * (s / stSamples);
    }
    shortTerm.push(toLufs(sum));
  }

  const sortedSt = shortTerm.filter(Number.isFinite).sort((a, b) => a - b);
  const range =
    sortedSt.length >= 2
      ? sortedSt[Math.floor(sortedSt.length * 0.95)] - sortedSt[Math.floor(sortedSt.length * 0.1)]
      : 0;

  const tp = truePeak(audio);
  return {
    integrated,
    range,
    truePeakDb: tp > 0 ? 20 * Math.log10(tp) : -Infinity,
    maxMomentary: Math.max(...blocks.map(toLufs)),
    shortTerm,
  };
}

/** Gain in dB needed to hit a loudness target. */
export function gainToTarget(current: number, targetLufs: number): number {
  if (!Number.isFinite(current)) return 0;
  return targetLufs - current;
}

/**
 * Spectral overlap between two signals in the dialogue band.
 *
 * Music that sits in 1-4kHz masks speech. This measures how much of the
 * music's energy lands where the dialogue lives.
 */
export function dialogueBandOverlap(
  dialogue: AudioBuffer,
  music: AudioBuffer,
  band: [number, number] = [1000, 4000],
): number {
  const bandEnergy = (audio: AudioBuffer): number => {
    const ch = audio.channels[0];
    if (!ch || ch.length < 2) return 0;
    // Goertzel over a handful of probe frequencies inside the band is
    // cheaper and steadier than a full FFT for a single-number answer.
    const probes = 12;
    let total = 0;
    for (let p = 0; p < probes; p++) {
      const f = band[0] + ((band[1] - band[0]) * p) / (probes - 1);
      total += goertzel(ch, audio.sampleRate, f);
    }
    return total / probes;
  };
  const d = bandEnergy(dialogue);
  const m = bandEnergy(music);
  if (d + m <= 0) return 0;
  return m / (d + m);
}

/** Goertzel magnitude at one frequency, normalised by length. */
export function goertzel(samples: Float32Array, sampleRate: number, frequency: number): number {
  const n = Math.min(samples.length, sampleRate * 4);
  if (n < 8) return 0;
  const k = Math.round((n * frequency) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const cosine = Math.cos(w);
  const coeff = 2 * cosine;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cosine;
  const imag = s2 * Math.sin(w);
  return Math.hypot(real, imag) / n;
}
