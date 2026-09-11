/**
 * Critic ensemble and escalation.
 *
 * Two rules from the blueprint, made operational:
 *   - a VLM is never the sole approver;
 *   - disagreement escalates rather than resolving to a majority.
 *
 * An ensemble that quietly votes is worse than one critic, because it
 * hides the disagreement that was the useful signal.
 */

import type { CriticVerdict } from '../../graph/types.ts';
import type { CheckResult } from '../../core/result.ts';
import { pass, fail } from '../../core/result.ts';
import type { VlmProvider, VlmRequest, CriticRegistry, Rubric } from '../types.ts';
import { canGate } from '../types.ts';

export type EnsembleResult = {
  verdicts: CriticVerdict[];
  /** Consensus, or "escalate" when the critics disagree. */
  consensus: 'pass' | 'fail' | 'uncertain' | 'escalate';
  /** Check derived from the ensemble, with gating applied. */
  check: CheckResult;
};

export async function runEnsemble(
  providers: readonly VlmProvider[],
  request: VlmRequest,
  registry: CriticRegistry,
): Promise<EnsembleResult> {
  const verdicts = await Promise.all(providers.map((p) => p.critique(request)));
  const rubric = request.rubric;
  const where = {
    shotId: request.context.shot?.id,
    frame: request.images[0]?.frame,
  };

  const fails = verdicts.filter((v) => v.verdict === 'fail');
  const passes = verdicts.filter((v) => v.verdict === 'pass');
  const unsure = verdicts.filter((v) => v.verdict === 'uncertain');

  let consensus: EnsembleResult['consensus'];
  if (verdicts.length === 0) consensus = 'uncertain';
  else if (fails.length > 0 && passes.length > 0) consensus = 'escalate';
  else if (fails.length > 0) consensus = 'fail';
  else if (passes.length > 0 && unsure.length === 0) consensus = 'pass';
  else if (passes.length > 0) consensus = 'pass';
  else consensus = 'uncertain';

  // Only a calibrated critic may block. An uncalibrated one advises — and
  // a verdict that does not even name the model behind it can never be
  // matched to a calibration record, so it never gates.
  const gating = verdicts.some((v) => !!v.model && canGate(registry, rubric.id, v.model));

  const citations = verdicts.flatMap((v) => v.citations);
  const citationText = citations.length
    ? ` Cited frames: ${[...new Set(citations.map((c) => c.frame))].join(', ')}.`
    : '';

  let check: CheckResult;
  switch (consensus) {
    case 'pass':
      check = pass({
        name: `critic.${rubric.id}`,
        department: rubric.department,
        score: 1,
        message: `${passes.length} critic(s) passed "${rubric.title}".${citationText}`,
        where,
      });
      break;
    case 'fail':
      check = fail({
        name: `critic.${rubric.id}`,
        department: rubric.department,
        score: 0,
        severity: gating ? rubric.severity : 'warn',
        message:
          `${fails.length} critic(s) failed "${rubric.title}": ${fails[0].rationale}${citationText}` +
          (gating
            ? ''
            : ' (Advisory only: this critic is not calibrated to the 0.9 agreement bar and may not block a gate.)'),
        diagnosis: rubric.diagnosis,
        where: citations.length ? { ...where, frame: citations[0].frame } : where,
        evidence: citations.map((c) => ({
          kind: 'frame' as const,
          ref: `frame:${c.frame}`,
          caption: c.note,
        })),
      });
      break;
    case 'escalate':
      check = fail({
        name: `critic.${rubric.id}`,
        department: rubric.department,
        score: 0.5,
        severity: 'warn',
        message:
          `Critics disagree on "${rubric.title}": ${passes.length} pass, ${fails.length} fail. ` +
          `Escalating to a human rather than taking a vote. Dissent: ${fails[0].rationale}${citationText}`,
        diagnosis: 'critic.disagreement',
        where,
      });
      break;
    default:
      check = fail({
        name: `critic.${rubric.id}`,
        department: rubric.department,
        score: 0.5,
        severity: 'warn',
        message:
          `"${rubric.title}" was not assessed: ${unsure[0]?.rationale ?? 'no critic available'}. ` +
          'This check is unmeasured, not passed.',
        diagnosis: 'critic.not_run',
        where,
      });
  }

  return { verdicts, consensus, check };
}

/** Convenience: run one rubric across every configured critic. */
export async function critique(
  registry: CriticRegistry,
  rubric: Rubric,
  request: Omit<VlmRequest, 'rubric'>,
): Promise<EnsembleResult> {
  return runEnsemble(registry.vlm, { ...request, rubric }, registry);
}
