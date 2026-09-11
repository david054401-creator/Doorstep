/**
 * Identity validators.
 *
 * Invariant 2: similarity to the model-sheet view >= 0.85 on every key and
 * every twelfth frame. Long-horizon identity is the failure everyone
 * recognises — the character who is subtly a different character in every
 * shot — and the rig makes it mostly impossible. Mostly is not always,
 * which is why the gate exists.
 */

import type { Character, Shot, ViewName } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { identityDescriptor, cosineSimilarity } from '../critics/tier1/metrics.ts';
import type { EmbeddingProvider } from '../critics/types.ts';

const DEPT = 'character';

export type IdentityOptions = {
  /** Similarity floor. */
  threshold?: number;
  /** Check every Nth frame in addition to every key. */
  interval?: number;
  /** Learned embedding provider. When absent, the deterministic
   *  descriptor is used and the check says so. */
  embedding?: EmbeddingProvider;
};

const D = { threshold: 0.85, interval: 12 };

export type IdentityReference = {
  characterId: string;
  view: ViewName;
  descriptor: number[];
  /** Which provider produced the descriptor. */
  source: string;
};

/** Build the locked identity reference from an approved model-sheet render. */
export async function buildIdentityReference(
  character: Character,
  view: ViewName,
  sheetRender: ImageBuffer,
  embedding?: EmbeddingProvider,
): Promise<IdentityReference> {
  const descriptor = embedding
    ? await embedding.embed(sheetRender)
    : identityDescriptor(sheetRender);
  return {
    characterId: character.id,
    view,
    descriptor,
    source: embedding ? `${embedding.name}:${embedding.model}` : 'deterministic-descriptor',
  };
}

/**
 * Check identity across a shot's frames.
 *
 * `plates` must be per-character isolated renders on transparency, which
 * is what removes the background from the comparison — otherwise a change
 * of location reads as a change of character.
 */
export async function validateIdentity(
  shot: Shot,
  character: Character,
  reference: IdentityReference,
  plates: ReadonlyMap<number, ImageBuffer>,
  options: IdentityOptions = {},
): Promise<CheckResult[]> {
  const threshold = options.threshold ?? D.threshold;
  const interval = options.interval ?? D.interval;
  const where: Locator = { shotId: shot.id, characterId: character.id };

  const keyFrames = new Set(
    shot.keys.filter((k) => k.characterId === character.id).map((k) => k.frame),
  );
  for (let f = 0; f < shot.durationFrames; f += interval) keyFrames.add(f);

  const samples: { frame: number; similarity: number }[] = [];
  for (const frame of [...keyFrames].sort((a, b) => a - b)) {
    const plate = plates.get(frame);
    if (!plate) continue;
    const descriptor = options.embedding
      ? await options.embedding.embed(plate)
      : identityDescriptor(plate);
    samples.push({ frame, similarity: cosineSimilarity(reference.descriptor, descriptor) });
  }

  if (samples.length === 0) {
    return [
      fail({
        name: 'identity.similarity',
        department: DEPT,
        score: 0.5,
        severity: 'warn',
        message:
          'No rendered plates were available for this character, so identity could not be measured. This check is unmeasured, not passed.',
        diagnosis: 'identity.not_measured',
        where,
      }),
    ];
  }

  const worst = samples.reduce((a, b) => (b.similarity < a.similarity ? b : a));
  const usingLearned = !!options.embedding;

  return [
    measure({
      name: 'identity.similarity',
      department: DEPT,
      measured: worst.similarity,
      threshold,
      comparator: '>=',
      floor: 0.4,
      message:
        worst.similarity >= threshold
          ? `${character.name} stays on model across ${samples.length} sampled frames (worst similarity ${worst.similarity.toFixed(3)} at frame ${worst.frame}, measured with ${reference.source}).`
          : `${character.name} drifts off model at frame ${worst.frame}: similarity ${worst.similarity.toFixed(3)} against the approved ${reference.view} view, below the ${threshold} floor.`,
      diagnosis: 'identity.drift',
      where: { ...where, frame: worst.frame },
      evidence: [{ kind: 'frame', ref: `frame:${worst.frame}`, caption: 'Lowest identity similarity in the shot.' }],
    }),
    ...(usingLearned
      ? []
      : [
          pass({
            name: 'identity.metric_provenance',
            department: DEPT,
            score: 1,
            severity: 'info',
            message:
              'Identity was measured with the deterministic descriptor (gradient orientation, CIELAB histogram and shape moments), not a learned embedding. Configure an embedding provider to raise the ceiling on this check.',
            where,
          }),
        ]),
  ];
}

/** Identity drift across a whole sequence, shot to shot. */
export function validateIdentityAcrossShots(
  perShot: readonly { shotId: string; worstSimilarity: number }[],
  threshold = D.threshold,
  where: Locator = {},
): CheckResult {
  if (perShot.length === 0) {
    return pass({
      name: 'identity.sequence_consistency',
      department: DEPT,
      score: 1,
      message: 'No shots measured.',
      where,
    });
  }
  const worst = perShot.reduce((a, b) => (b.worstSimilarity < a.worstSimilarity ? b : a));
  const spread =
    Math.max(...perShot.map((s) => s.worstSimilarity)) -
    Math.min(...perShot.map((s) => s.worstSimilarity));
  return measure({
    name: 'identity.sequence_consistency',
    department: DEPT,
    measured: worst.worstSimilarity,
    threshold,
    comparator: '>=',
    floor: 0.4,
    message:
      worst.worstSimilarity >= threshold
        ? `Identity holds across all ${perShot.length} shots (worst ${worst.worstSimilarity.toFixed(3)}, spread ${spread.toFixed(3)}).`
        : `Identity drops to ${worst.worstSimilarity.toFixed(3)} in shot ${worst.shotId}; the character is not the same character across the sequence.`,
    diagnosis: 'identity.sequence_drift',
    where: { ...where, shotId: worst.shotId },
  });
}
