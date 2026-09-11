/**
 * Shot grammar.
 *
 * The 180-degree rule, screen direction, eyeline match, shot-size variety,
 * cut on action, minimum hold before a cut. These are the rules that make a
 * sequence read as directed rather than assembled, and they are all
 * checkable from the Film Graph's staging data without looking at a pixel.
 */

import type { Sequence, Shot, Scene, ShotSize, Placement, Point } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import { vsub, vcross, vnorm, vdot, clamp01 } from '../core/math.ts';
import { DEFAULT_FPS } from '../core/units.ts';

const DEPT = 'boards';

export type GrammarOptions = {
  fps?: number;
  /** Minimum frames a shot must hold before the cut. */
  minHoldFrames?: number;
  /** Minimum distinct shot sizes in a scene of three or more shots. */
  minSizeVariety?: number;
  /** Max fraction of shots in a scene that may share one size. */
  maxSameSizeRatio?: number;
  /** Eyeline tolerance, in degrees. */
  eyelineToleranceDeg?: number;
};

const D: Required<GrammarOptions> = {
  fps: DEFAULT_FPS,
  minHoldFrames: 8,
  minSizeVariety: 3,
  maxSameSizeRatio: 0.6,
  eyelineToleranceDeg: 28,
};

/** Which side of the action line a point sits on. */
export function sideOfLine(line: [Point, Point], p: Point): number {
  const d = vsub(line[1], line[0]);
  const v = vsub(p, line[0]);
  const c = vcross(d, v);
  return c > 0 ? 1 : c < 0 ? -1 : 0;
}

export function validateGrammar(
  sequence: Sequence,
  options: GrammarOptions = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  const out: CheckResult[] = [];
  for (const scene of sequence.scenes) {
    out.push(...validateSceneGrammar(scene, cfg));
  }
  return out;
}

export function validateSceneGrammar(scene: Scene, cfg: Required<GrammarOptions>): CheckResult[] {
  const out: CheckResult[] = [];
  const where: Locator = { sequenceId: scene.id };
  const shots = scene.shots;
  if (shots.length === 0) return out;

  // --- 180-degree rule ------------------------------------------------------
  // Two shots on the same subjects must keep the camera on the same side of
  // the action line, or the characters swap sides of frame and the audience
  // loses the geography.
  const violations: { shot: Shot; previous: Shot }[] = [];
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1];
    const b = shots[i];
    if (a.staging.characters.length < 2 || b.staging.characters.length < 2) continue;
    const shared = a.staging.characters
      .map((c) => c.characterId)
      .filter((id) => b.staging.characters.some((c) => c.characterId === id));
    if (shared.length < 2) continue;
    const orderA = screenOrder(a.staging.characters, shared);
    const orderB = screenOrder(b.staging.characters, shared);
    const flipped = orderA.join('|') !== orderB.join('|');
    const cameraCrossed = a.staging.cameraSide !== b.staging.cameraSide;
    if (flipped !== cameraCrossed) violations.push({ shot: b, previous: a });
  }
  out.push(
    violations.length === 0
      ? pass({
          name: 'grammar.180_degree_rule',
          department: DEPT,
          score: 1,
          message: 'The camera stays on one side of the action line throughout the scene.',
          where,
        })
      : fail({
          name: 'grammar.180_degree_rule',
          department: DEPT,
          score: Math.max(0, 1 - violations.length / shots.length),
          message: `Shot ${violations[0].shot.number} crosses the line from shot ${violations[0].previous.number}: the characters swap sides of frame with no camera move to justify it.`,
          diagnosis: 'grammar.crossed_the_line',
          where: { ...where, shotId: violations[0].shot.id },
        }),
  );

  // --- Screen direction -----------------------------------------------------
  const directionBreaks: Shot[] = [];
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1];
    const b = shots[i];
    if (a.staging.screenDirection === 'neutral' || b.staging.screenDirection === 'neutral') continue;
    if (a.staging.screenDirection !== b.staging.screenDirection && a.staging.cameraSide === b.staging.cameraSide) {
      directionBreaks.push(b);
    }
  }
  out.push(
    directionBreaks.length === 0
      ? pass({
          name: 'grammar.screen_direction',
          department: DEPT,
          score: 1,
          message: 'Screen direction is consistent across every cut in the scene.',
          where,
        })
      : fail({
          name: 'grammar.screen_direction',
          department: DEPT,
          score: Math.max(0, 1 - directionBreaks.length / shots.length),
          severity: 'warn',
          message: `Screen direction reverses at shot ${directionBreaks[0].number} without a reason; a character travelling right now appears to travel left.`,
          diagnosis: 'grammar.screen_direction_break',
          where: { ...where, shotId: directionBreaks[0].id },
        }),
  );

  // --- Eyeline match --------------------------------------------------------
  let worstEyeline = 0;
  let worstShot: Shot | undefined;
  for (const shot of shots) {
    for (const placement of shot.staging.characters) {
      const target = shot.staging.eyelines[placement.characterId];
      if (!target) continue;
      const gaze = vnorm(vsub(target, placement.position));
      if (gaze.x === 0 && gaze.y === 0) continue;
      const facing = { x: placement.facingRight ? 1 : -1, y: 0 };
      // The gaze must at least be on the side the body faces.
      const angle = (Math.acos(clamp01(Math.abs(vdot(gaze, facing)))) * 180) / Math.PI;
      const wrongSide = vdot(gaze, facing) < 0;
      const error = wrongSide ? 180 - angle : angle;
      if (error > worstEyeline) {
        worstEyeline = error;
        worstShot = shot;
      }
    }
  }
  out.push(
    measure({
      name: 'grammar.eyeline_match',
      department: DEPT,
      measured: worstEyeline,
      threshold: cfg.eyelineToleranceDeg,
      comparator: '<=',
      floor: 120,
      severity: 'warn',
      message:
        worstEyeline <= cfg.eyelineToleranceDeg
          ? `Eyelines point where the characters are looking (worst error ${worstEyeline.toFixed(0)} degrees).`
          : `A character's body faces one way and their eyeline points ${worstEyeline.toFixed(0)} degrees off it; they will read as looking past the person they are talking to.`,
      diagnosis: 'grammar.eyeline_mismatch',
      where: worstShot ? { ...where, shotId: worstShot.id } : where,
    }),
  );

  // --- Shot-size variety ----------------------------------------------------
  if (shots.length >= 3) {
    const counts = new Map<ShotSize, number>();
    for (const s of shots) counts.set(s.camera.size, (counts.get(s.camera.size) ?? 0) + 1);
    const distinct = counts.size;
    const dominant = Math.max(...counts.values()) / shots.length;
    out.push(
      measure({
        name: 'grammar.shot_size_variety',
        department: DEPT,
        measured: distinct,
        threshold: Math.min(cfg.minSizeVariety, shots.length),
        comparator: '>=',
        floor: 1,
        severity: 'warn',
        message:
          distinct >= Math.min(cfg.minSizeVariety, shots.length)
            ? `${distinct} distinct shot sizes across ${shots.length} shots.`
            : `Only ${distinct} shot size(s) across ${shots.length} shots. Flat coverage reads as cheap.`,
        diagnosis: 'grammar.flat_coverage',
        where,
      }),
    );
    out.push(
      measure({
        name: 'grammar.no_size_monotony',
        department: DEPT,
        measured: dominant,
        threshold: cfg.maxSameSizeRatio,
        comparator: '<=',
        floor: 1,
        severity: 'warn',
        message:
          dominant <= cfg.maxSameSizeRatio
            ? 'No single shot size dominates the scene.'
            : `${(dominant * 100).toFixed(0)}% of the scene is the same shot size.`,
        diagnosis: 'grammar.size_monotony',
        where,
      }),
    );
  }

  // --- Minimum hold before a cut -------------------------------------------
  const tooShort = shots.filter((s) => s.durationFrames < cfg.minHoldFrames);
  out.push(
    tooShort.length === 0
      ? pass({
          name: 'grammar.minimum_hold',
          department: DEPT,
          score: 1,
          message: `Every shot holds at least ${cfg.minHoldFrames} frames before the cut.`,
          where,
        })
      : fail({
          name: 'grammar.minimum_hold',
          department: DEPT,
          score: Math.max(0, 1 - tooShort.length / shots.length),
          severity: 'warn',
          message: `${tooShort.length} shot(s) are shorter than ${cfg.minHoldFrames} frames; the audience cannot read them.`,
          diagnosis: 'grammar.shot_too_short',
          where: { ...where, shotId: tooShort[0].id },
        }),
  );

  // --- Cut on action --------------------------------------------------------
  // A cut lands best mid-movement. A shot that ends on a long dead hold and
  // then cuts is the "assembled, not directed" tell.
  const deadCuts = shots.filter((s, i) => {
    if (i === shots.length - 1) return false;
    const tail = s.beats.reduce((a, b) => Math.max(a, b.startFrame + b.durationFrames), 0);
    return s.durationFrames - tail > cfg.fps * 0.9;
  });
  out.push(
    deadCuts.length === 0
      ? pass({
          name: 'grammar.cut_on_action',
          department: DEPT,
          score: 1,
          message: 'No shot sits dead for a beat before its cut.',
          where,
        })
      : fail({
          name: 'grammar.cut_on_action',
          department: DEPT,
          score: Math.max(0, 1 - deadCuts.length / shots.length),
          severity: 'warn',
          message: `${deadCuts.length} shot(s) hold still for close to a second before cutting. Cut on the movement instead.`,
          diagnosis: 'grammar.dead_tail',
          where: { ...where, shotId: deadCuts[0].id },
        }),
  );

  return out;
}

function screenOrder(placements: readonly Placement[], ids: readonly string[]): string[] {
  return placements
    .filter((p) => ids.includes(p.characterId))
    .sort((a, b) => a.position.x - b.position.x)
    .map((p) => p.characterId);
}

/**
 * Suggested next shot size, given what came before. Used by the repair move
 * that fixes flat coverage.
 */
export function nextSize(previous: ShotSize | undefined, hasDialogue: boolean): ShotSize {
  const order: ShotSize[] = ['els', 'ls', 'mls', 'ms', 'mcu', 'cu'];
  if (!previous) return hasDialogue ? 'ms' : 'ls';
  const i = order.indexOf(previous);
  if (i < 0) return 'ms';
  // Move two steps rather than one: adjacent sizes read as a jump cut.
  const step = hasDialogue ? 2 : -2;
  return order[Math.max(0, Math.min(order.length - 1, i + step))];
}
