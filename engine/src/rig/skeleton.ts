/**
 * Skeleton evaluation.
 *
 * Every motion in this engine is a bone transform. Nothing draws itself; the
 * skeleton is posed, the skin follows, and the renderer is the last step.
 * That ordering is the whole reason limbs cannot melt.
 */

import type { Bone, BoneTransform, Point } from '../graph/types.ts';
import type { Mat2D, Vec2 } from '../core/math.ts';
import {
  IDENTITY,
  mmul,
  mRotate,
  mScale,
  mTranslate,
  mapply,
  vsub,
  vlen,
  clamp,
  wrapAngle,
} from '../core/math.ts';

export type Pose = Record<string, BoneTransform>;

export type PosedBone = {
  bone: Bone;
  /** Local transform applied on top of rest. */
  local: Mat2D;
  /** Bone-space → rig-space, including parents. */
  world: Mat2D;
  /** Posed head and tail in rig space. */
  head: Vec2;
  tail: Vec2;
  /** Accumulated world rotation, for arc and twinning metrics. */
  worldRotation: number;
  /** Accumulated uniform scale. */
  worldScale: number;
  depth: number;
};

export type PosedSkeleton = {
  bones: Map<string, PosedBone>;
  /** Root-first evaluation order. */
  order: string[];
  root: string;
};

export type SkeletonIndex = {
  byId: Map<string, Bone>;
  children: Map<string, string[]>;
  order: string[];
  roots: string[];
};

/** Topologically index a bone list. Throws on cycles — a rig must be a tree. */
export function indexSkeleton(bones: readonly Bone[]): SkeletonIndex {
  const byId = new Map<string, Bone>();
  for (const b of bones) {
    if (byId.has(b.id)) throw new Error(`duplicate bone id: ${b.id}`);
    byId.set(b.id, b);
  }
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const b of bones) {
    if (b.parent === null) {
      roots.push(b.id);
      continue;
    }
    if (!byId.has(b.parent)) {
      throw new Error(`bone ${b.id} references missing parent ${b.parent}`);
    }
    const list = children.get(b.parent);
    if (list) list.push(b.id);
    else children.set(b.parent, [b.id]);
  }
  // Deterministic child ordering.
  for (const list of children.values()) list.sort();
  roots.sort();

  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]): void => {
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) throw new Error(`bone cycle: ${[...stack, id].join(' -> ')}`);
    state.set(id, 1);
    for (const c of children.get(id) ?? []) visit(c, [...stack, id]);
    state.set(id, 2);
    order.unshift(id);
  };
  for (const r of roots) visit(r, []);
  if (order.length !== bones.length) {
    const missing = bones.filter((b) => !state.has(b.id)).map((b) => b.id);
    throw new Error(`bones unreachable from any root: ${missing.join(', ')}`);
  }
  return { byId, children, order, roots };
}

export function boneDepth(index: SkeletonIndex, id: string): number {
  let d = 0;
  let cur = index.byId.get(id);
  while (cur && cur.parent) {
    d++;
    cur = index.byId.get(cur.parent);
    if (d > 512) break;
  }
  return d;
}

const p2v = (p: Point): Vec2 => ({ x: p.x, y: p.y });

/**
 * Evaluate a pose into world transforms.
 *
 * Local transform semantics: rotation happens about the bone head, scale is
 * applied along the bone, translation is in the parent's space. Rotation
 * limits, when present, are enforced here — a rig cannot be posed out of its
 * declared range, which removes a whole class of broken frames at the source.
 */
export function evaluatePose(
  bones: readonly Bone[],
  pose: Pose,
  index?: SkeletonIndex,
): PosedSkeleton {
  const ix = index ?? indexSkeleton(bones);
  const out = new Map<string, PosedBone>();

  for (const id of ix.order) {
    const bone = ix.byId.get(id)!;
    const t = pose[id] ?? {};
    const head = p2v(bone.head);

    let rotation = t.rotation ?? 0;
    if (bone.limits) rotation = clamp(rotation, bone.limits.min, bone.limits.max);
    const sx = t.scale?.x ?? 1;
    const sy = t.scale?.y ?? 1;
    const tx = t.translate?.x ?? 0;
    const ty = t.translate?.y ?? 0;

    // Local = translate(head+offset) * rotate * scale * translate(-head)
    let local = mTranslate(head.x + tx, head.y + ty);
    local = mmul(local, mRotate(rotation));
    local = mmul(local, mScale(sx, sy));
    local = mmul(local, mTranslate(-head.x, -head.y));

    const parent = bone.parent ? out.get(bone.parent) : undefined;
    const world = parent ? mmul(parent.world, local) : local;

    const posedHead = mapply(world, head);
    const posedTail = mapply(world, p2v(bone.tail));
    const restLen = bone.length > 1e-9 ? bone.length : vlen(vsub(p2v(bone.tail), head)) || 1;

    out.set(id, {
      bone,
      local,
      world,
      head: posedHead,
      tail: posedTail,
      worldRotation: wrapAngle(
        (parent ? parent.worldRotation : 0) + rotation,
      ),
      worldScale: (parent ? parent.worldScale : 1) * Math.sqrt(Math.abs(sx * sy)),
      depth: parent ? parent.depth + 1 : 0,
    });
    void restLen;
  }

  return { bones: out, order: ix.order, root: ix.roots[0] ?? '' };
}

export const restPose = (): Pose => ({});

/** Blend two poses. Rotations blend on the shortest arc. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Pose = {};
  for (const k of keys) {
    const ta = a[k] ?? {};
    const tb = b[k] ?? {};
    const ra = ta.rotation ?? 0;
    const rb = tb.rotation ?? 0;
    out[k] = {
      rotation: ra + wrapAngle(rb - ra) * t,
      translate: {
        x: (ta.translate?.x ?? 0) + ((tb.translate?.x ?? 0) - (ta.translate?.x ?? 0)) * t,
        y: (ta.translate?.y ?? 0) + ((tb.translate?.y ?? 0) - (ta.translate?.y ?? 0)) * t,
      },
      scale: {
        x: (ta.scale?.x ?? 1) + ((tb.scale?.x ?? 1) - (ta.scale?.x ?? 1)) * t,
        y: (ta.scale?.y ?? 1) + ((tb.scale?.y ?? 1) - (ta.scale?.y ?? 1)) * t,
      },
    };
  }
  return out;
}

/** Add an additive layer (idle breath, overlap offsets) on top of a base pose. */
export function addPose(base: Pose, layer: Pose, weight = 1): Pose {
  const out: Pose = { ...base };
  for (const [k, t] of Object.entries(layer)) {
    const b = out[k] ?? {};
    out[k] = {
      rotation: (b.rotation ?? 0) + (t.rotation ?? 0) * weight,
      translate: {
        x: (b.translate?.x ?? 0) + (t.translate?.x ?? 0) * weight,
        y: (b.translate?.y ?? 0) + (t.translate?.y ?? 0) * weight,
      },
      scale: {
        x: (b.scale?.x ?? 1) * (1 + ((t.scale?.x ?? 1) - 1) * weight),
        y: (b.scale?.y ?? 1) * (1 + ((t.scale?.y ?? 1) - 1) * weight),
      },
    };
  }
  return out;
}

/** Mirror a pose left/right. Used to detect and to fix twinning. */
export function mirrorPose(pose: Pose, pairs: readonly [string, string][]): Pose {
  const out: Pose = {};
  const map = new Map<string, string>();
  for (const [l, r] of pairs) {
    map.set(l, r);
    map.set(r, l);
  }
  for (const [k, t] of Object.entries(pose)) {
    const target = map.get(k) ?? k;
    out[target] = {
      rotation: -(t.rotation ?? 0),
      translate: { x: -(t.translate?.x ?? 0), y: t.translate?.y ?? 0 },
      scale: { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 },
    };
  }
  return out;
}

/** All world-space bone tip positions, keyed by bone id. Arc metrics read this. */
export function effectorPositions(posed: PosedSkeleton): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const [id, pb] of posed.bones) out[id] = pb.tail;
  return out;
}

export const IDENTITY_MAT: Mat2D = IDENTITY;
