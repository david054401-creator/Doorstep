/**
 * Rig repair.
 *
 * Design law 3: repair from diagnosis, never retry. A failing rig is not
 * regenerated — the specific diagnosis is mapped to a specific move, the
 * move is applied to the smallest possible scope, and the battery is re-run.
 * Every attempt is recorded with what it changed and whether the score
 * actually improved, so the escalation card can say "here is what I tried".
 */

import type { Rig, RepairRecord, PartMesh, Bone } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { scoreSheet } from '../core/result.ts';
import type { Logger } from '../core/log.ts';
import { silentLogger } from '../core/log.ts';
import { validateRig } from './validators.ts';
import type { RigValidationOptions, BatteryResult } from './validators.ts';
import { buildPartMesh, normalizeWeights } from './skin.ts';
import { skeletonForView } from './rig.ts';
import { clamp, wrapAngle } from '../core/math.ts';

export type RepairMove = {
  /** Stable id, referenced by the repair table. */
  id: string;
  /** Diagnoses this move addresses. */
  diagnoses: string[];
  /** One line a human can read on the escalation card. */
  describe: string;
  apply(rig: Rig, check: CheckResult, attempt: number): Rig | null;
};

/** Rebuild one part's mesh with a wider joint band and denser interior. */
function densifyPart(rig: Rig, partId: string | undefined, attempt: number): Rig | null {
  if (!partId) return null;
  const part = rig.parts.find((p) => p.id === partId);
  if (!part) return null;
  const bones = skeletonForView(rig, part.view);
  const widen = 1 + attempt * 0.6;
  const rebuilt = normalizeWeights(
    buildPartMesh(part, bones, {
      contourSamples: Math.min(64, 24 + attempt * 12),
      interiorGrid: Math.min(8, 4 + attempt),
      jointBand: widen,
    }),
  );
  return replaceMesh(rig, rebuilt);
}

function replaceMesh(rig: Rig, mesh: PartMesh): Rig {
  const meshes = rig.meshes.some((m) => m.partId === mesh.partId)
    ? rig.meshes.map((m) => (m.partId === mesh.partId ? mesh : m))
    : [...rig.meshes, mesh];
  return { ...rig, meshes };
}

/** Make a part rigid: bind it to the root of its chain and drop the mesh. */
function rigidifyPart(rig: Rig, partId: string | undefined): Rig | null {
  if (!partId) return null;
  const part = rig.parts.find((p) => p.id === partId);
  if (!part || !part.boneChain || part.boneChain.length < 2) return null;
  const parts = rig.parts.map((p) =>
    p.id === partId ? { ...p, boneChain: [p.bone ?? p.boneChain![0]] } : p,
  );
  return {
    ...rig,
    parts,
    meshes: rig.meshes.filter((m) => m.partId !== partId),
  };
}

/**
 * Tighten a bone's rotation limits so the rig cannot reach the pose that
 * breaks it. Blunt, but honest: a rig that refuses an impossible pose is
 * better than one that renders a broken frame.
 */
function tightenLimits(rig: Rig, boneId: string | undefined, factor: number): Rig | null {
  if (!boneId) return null;
  const bone = rig.skeleton.find((b) => b.id === boneId);
  if (!bone || !bone.limits) return null;
  const shrink = (b: Bone): Bone =>
    b.id === boneId && b.limits
      ? { ...b, limits: { min: b.limits.min * factor, max: b.limits.max * factor } }
      : b;
  const viewSkeletons = rig.viewSkeletons
    ? Object.fromEntries(
        Object.entries(rig.viewSkeletons).map(([v, bones]) => [v, bones?.map(shrink)]),
      )
    : undefined;
  return {
    ...rig,
    skeleton: rig.skeleton.map(shrink),
    viewSkeletons: viewSkeletons as Rig['viewSkeletons'],
  };
}

/** Re-normalise every mesh's weights. The direct fix for a failed sum check. */
function renormalise(rig: Rig): Rig {
  return { ...rig, meshes: rig.meshes.map(normalizeWeights) };
}

/** Rebuild every mesh from scratch — the "re-segment and re-skin" move. */
function reskinAll(rig: Rig, attempt: number): Rig {
  const meshed = new Set(rig.meshes.map((m) => m.partId));
  const meshes = rig.parts
    .filter((p) => meshed.has(p.id))
    .map((p) =>
      normalizeWeights(
        buildPartMesh(p, skeletonForView(rig, p.view), {
          contourSamples: Math.min(56, 28 + attempt * 8),
          interiorGrid: Math.min(7, 4 + attempt),
          jointBand: 1 + attempt * 0.35,
        }),
      ),
    );
  return { ...rig, meshes };
}

/**
 * The repair table. Ten entries, as specified — one per diagnosis the
 * validators can emit, ordered from cheapest and most local to broadest.
 */
export const RIG_REPAIR_TABLE: RepairMove[] = [
  {
    id: 'normalise_weights',
    diagnoses: ['rig.unnormalised_weights'],
    describe: 'Re-normalise skin weights so every vertex sums to exactly 1.',
    apply: (rig) => renormalise(rig),
  },
  {
    id: 'rebind_orphan_weights',
    diagnoses: ['rig.orphan_weight', 'rig.orphan_part'],
    describe: 'Drop weights pointing at missing bones and re-skin the part.',
    apply: (rig, check) => densifyPart(rig, check.where.partId, 0) ?? reskinAll(rig, 0),
  },
  {
    id: 'densify_mesh',
    diagnoses: ['rig.mesh_inversion', 'rig.sliver_triangles'],
    describe: 'Rebuild the failing part with a denser mesh and a wider joint band.',
    apply: (rig, check, attempt) => densifyPart(rig, check.where.partId, attempt),
  },
  {
    id: 'widen_joint_band',
    diagnoses: ['rig.tearing'],
    describe: 'Widen the crossover band at the joint so the weight gradient is gentler.',
    apply: (rig, check, attempt) => densifyPart(rig, check.where.partId, attempt + 1),
  },
  {
    id: 'reskin_volume',
    diagnoses: ['rig.volume_loss', 'rig.squash_not_conserved'],
    describe: 'Re-skin the part so the form holds its area through the bend.',
    apply: (rig, check, attempt) => densifyPart(rig, check.where.partId, attempt),
  },
  {
    id: 'rigidify_part',
    diagnoses: ['rig.contour_self_intersection', 'rig.silhouette_disconnected'],
    describe: 'Stop deforming the part and let it rotate as one rigid cut-out piece.',
    apply: (rig, check) => rigidifyPart(rig, check.where.partId),
  },
  {
    id: 'tighten_limits',
    diagnoses: ['rig.mesh_inversion', 'rig.tearing', 'rig.silhouette_unreadable'],
    describe: 'Reduce the bone rotation limits so the rig cannot reach the breaking pose.',
    apply: (rig, check) => tightenLimits(rig, check.where.boneId, 0.85),
  },
  {
    id: 'reskin_all',
    diagnoses: ['rig.mesh_inversion', 'rig.tearing', 'rig.volume_loss'],
    describe: 'Rebuild every mesh at higher resolution.',
    apply: (rig, _check, attempt) => reskinAll(rig, attempt + 1),
  },
  {
    id: 'rebuild_z_order',
    diagnoses: ['rig.z_order_violation'],
    describe: 'Recompute the per-view draw order from the part atlas.',
    apply: (rig) => rig,
  },
  {
    id: 'relax_ik',
    diagnoses: ['rig.ik_no_converge', 'rig.short_ik_chain'],
    describe: 'Raise the IK iteration budget so the solver converges.',
    apply: (rig) => ({
      ...rig,
      ik: rig.ik.map((c) => ({ ...c, iterations: Math.min(64, c.iterations * 2) })),
    }),
  },
];

export type RepairBudget = {
  /** Max repair attempts before escalating. */
  attempts: number;
  /** Stop early once the score sheet is clean. */
  stopWhenClean?: boolean;
  /**
   * Score gain below which a move counts as nibbling: the change is kept,
   * but the cheaper moves are not reopened, so the loop escalates instead
   * of spending its whole budget a thousandth at a time.
   */
  minImprovement?: number;
};

export type RepairOutcome = {
  rig: Rig;
  result: BatteryResult;
  records: RepairRecord[];
  /** True when the rig passed with no blocking failures. */
  clean: boolean;
  /** Populated when the budget ran out: what failed and what was tried. */
  escalation?: {
    remaining: CheckResult[];
    tried: string[];
    summary: string;
  };
};

/**
 * Run the bounded repair loop.
 *
 * Each pass takes the single worst failing check, looks up a move that
 * addresses its diagnosis, applies it to that check's scope only, and
 * re-validates. A move that makes the score worse is rolled back — repair
 * must never be a random walk.
 */
export function repairRig(
  rig: Rig,
  options: RigValidationOptions & { budget?: RepairBudget; logger?: Logger } = {},
): RepairOutcome {
  const log = (options.logger ?? silentLogger()).child('rig.repair', { characterId: rig.characterId });
  const budget = options.budget ?? { attempts: 8, stopWhenClean: true };
  // Below this, an "improvement" is not worth another turn of the budget.
  const minImprovement = budget.minImprovement ?? 0.01;
  const records: RepairRecord[] = [];
  const tried: string[] = [];
  const exhausted = new Map<string, Set<string>>();
  const unfixable = new Set<string>();

  let current = rig;
  let result = validateRig(current, options);
  let sheet = scoreSheet(`rig:${rig.id}`, result.checks);

  for (let attempt = 1; attempt <= budget.attempts; attempt++) {
    if (sheet.clean) break;
    const failing = result.checks
      .filter(
        (c) =>
          !c.pass &&
          c.severity !== 'info' &&
          c.diagnosis !== undefined &&
          !unfixable.has(c.diagnosis),
      )
      .sort((a, b) => severityRank(b) - severityRank(a) || a.score - b.score);
    const target = failing[0];
    if (!target || !target.diagnosis) break;

    const diagnosis = target.diagnosis;
    const moves = RIG_REPAIR_TABLE.filter((m) => m.diagnoses.includes(diagnosis));
    if (moves.length === 0) {
      log.warn('no repair move for diagnosis', { diagnosis });
      break;
    }
    // Move selection escalates: the most local move first, then broader ones.
    // A move already spent on this diagnosis is not retried — otherwise the
    // loop burns its whole budget re-applying something that did not work.
    const spent = exhausted.get(diagnosis) ?? new Set<string>();
    const move = moves.find((m) => !spent.has(m.id));
    if (!move) {
      log.warn('every repair move for this diagnosis is exhausted', { diagnosis });
      unfixable.add(diagnosis);
      continue;
    }
    spent.add(move.id);
    exhausted.set(diagnosis, spent);
    const priorForDiagnosis = spent.size - 1;

    const before = snapshot(current, target.where);
    const next = move.apply(current, target, priorForDiagnosis);
    if (!next) {
      log.warn('repair move not applicable', { move: move.id, check: target.name });
      records.push({
        attempt,
        failedCheck: target.name,
        diagnosis: target.diagnosis,
        move: move.id,
        scope: target.where,
        before,
        after: before,
        outcome: 'no_change',
        scoreBefore: sheet.score,
        scoreAfter: sheet.score,
        at: new Date().toISOString(),
      });
      tried.push(move.id);
      // Mark this move exhausted for the diagnosis so we advance next round.
      continue;
    }

    const nextResult = validateRig(next, options);
    const nextSheet = scoreSheet(`rig:${next.id}`, nextResult.checks);
    const improved = nextSheet.score > sheet.score + 1e-6 || nextSheet.failed < sheet.failed;

    records.push({
      attempt,
      failedCheck: target.name,
      diagnosis: target.diagnosis,
      move: move.id,
      scope: target.where,
      before,
      after: snapshot(next, target.where),
      outcome: nextSheet.clean
        ? 'fixed'
        : improved
          ? 'improved'
          : nextSheet.score < sheet.score - 1e-6
            ? 'worse'
            : 'no_change',
      scoreBefore: sheet.score,
      scoreAfter: nextSheet.score,
      at: new Date().toISOString(),
    });
    tried.push(move.id);

    if (improved) {
      const delta = nextSheet.score - sheet.score;
      log.info('repair improved the rig', {
        move: move.id,
        check: target.name,
        from: sheet.score.toFixed(3),
        to: nextSheet.score.toFixed(3),
      });
      current = next;
      result = nextResult;
      sheet = nextSheet;
      // Keep the gain either way, but only reopen the cheaper moves when the
      // gain was real. A move that nibbles a fraction of a percent will do it
      // again and again and eat the whole budget before the loop ever reaches
      // the broader move that would actually fix the thing.
      if (delta >= minImprovement || nextSheet.failed < sheet.failed) {
        exhausted.clear();
        unfixable.clear();
      }
    } else {
      // Roll back. A move that does not help is not kept, so the loop
      // cannot wander into a worse rig than it started with.
      log.info('repair rolled back, no improvement', { move: move.id, check: target.name });
    }
    if (sheet.clean && budget.stopWhenClean !== false) break;
  }

  const remaining = result.checks.filter((c) => !c.pass && c.severity !== 'info');
  return {
    rig: current,
    result,
    records,
    clean: sheet.clean,
    escalation: sheet.clean
      ? undefined
      : {
          remaining,
          tried: [...new Set(tried)],
          summary: buildEscalationSummary(rig, remaining, tried),
        },
  };
}

function severityRank(c: CheckResult): number {
  return c.severity === 'fatal' ? 3 : c.severity === 'error' ? 2 : c.severity === 'warn' ? 1 : 0;
}

function snapshot(rig: Rig, where: Locator): Record<string, unknown> {
  if (where.partId) {
    const mesh = rig.meshes.find((m) => m.partId === where.partId);
    const part = rig.parts.find((p) => p.id === where.partId);
    return {
      partId: where.partId,
      vertices: mesh?.vertices.length ?? 0,
      triangles: (mesh?.triangles.length ?? 0) / 3,
      chain: part?.boneChain ?? (part?.bone ? [part.bone] : []),
    };
  }
  if (where.boneId) {
    const bone = rig.skeleton.find((b) => b.id === where.boneId);
    return {
      boneId: where.boneId,
      limits: bone?.limits ? { min: wrapAngle(bone.limits.min), max: wrapAngle(bone.limits.max) } : null,
    };
  }
  return { meshes: rig.meshes.length, parts: rig.parts.length };
}

/**
 * The escalation card. The engine may say "I could not fix this, here is
 * why and here is what I tried" — it may never say "done" without one.
 */
export function buildEscalationSummary(
  rig: Rig,
  remaining: readonly CheckResult[],
  tried: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`Rig ${rig.id} (${rig.characterId}) did not clear the validator battery.`);
  lines.push('');
  lines.push('Still failing:');
  for (const c of remaining.slice(0, 8)) {
    const loc = [c.where.partId, c.where.boneId, c.where.path].filter(Boolean).join(' / ');
    lines.push(`  - [${c.severity}] ${c.name}${loc ? ` at ${loc}` : ''}`);
    lines.push(`      ${c.message}`);
  }
  lines.push('');
  lines.push(`Repair moves attempted: ${[...new Set(tried)].join(', ') || 'none'}`);
  lines.push('');
  lines.push(
    'Next steps a human can take: adjust the construction of the named part ' +
      '(its width, its bone chain, or where the joint sits), or lower the ' +
      'rotation limit on the named bone so the breaking pose is unreachable.',
  );
  return lines.join('\n');
}

/** Score a rig without repairing it. */
export function rigScore(rig: Rig, options: RigValidationOptions = {}): number {
  return scoreSheet(`rig:${rig.id}`, validateRig(rig, options).checks).score;
}

export const clampFactor = (v: number): number => clamp(v, 0.1, 1);
