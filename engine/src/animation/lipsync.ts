/**
 * Lipsync: text or phonemes to Preston Blair viseme timing.
 *
 * Rhubarb-compatible: the nine mouth shapes A-H and X. When forced
 * alignment is available (whisperX, MFA, Rhubarb itself) the phoneme
 * timeline drives this directly; without it, a grapheme-to-phoneme pass
 * over the line gives timing good enough for an animatic and for the
 * lipsync-offset validator to be meaningful.
 */

import type { Line, Viseme } from '../graph/types.ts';
import { DEFAULT_FPS } from '../core/units.ts';

/**
 * ARPAbet phoneme to Preston Blair shape.
 *
 * A: closed, M B P
 * B: slightly open with teeth, most consonants
 * C: open, E-like vowels
 * D: wide open, AI-like vowels
 * E: rounded small, O-like
 * F: teeth on lip, F V
 * G: narrow round, U W Q
 * H: L, tongue visible
 * X: rest
 */
export const PHONEME_TO_VISEME: Record<string, Viseme> = {
  // Closed
  M: 'A', B: 'A', P: 'A',
  // Teeth on lip
  F: 'F', V: 'F',
  // Tongue
  L: 'H',
  // Rounded narrow
  UW: 'G', UH: 'G', W: 'G', OW: 'G', OY: 'G',
  // Rounded open
  AO: 'E', AA: 'D', AH: 'C', AE: 'D', AY: 'D', AW: 'D',
  EH: 'C', EY: 'C', ER: 'C', IH: 'B', IY: 'B',
  // Consonants
  T: 'B', D: 'B', K: 'B', G: 'B', N: 'B', NG: 'B',
  S: 'B', Z: 'B', SH: 'B', ZH: 'B', CH: 'B', JH: 'B',
  TH: 'B', DH: 'B', R: 'E', Y: 'B', HH: 'C',
  SIL: 'X',
};

/** Very small grapheme-to-phoneme approximation for English. */
const GRAPHEME_RULES: [RegExp, string[]][] = [
  [/^ough/i, ['AO', 'F']],
  [/^tion/i, ['SH', 'AH', 'N']],
  [/^sh/i, ['SH']],
  [/^ch/i, ['CH']],
  [/^th/i, ['TH']],
  [/^ph/i, ['F']],
  [/^ck/i, ['K']],
  [/^ng/i, ['NG']],
  [/^qu/i, ['K', 'W']],
  [/^oo/i, ['UW']],
  [/^ee/i, ['IY']],
  [/^ea/i, ['IY']],
  [/^ai/i, ['EY']],
  [/^ay/i, ['EY']],
  [/^ou/i, ['AW']],
  [/^ow/i, ['OW']],
  [/^oi/i, ['OY']],
  [/^oy/i, ['OY']],
  [/^a/i, ['AE']],
  [/^e/i, ['EH']],
  [/^i/i, ['IH']],
  [/^o/i, ['AA']],
  [/^u/i, ['AH']],
  [/^y/i, ['IY']],
  [/^b/i, ['B']],
  [/^c/i, ['K']],
  [/^d/i, ['D']],
  [/^f/i, ['F']],
  [/^g/i, ['G']],
  [/^h/i, ['HH']],
  [/^j/i, ['JH']],
  [/^k/i, ['K']],
  [/^l/i, ['L']],
  [/^m/i, ['M']],
  [/^n/i, ['N']],
  [/^p/i, ['P']],
  [/^r/i, ['R']],
  [/^s/i, ['S']],
  [/^t/i, ['T']],
  [/^v/i, ['V']],
  [/^w/i, ['W']],
  [/^x/i, ['K', 'S']],
  [/^z/i, ['Z']],
];

export function graphemesToPhonemes(word: string): string[] {
  let rest = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: string[] = [];
  let guard = 0;
  while (rest.length > 0 && guard++ < 128) {
    let matched = false;
    for (const [re, phonemes] of GRAPHEME_RULES) {
      const m = re.exec(rest);
      if (m) {
        out.push(...phonemes);
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) rest = rest.slice(1);
  }
  // A silent trailing 'e' does not get its own shape — but only when the
  // word already has a vowel before it. "make" and "time" end silently;
  // "the" and "be" do not, and dropping their vowel leaves a mouth that
  // never opens.
  const hasEarlierVowel = out
    .slice(0, -1)
    .some((p) => /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/.test(p));
  if (word.length > 3 && /e$/i.test(word) && hasEarlierVowel && out[out.length - 1] === 'EH') {
    out.pop();
  }
  return out.length ? out : ['AH'];
}

/**
 * Mouth shapes that must never be dropped, however short.
 * A closes the lips (M, B, P); F puts the teeth on the lip (F, V).
 */
export const PROTECTED_VISEMES: ReadonlySet<Viseme> = new Set<Viseme>(['A', 'F']);

export type PhonemeSpan = { phoneme: string; startFrame: number; endFrame: number };
export type VisemeSpan = { viseme: Viseme; startFrame: number; endFrame: number };

/**
 * Distribute phonemes across a line's frame span.
 *
 * Vowels hold longer than consonants — roughly 2:1 — which is what makes
 * synthesised lipsync read as speech rather than chatter.
 */
export function phonemeTimeline(
  text: string,
  startFrame: number,
  durationFrames: number,
): PhonemeSpan[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationFrames <= 0) return [];
  const isVowel = (p: string): boolean => /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/.test(p);

  type Unit = { phoneme: string; weight: number };
  const units: Unit[] = [];
  words.forEach((w, wi) => {
    for (const p of graphemesToPhonemes(w)) {
      units.push({ phoneme: p, weight: isVowel(p) ? 2 : 1 });
    }
    // A short rest between words, and a longer one after punctuation.
    if (wi < words.length - 1) {
      units.push({ phoneme: 'SIL', weight: /[,;:.!?]$/.test(w) ? 1.6 : 0.5 });
    }
  });

  const totalWeight = units.reduce((a, u) => a + u.weight, 0);
  if (totalWeight <= 0) return [];

  // Allocate whole frames, exactly.
  //
  // Spans must tile the line with no gaps and no overlaps, or the viseme
  // track built from them contradicts the phonemes it came from and the
  // sync check reports drift that is really an accounting error. Frames
  // are handed out by largest remainder; when a line has more phonemes
  // than frames some get nothing, which is honest — you cannot articulate
  // thirteen mouth shapes in fourteen frames at 24fps.
  const exact = units.map((u) => (u.weight / totalWeight) * durationFrames);
  const whole = exact.map(Math.floor);
  let remaining = Math.round(durationFrames) - whole.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    whole[i]++;
    remaining--;
  }

  const spans: PhonemeSpan[] = [];
  let cursor = Math.round(startFrame);
  for (let i = 0; i < units.length; i++) {
    if (whole[i] <= 0) continue;
    spans.push({
      phoneme: units[i].phoneme,
      startFrame: cursor,
      endFrame: cursor + whole[i],
    });
    cursor += whole[i];
  }
  return spans;
}

/**
 * Collapse a phoneme timeline into viseme spans.
 *
 * Adjacent identical shapes merge, and any shape shorter than two frames is
 * absorbed — a mouth that changes on every single frame reads as a flicker,
 * not as speech.
 */
export function phonemesToVisemes(
  phonemes: readonly PhonemeSpan[],
  minHoldFrames = 2,
): VisemeSpan[] {
  let spans: VisemeSpan[] = phonemes.map((p) => ({
    viseme: PHONEME_TO_VISEME[p.phoneme] ?? 'B',
    startFrame: p.startFrame,
    endFrame: p.endFrame,
  }));

  // Merging adjacent duplicates can create new adjacent duplicates once a
  // too-short span between them is absorbed, so both passes repeat until
  // the timeline stops changing.
  for (let iteration = 0; iteration < 8; iteration++) {
    const merged: VisemeSpan[] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && last.viseme === span.viseme) {
        last.endFrame = span.endFrame;
        continue;
      }
      merged.push({ ...span });
    }
    const absorbed: VisemeSpan[] = [];
    for (const span of merged) {
      const len = span.endFrame - span.startFrame;
      const last = absorbed[absorbed.length - 1];
      // Some shapes carry the word and must survive even one frame long.
      // A bilabial that does not close the lips turns "hum" into
      // something the audience can see is wrong, and a teeth-on-lip F is
      // just as conspicuous. Everything else may be absorbed to stop the
      // mouth flickering.
      const salient = PROTECTED_VISEMES.has(span.viseme);
      if (len < minHoldFrames && last && !salient) {
        last.endFrame = span.endFrame;
        continue;
      }
      absorbed.push({ ...span });
    }
    const stable =
      absorbed.length === spans.length &&
      absorbed.every((s, i) => s.viseme === spans[i].viseme && s.endFrame === spans[i].endFrame);
    spans = absorbed;
    if (stable) break;
  }
  const out = spans;

  // Always come to rest at the end of the line.
  if (out.length && out[out.length - 1].viseme !== 'X') {
    const last = out[out.length - 1];
    out.push({ viseme: 'X', startFrame: last.endFrame, endFrame: last.endFrame + minHoldFrames });
  }
  return out;
}

/** Full pipeline for one line. */
export function lipsyncLine(line: Line, fps: number = DEFAULT_FPS): Line {
  const phonemes = line.phonemes ?? phonemeTimeline(line.text, line.startFrame, line.durationFrames);
  const visemes = phonemesToVisemes(phonemes, Math.max(2, Math.round(fps / 12)));
  return { ...line, phonemes, visemes };
}

/** The mouth shape active at a frame, across all of a shot's lines. */
export function visemeAt(lines: readonly Line[], frame: number): Viseme {
  for (const line of lines) {
    for (const v of line.visemes ?? []) {
      if (frame >= v.startFrame && frame < v.endFrame) return v.viseme;
    }
  }
  return 'X';
}

/**
 * Measured sync drift between a viseme track and its phoneme track.
 *
 * What this measures is *timing*: for each phoneme that got a shape, how
 * far is that shape from where the sound is. What it deliberately does
 * not measure is simplification. A line with more phonemes than frames
 * cannot give each one its own mouth position — at 24fps a shape needs
 * at least a frame — and charging for those would be measuring the frame
 * rate rather than the sync.
 *
 * The exception is a mouth shape the audience can see is missing. A
 * bilabial that never closes the lips is a defect however short it was,
 * so a dropped protected shape is charged in full.
 */
export function lipsyncOffset(line: Line): number {
  if (!line.phonemes?.length || !line.visemes?.length) return 0;
  const present = new Set(line.visemes.map((v) => v.viseme));
  let worst = 0;

  for (const p of line.phonemes) {
    if (p.phoneme === 'SIL') continue;
    const expected = PHONEME_TO_VISEME[p.phoneme] ?? 'B';
    const mid = (p.startFrame + p.endFrame) / 2;

    if (!present.has(expected)) {
      // Absorbed into a neighbour. Only a shape the eye would miss counts.
      if (PROTECTED_VISEMES.has(expected)) worst = Math.max(worst, 3);
      continue;
    }
    // Distance from the sound to the nearest occurrence of its shape.
    let nearest = Infinity;
    for (const v of line.visemes) {
      if (v.viseme !== expected) continue;
      if (mid >= v.startFrame && mid < v.endFrame) {
        nearest = 0;
        break;
      }
      nearest = Math.min(nearest, Math.abs(v.startFrame - mid), Math.abs(v.endFrame - mid));
    }
    if (Number.isFinite(nearest)) worst = Math.max(worst, nearest);
  }
  return worst;
}
