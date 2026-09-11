/**
 * Auto-rigging: drawing (or construction spec) in, validated rig out.
 *
 * Phase 1 of the build order is "image -> validated rig". This is the
 * assembly half of it: template fitting, part binding, mesh generation,
 * weight solving, z-order resolution and swap-set wiring. The validator
 * battery in `validators.ts` is what makes the output trustworthy.
 */

import type {
  Rig,
  Part,
  Bone,
  IKChain,
  ViewName,
  ZOrderRule,
  SwapSets,
  Point,
  Viseme,
} from '../graph/types.ts';
import { VISEMES } from '../graph/types.ts';
import type { SkeletonTemplate } from './templates.ts';
import { instantiateTemplate, selectTemplate } from './templates.ts';
import { buildPartMesh, normalizeWeights, hingeBoneSet } from './skin.ts';
import type { SkinOptions } from './skin.ts';
import { indexSkeleton } from './skeleton.ts';
import { makeId } from '../core/ids.ts';
import { bounds } from '../geom/polygon.ts';
import type { CharacterDesign, BuiltCharacter } from '../character/construct.ts';
import { buildCharacter, restMap, projectBones } from '../character/construct.ts';

export type AutoRigOptions = {
  substrate?: Rig['substrate'];
  /** Per-view rest skeletons; parts are skinned against their own view. */
  viewSkeletons?: Partial<Record<ViewName, Bone[]>>;
  skin?: SkinOptions;
  /** Parts matching these name prefixes stay rigid (no mesh deform). */
  rigidParts?: string[];
  /** Bones eligible to deform geometry. Defaults to all `deform` bones. */
  deformBones?: string[];
};

const DEFAULT_RIGID = ['eye', 'pupil', 'brow', 'mouth', 'nose', 'prop'];

/**
 * Build a complete rig from a character design.
 * The skeleton comes from the template, the parts from construction, the
 * meshes and weights are solved, and the z-order is derived per view.
 */
export function autoRig(design: CharacterDesign, options: AutoRigOptions = {}): { rig: Rig; built: BuiltCharacter } {
  const { bones, ik } = instantiateTemplate(design.template, {
    headHeightPx: design.headHeightPx,
    originX: 0,
    groundY: 0,
  });
  const rest = restMap(bones);
  const built = buildCharacter(design, rest);
  const centerX = rest.root?.head.x ?? 0;
  const viewSkeletons: Partial<Record<ViewName, Bone[]>> = {};
  for (const view of design.views) {
    viewSkeletons[view] = view === 'front' ? bones : projectBones(bones, view, centerX);
  }
  const rig = assembleRig(design.id, bones, ik, built.parts, design.views, {
    ...options,
    viewSkeletons,
  });
  return { rig, built };
}

/** Assemble a rig from an existing skeleton and part atlas. */
export function assembleRig(
  characterId: string,
  bones: Bone[],
  ik: IKChain[],
  parts: Part[],
  views: readonly ViewName[],
  options: AutoRigOptions = {},
): Rig {
  // Fail fast on a malformed skeleton — everything downstream assumes a tree.
  indexSkeleton(bones);

  const rigid = new Set(options.rigidParts ?? DEFAULT_RIGID);
  const isRigid = (p: Part): boolean => {
    for (const prefix of rigid) {
      if (p.name.startsWith(prefix)) return true;
    }
    return false;
  };

  // Each part is skinned against the skeleton of its own view, so distances
  // (and therefore weights) are measured in the space the part is drawn in.
  const skeletonFor = (view: ViewName): Bone[] => options.viewSkeletons?.[view] ?? bones;
  // Hinge topology is decided once, on the canonical skeleton.
  const hinges = hingeBoneSet(bones);
  const meshes = parts
    .filter((p) => !isRigid(p))
    .map((p) =>
      normalizeWeights(
        buildPartMesh(p, skeletonFor(p.view), {
          ...options.skin,
          deformBones: options.deformBones,
          hingeBones: hinges,
        }),
      ),
    );

  const zOrderRules: ZOrderRule[] = views.map((view) => resolveZOrder(view, parts));

  const swapSets: SwapSets = {
    mouth: [...VISEMES] as Viseme[],
    eyes: collectSwapKeys(parts, 'eyes'),
    hands: collectSwapKeys(parts, 'hands'),
  };

  const allPoints: Point[] = parts.flatMap((p) => p.contours.flat());
  const headBone = bones.find((b) => b.id === 'head');
  const headUnitPx = headBone ? Math.abs(headBone.tail.y - headBone.head.y) : 1;

  return {
    id: makeId('rig', `${characterId}:rig`),
    version: 1,
    characterId,
    substrate: options.substrate ?? 'ts_native',
    views: [...views],
    skeleton: bones,
    viewSkeletons: options.viewSkeletons,
    parts,
    meshes,
    ik,
    springBones: bones.filter((b) => b.spring).map((b) => b.id),
    swapSets,
    zOrderRules,
    restBounds: bounds(allPoints),
    headUnitPx,
    locked: false,
  };
}

function collectSwapKeys(parts: readonly Part[], set: string): string[] {
  const keys = new Set<string>();
  for (const p of parts) {
    if (p.swapSet === set && p.swapKey) keys.add(p.swapKey);
  }
  return [...keys].sort();
}

/**
 * Per-view z-order.
 *
 * The standard cut-out rule: in a three-quarter or side view the limbs on
 * the far side of the body go behind the torso, the near side in front. In
 * back view the whole ordering flips. Getting this wrong is the classic
 * "arm popped through the chest" artefact, so it is resolved once, here, and
 * checked every frame by the z-order validator.
 */
export function resolveZOrder(view: ViewName, parts: readonly Part[]): ZOrderRule {
  const viewParts = parts.filter((p) => p.view === view);
  const farSide: 'L' | 'R' | null =
    view === 'threeQuarterL' || view === 'sideL' ? 'R' : view === 'threeQuarterR' || view === 'sideR' ? 'L' : null;

  const rank = (p: Part): number => {
    const base = p.z;
    if (view === 'back') {
      // Everything mirrors: the face is gone, hair and back of limbs lead.
      if (p.name.startsWith('hair')) return base + 100;
      if (p.name.includes('_L') || p.name.startsWith('L_')) return base + 4;
      if (p.name.includes('_R') || p.name.startsWith('R_')) return base - 4;
      return base;
    }
    if (farSide) {
      const isFar = p.name.startsWith(`${farSide}_`) || p.name.endsWith(`_${farSide}`);
      const isNear = !isFar && (p.name.startsWith('L_') || p.name.startsWith('R_') || /_(L|R)$/.test(p.name));
      if (isFar) return base - 50;
      if (isNear) return base + 50;
    }
    return base;
  };

  const ordered = [...viewParts].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { view, order: ordered.map((p) => p.id) };
}

/**
 * Keypoint-driven template fit.
 *
 * Given detected 2D keypoints from a drawing (DWPose / RTMPose / the
 * AnimatedDrawings detector all emit this shape), pick a template and scale
 * it so the joints land on the detections. This is the entry point for the
 * "rig an arbitrary drawing" path.
 */
export type Keypoints = Record<string, Point>;

export function fitTemplateToKeypoints(
  keypoints: Keypoints,
  hint?: SkeletonTemplate['bodyType'],
): { template: SkeletonTemplate; headHeightPx: number; originX: number; groundY: number } {
  const head = keypoints.head ?? keypoints.nose ?? keypoints.head_top;
  const hips = keypoints.hips ?? keypoints.pelvis;
  const foot =
    keypoints.L_foot ?? keypoints.R_foot ?? keypoints.left_ankle ?? keypoints.right_ankle;

  const groundY = foot?.y ?? (hips ? hips.y + 100 : 0);
  const topY = head?.y ?? groundY - 100;
  const totalHeight = Math.max(1, groundY - topY);

  // Head height from the head-to-neck distance when available, else assume
  // the detected proportions and solve for the template that fits best.
  const neck = keypoints.neck ?? keypoints.chest;
  const headHeightPx = head && neck ? Math.max(1, Math.abs(neck.y - head.y) * 1.35) : totalHeight / 6;
  const headUnits = totalHeight / headHeightPx;
  const template = selectTemplate(headUnits, hint);
  // Rescale so the instantiated template spans exactly the detected height.
  const fitted = totalHeight / template.headUnits;
  return {
    template,
    headHeightPx: fitted,
    originX: hips?.x ?? head?.x ?? 0,
    groundY,
  };
}

/** Bind existing parts to the nearest bone, for atlases that arrive unbound. */
export function autoBindParts(parts: readonly Part[], bones: readonly Bone[]): Part[] {
  const deform = bones.filter((b) => b.kind === 'deform');
  const pool = deform.length ? deform : bones;
  return parts.map((p) => {
    if (p.bone) return p;
    const pts = p.contours.flat();
    if (pts.length === 0) return p;
    let cx = 0;
    let cy = 0;
    for (const q of pts) {
      cx += q.x;
      cy += q.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let best = pool[0];
    let bestD = Infinity;
    for (const b of pool) {
      const mx = (b.head.x + b.tail.x) / 2;
      const my = (b.head.y + b.tail.y) / 2;
      const d = Math.hypot(cx - mx, cy - my);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return { ...p, bone: best.id };
  });
}
