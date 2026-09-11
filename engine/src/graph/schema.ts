/**
 * Zod schemas for the Film Graph.
 *
 * `types.ts` holds the hand-written types and has no dependencies, so the
 * whole engine core runs without an install step. This file is the
 * validation boundary: anything crossing into the engine from disk, an
 * API, or a model gets parsed here first.
 *
 * Each schema is declared as `z.ZodType<T>` against the hand-written type,
 * so the compiler rejects any schema that drifts from the type it claims
 * to describe. The two cannot silently disagree.
 */

import { z } from 'zod';
import type { CheckResult, Locator, Evidence, ScoreSheet, Severity } from '../core/result.ts';
import type { Provenance } from '../core/ids.ts';
import type {
  Project,
  StyleBible,
  Character,
  ModelSheet,
  Rig,
  Bone,
  Part,
  PartMesh,
  IKChain,
  Environment,
  Sequence,
  Scene,
  Shot,
  Beat,
  Line,
  KeyPose,
  Channel,
  Keyframe,
  TimingChart,
  Staging,
  Placement,
  CameraCurve,
  LayerStack,
  DeliverySpec,
  ValidationRecord,
  RepairRecord,
  DirectorNote,
  StructuredEdit,
  ContinuityLedger,
  NamedSwatch,
  Point,
  AssetRef,
  ViewName,
  Viseme,
  Clip,
  FxElement,
  SwapSets,
  ModelSheetView,
  CriticVerdict,
  HumanApproval,
} from './types.ts';

const point: z.ZodType<Point> = z.object({ x: z.number(), y: z.number() });

const hex = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be a hex colour');

const isoDate = z.string().min(1);

/**
 * Provenance, checks and score sheets are not incidental metadata: the
 * contract in §7 is that no artifact is admissible without them. Parsing
 * them as `z.any()` would mean the validation boundary accepts a film
 * whose evidence is a string, which is exactly the failure mode the whole
 * design exists to prevent.
 */
export const provenanceSchema: z.ZodType<Provenance> = z.object({
  tool: z.string().min(1),
  toolVersion: z.string().min(1),
  model: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  seed: z.number().optional(),
  inputs: z.array(z.string().regex(/^sha256:[0-9a-f]+$/)),
  createdAt: isoDate,
  durationMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

const severity: z.ZodType<Severity> = z.enum(['info', 'warn', 'error', 'fatal']);

export const locatorSchema: z.ZodType<Locator> = z.object({
  shotId: z.string().optional(),
  sequenceId: z.string().optional(),
  characterId: z.string().optional(),
  environmentId: z.string().optional(),
  frame: z.number().optional(),
  frameRange: z.tuple([z.number(), z.number()]).optional(),
  partId: z.string().optional(),
  boneId: z.string().optional(),
  path: z.string().optional(),
  artifactRefs: z.array(z.string()).optional(),
  region: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional(),
});

const evidenceSchema: z.ZodType<Evidence> = z.object({
  kind: z.enum(['frame', 'contactSheet', 'overlay', 'plot', 'json', 'text']),
  ref: z.string().min(1),
  caption: z.string().optional(),
});

export const checkResultSchema: z.ZodType<CheckResult> = z.object({
  name: z.string().min(1),
  department: z.string().min(1),
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  measured: z.number().optional(),
  threshold: z.number().optional(),
  comparator: z.enum(['>=', '<=', '==', 'range']).optional(),
  severity,
  message: z.string().min(1, 'a check must say what happened, never just "failed"'),
  diagnosis: z.string().optional(),
  where: locatorSchema,
  evidence: z.array(evidenceSchema).optional(),
  durationMs: z.number().nonnegative().optional(),
});

export const scoreSheetSchema: z.ZodType<ScoreSheet> = z.object({
  subject: z.string().min(1),
  score: z.number().min(0).max(1),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  clean: z.boolean(),
  blocking: z.array(z.string()),
  checks: z.array(checkResultSchema),
  generatedAt: isoDate,
});

export const criticVerdictSchema: z.ZodType<CriticVerdict> = z.object({
  critic: z.string().min(1),
  rubric: z.string().min(1),
  verdict: z.enum(['pass', 'fail', 'uncertain']),
  confidence: z.number().min(0).max(1),
  // Law: a verdict with no citation is not admissible. The schema is where
  // that is enforced, not the caller.
  citations: z.array(z.object({ frame: z.number(), note: z.string() })),
  rationale: z.string().min(1),
  model: z.string().optional(),
});

export const humanApprovalSchema: z.ZodType<HumanApproval> = z.object({
  gate: z.enum(['boards', 'modelSheet', 'animatic', 'final']),
  approved: z.boolean(),
  by: z.string().min(1),
  at: isoDate,
  notes: z.string().optional(),
});

export const namedSwatchSchema: z.ZodType<NamedSwatch> = z.object({
  name: z.string().min(1),
  hex,
  role: z.string(),
  tolerance: z.number().positive().optional(),
});

export const assetRefSchema: z.ZodType<AssetRef> = z.object({
  uri: z.string().min(1),
  hash: z.string().regex(/^sha256:[0-9a-f]+$/),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const viewName: z.ZodType<ViewName> = z.enum([
  'front',
  'threeQuarterL',
  'threeQuarterR',
  'sideL',
  'sideR',
  'back',
]);

const viseme: z.ZodType<Viseme> = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);

const expressionName = z.enum([
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'scared',
  'thinking',
  'determined',
]);

const easeName = z.enum([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInStrong',
  'easeOutStrong',
  'hold',
  'step',
  'overshoot',
  'anticipate',
  'bounce',
  'elastic',
]);

const lightingRulesSchema = z.object({
  keyDirection: z.number(),
  keyColor: z.string(),
  fillColor: z.string(),
  rimColor: z.string().optional(),
  shadingModel: z.enum(['flat', 'twoTone', 'threeTone', 'painterly']),
  shadowQuality: z.string(),
  ambientOcclusion: z.boolean(),
});

export const styleBibleSchema: z.ZodType<StyleBible> = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  statement: z.string().min(1),
  palette: z.array(namedSwatchSchema),
  shapeLanguage: z.object({
    primary: z.string(),
    silhouetteRules: z.array(z.string()),
    heroShapes: z.array(z.string()),
    antagonistShapes: z.array(z.string()),
  }),
  lineRules: z.object({
    weight: z.number().positive(),
    weightVariance: z.number().nonnegative(),
    quality: z.enum(['constant', 'tapered', 'boiled']),
    color: z.string(),
    interiorLines: z.boolean(),
  }),
  lightingRules: lightingRulesSchema,
  textures: z.array(z.string()),
  forbidden: z.array(z.string()),
  referenceAssetIds: z.array(z.string()),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  locked: z.boolean(),
  provenance: provenanceSchema.optional(),
});

const keyframeSchema: z.ZodType<Keyframe> = z.object({
  frame: z.number(),
  value: z.number(),
  ease: easeName,
  handles: z
    .object({ outX: z.number(), outY: z.number(), inX: z.number(), inY: z.number() })
    .optional(),
});

export const channelSchema: z.ZodType<Channel> = z.object({
  target: z.string().min(1),
  keyframes: z.array(keyframeSchema),
  additive: z.boolean().optional(),
});

export const validationRecordSchema: z.ZodType<ValidationRecord> = z.object({
  checks: z.array(checkResultSchema),
  criticVerdicts: z.array(criticVerdictSchema),
  humanApproval: humanApprovalSchema.optional(),
  scoreSheet: scoreSheetSchema,
  validatedHash: z.string().optional(),
});

export const boneSchema: z.ZodType<Bone> = z.object({
  id: z.string().min(1),
  parent: z.string().nullable(),
  head: point,
  tail: point,
  restRotation: z.number(),
  length: z.number().nonnegative(),
  limits: z.object({ min: z.number(), max: z.number() }).nullable().optional(),
  spring: z
    .object({
      stiffness: z.number().positive(),
      damping: z.number().nonnegative(),
      mass: z.number().positive(),
      gravity: z.number(),
      maxAngle: z.number().positive(),
    })
    .optional(),
  kind: z.enum(['deform', 'control', 'ik', 'pole']),
});

export const partSchema: z.ZodType<Part> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  view: viewName,
  z: z.number(),
  contours: z.array(z.array(point)),
  fill: z.string(),
  shadeFill: z.string().optional(),
  shadeContours: z.array(z.array(point)).optional(),
  stroke: z.object({ color: z.string(), width: z.number().nonnegative() }).optional(),
  asset: assetRefSchema.optional(),
  pivot: point,
  bone: z.string().optional(),
  boneChain: z.array(z.string()).optional(),
  swapSet: z.string().optional(),
  swapKey: z.string().optional(),
  occlusionCompleted: z.boolean().optional(),
});

export const partMeshSchema: z.ZodType<PartMesh> = z.object({
  partId: z.string().min(1),
  vertices: z.array(point),
  triangles: z.array(z.number().int().nonnegative()),
  weights: z.array(z.array(z.object({ bone: z.string(), weight: z.number() }))),
  contourVertexIndex: z.array(z.array(z.number().int().nonnegative())),
});

export const ikChainSchema: z.ZodType<IKChain> = z.object({
  id: z.string().min(1),
  bones: z.array(z.string()).min(2),
  effector: z.string(),
  target: z.string(),
  poleTarget: z.string().optional(),
  weight: z.number().min(0).max(1),
  iterations: z.number().int().positive(),
});

/**
 * Swap sets are open: `mouth`, `eyes` and `hands` are always present, and
 * a rig may add its own (props, ears, tails). `catchall` is what keeps the
 * extra keys validated instead of merely tolerated.
 */
export const swapSetsSchema: z.ZodType<SwapSets> = z
  .object({
    mouth: z.array(viseme),
    eyes: z.array(z.string()),
    hands: z.array(z.string()),
  })
  .catchall(z.array(z.string()));

export const rigSchema: z.ZodType<Rig> = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  characterId: z.string().min(1),
  substrate: z.enum(['ts_native', 'blender_gp', 'godot', 'spine_json']),
  views: z.array(viewName).min(1),
  skeleton: z.array(boneSchema).min(1),
  viewSkeletons: z.partialRecord(viewName, z.array(boneSchema)).optional(),
  parts: z.array(partSchema),
  meshes: z.array(partMeshSchema),
  ik: z.array(ikChainSchema),
  springBones: z.array(z.string()),
  swapSets: swapSetsSchema,
  zOrderRules: z.array(z.object({ view: viewName, order: z.array(z.string()) })),
  restBounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  headUnitPx: z.number().positive(),
  validation: validationRecordSchema.optional(),
  locked: z.boolean(),
  provenance: provenanceSchema.optional(),
});

export const modelSheetViewSchema: z.ZodType<ModelSheetView> = z.object({
  view: viewName,
  asset: assetRefSchema.optional(),
  keypoints: z.record(z.string(), point),
  bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

export const modelSheetSchema: z.ZodType<ModelSheet> = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  characterId: z.string().min(1),
  views: z.partialRecord(viewName, modelSheetViewSchema),
  expressions: z.array(expressionName),
  hands: z.array(z.string()),
  construction: z.object({
    headUnits: z.number().positive(),
    proportionRatios: z.record(z.string(), z.number()),
    headHeightPx: z.number().positive(),
  }),
  lineWeight: z.number().positive(),
  locked: z.boolean(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  provenance: provenanceSchema.optional(),
});

export const clipSchema: z.ZodType<Clip> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tags: z.array(z.string()),
  durationFrames: z.number().int().positive(),
  loop: z.boolean(),
  channels: z.array(channelSchema),
  view: viewName,
});

export const characterSchema: z.ZodType<Character> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  modelSheet: modelSheetSchema,
  colorModel: z.array(namedSwatchSchema),
  rig: rigSchema.optional(),
  performanceLibrary: z.array(clipSchema),
  voiceId: z.string().optional(),
  identityDescriptor: z.array(z.number()).optional(),
  provenance: provenanceSchema.optional(),
});

export const environmentSchema: z.ZodType<Environment> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  layout: z.object({
    id: z.string(),
    vanishingPoints: z.array(point),
    horizonY: z.number(),
    blocks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        contours: z.array(z.array(point)),
        depth: z.number(),
      }),
    ),
    asset: assetRefSchema.optional(),
  }),
  layers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      depth: z.number().min(0).max(1),
      asset: assetRefSchema.optional(),
      contours: z.array(z.array(point)).optional(),
      fill: z.string().optional(),
      haze: z.number().optional(),
      blur: z.number().optional(),
      parallax: z.number().optional(),
    }),
  ),
  lightingKey: lightingRulesSchema,
  colorKey: z.array(namedSwatchSchema),
  locked: z.boolean(),
  provenance: provenanceSchema.optional(),
});

export const beatSchema: z.ZodType<Beat> = z.object({
  id: z.string().min(1),
  intent: z.string().min(1, 'every beat must state what the audience should understand'),
  action: z.string(),
  emotion: expressionName,
  intensity: z.number().min(1).max(5),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  characterId: z.string().optional(),
});

export const lineSchema: z.ZodType<Line> = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  text: z.string(),
  direction: z.string().optional(),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().nonnegative(),
  audioAsset: assetRefSchema.optional(),
  phonemes: z
    .array(z.object({ phoneme: z.string(), startFrame: z.number(), endFrame: z.number() }))
    .optional(),
  visemes: z
    .array(z.object({ viseme, startFrame: z.number(), endFrame: z.number() }))
    .optional(),
});

export const keyPoseSchema: z.ZodType<KeyPose> = z.object({
  id: z.string().min(1),
  frame: z.number().int().nonnegative(),
  characterId: z.string().min(1),
  poseId: z.string().optional(),
  boneTransforms: z.record(
    z.string(),
    z.object({
      rotation: z.number().optional(),
      translate: point.optional(),
      scale: point.optional(),
    }),
  ),
  swaps: z.record(z.string(), z.string()).optional(),
  lineOfAction: z.tuple([point, point]).optional(),
  silhouetteScore: z.number().optional(),
  intent: z.string().min(1, 'every key pose must say why it exists'),
  kind: z.enum(['key', 'breakdown', 'extreme', 'inbetween']),
});

const placementSchema: z.ZodType<Placement> = z.object({
  characterId: z.string().min(1),
  view: viewName,
  position: point,
  scale: z.number().positive(),
  facingRight: z.boolean(),
  depth: z.number().min(0).max(1),
});

const stagingSchema: z.ZodType<Staging> = z.object({
  characters: z.array(placementSchema),
  eyelines: z.record(z.string(), point),
  screenDirection: z.enum(['left', 'right', 'neutral']),
  cameraSide: z.enum(['A', 'B']),
  actionLine: z.tuple([point, point]).optional(),
});

const cameraCurveSchema: z.ZodType<CameraCurve> = z.object({
  keys: z.array(
    z.object({
      frame: z.number(),
      position: point,
      zoom: z.number().positive(),
      rotation: z.number(),
      ease: easeName,
    }),
  ),
  move: z.enum(['static', 'pan', 'truck', 'push', 'pull', 'handheld', 'crane']),
  handheldAmount: z.number().optional(),
});

const timingChartSchema: z.ZodType<TimingChart> = z.object({
  stepping: z.array(
    z.object({
      startFrame: z.number(),
      endFrame: z.number(),
      step: z.union([z.literal(1), z.literal(2)]),
    }),
  ),
  holds: z.array(
    z.object({ startFrame: z.number(), endFrame: z.number(), moving: z.boolean() }),
  ),
  breakdowns: z.array(z.number()),
});

const layerStackSchema: z.ZodType<LayerStack> = z.object({
  layers: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['bg', 'character', 'fx', 'overlay', 'grade']),
      depth: z.number(),
      sourceId: z.string(),
      opacity: z.number(),
      blend: z.enum(['normal', 'multiply', 'screen', 'add', 'overlay']),
      blur: z.number().optional(),
    }),
  ),
  grade: z
    .object({
      lift: z.number(),
      gamma: z.number(),
      gain: z.number(),
      saturation: z.number(),
      tint: z.string().optional(),
      tintAmount: z.number().optional(),
    })
    .optional(),
  grain: z.object({ amount: z.number(), size: z.number() }).optional(),
  vignette: z.object({ amount: z.number(), radius: z.number() }).optional(),
  glow: z.object({ threshold: z.number(), amount: z.number(), radius: z.number() }).optional(),
});

export const structuredEditSchema: z.ZodType<StructuredEdit> = z.object({
  op: z.string().min(1),
  target: locatorSchema,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  rationale: z.string(),
});

export const directorNoteSchema: z.ZodType<DirectorNote> = z.object({
  id: z.string().min(1),
  text: z.string(),
  drawOver: z
    .array(z.object({ frame: z.number(), points: z.array(point), label: z.string().optional() }))
    .optional(),
  edits: z.array(structuredEditSchema),
  at: z.string(),
  by: z.string(),
  resolved: z.boolean(),
});

export const repairRecordSchema: z.ZodType<RepairRecord> = z.object({
  attempt: z.number().int().nonnegative(),
  failedCheck: z.string(),
  diagnosis: z.string(),
  move: z.string(),
  scope: locatorSchema,
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  outcome: z.enum(['fixed', 'improved', 'no_change', 'worse', 'escalated']),
  scoreBefore: z.number(),
  scoreAfter: z.number(),
  at: z.string(),
});

export const fxElementSchema: z.ZodType<FxElement> = z.object({
  id: z.string().min(1),
  kind: z.enum(['dust', 'water', 'fire', 'smoke', 'impact', 'sparkle', 'custom']),
  startFrame: z.number(),
  durationFrames: z.number().int().nonnegative(),
  position: point,
  scale: z.number(),
  hitFrame: z.number().optional(),
  asset: assetRefSchema.optional(),
});

export const shotSchema: z.ZodType<Shot> = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  sceneId: z.string().min(1),
  durationFrames: z.number().int().positive(),
  camera: z.object({
    size: z.enum(['ecu', 'cu', 'mcu', 'ms', 'mls', 'ls', 'els', 'ots', 'twoShot']),
    angle: z.enum(['eye', 'low', 'high', 'dutch', 'birdseye', 'wormseye']),
    move: cameraCurveSchema,
  }),
  staging: stagingSchema,
  beats: z.array(beatSchema),
  dialogue: z.array(lineSchema),
  keys: z.array(keyPoseSchema),
  timing: timingChartSchema,
  curves: z.array(channelSchema),
  secondary: z.array(
    z.object({
      target: z.string(),
      lagFrames: z.number(),
      amplitude: z.number(),
      source: z.enum(['spring', 'offset', 'authored']),
    }),
  ),
  fx: z.array(fxElementSchema),
  comp: layerStackSchema,
  audio: z.object({
    vo: z.array(z.string()),
    sfx: z.array(
      z.object({
        id: z.string(),
        asset: assetRefSchema.optional(),
        startFrame: z.number(),
        gainDb: z.number(),
      }),
    ),
    music: z
      .object({ cueId: z.string(), startFrame: z.number(), gainDb: z.number() })
      .optional(),
  }),
  organicPass: z.enum(['off', 'try', 'require']),
  lockedAssets: z.record(z.string(), z.number()),
  validation: validationRecordSchema.optional(),
  repairs: z.array(repairRecordSchema),
  frames: z.array(assetRefSchema).optional(),
  status: z.enum([
    'planned',
    'boarded',
    'blocked',
    'animated',
    'rendered',
    'approved',
    'failed',
    'escalated',
  ]),
  notes: z.array(directorNoteSchema),
});

export const sceneSchema: z.ZodType<Scene> = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  slug: z.string(),
  environmentId: z.string().min(1),
  timeOfDay: z.enum(['dawn', 'day', 'dusk', 'night', 'interior']),
  shots: z.array(shotSchema),
});

export const sequenceSchema: z.ZodType<Sequence> = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  name: z.string(),
  scenes: z.array(sceneSchema),
  colorScript: z.array(
    z.object({
      sceneId: z.string(),
      swatches: z.array(namedSwatchSchema),
      note: z.string(),
    }),
  ),
});

export const deliverySpecSchema: z.ZodType<DeliverySpec> = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  colorSpace: z.enum(['sRGB', 'rec709', 'p3']),
  loudnessTargetLufs: z.number(),
  masterCodec: z.enum(['prores422', 'prores4444', 'png_sequence']),
  deliverableCodec: z.enum(['h264', 'av1', 'vp9']),
  safeAreaPercent: z.number().min(0).max(1),
});

export const continuityLedgerSchema: z.ZodType<ContinuityLedger> = z.object({
  entries: z.array(
    z.object({
      assetId: z.string(),
      kind: z.enum(['styleBible', 'modelSheet', 'rig', 'environment', 'colorScript', 'voice']),
      version: z.number().int(),
      hash: z.string(),
      lockedAt: z.string(),
      usedBy: z.array(z.string()),
    }),
  ),
  props: z.array(
    z.object({
      propId: z.string(),
      states: z.array(
        z.object({ shotId: z.string(), state: z.string(), heldBy: z.string().optional() }),
      ),
    }),
  ),
});

export const projectSchema: z.ZodType<Project> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  logline: z.string(),
  styleBible: styleBibleSchema,
  characters: z.array(characterSchema),
  environments: z.array(environmentSchema),
  sequences: z.array(sequenceSchema),
  deliverySpec: deliverySpecSchema,
  continuity: continuityLedgerSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  seed: z.number().int(),
  schemaVersion: z.literal(1),
});

/** Parse untrusted JSON into a Project, with readable errors. */
export function parseProject(value: unknown): Project {
  const result = projectSchema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 12)
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(
    `The project does not match the Film Graph schema:\n${issues}` +
      (result.error.issues.length > 12 ? `\n  ...and ${result.error.issues.length - 12} more` : ''),
  );
}

export function safeParseProject(value: unknown): { ok: true; project: Project } | { ok: false; errors: string[] } {
  const result = projectSchema.safeParse(value);
  if (result.success) return { ok: true, project: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
