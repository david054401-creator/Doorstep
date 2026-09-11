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
  // A silent trailing 'e' does not get its own shape.
  if (word.length > 2 && /e$/i.test(word) && out.length > 1 && out[out.length - 1] === 'EH') {
    out.pop();
  }
  return out.length ? out : ['AH'];
}

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
  const spans: PhonemeSpan[] = [];
  let cursor = startFrame;
  for (const u of units) {
    const span = (u.weight / totalWeight) * durationFrames;
    const end = cursor + span;
    spans.push({
      phoneme: u.phoneme,
      startFrame: Math.round(cursor),
      endFrame: Math.max(Math.round(cursor) + 1, Math.round(end)),
    });
    cursor = end;
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
      if (len < minHoldFrames && last) {
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
 * Measured offset between a viseme track and its phoneme track, in frames.
 * Hard invariant 9 requires this to stay within two frames at 24fps.
 */
export function lipsyncOffset(line: Line): number {
  if (!line.phonemes?.length || !line.visemes?.length) return 0;
  let worst = 0;
  for (const p of line.phonemes) {
    if (p.phoneme === 'SIL') continue;
    const expected = PHONEME_TO_VISEME[p.phoneme] ?? 'B';
    // Find the viseme span covering this phoneme's midpoint.
    const mid = (p.startFrame + p.endFrame) / 2;
    const span = line.visemes.find((v) => mid >= v.startFrame && mid < v.endFrame);
    if (!span) {
      worst = Math.max(worst, 3);
      continue;
    }
    if (span.viseme !== expected) {
      // Measure how far away the nearest correct shape is.
      const nearest = line.visemes
        .filter((v) => v.viseme === expected)
        .map((v) => Math.min(Math.abs(v.startFrame - mid), Math.abs(v.endFrame - mid)));
      worst = Math.max(worst, nearest.length ? Math.min(...nearest) : 3);
    }
  }
  return worst;
}
