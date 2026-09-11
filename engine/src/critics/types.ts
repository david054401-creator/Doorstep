/**
 * The critic stack's contracts.
 *
 * Tier 0 deterministic checks live in `validators/`. Tier 1 perceptual
 * metrics live in `critics/tier1/`. This file defines the seams for the
 * learned models (embeddings, aesthetics, vision-language critics) so a
 * hosted or local model can be dropped in without touching the gates —
 * and so the absence of one is reported honestly rather than silently
 * passing a check.
 */

import type { CriticVerdict, Shot, StyleBible } from '../graph/types.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import type { CheckResult } from '../core/result.ts';

/** A learned image embedding (DINOv2, CLIP, or similar). */
export type EmbeddingProvider = {
  name: string;
  /** Model identifier, recorded in provenance. */
  model: string;
  embed(image: ImageBuffer): Promise<number[]>;
  /** Dimensionality, for sanity-checking a swapped provider. */
  dimensions: number;
};

/** A learned aesthetic scorer (PickScore, HPSv2, ImageReward, Q-Align). */
export type AestheticProvider = {
  name: string;
  model: string;
  score(image: ImageBuffer, prompt?: string): Promise<number>;
};

/** A learned perceptual distance (LPIPS and friends). */
export type PerceptualProvider = {
  name: string;
  model: string;
  distance(a: ImageBuffer, b: ImageBuffer): Promise<number>;
};

export type VlmImage = {
  image: ImageBuffer;
  /** Absolute frame number, so the critic can cite it. */
  frame: number;
  caption?: string;
};

export type VlmRequest = {
  /** The rubric the critic is bound to. */
  rubric: Rubric;
  images: VlmImage[];
  /** Context injected into every call: bible, intent, locked assets. */
  context: {
    styleBible?: StyleBible;
    shot?: Pick<Shot, 'id' | 'beats' | 'camera' | 'durationFrames'>;
    characterNames?: string[];
    extra?: Record<string, string>;
  };
};

/** A vision-language critic. Must cite frames; a verdict without one is inadmissible. */
export type VlmProvider = {
  name: string;
  model: string;
  critique(request: VlmRequest): Promise<CriticVerdict>;
};

export type Rubric = {
  id: string;
  department: string;
  /** What the critic is looking at. */
  title: string;
  /** The question, phrased so a wrong answer is falsifiable. */
  question: string;
  /** Explicit pass conditions. */
  passWhen: string[];
  /** Explicit fail conditions. The list the model actually scans for. */
  failWhen: string[];
  /** How many frames the critic should be shown. */
  frameCount: number;
  /** Diagnosis emitted on failure, routed through the repair table. */
  diagnosis: string;
  /** Severity of a failure from this rubric. */
  severity: CheckResult['severity'];
};

/**
 * A critic's calibration record.
 *
 * Design law: ship a critic only at >= 0.9 agreement on the "broken"
 * class, measured against a human-labelled set. Until then it advises; it
 * does not gate.
 */
export type Calibration = {
  rubricId: string;
  model: string;
  /** Number of labelled examples. */
  samples: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** Precision and recall on the "broken" class. */
  precision: number;
  recall: number;
  f1: number;
  /** Whether this critic is allowed to gate. */
  gating: boolean;
  measuredAt: string;
};

export type CriticRegistry = {
  embedding?: EmbeddingProvider;
  aesthetic?: AestheticProvider;
  perceptual?: PerceptualProvider;
  vlm: VlmProvider[];
  calibrations: Calibration[];
};

export function emptyRegistry(): CriticRegistry {
  return { vlm: [], calibrations: [] };
}

/** Is this critic calibrated well enough to block a gate? */
export function canGate(registry: CriticRegistry, rubricId: string, model: string): boolean {
  const c = registry.calibrations.find((x) => x.rubricId === rubricId && x.model === model);
  return !!c && c.gating;
}
