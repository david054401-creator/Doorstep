/**
 * The shot repair loop.
 *
 *   run(node) -> validate
 *     if pass: commit, advance
 *     else:    diagnosis = map(failedChecks -> causes)
 *              move      = repairTable[diagnosis]
 *              apply(move, scope = failing node only)
 *              re-validate node + dependents
 *              attempts++ ; if attempts > budget -> escalate(diagnosisCard)
 *
 * The loop never regenerates a shot, never keeps a change that made the
 * score worse, and never reports "done" without a score sheet.
 */

import type { Shot, Project, RepairRecord } from '../graph/types.ts';
import type { CheckResult, ScoreSheet } from '../core/result.ts';
import { scoreSheet } from '../core/result.ts';
import type { Logger } from '../core/log.ts';
import { silentLogger } from '../core/log.ts';
import { SHOT_REPAIR_TABLE } from './repair-table.ts';
import { validatePrinciples } from './principles.ts';
import type { PrincipleOptions } from './principles.ts';
import { evaluateShot } from '../animation/evaluate.ts';
import type { EvaluateOptions, EvaluatedFrame } from '../animation/evaluate.ts';

export type DiagnosisCard = {
  /** What failed. */
  what: string[];
  /** Where: shot, frame, part, bone. */
  where: { shotId: string; details: string[] };
  /** Why, in the validator's own words. */
  why: string[];
  /** Every move attempted, and what it did to the score. */
  tried: { move: string; outcome: string; delta: number }[];
  /** Rendered evidence references, when frames were written. */
  render: string[];
  /** The score sheet at the point of escalation. */
  scoreSheet: ScoreSheet;
  /** What a human should do next. */
  suggestions: string[];
};

export type ShotRepairOptions = {
  budget?: { attempts: number; minImprovement?: number; stopWhenClean?: boolean };
  logger?: Logger;
  principles?: PrincipleOptions;
  evaluate?: EvaluateOptions;
  /** Extra checks folded into the score, e.g. shot grammar or colour. */
  extraChecks?: (shot: Shot, frames: readonly EvaluatedFrame[]) => CheckResult[];
};

export type ShotRepairOutcome = {
  shot: Shot;
  frames: EvaluatedFrame[];
  checks: CheckResult[];
  scoreSheet: ScoreSheet;
  records: RepairRecord[];
  clean: boolean;
  card?: DiagnosisCard;
};

export function repairShot(
  shot: Shot,
  project: Pick<Project, 'characters' | 'deliverySpec' | 'styleBible'>,
  options: ShotRepairOptions = {},
): ShotRepairOutcome {
  const log = (options.logger ?? silentLogger()).child('director.repair', { shotId: shot.id });
  const budget = options.budget ?? { attempts: 10, minImprovement: 0.01, stopWhenClean: true };
  const minImprovement = budget.minImprovement ?? 0.01;

  const runChecks = (s: Shot): { frames: EvaluatedFrame[]; checks: CheckResult[] } => {
    const frames = evaluateShot(s, project, options.evaluate);
    // The authored track, with breath and blink stripped out, is what the
    // performance-level principles are measured against.
    const primaryFrames = evaluateShot(s, project, { ...options.evaluate, primaryOnly: true });
    const checks = [
      ...validatePrinciples(s, frames, project, { ...options.principles, primaryFrames }),
      ...(options.extraChecks?.(s, frames) ?? []),
    ];
    return { frames, checks };
  };

  let current = shot;
  let { frames, checks } = runChecks(current);
  let sheet = scoreSheet(`shot:${shot.id}`, checks);
  const records: RepairRecord[] = [];
  const exhausted = new Map<string, Set<string>>();
  const unfixable = new Set<string>();

  for (let attempt = 1; attempt <= budget.attempts; attempt++) {
    if (sheet.clean && budget.stopWhenClean !== false) break;

    const failing = checks
      .filter(
        (c) =>
          !c.pass &&
          c.severity !== 'info' &&
          c.diagnosis !== undefined &&
          !unfixable.has(c.diagnosis),
      )
      .sort((a, b) => rank(b) - rank(a) || a.score - b.score);
    const target = failing[0];
    if (!target?.diagnosis) break;

    const diagnosis = target.diagnosis;
    const moves = SHOT_REPAIR_TABLE.filter((m) => m.diagnoses.includes(diagnosis));
    if (moves.length === 0) {
      log.warn('no repair move for diagnosis', { diagnosis });
      unfixable.add(diagnosis);
      continue;
    }
    const spent = exhausted.get(diagnosis) ?? new Set<string>();
    const move = moves.find((m) => !spent.has(m.id));
    if (!move) {
      unfixable.add(diagnosis);
      continue;
    }
    spent.add(move.id);
    exhausted.set(diagnosis, spent);

    const next = move.apply(current, target, spent.size - 1);
    if (!next) {
      records.push(record(attempt, target, move.id, 'no_change', sheet.score, sheet.score, current));
      continue;
    }

    const trial = runChecks(next);
    const trialSheet = scoreSheet(`shot:${shot.id}`, trial.checks);
    const delta = trialSheet.score - sheet.score;
    const improved = delta > 1e-6 || trialSheet.failed < sheet.failed;

    records.push(
      record(
        attempt,
        target,
        move.id,
        trialSheet.clean ? 'fixed' : improved ? 'improved' : delta < -1e-6 ? 'worse' : 'no_change',
        sheet.score,
        trialSheet.score,
        next,
      ),
    );

    if (improved) {
      log.info('repair improved the shot', {
        move: move.id,
        check: target.name,
        from: sheet.score.toFixed(3),
        to: trialSheet.score.toFixed(3),
      });
      current = next;
      frames = trial.frames;
      checks = trial.checks;
      sheet = trialSheet;
      if (delta >= minImprovement || trialSheet.failed < sheet.failed) {
        exhausted.clear();
        unfixable.clear();
      }
    } else {
      log.info('repair rolled back', { move: move.id, check: target.name });
    }
  }

  const finalShot: Shot = {
    ...current,
    repairs: [...current.repairs, ...records],
    validation: {
      checks,
      criticVerdicts: current.validation?.criticVerdicts ?? [],
      humanApproval: current.validation?.humanApproval,
      scoreSheet: sheet,
    },
    status: sheet.clean ? 'animated' : 'escalated',
  };

  return {
    shot: finalShot,
    frames,
    checks,
    scoreSheet: sheet,
    records,
    clean: sheet.clean,
    card: sheet.clean ? undefined : buildCard(finalShot, checks, records, sheet),
  };
}

function rank(c: CheckResult): number {
  return c.severity === 'fatal' ? 3 : c.severity === 'error' ? 2 : c.severity === 'warn' ? 1 : 0;
}

function record(
  attempt: number,
  check: CheckResult,
  move: string,
  outcome: RepairRecord['outcome'],
  before: number,
  after: number,
  shot: Shot,
): RepairRecord {
  return {
    attempt,
    failedCheck: check.name,
    diagnosis: check.diagnosis ?? 'unknown',
    move,
    scope: check.where,
    before: { score: before, durationFrames: shot.durationFrames, keys: shot.keys.length },
    after: { score: after, durationFrames: shot.durationFrames, keys: shot.keys.length },
    outcome,
    scoreBefore: before,
    scoreAfter: after,
    at: new Date().toISOString(),
  };
}

/**
 * The escalation card.
 *
 * "I could not fix shot 12; here is why and here is what I tried." Never a
 * bare failure, never a silent pass.
 */
export function buildCard(
  shot: Shot,
  checks: readonly CheckResult[],
  records: readonly RepairRecord[],
  sheet: ScoreSheet,
): DiagnosisCard {
  const failing = checks.filter((c) => !c.pass && c.severity !== 'info');
  return {
    what: failing.map((c) => c.name),
    where: {
      shotId: shot.id,
      details: failing.map((c) => {
        const bits = [
          c.where.frame !== undefined ? `frame ${c.where.frame}` : '',
          c.where.characterId ?? '',
          c.where.partId ?? '',
          c.where.boneId ?? '',
          c.where.path ?? '',
        ].filter(Boolean);
        return `${c.name}: ${bits.join(' / ') || 'shot level'}`;
      }),
    },
    why: failing.map((c) => c.message),
    tried: records.map((r) => ({
      move: r.move,
      outcome: r.outcome,
      delta: Number((r.scoreAfter - r.scoreBefore).toFixed(4)),
    })),
    render: failing.flatMap((c) => c.evidence?.map((e) => e.ref) ?? []),
    scoreSheet: sheet,
    suggestions: suggestionsFor(failing),
  };
}

function suggestionsFor(failing: readonly CheckResult[]): string[] {
  const out = new Set<string>();
  for (const c of failing) {
    switch (c.diagnosis) {
      case 'animation.broken_arc':
        out.add('Re-pose the extreme so the end effector travels on a curve, or add a breakdown by hand.');
        break;
      case 'animation.volume_pop':
        out.add('Check the part named above for a swap or a scale key that jumps between frames.');
        break;
      case 'animation.off_model_proportions':
        out.add('The rig is being scaled non-uniformly. Re-check the placement scale and the model sheet ratios.');
        break;
      case 'animation.dead_hold':
        out.add('Enable the idle layer for this character, or author a secondary channel across the hold.');
        break;
      case 'grammar.crossed_the_line':
        out.add('Decide which side of the action line this scene lives on, and re-stage the offending shot.');
        break;
      default:
        out.add(`Address "${c.name}" by hand: ${c.message}`);
    }
  }
  return [...out];
}

/** Render the card as the text a human reads in the terminal or the UI. */
export function formatCard(card: DiagnosisCard): string {
  const lines: string[] = [];
  lines.push(`Shot ${card.where.shotId} could not be brought to a clean score sheet.`);
  lines.push(`Score ${card.scoreSheet.score.toFixed(3)} — ${card.scoreSheet.passed} passed, ${card.scoreSheet.failed} failed.`);
  lines.push('');
  lines.push('What failed:');
  card.why.forEach((why, i) => {
    lines.push(`  - ${card.what[i]}`);
    lines.push(`      ${why}`);
    if (card.where.details[i]) lines.push(`      at ${card.where.details[i].split(': ')[1] ?? ''}`);
  });
  lines.push('');
  lines.push('Repair moves attempted:');
  for (const t of card.tried) {
    lines.push(`  - ${t.move}: ${t.outcome} (${t.delta >= 0 ? '+' : ''}${t.delta.toFixed(4)})`);
  }
  if (card.render.length) {
    lines.push('');
    lines.push(`Evidence: ${card.render.join(', ')}`);
  }
  lines.push('');
  lines.push('Suggested next steps:');
  for (const s of card.suggestions) lines.push(`  - ${s}`);
  return lines.join('\n');
}
