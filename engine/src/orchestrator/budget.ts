/**
 * The producer's ledger.
 *
 * Cost and time per shot, and the fallback decision that goes with them:
 * try the organic pass, or ship the rig render. The rig render is nearly
 * free and always passes; a generative pass costs money per second and
 * might not. The Producer decides per shot, and records why.
 */

import type { Shot, OrganicPass } from '../graph/types.ts';

export type LedgerEntry = {
  nodeId: string;
  department: string;
  shotId?: string;
  durationMs: number;
  costUsd?: number;
  /** Provider calls made, for attributing spend. */
  calls?: { provider: string; model: string; count: number; costUsd?: number }[];
};

export type Ledger = {
  record(nodeId: string, entry: Omit<LedgerEntry, 'nodeId'>): void;
  entries(): readonly LedgerEntry[];
  totalCostUsd(): number;
  totalDurationMs(): number;
  byShot(): Map<string, { costUsd: number; durationMs: number; nodes: number }>;
  byDepartment(): Map<string, { costUsd: number; durationMs: number; nodes: number }>;
};

export function createLedger(): Ledger {
  const entries: LedgerEntry[] = [];
  return {
    record: (nodeId, entry) => void entries.push({ nodeId, ...entry }),
    entries: () => entries,
    totalCostUsd: () => entries.reduce((a, e) => a + (e.costUsd ?? 0), 0),
    totalDurationMs: () => entries.reduce((a, e) => a + e.durationMs, 0),
    byShot: () => {
      const out = new Map<string, { costUsd: number; durationMs: number; nodes: number }>();
      for (const e of entries) {
        if (!e.shotId) continue;
        const cur = out.get(e.shotId) ?? { costUsd: 0, durationMs: 0, nodes: 0 };
        cur.costUsd += e.costUsd ?? 0;
        cur.durationMs += e.durationMs;
        cur.nodes++;
        out.set(e.shotId, cur);
      }
      return out;
    },
    byDepartment: () => {
      const out = new Map<string, { costUsd: number; durationMs: number; nodes: number }>();
      for (const e of entries) {
        const cur = out.get(e.department) ?? { costUsd: 0, durationMs: 0, nodes: 0 };
        cur.costUsd += e.costUsd ?? 0;
        cur.durationMs += e.durationMs;
        cur.nodes++;
        out.set(e.department, cur);
      }
      return out;
    },
  };
}

export type ProducerPolicy = {
  /** Total budget for the production, in US dollars. */
  totalBudgetUsd: number;
  /** Ceiling per shot. */
  perShotBudgetUsd: number;
  /** Estimated cost of one second of organic pass. */
  organicCostPerSecondUsd: number;
  /** Only attempt the organic pass on shots at or above this importance. */
  minImportanceForOrganic: number;
  /** Reserve this fraction of the budget for repairs and reshoots. */
  reserveFraction: number;
};

export const DEFAULT_POLICY: ProducerPolicy = {
  totalBudgetUsd: 500,
  perShotBudgetUsd: 12,
  organicCostPerSecondUsd: 0.9,
  minImportanceForOrganic: 3,
  reserveFraction: 0.25,
};

export type ShotPlan = {
  shotId: string;
  organicPass: OrganicPass;
  estimatedCostUsd: number;
  /** Why this decision was made, shown on the shot board. */
  rationale: string;
};

/**
 * Decide the fallback ladder per shot.
 *
 * The rig render is the baseline and always ships. The organic pass is
 * attempted where the shot earns it — an emotional peak, a hero moment —
 * and only while the budget holds. Design law 6: it has to beat the
 * baseline at the gate or be discarded, so attempting it is never a risk
 * to quality, only to spend.
 */
export function planShots(
  shots: readonly Shot[],
  policy: ProducerPolicy = DEFAULT_POLICY,
  fps = 24,
): { plans: ShotPlan[]; totalEstimateUsd: number; withinBudget: boolean } {
  const spendable = policy.totalBudgetUsd * (1 - policy.reserveFraction);
  // Rank shots by how much an organic pass would buy: emotional peaks and
  // close-ups first, wide establishing shots last.
  const scored = shots.map((shot) => {
    const peak = Math.max(0, ...shot.beats.map((b) => b.intensity));
    const closeness =
      shot.camera.size === 'ecu' || shot.camera.size === 'cu'
        ? 2
        : shot.camera.size === 'mcu' || shot.camera.size === 'ms'
          ? 1
          : 0;
    return { shot, importance: peak + closeness };
  });
  scored.sort((a, b) => b.importance - a.importance || a.shot.id.localeCompare(b.shot.id));

  const plans: ShotPlan[] = [];
  let spent = 0;
  for (const { shot, importance } of scored) {
    const seconds = shot.durationFrames / fps;
    const organicCost = seconds * policy.organicCostPerSecondUsd;
    const affordable = spent + organicCost <= spendable && organicCost <= policy.perShotBudgetUsd;
    const earned = importance >= policy.minImportanceForOrganic;

    if (shot.organicPass === 'require') {
      plans.push({
        shotId: shot.id,
        organicPass: 'require',
        estimatedCostUsd: organicCost,
        rationale: 'The shot is marked as requiring the organic pass, so it runs regardless of rank.',
      });
      spent += organicCost;
      continue;
    }
    if (earned && affordable) {
      plans.push({
        shotId: shot.id,
        organicPass: 'try',
        estimatedCostUsd: organicCost,
        rationale: `Importance ${importance} at ${seconds.toFixed(1)}s: worth ${organicCost.toFixed(2)} USD to try, and the rig render still ships if it does not beat the baseline.`,
      });
      spent += organicCost;
      continue;
    }
    plans.push({
      shotId: shot.id,
      organicPass: 'off',
      estimatedCostUsd: 0,
      rationale: earned
        ? `Would benefit from the organic pass but the budget is spent (${spent.toFixed(2)} of ${spendable.toFixed(2)} USD).`
        : `Importance ${importance} is below the bar of ${policy.minImportanceForOrganic}; the rig render is the right answer here.`,
    });
  }

  plans.sort((a, b) => a.shotId.localeCompare(b.shotId));
  return { plans, totalEstimateUsd: spent, withinBudget: spent <= spendable };
}

/** Format the ledger as the producer's report. */
export function formatLedger(ledger: Ledger): string {
  const lines: string[] = [];
  lines.push('Producer ledger');
  lines.push('');
  lines.push('By department:');
  for (const [dept, v] of [...ledger.byDepartment()].sort((a, b) => b[1].durationMs - a[1].durationMs)) {
    lines.push(
      `  ${dept.padEnd(14)} ${String(v.nodes).padStart(4)} nodes  ${(v.durationMs / 1000).toFixed(2).padStart(8)}s  ${v.costUsd.toFixed(2).padStart(7)} USD`,
    );
  }
  const shots = ledger.byShot();
  if (shots.size) {
    lines.push('');
    lines.push('By shot:');
    for (const [shotId, v] of [...shots].sort((a, b) => b[1].durationMs - a[1].durationMs).slice(0, 20)) {
      lines.push(
        `  ${shotId.padEnd(24)} ${(v.durationMs / 1000).toFixed(2).padStart(8)}s  ${v.costUsd.toFixed(2).padStart(7)} USD`,
      );
    }
  }
  lines.push('');
  lines.push(
    `Total: ${(ledger.totalDurationMs() / 1000).toFixed(2)}s, ${ledger.totalCostUsd().toFixed(2)} USD across ${ledger.entries().length} nodes.`,
  );
  return lines.join('\n');
}
