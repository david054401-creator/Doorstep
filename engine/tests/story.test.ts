/**
 * Story: Fountain, breakdown, and the cheap gates.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFountain, writeFountain, parseSceneHeading, speakingCharacters, dialogueWordCount } from '../src/story/fountain.ts';
import { scriptToSequence, allShots, sequenceFrames, chooseShotSize, inferEmotion, inferIntensity } from '../src/story/script-to-shots.ts';
import { validateStory, checkContinuity } from '../src/story/validators.ts';
import { validateGrammar, sideOfLine, nextSize } from '../src/director/grammar.ts';
import { buildCueSheet, cueBrief } from '../src/audio/cue-sheet.ts';
import { MIBO_SCRIPT } from '../examples/mibo/project.ts';
import { scoreSheet } from '../src/core/result.ts';

const SCRIPT = `Title: Test
Author: Someone

EXT. MEADOW - DAY

ALFIE waits by the gate.

ALFIE
(quietly)
Is anybody there?

BEN runs in, waving.

BEN
I am! I am!

> CUT TO:

INT. BARN - NIGHT

The lantern swings.
`;

describe('fountain', () => {
  test('parses every element type', () => {
    const s = parseFountain(SCRIPT);
    const types = s.elements.map((e) => e.type);
    for (const t of ['sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition']) {
      assert.ok(types.includes(t as never), `missing ${t}`);
    }
    assert.equal(s.titlePage.title, 'Test');
  });

  test('round-trips without losing structure', () => {
    const a = parseFountain(SCRIPT);
    const b = parseFountain(writeFountain(a));
    assert.deepEqual(
      b.elements.map((e) => `${e.type}:${e.text}`),
      a.elements.map((e) => `${e.type}:${e.text}`),
    );
  });

  test('scene headings decompose', () => {
    const h = parseSceneHeading('EXT. HILLSIDE MEADOW - DAY');
    assert.equal(h.exterior, true);
    assert.equal(h.interior, false);
    assert.equal(h.location, 'HILLSIDE MEADOW');
    assert.equal(h.timeOfDay, 'DAY');
  });

  test('finds speaking characters in order', () => {
    assert.deepEqual(speakingCharacters(parseFountain(SCRIPT)), ['ALFIE', 'BEN']);
  });

  test('counts dialogue words', () => {
    assert.ok(dialogueWordCount(parseFountain(SCRIPT)) >= 7);
  });
});

describe('breakdown', () => {
  const sequence = scriptToSequence(MIBO_SCRIPT, {
    characterIds: { MIBO: 'char_mibo', PIP: 'char_pip' },
  });

  test('produces scenes and shots', () => {
    assert.ok(sequence.scenes.length >= 1);
    assert.ok(allShots(sequence).length >= 4);
    assert.ok(sequenceFrames(sequence) > 100);
  });

  test('every shot carries an intent and at least one beat', () => {
    for (const shot of allShots(sequence)) {
      assert.ok(shot.beats.length > 0, `shot ${shot.number} has no beats`);
      for (const beat of shot.beats) assert.ok(beat.intent.trim().length > 0);
    }
  });

  test('dialogue fits inside its shot', () => {
    for (const shot of allShots(sequence)) {
      for (const line of shot.dialogue) {
        assert.ok(
          line.startFrame + line.durationFrames <= shot.durationFrames,
          `line overruns shot ${shot.number}`,
        );
      }
    }
  });

  test('an action beat stops where the first line starts', () => {
    // Overlapping beats fight over the same channels and truncate each
    // other's moves into a one-frame pop.
    for (const shot of allShots(sequence)) {
      const first = shot.dialogue[0];
      if (!first) continue;
      const action = shot.beats.find((b) => !b.action.includes('says:'));
      if (!action) continue;
      assert.ok(
        action.startFrame + action.durationFrames <= Math.max(first.startFrame, 18),
        `action beat runs past the first line in shot ${shot.number}`,
      );
    }
  });

  test('emotion and intensity are inferred from direction and punctuation', () => {
    assert.equal(inferEmotion('quietly', 'I lost my hum.'), 'sad');
    assert.equal(inferEmotion('determined', 'Together!'), 'determined');
    assert.equal(inferEmotion(undefined, 'What was that!'), 'surprised');
    assert.ok(inferIntensity(undefined, 'Look out!!') > inferIntensity('quietly', 'oh.'));
  });

  test('shot sizes vary rather than repeating', () => {
    const sizes = allShots(sequence).map((s) => s.camera.size);
    assert.ok(new Set(sizes).size >= 2, `only ${new Set(sizes).size} distinct sizes`);
  });

  test('shot-size selection tightens on intensity', () => {
    const calm = chooseShotSize({ index: 1, total: 4, hasDialogue: true, intensity: 1, isEstablishing: false, characterCount: 1 });
    const peak = chooseShotSize({ index: 1, total: 4, hasDialogue: true, intensity: 5, isEstablishing: false, characterCount: 1 });
    assert.equal(peak, 'cu');
    assert.notEqual(calm, 'cu');
  });
});

describe('story validators', () => {
  const sequence = scriptToSequence(MIBO_SCRIPT, {
    characterIds: { MIBO: 'char_mibo', PIP: 'char_pip' },
  });

  test('a healthy script passes the blocking checks', () => {
    const checks = validateStory(sequence, undefined, { audience: 'preschool' });
    const blocking = checks.filter((c) => !c.pass && c.severity !== 'warn' && c.severity !== 'info');
    assert.deepEqual(blocking.map((c) => c.name), [], blocking.map((c) => c.message).join('; '));
  });

  test('an empty sequence is fatal, not merely low-scoring', () => {
    const empty = { ...sequence, scenes: [] };
    const checks = validateStory(empty, undefined, {});
    const fatal = checks.find((c) => c.name === 'story.has_shots')!;
    assert.equal(fatal.pass, false);
    assert.equal(fatal.severity, 'fatal');
  });

  test('a shot without intent is caught', () => {
    const broken = {
      ...sequence,
      scenes: sequence.scenes.map((sc) => ({
        ...sc,
        shots: sc.shots.map((s, i) =>
          i === 0 ? { ...s, beats: s.beats.map((b) => ({ ...b, intent: '' })) } : s,
        ),
      })),
    };
    const check = validateStory(broken, undefined, {}).find(
      (c) => c.name === 'story.every_shot_has_intent',
    )!;
    assert.equal(check.pass, false);
    assert.equal(check.diagnosis, 'story.missing_intent');
  });

  test('the age rubric flags what it should and not what it should not', () => {
    const scary = scriptToSequence(
      'Title: X\n\nEXT. WOOD - NIGHT\n\nA monster attacks and there is blood everywhere.\n',
      {},
    );
    const flagged = validateStory(scary, undefined, { audience: 'preschool' }).find(
      (c) => c.name === 'story.age_appropriate',
    )!;
    assert.equal(flagged.pass, false);
    const clean = validateStory(sequence, undefined, { audience: 'preschool' }).find(
      (c) => c.name === 'story.age_appropriate',
    )!;
    assert.equal(clean.pass, true);
  });

  test('cutting between singles is not a continuity error', () => {
    const { issues } = checkContinuity(sequence);
    const vanishes = issues.filter((i) => i.kind === 'character_vanishes');
    assert.deepEqual(vanishes, [], vanishes.map((v) => v.detail).join('; '));
  });

  test('losing a character between two wide shots is', () => {
    const scene = sequence.scenes[0];
    const wide = {
      ...sequence,
      scenes: [
        {
          ...scene,
          shots: [
            {
              ...scene.shots[0],
              camera: { ...scene.shots[0].camera, size: 'ls' as const },
              staging: {
                ...scene.shots[0].staging,
                characters: [
                  { characterId: 'char_mibo', view: 'front' as const, position: { x: -100, y: 0 }, scale: 1, facingRight: true, depth: 0.8 },
                  { characterId: 'char_pip', view: 'front' as const, position: { x: 100, y: 0 }, scale: 1, facingRight: false, depth: 0.8 },
                ],
              },
              beats: scene.shots[0].beats.map((b) => ({ ...b, action: 'they stand together' })),
            },
            {
              ...scene.shots[1],
              camera: { ...scene.shots[1].camera, size: 'ls' as const },
              staging: {
                ...scene.shots[1].staging,
                characters: [
                  { characterId: 'char_mibo', view: 'front' as const, position: { x: 0, y: 0 }, scale: 1, facingRight: true, depth: 0.8 },
                ],
              },
            },
          ],
        },
      ],
    };
    const { issues } = checkContinuity(wide);
    assert.ok(issues.some((i) => i.kind === 'character_vanishes'), 'PIP vanished from a wide shot');
  });
});

describe('shot grammar', () => {
  const sequence = scriptToSequence(MIBO_SCRIPT, {
    characterIds: { MIBO: 'char_mibo', PIP: 'char_pip' },
  });

  test('the generated coverage obeys its own rules', () => {
    const checks = validateGrammar(sequence);
    const blocking = checks.filter((c) => !c.pass && c.severity !== 'warn' && c.severity !== 'info');
    assert.deepEqual(blocking.map((c) => c.name), [], blocking.map((c) => c.message).join('; '));
  });

  test('side of the action line is computed correctly', () => {
    const line: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    assert.equal(sideOfLine(line, { x: 5, y: 5 }), 1);
    assert.equal(sideOfLine(line, { x: 5, y: -5 }), -1);
  });

  test('the next shot size steps rather than jump-cutting', () => {
    assert.notEqual(nextSize('ms', true), 'ms');
    assert.notEqual(nextSize('ms', true), 'mcu');
  });

  test('crossing the line is detected', () => {
    const scene = sequence.scenes[0];
    const two = (flip: boolean) => ({
      characters: [
        { characterId: 'a', view: 'threeQuarterR' as const, position: { x: flip ? 100 : -100, y: 0 }, scale: 1, facingRight: !flip, depth: 0.8 },
        { characterId: 'b', view: 'threeQuarterL' as const, position: { x: flip ? -100 : 100, y: 0 }, scale: 1, facingRight: flip, depth: 0.8 },
      ],
      eyelines: {},
      screenDirection: 'right' as const,
      cameraSide: 'A' as const,
    });
    const crossed = {
      ...sequence,
      scenes: [
        {
          ...scene,
          shots: [
            { ...scene.shots[0], staging: two(false) },
            { ...scene.shots[1], staging: two(true) },
          ],
        },
      ],
    };
    const check = validateGrammar(crossed).find((c) => c.name === 'grammar.180_degree_rule')!;
    assert.equal(check.pass, false);
    assert.equal(check.diagnosis, 'grammar.crossed_the_line');
  });
});

describe('cue sheet', () => {
  test('derives music cues from the emotional runs', () => {
    const sequence = scriptToSequence(MIBO_SCRIPT, {});
    const { music, sfx } = buildCueSheet(sequence);
    assert.ok(music.length >= 1);
    assert.ok(music.every((c) => c.durationFrames > 0 && c.bpm >= 60 && c.bpm <= 160));
    assert.ok(music.every((c) => c.mood.length > 0));
    assert.match(cueBrief(music[0]), /Leave the 1-4 kHz band clear for dialogue/);
    assert.ok(sfx.length >= 1, 'footsteps and settles should be picked up');
  });

  test('score sits lower under dialogue', () => {
    const sequence = scriptToSequence(MIBO_SCRIPT, {});
    const { music } = buildCueSheet(sequence);
    assert.ok(music.every((c) => c.gainDb <= -10));
  });
});
