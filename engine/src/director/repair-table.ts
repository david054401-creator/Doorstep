/**
 * THE REPAIR TABLE
 *
 * Design law 4: every failure class has a repair move. This is that table,
 * for everything downstream of rigging. A diagnosis goes in, a bounded,
 * scoped edit comes out. Nothing here regenerates a shot; every move
 * touches the smallest thing that could be wrong.
 */

import type { Shot, StructuredEdit, Channel, KeyPose } from '../graph/types.ts';
import type { CheckResult } from '../core/result.ts';
import {
  setEases,
  addBreakdown,
  addMovingHold,
  retimeChannel,
  scaleChannel,
  offsetChannel,
  setKey,
  evaluateChannel,
  sampleChannel,
} from '../timing/curves.ts';
import { addAnticipation, addOvershoot, punchUp } from '../timing/templates.ts';
import { nextSize } from './grammar.ts';
import { fitArc } from '../core/math.ts';
import { makeId } from '../core/ids.ts';

export type ShotRepairMove = {
  id: string;
  diagnoses: string[];
  describe: string;
  /** Returns the edited shot, or null when the move does not apply. */
  apply(shot: Shot, check: CheckResult, attempt: number): Shot | null;
};

const primary = (shot: Shot): Channel[] =>
  shot.curves.filter((c) => !c.additive && c.target.endsWith('.rotation'));

function replaceCurves(shot: Shot, updated: Map<string, Channel>): Shot {
  return {
    ...shot,
    curves: shot.curves.map((c) => updated.get(c.target) ?? c),
  };
}

/**
 * Add breakdown keys along the arc.
 *
 * A path that fails the arc test is usually two keys with nothing between
 * them: the interpolation cuts the corner. Inserting a breakdown that is
 * pushed off the chord is literally what an animator draws to fix this.
 */
function fixArcs(shot: Shot, attempt: number): Shot | null {
  const channels = primary(shot);
  if (channels.length === 0) return null;
  const updated = new Map<string, Channel>();
  let changed = false;
  for (const c of channels) {
    if (c.keyframes.length < 2) continue;
    let next = c;
    for (let i = 0; i < c.keyframes.length - 1; i++) {
      const a = c.keyframes[i];
      const b = c.keyframes[i + 1];
      if (b.frame - a.frame < 4) continue;
      // Push the breakdown off the straight line between the keys. The
      // offset grows with each attempt, and favours the trailing key so the
      // pose reads as arcing into the extreme.
      const offset = (b.value - a.value) * 0.1 * (1 + attempt * 0.5);
      next = addBreakdown(next, a.frame, b.frame, 0.42, offset);
      changed = true;
    }
    if (changed) updated.set(c.target, next);
  }
  if (!changed) return null;
  const withKeys = addBreakdownKeys(shot);
  return replaceCurves(withKeys, updated);
}

function addBreakdownKeys(shot: Shot): Shot {
  const keys = [...shot.keys];
  const majors = shot.keys.filter((k) => k.kind === 'key').sort((a, b) => a.frame - b.frame);
  for (let i = 0; i < majors.length - 1; i++) {
    const mid = Math.round((majors[i].frame + majors[i + 1].frame) / 2);
    if (keys.some((k) => k.frame === mid)) continue;
    const bd: KeyPose = {
      id: makeId('key', `${shot.id}:bd:${mid}`),
      frame: mid,
      characterId: majors[i].characterId,
      boneTransforms: {},
      intent: 'Breakdown: carry the arc between the two extremes.',
      kind: 'breakdown',
    };
    keys.push(bd);
  }
  return { ...shot, keys: keys.sort((a, b) => a.frame - b.frame) };
}

/** Re-solve the curves with eases, killing linear interpolation. */
function fixLinear(shot: Shot, attempt: number): Shot | null {
  const channels = primary(shot);
  if (channels.length === 0) return null;
  const updated = new Map<string, Channel>();
  const ease = attempt === 0 ? 'easeInOut' : 'easeOutStrong';
  for (const c of channels) updated.set(c.target, setEases(c, ease));
  return replaceCurves(shot, updated);
}

/** Insert an anticipation before every major beat that lacks one. */
function fixAnticipation(shot: Shot, attempt: number): Shot | null {
  const majors = shot.beats.filter((b) => b.intensity >= 3);
  if (majors.length === 0) return null;
  const updated = new Map<string, Channel>();
  const frames = 3 + attempt;
  const amount = 0.12 + attempt * 0.05;
  for (const c of primary(shot)) {
    let next = c;
    for (const beat of majors) {
      const actionFrame = nearestKeyFrame(next, beat.startFrame);
      if (actionFrame === null) continue;
      next = addAnticipation(next, actionFrame, frames, amount);
    }
    updated.set(c.target, next);
  }
  return replaceCurves(shot, updated);
}

/** Add overshoot and settle so actions land instead of arriving. */
function addPunch(shot: Shot, attempt: number): Shot | null {
  const majors = shot.beats.filter((b) => b.intensity >= 3);
  if (majors.length === 0) return null;
  const updated = new Map<string, Channel>();
  for (const c of primary(shot)) {
    let next = c;
    for (const beat of majors) {
      const landing = nearestKeyFrame(next, beat.startFrame + beat.durationFrames / 2);
      if (landing === null) continue;
      next = punchUp(next, landing, 1 + attempt * 0.4);
    }
    updated.set(c.target, next);
  }
  return replaceCurves(shot, updated);
}

function nearestKeyFrame(channel: Channel, frame: number): number | null {
  if (channel.keyframes.length === 0) return null;
  let best = channel.keyframes[0].frame;
  let bestD = Math.abs(best - frame);
  for (const k of channel.keyframes) {
    const d = Math.abs(k.frame - frame);
    if (d < bestD) {
      bestD = d;
      best = k.frame;
    }
  }
  return best;
}

/** Convert frozen holds into moving holds. */
function fixDeadHold(shot: Shot, attempt: number): Shot | null {
  const holds = shot.timing.holds;
  if (holds.length === 0) return null;
  const drift = 0.012 * (1 + attempt);
  const updated = new Map<string, Channel>();
  const channels = primary(shot);
  if (channels.length === 0) return null;
  // Drift the spine and head: the parts that carry breath and attention.
  for (const c of channels) {
    if (!/bone:(spine|chest|neck|head)\.rotation/.test(c.target)) continue;
    let next = c;
    for (const h of holds) {
      if (h.endFrame - h.startFrame < 6) continue;
      next = addMovingHold(next, h.startFrame, h.endFrame, drift);
    }
    updated.set(c.target, next);
  }
  if (updated.size === 0) return null;
  return {
    ...replaceCurves(shot, updated),
    timing: { ...shot.timing, holds: holds.map((h) => ({ ...h, moving: true })) },
  };
}

/** Break a twinned pose by offsetting one side in time and amplitude. */
function breakTwinning(shot: Shot, attempt: number): Shot | null {
  const updated = new Map<string, Channel>();
  let changed = false;
  for (const c of primary(shot)) {
    const m = /^bone:R_([A-Za-z]+)\.rotation$/.exec(c.target);
    if (!m) continue;
    // Offset the right side by two frames and drop its amplitude slightly.
    const shifted = offsetChannel(scaleChannel(c, 0.88 - attempt * 0.05), 2 + attempt);
    updated.set(c.target, shifted);
    changed = true;
  }
  return changed ? replaceCurves(shot, updated) : null;
}

/** Tighten the timing: the fix for "too floaty". */
function tightenTiming(shot: Shot, attempt: number): Shot | null {
  const factor = 0.85 - attempt * 0.07;
  const updated = new Map<string, Channel>();
  for (const c of shot.curves) {
    if (c.additive) continue;
    updated.set(c.target, setEases(retimeChannel(c, factor), 'easeInStrong'));
  }
  return replaceCurves(shot, updated);
}

/** Slow the timing: the fix for "too snappy" or a beat under its range. */
function loosenTiming(shot: Shot, attempt: number): Shot | null {
  const factor = 1.15 + attempt * 0.08;
  const updated = new Map<string, Channel>();
  for (const c of shot.curves) {
    if (c.additive) continue;
    updated.set(c.target, retimeChannel(c, factor));
  }
  return {
    ...replaceCurves(shot, updated),
    durationFrames: Math.round(shot.durationFrames * factor),
  };
}

/** Push a peak pose further off neutral. */
function exaggerate(shot: Shot, attempt: number): Shot | null {
  const factor = 1.2 + attempt * 0.15;
  const updated = new Map<string, Channel>();
  for (const c of primary(shot)) updated.set(c.target, scaleChannel(c, factor, 0));
  return replaceCurves(shot, updated);
}

/** Rotate a character to three-quarter and offset the limbs to read. */
function fixSilhouette(shot: Shot, check: CheckResult): Shot | null {
  const characterId = check.where.characterId ?? shot.staging.characters[0]?.characterId;
  if (!characterId) return null;
  return {
    ...shot,
    staging: {
      ...shot.staging,
      characters: shot.staging.characters.map((p) =>
        p.characterId === characterId
          ? { ...p, view: p.view === 'front' ? (p.facingRight ? 'threeQuarterR' : 'threeQuarterL') : p.view }
          : p,
      ),
    },
  };
}

/** Change the shot size so the scene stops reading flat. */
function varyShotSize(shot: Shot): Shot | null {
  const size = nextSize(shot.camera.size, shot.dialogue.length > 0);
  if (size === shot.camera.size) return null;
  return { ...shot, camera: { ...shot.camera, size } };
}

/** Put the camera back on the established side of the action line. */
function uncrossTheLine(shot: Shot): Shot | null {
  return {
    ...shot,
    staging: {
      ...shot.staging,
      cameraSide: shot.staging.cameraSide === 'A' ? 'B' : 'A',
      characters: shot.staging.characters.map((p) => ({
        ...p,
        position: { x: -p.position.x, y: p.position.y },
        facingRight: !p.facingRight,
      })),
    },
  };
}

/** Aim eyelines at what the character is actually looking at. */
function fixEyelines(shot: Shot): Shot | null {
  const chars = shot.staging.characters;
  if (chars.length === 0) return null;
  const eyelines: Record<string, { x: number; y: number }> = {};
  for (const c of chars) {
    const other = chars.find((o) => o.characterId !== c.characterId);
    const target = other ? { ...other.position } : { x: c.position.x + (c.facingRight ? 300 : -300), y: c.position.y - 60 };
    eyelines[c.characterId] = target;
  }
  return {
    ...shot,
    staging: {
      ...shot.staging,
      eyelines,
      characters: chars.map((c) => {
        const target = eyelines[c.characterId];
        return { ...c, facingRight: target.x >= c.position.x };
      }),
    },
  };
}

/** Trim a dead tail so the cut lands on movement. */
function cutOnAction(shot: Shot): Shot | null {
  const tail = shot.beats.reduce((a, b) => Math.max(a, b.startFrame + b.durationFrames), 0);
  if (tail <= 0 || shot.durationFrames - tail < 6) return null;
  const trimmed = Math.max(tail + 3, Math.round(shot.durationFrames * 0.8));
  if (trimmed >= shot.durationFrames) return null;
  return { ...shot, durationFrames: trimmed };
}

/** Extend a shot that is too short to read. */
function extendShot(shot: Shot, attempt: number): Shot | null {
  const target = Math.max(shot.durationFrames + 6, Math.round(shot.durationFrames * (1.3 + attempt * 0.2)));
  return { ...shot, durationFrames: target };
}

/** Smooth a velocity hitch by easing the keys either side of it. */
function smoothHitch(shot: Shot, check: CheckResult): Shot | null {
  const frame = check.where.frame;
  if (frame === undefined) return null;
  const updated = new Map<string, Channel>();
  for (const c of primary(shot)) {
    const near = c.keyframes.filter((k) => Math.abs(k.frame - frame) <= 4);
    if (near.length === 0) continue;
    let next = c;
    for (const k of near) next = setKey(next, { ...k, ease: 'easeInOut', handles: undefined });
    updated.set(c.target, next);
  }
  return updated.size ? replaceCurves(shot, updated) : null;
}

/** Plant a sliding foot by pinning its curve across the contact. */
function plantFoot(shot: Shot, check: CheckResult): Shot | null {
  const bone = check.where.boneId;
  const frame = check.where.frame;
  if (!bone || frame === undefined) return null;
  const target = `bone:${bone}.rotation`;
  const c = shot.curves.find((x) => x.target === target && !x.additive);
  if (!c) return null;
  const value = evaluateChannel(c, frame);
  const from = Math.max(0, frame - 3);
  const to = Math.min(shot.durationFrames - 1, frame + 3);
  let next = c;
  for (let f = from; f <= to; f++) next = setKey(next, { frame: f, value, ease: 'hold' });
  const updated = new Map<string, Channel>([[target, next]]);
  return replaceCurves(shot, updated);
}

export const SHOT_REPAIR_TABLE: ShotRepairMove[] = [
  {
    id: 'add_breakdowns_on_arc',
    diagnoses: ['animation.broken_arc'],
    describe: 'Insert breakdown keys pushed off the chord so the path arcs.',
    apply: (shot, _check, attempt) => fixArcs(shot, attempt),
  },
  {
    id: 'ease_curves',
    diagnoses: ['animation.linear_motion', 'animation.hitch'],
    describe: 'Re-solve the curves with eases instead of linear interpolation.',
    apply: (shot, _check, attempt) => fixLinear(shot, attempt),
  },
  {
    id: 'smooth_hitch',
    diagnoses: ['animation.hitch'],
    describe: 'Ease the keys either side of a velocity discontinuity.',
    apply: (shot, check) => smoothHitch(shot, check),
  },
  {
    id: 'add_anticipation',
    diagnoses: ['animation.missing_anticipation'],
    describe: 'Insert a counter-move before each major action.',
    apply: (shot, _check, attempt) => fixAnticipation(shot, attempt),
  },
  {
    id: 'add_punch',
    diagnoses: ['animation.underplayed_peak', 'note.more_punch'],
    describe: 'Shorten the anticipation-to-peak span and add an overshoot.',
    apply: (shot, _check, attempt) => addPunch(shot, attempt),
  },
  {
    id: 'exaggerate_peak',
    diagnoses: ['animation.underplayed_peak'],
    describe: 'Push the peak pose further off neutral.',
    apply: (shot, _check, attempt) => exaggerate(shot, attempt),
  },
  {
    id: 'moving_holds',
    diagnoses: ['animation.dead_hold', 'animation.frozen_hold_declared', 'note.looks_dead'],
    describe: 'Turn frozen holds into moving holds and add idle layers.',
    apply: (shot, _check, attempt) => fixDeadHold(shot, attempt),
  },
  {
    id: 'break_twinning',
    diagnoses: ['animation.twinning', 'animation.symmetrical_pose'],
    describe: 'Offset one side of the body in time and amplitude.',
    apply: (shot, _check, attempt) => breakTwinning(shot, attempt),
  },
  {
    id: 'tighten_timing',
    diagnoses: ['animation.beat_too_slow', 'note.too_floaty'],
    describe: 'Tighten the eases and compress the middle of each move.',
    apply: (shot, _check, attempt) => tightenTiming(shot, attempt),
  },
  {
    id: 'loosen_timing',
    diagnoses: ['animation.beat_too_fast', 'note.too_snappy'],
    describe: 'Give the action more frames so it reads.',
    apply: (shot, _check, attempt) => loosenTiming(shot, attempt),
  },
  {
    id: 'fix_silhouette',
    diagnoses: [
      'animation.unreadable_silhouette',
      'animation.silhouette_broken',
      'note.cannot_tell_action',
    ],
    describe: 'Rotate the character to three-quarter so the action reads.',
    apply: (shot, check) => fixSilhouette(shot, check),
  },
  {
    id: 'plant_foot',
    diagnoses: ['animation.foot_slide'],
    describe: 'Pin the foot across its contact so it stops skating.',
    apply: (shot, check) => plantFoot(shot, check),
  },
  {
    id: 'vary_shot_size',
    diagnoses: ['grammar.flat_coverage', 'grammar.size_monotony'],
    describe: 'Change the shot size so the coverage stops reading flat.',
    apply: (shot) => varyShotSize(shot),
  },
  {
    id: 'uncross_the_line',
    diagnoses: ['grammar.crossed_the_line', 'grammar.screen_direction_break', 'note.cut_feels_wrong'],
    describe: 'Put the camera back on the established side of the action line.',
    apply: (shot) => uncrossTheLine(shot),
  },
  {
    id: 'fix_eyelines',
    diagnoses: ['grammar.eyeline_mismatch'],
    describe: 'Aim each eyeline at what the character is actually looking at.',
    apply: (shot) => fixEyelines(shot),
  },
  {
    id: 'cut_on_action',
    diagnoses: ['grammar.dead_tail'],
    describe: 'Trim the dead tail so the cut lands on movement.',
    apply: (shot) => cutOnAction(shot),
  },
  {
    id: 'extend_shot',
    diagnoses: ['grammar.shot_too_short', 'story.dialogue_overrun'],
    describe: 'Give the shot enough frames to be read.',
    apply: (shot, _check, attempt) => extendShot(shot, attempt),
  },
];

/** Look up every move that addresses a diagnosis, cheapest first. */
export function movesFor(diagnosis: string): ShotRepairMove[] {
  return SHOT_REPAIR_TABLE.filter((m) => m.diagnoses.includes(diagnosis));
}

/** The table rendered as structured edits, for the UI and for audit. */
export function repairTableAsEdits(): StructuredEdit[] {
  return SHOT_REPAIR_TABLE.map((m) => ({
    op: m.id,
    target: {},
    params: { diagnoses: m.diagnoses.join(',') },
    rationale: m.describe,
  }));
}

export { fitArc, sampleChannel, addOvershoot };
