/**
 * The studio's view of an engine build.
 *
 * These types mirror `engine/src/delivery/studio.ts`. They are written
 * out by hand rather than imported because the engine is a zero-runtime
 * dependency Node package with `.ts` import specifiers, and pulling it
 * through the app bundler would couple the two builds for no benefit:
 * the studio only ever reads JSON that the engine already wrote.
 *
 * `STUDIO_BUILD_VERSION` is the contract. If the engine bumps it, the
 * studio says so instead of rendering a half-understood build.
 */

export const STUDIO_BUILD_VERSION = 1;

export type Severity = 'info' | 'warn' | 'error' | 'fatal';

export type Locator = {
  shotId?: string;
  sequenceId?: string;
  characterId?: string;
  environmentId?: string;
  frame?: number;
  frameRange?: [number, number];
  partId?: string;
  boneId?: string;
  path?: string;
  artifactRefs?: string[];
  region?: { x: number; y: number; w: number; h: number };
};

export type Evidence = {
  kind: 'frame' | 'contactSheet' | 'overlay' | 'plot' | 'json' | 'text';
  ref: string;
  caption?: string;
};

export type CheckResult = {
  name: string;
  department: string;
  pass: boolean;
  score: number;
  measured?: number;
  threshold?: number;
  comparator?: '>=' | '<=' | '==' | 'range';
  severity: Severity;
  message: string;
  diagnosis?: string;
  where: Locator;
  evidence?: Evidence[];
  durationMs?: number;
};

export type ScoreSheet = {
  subject: string;
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  clean: boolean;
  blocking: string[];
  checks: CheckResult[];
  generatedAt: string;
};

export type RepairRecord = {
  attempt: number;
  failedCheck: string;
  diagnosis: string;
  move: string;
  scope: Locator;
  outcome: 'fixed' | 'improved' | 'no_change' | 'worse' | 'escalated';
  scoreBefore: number;
  scoreAfter: number;
  at: string;
};

export type StudioNode = {
  id: string;
  department: string;
  title: string;
  shotId?: string;
  status: string;
  score?: number;
  passed: number;
  failed: number;
  warnings: number;
  fromCache: boolean;
  durationMs: number;
  repairs: RepairRecord[];
  escalation?: { summary: string; where: unknown };
  checks: CheckResult[];
  gate?: string;
};

export type StudioShot = {
  id: string;
  number: number;
  sceneId: string;
  sceneName: string;
  sequenceName: string;
  slug: string;
  durationFrames: number;
  timecode: string;
  size: string;
  angle: string;
  move: string;
  status: string;
  intent: string;
  beats: {
    id: string;
    intent: string;
    startFrame: number;
    durationFrames: number;
    emotion: string;
    intensity: number;
  }[];
  dialogue: {
    id: string;
    characterId: string;
    text: string;
    startFrame: number;
    durationFrames: number;
  }[];
  characters: string[];
  frames: string[];
  board?: string;
  contactSheet?: string;
  score?: number;
  checks: CheckResult[];
};

export type StudioInvariant = {
  number: number;
  id: string;
  title: string;
  statement: string;
  state: 'held' | 'broken' | 'unmeasured';
  blocking: boolean;
  message: string;
  checks: string[];
  calibration?: string;
};

export type StudioBuild = {
  version: number;
  builtAt: string;
  project: {
    id: string;
    name: string;
    logline: string;
    styleBible: string;
    fps: number;
    width: number;
    height: number;
    characters: { id: string; name: string; description: string }[];
    environments: { id: string; name: string }[];
  };
  graphHash: string;
  score: ScoreSheet;
  departments: {
    department: string;
    score: number;
    passed: number;
    failed: number;
    warnings: number;
  }[];
  nodes: StudioNode[];
  shots: StudioShot[];
  invariants: StudioInvariant[];
  delivery: { ok: boolean; blocking: string[]; unmeasured: string[] };
  escalated: string[];
  awaitingGate: string[];
  gates: {
    id: string;
    nodeId: string;
    gate: string;
    title: string;
    shotId?: string;
    artifact?: string;
  }[];
  stats: { durationMs: number; cacheHits: number; nodes: number; checks: number; frames: number };
  caveats: string[];
};

export type DrawOverStroke = { frame: number; points: { x: number; y: number }[]; label?: string };

export type StructuredEdit = {
  op: string;
  target: Locator;
  params: Record<string, number | string | boolean>;
  rationale: string;
};

export type DirectorNote = {
  id: string;
  text: string;
  drawOver?: DrawOverStroke[];
  edits: StructuredEdit[];
  at: string;
  by: string;
  resolved: boolean;
  shotId?: string;
};

export type HumanApproval = {
  gate: 'boards' | 'modelSheet' | 'animatic' | 'final';
  approved: boolean;
  by: string;
  at: string;
  notes?: string;
  nodeId: string;
};

export type StudioDecisions = {
  approvals: HumanApproval[];
  notes: DirectorNote[];
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
};

/** Worst first: a dashboard that opens on what passed is decoration. */
export function bySeverity(a: CheckResult, b: CheckResult): number {
  if (a.pass !== b.pass) return a.pass ? 1 : -1;
  const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return s !== 0 ? s : a.score - b.score;
}
