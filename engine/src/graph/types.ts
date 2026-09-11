/**
 * THE FILM GRAPH
 *
 * The canonical intermediate representation. Every department reads and writes
 * this and nothing else. Pixels are a deterministic render of this structure,
 * never a source of truth (design law 1).
 *
 * These are hand-written plain types with zero runtime dependencies so the
 * whole engine core runs without an install step. `schema.ts` carries the Zod
 * schemas, and the compiler enforces that they describe exactly these types.
 */

import type { NamedSwatch } from '../core/color.ts';
import type { Provenance, Hash } from '../core/ids.ts';
import type { CheckResult, ScoreSheet, Locator } from '../core/result.ts';

export type { NamedSwatch };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };

/** Semantic version of a locked asset. Bumping it invalidates dependents. */
export type Version = number;

export type AssetRef = {
  /** Object-store key or repo-relative path. */
  uri: string;
  hash: Hash;
  mediaType: string;
  bytes?: number;
  width?: number;
  height?: number;
};

export type ViewName =
  | 'front'
  | 'threeQuarterL'
  | 'threeQuarterR'
  | 'sideL'
  | 'sideR'
  | 'back';

export const VIEW_NAMES: readonly ViewName[] = [
  'front',
  'threeQuarterL',
  'threeQuarterR',
  'sideL',
  'sideR',
  'back',
];

// ---------------------------------------------------------------------------
// Style bible — injected into every prompt and tool call (design law 9)
// ---------------------------------------------------------------------------

export type ShapeLanguage = {
  /** e.g. "rounded primary forms, no sharp negative space on heroes" */
  primary: string;
  /** Silhouette rules that make the cast readable at thumbnail size. */
  silhouetteRules: string[];
  /** Ratio of circle/square/triangle language for hero vs. threat. */
  heroShapes: string[];
  antagonistShapes: string[];
};

export type LineRules = {
  /** Base line weight in pixels at delivery resolution. */
  weight: number;
  /** Allowed weight variance as a fraction of base. */
  weightVariance: number;
  /** "constant" | "tapered" | "boiled" */
  quality: 'constant' | 'tapered' | 'boiled';
  /** Line colour, or "self" for coloured lines sampled from the fill. */
  color: string;
  /** Are interior construction lines allowed in final render? */
  interiorLines: boolean;
};

export type LightingRules = {
  /** Degrees; 0 = screen right, 90 = above. */
  keyDirection: number;
  keyColor: string;
  fillColor: string;
  rimColor?: string;
  /** Two-tone cel shading is the default for series work. */
  shadingModel: 'flat' | 'twoTone' | 'threeTone' | 'painterly';
  /** Shadow shape language: "hard graphic" etc. */
  shadowQuality: string;
  ambientOcclusion: boolean;
};

export type StyleBible = {
  id: string;
  version: Version;
  name: string;
  /** One paragraph a human and a model can both act on. */
  statement: string;
  palette: NamedSwatch[];
  shapeLanguage: ShapeLanguage;
  lineRules: LineRules;
  lightingRules: LightingRules;
  textures: string[];
  /** Hard "never do this" list, checked by critics and injected into prompts. */
  forbidden: string[];
  referenceAssetIds: string[];
  /** Aspect ratio + delivery resolution the bible is authored against. */
  canvas: { width: number; height: number };
  locked: boolean;
  provenance?: Provenance;
};

// ---------------------------------------------------------------------------
// Character: model sheet, parts, rig
// ---------------------------------------------------------------------------

export type Construction = {
  /** Total height measured in head units — the proportion contract. */
  headUnits: number;
  /** Named ratios measured from the sheet, e.g. shoulderWidth / headWidth. */
  proportionRatios: Record<string, number>;
  /** Pixel height of the head in the canonical sheet render. */
  headHeightPx: number;
};

export type ExpressionName =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'scared'
  | 'thinking'
  | 'determined';

/** Preston Blair mouth set, the standard 9 shapes Rhubarb also emits. */
export type Viseme = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'X';

export const VISEMES: readonly Viseme[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];

export type ModelSheetView = {
  view: ViewName;
  asset?: AssetRef;
  /** Measured keypoints in sheet space, used for proportion checks. */
  keypoints: Record<string, Point>;
  /** Bounding box of the character within the view. */
  bounds: { x: number; y: number; w: number; h: number };
};

export type ModelSheet = {
  id: string;
  version: Version;
  characterId: string;
  views: Partial<Record<ViewName, ModelSheetView>>;
  expressions: ExpressionName[];
  hands: string[];
  construction: Construction;
  lineWeight: number;
  /** Locked sheets are the truth every shot references (design law 2). */
  locked: boolean;
  approvedBy?: string;
  approvedAt?: string;
  provenance?: Provenance;
};

/** A drawable piece of a character: an SVG path set or a raster cut-out. */
export type Part = {
  id: string;
  /** e.g. "L_forearm", "head", "mouth.A" */
  name: string;
  view: ViewName;
  /** Layer ordering within the view; higher draws on top. */
  z: number;
  /** Closed contours in part-local coordinates. */
  contours: Point[][];
  /** Fill swatch name resolved against the character colour model. */
  fill: string;
  /** Optional second tone for cel shading, and the shadow contour. */
  shadeFill?: string;
  shadeContours?: Point[][];
  stroke?: { color: string; width: number };
  /** Raster variant for painterly styles. */
  asset?: AssetRef;
  /** Local pivot, in part-local coordinates. */
  pivot: Point;
  /** Which bone this part is bound to when not mesh-skinned. */
  bone?: string;
  /**
   * Ordered bone chain, root to tip, that this drawing spans.
   *
   * A single arm drawn as one tapered mass spans [upperarm, forearm, hand];
   * its vertices blend along the chain so the elbow bends inside one
   * continuous outline instead of showing a seam between two cut-out
   * pieces. Defaults to just `bone`, which makes the part rigid — correct
   * for a head, a hand or an eye.
   */
  boneChain?: string[];
  /** Swap-set membership, e.g. "mouth" or "eyes". */
  swapSet?: string;
  swapKey?: string;
  /** True when the part was completed under occlusion (inpainted). */
  occlusionCompleted?: boolean;
};

export type Bone = {
  id: string;
  parent: string | null;
  /** Rest position in rig space. */
  head: Point;
  tail: Point;
  /** Rest world rotation, derived from head→tail; stored for stability. */
  restRotation: number;
  length: number;
  /** Rotation limits in radians; null = unconstrained. */
  limits?: { min: number; max: number } | null;
  /** Hair, ears, tails: driven by the spring solver rather than keys. */
  spring?: SpringSettings;
  /** Bones tagged "deform" move geometry; "control" bones only drive others. */
  kind: 'deform' | 'control' | 'ik' | 'pole';
};

export type SpringSettings = {
  stiffness: number;
  damping: number;
  mass: number;
  /** Gravity influence, 0..1. */
  gravity: number;
  /** Max deviation from rest, radians. */
  maxAngle: number;
};

export type SkinWeight = { bone: string; weight: number };

/** A deformable mesh over a part; vertices are skinned to bones. */
export type PartMesh = {
  partId: string;
  vertices: Point[];
  /** Triangle indices, 3 per face. */
  triangles: number[];
  /** Per-vertex bone weights, normalised to sum 1. */
  weights: SkinWeight[][];
  /** Contour index → vertex index mapping, so outlines follow the mesh. */
  contourVertexIndex: number[][];
};

export type IKChain = {
  id: string;
  /** Bone ids from root to effector. */
  bones: string[];
  effector: string;
  target: string;
  poleTarget?: string;
  /** Blend between FK and IK, 0..1. */
  weight: number;
  iterations: number;
};

export type SwapSets = {
  mouth: Viseme[];
  eyes: string[];
  hands: string[];
  [key: string]: string[];
};

export type ZOrderRule = {
  view: ViewName;
  /** Part ids in back-to-front order for this view. */
  order: string[];
};

export type RigSubstrate = 'ts_native' | 'blender_gp' | 'godot' | 'spine_json';

export type Rig = {
  id: string;
  version: Version;
  characterId: string;
  substrate: RigSubstrate;
  /** The rig is authored per view; a five-angle rig has five part atlases. */
  views: ViewName[];
  /** Canonical (front) skeleton. Topology is shared by every view. */
  skeleton: Bone[];
  /**
   * Per-view rest skeletons. A turnaround compresses the body horizontally,
   * so the bones of a three-quarter view do not sit where the front view's
   * bones sit. Topology, ids and limits are identical; only rest positions
   * differ. Falls back to `skeleton` for any view not listed.
   */
  viewSkeletons?: Partial<Record<ViewName, Bone[]>>;
  parts: Part[];
  meshes: PartMesh[];
  ik: IKChain[];
  springBones: string[];
  swapSets: SwapSets;
  zOrderRules: ZOrderRule[];
  /** Rig-space bounds of the character in rest pose. */
  restBounds: { x: number; y: number; w: number; h: number };
  /** Height of the head in rig units — the proportion yardstick. */
  headUnitPx: number;
  validation?: ValidationRecord;
  locked: boolean;
  provenance?: Provenance;
};

export type Clip = {
  id: string;
  name: string;
  /** Semantic tags: "walk", "idle", "gesture.point", "emotion.happy.3" */
  tags: string[];
  durationFrames: number;
  loop: boolean;
  channels: Channel[];
  /** Which view the clip was authored for. */
  view: ViewName;
};

export type Character = {
  id: string;
  name: string;
  /** One line of who they are — injected into acting prompts. */
  description: string;
  modelSheet: ModelSheet;
  colorModel: NamedSwatch[];
  rig?: Rig;
  performanceLibrary: Clip[];
  voiceId?: string;
  /** Locked identity descriptor computed from the approved model sheet. */
  identityDescriptor?: number[];
  provenance?: Provenance;
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export type LayoutDrawing = {
  id: string;
  /** Vanishing points in normalised screen space. */
  vanishingPoints: Point[];
  horizonY: number;
  /** Blocking volumes: rough 3D primitives projected to 2D. */
  blocks: {
    id: string;
    name: string;
    contours: Point[][];
    depth: number;
  }[];
  asset?: AssetRef;
};

export type BGLayer = {
  id: string;
  name: string;
  /** 0 = infinitely far, 1 = at the camera plane. Drives parallax. */
  depth: number;
  asset?: AssetRef;
  /** Vector fallback so a layer always renders even without a painted plate. */
  contours?: Point[][];
  fill?: string;
  /** Per-layer atmospheric haze, 0..1. */
  haze?: number;
  /** Blur applied by the depth-of-field pass. */
  blur?: number;
  /** Parallax multiplier; derived from depth unless overridden. */
  parallax?: number;
};

export type Environment = {
  id: string;
  name: string;
  layout: LayoutDrawing;
  layers: BGLayer[];
  lightingKey: LightingRules;
  colorKey: NamedSwatch[];
  locked: boolean;
  provenance?: Provenance;
};

// ---------------------------------------------------------------------------
// Camera, staging, shots
// ---------------------------------------------------------------------------

export type ShotSize =
  | 'ecu'
  | 'cu'
  | 'mcu'
  | 'ms'
  | 'mls'
  | 'ls'
  | 'els'
  | 'ots'
  | 'twoShot';

export type ShotAngle = 'eye' | 'low' | 'high' | 'dutch' | 'birdseye' | 'wormseye';

export type CameraKey = {
  frame: number;
  /** Centre of the camera in world units. */
  position: Point;
  /** 1 = the framing the shot size implies. */
  zoom: number;
  rotation: number;
  ease: EaseName;
};

export type CameraCurve = {
  keys: CameraKey[];
  /** "static" | "pan" | "truck" | "push" | "pull" | "handheld" */
  move: 'static' | 'pan' | 'truck' | 'push' | 'pull' | 'handheld' | 'crane';
  /** Handheld noise amplitude in world units; seeded, so it is reproducible. */
  handheldAmount?: number;
};

export type Placement = {
  characterId: string;
  /** Which rig view is on screen. */
  view: ViewName;
  /** World position of the character root. */
  position: Point;
  scale: number;
  /** true = facing screen right. Screen-direction checks read this. */
  facingRight: boolean;
  /** Layer depth; the comp uses this for ordering against BG layers. */
  depth: number;
};

export type Staging = {
  characters: Placement[];
  /** Character id → the point they are looking at, in world units. */
  eyelines: Record<string, Point>;
  /** Overall screen direction of travel for the shot. */
  screenDirection: 'left' | 'right' | 'neutral';
  /** The side of the 180 line the camera sits on, for continuity checks. */
  cameraSide: 'A' | 'B';
  /** The axis between the two principal subjects, used for the 180 rule. */
  actionLine?: [Point, Point];
};

export type Beat = {
  id: string;
  /** What the audience must understand. Never a camera instruction. */
  intent: string;
  /** Physical action in one clause. */
  action: string;
  /** Emotion tag driving expression and acting choices. */
  emotion: ExpressionName;
  /** Intensity 1..5. */
  intensity: number;
  startFrame: number;
  durationFrames: number;
  characterId?: string;
};

export type Line = {
  id: string;
  characterId: string;
  text: string;
  /** Direction tags from the script, e.g. "(whispered)". */
  direction?: string;
  startFrame: number;
  durationFrames: number;
  audioAsset?: AssetRef;
  /** Phoneme timeline from forced alignment. */
  phonemes?: { phoneme: string; startFrame: number; endFrame: number }[];
  /** Viseme timeline driving the mouth swap set. */
  visemes?: { viseme: Viseme; startFrame: number; endFrame: number }[];
};

export type BoneTransform = {
  rotation?: number;
  translate?: Point;
  scale?: Point;
};

export type KeyPose = {
  id: string;
  frame: number;
  characterId: string;
  /** Either a library pose reference or explicit transforms. */
  poseId?: string;
  boneTransforms: Record<string, BoneTransform>;
  /** Swap-set selections at this key, e.g. { mouth: "D", eyes: "wide" }. */
  swaps?: Record<string, string>;
  /** Two points describing the dominant curve through the pose. */
  lineOfAction?: [Point, Point];
  silhouetteScore?: number;
  /** Why this pose exists. Drives the acting critic. */
  intent: string;
  /** Keys are "key" | "breakdown" | "extreme" | "inbetween". */
  kind: 'key' | 'breakdown' | 'extreme' | 'inbetween';
};

export type EaseName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInStrong'
  | 'easeOutStrong'
  | 'hold'
  | 'step'
  | 'overshoot'
  | 'anticipate'
  | 'bounce'
  | 'elastic';

export type Keyframe = {
  frame: number;
  value: number;
  ease: EaseName;
  /** Optional explicit bezier handles, overriding the named ease. */
  handles?: { outX: number; outY: number; inX: number; inY: number };
};

export type Channel = {
  /** Target path, e.g. "bone:L_forearm.rotation" or "root.translate.x". */
  target: string;
  keyframes: Keyframe[];
  /** Additive channels layer on top (idle breath, overlap offsets). */
  additive?: boolean;
};

export type TimingChart = {
  /** Step on ones or twos, per range. */
  stepping: { startFrame: number; endFrame: number; step: 1 | 2 }[];
  /** Holds, including moving holds, which never fully freeze. */
  holds: { startFrame: number; endFrame: number; moving: boolean }[];
  /** Frame numbers of the breakdown positions between keys. */
  breakdowns: number[];
};

export type SecondaryChannel = {
  /** Which part or bone this drives. */
  target: string;
  /** Frames of lag behind the primary action. Must land in 2..6. */
  lagFrames: number;
  amplitude: number;
  source: 'spring' | 'offset' | 'authored';
};

export type FxElement = {
  id: string;
  kind: 'dust' | 'water' | 'fire' | 'smoke' | 'impact' | 'sparkle' | 'custom';
  startFrame: number;
  durationFrames: number;
  position: Point;
  scale: number;
  /** Frame the effect must visually connect with the action. */
  hitFrame?: number;
  asset?: AssetRef;
};

export type CompLayer = {
  id: string;
  kind: 'bg' | 'character' | 'fx' | 'overlay' | 'grade';
  /** Sort order; resolved against Placement.depth and BGLayer.depth. */
  depth: number;
  sourceId: string;
  opacity: number;
  blend: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
  blur?: number;
};

export type LayerStack = {
  layers: CompLayer[];
  grade?: {
    lift: number;
    gamma: number;
    gain: number;
    saturation: number;
    /** Tint toward a colour script swatch. */
    tint?: string;
    tintAmount?: number;
  };
  grain?: { amount: number; size: number };
  vignette?: { amount: number; radius: number };
  glow?: { threshold: number; amount: number; radius: number };
};

export type ShotAudio = {
  vo: string[];
  sfx: { id: string; asset?: AssetRef; startFrame: number; gainDb: number }[];
  music?: { cueId: string; startFrame: number; gainDb: number };
};

export type OrganicPass = 'off' | 'try' | 'require';

export type Shot = {
  id: string;
  /** 1-based index within the scene, used for slugs like "SC02_SH003". */
  number: number;
  sceneId: string;
  durationFrames: number;
  camera: { size: ShotSize; angle: ShotAngle; move: CameraCurve };
  staging: Staging;
  beats: Beat[];
  dialogue: Line[];
  keys: KeyPose[];
  timing: TimingChart;
  curves: Channel[];
  secondary: SecondaryChannel[];
  fx: FxElement[];
  comp: LayerStack;
  audio: ShotAudio;
  organicPass: OrganicPass;
  /** Locked versions of every asset this shot depends on (design law 8). */
  lockedAssets: Record<string, Version>;
  validation?: ValidationRecord;
  repairs: RepairRecord[];
  /** Rendered frame sequence, once it exists. */
  frames?: AssetRef[];
  status: ShotStatus;
  /** Free-form note from the director, before it is parsed into edits. */
  notes: DirectorNote[];
};

export type ShotStatus =
  | 'planned'
  | 'boarded'
  | 'blocked'
  | 'animated'
  | 'rendered'
  | 'approved'
  | 'failed'
  | 'escalated';

export type Scene = {
  id: string;
  number: number;
  slug: string;
  environmentId: string;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night' | 'interior';
  shots: Shot[];
};

export type Sequence = {
  id: string;
  number: number;
  name: string;
  scenes: Scene[];
  /** Per-sequence colour script: the emotional temperature map. */
  colorScript: { sceneId: string; swatches: NamedSwatch[]; note: string }[];
};

// ---------------------------------------------------------------------------
// Validation, repair, gates
// ---------------------------------------------------------------------------

export type CriticVerdict = {
  critic: string;
  /** The rubric the critic was bound to. */
  rubric: string;
  verdict: 'pass' | 'fail' | 'uncertain';
  confidence: number;
  /** Must cite frames. A verdict with no citation is not admissible. */
  citations: { frame: number; note: string }[];
  rationale: string;
  model?: string;
};

export type HumanApproval = {
  gate: 'boards' | 'modelSheet' | 'animatic' | 'final';
  approved: boolean;
  by: string;
  at: string;
  notes?: string;
};

export type ValidationRecord = {
  checks: CheckResult[];
  criticVerdicts: CriticVerdict[];
  humanApproval?: HumanApproval;
  scoreSheet: ScoreSheet;
  /** Content hash of the inputs this validation was computed against. */
  validatedHash?: Hash;
};

export type RepairRecord = {
  attempt: number;
  failedCheck: string;
  diagnosis: string;
  move: string;
  /** Exactly what was touched. Never "the whole shot". */
  scope: Locator;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  outcome: 'fixed' | 'improved' | 'no_change' | 'worse' | 'escalated';
  scoreBefore: number;
  scoreAfter: number;
  at: string;
};

export type DirectorNote = {
  id: string;
  text: string;
  /** Optional draw-over: a polyline the director drew on the frame. */
  drawOver?: { frame: number; points: Point[]; label?: string }[];
  /** The structured edits the note was parsed into. */
  edits: StructuredEdit[];
  at: string;
  by: string;
  resolved: boolean;
};

export type StructuredEdit = {
  /** e.g. "timing.tighten_antic", "acting.add_idle_layer" */
  op: string;
  target: Locator;
  params: Record<string, number | string | boolean>;
  rationale: string;
};

// ---------------------------------------------------------------------------
// Delivery + project root
// ---------------------------------------------------------------------------

export type DeliverySpec = {
  width: number;
  height: number;
  fps: number;
  colorSpace: 'sRGB' | 'rec709' | 'p3';
  /** Loudness target: -16 LUFS web, -24 LKFS broadcast. */
  loudnessTargetLufs: number;
  masterCodec: 'prores422' | 'prores4444' | 'png_sequence';
  deliverableCodec: 'h264' | 'av1' | 'vp9';
  safeAreaPercent: number;
};

export type Project = {
  id: string;
  name: string;
  /** Working title only — never a studio name (design law 12). */
  logline: string;
  styleBible: StyleBible;
  characters: Character[];
  environments: Environment[];
  sequences: Sequence[];
  deliverySpec: DeliverySpec;
  /** The continuity ledger: locked truth, keyed by asset id. */
  continuity: ContinuityLedger;
  createdAt: string;
  updatedAt: string;
  /** Seed for every deterministic sub-system in this project. */
  seed: number;
  schemaVersion: 1;
};

export type ContinuityEntry = {
  assetId: string;
  kind: 'styleBible' | 'modelSheet' | 'rig' | 'environment' | 'colorScript' | 'voice';
  version: Version;
  hash: Hash;
  lockedAt: string;
  /** Shots that reference this version. Changing it re-validates all of them. */
  usedBy: string[];
};

export type ContinuityLedger = {
  entries: ContinuityEntry[];
  /** Props and costume state carried across shots, checked for jumps. */
  props: {
    propId: string;
    states: { shotId: string; state: string; heldBy?: string }[];
  }[];
};
