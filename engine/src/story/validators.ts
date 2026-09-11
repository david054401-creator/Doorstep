/**
 * Story validators — Tier 0 for the development department.
 *
 * Catching a story problem here costs nothing. Catching it after the shots
 * are animated costs the whole episode, which is why the cheap gates sit on
 * cheap artifacts (design law 10).
 */

import type { Sequence, Shot, Project, Scene } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import { speechFrames, framesToSeconds, DEFAULT_FPS } from '../core/units.ts';
import { allShots } from './script-to-shots.ts';

const DEPT = 'story';

export type StoryValidationOptions = {
  fps?: number;
  /** Target runtime in seconds, if the brief sets one. */
  targetSeconds?: number;
  /** Allowed deviation from the target, as a fraction. */
  durationTolerance?: number;
  /** Max share of screen time that may be dialogue — "show, don't tell". */
  maxDialogueRatio?: number;
  /** Audience age band, for the content rubric. */
  audience?: 'preschool' | 'kids' | 'family' | 'teen' | 'adult';
};

/** Words that do not belong in preschool or kids content. */
const AGE_FLAGS: Record<string, RegExp[]> = {
  preschool: [
    /\b(kill|dead|death|blood|gun|knife|weapon|hate|stupid|dumb|idiot)\b/i,
    /\b(scary|terrif(y|ied)|nightmare|monster attacks)\b/i,
  ],
  kids: [/\b(kill|blood|gun|knife|weapon)\b/i],
  family: [/\b(gore|slaughter)\b/i],
  teen: [],
  adult: [],
};

export function validateStory(
  sequence: Sequence,
  project: Pick<Project, 'characters' | 'environments'> | undefined,
  options: StoryValidationOptions = {},
): CheckResult[] {
  const fps = options.fps ?? DEFAULT_FPS;
  const out: CheckResult[] = [];
  const shots = allShots(sequence);
  const where: Locator = { sequenceId: sequence.id };

  // Structure: something to shoot at all.
  out.push(
    shots.length > 0
      ? pass({
          name: 'story.has_shots',
          department: DEPT,
          score: 1,
          message: `${sequence.scenes.length} scene(s), ${shots.length} shot(s).`,
          where,
        })
      : fail({
          name: 'story.has_shots',
          department: DEPT,
          score: 0,
          severity: 'fatal',
          message: 'The sequence contains no shots.',
          diagnosis: 'story.empty',
          where,
        }),
  );
  if (shots.length === 0) return out;

  // Every shot states its intent and carries at least one beat.
  const noIntent = shots.filter((s) => s.beats.length === 0 || s.beats.some((b) => !b.intent.trim()));
  out.push(
    noIntent.length === 0
      ? pass({
          name: 'story.every_shot_has_intent',
          department: DEPT,
          score: 1,
          message: `All ${shots.length} shots state an intent and carry beats.`,
          where,
        })
      : fail({
          name: 'story.every_shot_has_intent',
          department: DEPT,
          score: 1 - noIntent.length / shots.length,
          severity: 'error',
          message: `${noIntent.length} shot(s) have no stated intent. A shot nobody can state the purpose of cannot be directed, acted or judged.`,
          diagnosis: 'story.missing_intent',
          where: { ...where, shotId: noIntent[0].id },
        }),
  );

  // Entity graph: everything referenced must exist.
  if (project) {
    const charIds = new Set(project.characters.map((c) => c.id));
    const envIds = new Set(project.environments.map((e) => e.id));
    const missingChars = new Set<string>();
    for (const shot of shots) {
      for (const p of shot.staging.characters) if (!charIds.has(p.characterId)) missingChars.add(p.characterId);
      for (const d of shot.dialogue) if (!charIds.has(d.characterId)) missingChars.add(d.characterId);
    }
    const missingEnvs = sequence.scenes.filter((s) => !envIds.has(s.environmentId));
    out.push(
      missingChars.size === 0 && missingEnvs.length === 0
        ? pass({
            name: 'story.entity_graph_resolves',
            department: DEPT,
            score: 1,
            message: 'Every character and location referenced by the script exists in the project.',
            where,
          })
        : fail({
            name: 'story.entity_graph_resolves',
            department: DEPT,
            score: 0,
            severity: 'error',
            message:
              [
                missingChars.size ? `Unknown characters: ${[...missingChars].join(', ')}` : '',
                missingEnvs.length
                  ? `Unknown locations: ${missingEnvs.map((e) => e.environmentId).join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join('. ') + '.',
            diagnosis: 'story.unknown_entity',
            where,
          }),
    );
  }

  // Read-aloud duration against the target runtime.
  const totalFrames = shots.reduce((a, s) => a + s.durationFrames, 0);
  if (options.targetSeconds) {
    const targetFrames = options.targetSeconds * fps;
    const tol = options.durationTolerance ?? 0.15;
    const deviation = Math.abs(totalFrames - targetFrames) / targetFrames;
    out.push(
      measure({
        name: 'story.duration_on_target',
        department: DEPT,
        measured: deviation,
        threshold: tol,
        comparator: '<=',
        floor: tol * 4,
        severity: 'warn',
        message:
          deviation <= tol
            ? `Runtime ${framesToSeconds(totalFrames, fps).toFixed(1)}s is within ${(tol * 100).toFixed(0)}% of the ${options.targetSeconds}s target.`
            : `Runtime ${framesToSeconds(totalFrames, fps).toFixed(1)}s misses the ${options.targetSeconds}s target by ${(deviation * 100).toFixed(0)}%.`,
        diagnosis: totalFrames > targetFrames ? 'story.too_long' : 'story.too_short',
        where,
      }),
    );
  }

  // Dialogue-to-action ratio: "show, don't tell" as a number.
  const dialogueFrames = shots.reduce(
    (a, s) => a + s.dialogue.reduce((b, d) => b + d.durationFrames, 0),
    0,
  );
  const ratio = totalFrames > 0 ? dialogueFrames / totalFrames : 0;
  const maxRatio = options.maxDialogueRatio ?? 0.6;
  out.push(
    measure({
      name: 'story.show_dont_tell',
      department: DEPT,
      measured: ratio,
      threshold: maxRatio,
      comparator: '<=',
      floor: 1,
      severity: 'warn',
      message:
        ratio <= maxRatio
          ? `Dialogue occupies ${(ratio * 100).toFixed(0)}% of screen time; the rest is action.`
          : `Dialogue occupies ${(ratio * 100).toFixed(0)}% of screen time (limit ${(maxRatio * 100).toFixed(0)}%). The story is being told rather than shown.`,
      diagnosis: 'story.too_much_dialogue',
      where,
    }),
  );

  // Dialogue timing must fit inside its shot.
  const overruns = shots.filter((s) =>
    s.dialogue.some((d) => d.startFrame + d.durationFrames > s.durationFrames),
  );
  out.push(
    overruns.length === 0
      ? pass({
          name: 'story.dialogue_fits_shot',
          department: DEPT,
          score: 1,
          message: 'Every line finishes inside the shot that holds it.',
          where,
        })
      : fail({
          name: 'story.dialogue_fits_shot',
          department: DEPT,
          score: 1 - overruns.length / shots.length,
          message: `${overruns.length} shot(s) end before their dialogue does; the line would be cut off mid-word.`,
          diagnosis: 'story.dialogue_overrun',
          where: { ...where, shotId: overruns[0].id },
        }),
  );

  // Read-aloud sanity: the estimated speech duration must match the slot.
  let worstLine: { shot: Shot; ratio: number; text: string } | null = null;
  for (const shot of shots) {
    for (const line of shot.dialogue) {
      const estimate = speechFrames(line.text, fps);
      if (estimate === 0 || line.durationFrames === 0) continue;
      const r = Math.max(estimate / line.durationFrames, line.durationFrames / estimate);
      if (!worstLine || r > worstLine.ratio) worstLine = { shot, ratio: r, text: line.text };
    }
  }
  if (worstLine) {
    out.push(
      measure({
        name: 'story.line_timing_plausible',
        department: DEPT,
        measured: worstLine.ratio,
        threshold: 1.35,
        comparator: '<=',
        floor: 3,
        severity: 'warn',
        message:
          worstLine.ratio <= 1.35
            ? 'Every line has enough room to be spoken at a natural pace.'
            : `"${worstLine.text.slice(0, 48)}" is allotted ${worstLine.ratio.toFixed(2)}x the time a natural read needs.`,
        diagnosis: 'story.line_timing',
        where: { ...where, shotId: worstLine.shot.id },
      }),
    );
  }

  // Age-appropriateness rubric.
  const audience = options.audience ?? 'preschool';
  const flags = AGE_FLAGS[audience] ?? [];
  const hits: { shotId: string; text: string }[] = [];
  for (const shot of shots) {
    const text = [...shot.beats.map((b) => b.action), ...shot.dialogue.map((d) => d.text)].join(' ');
    for (const re of flags) {
      const m = re.exec(text);
      if (m) hits.push({ shotId: shot.id, text: m[0] });
    }
  }
  out.push(
    hits.length === 0
      ? pass({
          name: 'story.age_appropriate',
          department: DEPT,
          score: 1,
          message: `No content flags for a ${audience} audience.`,
          where,
        })
      : fail({
          name: 'story.age_appropriate',
          department: DEPT,
          score: Math.max(0, 1 - hits.length / 5),
          severity: 'error',
          message: `Content flagged for a ${audience} audience: ${[...new Set(hits.map((h) => h.text))].join(', ')}.`,
          diagnosis: 'story.age_inappropriate',
          where: { ...where, shotId: hits[0].shotId },
        }),
  );

  // Scene-level sanity: no scene with zero shots.
  const emptyScenes = sequence.scenes.filter((s) => s.shots.length === 0);
  out.push(
    emptyScenes.length === 0
      ? pass({
          name: 'story.no_empty_scenes',
          department: DEPT,
          score: 1,
          message: 'Every scene contains at least one shot.',
          where,
        })
      : fail({
          name: 'story.no_empty_scenes',
          department: DEPT,
          score: 0,
          message: `Scenes with no shots: ${emptyScenes.map((s) => s.slug).join(', ')}.`,
          diagnosis: 'story.empty_scene',
          where,
        }),
  );

  return out;
}

/**
 * Continuity graph.
 *
 * Props, positions and costume state must carry across shots. A character
 * holding a lantern in shot 4 and empty-handed in shot 5, with no beat that
 * puts it down, is the kind of error an audience notices instantly and a
 * generative pipeline produces constantly.
 */
export type ContinuityIssue = {
  kind: 'prop_teleport' | 'character_vanishes' | 'screen_direction' | 'location_jump';
  shotId: string;
  previousShotId?: string;
  detail: string;
};

export function checkContinuity(sequence: Sequence): {
  issues: ContinuityIssue[];
  checks: CheckResult[];
} {
  const issues: ContinuityIssue[] = [];
  const shots = allShots(sequence);

  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const shot = shots[i];
    const sameScene = prev.sceneId === shot.sceneId;
    if (!sameScene) continue;

    // A character who should still be in frame but is not.
    //
    // Cutting from one character's single to another's is ordinary
    // coverage, not a continuity error, so absence only counts in a shot
    // wide enough to have included them. A two-shot that loses someone
    // between cuts, with no exit beat, is a real break.
    const WIDE = new Set(['mls', 'ls', 'els', 'twoShot']);
    const prevChars = new Set(prev.staging.characters.map((c) => c.characterId));
    const nowChars = new Set(shot.staging.characters.map((c) => c.characterId));
    const exitWords = /\b(exits?|leaves?|walks? off|runs? off|disappears?|hides?|goes? inside)\b/i;
    const prevExits = prev.beats.some((b) => exitWords.test(b.action));
    if (WIDE.has(shot.camera.size) && WIDE.has(prev.camera.size) && !prevExits) {
      for (const c of prevChars) {
        if (nowChars.has(c) || nowChars.size === 0) continue;
        issues.push({
          kind: 'character_vanishes',
          shotId: shot.id,
          previousShotId: prev.id,
          detail: `${c} is in shot ${prev.number} (${prev.camera.size}) and gone from shot ${shot.number} (${shot.camera.size}) with no exit beat. Both shots are wide enough to have shown them.`,
        });
      }
    }

    // Screen direction must hold across a cut unless the camera crosses
    // deliberately (which flips cameraSide).
    if (
      prev.staging.screenDirection !== 'neutral' &&
      shot.staging.screenDirection !== 'neutral' &&
      prev.staging.screenDirection !== shot.staging.screenDirection &&
      prev.staging.cameraSide === shot.staging.cameraSide
    ) {
      issues.push({
        kind: 'screen_direction',
        shotId: shot.id,
        previousShotId: prev.id,
        detail: `Screen direction flips from ${prev.staging.screenDirection} to ${shot.staging.screenDirection} without the camera crossing the line.`,
      });
    }
  }

  const checks: CheckResult[] = [
    issues.length === 0
      ? pass({
          name: 'story.continuity',
          department: DEPT,
          score: 1,
          message: `Continuity holds across all ${shots.length} shots.`,
          where: { sequenceId: sequence.id },
        })
      : fail({
          name: 'story.continuity',
          department: DEPT,
          score: Math.max(0, 1 - issues.length / Math.max(1, shots.length)),
          message: `${issues.length} continuity issue(s): ${issues[0].detail}`,
          diagnosis: `story.${issues[0].kind}`,
          where: { sequenceId: sequence.id, shotId: issues[0].shotId },
        }),
  ];
  return { issues, checks };
}

export function sceneOf(sequence: Sequence, shotId: string): Scene | undefined {
  return sequence.scenes.find((s) => s.shots.some((sh) => sh.id === shotId));
}
