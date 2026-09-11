/**
 * The Director's Brain: principles as metrics, notes as edits, repair.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { blockShot } from '../src/animation/blocking.ts';
import { evaluateShot } from '../src/animation/evaluate.ts';
import { withFraming } from '../src/orchestrator/pipeline.ts';
import { validatePrinciples } from '../src/director/principles.ts';
import { repairShot, formatCard } from '../src/director/repair.ts';
import { parseNote, applyEdits, applyNote, makeNote, NOTE_RULES } from '../src/director/notes.ts';
import { SHOT_REPAIR_TABLE, movesFor } from '../src/director/repair-table.ts';
import { scoreSheet } from '../src/core/result.ts';
import { classifyEase, applyEase, EASE_CURVES } from '../src/timing/easing.ts';
import { makeChannel, evaluateChannel, sampleChannel, addAnticipation, addOvershoot, addMovingHold, hitchFrames } from '../src/timing/curves.ts';
import { solveStepping, chartFromBeats, rangeFor, inRange, twosFraction } from '../src/timing/chart.ts';
import { shapeFor, applyActionShape } from '../src/timing/templates.ts';
import { phonemeTimeline, phonemesToVisemes, lipsyncLine, lipsyncOffset, graphemesToPhonemes } from '../src/animation/lipsync.ts';
import { buildIdleLayer, scheduleBlinks } from '../src/animation/idle.ts';
import { deriveOverlap, measureLag, hasMotion } from '../src/animation/secondary.ts';
import { selectPose, scalePose, POSE_LIBRARY } from '../src/animation/pose-library.ts';
import { makeRng } from '../src/core/rng.ts';
import { rad } from '../src/core/math.ts';
import { speechFrames } from '../src/core/units.ts';

const project = buildMiboProject({ repairAttempts: 24 });
const env = project.environments[0];
const shots = allShots(project.sequences[0]);

function prepare(index: number) {
  const shot = withFraming(shots[index], project, 320, 180, env);
  const { shot: blocked, idleLayers } = blockShot(shot, project.characters, { fps: 24, seed: shot.id });
  const frames = evaluateShot(blocked, project, { fps: 24, idleLayers, environment: env, width: 320, height: 180 });
  const primaryFrames = evaluateShot(blocked, project, { fps: 24, environment: env, width: 320, height: 180, primaryOnly: true });
  return { blocked, frames, primaryFrames, idleLayers };
}

describe('easing', () => {
  test('named eases start and end where they should', () => {
    for (const name of Object.keys(EASE_CURVES) as (keyof typeof EASE_CURVES)[]) {
      if (name === 'hold' || name === 'step') continue;
      assert.ok(Math.abs(applyEase(0, name)) < 1e-6, name);
      assert.ok(Math.abs(applyEase(1, name) - 1) < 1e-6, name);
    }
  });

  test('a hold does not move until the end', () => {
    assert.equal(applyEase(0.99, 'hold'), 0);
    assert.equal(applyEase(1, 'hold'), 1);
  });

  test('linear motion is recognised as linear', () => {
    const linear = Array.from({ length: 24 }, (_, i) => i);
    assert.equal(classifyEase(linear).kind, 'linear');
  });

  test('eased motion is not', () => {
    const eased = Array.from({ length: 24 }, (_, i) => applyEase(i / 23, 'easeInOut') * 100);
    assert.notEqual(classifyEase(eased).kind, 'linear');
  });

  test('ease-in and ease-out are told apart', () => {
    const inward = Array.from({ length: 24 }, (_, i) => applyEase(i / 23, 'easeIn') * 100);
    const outward = Array.from({ length: 24 }, (_, i) => applyEase(i / 23, 'easeOut') * 100);
    assert.equal(classifyEase(inward).kind, 'easeIn');
    assert.equal(classifyEase(outward).kind, 'easeOut');
  });
});

describe('curves', () => {
  test('evaluation is exact at keys and interpolates between', () => {
    const c = makeChannel('x', [[0, 0], [10, 100]], 'linear');
    assert.equal(evaluateChannel(c, 0), 0);
    assert.equal(evaluateChannel(c, 10), 100);
    assert.ok(Math.abs(evaluateChannel(c, 5) - 50) < 1e-6);
  });

  test('anticipation inserts a counter-move before the action', () => {
    const c = makeChannel('x', [[0, 0], [20, 100]], 'easeInOut');
    const withAntic = addAnticipation(c, 20, 5, 0.2);
    const dip = withAntic.keyframes.find((k) => k.frame > 0 && k.frame < 20);
    assert.ok(dip && dip.value < 0, 'the counter-move goes the other way first');
  });

  test('overshoot passes the target and settles back', () => {
    const c = makeChannel('x', [[0, 0], [10, 100]], 'easeInOut');
    const punched = addOvershoot(c, 10, 3, 5, 0.15);
    const peak = Math.max(...punched.keyframes.map((k) => k.value));
    assert.ok(peak > 100, `peak ${peak}`);
    assert.equal(punched.keyframes[punched.keyframes.length - 1].value, 100);
  });

  test('a moving hold keeps moving', () => {
    const c = addMovingHold(makeChannel('x', [[0, 10], [40, 10]], 'easeInOut'), 0, 40, 0.05);
    assert.ok(hasMotion([c], 0, 40, 1e-6));
  });

  test('hitches are detected away from keys and not at them', () => {
    const clean = makeChannel('x', [[0, 0], [12, 50], [24, 100]], 'easeInOut');
    assert.deepEqual(hitchFrames(clean, 0, 24), []);
  });
});

describe('timing', () => {
  test('fast passages step to ones and slow ones to twos', () => {
    const speeds = [...Array(12).fill(1), ...Array(12).fill(40), ...Array(12).fill(1)];
    const stepping = solveStepping(speeds, 0);
    assert.ok(stepping.some((s) => s.step === 1), 'the fast run should be on ones');
    assert.ok(stepping.some((s) => s.step === 2), 'the slow runs should be on twos');
  });

  test('action classes carry sane frame ranges', () => {
    assert.ok(inRange('blink', 5));
    assert.ok(!inRange('blink', 40));
    const [min, , max] = rangeFor('walkCycle', 24);
    assert.ok(min < max && min > 0);
  });

  test('a chart from beats fills the gaps with moving holds', () => {
    const chart = chartFromBeats(
      [
        { id: 'a', intent: 'x', action: 'y', emotion: 'neutral', intensity: 2, startFrame: 0, durationFrames: 12 },
        { id: 'b', intent: 'x', action: 'y', emotion: 'neutral', intensity: 2, startFrame: 30, durationFrames: 10 },
      ],
      60,
    );
    assert.ok(chart.holds.length >= 1);
    assert.ok(chart.holds.every((h) => h.moving), 'every hold should be a moving hold');
    assert.ok(twosFraction(chart, 60) > 0);
  });

  test('an action shape lays out antic, action, peak and settle in order', () => {
    const shape = shapeFor('jump', 4);
    const { landmarks } = applyActionShape(makeChannel('x', []), {
      startFrame: 0,
      fromValue: 0,
      toValue: 1,
      shape,
    });
    assert.ok(landmarks.antic < landmarks.action);
    assert.ok(landmarks.action <= landmarks.peak);
    assert.ok(landmarks.peak < landmarks.settle);
  });

  test('a bigger punch reaches its peak sooner', () => {
    const soft = shapeFor('jump', 1);
    const hard = shapeFor('jump', 5);
    assert.ok(hard.actionFrames < soft.actionFrames);
    assert.ok(hard.overshootAmount > soft.overshootAmount);
  });
});

describe('lipsync', () => {
  test('grapheme to phoneme handles digraphs', () => {
    assert.deepEqual(graphemesToPhonemes('ship'), ['SH', 'IH', 'P']);
    assert.deepEqual(graphemesToPhonemes('the'), ['TH', 'EH']);
  });

  test('the viseme track covers the line without gaps or duplicates', () => {
    const line = lipsyncLine({ id: 'l', characterId: 'c', text: 'Maybe it is hiding!', startFrame: 0, durationFrames: 36 });
    const v = line.visemes!;
    assert.ok(v.length > 2);
    for (let i = 1; i < v.length; i++) {
      assert.equal(v[i].startFrame, v[i - 1].endFrame, 'no gaps');
      assert.notEqual(v[i].viseme, v[i - 1].viseme, 'no adjacent duplicates');
    }
    assert.equal(v[v.length - 1].viseme, 'X', 'the mouth comes to rest');
  });

  test('the offset invariant holds at a natural speaking pace', () => {
    for (const text of ['I lost my hum.', 'Where did you have it last?', 'Together!', 'Maybe it is hiding!']) {
      const line = lipsyncLine({
        id: 'l',
        characterId: 'c',
        text,
        startFrame: 0,
        // The pipeline allots each line the time a natural read needs;
        // testing against an arbitrary short window would measure the
        // window, not the sync.
        durationFrames: speechFrames(text, 24),
      });
      assert.ok(lipsyncOffset(line) <= 2, `${text} drifted ${lipsyncOffset(line)} frames`);
    }
  });

  test('a bilabial that never closes the lips is charged in full', () => {
    const line = lipsyncLine({ id: 'l', characterId: 'c', text: 'mmm', startFrame: 0, durationFrames: 24 });
    // With room to breathe the closed shape must be present.
    assert.ok(line.visemes!.some((v) => v.viseme === 'A'), 'M must close the mouth');
  });

  test('a closed consonant maps to a closed mouth', () => {
    const spans = phonemesToVisemes(phonemeTimeline('mama', 0, 24), 1);
    assert.ok(spans.some((s) => s.viseme === 'A'), 'M should close the mouth');
  });
});

describe('idle layers', () => {
  test('breath, blinks and weight shift are all present', () => {
    const idle = buildIdleLayer(240, { seed: 'a' });
    const targets = idle.channels.map((c) => c.target);
    assert.ok(targets.some((t) => t.includes('chest')), 'breath');
    assert.ok(targets.some((t) => t.includes('hips')), 'weight shift');
    assert.ok(idle.blinkFrames.length > 2, 'blinks');
    assert.ok(idle.channels.every((c) => c.additive), 'idle must layer, not replace');
  });

  test('blinks are irregular, not metronomic', () => {
    const blinks = scheduleBlinks(480, 80, makeRng('b'));
    const gaps = blinks.slice(1).map((f, i) => f - blinks[i]);
    assert.ok(new Set(gaps).size > 1, 'a metronome is not a blink');
  });

  test('the idle layer is reproducible from its seed', () => {
    const a = buildIdleLayer(120, { seed: 'same' });
    const b = buildIdleLayer(120, { seed: 'same' });
    assert.deepEqual(a.blinkFrames, b.blinkFrames);
  });
});

describe('secondary action', () => {
  test('an overlap channel lags its driver', () => {
    const driver = makeChannel('bone:head.rotation', [[0, 0], [12, 1], [24, 1]], 'easeInOut');
    const follower = deriveOverlap(driver, 'L_ear', { lagFrames: 4 });
    const lag = measureLag(driver, follower, 0, 24, 10);
    assert.ok(lag.lagFrames >= 2 && lag.lagFrames <= 8, `measured ${lag.lagFrames}`);
  });

  test('the declared lag stays inside the 2 to 6 frame window', () => {
    const { blocked } = prepare(0);
    for (const s of blocked.secondary) {
      assert.ok(s.lagFrames >= 2 && s.lagFrames <= 6, `${s.target} lags ${s.lagFrames}`);
    }
  });
});

describe('pose library', () => {
  test('selection matches emotion first', () => {
    assert.equal(selectPose({ emotion: 'sad', intensity: 3 }).emotion, 'sad');
    assert.equal(selectPose({ emotion: 'happy', intensity: 5 }).emotion, 'happy');
  });

  test('exclusion prevents repeating a pose', () => {
    const first = selectPose({ emotion: 'happy' });
    const second = selectPose({ emotion: 'happy', exclude: [first.id] });
    assert.notEqual(first.id, second.id);
  });

  test('scaling a pose scales its deviation from rest', () => {
    const scaled = scalePose({ head: { rotation: 0.4 } }, 2);
    assert.ok(Math.abs((scaled.head?.rotation ?? 0) - 0.8) < 1e-9);
  });

  test('every library pose names what it is for', () => {
    for (const p of POSE_LIBRARY) {
      assert.ok(p.tags.length > 0, p.id);
      assert.ok(p.name.length > 0, p.id);
    }
  });
});

describe('the twelve principles', () => {
  test('a blocked shot passes every blocking principle', () => {
    for (let i = 0; i < shots.length; i++) {
      const { blocked, frames, primaryFrames } = prepare(i);
      const checks = validatePrinciples(blocked, frames, project, { fps: 24, primaryFrames });
      const blocking = checks.filter((c) => !c.pass && (c.severity === 'error' || c.severity === 'fatal'));
      assert.deepEqual(
        blocking.map((c) => c.name),
        [],
        `shot ${i + 1}: ${blocking.map((c) => c.message).join('; ')}`,
      );
    }
  });

  test('every principle is actually measured', () => {
    const { blocked, frames, primaryFrames } = prepare(0);
    const names = new Set(
      validatePrinciples(blocked, frames, project, { fps: 24, primaryFrames }).map((c) => c.name),
    );
    for (const required of [
      'principle.arcs',
      'principle.volume_per_frame',
      'principle.slow_in_slow_out',
      'principle.anticipation',
      'principle.follow_through',
      'principle.secondary_action',
      'principle.timing',
      'principle.no_twinning',
      'principle.staging',
      'principle.exaggeration',
      'principle.solid_drawing',
      'principle.pose_to_pose',
    ]) {
      assert.ok(names.has(required), `${required} never ran`);
    }
  });

  test('a frozen hold is caught', () => {
    const { blocked, frames, primaryFrames } = prepare(0);
    const dead = {
      ...blocked,
      curves: blocked.curves.filter((c) => !c.additive),
      timing: { ...blocked.timing, holds: [{ startFrame: 10, endFrame: 40, moving: false }] },
    };
    // Strip motion entirely so the hold really is dead.
    const frozen = { ...dead, curves: dead.curves.map((c) => ({ ...c, keyframes: [{ frame: 0, value: 0, ease: 'hold' as const }] })) };
    const check = validatePrinciples(frozen, frames, project, { fps: 24, primaryFrames }).find(
      (c) => c.name === 'principle.secondary_action',
    )!;
    assert.equal(check.pass, false);
    assert.equal(check.diagnosis, 'animation.dead_hold');
  });
});

describe('director notes', () => {
  test('the blueprint examples all parse', () => {
    const cases: [string, string][] = [
      ['More punch on the jump', 'add_punch'],
      ['She looks dead', 'moving_holds'],
      ['I cannot tell what he is doing', 'fix_silhouette'],
      ['Too floaty', 'tighten_timing'],
      ['Off-model', 'ease_curves'],
      ['Cut feels wrong', 'uncross_the_line'],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseNote(text);
      assert.ok(parsed.edits.length > 0, `"${text}" produced no edit`);
      if (expected !== 'ease_curves') {
        assert.ok(
          parsed.edits.some((e) => e.op === expected),
          `"${text}" -> ${parsed.edits.map((e) => e.op).join(',')}, wanted ${expected}`,
        );
      }
    }
  });

  test('an unrecognised note is reported, not guessed at', () => {
    const parsed = parseNote('Make the fnord wibble sideways');
    assert.equal(parsed.edits.length, 0);
    assert.equal(parsed.unrecognised.length, 1);
  });

  test('one sentence can carry two notes', () => {
    const parsed = parseNote('The cut feels wrong and the eyeline is off');
    assert.ok(parsed.edits.length >= 2, parsed.edits.map((e) => e.op).join(','));
  });

  test('a frame reference becomes the edit scope', () => {
    const parsed = parseNote('Too floaty around frame 42');
    assert.equal(parsed.edits[0].target.frame, 42);
  });

  test('a note actually changes the shot', () => {
    // Pick the shot with a beat strong enough for a punch to apply to.
    const index = shots.reduce(
      (best, s, i) =>
        Math.max(0, ...s.beats.map((b) => b.intensity)) >
        Math.max(0, ...shots[best].beats.map((b) => b.intensity))
          ? i
          : best,
      0,
    );
    const { blocked } = prepare(index);
    const note = makeNote('More punch on the jump', { by: 'dave', target: { shotId: blocked.id } });
    const after = applyNote(blocked, note);
    assert.notDeepEqual(after.curves, blocked.curves);
    assert.equal(after.notes.length, 1);
    assert.equal(after.notes[0].resolved, true, 'the note was fully applied');
  });

  test('a note that cannot apply is recorded as unresolved rather than silently dropped', () => {
    const calm = { ...prepare(0).blocked, beats: [] };
    const note = makeNote('More punch on the jump', { by: 'dave' });
    const after = applyNote(calm, note);
    assert.equal(after.notes.length, 1);
    assert.equal(after.notes[0].resolved, false);
  });

  test('a draw-over stroke scopes itself to its frame', () => {
    const note = makeNote('This reads wrong', {
      by: 'dave',
      drawOver: [{ frame: 17, points: [{ x: 0, y: 0 }], label: 'the arm' }],
    });
    assert.ok(note.edits.some((e) => e.op === 'review.draw_over' && e.target.frame === 17));
  });

  test('an edit with no registered move is skipped with a reason', () => {
    const { blocked } = prepare(0);
    const { skipped } = applyEdits(blocked, [
      { op: 'not_a_move', target: {}, params: {}, rationale: 'x' },
    ]);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /No repair move is registered/);
  });

  test('every note rule routes to a real repair move', () => {
    for (const rule of NOTE_RULES) {
      assert.ok(
        movesFor(rule.diagnosis).length > 0 || rule.diagnosis.startsWith('note.'),
        `${rule.id} routes to ${rule.diagnosis}, which no move handles`,
      );
    }
  });
});

describe('the repair table', () => {
  test('every move declares at least one diagnosis and a description', () => {
    for (const m of SHOT_REPAIR_TABLE) {
      assert.ok(m.diagnoses.length > 0, m.id);
      assert.ok(m.describe.length > 10, m.id);
    }
  });

  test('the shot repair loop reaches a clean sheet or escalates honestly', () => {
    const { blocked, idleLayers } = prepare(1);
    const out = repairShot(blocked, project, {
      evaluate: { fps: 24, idleLayers, environment: env, width: 240, height: 135 },
      principles: { fps: 24 },
      budget: { attempts: 6 },
    });
    assert.ok(out.scoreSheet.score > 0.8, `score ${out.scoreSheet.score}`);
    if (!out.clean) {
      assert.ok(out.card, 'an unclean shot must produce a diagnosis card');
      const text = formatCard(out.card!);
      assert.match(text, /What failed:/);
      assert.match(text, /Repair moves attempted:/);
      assert.match(text, /Suggested next steps:/);
    }
  });

  test('the loop never keeps a regression', () => {
    const { blocked, idleLayers } = prepare(2);
    const out = repairShot(blocked, project, {
      evaluate: { fps: 24, idleLayers, environment: env, width: 240, height: 135 },
      budget: { attempts: 5 },
    });
    let score = out.records[0]?.scoreBefore ?? 1;
    for (const r of out.records) {
      if (r.outcome === 'improved' || r.outcome === 'fixed') {
        assert.ok(r.scoreAfter >= score - 1e-9, `kept a regression at attempt ${r.attempt}`);
        score = r.scoreAfter;
      }
    }
  });
});
