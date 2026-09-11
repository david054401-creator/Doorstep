/**
 * Director notes to structured edits.
 *
 * This is the magic that only works because the IR is structured. "More
 * punch on the jump" is not a prompt to a model — it resolves to a precise
 * set of curve operations against named frames. The mapping is explicit,
 * auditable and reversible, and when a note cannot be understood the engine
 * says so instead of guessing.
 */

import type { Shot, StructuredEdit, DirectorNote, Point } from '../graph/types.ts';
import type { Locator } from '../core/result.ts';
import { makeId } from '../core/ids.ts';
import { SHOT_REPAIR_TABLE } from './repair-table.ts';
import type { ShotRepairMove } from './repair-table.ts';

export type NoteRule = {
  id: string;
  /** Patterns a director actually types. */
  patterns: RegExp[];
  /** The diagnosis this note maps onto, routed through the repair table. */
  diagnosis: string;
  /** One line explaining the edit, shown in the UI next to the note. */
  rationale: string;
  /** Extra parameters extracted from the note text. */
  params?(match: RegExpExecArray, text: string): Record<string, number | string | boolean>;
};

const AMOUNT_WORDS: Record<string, number> = {
  'a touch': 0.5,
  'a bit': 0.6,
  slightly: 0.5,
  somewhat: 0.7,
  'a lot': 1.5,
  much: 1.4,
  way: 1.8,
  really: 1.5,
  far: 1.6,
};

function amountFrom(text: string): number {
  const lower = text.toLowerCase();
  for (const [word, value] of Object.entries(AMOUNT_WORDS)) {
    if (lower.includes(word)) return value;
  }
  return 1;
}

/**
 * The note table.
 *
 * Every entry here is a note a director gives out loud, mapped to the
 * measurable failure it describes. The blueprint's own examples are the
 * first six.
 */
export const NOTE_RULES: NoteRule[] = [
  {
    id: 'more_punch',
    patterns: [
      /\bmore punch\b/i,
      /\bpunch(ier)?\b/i,
      /\bhit(s)? harder\b/i,
      /\bsnap(pier)?\b/i,
      /\bmore impact\b/i,
    ],
    diagnosis: 'note.more_punch',
    rationale:
      'Shorten the anticipation-to-peak span, add an overshoot at the landing, and squash on contact.',
    params: (_m, text) => ({ amount: amountFrom(text) }),
  },
  {
    id: 'looks_dead',
    patterns: [
      /\blooks? dead\b/i,
      /\bfeels? dead\b/i,
      /\blifeless\b/i,
      /\bno life\b/i,
      /\bstatic\b/i,
      /\bfroz(en|e)\b/i,
      /\bnot breathing\b/i,
    ],
    diagnosis: 'note.looks_dead',
    rationale:
      'Add an idle layer: breath on the chest, blinks, a weight shift, and turn every hold into a moving hold.',
  },
  {
    id: 'cannot_tell_action',
    patterns: [
      /\b(can'?t|cannot|hard to) tell what\b/i,
      /\bdoesn'?t read\b/i,
      /\bunclear\b/i,
      /\bwhat is (he|she|it|they) doing\b/i,
      /\bsilhouette\b/i,
    ],
    diagnosis: 'note.cannot_tell_action',
    rationale:
      'Silhouette fix: rotate to three-quarter, get the limbs off the body outline, raise the contrast against the background.',
  },
  {
    id: 'too_floaty',
    patterns: [/\btoo floaty\b/i, /\bfloat(s|y|ing)\b/i, /\bmushy\b/i, /\bsoggy\b/i, /\bno weight\b/i],
    diagnosis: 'note.too_floaty',
    rationale:
      'Tighten the eases, add contact holds, and retime the passage onto twos so it stops drifting.',
    params: (_m, text) => ({ amount: amountFrom(text) }),
  },
  {
    id: 'off_model',
    patterns: [/\boff[- ]model\b/i, /\bdoesn'?t look like\b/i, /\bwrong proportions?\b/i],
    diagnosis: 'animation.off_model_proportions',
    rationale: 'Re-render the part from the locked model sheet and re-run the identity gate.',
  },
  {
    id: 'cut_feels_wrong',
    patterns: [
      /\bcut feels? (wrong|off|bad)\b/i,
      /\bcrossed? the line\b/i,
      /\bjump cut\b/i,
      /\bgeography\b/i,
    ],
    diagnosis: 'note.cut_feels_wrong',
    rationale:
      'Re-check the hold before the cut, cut on the action instead of after it, and put the camera back on the established side of the line.',
  },
  {
    id: 'too_snappy',
    patterns: [/\btoo (snappy|fast|quick|sudden)\b/i, /\bslow it down\b/i, /\bgive it (more )?time\b/i],
    diagnosis: 'note.too_snappy',
    rationale: 'Give the action more frames and soften the ease out of the extreme.',
    params: (_m, text) => ({ amount: amountFrom(text) }),
  },
  {
    id: 'too_symmetrical',
    patterns: [/\btwinn?ing\b/i, /\btoo symmetric(al)?\b/i, /\bboth (arms|hands|legs) the same\b/i],
    diagnosis: 'animation.twinning',
    rationale: 'Offset one side of the body in time and amplitude so the pose stops mirroring.',
  },
  {
    id: 'bigger',
    patterns: [/\bbigger\b/i, /\bpush it\b/i, /\bmore extreme\b/i, /\bexaggerate\b/i, /\bbroader\b/i],
    diagnosis: 'animation.underplayed_peak',
    rationale: 'Push the peak pose further from neutral.',
    params: (_m, text) => ({ amount: amountFrom(text) }),
  },
  {
    id: 'foot_slide',
    patterns: [/\bslid(es?|ing)\b/i, /\bskating\b/i, /\bfeet slip\b/i],
    diagnosis: 'animation.foot_slide',
    rationale: 'Pin the contact foot so it stops travelling while planted.',
  },
  {
    id: 'coverage_flat',
    patterns: [/\bflat coverage\b/i, /\bevery shot (is )?the same\b/i, /\bvary the (shots?|sizes?)\b/i],
    diagnosis: 'grammar.flat_coverage',
    rationale: 'Change the shot size so consecutive shots are not the same framing.',
  },
  {
    id: 'eyeline',
    patterns: [/\beye ?line\b/i, /\blooking (at )?(the )?wrong\b/i, /\bnot looking at\b/i],
    diagnosis: 'grammar.eyeline_mismatch',
    rationale: 'Aim the eyeline at the subject and turn the body to match.',
  },
  {
    id: 'hold_longer',
    patterns: [/\bhold (it )?longer\b/i, /\blet it breathe\b/i, /\bmore air\b/i],
    diagnosis: 'grammar.shot_too_short',
    rationale: 'Extend the shot so the audience has time to read it.',
  },
  {
    id: 'anticipate',
    patterns: [/\banticipat(e|ion)\b/i, /\bwind ?up\b/i, /\bno prep\b/i, /\bstarts? cold\b/i],
    diagnosis: 'animation.missing_anticipation',
    rationale: 'Insert a counter-move before the action so it does not pop.',
  },
];

export type ParsedNote = {
  edits: StructuredEdit[];
  /** Phrases the parser could not map. Surfaced to the director verbatim. */
  unrecognised: string[];
};

/**
 * Parse a director's note into structured edits.
 *
 * Sentences are handled one at a time so "more punch on the jump, and she
 * looks dead in the hold" produces two independent edits scoped correctly.
 */
export function parseNote(text: string, target: Locator = {}): ParsedNote {
  const sentences = text
    .split(/[.;\n]+|,\s*(?=and\b|but\b|also\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const edits: StructuredEdit[] = [];
  const unrecognised: string[] = [];

  for (const sentence of sentences) {
    // A single sentence can carry more than one note — "the cut feels wrong
    // and the eyeline is off" is two separate, independently actionable
    // observations — so every rule is tried, not just the first that hits.
    const seen = new Set<string>();
    let matched = false;
    for (const rule of NOTE_RULES) {
      if (seen.has(rule.diagnosis)) continue;
      const m = rule.patterns.map((p) => p.exec(sentence)).find((x): x is RegExpExecArray => !!x);
      if (!m) continue;
      seen.add(rule.diagnosis);
      matched = true;
      const scope = { ...target, ...scopeFromText(sentence, target) };
      const move = SHOT_REPAIR_TABLE.find((r) => r.diagnoses.includes(rule.diagnosis));
      edits.push({
        op: move?.id ?? rule.id,
        target: scope,
        params: {
          diagnosis: rule.diagnosis,
          note: sentence,
          ...(rule.params?.(m, sentence) ?? {}),
        },
        rationale: rule.rationale,
      });
    }
    if (!matched) unrecognised.push(sentence);
  }
  return { edits, unrecognised };
}

/** Pull a frame or shot reference out of the note text. */
function scopeFromText(text: string, base: Locator): Locator {
  const out: Locator = {};
  const frame = /\b(?:frame|f)\s*#?(\d+)\b/i.exec(text);
  if (frame) out.frame = parseInt(frame[1], 10);
  const range = /\bframes?\s*#?(\d+)\s*(?:-|to|through)\s*#?(\d+)\b/i.exec(text);
  if (range) out.frameRange = [parseInt(range[1], 10), parseInt(range[2], 10)];
  const shot = /\bshot\s*#?(\d+)\b/i.exec(text);
  if (shot && !base.shotId) out.path = `shot:${shot[1]}`;
  return out;
}

/** Build a DirectorNote record from raw text plus any draw-over strokes. */
export function makeNote(
  text: string,
  options: {
    by: string;
    target?: Locator;
    drawOver?: { frame: number; points: Point[]; label?: string }[];
    at?: string;
  },
): DirectorNote {
  const parsed = parseNote(text, options.target);
  const edits = [...parsed.edits];
  // A draw-over stroke is itself a note: a circle round a limb almost always
  // means "this reads wrong here", so it is scoped to that frame.
  for (const stroke of options.drawOver ?? []) {
    edits.push({
      op: 'review.draw_over',
      target: { ...options.target, frame: stroke.frame },
      params: {
        label: stroke.label ?? 'draw-over',
        points: stroke.points.length,
        diagnosis: 'note.draw_over',
      },
      rationale:
        stroke.label ??
        'The director marked this area on this frame; treat it as the scope for the note.',
    });
  }
  return {
    id: makeId('note', `${options.by}:${text.slice(0, 40)}`),
    text,
    drawOver: options.drawOver,
    edits,
    at: options.at ?? new Date().toISOString(),
    by: options.by,
    resolved: false,
  };
}

/**
 * Apply structured edits to a shot.
 *
 * Each edit is routed through the repair table, so a director's note and an
 * automatic repair take exactly the same code path — which means a note can
 * never do something the validators do not understand.
 */
export function applyEdits(
  shot: Shot,
  edits: readonly StructuredEdit[],
): { shot: Shot; applied: StructuredEdit[]; skipped: { edit: StructuredEdit; reason: string }[] } {
  let current = shot;
  const applied: StructuredEdit[] = [];
  const skipped: { edit: StructuredEdit; reason: string }[] = [];

  for (const edit of edits) {
    const move: ShotRepairMove | undefined =
      SHOT_REPAIR_TABLE.find((m) => m.id === edit.op) ??
      SHOT_REPAIR_TABLE.find((m) => m.diagnoses.includes(String(edit.params.diagnosis ?? '')));
    if (!move) {
      skipped.push({ edit, reason: `No repair move is registered for "${edit.op}".` });
      continue;
    }
    const attempt = Math.max(0, Math.round(Number(edit.params.amount ?? 1) - 1));
    const next = move.apply(
      current,
      {
        name: edit.op,
        department: 'director',
        pass: false,
        score: 0,
        severity: 'warn',
        message: edit.rationale,
        diagnosis: String(edit.params.diagnosis ?? ''),
        where: edit.target,
      },
      attempt,
    );
    if (!next) {
      skipped.push({ edit, reason: `"${move.describe}" does not apply to this shot.` });
      continue;
    }
    current = next;
    applied.push(edit);
  }
  return { shot: current, applied, skipped };
}

/** Apply a whole note and record it on the shot. */
export function applyNote(shot: Shot, note: DirectorNote): Shot {
  const { shot: edited, applied } = applyEdits(shot, note.edits);
  return {
    ...edited,
    notes: [...shot.notes, { ...note, resolved: applied.length === note.edits.length }],
  };
}
