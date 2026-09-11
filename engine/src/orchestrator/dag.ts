/**
 * The build graph.
 *
 * Build-system semantics, applied to film (design law 11): nodes are
 * content-addressed, an upstream change invalidates everything downstream,
 * and a node whose inputs have not changed is not recomputed. This is what
 * makes "change the model sheet and re-validate every shot that uses it"
 * a property of the system rather than a discipline someone has to keep.
 */

import type { Hash } from '../core/ids.ts';
import { cacheKey } from '../core/ids.ts';
import type { CheckResult, ScoreSheet, Locator } from '../core/result.ts';
import type { RepairRecord } from '../graph/types.ts';

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'cached'
  | 'passed'
  | 'repairing'
  | 'failed'
  | 'escalated'
  | 'skipped'
  | 'blocked';

export type Budget = {
  /** Max repair attempts for this node. */
  attempts: number;
  /** Wall-clock ceiling in milliseconds. */
  timeMs?: number;
  /** Spend ceiling in US dollars, for nodes that call paid providers. */
  costUsd?: number;
};

/**
 * A node contract.
 *
 * Everything a node needs to be run, judged, repaired and escalated,
 * declared up front. The runner knows nothing about departments: it only
 * knows how to honour this contract.
 */
export type NodeContract<TIn = unknown, TOut = unknown> = {
  id: string;
  /** Department, for grouping in the UI and the score sheet. */
  department: string;
  /** Human-readable name. */
  title: string;
  /** Ids of nodes this one consumes. */
  inputs: string[];
  /** Tool identity, recorded in provenance and mixed into the cache key. */
  tool: string;
  toolVersion: string;
  /** Parameters that affect the output, mixed into the cache key. */
  params?: Record<string, unknown>;
  /** Which shot this node belongs to, when it belongs to one. */
  shotId?: string;
  budget: Budget;
  /** Produce the artifact. */
  run(context: NodeContext<TIn>): Promise<TOut> | TOut;
  /** Judge the artifact. Must return diagnosis-carrying checks. */
  validate?(output: TOut, context: NodeContext<TIn>): Promise<CheckResult[]> | CheckResult[];
  /** Repair the artifact in place, scoped to the failing check. */
  repair?(
    output: TOut,
    check: CheckResult,
    attempt: number,
    context: NodeContext<TIn>,
  ): Promise<TOut | null> | TOut | null;
  /** Skip execution entirely when this returns false. */
  when?(context: NodeContext<TIn>): boolean;
  /** Human gate this node must clear before dependents may run. */
  gate?: 'boards' | 'modelSheet' | 'animatic' | 'final';
};

export type NodeContext<TIn = unknown> = {
  /** Outputs of every input node, keyed by node id. */
  inputs: Record<string, unknown>;
  /** Typed convenience view when a node has exactly one input. */
  input: TIn;
  /** The node's own contract. */
  node: NodeContract<TIn, unknown>;
  /** Content hash of the resolved inputs. */
  inputHash: Hash;
  /** Emit progress without returning. */
  log(message: string, data?: Record<string, unknown>): void;
  /** Attempt number, 0 on the first run. */
  attempt: number;
  /** Abort signal honouring the node's time budget. */
  signal?: AbortSignal;
};

export type NodeResult<TOut = unknown> = {
  nodeId: string;
  status: NodeStatus;
  output?: TOut;
  checks: CheckResult[];
  scoreSheet?: ScoreSheet;
  repairs: RepairRecord[];
  /** Cache key that was looked up or written. */
  cacheKey: Hash;
  fromCache: boolean;
  durationMs: number;
  costUsd?: number;
  /** Populated on escalation. */
  escalation?: { summary: string; where: Locator };
};

export type Dag = {
  nodes: Map<string, NodeContract<never, unknown>>;
  /** node id -> ids of nodes that consume it. */
  dependents: Map<string, string[]>;
  /** Topological order, roots first. */
  order: string[];
};

/** Build a DAG from node contracts. Throws on a cycle or a missing input. */
export function buildDag(contracts: readonly NodeContract<never, unknown>[]): Dag {
  const nodes = new Map<string, NodeContract<never, unknown>>();
  for (const c of contracts) {
    if (nodes.has(c.id)) throw new Error(`duplicate node id: ${c.id}`);
    nodes.set(c.id, c);
  }
  const dependents = new Map<string, string[]>();
  for (const c of contracts) {
    for (const input of c.inputs) {
      if (!nodes.has(input)) {
        throw new Error(`node "${c.id}" depends on "${input}", which is not in the graph`);
      }
      const list = dependents.get(input);
      if (list) list.push(c.id);
      else dependents.set(input, [c.id]);
    }
  }
  for (const list of dependents.values()) list.sort();

  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]): void => {
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) throw new Error(`cycle in the build graph: ${[...stack, id].join(' -> ')}`);
    state.set(id, 1);
    for (const dep of nodes.get(id)!.inputs) visit(dep, [...stack, id]);
    state.set(id, 2);
    order.push(id);
  };
  for (const id of [...nodes.keys()].sort()) visit(id, []);
  return { nodes, dependents, order };
}

/** Everything downstream of a node, transitively. */
export function downstreamOf(dag: Dag, nodeId: string): string[] {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const dep of dag.dependents.get(id) ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      stack.push(dep);
    }
  }
  return [...out].sort();
}

/** Everything a node depends on, transitively. */
export function upstreamOf(dag: Dag, nodeId: string): string[] {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const dep of dag.nodes.get(id)?.inputs ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      stack.push(dep);
    }
  }
  return [...out].sort();
}

/** Nodes with no unmet dependencies, given a set already complete. */
export function readyNodes(dag: Dag, complete: ReadonlySet<string>): string[] {
  return dag.order.filter(
    (id) => !complete.has(id) && dag.nodes.get(id)!.inputs.every((i) => complete.has(i)),
  );
}

/** The cache key for a node, given the hashes of its resolved inputs. */
export function nodeCacheKey(
  contract: NodeContract<never, unknown>,
  inputHashes: readonly Hash[],
): Hash {
  return cacheKey({
    tool: contract.tool,
    toolVersion: contract.toolVersion,
    inputs: inputHashes,
    params: contract.params ?? {},
  });
}

/** Group node ids by the shot they belong to, for per-shot parallelism. */
export function groupByShot(dag: Dag): Map<string | undefined, string[]> {
  const out = new Map<string | undefined, string[]>();
  for (const id of dag.order) {
    const shotId = dag.nodes.get(id)!.shotId;
    const list = out.get(shotId);
    if (list) list.push(id);
    else out.set(shotId, [id]);
  }
  return out;
}
