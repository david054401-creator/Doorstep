/**
 * Department rubrics for the vision-language critics.
 *
 * Each rubric asks one falsifiable question and lists what counts as a
 * failure. Open-ended prompts produce flattery; a list of specific things
 * to scan for produces findings.
 *
 * Every rubric requires frame citations. A verdict that cannot point at a
 * frame is not admissible, because it cannot be checked, repaired, or
 * shown to a human.
 */

import type { Rubric } from '../types.ts';

export const SILHOUETTE_RUBRIC: Rubric = {
  id: 'silhouette.reads',
  department: 'animation',
  title: 'Silhouette readability',
  question:
    'Each image is a solid black silhouette of a character. For each frame, say in a few words what action the character is performing. If you cannot tell, say "unreadable".',
  passWhen: [
    'The stated action matches the beat the shot is meant to convey.',
    'The pose is distinguishable from a neutral standing pose.',
  ],
  failWhen: [
    'The silhouette reads as an undifferentiated blob.',
    'Limbs are lost inside the body outline.',
    'Two frames intended as different poses read identically.',
  ],
  frameCount: 5,
  diagnosis: 'animation.unreadable_silhouette',
  severity: 'error',
};

export const ON_MODEL_RUBRIC: Rubric = {
  id: 'character.on_model',
  department: 'character',
  title: 'On-model check',
  question:
    'The first image is the approved model sheet. The rest are frames from a shot. For each frame, state whether the character matches the sheet, and if not, name the specific difference.',
  passWhen: [
    'Proportions, colour and features match the sheet.',
    'Any difference is explained by pose or perspective rather than by design drift.',
  ],
  failWhen: [
    'Head-to-body ratio differs visibly from the sheet.',
    'A colour is wrong, or a marking is missing, added or moved.',
    'A feature changes shape between frames of the same shot.',
    'The line weight differs from the sheet.',
  ],
  frameCount: 6,
  diagnosis: 'animation.off_model_proportions',
  severity: 'error',
};

export const RIG_BREAK_RUBRIC: Rubric = {
  id: 'rig.anything_broken',
  department: 'rigging',
  title: 'Rig battery review',
  question:
    'These are a character rig posed through a range-of-motion battery. For each frame, state whether anything is visually broken, and name it precisely.',
  passWhen: [
    'Every pose looks like a solid, connected character.',
    'Overlaps read as one form in front of another, not as a tear.',
  ],
  failWhen: [
    'A limb is detached, pinched, or folded through the body.',
    'A joint creases into a hard crease or a spike.',
    'A part is drawn in front of or behind something it should not be.',
    'The outline breaks or doubles back on itself.',
  ],
  frameCount: 8,
  diagnosis: 'rig.mesh_inversion',
  severity: 'fatal',
};

export const ACTING_RUBRIC: Rubric = {
  id: 'animation.acting_reads',
  department: 'animation',
  title: 'Acting and emotion',
  question:
    'These frames come from one shot whose intent is given in the context. For each frame, name the emotion the pose and face convey, and rate how strongly it reads from 1 to 5.',
  passWhen: [
    'The named emotion matches the beat.',
    'The strongest reading lands on the beat\'s peak frame.',
  ],
  failWhen: [
    'The pose reads as neutral where the beat calls for emotion.',
    'The face and the body contradict each other.',
    'The emotion is named only from context rather than from the image.',
  ],
  frameCount: 6,
  diagnosis: 'animation.underplayed_peak',
  severity: 'warn',
};

export const STYLE_RUBRIC: Rubric = {
  id: 'style.bible_conformance',
  department: 'visdev',
  title: 'Style bible conformance',
  question:
    'The style bible is given in the context, including a list of forbidden treatments. For each frame, state whether it conforms, and cite any forbidden treatment you find.',
  passWhen: [
    'Shape language, line quality and shading model match the bible.',
    'Nothing on the forbidden list appears.',
  ],
  failWhen: [
    'A forbidden treatment appears (gradients on characters, photographic texture, lens flare, visible text).',
    'The line weight or shading model differs from the bible.',
    'The frame reads as a different show from the reference.',
  ],
  frameCount: 4,
  diagnosis: 'color.off_bible_palette',
  severity: 'error',
};

export const AI_TELLS_RUBRIC: Rubric = {
  id: 'layout.ai_tells',
  department: 'layout',
  title: 'Generated-image artefacts',
  question:
    'Examine each background for the specific artefacts that betray a generated image. List each one you find with its location in the frame.',
  passWhen: [
    'Geometry is coherent and perspective is consistent.',
    'Repeated elements are deliberate, not duplicated by accident.',
  ],
  failWhen: [
    'An object is duplicated or half-duplicated.',
    'Perspective lines disagree, or an object has impossible geometry.',
    'Text, signage or a watermark appears.',
    'A surface dissolves into texture with no structure.',
    'An object melts into or through another.',
  ],
  frameCount: 4,
  diagnosis: 'layout.ai_artifact',
  severity: 'error',
};

export const STAGING_RUBRIC: Rubric = {
  id: 'boards.staging_reads',
  department: 'boards',
  title: 'Staging and readability',
  question:
    'For each board, state in one sentence what is happening. Then state whether the framing makes the most important thing in the shot the easiest thing to see.',
  passWhen: [
    'The stated action matches the shot\'s intent in the context.',
    'The subject is the clearest element in the frame.',
  ],
  failWhen: [
    'The described action does not match the intent.',
    'The subject competes with the background for attention.',
    'The important part of the action is cropped or occluded.',
  ],
  frameCount: 6,
  diagnosis: 'grammar.flat_coverage',
  severity: 'warn',
};

export const INBETWEEN_RUBRIC: Rubric = {
  id: 'organic.inbetween_quality',
  department: 'animation',
  title: 'Organic pass review',
  question:
    'These are consecutive frames. The middle frames were generated between the first and the last. Identify any frame where the generated image fails to be a plausible inbetween.',
  passWhen: [
    'Every frame is a plausible stage of one continuous motion.',
    'The character stays the same character throughout.',
  ],
  failWhen: [
    'A frame invents or loses detail that has no explanation in the motion.',
    'The character\'s proportions or colour shift mid-sequence.',
    'Motion reverses or stutters.',
    'The line quality changes between frames.',
  ],
  frameCount: 7,
  diagnosis: 'organic.bad_inbetween',
  severity: 'error',
};

export const ALL_RUBRICS: Rubric[] = [
  SILHOUETTE_RUBRIC,
  ON_MODEL_RUBRIC,
  RIG_BREAK_RUBRIC,
  ACTING_RUBRIC,
  STYLE_RUBRIC,
  AI_TELLS_RUBRIC,
  STAGING_RUBRIC,
  INBETWEEN_RUBRIC,
];

export function rubricById(id: string): Rubric | undefined {
  return ALL_RUBRICS.find((r) => r.id === id);
}

/**
 * Render a rubric into the instruction text a vision model receives.
 *
 * The frame-citation requirement and the refusal-to-guess instruction are
 * not optional decoration: without them a critic returns agreeable prose
 * and the gate becomes theatre.
 */
export function renderRubricPrompt(
  rubric: Rubric,
  context: { styleBible?: string; intent?: string; characters?: string[]; extra?: Record<string, string> },
  frameNumbers: readonly number[],
): string {
  const lines: string[] = [];
  lines.push(`You are the ${rubric.department} critic on an animated series. Task: ${rubric.title}.`);
  lines.push('');
  lines.push(rubric.question);
  lines.push('');
  lines.push(`The images provided are frames ${frameNumbers.join(', ')}, in that order.`);
  if (context.intent) lines.push(`Shot intent: ${context.intent}`);
  if (context.characters?.length) lines.push(`Characters in shot: ${context.characters.join(', ')}`);
  if (context.styleBible) {
    lines.push('');
    lines.push('Style bible:');
    lines.push(context.styleBible);
  }
  for (const [k, v] of Object.entries(context.extra ?? {})) lines.push(`${k}: ${v}`);
  lines.push('');
  lines.push('It passes when all of these hold:');
  for (const p of rubric.passWhen) lines.push(`  - ${p}`);
  lines.push('');
  lines.push('It fails if any of these are present:');
  for (const f of rubric.failWhen) lines.push(`  - ${f}`);
  lines.push('');
  lines.push(
    'Answer with JSON only, matching this shape exactly:\n' +
      '{"verdict":"pass"|"fail"|"uncertain","confidence":0..1,' +
      '"citations":[{"frame":<number>,"note":"<what you see at this frame>"}],' +
      '"rationale":"<two sentences at most>"}',
  );
  lines.push('');
  lines.push(
    'Rules. Cite a frame number for every problem you report; a finding without a citation will be discarded. ' +
      'Describe only what is visible in the images — do not infer from the context what ought to be there. ' +
      'If the images do not let you answer, return "uncertain" rather than guessing. ' +
      'Do not be agreeable: your job is to find what is wrong.',
  );
  return lines.join('\n');
}
