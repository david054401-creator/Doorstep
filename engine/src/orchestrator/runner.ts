/**
 * The node runner.
 *
 *   run(node) -> validate
 *     if pass: commit, advance
 *     else:    diagnose, repair the failing node only, re-validate
 *              attempts++ ; over budget -> escalate with a diagnosis card
 *
 * Three properties this file exists to guarantee:
 *   - nothing advances past a failed gate;
 *   - a node never reports "done" without a score sheet;
 *   - a repair that makes the score worse is rolled back.
 */

import type { Dag, NodeContract, NodeContext, NodeResult, NodeStatus } from './dag.ts';
import { downstreamOf, nodeCacheKey, readyNodes } from './dag.ts';
import type { Cache } from './cache.ts';
import { memoryCache } from './cache.ts';
import type { CheckResult, ScoreSheet } from '../core/result.ts';
import { scoreSheet, rollUp } from '../core/result.ts';
import type { RepairRecord, HumanApproval } from '../graph/types.ts';
import type { Logger } from '../core/log.ts';
import { silentLogger } from '../core/log.ts';
import { hashContent, provenance } from '../core/ids.ts';
import type { Ledger } from './budget.ts';
import { createLedger } from './budget.ts';

export type GateResolver = (
  gate: NonNullable<NodeContract['gate']>,
  node: NodeContract<never, unknown>,
  output: unknown,
  checks: readonly CheckResult[],
) => Promise<HumanApproval | null> | HumanApproval | null;

export type RunOptions = {
  cache?: Cache;
  logger?: Logger;
  ledger?: Ledger;
  /** How many nodes may run at once. Shots are independent, so > 1 pays. */
  concurrency?: number;
  /** Resolve human gates. Without one, gated nodes block and say so. */
  gates?: GateResolver;
  /** Run these node ids only, plus whatever they depend on. */
  only?: string[];
  /** Treat these nodes as dirty even if cached. */
  force?: string[];
  /** Stop the whole run on the first escalation. */
  stopOnEscalation?: boolean;
  /** Skip nodes whose severity would only warn. */
  minImprovement?: number;
};

export type RunReport = {
  results: Map<string, NodeResult>;
  scoreSheet: ScoreSheet;
  /** Node ids that escalated, in the order they did. */
  escalated: string[];
  /** Node ids blocked behind an unresolved human gate. */
  awaitingGate: string[];
  durationMs: number;
  cacheHits: number;
  ledger: Ledger;
};

export async function runDag(dag: Dag, options: RunOptions = {}): Promise<RunReport> {
  const cache = options.cache ?? memoryCache();
  const log = (options.logger ?? silentLogger()).child('orchestrator');
  const ledger = options.ledger ?? createLedger();
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const force = new Set(options.force ?? []);
  const startedAt = Date.now();

  // Restrict to the requested nodes plus their transitive inputs.
  let allowed: Set<string> | null = null;
  if (options.only?.length) {
    allowed = new Set<string>();
    const stack = [...options.only];
    while (stack.length) {
      const id = stack.pop()!;
      if (allowed.has(id)) continue;
      allowed.add(id);
      for (const dep of dag.nodes.get(id)?.inputs ?? []) stack.push(dep);
    }
  }

  const results = new Map<string, NodeResult>();
  const complete = new Set<string>();
  const escalated: string[] = [];
  const awaitingGate: string[] = [];
  const blocked = new Set<string>();
  let cacheHits = 0;
  let stopped = false;

  const markBlocked = (nodeId: string, reason: NodeStatus): void => {
    for (const id of downstreamOf(dag, nodeId)) {
      if (complete.has(id) || blocked.has(id)) continue;
      blocked.add(id);
      results.set(id, {
        nodeId: id,
        status: reason === 'escalated' ? 'blocked' : 'blocked',
        checks: [],
        repairs: [],
        cacheKey: 'sha256:blocked',
        fromCache: false,
        durationMs: 0,
        escalation: {
          summary: `Blocked: upstream node "${nodeId}" did not clear its gate.`,
          where: { path: nodeId },
        },
      });
      complete.add(id);
    }
  };

  while (!stopped) {
    const ready = readyNodes(dag, complete).filter(
      (id) => (!allowed || allowed.has(id)) && !blocked.has(id),
    );
    if (ready.length === 0) break;

    const batch = ready.slice(0, concurrency);
    const settled = await Promise.all(
      batch.map((id) =>
        runNode(dag, id, {
          cache,
          log,
          ledger,
          results,
          force: force.has(id),
          gates: options.gates,
        }),
      ),
    );

    for (const result of settled) {
      results.set(result.nodeId, result);
      complete.add(result.nodeId);
      if (result.fromCache) cacheHits++;
      if (result.status === 'escalated' || result.status === 'failed') {
        escalated.push(result.nodeId);
        markBlocked(result.nodeId, 'escalated');
        if (options.stopOnEscalation) stopped = true;
      } else if (result.status === 'blocked') {
        awaitingGate.push(result.nodeId);
        markBlocked(result.nodeId, 'blocked');
      }
    }
    // Nodes that were never reached because everything left is blocked.
    if (batch.length === 0) break;
  }

  const sheets = [...results.values()]
    .filter((r) => r.scoreSheet)
    .map((r) => r.scoreSheet!);
  return {
    results,
    scoreSheet: rollUp('run', sheets),
    escalated,
    awaitingGate,
    durationMs: Date.now() - startedAt,
    cacheHits,
    ledger,
  };
}

type RunNodeDeps = {
  cache: Cache;
  log: Logger;
  ledger: Ledger;
  results: Map<string, NodeResult>;
  force: boolean;
  gates?: GateResolver;
};

export async function runNode(dag: Dag, nodeId: string, deps: RunNodeDeps): Promise<NodeResult> {
  const contract = dag.nodes.get(nodeId)!;
  const log = deps.log.child(contract.department, { nodeId, shotId: contract.shotId });
  const startedAt = Date.now();

  const inputs: Record<string, unknown> = {};
  const inputHashes: string[] = [];
  for (const id of contract.inputs) {
    const r = deps.results.get(id);
    inputs[id] = r?.output;
    inputHashes.push(hashContent(r?.output ?? null));
  }
  const inputHash = hashContent(inputHashes);
  const key = nodeCacheKey(contract, inputHashes);

  const makeContext = (attempt: number, signal?: AbortSignal): NodeContext<never> => ({
    inputs,
    input: (contract.inputs.length === 1 ? inputs[contract.inputs[0]] : inputs) as never,
    node: contract as NodeContract<never, unknown>,
    inputHash,
    attempt,
    signal,
    log: (message, data) => log.info(message, data),
  });

  if (contract.when && !contract.when(makeContext(0))) {
    return {
      nodeId,
      status: 'skipped',
      checks: [],
      repairs: [],
      cacheKey: key,
      fromCache: false,
      durationMs: Date.now() - startedAt,
    };
  }

  // Cache hit: the artifact and its verdict are both content-addressed,
  // so a hit means this exact input produced this exact validated output.
  if (!deps.force) {
    const hit = deps.cache.get<{ output: unknown; checks: CheckResult[] }>(key);
    if (hit) {
      const sheet = scoreSheet(nodeId, hit.value.checks);
      log.debug('cache hit', { key });
      return {
        nodeId,
        status: sheet.clean ? 'cached' : 'failed',
        output: hit.value.output,
        checks: hit.value.checks,
        scoreSheet: sheet,
        repairs: [],
        cacheKey: key,
        fromCache: true,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const controller = new AbortController();
  const timer = contract.budget.timeMs
    ? setTimeout(() => controller.abort(), contract.budget.timeMs)
    : null;

  const repairs: RepairRecord[] = [];
  let output: unknown;
  let checks: CheckResult[] = [];
  let sheet: ScoreSheet;

  try {
    output = await contract.run(makeContext(0, controller.signal));
    checks = contract.validate ? await contract.validate(output, makeContext(0)) : [];
    sheet = scoreSheet(nodeId, checks);

    // The bounded repair loop.
    for (let attempt = 1; attempt <= contract.budget.attempts && !sheet.clean; attempt++) {
      if (!contract.repair) break;
      const target = checks
        .filter((c) => !c.pass && c.severity !== 'info')
        .sort((a, b) => rank(b) - rank(a) || a.score - b.score)[0];
      if (!target) break;

      log.info('repairing', { check: target.name, diagnosis: target.diagnosis, attempt });
      const repaired = await contract.repair(output, target, attempt - 1, makeContext(attempt));
      if (!repaired) break;

      const nextChecks = contract.validate
        ? await contract.validate(repaired, makeContext(attempt))
        : [];
      const nextSheet = scoreSheet(nodeId, nextChecks);
      const improved = nextSheet.score > sheet.score + 1e-9 || nextSheet.failed < sheet.failed;

      repairs.push({
        attempt,
        failedCheck: target.name,
        diagnosis: target.diagnosis ?? 'unknown',
        move: 'node.repair',
        scope: target.where,
        before: { score: sheet.score },
        after: { score: nextSheet.score },
        outcome: nextSheet.clean ? 'fixed' : improved ? 'improved' : 'no_change',
        scoreBefore: sheet.score,
        scoreAfter: nextSheet.score,
        at: new Date().toISOString(),
      });

      // A repair that does not help is rolled back, so the loop can never
      // wander into a worse artifact than it started with.
      if (!improved) {
        log.info('repair rolled back', { check: target.name });
        break;
      }
      output = repaired;
      checks = nextChecks;
      sheet = nextSheet;
    }
  } catch (e) {
    const message = (e as Error).message;
    const failed: CheckResult = {
      name: `${contract.department}.node_error`,
      department: contract.department,
      pass: false,
      score: 0,
      severity: 'fatal',
      message: `The node threw: ${message}`,
      diagnosis: 'node.error',
      where: { shotId: contract.shotId, path: nodeId },
    };
    checks = [...checks, failed];
    sheet = scoreSheet(nodeId, checks);
    log.error('node failed', { error: message });
    if (timer) clearTimeout(timer);
    return {
      nodeId,
      status: 'failed',
      checks,
      scoreSheet: sheet,
      repairs,
      cacheKey: key,
      fromCache: false,
      durationMs: Date.now() - startedAt,
      escalation: { summary: `Node "${contract.title}" threw: ${message}`, where: { path: nodeId } },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;
  deps.ledger.record(nodeId, { department: contract.department, durationMs, shotId: contract.shotId });

  // A human gate blocks its dependents until someone approves.
  if (contract.gate) {
    const approval = deps.gates ? await deps.gates(contract.gate, contract, output, checks) : null;
    if (!approval) {
      return {
        nodeId,
        status: 'blocked',
        output,
        checks,
        scoreSheet: sheet,
        repairs,
        cacheKey: key,
        fromCache: false,
        durationMs,
        escalation: {
          summary:
            `"${contract.title}" is waiting on the ${contract.gate} gate. ` +
            'Nothing downstream runs until a person approves it — there is no path from failed to done that skips a human.',
          where: { shotId: contract.shotId, path: nodeId },
        },
      };
    }
    if (!approval.approved) {
      return {
        nodeId,
        status: 'escalated',
        output,
        checks,
        scoreSheet: sheet,
        repairs,
        cacheKey: key,
        fromCache: false,
        durationMs,
        escalation: {
          summary: `The ${contract.gate} gate was rejected by ${approval.by}: ${approval.notes ?? 'no note given'}`,
          where: { shotId: contract.shotId, path: nodeId },
        },
      };
    }
    log.info('gate approved', { gate: contract.gate, by: approval.by });
  }

  if (sheet.clean) {
    deps.cache.set(
      key,
      { output, checks },
      provenance({
        tool: contract.tool,
        toolVersion: contract.toolVersion,
        params: contract.params,
        inputs: inputHashes,
        durationMs,
      }),
    );
  }

  return {
    nodeId,
    status: sheet.clean ? 'passed' : 'escalated',
    output,
    checks,
    scoreSheet: sheet,
    repairs,
    cacheKey: key,
    fromCache: false,
    durationMs,
    escalation: sheet.clean
      ? undefined
      : {
          summary: escalationSummary(contract, checks, repairs),
          where: { shotId: contract.shotId, path: nodeId },
        },
  };
}

function rank(c: CheckResult): number {
  return c.severity === 'fatal' ? 3 : c.severity === 'error' ? 2 : c.severity === 'warn' ? 1 : 0;
}

function escalationSummary(
  contract: NodeContract<never, unknown>,
  checks: readonly CheckResult[],
  repairs: readonly RepairRecord[],
): string {
  const failing = checks.filter((c) => !c.pass && c.severity !== 'info');
  const lines = [
    `"${contract.title}" (${contract.department}) did not reach a clean score sheet.`,
    '',
    'What failed:',
    ...failing.map((c) => `  - ${c.name}: ${c.message}`),
    '',
    repairs.length
      ? `Repairs attempted: ${repairs.map((r) => `${r.diagnosis} (${r.outcome})`).join(', ')}`
      : 'No repair move was available for these diagnoses.',
  ];
  return lines.join('\n');
}
