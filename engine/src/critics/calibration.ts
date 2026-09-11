/**
 * Critic calibration.
 *
 * "Ship a critic only at >= 0.9 agreement on the broken class." That is a
 * measurement, not an intention, so this is the harness that measures it:
 * a labelled set in, precision and recall on the "broken" class out, and a
 * gating flag that the ensemble actually honours.
 *
 * An uncalibrated critic is not banned — it advises. It just cannot block.
 */

import type { Calibration, VlmProvider, VlmRequest, Rubric, CriticRegistry } from './types.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import type { Logger } from '../core/log.ts';
import { silentLogger } from '../core/log.ts';

export type LabelledExample = {
  id: string;
  images: { image: ImageBuffer; frame: number }[];
  /** Ground truth from a human: is this broken? */
  broken: boolean;
  /** Why the human called it broken. Used to audit the critic's rationale. */
  reason?: string;
  context?: VlmRequest['context'];
};

export type CalibrationOptions = {
  /** Minimum precision on the broken class before a critic may gate. */
  minPrecision?: number;
  /** Minimum recall on the broken class before a critic may gate. */
  minRecall?: number;
  logger?: Logger;
  /** Treat "uncertain" as a miss rather than a false negative. */
  uncertainCountsAs?: 'miss' | 'abstain';
};

const DEFAULTS = { minPrecision: 0.9, minRecall: 0.9 };

/**
 * Run a critic across a labelled set and measure it.
 *
 * The set should be at least a couple of hundred frames, half of them
 * genuinely broken, labelled by the person whose taste the engine is
 * meant to encode.
 */
export async function calibrateCritic(
  provider: VlmProvider,
  rubric: Rubric,
  examples: readonly LabelledExample[],
  options: CalibrationOptions = {},
): Promise<Calibration & { perExample: { id: string; expected: boolean; got: string; correct: boolean }[] }> {
  const log = (options.logger ?? silentLogger()).child('critic.calibration', {
    rubric: rubric.id,
    model: provider.model,
  });
  const minPrecision = options.minPrecision ?? DEFAULTS.minPrecision;
  const minRecall = options.minRecall ?? DEFAULTS.minRecall;
  const abstain = options.uncertainCountsAs === 'abstain';

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let abstained = 0;
  const perExample: { id: string; expected: boolean; got: string; correct: boolean }[] = [];

  for (const example of examples) {
    const verdict = await provider.critique({
      rubric,
      images: example.images,
      context: example.context ?? {},
    });
    const saidBroken = verdict.verdict === 'fail';
    const unsure = verdict.verdict === 'uncertain';
    if (unsure && abstain) {
      abstained++;
      perExample.push({ id: example.id, expected: example.broken, got: 'uncertain', correct: false });
      continue;
    }
    if (example.broken && saidBroken) tp++;
    else if (!example.broken && saidBroken) fp++;
    else if (!example.broken && !saidBroken) tn++;
    else fn++;
    perExample.push({
      id: example.id,
      expected: example.broken,
      got: verdict.verdict,
      correct: example.broken === saidBroken,
    });
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const gating = precision >= minPrecision && recall >= minRecall && tp + fn >= 20;

  log.info('calibration complete', {
    samples: examples.length,
    precision: precision.toFixed(3),
    recall: recall.toFixed(3),
    gating,
    abstained,
  });

  return {
    rubricId: rubric.id,
    model: provider.model,
    samples: examples.length,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    gating,
    measuredAt: new Date().toISOString(),
    perExample,
  };
}

/** Merge a calibration into a registry, replacing any previous record. */
export function withCalibration(registry: CriticRegistry, calibration: Calibration): CriticRegistry {
  return {
    ...registry,
    calibrations: [
      ...registry.calibrations.filter(
        (c) => !(c.rubricId === calibration.rubricId && c.model === calibration.model),
      ),
      calibration,
    ],
  };
}

/**
 * A human-readable calibration report.
 *
 * The point of the report is that a critic's authority is visible: anyone
 * looking at a score sheet can see whether the critic that blocked their
 * shot has earned the right to.
 */
export function formatCalibration(c: Calibration): string {
  const lines: string[] = [];
  lines.push(`Critic: ${c.model} on rubric "${c.rubricId}"`);
  lines.push(`Labelled examples: ${c.samples}`);
  lines.push(
    `Broken class — precision ${(c.precision * 100).toFixed(1)}%, recall ${(c.recall * 100).toFixed(1)}%, F1 ${(c.f1 * 100).toFixed(1)}%`,
  );
  lines.push(`Confusion: TP ${c.truePositives}  FP ${c.falsePositives}  TN ${c.trueNegatives}  FN ${c.falseNegatives}`);
  lines.push(
    c.gating
      ? 'Status: CALIBRATED — this critic may block a gate.'
      : 'Status: ADVISORY — below the 0.9 bar on the broken class, so its findings are reported but cannot block.',
  );
  lines.push(`Measured: ${c.measuredAt}`);
  return lines.join('\n');
}

/**
 * Threshold sweep for a numeric metric against the same labelled set.
 *
 * Used to re-fit a tier-1 threshold (warp error, perceptual distance,
 * identity similarity) to your own footage rather than to a number
 * someone published for a different corpus.
 */
export function sweepThreshold(
  samples: readonly { value: number; broken: boolean }[],
  options: { direction?: 'higherIsBroken' | 'lowerIsBroken'; steps?: number } = {},
): { threshold: number; precision: number; recall: number; f1: number }[] {
  if (samples.length === 0) return [];
  const higher = (options.direction ?? 'higherIsBroken') === 'higherIsBroken';
  const steps = options.steps ?? 64;
  const values = samples.map((s) => s.value).sort((a, b) => a - b);
  const lo = values[0];
  const hi = values[values.length - 1];
  const out: { threshold: number; precision: number; recall: number; f1: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const s of samples) {
      const flagged = higher ? s.value >= t : s.value <= t;
      if (s.broken && flagged) tp++;
      else if (!s.broken && flagged) fp++;
      else if (s.broken && !flagged) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    out.push({ threshold: t, precision, recall, f1 });
  }
  return out;
}

/** The threshold that maximises F1 on the broken class. */
export function bestThreshold(
  samples: readonly { value: number; broken: boolean }[],
  options: { direction?: 'higherIsBroken' | 'lowerIsBroken' } = {},
): { threshold: number; precision: number; recall: number; f1: number } | null {
  const sweep = sweepThreshold(samples, options);
  if (sweep.length === 0) return null;
  return sweep.reduce((a, b) => (b.f1 > a.f1 ? b : a));
}
