/**
 * Screenplay to shot list.
 *
 * The output is Film Graph structure, not prose: every shot carries intent,
 * beats, dialogue with frame timing, a camera spec and staging. A shot
 * without intent is rejected by the story validators, because a shot nobody
 * can state the purpose of is a shot nobody can direct.
 */

import type {
  Sequence,
  Scene,
  Shot,
  Beat,
  Line,
  ShotSize,
  ShotAngle,
  ExpressionName,
  Placement,
  Staging,
} from '../graph/types.ts';
import { parseFountain, parseSceneHeading } from './fountain.ts';
import type { FountainScript, FountainElement } from './fountain.ts';
import { makeId } from '../core/ids.ts';
import { speechFrames, DEFAULT_FPS } from '../core/units.ts';
import { emptyChart } from '../timing/chart.ts';
import { staticCurve } from '../render/camera.ts';

export type BreakdownOptions = {
  fps?: number;
  /** Map from screenplay character name to Film Graph character id. */
  characterIds?: Record<string, string>;
  /** Map from location slug to environment id. */
  environmentIds?: Record<string, string>;
  /** Minimum frames any shot may hold. */
  minShotFrames?: number;
  /** Frames of air before and after a line inside its shot. */
  dialoguePadFrames?: number;
};

/** Emotion inference from a parenthetical or line punctuation. */
const EMOTION_WORDS: Record<string, ExpressionName> = {
  quietly: 'sad',
  sadly: 'sad',
  softly: 'sad',
  whispered: 'scared',
  scared: 'scared',
  afraid: 'scared',
  angrily: 'angry',
  sharply: 'angry',
  firmly: 'determined',
  determined: 'determined',
  brightly: 'happy',
  happily: 'happy',
  laughing: 'happy',
  excited: 'happy',
  surprised: 'surprised',
  gasping: 'surprised',
  thinking: 'thinking',
  wondering: 'thinking',
  curious: 'thinking',
};

export function inferEmotion(direction: string | undefined, text: string): ExpressionName {
  const hay = `${direction ?? ''} ${text}`.toLowerCase();
  for (const [word, emotion] of Object.entries(EMOTION_WORDS)) {
    if (hay.includes(word)) return emotion;
  }
  if (/[!]{1,}$/.test(text.trim())) return 'surprised';
  if (/\?$/.test(text.trim())) return 'thinking';
  return 'neutral';
}

export function inferIntensity(direction: string | undefined, text: string): number {
  const exclaims = (text.match(/!/g) ?? []).length;
  const caps = /^[A-Z\s!?.']+$/.test(text.trim()) && text.trim().length > 4;
  let n = 2 + exclaims;
  if (caps) n += 1;
  if (direction && /(quiet|soft|whisper)/i.test(direction)) n -= 1;
  return Math.max(1, Math.min(5, n));
}

/**
 * Shot-size progression.
 *
 * Coverage is not random: a scene opens wide to establish, tightens for
 * dialogue and emotion, and cuts wide again on a move or an exit. The
 * shot-grammar validator checks variety against this, so it is generated
 * from the same rules it is judged by.
 */
export function chooseShotSize(options: {
  index: number;
  total: number;
  hasDialogue: boolean;
  intensity: number;
  isEstablishing: boolean;
  characterCount: number;
  previous?: ShotSize;
}): ShotSize {
  if (options.isEstablishing) return 'els';
  if (options.characterCount >= 2 && !options.hasDialogue) return 'twoShot';
  if (options.hasDialogue) {
    if (options.intensity >= 4) return 'cu';
    if (options.intensity >= 3) return 'mcu';
    // Avoid repeating the previous size — flat coverage reads as cheap.
    return options.previous === 'ms' ? 'mcu' : 'ms';
  }
  if (options.index === options.total - 1) return 'mls';
  return options.previous === 'ms' ? 'mls' : 'ms';
}

export function chooseAngle(intensity: number, emotion: ExpressionName): ShotAngle {
  if (emotion === 'sad' || emotion === 'scared') return 'high';
  if (emotion === 'determined' || intensity >= 4) return 'low';
  return 'eye';
}

type PendingShot = {
  action: string[];
  lines: { character: string; text: string; direction?: string }[];
  shotHint?: string;
};

/**
 * Break a screenplay into scenes and shots.
 *
 * The unit of a shot is a beat: a run of action, or one character's line.
 * Action that names a new subject starts a new shot; consecutive lines from
 * the same character stay together.
 */
export function scriptToSequence(
  script: FountainScript | string,
  options: BreakdownOptions = {},
): Sequence {
  const parsed = typeof script === 'string' ? parseFountain(script) : script;
  const fps = options.fps ?? DEFAULT_FPS;
  const minShot = options.minShotFrames ?? Math.round(fps * 0.75);
  const pad = options.dialoguePadFrames ?? Math.round(fps * 0.25);
  const charId = (name: string): string =>
    options.characterIds?.[name] ?? `char_${name.toLowerCase().replace(/\s+/g, '_')}`;

  const scenes: Scene[] = [];
  let current: { heading: ReturnType<typeof parseSceneHeading>; pending: PendingShot[] } | null = null;
  const title = parsed.titlePage.title ?? 'Untitled';

  const flush = (): void => {
    if (!current) return;
    const sceneNumber = scenes.length + 1;
    const sceneId = makeId('scene', `${title}:${sceneNumber}`);
    const envKey = current.heading.location.toLowerCase().replace(/\s+/g, '_');
    const shots: Shot[] = [];

    current.pending.forEach((p, idx) => {
      const shotNumber = idx + 1;
      const shotId = makeId('shot', `${sceneId}:${shotNumber}`);
      const actionText = p.action.join(' ').trim();
      const subjects = [...new Set(p.lines.map((l) => l.character))];
      const mentioned = detectSubjects(actionText);
      for (const m of mentioned) if (!subjects.includes(m)) subjects.push(m);

      let cursor = p.lines.length ? pad : 0;
      const dialogue: Line[] = p.lines.map((l) => {
        const frames = speechFrames(l.text, fps);
        const line: Line = {
          id: makeId('line', `${shotId}:${l.character}:${l.text.slice(0, 24)}`),
          characterId: charId(l.character),
          text: l.text,
          direction: l.direction,
          startFrame: cursor,
          durationFrames: frames,
        };
        cursor += frames + pad;
        return line;
      });

      const beats: Beat[] = [];
      if (actionText) {
        const frames = Math.max(minShot, Math.round(actionFrames(actionText, fps)));
        beats.push({
          id: makeId('beat', `${shotId}:action`),
          intent: intentFromAction(actionText),
          action: actionText,
          emotion: inferEmotion(undefined, actionText),
          intensity: inferIntensity(undefined, actionText),
          startFrame: 0,
          durationFrames: frames,
          characterId: subjects.length ? charId(subjects[0]) : undefined,
        });
      }
      for (const l of dialogue) {
        const src = p.lines.find((x) => charId(x.character) === l.characterId && x.text === l.text);
        beats.push({
          id: makeId('beat', `${shotId}:${l.id}`),
          intent: intentFromLine(l.text, src?.direction),
          action: `${nameOf(l.characterId)} says: ${l.text}`,
          emotion: inferEmotion(src?.direction, l.text),
          intensity: inferIntensity(src?.direction, l.text),
          startFrame: l.startFrame,
          durationFrames: l.durationFrames,
          characterId: l.characterId,
        });
      }
      if (beats.length === 0) {
        beats.push({
          id: makeId('beat', `${shotId}:hold`),
          intent: 'Hold on the moment so the audience can absorb it.',
          action: 'Character holds, breathing.',
          emotion: 'neutral',
          intensity: 1,
          startFrame: 0,
          durationFrames: minShot,
          characterId: subjects.length ? charId(subjects[0]) : undefined,
        });
      }

      const durationFrames = Math.max(
        minShot,
        cursor > 0 ? cursor : 0,
        ...beats.map((b) => b.startFrame + b.durationFrames),
      );

      const dominant = beats.reduce((a, b) => (b.intensity > a.intensity ? b : a), beats[0]);
      const size = chooseShotSize({
        index: idx,
        total: current!.pending.length,
        hasDialogue: dialogue.length > 0,
        intensity: dominant.intensity,
        isEstablishing: idx === 0 && sceneNumber === 1 && dialogue.length === 0,
        characterCount: subjects.length,
        previous: shots[shots.length - 1]?.camera.size,
      });

      const staging = buildStaging(subjects.map(charId), idx);

      shots.push({
        id: shotId,
        number: shotNumber,
        sceneId,
        durationFrames,
        camera: {
          size,
          angle: chooseAngle(dominant.intensity, dominant.emotion),
          move: staticCurve({ position: { x: 0, y: 0 }, zoom: 1, rotation: 0 }),
        },
        staging,
        beats,
        dialogue,
        keys: [],
        timing: emptyChart(),
        curves: [],
        secondary: [],
        fx: [],
        comp: { layers: [] },
        audio: { vo: dialogue.map((d) => d.id), sfx: [] },
        organicPass: 'off',
        lockedAssets: {},
        repairs: [],
        status: 'planned',
        notes: [],
      });
    });

    scenes.push({
      id: sceneId,
      number: sceneNumber,
      slug: current.heading.raw,
      environmentId: options.environmentIds?.[envKey] ?? `env_${envKey}`,
      timeOfDay: normaliseTimeOfDay(current.heading.timeOfDay, current.heading.interior),
      shots,
    });
    current = null;
  };

  let pending: PendingShot | null = null;
  const pushPending = (): void => {
    if (current && pending && (pending.action.length || pending.lines.length)) {
      current.pending.push(pending);
    }
    pending = null;
  };

  for (const el of parsed.elements) {
    switch (el.type) {
      case 'sceneHeading':
        pushPending();
        flush();
        current = { heading: parseSceneHeading(el.text), pending: [] };
        break;
      case 'shot':
        pushPending();
        pending = { action: [], lines: [], shotHint: el.text };
        break;
      case 'action':
        // A new subject in the action means a new shot.
        if (pending && pending.lines.length > 0) pushPending();
        pending ??= { action: [], lines: [] };
        pending.action.push(el.text);
        break;
      case 'character':
        pending ??= { action: [], lines: [] };
        pending.lines.push({ character: el.character ?? el.text, text: '' });
        break;
      case 'parenthetical': {
        const last = pending?.lines[pending.lines.length - 1];
        if (last) last.direction = el.text;
        break;
      }
      case 'dialogue': {
        const last = pending?.lines[pending.lines.length - 1];
        if (last) last.text = `${last.text} ${el.text}`.trim();
        break;
      }
      case 'transition':
        pushPending();
        break;
      default:
        break;
    }
  }
  pushPending();
  flush();

  return {
    id: makeId('seq', title),
    number: 1,
    name: title,
    scenes,
    colorScript: scenes.map((s) => ({
      sceneId: s.id,
      swatches: [],
      note: `${s.slug} — colour key to be set in visual development.`,
    })),
  };
}

function nameOf(characterId: string): string {
  return characterId.replace(/^char_/, '').replace(/_/g, ' ').toUpperCase();
}

function detectSubjects(action: string): string[] {
  const matches = action.match(/\b[A-Z][A-Z0-9]{1,}\b/g) ?? [];
  const stop = new Set(['I', 'A', 'THE', 'CUT', 'TO', 'ON', 'IN', 'OUT', 'OK']);
  return [...new Set(matches.filter((m) => !stop.has(m)))];
}

/** Action prose runs at roughly one second of screen time per eight words. */
function actionFrames(text: string, fps: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(fps * 0.5, (words / 8) * fps);
}

function intentFromAction(action: string): string {
  const clean = action.replace(/\s+/g, ' ').trim();
  // Lower-casing the lead-in reads better, except when the sentence opens
  // on a character name — "mIBO sits alone" is not an improvement.
  const firstWord = clean.split(/\s+/)[0] ?? '';
  const isProperNoun = firstWord.length > 1 && firstWord === firstWord.toUpperCase();
  const body = isProperNoun ? clean : `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
  return `The audience understands: ${body}`;
}

function intentFromLine(text: string, direction?: string): string {
  const tone = direction ? ` (${direction})` : '';
  return `The audience hears and believes${tone}: "${text}"`;
}

function normaliseTimeOfDay(raw: string, interior: boolean): Scene['timeOfDay'] {
  const t = raw.toUpperCase();
  if (t.includes('DAWN') || t.includes('MORNING')) return 'dawn';
  if (t.includes('DUSK') || t.includes('SUNSET') || t.includes('EVENING')) return 'dusk';
  if (t.includes('NIGHT')) return 'night';
  if (interior && !t.includes('DAY')) return 'interior';
  return 'day';
}

/**
 * Default staging. Two characters face each other across the action line,
 * the camera stays on side A, and screen direction is consistent — the
 * three things the 180-degree rule is about.
 */
function buildStaging(characterIds: readonly string[], shotIndex: number): Staging {
  const characters: Placement[] = characterIds.map((id, i) => {
    const facingRight = characterIds.length > 1 ? i === 0 : true;
    return {
      characterId: id,
      view: characterIds.length > 1 ? (facingRight ? 'threeQuarterR' : 'threeQuarterL') : 'front',
      position: { x: characterIds.length > 1 ? (i === 0 ? -110 : 110) : 0, y: 0 },
      scale: 1,
      facingRight,
      // Characters stand on the ground plane, so they sit well forward in
      // the multiplane stack. The pipeline refines this against the actual
      // environment; 0.85 is the sane default for a character on their feet.
      depth: 0.85,
    };
  });
  const eyelines: Record<string, Point2> = {};
  characters.forEach((c, i) => {
    const other = characters[(i + 1) % characters.length];
    eyelines[c.characterId] = other && other !== c ? { ...other.position } : { x: 0, y: -40 };
  });
  return {
    characters,
    eyelines,
    screenDirection: characters.length > 1 ? 'right' : 'neutral',
    cameraSide: 'A',
    actionLine:
      characters.length > 1
        ? [{ ...characters[0].position }, { ...characters[1].position }]
        : undefined,
  };
}

type Point2 = { x: number; y: number };

/** Total runtime of a sequence in frames. */
export function sequenceFrames(sequence: Sequence): number {
  return sequence.scenes.reduce(
    (a, s) => a + s.shots.reduce((b, sh) => b + sh.durationFrames, 0),
    0,
  );
}

export function allShots(sequence: Sequence): Shot[] {
  return sequence.scenes.flatMap((s) => s.shots);
}

export function findShot(sequence: Sequence, shotId: string): Shot | undefined {
  return allShots(sequence).find((s) => s.id === shotId);
}

export type { FountainElement };
