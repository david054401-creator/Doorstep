/**
 * The rig runtime: pose a Rig and get a drawable scene layer.
 *
 * This is the deterministic render substrate referenced by design law 6.
 * No model is consulted. Given the same rig and the same pose you get the
 * same geometry, every time, on every machine.
 */

import type { Rig, Part, PartMesh, ViewName, Point, Bone } from '../graph/types.ts';
import type { Pose, PosedSkeleton } from './skeleton.ts';
import { evaluatePose, indexSkeleton } from './skeleton.ts';
import type { SkeletonIndex } from './skeleton.ts';
import { deformContours, buildPartMesh } from './skin.ts';
import type { DrawLayer, DrawShape } from '../render/scene.ts';
import type { Vec2 } from '../core/math.ts';
import { mapply } from '../core/math.ts';
import type { NamedSwatch, RGB } from '../core/color.ts';
import { parseHex } from '../core/color.ts';
import { bounds } from '../geom/polygon.ts';
import type { Bounds } from '../geom/polygon.ts';

export type SwapSelection = Record<string, string>;

export type PoseOptions = {
  view: ViewName;
  /** Which swap-set entries are active this frame. */
  swaps?: SwapSelection;
  /** Resolved colour model for the character. */
  colorModel?: readonly NamedSwatch[];
  /** Placement transform applied after rig-space evaluation. */
  transform?: (p: Vec2) => Vec2;
  /** Layer z base, so multiple characters stack correctly. */
  zBase?: number;
  ownerId?: string;
  /** Reuse a prepared index across frames. */
  prepared?: PreparedRig;
};

export type PreparedRig = {
  rig: Rig;
  index: SkeletonIndex;
  /** Per-view rest skeleton + its index. Falls back to the canonical one. */
  skeletonByView: Map<ViewName, { bones: Bone[]; index: SkeletonIndex }>;
  meshByPart: Map<string, PartMesh>;
  partsByView: Map<ViewName, Part[]>;
  zOrderByView: Map<ViewName, Map<string, number>>;
};

/** Index a rig once; posing every frame then costs no lookups. */
export function prepareRig(rig: Rig): PreparedRig {
  const index = indexSkeleton(rig.skeleton);
  const skeletonByView = new Map<ViewName, { bones: Bone[]; index: SkeletonIndex }>();
  for (const view of rig.views) {
    const bones = rig.viewSkeletons?.[view] ?? rig.skeleton;
    skeletonByView.set(view, {
      bones,
      index: bones === rig.skeleton ? index : indexSkeleton(bones),
    });
  }
  const meshByPart = new Map<string, PartMesh>();
  for (const m of rig.meshes) meshByPart.set(m.partId, m);
  const partsByView = new Map<ViewName, Part[]>();
  for (const p of rig.parts) {
    const list = partsByView.get(p.view);
    if (list) list.push(p);
    else partsByView.set(p.view, [p]);
  }
  for (const list of partsByView.values()) {
    list.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  }
  const zOrderByView = new Map<ViewName, Map<string, number>>();
  for (const rule of rig.zOrderRules) {
    const m = new Map<string, number>();
    rule.order.forEach((id, i) => m.set(id, i));
    zOrderByView.set(rule.view, m);
  }
  return { rig, index, skeletonByView, meshByPart, partsByView, zOrderByView };
}

/** Ensure every part has a mesh; builds any that are missing. */
export function ensureMeshes(rig: Rig): Rig {
  const have = new Set(rig.meshes.map((m) => m.partId));
  const added: PartMesh[] = [];
  for (const part of rig.parts) {
    if (have.has(part.id)) continue;
    added.push(buildPartMesh(part, rig.viewSkeletons?.[part.view] ?? rig.skeleton));
  }
  return added.length ? { ...rig, meshes: [...rig.meshes, ...added] } : rig;
}

/** The rest skeleton a given view is authored against. */
export function skeletonForView(rig: Rig, view: ViewName): Bone[] {
  return rig.viewSkeletons?.[view] ?? rig.skeleton;
}

const p2v = (p: Point): Vec2 => ({ x: p.x, y: p.y });

function resolveColor(name: string | undefined, model: readonly NamedSwatch[] | undefined): RGB | undefined {
  if (!name) return undefined;
  if (name.startsWith('#')) return parseHex(name);
  const s = model?.find((sw) => sw.name === name);
  return s ? parseHex(s.hex) : undefined;
}

/** Is a part active given the current swap-set selection? */
export function partActive(part: Part, swaps: SwapSelection | undefined): boolean {
  if (!part.swapSet) return true;
  const selected = swaps?.[part.swapSet];
  // With no explicit selection, the first key in the set is the default;
  // the caller normally passes a full selection, so this is a safety net.
  if (selected === undefined) return part.swapKey === undefined || part.swapKey === 'X' || part.swapKey === 'neutral';
  return part.swapKey === selected;
}

export type PosedRig = {
  layer: DrawLayer;
  posed: PosedSkeleton;
  /** Rig-space bounds of everything drawn. */
  bounds: Bounds;
  /** Per-part deformed contours, for validators that need geometry not pixels. */
  partContours: Map<string, Vec2[][]>;
};

/**
 * Pose a rig into a draw layer.
 *
 * Parts with a mesh are skinned; parts bound rigidly to a single bone are
 * transformed by that bone's matrix. Parts bound to nothing are static
 * (props parented to the root).
 */
export function poseRig(rig: Rig, pose: Pose, options: PoseOptions): PosedRig {
  const prep = options.prepared ?? prepareRig(rig);
  const viewSkel = prep.skeletonByView.get(options.view);
  const bones = viewSkel?.bones ?? rig.skeleton;
  const posed = evaluatePose(bones, pose, viewSkel?.index ?? prep.index);
  const parts = prep.partsByView.get(options.view) ?? [];
  const zMap = prep.zOrderByView.get(options.view);
  const zBase = options.zBase ?? 0;
  const xf = options.transform;

  const shapes: DrawShape[] = [];
  const partContours = new Map<string, Vec2[][]>();
  let allPoints: Vec2[] = [];

  for (const part of parts) {
    if (!partActive(part, options.swaps)) continue;
    const mesh = prep.meshByPart.get(part.id);
    let contours: Vec2[][];
    if (mesh) {
      contours = deformContours(mesh, posed);
    } else if (part.bone) {
      const pb = posed.bones.get(part.bone);
      contours = pb
        ? part.contours.map((c) => c.map((p) => mapply(pb.world, p2v(p))))
        : part.contours.map((c) => c.map(p2v));
    } else {
      contours = part.contours.map((c) => c.map(p2v));
    }
    if (xf) contours = contours.map((c) => c.map(xf));
    partContours.set(part.id, contours);
    for (const c of contours) allPoints = allPoints.concat(c);

    // Shade contours ride the same deformation as the fill.
    let shade: DrawShape['shade'];
    if (part.shadeContours && part.shadeContours.length) {
      const shadeColor = resolveColor(part.shadeFill, options.colorModel);
      if (shadeColor) {
        let sc: Vec2[][];
        if (part.bone) {
          const pb = posed.bones.get(part.bone);
          sc = pb
            ? part.shadeContours.map((c) => c.map((p) => mapply(pb.world, p2v(p))))
            : part.shadeContours.map((c) => c.map(p2v));
        } else {
          sc = part.shadeContours.map((c) => c.map(p2v));
        }
        if (xf) sc = sc.map((c) => c.map(xf));
        shade = { contours: sc, color: shadeColor, alpha: 1 };
      }
    }

    const z = zBase + (zMap?.get(part.id) ?? part.z);
    shapes.push({
      id: `${options.ownerId ?? rig.characterId}:${part.id}`,
      contours,
      fill: resolveColor(part.fill, options.colorModel),
      fillAlpha: 1,
      stroke: part.stroke
        ? { color: parseHex(part.stroke.color), width: part.stroke.width }
        : undefined,
      shade,
      z,
      tag: part.name,
      ownerId: options.ownerId ?? rig.characterId,
    });
  }

  shapes.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  return {
    layer: {
      id: `char_${options.ownerId ?? rig.characterId}`,
      kind: 'character',
      z: zBase,
      shapes,
      images: [],
      opacity: 1,
      blend: 'normal',
      ownerId: options.ownerId ?? rig.characterId,
    },
    posed,
    bounds: bounds(allPoints),
    partContours,
  };
}

/** Convenience: the rest pose in a given view. Used by identity checks. */
export function poseRigRest(rig: Rig, view: ViewName, colorModel?: readonly NamedSwatch[]): PosedRig {
  return poseRig(rig, {}, { view, colorModel, swaps: defaultSwaps(rig) });
}

/** Preferred resting key per swap set, in order of preference. */
const SWAP_DEFAULTS: Record<string, string[]> = {
  mouth: ['X'],
  eyes: ['open', 'neutral'],
  hands: ['open', 'relaxed', 'neutral'],
};

export function defaultSwaps(rig: Rig): SwapSelection {
  const out: SwapSelection = {};
  for (const [set, keys] of Object.entries(rig.swapSets)) {
    if (!Array.isArray(keys) || keys.length === 0) continue;
    const preferred = (SWAP_DEFAULTS[set] ?? []).find((k) => keys.includes(k));
    // Alphabetical order is not a resting state: it would leave every
    // character standing there with its eyes closed.
    out[set] = preferred ?? keys[0];
  }
  return out;
}

/** Every swap key declared for a set, in declaration order. */
export function swapKeys(rig: Rig, set: string): string[] {
  const v = rig.swapSets[set];
  return Array.isArray(v) ? [...v] : [];
}

/** Parts of the rig that belong to a swap set, grouped by key. */
export function swapParts(rig: Rig, view: ViewName, set: string): Map<string, Part[]> {
  const out = new Map<string, Part[]>();
  for (const p of rig.parts) {
    if (p.view !== view || p.swapSet !== set || !p.swapKey) continue;
    const list = out.get(p.swapKey);
    if (list) list.push(p);
    else out.set(p.swapKey, [p]);
  }
  return out;
}
