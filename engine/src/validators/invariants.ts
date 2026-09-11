/**
 * THE "CANNOT SHIP GARBAGE" CONTRACT
 *
 * The thirteen hard invariants, in one place, stated as the engine
 * actually measures them. Each one names the check that proves it, so a
 * score sheet can be read against the contract line by line.
 *
 * Any failure routes into the repair loop and then, if it survives, into
 * an honest escalation. There is no path from "failed" to "done" that
 * skips a human.
 */

import type { CheckResult, ScoreSheet } from '../core/result.ts';
import { scoreSheet } from '../core/result.ts';

export type Invariant = {
  number: number;
  id: string;
  title: string;
  /** The statement, as the contract words it. */
  statement: string;
  /** Check names that, together, establish this invariant. */
  checks: string[];
  /** A failure here stops delivery outright. */
  blocking: boolean;
  /** How to calibrate the threshold against your own labelled footage. */
  calibration?: string;
};

export const INVARIANTS: Invariant[] = [
  {
    number: 1,
    id: 'rig_sound',
    title: 'The rig is sound',
    statement:
      'Every bone is connected, weights are normalised, and there are zero inverted triangles across the twenty-pose battery.',
    checks: [
      'rig.bone_graph_connected',
      'rig.single_root',
      'rig.no_zero_length_bones',
      'rig.weights_normalised',
      'rig.no_orphan_weights',
      'rig.every_part_bound',
      'rig.no_inverted_triangles',
    ],
    blocking: true,
  },
  {
    number: 2,
    id: 'identity',
    title: 'Identity holds',
    statement:
      'Similarity to the approved model-sheet view is at least 0.85 on every key pose and every twelfth frame.',
    checks: ['identity.similarity', 'identity.sequence_consistency'],
    blocking: true,
    calibration:
      'Label a few hundred frames as on- or off-model, then re-fit the threshold with critics/calibration.bestThreshold. The 0.85 figure is a starting point, not a law of nature.',
  },
  {
    number: 3,
    id: 'volume',
    title: 'Volume is conserved',
    statement:
      'Part area drifts at most 3% per frame outside tagged squash and stretch; inside it, the width by height product holds to 5%.',
    checks: ['principle.volume_per_frame', 'rig.squash_stretch_conservation'],
    blocking: true,
  },
  {
    number: 4,
    id: 'arcs',
    title: 'Motion travels on arcs',
    statement:
      'End-effector paths fit a smooth curve at R-squared of at least 0.95, measured per action between extremes.',
    checks: ['principle.arcs'],
    blocking: false,
  },
  {
    number: 5,
    id: 'silhouette',
    title: 'The pose reads in silhouette',
    statement:
      'A critic correctly names the action from a thresholded silhouette on at least 90% of keys.',
    checks: ['principle.staging', 'principle.silhouette_whole', 'critic.silhouette.reads'],
    blocking: false,
    calibration:
      'The deterministic half (solidity and connectedness) always runs. The naming half needs a calibrated vision critic; until one is calibrated it advises rather than blocks.',
  },
  {
    number: 6,
    id: 'organic_pass',
    title: 'The organic pass earns its place',
    statement:
      'Generated frames must beat the rig render on warp error and perceptual distance with no flicker, or the rig render ships.',
    checks: ['critic.organic.inbetween_quality', 'comp.no_flicker'],
    blocking: false,
  },
  {
    number: 7,
    id: 'color',
    title: 'Colour is on model and reads',
    statement:
      'Character fills sit within DeltaE 3 of the colour model, and the character separates from the background by at least 20 L*.',
    checks: [
      'color.palette_conformance',
      'color.character_bg_contrast',
      'color.silhouette_edge_contrast',
    ],
    blocking: true,
  },
  {
    number: 8,
    id: 'continuity',
    title: 'Continuity holds',
    statement:
      'Locked asset versions match across every shot, and screen direction and eyeline checks pass.',
    checks: [
      'story.continuity',
      'grammar.180_degree_rule',
      'grammar.screen_direction',
      'grammar.eyeline_match',
    ],
    blocking: true,
  },
  {
    number: 9,
    id: 'lipsync',
    title: 'Lipsync lands',
    statement: 'Viseme to phoneme offset is at most two frames at 24fps.',
    checks: ['audio.lipsync_offset', 'audio.lipsync_present'],
    blocking: true,
  },
  {
    number: 10,
    id: 'audio',
    title: 'The mix is deliverable',
    statement:
      'Loudness is on target, the speech round-trip matches the script at 95% or better, and nothing clips.',
    checks: [
      'audio.loudness_on_target',
      'audio.no_clipping',
      'audio.no_sample_clipping',
      'audio.intelligibility',
    ],
    blocking: true,
  },
  {
    number: 11,
    id: 'safety',
    title: 'It is safe to watch',
    statement: 'The photosensitivity test passes: no more than three large-area flashes per second.',
    checks: ['safety.photosensitivity'],
    blocking: true,
  },
  {
    number: 12,
    id: 'delivery',
    title: 'Delivery is exact',
    statement: 'Frame count, frame rate, colour space and A/V sync are exactly as specified.',
    checks: [
      'delivery.frame_count',
      'delivery.resolution',
      'delivery.no_duplicate_frames',
      'delivery.av_sync',
    ],
    blocking: true,
  },
  {
    number: 13,
    id: 'human',
    title: 'A person approved it',
    statement: 'Boards, model sheets and the animatic were each approved by a human being.',
    checks: ['gate.boards', 'gate.modelSheet', 'gate.animatic'],
    blocking: true,
  },
];

export type InvariantStatus = {
  invariant: Invariant;
  /** 'held' | 'broken' | 'unmeasured' — never silently 'assumed'. */
  state: 'held' | 'broken' | 'unmeasured';
  /** The checks that decided it. */
  evidence: CheckResult[];
  /** Why, in one sentence. */
  message: string;
};

/**
 * Audit a set of checks against the contract.
 *
 * An invariant whose checks never ran is reported as UNMEASURED, not as
 * held. That distinction is the whole point: a green tick that means
 * "nobody looked" is exactly the failure mode this engine exists to
 * eliminate.
 */
export function auditInvariants(checks: readonly CheckResult[]): InvariantStatus[] {
  const byName = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const list = byName.get(c.name);
    if (list) list.push(c);
    else byName.set(c.name, [c]);
  }

  return INVARIANTS.map((invariant) => {
    const evidence = invariant.checks.flatMap((name) => byName.get(name) ?? []);
    if (evidence.length === 0) {
      return {
        invariant,
        state: 'unmeasured' as const,
        evidence,
        message: `Not measured: none of ${invariant.checks.join(', ')} ran in this build.`,
      };
    }
    const failing = evidence.filter((c) => !c.pass && c.severity !== 'info');
    if (failing.length === 0) {
      return {
        invariant,
        state: 'held' as const,
        evidence,
        message: `Held across ${evidence.length} check(s).`,
      };
    }
    return {
      invariant,
      state: 'broken' as const,
      evidence,
      message: failing.map((f) => `${f.name}: ${f.message}`).join(' '),
    };
  });
}

export type DeliveryVerdict = {
  /** True only when every blocking invariant is held. */
  deliverable: boolean;
  statuses: InvariantStatus[];
  scoreSheet: ScoreSheet;
  blocked: InvariantStatus[];
  unmeasured: InvariantStatus[];
};

export function canDeliver(checks: readonly CheckResult[]): DeliveryVerdict {
  const statuses = auditInvariants(checks);
  const blocked = statuses.filter((s) => s.invariant.blocking && s.state === 'broken');
  const unmeasured = statuses.filter((s) => s.invariant.blocking && s.state === 'unmeasured');
  return {
    deliverable: blocked.length === 0 && unmeasured.length === 0,
    statuses,
    scoreSheet: scoreSheet('invariants', checks),
    blocked,
    unmeasured,
  };
}

/** The contract as a human-readable report. */
export function formatContract(verdict: DeliveryVerdict): string {
  const lines: string[] = [];
  lines.push('THE "CANNOT SHIP GARBAGE" CONTRACT');
  lines.push('='.repeat(72));
  for (const s of verdict.statuses) {
    const mark = s.state === 'held' ? 'HELD  ' : s.state === 'broken' ? 'BROKEN' : 'UNMEAS';
    const flag = s.invariant.blocking ? '!' : ' ';
    lines.push(`${mark} ${flag} ${String(s.invariant.number).padStart(2)}. ${s.invariant.title}`);
    lines.push(`            ${s.invariant.statement}`);
    if (s.state !== 'held') lines.push(`            -> ${s.message}`);
  }
  lines.push('='.repeat(72));
  lines.push(
    verdict.deliverable
      ? 'DELIVERABLE: every blocking invariant is held and measured.'
      : `NOT DELIVERABLE: ${verdict.blocked.length} blocking invariant(s) broken, ${verdict.unmeasured.length} unmeasured.`,
  );
  lines.push(
    `Score ${verdict.scoreSheet.score.toFixed(3)} — ${verdict.scoreSheet.passed} checks passed, ${verdict.scoreSheet.failed} failed, ${verdict.scoreSheet.warnings} warnings.`,
  );
  if (!verdict.deliverable) {
    lines.push('');
    lines.push('An unmeasured invariant is not a passed one. Configure the missing');
    lines.push('stage or provider, or accept it explicitly — the engine will not');
    lines.push('sign off on something nobody looked at.');
  }
  return lines.join('\n');
}
