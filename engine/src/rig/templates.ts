/**
 * Template skeletons per body type.
 *
 * Auto-rigging a drawing is a retarget problem, not a guess: we detect
 * keypoints, then fit the closest template. Templates carry the bone graph,
 * sane rotation limits, IK chains, spring settings and left/right pairs, all
 * expressed in head units so a 3-head preschool character and an 8-head
 * adult use the same code path.
 */

import type { Bone, IKChain, Point } from '../graph/types.ts';
import { rad } from '../core/math.ts';
import { DEFAULT_SPRING } from './spring.ts';

export type BodyType = 'biped' | 'preschool' | 'quadruped' | 'blob';

export type SkeletonTemplate = {
  bodyType: BodyType;
  /** Total height in head units. */
  headUnits: number;
  /** Bone definitions in head-unit space, origin at the feet, +y up. */
  bones: TemplateBone[];
  ik: TemplateIK[];
  /** Left/right bone pairs, for mirroring and twinning detection. */
  mirrorPairs: [string, string][];
  /** Which bones carry the silhouette of the pose (arcs are measured here). */
  endEffectors: string[];
  /** Bones expected to overlap/lag. */
  overlapBones: string[];
};

export type TemplateBone = {
  id: string;
  parent: string | null;
  /** In head units, feet at y = 0, +y up. Converted on instantiation. */
  head: Point;
  tail: Point;
  kind: Bone['kind'];
  limitsDeg?: [number, number];
  spring?: boolean;
};

export type TemplateIK = {
  id: string;
  bones: string[];
  effector: string;
  target: string;
  poleTarget?: string;
};

/**
 * Preschool proportions: ~3 head units, big head, short limbs, high hip.
 * This is the MIBO body type and the wedge market's house standard.
 *
 * The elbow and knee limits are tighter than an adult biped's on purpose.
 * A limb this thick physically cannot fold as far as a thin one — the
 * forearm runs into the upper arm long before 150 degrees — and a single
 * deforming cut-out mass cannot represent a crease past roughly 130
 * degrees without folding through itself. Encoding the real anatomy in the
 * rig means an animator simply cannot reach a pose that would render
 * broken; beyond these angles a production rig swaps to a purpose-drawn
 * bent-limb part instead of deforming further.
 */
export const PRESCHOOL_TEMPLATE: SkeletonTemplate = {
  bodyType: 'preschool',
  headUnits: 3,
  bones: [
    { id: 'root', parent: null, head: { x: 0, y: 0 }, tail: { x: 0, y: 0.1 }, kind: 'control' },
    { id: 'hips', parent: 'root', head: { x: 0, y: 1.05 }, tail: { x: 0, y: 1.35 }, kind: 'deform', limitsDeg: [-35, 35] },
    { id: 'spine', parent: 'hips', head: { x: 0, y: 1.35 }, tail: { x: 0, y: 1.8 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'chest', parent: 'spine', head: { x: 0, y: 1.8 }, tail: { x: 0, y: 2.0 }, kind: 'deform', limitsDeg: [-30, 30] },
    { id: 'neck', parent: 'chest', head: { x: 0, y: 2.0 }, tail: { x: 0, y: 2.1 }, kind: 'deform', limitsDeg: [-35, 35] },
    { id: 'head', parent: 'neck', head: { x: 0, y: 2.1 }, tail: { x: 0, y: 3.0 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'L_ear', parent: 'head', head: { x: -0.38, y: 2.72 }, tail: { x: -0.66, y: 3.08 }, kind: 'deform', spring: true },
    { id: 'R_ear', parent: 'head', head: { x: 0.38, y: 2.72 }, tail: { x: 0.66, y: 3.08 }, kind: 'deform', spring: true },
    { id: 'hair', parent: 'head', head: { x: 0, y: 2.9 }, tail: { x: 0.08, y: 3.15 }, kind: 'deform', spring: true },
    { id: 'L_upperarm', parent: 'chest', head: { x: -0.3, y: 1.92 }, tail: { x: -0.58, y: 1.55 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'L_forearm', parent: 'L_upperarm', head: { x: -0.58, y: 1.55 }, tail: { x: -0.8, y: 1.22 }, kind: 'deform', limitsDeg: [-5, 118] },
    { id: 'L_hand', parent: 'L_forearm', head: { x: -0.8, y: 1.22 }, tail: { x: -0.9, y: 1.1 }, kind: 'deform', limitsDeg: [-70, 70] },
    { id: 'R_upperarm', parent: 'chest', head: { x: 0.3, y: 1.92 }, tail: { x: 0.58, y: 1.55 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'R_forearm', parent: 'R_upperarm', head: { x: 0.58, y: 1.55 }, tail: { x: 0.8, y: 1.22 }, kind: 'deform', limitsDeg: [-118, 5] },
    { id: 'R_hand', parent: 'R_forearm', head: { x: 0.8, y: 1.22 }, tail: { x: 0.9, y: 1.1 }, kind: 'deform', limitsDeg: [-70, 70] },
    { id: 'L_thigh', parent: 'hips', head: { x: -0.17, y: 1.05 }, tail: { x: -0.2, y: 0.6 }, kind: 'deform', limitsDeg: [-110, 90] },
    { id: 'L_shin', parent: 'L_thigh', head: { x: -0.2, y: 0.6 }, tail: { x: -0.2, y: 0.14 }, kind: 'deform', limitsDeg: [-96, 2] },
    { id: 'L_foot', parent: 'L_shin', head: { x: -0.2, y: 0.14 }, tail: { x: -0.05, y: 0.02 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'R_thigh', parent: 'hips', head: { x: 0.17, y: 1.05 }, tail: { x: 0.2, y: 0.6 }, kind: 'deform', limitsDeg: [-110, 90] },
    { id: 'R_shin', parent: 'R_thigh', head: { x: 0.2, y: 0.6 }, tail: { x: 0.2, y: 0.14 }, kind: 'deform', limitsDeg: [-96, 2] },
    { id: 'R_foot', parent: 'R_shin', head: { x: 0.2, y: 0.14 }, tail: { x: 0.05, y: 0.02 }, kind: 'deform', limitsDeg: [-40, 40] },
  ],
  ik: [
    { id: 'ik_L_arm', bones: ['L_upperarm', 'L_forearm'], effector: 'L_forearm', target: 'ikt_L_hand' },
    { id: 'ik_R_arm', bones: ['R_upperarm', 'R_forearm'], effector: 'R_forearm', target: 'ikt_R_hand' },
    { id: 'ik_L_leg', bones: ['L_thigh', 'L_shin'], effector: 'L_shin', target: 'ikt_L_foot' },
    { id: 'ik_R_leg', bones: ['R_thigh', 'R_shin'], effector: 'R_shin', target: 'ikt_R_foot' },
  ],
  mirrorPairs: [
    ['L_upperarm', 'R_upperarm'],
    ['L_forearm', 'R_forearm'],
    ['L_hand', 'R_hand'],
    ['L_thigh', 'R_thigh'],
    ['L_shin', 'R_shin'],
    ['L_foot', 'R_foot'],
    ['L_ear', 'R_ear'],
  ],
  endEffectors: ['L_hand', 'R_hand', 'L_foot', 'R_foot', 'head'],
  overlapBones: ['L_ear', 'R_ear', 'hair', 'L_hand', 'R_hand'],
};

/** Standard adult-ish 6-head TV biped. */
export const BIPED_TEMPLATE: SkeletonTemplate = {
  bodyType: 'biped',
  headUnits: 6,
  bones: [
    { id: 'root', parent: null, head: { x: 0, y: 0 }, tail: { x: 0, y: 0.2 }, kind: 'control' },
    { id: 'hips', parent: 'root', head: { x: 0, y: 3.0 }, tail: { x: 0, y: 3.5 }, kind: 'deform', limitsDeg: [-35, 35] },
    { id: 'spine', parent: 'hips', head: { x: 0, y: 3.5 }, tail: { x: 0, y: 4.2 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'chest', parent: 'spine', head: { x: 0, y: 4.2 }, tail: { x: 0, y: 4.8 }, kind: 'deform', limitsDeg: [-30, 30] },
    { id: 'neck', parent: 'chest', head: { x: 0, y: 4.8 }, tail: { x: 0, y: 5.0 }, kind: 'deform', limitsDeg: [-35, 35] },
    { id: 'head', parent: 'neck', head: { x: 0, y: 5.0 }, tail: { x: 0, y: 6.0 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'hair', parent: 'head', head: { x: 0, y: 5.85 }, tail: { x: 0.1, y: 6.2 }, kind: 'deform', spring: true },
    { id: 'L_upperarm', parent: 'chest', head: { x: -0.45, y: 4.7 }, tail: { x: -0.95, y: 3.95 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'L_forearm', parent: 'L_upperarm', head: { x: -0.95, y: 3.95 }, tail: { x: -1.3, y: 3.3 }, kind: 'deform', limitsDeg: [-5, 118] },
    { id: 'L_hand', parent: 'L_forearm', head: { x: -1.3, y: 3.3 }, tail: { x: -1.45, y: 3.05 }, kind: 'deform', limitsDeg: [-70, 70] },
    { id: 'R_upperarm', parent: 'chest', head: { x: 0.45, y: 4.7 }, tail: { x: 0.95, y: 3.95 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'R_forearm', parent: 'R_upperarm', head: { x: 0.95, y: 3.95 }, tail: { x: 1.3, y: 3.3 }, kind: 'deform', limitsDeg: [-118, 5] },
    { id: 'R_hand', parent: 'R_forearm', head: { x: 1.3, y: 3.3 }, tail: { x: 1.45, y: 3.05 }, kind: 'deform', limitsDeg: [-70, 70] },
    { id: 'L_thigh', parent: 'hips', head: { x: -0.28, y: 3.0 }, tail: { x: -0.32, y: 1.6 }, kind: 'deform', limitsDeg: [-110, 90] },
    { id: 'L_shin', parent: 'L_thigh', head: { x: -0.32, y: 1.6 }, tail: { x: -0.32, y: 0.25 }, kind: 'deform', limitsDeg: [-130, 2] },
    { id: 'L_foot', parent: 'L_shin', head: { x: -0.32, y: 0.25 }, tail: { x: -0.05, y: 0.03 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'R_thigh', parent: 'hips', head: { x: 0.28, y: 3.0 }, tail: { x: 0.32, y: 1.6 }, kind: 'deform', limitsDeg: [-110, 90] },
    { id: 'R_shin', parent: 'R_thigh', head: { x: 0.32, y: 1.6 }, tail: { x: 0.32, y: 0.25 }, kind: 'deform', limitsDeg: [-130, 2] },
    { id: 'R_foot', parent: 'R_shin', head: { x: 0.32, y: 0.25 }, tail: { x: 0.05, y: 0.03 }, kind: 'deform', limitsDeg: [-40, 40] },
  ],
  ik: [
    { id: 'ik_L_arm', bones: ['L_upperarm', 'L_forearm'], effector: 'L_forearm', target: 'ikt_L_hand' },
    { id: 'ik_R_arm', bones: ['R_upperarm', 'R_forearm'], effector: 'R_forearm', target: 'ikt_R_hand' },
    { id: 'ik_L_leg', bones: ['L_thigh', 'L_shin'], effector: 'L_shin', target: 'ikt_L_foot' },
    { id: 'ik_R_leg', bones: ['R_thigh', 'R_shin'], effector: 'R_shin', target: 'ikt_R_foot' },
  ],
  mirrorPairs: [
    ['L_upperarm', 'R_upperarm'],
    ['L_forearm', 'R_forearm'],
    ['L_hand', 'R_hand'],
    ['L_thigh', 'R_thigh'],
    ['L_shin', 'R_shin'],
    ['L_foot', 'R_foot'],
  ],
  endEffectors: ['L_hand', 'R_hand', 'L_foot', 'R_foot', 'head'],
  overlapBones: ['hair', 'L_hand', 'R_hand'],
};

export const QUADRUPED_TEMPLATE: SkeletonTemplate = {
  bodyType: 'quadruped',
  headUnits: 2.5,
  bones: [
    { id: 'root', parent: null, head: { x: 0, y: 0 }, tail: { x: 0.2, y: 0 }, kind: 'control' },
    { id: 'hips', parent: 'root', head: { x: -0.9, y: 1.3 }, tail: { x: -0.3, y: 1.35 }, kind: 'deform', limitsDeg: [-25, 25] },
    { id: 'spine', parent: 'hips', head: { x: -0.3, y: 1.35 }, tail: { x: 0.5, y: 1.4 }, kind: 'deform', limitsDeg: [-30, 30] },
    { id: 'chest', parent: 'spine', head: { x: 0.5, y: 1.4 }, tail: { x: 0.95, y: 1.42 }, kind: 'deform', limitsDeg: [-25, 25] },
    { id: 'neck', parent: 'chest', head: { x: 0.95, y: 1.42 }, tail: { x: 1.25, y: 1.7 }, kind: 'deform', limitsDeg: [-45, 45] },
    { id: 'head', parent: 'neck', head: { x: 1.25, y: 1.7 }, tail: { x: 1.8, y: 1.9 }, kind: 'deform', limitsDeg: [-40, 40] },
    { id: 'L_ear', parent: 'head', head: { x: 1.4, y: 1.9 }, tail: { x: 1.35, y: 2.2 }, kind: 'deform', spring: true },
    { id: 'R_ear', parent: 'head', head: { x: 1.5, y: 1.88 }, tail: { x: 1.5, y: 2.18 }, kind: 'deform', spring: true },
    { id: 'tail_1', parent: 'hips', head: { x: -0.9, y: 1.3 }, tail: { x: -1.3, y: 1.45 }, kind: 'deform', spring: true },
    { id: 'tail_2', parent: 'tail_1', head: { x: -1.3, y: 1.45 }, tail: { x: -1.65, y: 1.65 }, kind: 'deform', spring: true },
    { id: 'FL_upper', parent: 'chest', head: { x: 0.8, y: 1.3 }, tail: { x: 0.78, y: 0.7 }, kind: 'deform', limitsDeg: [-90, 90] },
    { id: 'FL_lower', parent: 'FL_upper', head: { x: 0.78, y: 0.7 }, tail: { x: 0.82, y: 0.1 }, kind: 'deform', limitsDeg: [-100, 10] },
    { id: 'FR_upper', parent: 'chest', head: { x: 0.9, y: 1.28 }, tail: { x: 0.9, y: 0.7 }, kind: 'deform', limitsDeg: [-90, 90] },
    { id: 'FR_lower', parent: 'FR_upper', head: { x: 0.9, y: 0.7 }, tail: { x: 0.94, y: 0.1 }, kind: 'deform', limitsDeg: [-100, 10] },
    { id: 'BL_upper', parent: 'hips', head: { x: -0.8, y: 1.25 }, tail: { x: -0.9, y: 0.68 }, kind: 'deform', limitsDeg: [-90, 90] },
    { id: 'BL_lower', parent: 'BL_upper', head: { x: -0.9, y: 0.68 }, tail: { x: -0.78, y: 0.1 }, kind: 'deform', limitsDeg: [-10, 100] },
    { id: 'BR_upper', parent: 'hips', head: { x: -0.7, y: 1.23 }, tail: { x: -0.8, y: 0.68 }, kind: 'deform', limitsDeg: [-90, 90] },
    { id: 'BR_lower', parent: 'BR_upper', head: { x: -0.8, y: 0.68 }, tail: { x: -0.68, y: 0.1 }, kind: 'deform', limitsDeg: [-10, 100] },
  ],
  ik: [
    { id: 'ik_FL', bones: ['FL_upper', 'FL_lower'], effector: 'FL_lower', target: 'ikt_FL' },
    { id: 'ik_FR', bones: ['FR_upper', 'FR_lower'], effector: 'FR_lower', target: 'ikt_FR' },
    { id: 'ik_BL', bones: ['BL_upper', 'BL_lower'], effector: 'BL_lower', target: 'ikt_BL' },
    { id: 'ik_BR', bones: ['BR_upper', 'BR_lower'], effector: 'BR_lower', target: 'ikt_BR' },
  ],
  mirrorPairs: [
    ['FL_upper', 'FR_upper'],
    ['FL_lower', 'FR_lower'],
    ['BL_upper', 'BR_upper'],
    ['BL_lower', 'BR_lower'],
    ['L_ear', 'R_ear'],
  ],
  endEffectors: ['FL_lower', 'FR_lower', 'BL_lower', 'BR_lower', 'head'],
  overlapBones: ['tail_1', 'tail_2', 'L_ear', 'R_ear'],
};

export const BLOB_TEMPLATE: SkeletonTemplate = {
  bodyType: 'blob',
  headUnits: 1.6,
  bones: [
    { id: 'root', parent: null, head: { x: 0, y: 0 }, tail: { x: 0, y: 0.2 }, kind: 'control' },
    { id: 'body', parent: 'root', head: { x: 0, y: 0.1 }, tail: { x: 0, y: 1.1 }, kind: 'deform', limitsDeg: [-45, 45] },
    { id: 'head', parent: 'body', head: { x: 0, y: 1.1 }, tail: { x: 0, y: 1.6 }, kind: 'deform', limitsDeg: [-50, 50] },
    { id: 'L_arm', parent: 'body', head: { x: -0.4, y: 0.75 }, tail: { x: -0.75, y: 0.5 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'R_arm', parent: 'body', head: { x: 0.4, y: 0.75 }, tail: { x: 0.75, y: 0.5 }, kind: 'deform', limitsDeg: [-170, 170] },
    { id: 'antenna', parent: 'head', head: { x: 0, y: 1.55 }, tail: { x: 0.05, y: 1.9 }, kind: 'deform', spring: true },
  ],
  ik: [],
  mirrorPairs: [['L_arm', 'R_arm']],
  endEffectors: ['L_arm', 'R_arm', 'head'],
  overlapBones: ['antenna'],
};

export const TEMPLATES: Record<BodyType, SkeletonTemplate> = {
  biped: BIPED_TEMPLATE,
  preschool: PRESCHOOL_TEMPLATE,
  quadruped: QUADRUPED_TEMPLATE,
  blob: BLOB_TEMPLATE,
};

/**
 * Instantiate a template into real bones at a given pixel scale.
 * The y axis flips: templates are authored +y up, the render space is +y down.
 */
export function instantiateTemplate(
  template: SkeletonTemplate,
  options: { headHeightPx: number; originX?: number; groundY?: number },
): { bones: Bone[]; ik: IKChain[] } {
  const s = options.headHeightPx;
  const ox = options.originX ?? 0;
  const gy = options.groundY ?? 0;
  const conv = (p: Point): Point => ({ x: ox + p.x * s, y: gy - p.y * s });

  const bones: Bone[] = template.bones.map((tb) => {
    const head = conv(tb.head);
    const tail = conv(tb.tail);
    const dx = tail.x - head.x;
    const dy = tail.y - head.y;
    return {
      id: tb.id,
      parent: tb.parent,
      head,
      tail,
      restRotation: Math.atan2(dy, dx),
      length: Math.hypot(dx, dy),
      limits: tb.limitsDeg ? { min: rad(tb.limitsDeg[0]), max: rad(tb.limitsDeg[1]) } : null,
      spring: tb.spring ? { ...DEFAULT_SPRING } : undefined,
      kind: tb.kind,
    };
  });

  const ik: IKChain[] = template.ik.map((c) => ({
    id: c.id,
    bones: [...c.bones],
    effector: c.effector,
    target: c.target,
    poleTarget: c.poleTarget,
    weight: 1,
    iterations: 12,
  }));

  return { bones, ik };
}

/** Pick the template whose head-unit count is closest to the measurement. */
export function selectTemplate(headUnits: number, hint?: BodyType): SkeletonTemplate {
  if (hint) return TEMPLATES[hint];
  let best: SkeletonTemplate = BIPED_TEMPLATE;
  let bestD = Infinity;
  for (const t of Object.values(TEMPLATES)) {
    const d = Math.abs(t.headUnits - headUnits);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
