/**
 * THE TWELVE PRINCIPLES, AS METRICS
 *
 * Taste is code (design law 4 of the Director's Brain). Every principle
 * below is a number computed from the Film Graph and the posed rig — not a
 * vibe, not a model's opinion. A VLM critic may later disagree with a
 * passing score, and that disagreement is itself signal, but nothing ships
 * on an opinion alone.
 *
 *  1 Squash & stretch  — area product conserved inside tagged S&S
 *  2 Anticipation      — reverse-direction motion before a major action
 *  3 Staging           — silhouette reads; framing and eyeline rules
 *  4 Pose to pose      — keys and breakdowns explicit in the graph
 *  5 Follow through    — appendage phase lag of 2-6 frames
 *  6 Slow in/slow out  — velocity profile classifies as eased
 *  7 Arcs              — end-effector paths fit a smooth curve, R2 >= 0.95
 *  8 Secondary action  — secondary channels move during holds
 *  9 Timing            — frame counts per action class inside known ranges
 * 10 Exaggeration      — pose deviation from neutral at emotional peaks
 * 11 Solid drawing     — proportion consistency; no twinning
 * 12 Appeal            — silhouette clarity, asymmetry, negative space
 */

import type { Shot, Character, Project, Channel } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import type { EvaluatedFrame } from '../animation/evaluate.ts';
import { effectorPath, partAreaTrack } from '../animation/evaluate.ts';
import {
  fitArc,
  splitAtReversals,
  mean,
  stddev,
  derivative,
  wrapAngle,
  clamp01,
  vdist,
} from '../core/math.ts';
import { classifyEase } from '../timing/easing.ts';
import { sampleChannel, hitchFrames, evaluateChannel } from '../timing/curves.ts';
import { measureLag, hasMotion } from '../animation/secondary.ts';
import { isHeld, holdFraction, rangeFor, twosFraction } from '../timing/chart.ts';
import { silhouetteStats } from '../geom/silhouette.ts';
import { actionClassFor } from '../animation/blocking.ts';
import { DEFAULT_FPS } from '../core/units.ts';

const DEPT = 'animation';

export type PrincipleOptions = {
  fps?: number;
  /** Arcs: minimum R-squared on end-effector paths. */
  arcR2?: number;
  /** Volume: max per-frame part-area drift outside tagged squash/stretch. */
  volumePerFrame?: number;
  /** Squash/stretch: max width x height product error inside tagged ranges. */
  squashProduct?: number;
  /** Overlap: allowed phase-lag window, in frames. */
  lagWindow?: [number, number];
  /** Twinning: max allowed left/right symmetry score. */
  maxTwinning?: number;
  /** Foot slide: max foot speed during a contact, in px/frame. */
  footSlide?: number;
  /** Minimum silhouette solidity at a key pose. */
  minKeySolidity?: number;
  /** Minimum pose deviation at an emotional peak, in radians. */
  minPeakDeviation?: number;
  /**
   * The same shot evaluated with additive layers off. Arcs, twinning and
   * foot contact are judged against the authored action; breath and blink
   * jitter are deliberately not smooth and would fail an arc test that has
   * no business looking at them.
   */
  primaryFrames?: readonly EvaluatedFrame[];
};

/**
 * Options with every threshold resolved. `primaryFrames` stays optional:
 * it is a second evaluation of the shot, not a threshold, and there is
 * nothing sensible to default it to.
 */
export type ResolvedPrincipleOptions = Required<Omit<PrincipleOptions, 'primaryFrames'>> &
  Pick<PrincipleOptions, 'primaryFrames'>;

const D: Required<Omit<PrincipleOptions, 'primaryFrames'>> = {
  fps: DEFAULT_FPS,
  arcR2: 0.95,
  volumePerFrame: 0.03,
  squashProduct: 0.05,
  lagWindow: [2, 6],
  maxTwinning: 0.88,
  footSlide: 1.6,
  minKeySolidity: 0.3,
  minPeakDeviation: 0.12,
};

/** Bones whose tips are treated as end effectors for arc analysis. */
const EFFECTORS = ['L_hand', 'R_hand', 'L_foot', 'R_foot', 'head'];
const FOOT_BONES = ['L_foot', 'R_foot'];
const MIRROR_PAIRS: [string, string][] = [
  ['L_upperarm', 'R_upperarm'],
  ['L_forearm', 'R_forearm'],
  ['L_hand', 'R_hand'],
  ['L_thigh', 'R_thigh'],
  ['L_shin', 'R_shin'],
  ['L_foot', 'R_foot'],
];

export function validatePrinciples(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  project: Pick<Project, 'characters'>,
  options: PrincipleOptions = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  // Performance-level metrics read the authored track when one is supplied.
  const performance = options.primaryFrames ?? frames;
  const out: CheckResult[] = [];
  const where: Locator = { shotId: shot.id };
  if (frames.length === 0) {
    return [
      fail({
        name: 'animation.has_frames',
        department: DEPT,
        score: 0,
        severity: 'fatal',
        message: 'The shot evaluated to zero frames; nothing can be measured.',
        diagnosis: 'animation.empty',
        where,
      }),
    ];
  }

  const characterIds = [...new Set(shot.staging.characters.map((c) => c.characterId))];
  const charById = new Map(project.characters.map((c) => [c.id, c]));

  out.push(...checkPoseToPose(shot, where));
  out.push(...checkArcs(shot, performance, characterIds, cfg, where, project));
  out.push(...checkVolume(shot, frames, characterIds, charById, cfg, where));
  out.push(...checkEases(shot, cfg, where));
  out.push(...checkAnticipation(shot, cfg, where));
  out.push(...checkOverlap(shot, cfg, where, boneParents(project, characterIds)));
  out.push(...checkSecondaryDuringHolds(shot, cfg, where));
  out.push(...checkTiming(shot, cfg, where));
  out.push(...checkTwinning(shot, performance, characterIds, cfg, where));
  out.push(...checkFootSlide(shot, performance, characterIds, cfg, where));
  out.push(...checkHitches(shot, where));
  out.push(...checkStagingAndAppeal(shot, frames, characterIds, cfg, where));
  out.push(...checkExaggeration(shot, cfg, where));
  out.push(...checkProportions(shot, frames, characterIds, charById, where));
  return out;
}

// --- 4. Pose to pose -------------------------------------------------------

function checkPoseToPose(shot: Shot, where: Locator): CheckResult[] {
  const keys = shot.keys.filter((k) => k.kind === 'key' || k.kind === 'extreme');
  const breakdowns = shot.keys.filter((k) => k.kind === 'breakdown');
  const missingIntent = keys.filter((k) => !k.intent.trim());
  const checks: CheckResult[] = [];

  checks.push(
    measure({
      name: 'principle.pose_to_pose',
      department: DEPT,
      measured: keys.length,
      threshold: Math.max(1, shot.beats.length),
      comparator: '>=',
      floor: 0,
      message:
        keys.length >= shot.beats.length
          ? `${keys.length} key pose(s) and ${breakdowns.length} breakdown(s) are explicit in the graph.`
          : `Only ${keys.length} key pose(s) for ${shot.beats.length} beat(s): the shot is being interpolated rather than posed.`,
      diagnosis: 'animation.missing_keys',
      where,
    }),
  );

  checks.push(
    missingIntent.length === 0
      ? pass({
          name: 'principle.keys_have_intent',
          department: DEPT,
          score: 1,
          message: 'Every key pose states what it is for.',
          where,
        })
      : fail({
          name: 'principle.keys_have_intent',
          department: DEPT,
          score: 1 - missingIntent.length / Math.max(1, keys.length),
          severity: 'warn',
          message: `${missingIntent.length} key pose(s) have no stated intent.`,
          diagnosis: 'animation.key_without_intent',
          where: { ...where, frame: missingIntent[0].frame },
        }),
  );
  return checks;
}

// --- 7. Arcs ---------------------------------------------------------------

function checkArcs(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
  project: Pick<Project, 'characters'>,
): CheckResult[] {
  let worst = 1;
  let worstWhere: Locator = where;
  let measured = 0;

  // Arcs are a property of one action, not of a whole shot. A head that
  // drops on a sad beat and lifts on the next has two clean arcs and one
  // deliberate change of direction between them; fitting a single curve
  // across both would call good animation broken. So each span between
  // consecutive key poses is judged on its own.
  const spansFor = (id: string): [number, number][] => {
    const keyFrames = [
      ...new Set(
        shot.keys
          .filter((k) => k.characterId === id && (k.kind === 'key' || k.kind === 'extreme'))
          .map((k) => k.frame),
      ),
    ].sort((a, b) => a - b);
    // Spans run from the start of the shot, or from one key, into the
    // next key. The tail after the last key is a hold and a settle, not a
    // move: checking the arc of a hold is a category error, and it is the
    // only place this measure ever produced a finding no animator would
    // recognise.
    const bounds = [0, ...keyFrames].filter(
      (f, i, arr) => f >= 0 && f < frames.length && arr.indexOf(f) === i,
    );
    if (keyFrames.length === 0) bounds.push(frames.length - 1);
    const out: [number, number][] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (bounds[i + 1] - bounds[i] >= 5) out.push([bounds[i], bounds[i + 1]]);
    }
    return out;
  };

  for (const id of characterIds) {
    const spans = spansFor(id);
    // An arc is a property of a move. Scale the bar by the character:
    // a quarter of a head unit of travel is the least that can be called
    // a gesture, and below it the "path" is a settle or a drift whose
    // shape carries no intent and would only measure numerical noise.
    const headPx =
      project.characters.find((c) => c.id === id)?.modelSheet.construction.headHeightPx ?? 120;
    const minTravel = Math.max(12, headPx * 0.3);
    for (const bone of EFFECTORS) {
      const full = effectorPath(frames, id, bone);
      if (full.length < 6) continue;
      for (const [from, to] of spans) {
        const path = full.slice(from, to + 1);
        if (path.length < 6) continue;
        // A reach that goes out and comes back is two arcs plus one
        // deliberate change of direction. Judge each run separately.
        for (const run of splitAtReversals(path)) {
          if (run.length < 5) continue;
          // Only judge stretches where the effector actually travelled; a
          // bone that barely moves has no arc and would score noise.
          const travel = run.reduce((a, p, i) => (i ? a + vdist(run[i - 1], p) : 0), 0);
          if (travel < minTravel) continue;
          measured++;
          const fit = fitArc(run, 3);
          if (fit.r2 < worst) {
            worst = fit.r2;
            worstWhere = { ...where, characterId: id, boneId: bone, frameRange: [from, to] };
          }
        }
      }
    }
  }
  if (measured === 0) {
    return [
      pass({
        name: 'principle.arcs',
        department: DEPT,
        score: 1,
        message: 'No end effector travels far enough in this shot for arcs to apply.',
        where,
      }),
    ];
  }
  return [
    measure({
      name: 'principle.arcs',
      department: DEPT,
      measured: worst,
      threshold: cfg.arcR2,
      comparator: '>=',
      floor: 0.6,
      message:
        worst >= cfg.arcR2
          ? `End effectors follow smooth arcs (worst fit R2 ${worst.toFixed(3)} across ${measured} paths).`
          : `An end effector travels on a broken path (R2 ${worst.toFixed(3)}, needs ${cfg.arcR2}) — the motion reads as straight-line interpolation, not as animation.`,
      diagnosis: 'animation.broken_arc',
      where: worstWhere,
    }),
  ];
}

// --- 1. Squash and stretch, plus per-frame volume --------------------------

function checkVolume(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  charById: Map<string, Character>,
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  let worstDrift = 0;
  let worstWhere: Locator = where;

  for (const id of characterIds) {
    const rig = charById.get(id)?.rig;
    if (!rig) continue;
    const view = shot.staging.characters.find((c) => c.characterId === id)?.view;
    // Swap-set parts appear and vanish by design — a mouth shape going from
    // full area to zero when the viseme changes is the feature, not a pop.
    // Only continuously-present geometry is held to the volume invariant.
    const parts = rig.parts.filter((p) => p.view === view && !p.swapSet);
    for (const part of parts) {
      const track = partAreaTrack(frames, id, part.id);
      for (let f = 1; f < track.length; f++) {
        const a = track[f - 1];
        if (a < 1) continue;
        const drift = Math.abs(track[f] - a) / a;
        if (drift > worstDrift) {
          worstDrift = drift;
          worstWhere = { ...where, characterId: id, partId: part.id, frame: f };
        }
      }
    }
  }

  return [
    measure({
      name: 'principle.volume_per_frame',
      department: DEPT,
      measured: worstDrift,
      threshold: cfg.volumePerFrame,
      comparator: '<=',
      floor: cfg.volumePerFrame * 6,
      severity: 'error',
      message:
        worstDrift <= cfg.volumePerFrame
          ? `Part area changes by at most ${(worstDrift * 100).toFixed(2)}% between consecutive frames.`
          : `A part changes area by ${(worstDrift * 100).toFixed(1)}% in a single frame (limit ${(cfg.volumePerFrame * 100).toFixed(0)}%) — the form pops.`,
      diagnosis: 'animation.volume_pop',
      where: worstWhere,
    }),
  ];
}

// --- 6. Slow in and slow out ----------------------------------------------

function checkEases(shot: Shot, cfg: ResolvedPrincipleOptions, where: Locator): CheckResult[] {
  const primary = shot.curves.filter(
    (c) => !c.additive && c.target.endsWith('.rotation') && c.keyframes.length >= 2,
  );
  if (primary.length === 0) {
    return [
      pass({
        name: 'principle.slow_in_slow_out',
        department: DEPT,
        score: 1,
        message: 'No primary motion channels to classify.',
        where,
      }),
    ];
  }
  let linear = 0;
  let judged = 0;
  let example = '';
  for (const c of primary) {
    const span = c.keyframes[c.keyframes.length - 1].frame - c.keyframes[0].frame;
    if (span < 4) continue;
    const samples = sampleChannel(c, c.keyframes[0].frame, c.keyframes[c.keyframes.length - 1].frame);
    const range = Math.max(...samples) - Math.min(...samples);
    if (range < 0.02) continue; // channel barely moves; nothing to ease
    judged++;
    const klass = classifyEase(samples);
    if (klass.kind === 'linear') {
      linear++;
      if (!example) example = c.target;
    }
  }
  if (judged === 0) {
    return [
      pass({
        name: 'principle.slow_in_slow_out',
        department: DEPT,
        score: 1,
        message: 'No channel moves far enough to classify its ease.',
        where,
      }),
    ];
  }
  const ratio = linear / judged;
  return [
    measure({
      name: 'principle.slow_in_slow_out',
      department: DEPT,
      measured: ratio,
      threshold: 0.1,
      comparator: '<=',
      floor: 0.6,
      message:
        ratio <= 0.1
          ? `${judged - linear} of ${judged} moving channels are eased.`
          : `${linear} of ${judged} moving channels run at constant speed (worst: ${example}). Linear motion is the clearest sign nothing was timed.`,
      diagnosis: 'animation.linear_motion',
      where,
    }),
  ];
}

// --- 2. Anticipation -------------------------------------------------------

function checkAnticipation(
  shot: Shot,
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  const majorBeats = shot.beats.filter((b) => b.intensity >= 3);
  if (majorBeats.length === 0) {
    return [
      pass({
        name: 'principle.anticipation',
        department: DEPT,
        score: 1,
        message: 'No beat in this shot is strong enough to need an anticipation.',
        where,
      }),
    ];
  }
  const primary = shot.curves.filter((c) => !c.additive && c.target.endsWith('.rotation'));
  let withAntic = 0;
  const missing: number[] = [];

  for (const beat of majorBeats) {
    const lead = Math.max(2, rangeFor('anticipation', cfg.fps)[2]);
    const from = Math.max(0, beat.startFrame - 1);
    const to = Math.min(shot.durationFrames - 1, beat.startFrame + lead * 2);
    let found = false;
    for (const c of primary) {
      const samples = sampleChannel(c, from, to);
      if (samples.length < 4) continue;
      const vel = derivative(samples);
      const range = Math.max(...samples) - Math.min(...samples);
      if (range < 0.03) continue;
      // The main direction of travel over the window.
      const net = samples[samples.length - 1] - samples[0];
      if (Math.abs(net) < 0.03) continue;
      const dir = Math.sign(net);
      // Anticipation is measurable reverse motion before the action.
      for (let i = 1; i < Math.min(vel.length, lead + 2); i++) {
        if (Math.sign(vel[i]) === -dir && Math.abs(vel[i]) > Math.abs(net) * 0.04) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) withAntic++;
    else missing.push(beat.startFrame);
  }

  const ratio = withAntic / majorBeats.length;
  return [
    measure({
      name: 'principle.anticipation',
      department: DEPT,
      measured: ratio,
      threshold: 0.8,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        ratio >= 0.8
          ? `${withAntic} of ${majorBeats.length} major action(s) are led by an anticipation.`
          : `${majorBeats.length - withAntic} major action(s) start cold, with no anticipation (first at frame ${missing[0]}). The action will read as a pop.`,
      diagnosis: 'animation.missing_anticipation',
      where: missing.length ? { ...where, frame: missing[0] } : where,
    }),
  ];
}

// --- 5. Follow through and overlapping action ------------------------------

function checkOverlap(
  shot: Shot,
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
  parents: ReadonlyMap<string, string | null> = new Map(),
): CheckResult[] {
  const declared = shot.secondary;
  if (declared.length === 0) {
    return [
      fail({
        name: 'principle.follow_through',
        department: DEPT,
        score: 0.4,
        severity: 'warn',
        message:
          'No overlapping action is declared. Ears, hair and hands should lag the body by a few frames; without it the character moves like a single rigid object.',
        diagnosis: 'animation.no_overlap',
        where,
      }),
    ];
  }
  const [lo, hi] = cfg.lagWindow;
  const outOfWindow = declared.filter((s) => s.lagFrames < lo || s.lagFrames > hi);
  const checks: CheckResult[] = [
    outOfWindow.length === 0
      ? pass({
          name: 'principle.follow_through',
          department: DEPT,
          score: 1,
          message: `${declared.length} appendage(s) lag the body by ${lo}-${hi} frames.`,
          where,
        })
      : fail({
          name: 'principle.follow_through',
          department: DEPT,
          score: 1 - outOfWindow.length / declared.length,
          severity: 'warn',
          message: `${outOfWindow.length} appendage(s) lag outside the ${lo}-${hi} frame window (worst ${outOfWindow[0].lagFrames}f on ${outOfWindow[0].target}).`,
          diagnosis: 'animation.bad_overlap_lag',
          where,
        }),
  ];

  // Verify the declared lag against the actual curves, not just the claim.
  // The follower is the additive overlap channel, not the primary curve —
  // comparing a bone's primary channel against its parent's would measure
  // the pose, not the drag.
  const additiveByTarget = new Map(
    shot.curves.filter((c) => c.additive).map((c) => [c.target.replace(/#.*$/, ''), c]),
  );
  const primaryByTarget = new Map(
    shot.curves.filter((c) => !c.additive).map((c) => [c.target.replace(/#.*$/, ''), c]),
  );
  let worstMismatch = 0;
  let worstTarget = '';
  for (const s of declared) {
    const follower = additiveByTarget.get(s.target);
    const parentTarget = s.target.replace(/^bone:([^.]+)/, (_m, b: string) => `bone:${parentBone(b, parents)}`);
    const driver = primaryByTarget.get(parentTarget);
    if (!follower || !driver) continue;
    const measuredLag = measureLag(driver, follower, 0, shot.durationFrames - 1);
    const diff = Math.abs(measuredLag.lagFrames - s.lagFrames);
    if (diff > worstMismatch) {
      worstMismatch = diff;
      worstTarget = s.target;
    }
  }
  if (worstTarget) {
    checks.push(
      measure({
        name: 'principle.overlap_is_real',
        department: DEPT,
        measured: worstMismatch,
        threshold: 3,
        comparator: '<=',
        floor: 10,
        severity: 'warn',
        message:
          worstMismatch <= 3
            ? 'Declared overlap lags match what the curves actually do.'
            : `${worstTarget} declares a lag the curves do not show (off by ${worstMismatch} frames).`,
        diagnosis: 'animation.overlap_not_real',
        where,
      }),
    );
  }
  return checks;
}

/** Bone parent map across every rig in the shot. */
function boneParents(
  project: Pick<Project, 'characters'>,
  characterIds: readonly string[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const id of characterIds) {
    const rig = project.characters.find((c) => c.id === id)?.rig;
    if (!rig) continue;
    for (const b of rig.skeleton) out.set(b.id, b.parent);
  }
  return out;
}

function parentBone(bone: string, parents: ReadonlyMap<string, string | null>): string {
  const p = parents.get(bone);
  if (p) return p;
  // Structural fallback used only when the rig is not to hand.
  if (bone.endsWith('_ear') || bone === 'hair') return 'head';
  if (bone.endsWith('_hand')) return bone.replace('_hand', '_forearm');
  if (bone.startsWith('tail_')) return 'hips';
  return 'chest';
}

// --- 8. Secondary action during holds --------------------------------------

function checkSecondaryDuringHolds(
  shot: Shot,
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  const holds = shot.timing.holds;
  if (holds.length === 0) {
    return [
      pass({
        name: 'principle.secondary_action',
        department: DEPT,
        score: 1,
        message: 'The shot has no holds; nothing can go dead.',
        where,
      }),
    ];
  }
  const dead: number[] = [];
  for (const h of holds) {
    if (h.endFrame - h.startFrame < Math.round(cfg.fps / 3)) continue;
    if (!hasMotion(shot.curves, h.startFrame, h.endFrame, 1e-4)) dead.push(h.startFrame);
  }
  return [
    dead.length === 0
      ? pass({
          name: 'principle.secondary_action',
          department: DEPT,
          score: 1,
          message: `All ${holds.length} hold(s) keep something alive — breath, blink or weight.`,
          where,
        })
      : fail({
          name: 'principle.secondary_action',
          department: DEPT,
          score: Math.max(0, 1 - dead.length / holds.length),
          severity: 'error',
          message: `${dead.length} hold(s) are completely frozen (first at frame ${dead[0]}). A frozen hold is why a character reads as dead.`,
          diagnosis: 'animation.dead_hold',
          where: { ...where, frame: dead[0] },
        }),
    measure({
      name: 'principle.moving_holds',
      department: DEPT,
      measured: holds.filter((h) => h.moving).length / holds.length,
      threshold: 0.9,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message: `${holds.filter((h) => h.moving).length} of ${holds.length} holds are moving holds.`,
      diagnosis: 'animation.frozen_hold_declared',
      where,
    }),
  ];
}

// --- 9. Timing -------------------------------------------------------------

function checkTiming(shot: Shot, cfg: ResolvedPrincipleOptions, where: Locator): CheckResult[] {
  const offenders: { beat: string; frames: number; range: [number, number, number]; cls: string }[] = [];
  for (const beat of shot.beats) {
    const cls = actionClassFor(beat);
    const range = rangeFor(cls, cfg.fps);
    if (beat.durationFrames < range[0] || beat.durationFrames > range[2]) {
      offenders.push({ beat: beat.id, frames: beat.durationFrames, range, cls });
    }
  }
  const checks: CheckResult[] = [
    offenders.length === 0
      ? pass({
          name: 'principle.timing',
          department: DEPT,
          score: 1,
          message: `All ${shot.beats.length} beat(s) fall inside the known frame range for their action class.`,
          where,
        })
      : fail({
          name: 'principle.timing',
          department: DEPT,
          score: Math.max(0, 1 - offenders.length / Math.max(1, shot.beats.length)),
          severity: 'warn',
          message: `${offenders.length} beat(s) sit outside their action class's frame range (e.g. a ${offenders[0].cls} held for ${offenders[0].frames}f, expected ${offenders[0].range[0]}-${offenders[0].range[2]}f).`,
          diagnosis:
            offenders[0].frames < offenders[0].range[0]
              ? 'animation.beat_too_fast'
              : 'animation.beat_too_slow',
          where,
        }),
  ];

  // Ones-and-twos policy: series work runs mostly on twos.
  const twos = twosFraction(shot.timing, shot.durationFrames);
  checks.push(
    measure({
      name: 'principle.stepping_policy',
      department: DEPT,
      measured: twos,
      threshold: 0.35,
      comparator: '>=',
      floor: 0,
      severity: 'info',
      message: `${(twos * 100).toFixed(0)}% of the shot runs on twos, ${(holdFraction(shot.timing, shot.durationFrames) * 100).toFixed(0)}% is held.`,
      where,
    }),
  );
  return checks;
}

// --- 11. Solid drawing: twinning -------------------------------------------

function checkTwinning(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  let worst = 0;
  let worstWhere: Locator = where;
  const keyFrames = shot.keys.filter((k) => k.kind === 'key').map((k) => k.frame);
  const sampled = keyFrames.length ? keyFrames : frames.map((f) => f.frame).filter((f) => f % 6 === 0);

  for (const id of characterIds) {
    for (const f of sampled) {
      const entry = frames[Math.min(frames.length - 1, Math.max(0, f))]?.characters.get(id);
      if (!entry) continue;
      let matched = 0;
      let total = 0;
      for (const [l, r] of MIRROR_PAIRS) {
        const lb = entry.pose[l]?.rotation;
        const rb = entry.pose[r]?.rotation;
        if (lb === undefined || rb === undefined) continue;
        total++;
        // Twinning is left and right doing the mirrored same thing.
        if (Math.abs(wrapAngle(lb + rb)) < 0.05 && Math.abs(lb) > 0.05) matched++;
      }
      if (total === 0) continue;
      const score = matched / total;
      if (score > worst) {
        worst = score;
        worstWhere = { ...where, characterId: id, frame: f };
      }
    }
  }
  return [
    measure({
      name: 'principle.no_twinning',
      department: DEPT,
      measured: worst,
      threshold: cfg.maxTwinning,
      comparator: '<=',
      floor: 1,
      severity: 'warn',
      message:
        worst <= cfg.maxTwinning
          ? `Left and right limbs are doing different things (twinning score ${worst.toFixed(2)}).`
          : `The pose twins: ${(worst * 100).toFixed(0)}% of limb pairs mirror each other exactly. Break one side.`,
      diagnosis: 'animation.twinning',
      where: worstWhere,
    }),
  ];
}

// --- Foot slide -------------------------------------------------------------

function checkFootSlide(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  let worst = 0;
  let worstWhere: Locator = where;
  for (const id of characterIds) {
    for (const bone of FOOT_BONES) {
      const path = effectorPath(frames, id, bone);
      if (path.length < 4) continue;
      // A foot is in contact when it is near its lowest point for the shot.
      const ys = path.map((p) => p.y);
      const ground = Math.max(...ys);
      for (let i = 1; i < path.length; i++) {
        const planted = ground - path[i].y < 4 && ground - path[i - 1].y < 4;
        if (!planted) continue;
        const speed = vdist(path[i - 1], path[i]);
        if (speed > worst) {
          worst = speed;
          worstWhere = { ...where, characterId: id, boneId: bone, frame: i };
        }
      }
    }
  }
  return [
    measure({
      name: 'principle.no_foot_slide',
      department: DEPT,
      measured: worst,
      threshold: cfg.footSlide,
      comparator: '<=',
      floor: cfg.footSlide * 6,
      severity: 'warn',
      message:
        worst <= cfg.footSlide
          ? `Planted feet stay planted (max contact speed ${worst.toFixed(2)} px/frame).`
          : `A foot slides ${worst.toFixed(1)} px/frame while in contact with the ground — the character is skating.`,
      diagnosis: 'animation.foot_slide',
      where: worstWhere,
    }),
  ];
}

// --- Hitch detection --------------------------------------------------------

function checkHitches(shot: Shot, where: Locator): CheckResult[] {
  const primary = shot.curves.filter((c) => !c.additive && c.keyframes.length >= 3);
  const hitches: { target: string; frame: number }[] = [];
  for (const c of primary) {
    for (const f of hitchFrames(c, 0, Math.max(1, shot.durationFrames - 1))) {
      hitches.push({ target: c.target, frame: f });
    }
  }
  return [
    hitches.length === 0
      ? pass({
          name: 'animation.no_hitches',
          department: DEPT,
          score: 1,
          message: 'No velocity discontinuities away from keys.',
          where,
        })
      : fail({
          name: 'animation.no_hitches',
          department: DEPT,
          score: Math.max(0, 1 - hitches.length / 12),
          severity: 'warn',
          message: `${hitches.length} velocity hitch(es) away from any key (first: ${hitches[0].target} at frame ${hitches[0].frame}) — motion stutters where nothing was authored.`,
          diagnosis: 'animation.hitch',
          where: { ...where, frame: hitches[0].frame },
        }),
  ];
}

// --- 3 + 12. Staging and appeal --------------------------------------------

function checkStagingAndAppeal(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  const keyFrames = shot.keys.filter((k) => k.kind === 'key').map((k) => k.frame);
  const sampled = keyFrames.length
    ? keyFrames
    : frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 5)) === 0).map((f) => f.frame);

  let worstSolidity = 1;
  let worstWhere: Locator = where;
  let asymmetrySum = 0;
  let n = 0;
  let brokenSilhouettes = 0;

  for (const id of characterIds) {
    for (const f of sampled) {
      const entry = frames[Math.min(frames.length - 1, Math.max(0, f))]?.characters.get(id);
      if (!entry) continue;
      const contours = entry.posed.layer.shapes.flatMap((s) => s.contours);
      if (contours.length === 0) continue;
      const stats = silhouetteStats(contours, 128);
      n++;
      asymmetrySum += stats.asymmetry;
      if (stats.components > 1) brokenSilhouettes++;
      if (stats.solidity < worstSolidity) {
        worstSolidity = stats.solidity;
        worstWhere = { ...where, characterId: id, frame: f };
      }
    }
  }
  if (n === 0) {
    return [
      pass({
        name: 'principle.staging',
        department: DEPT,
        score: 1,
        message: 'No character silhouettes to judge in this shot.',
        where,
      }),
    ];
  }

  const checks: CheckResult[] = [
    measure({
      name: 'principle.staging',
      department: DEPT,
      measured: worstSolidity,
      threshold: cfg.minKeySolidity,
      comparator: '>=',
      floor: 0,
      message:
        worstSolidity >= cfg.minKeySolidity
          ? `Every key pose holds a readable silhouette (worst solidity ${worstSolidity.toFixed(2)}).`
          : `A key pose does not read in silhouette (solidity ${worstSolidity.toFixed(2)}). Rotate to three-quarter, or get the limbs off the body.`,
      diagnosis: 'animation.unreadable_silhouette',
      where: worstWhere,
    }),
    brokenSilhouettes === 0
      ? pass({
          name: 'principle.silhouette_whole',
          department: DEPT,
          score: 1,
          message: 'The character reads as one connected shape at every key.',
          where,
        })
      : fail({
          name: 'principle.silhouette_whole',
          department: DEPT,
          score: Math.max(0, 1 - brokenSilhouettes / n),
          message: `${brokenSilhouettes} key pose(s) show a character in disconnected pieces.`,
          diagnosis: 'animation.silhouette_broken',
          where: worstWhere,
        }),
    measure({
      name: 'principle.appeal_asymmetry',
      department: DEPT,
      measured: asymmetrySum / n,
      threshold: 0.08,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message: `Mean silhouette asymmetry ${(asymmetrySum / n).toFixed(3)}${
        asymmetrySum / n >= 0.08 ? '' : ' — the poses are too symmetrical to have appeal.'
      }`,
      diagnosis: 'animation.symmetrical_pose',
      where,
    }),
  ];
  return checks;
}

// --- 10. Exaggeration -------------------------------------------------------

function checkExaggeration(
  shot: Shot,
  cfg: Required<Omit<PrincipleOptions, 'primaryFrames'>>,
  where: Locator,
): CheckResult[] {
  const peaks = shot.beats.filter((b) => b.intensity >= 4);
  if (peaks.length === 0) {
    return [
      pass({
        name: 'principle.exaggeration',
        department: DEPT,
        score: 1,
        message: 'No emotional peak in this shot requires exaggeration.',
        where,
      }),
    ];
  }
  let worst = Infinity;
  let worstFrame = 0;
  for (const beat of peaks) {
    const key = shot.keys
      .filter((k) => k.kind === 'key')
      .reduce<null | { k: (typeof shot.keys)[number]; d: number }>((acc, k) => {
        const d = Math.abs(k.frame - (beat.startFrame + beat.durationFrames / 2));
        return !acc || d < acc.d ? { k, d } : acc;
      }, null);
    if (!key) continue;
    const rotations = Object.values(key.k.boneTransforms).map((t) => Math.abs(t.rotation ?? 0));
    const deviation = rotations.length ? mean(rotations) : 0;
    if (deviation < worst) {
      worst = deviation;
      worstFrame = key.k.frame;
    }
  }
  if (!Number.isFinite(worst)) worst = 0;
  return [
    measure({
      name: 'principle.exaggeration',
      department: DEPT,
      measured: worst,
      threshold: cfg.minPeakDeviation,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        worst >= cfg.minPeakDeviation
          ? `Emotional peaks push the pose well off neutral (mean deviation ${worst.toFixed(3)} rad).`
          : `An emotional peak is posed almost at neutral (mean deviation ${worst.toFixed(3)} rad). Push it.`,
      diagnosis: 'animation.underplayed_peak',
      where: { ...where, frame: worstFrame },
    }),
  ];
}

// --- 11. Solid drawing: proportions ----------------------------------------

function checkProportions(
  shot: Shot,
  frames: readonly EvaluatedFrame[],
  characterIds: readonly string[],
  charById: Map<string, Character>,
  where: Locator,
): CheckResult[] {
  let worst = 0;
  let worstWhere: Locator = where;
  let measured = 0;

  for (const id of characterIds) {
    const character = charById.get(id);
    const sheet = character?.modelSheet;
    const rig = character?.rig;
    if (!sheet || !rig) continue;
    const expected = sheet.construction.proportionRatios;
    for (const frame of frames) {
      const entry = frame.characters.get(id);
      if (!entry) continue;
      const bones = entry.posed.posed.bones;
      const head = bones.get('head');
      if (!head) continue;
      const headLen = vdist(head.head, head.tail);
      if (headLen < 1) continue;
      const arm =
        segLen(bones, 'L_upperarm') + segLen(bones, 'L_forearm');
      const leg = segLen(bones, 'L_thigh') + segLen(bones, 'L_shin');
      const checks: [string, number][] = [
        ['armLengthOverHead', arm / headLen],
        ['legLengthOverHead', leg / headLen],
      ];
      for (const [key, value] of checks) {
        const want = expected[key];
        if (!want || want <= 0) continue;
        measured++;
        const err = Math.abs(value - want) / want;
        if (err > worst) {
          worst = err;
          worstWhere = { ...where, characterId: id, frame: frame.frame, path: key };
        }
      }
    }
  }
  if (measured === 0) {
    return [
      pass({
        name: 'principle.solid_drawing',
        department: DEPT,
        score: 1,
        message: 'No measurable proportion ratios on the model sheet to check against.',
        where,
      }),
    ];
  }
  return [
    measure({
      name: 'principle.solid_drawing',
      department: DEPT,
      measured: worst,
      threshold: 0.05,
      comparator: '<=',
      floor: 0.3,
      message:
        worst <= 0.05
          ? `Proportions stay within 5% of the model sheet on every frame (worst ${(worst * 100).toFixed(1)}%).`
          : `Proportions drift ${(worst * 100).toFixed(1)}% from the model sheet — the character is going off-model as it moves.`,
      diagnosis: 'animation.off_model_proportions',
      where: worstWhere,
    }),
  ];
}

function segLen(bones: Map<string, { head: { x: number; y: number }; tail: { x: number; y: number } }>, id: string): number {
  const b = bones.get(id);
  return b ? vdist(b.head, b.tail) : 0;
}

export { clamp01, stddev, isHeld, evaluateChannel };
export type { Channel };
