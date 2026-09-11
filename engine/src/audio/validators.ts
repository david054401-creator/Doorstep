/**
 * Audio validators.
 *
 * Invariant 9: viseme-phoneme offset within two frames at 24fps.
 * Invariant 10: loudness on target, STT round-trip >= 95%, no clipping,
 * music not masking dialogue.
 *
 * The STT round-trip needs a speech-recognition provider; without one the
 * check reports honestly that it could not run rather than silently
 * passing. A check that cannot run is not a check that passed.
 */

import type { Shot, DeliverySpec, Line } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import type { AudioBuffer } from './wav.ts';
import { peak, truePeak, envelope } from './wav.ts';
import { measureLoudness, dialogueBandOverlap, gainToTarget } from './loudness.ts';
import { lipsyncOffset } from '../animation/lipsync.ts';
import { DEFAULT_FPS } from '../core/units.ts';

const DEPT = 'audio';

export type AudioValidationOptions = {
  fps?: number;
  /** Allowed deviation from the loudness target, in LU. */
  loudnessTolerance?: number;
  /** Max true peak in dBTP. */
  maxTruePeakDb?: number;
  /** Max lipsync offset in frames. */
  maxLipsyncOffsetFrames?: number;
  /** Minimum word match for the speech round-trip, 0..1. */
  minTranscriptMatch?: number;
  /** Max share of dialogue-band energy the music may occupy. */
  maxMusicMasking?: number;
};

const D: Required<AudioValidationOptions> = {
  fps: DEFAULT_FPS,
  loudnessTolerance: 1,
  maxTruePeakDb: -1,
  maxLipsyncOffsetFrames: 2,
  minTranscriptMatch: 0.95,
  maxMusicMasking: 0.55,
};

/** Lipsync: the offset invariant, measured per line. */
export function validateLipsync(
  shot: Shot,
  options: AudioValidationOptions = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  const where: Locator = { shotId: shot.id };
  if (shot.dialogue.length === 0) {
    return [
      pass({
        name: 'audio.lipsync_offset',
        department: DEPT,
        score: 1,
        message: 'No dialogue in this shot.',
        where,
      }),
    ];
  }
  const missing = shot.dialogue.filter((l) => !l.visemes || l.visemes.length === 0);
  if (missing.length) {
    return [
      fail({
        name: 'audio.lipsync_present',
        department: DEPT,
        score: 0,
        message: `${missing.length} line(s) have no viseme track; the mouth will not move.`,
        diagnosis: 'audio.missing_visemes',
        where,
      }),
    ];
  }
  let worst = 0;
  let worstLine: Line | undefined;
  for (const line of shot.dialogue) {
    const o = lipsyncOffset(line);
    if (o > worst) {
      worst = o;
      worstLine = line;
    }
  }
  const scaled = cfg.maxLipsyncOffsetFrames * (cfg.fps / 24);
  return [
    measure({
      name: 'audio.lipsync_offset',
      department: DEPT,
      measured: worst,
      threshold: scaled,
      comparator: '<=',
      floor: scaled * 4,
      message:
        worst <= scaled
          ? `Every viseme lands within ${worst.toFixed(1)} frames of its phoneme.`
          : `A viseme is ${worst.toFixed(1)} frames off its phoneme (limit ${scaled}); the mouth will read as out of sync.`,
      diagnosis: 'audio.lipsync_drift',
      where: worstLine ? { ...where, path: worstLine.id } : where,
    }),
  ];
}

/** Loudness, peak and headroom against the delivery spec. */
export function validateMix(
  mix: AudioBuffer,
  delivery: DeliverySpec,
  options: AudioValidationOptions = {},
  where: Locator = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  const m = measureLoudness(mix);
  const out: CheckResult[] = [];

  const deviation = Math.abs(m.integrated - delivery.loudnessTargetLufs);
  out.push(
    measure({
      name: 'audio.loudness_on_target',
      department: DEPT,
      measured: deviation,
      threshold: cfg.loudnessTolerance,
      comparator: '<=',
      floor: cfg.loudnessTolerance * 8,
      message:
        deviation <= cfg.loudnessTolerance
          ? `Integrated loudness ${m.integrated.toFixed(2)} LUFS, on the ${delivery.loudnessTargetLufs} LUFS target.`
          : `Integrated loudness ${m.integrated.toFixed(2)} LUFS misses the ${delivery.loudnessTargetLufs} LUFS target by ${deviation.toFixed(2)} LU. Apply ${gainToTarget(m.integrated, delivery.loudnessTargetLufs).toFixed(2)} dB.`,
      diagnosis: 'audio.loudness_off_target',
      where,
    }),
  );

  out.push(
    measure({
      name: 'audio.no_clipping',
      department: DEPT,
      measured: m.truePeakDb,
      threshold: cfg.maxTruePeakDb,
      comparator: '<=',
      floor: 3,
      severity: 'error',
      message:
        m.truePeakDb <= cfg.maxTruePeakDb
          ? `True peak ${m.truePeakDb.toFixed(2)} dBTP, inside the ${cfg.maxTruePeakDb} dBTP ceiling.`
          : `True peak ${m.truePeakDb.toFixed(2)} dBTP exceeds the ${cfg.maxTruePeakDb} dBTP ceiling; the mix will clip on delivery.`,
      diagnosis: 'audio.clipping',
      where,
    }),
  );

  // Digital-domain clipping, which true peak alone can miss on a hot mix.
  const p = peak(mix);
  out.push(
    p < 0.999
      ? pass({
          name: 'audio.no_sample_clipping',
          department: DEPT,
          score: 1,
          message: `Peak sample ${p.toFixed(4)}; nothing is pinned to full scale.`,
          where,
        })
      : fail({
          name: 'audio.no_sample_clipping',
          department: DEPT,
          score: 0,
          message: 'Samples are pinned at full scale; the mix is clipped in the digital domain.',
          diagnosis: 'audio.clipping',
          where,
        }),
  );

  out.push(
    measure({
      name: 'audio.loudness_range',
      department: DEPT,
      measured: m.range,
      threshold: 18,
      comparator: '<=',
      floor: 30,
      severity: 'warn',
      message: `Loudness range ${m.range.toFixed(1)} LU${m.range > 18 ? ' — the mix swings widely and quiet dialogue may be lost.' : '.'}`,
      diagnosis: 'audio.wide_loudness_range',
      where,
    }),
  );

  return out;
}

/** Music must not sit on top of the dialogue band. */
export function validateDucking(
  dialogue: AudioBuffer,
  music: AudioBuffer,
  options: AudioValidationOptions = {},
  where: Locator = {},
): CheckResult {
  const cfg = { ...D, ...options };
  const overlap = dialogueBandOverlap(dialogue, music);
  return measure({
    name: 'audio.music_not_masking',
    department: DEPT,
    measured: overlap,
    threshold: cfg.maxMusicMasking,
    comparator: '<=',
    floor: 1,
    message:
      overlap <= cfg.maxMusicMasking
        ? `Music occupies ${(overlap * 100).toFixed(0)}% of the 1-4 kHz energy; dialogue stays clear.`
        : `Music occupies ${(overlap * 100).toFixed(0)}% of the 1-4 kHz band where speech lives. Duck it under the lines.`,
    diagnosis: 'audio.music_masks_dialogue',
    where,
  });
}

/**
 * Speech round-trip.
 *
 * The honest version: without a recognition provider this reports that it
 * could not run. A check that silently passes when it cannot measure
 * anything is worse than no check at all.
 */
export type Transcriber = (audio: AudioBuffer) => Promise<string> | string;

export async function validateIntelligibility(
  mix: AudioBuffer,
  expectedText: string,
  transcriber: Transcriber | undefined,
  options: AudioValidationOptions = {},
  where: Locator = {},
): Promise<CheckResult> {
  const cfg = { ...D, ...options };
  if (!transcriber) {
    return fail({
      name: 'audio.intelligibility',
      department: DEPT,
      score: 0.5,
      severity: 'warn',
      message:
        'No speech-recognition provider is configured, so the transcript round-trip could not be run. This check is unmeasured, not passed.',
      diagnosis: 'audio.no_transcriber',
      where,
    });
  }
  const heard = await transcriber(mix);
  const match = wordMatchRatio(expectedText, heard);
  return measure({
    name: 'audio.intelligibility',
    department: DEPT,
    measured: match,
    threshold: cfg.minTranscriptMatch,
    comparator: '>=',
    floor: 0.4,
    message:
      match >= cfg.minTranscriptMatch
        ? `Speech round-trip matches the script at ${(match * 100).toFixed(1)}%.`
        : `Speech round-trip only matches the script at ${(match * 100).toFixed(1)}%; the dialogue is not intelligible in the mix. Heard: "${heard.slice(0, 80)}".`,
    diagnosis: 'audio.unintelligible',
    where,
  });
}

/** Word-level agreement between two transcripts, order-sensitive. */
export function wordMatchRatio(expected: string, actual: string): number {
  const norm = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = norm(expected);
  const b = norm(actual);
  if (a.length === 0) return 1;
  // Longest common subsequence: word order matters in a transcript.
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length] / a.length;
}

/** Silence-gap sanity: long dead air inside a shot is usually a mistake. */
export function validateSilenceGaps(
  mix: AudioBuffer,
  maxGapSeconds = 2.5,
  where: Locator = {},
): CheckResult {
  const window = Math.round(mix.sampleRate * 0.05);
  const env = envelope(mix, window);
  const threshold = 0.005;
  let longest = 0;
  let run = 0;
  let at = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] < threshold) {
      run++;
      if (run > longest) {
        longest = run;
        at = i - run;
      }
    } else run = 0;
  }
  const seconds = (longest * window) / mix.sampleRate;
  return measure({
    name: 'audio.no_dead_air',
    department: DEPT,
    measured: seconds,
    threshold: maxGapSeconds,
    comparator: '<=',
    floor: maxGapSeconds * 4,
    severity: 'warn',
    message:
      seconds <= maxGapSeconds
        ? `Longest silence ${seconds.toFixed(2)}s.`
        : `${seconds.toFixed(1)}s of silence starting at ${((at * window) / mix.sampleRate).toFixed(1)}s — the track goes dead.`,
    diagnosis: 'audio.dead_air',
    where,
  });
}

/** A/V sync: the audio must be exactly as long as the picture. */
export function validateAvSync(
  mix: AudioBuffer,
  totalFrames: number,
  fps: number,
  where: Locator = {},
): CheckResult {
  const expectedSeconds = totalFrames / fps;
  const actualSeconds = mix.length / mix.sampleRate;
  const drift = Math.abs(actualSeconds - expectedSeconds) * fps;
  return measure({
    name: 'delivery.av_sync',
    department: 'delivery',
    measured: drift,
    threshold: 1,
    comparator: '<=',
    floor: 12,
    severity: 'error',
    message:
      drift <= 1
        ? `Audio and picture agree to within ${drift.toFixed(2)} frames.`
        : `Audio runs ${drift.toFixed(1)} frames ${actualSeconds > expectedSeconds ? 'longer' : 'shorter'} than picture.`,
    diagnosis: 'delivery.av_drift',
    where,
  });
}

export { truePeak };
