/**
 * Cue sheet: beats to music and effects cues.
 *
 * Music is not decoration laid over a finished film; it is written against
 * the beats. The cue sheet is derived from the Film Graph, so a story
 * change re-derives the music brief automatically.
 */

import type { Sequence, Shot, Beat, ExpressionName } from '../graph/types.ts';
import { allShots } from '../story/script-to-shots.ts';
import { framesToSeconds, DEFAULT_FPS } from '../core/units.ts';
import { makeId } from '../core/ids.ts';

export type MusicCue = {
  id: string;
  /** Frame the cue starts, relative to the sequence. */
  startFrame: number;
  durationFrames: number;
  /** What the cue has to do dramatically. */
  intent: string;
  /** Mood words, fed to the music provider's brief. */
  mood: string[];
  /** Beats per minute suggestion, derived from the cut rhythm. */
  bpm: number;
  /** Instrumentation hint from the style bible. */
  instrumentation: string[];
  /** Frames where the music must hit the picture. */
  hitFrames: number[];
  gainDb: number;
};

export type SfxCue = {
  id: string;
  shotId: string;
  startFrame: number;
  /** What the sound is. */
  description: string;
  /** Frame it must land on, if it is synced to an action. */
  hitFrame?: number;
  gainDb: number;
};

const MOOD_BY_EMOTION: Record<ExpressionName, string[]> = {
  neutral: ['warm', 'gentle', 'open'],
  happy: ['bright', 'bouncing', 'major'],
  sad: ['sparse', 'soft', 'minor', 'slow'],
  angry: ['driving', 'low', 'insistent'],
  surprised: ['sudden', 'rising', 'bright'],
  scared: ['tense', 'thin', 'held'],
  thinking: ['curious', 'stepping', 'light'],
  determined: ['building', 'steady', 'forward'],
};

/**
 * Build a cue sheet for a sequence.
 *
 * One cue per emotional run: consecutive scenes that share a dominant
 * emotion get one piece of music, and the cue changes where the feeling
 * does — which is how scoring actually works.
 */
export function buildCueSheet(
  sequence: Sequence,
  options: { fps?: number; instrumentation?: string[] } = {},
): { music: MusicCue[]; sfx: SfxCue[] } {
  const fps = options.fps ?? DEFAULT_FPS;
  const instrumentation = options.instrumentation ?? ['ukulele', 'glockenspiel', 'soft strings', 'light percussion'];
  const shots = allShots(sequence);
  const music: MusicCue[] = [];
  const sfx: SfxCue[] = [];

  let cursor = 0;
  let runStart = 0;
  let runEmotion: ExpressionName | null = null;
  let runShots: Shot[] = [];

  const flush = (endFrame: number): void => {
    if (!runEmotion || runShots.length === 0) return;
    const cuts = runShots.length;
    const seconds = Math.max(0.5, framesToSeconds(endFrame - runStart, fps));
    // Cut rhythm suggests tempo: faster cutting wants a faster cue.
    const bpm = Math.round(Math.max(60, Math.min(160, (cuts / seconds) * 60 * 4)));
    music.push({
      id: makeId('cue', `${sequence.id}:${runStart}`),
      startFrame: runStart,
      durationFrames: endFrame - runStart,
      intent: `Carry the ${runEmotion} run across ${cuts} shot(s) without pulling focus from the dialogue.`,
      mood: MOOD_BY_EMOTION[runEmotion],
      bpm,
      instrumentation,
      hitFrames: runShots
        .flatMap((s) => s.beats.filter((b) => b.intensity >= 4).map((b) => b.startFrame))
        .sort((a, b) => a - b),
      // Under dialogue the score sits well down; over action it comes up.
      gainDb: runShots.some((s) => s.dialogue.length > 0) ? -18 : -10,
    });
  };

  for (const shot of shots) {
    const dominant = dominantEmotion(shot.beats);
    if (runEmotion === null) {
      runEmotion = dominant;
      runStart = cursor;
      runShots = [shot];
    } else if (dominant !== runEmotion) {
      flush(cursor);
      runEmotion = dominant;
      runStart = cursor;
      runShots = [shot];
    } else {
      runShots.push(shot);
    }

    for (const beat of shot.beats) {
      const description = sfxFor(beat);
      if (!description) continue;
      sfx.push({
        id: makeId('sfx', `${shot.id}:${beat.id}`),
        shotId: shot.id,
        startFrame: beat.startFrame,
        description,
        hitFrame: beat.startFrame + Math.round(beat.durationFrames * 0.35),
        gainDb: -12 + beat.intensity,
      });
    }
    cursor += shot.durationFrames;
  }
  flush(cursor);
  return { music, sfx };
}

function dominantEmotion(beats: readonly Beat[]): ExpressionName {
  if (beats.length === 0) return 'neutral';
  const weights = new Map<ExpressionName, number>();
  for (const b of beats) {
    weights.set(b.emotion, (weights.get(b.emotion) ?? 0) + b.intensity * b.durationFrames);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function sfxFor(beat: Beat): string | null {
  const a = beat.action.toLowerCase();
  if (/\b(jump|leap|hop|bounce)/.test(a)) return 'soft boing on the launch, light thump on the landing';
  if (/\b(run|runs|dash)/.test(a)) return 'quick light footsteps on grass';
  if (/\b(walk|walks|step)/.test(a)) return 'gentle footsteps on grass';
  if (/\b(sit|sits)/.test(a)) return 'soft settle into grass';
  if (/\b(stand|stands|rises)/.test(a)) return 'cloth rustle as the character rises';
  if (/\b(spin|spins|turn)/.test(a)) return 'light whoosh';
  if (/\b(point|points)/.test(a)) return 'tiny sparkle accent';
  return null;
}

/** Flatten a cue sheet into a brief a music provider can act on. */
export function cueBrief(cue: MusicCue, fps = DEFAULT_FPS): string {
  return [
    `${framesToSeconds(cue.durationFrames, fps).toFixed(1)} seconds, around ${cue.bpm} bpm.`,
    `Mood: ${cue.mood.join(', ')}.`,
    `Instrumentation: ${cue.instrumentation.join(', ')}.`,
    `Purpose: ${cue.intent}`,
    cue.hitFrames.length
      ? `Hit points at ${cue.hitFrames.map((f) => framesToSeconds(f - cue.startFrame, fps).toFixed(2) + 's').join(', ')}.`
      : 'No hard hit points; keep it flowing.',
    'Leave the 1-4 kHz band clear for dialogue.',
  ].join(' ');
}
