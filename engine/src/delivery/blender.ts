/**
 * Blender Grease Pencil substrate — the export half.
 *
 * §5 of the blueprint names a deterministic render substrate as the
 * baseline and a real 2D package as the production one. Both are driven
 * from the same Film Graph, and that is the whole point: the substrate is
 * a rendering decision, not a creative one. Nothing about the film may
 * change when it is swapped.
 *
 * This module turns the `Scene` (the last structured artifact before
 * pixels) into a flat, versioned JSON plan that `blender/render_shot.py`
 * rebuilds as Grease Pencil strokes. Two rules make the swap auditable:
 *
 *  1. **Coordinates are baked to screen space here, not in Blender.** The
 *     per-layer multiplane camera is applied exactly as the deterministic
 *     renderer applies it, so the two substrates place every stroke on the
 *     same pixel. Blender then contributes line quality, textured fills
 *     and real depth of field — not a different layout.
 *  2. **Every plan carries the scene hash it came from.** A plan that has
 *     drifted from the graph is detectable, and `substrate.agreement`
 *     compares the two renders frame for frame rather than trusting them.
 */

import type { Scene, DrawLayer, DrawShape } from '../render/scene.ts';
import { sortedLayers, sortedShapes } from '../render/scene.ts';
import type { Vec2 } from '../core/math.ts';
import { mapply } from '../core/math.ts';
import { toHex } from '../core/color.ts';
import { hashContent } from '../core/ids.ts';

export const BLENDER_PLAN_VERSION = 1;

export type PlanStroke = {
  id: string;
  /** Screen-space points, y down, origin top-left — the engine's raster space. */
  points: [number, number][];
  cyclic: boolean;
  fill?: string;
  fillAlpha?: number;
  stroke?: { color: string; width: number; alpha: number };
  /** Holes and shading contours reference the shape they belong to. */
  role: 'fill' | 'hole' | 'shade' | 'line';
  z: number;
  tag?: string;
  ownerId?: string;
};

export type PlanLayer = {
  id: string;
  kind: DrawLayer['kind'];
  z: number;
  opacity: number;
  blend: DrawLayer['blend'];
  blur: number;
  haze?: { color: string; amount: number };
  parallax: number;
  ownerId?: string;
  strokes: PlanStroke[];
};

export type PlanFrame = {
  frame: number;
  layers: PlanLayer[];
};

export type BlenderPlan = {
  version: number;
  shotId: string;
  project: string;
  fps: number;
  width: number;
  height: number;
  background: string;
  /** Line width multiplier applied on top of per-stroke widths. */
  lineScale: number;
  frames: PlanFrame[];
  /** Hash of the frames array — the substrate check quotes it. */
  planHash: string;
  notes: string[];
};

export type ExportOptions = {
  shotId: string;
  project?: string;
  fps?: number;
  lineScale?: number;
  notes?: string[];
};

/**
 * A shape can carry several contours. The first is the outline; the rest
 * are holes, which Grease Pencil expresses as separate strokes on a
 * holdout material rather than as an even-odd fill rule.
 */
function shapeStrokes(shape: DrawShape, project: (p: Vec2) => Vec2): PlanStroke[] {
  const out: PlanStroke[] = [];
  shape.contours.forEach((contour, i) => {
    if (contour.length < 2) return;
    out.push({
      id: `${shape.id}#${i}`,
      points: contour.map((p) => {
        const q = project(p);
        return [round(q.x), round(q.y)];
      }),
      cyclic: true,
      fill: shape.fill ? toHex(shape.fill) : undefined,
      fillAlpha: shape.fill ? (shape.fillAlpha ?? 1) : undefined,
      stroke: shape.stroke
        ? { color: toHex(shape.stroke.color), width: shape.stroke.width, alpha: shape.stroke.alpha ?? 1 }
        : undefined,
      role: i === 0 ? 'fill' : 'hole',
      z: shape.z,
      tag: shape.tag,
      ownerId: shape.ownerId,
    });
  });
  if (shape.shade) {
    shape.shade.contours.forEach((contour, i) => {
      if (contour.length < 2) return;
      out.push({
        id: `${shape.id}#shade${i}`,
        points: contour.map((p) => {
          const q = project(p);
          return [round(q.x), round(q.y)];
        }),
        cyclic: true,
        fill: toHex(shape.shade!.color),
        fillAlpha: shape.shade!.alpha ?? 1,
        role: 'shade',
        z: shape.z + 0.001,
        tag: shape.tag,
        ownerId: shape.ownerId,
      });
    });
  }
  return out;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function sceneToPlanFrame(scene: Scene): PlanFrame {
  const layers: PlanLayer[] = [];
  for (const layer of sortedLayers(scene)) {
    const camera = layer.camera ?? scene.camera;
    const project = (p: Vec2): Vec2 => mapply(camera, p);
    const strokes: PlanStroke[] = [];
    for (const shape of sortedShapes(layer)) strokes.push(...shapeStrokes(shape, project));
    layers.push({
      id: layer.id,
      kind: layer.kind,
      z: layer.z,
      opacity: layer.opacity,
      blend: layer.blend,
      blur: layer.blur ?? 0,
      haze: layer.haze,
      parallax: layer.parallax ?? 1,
      ownerId: layer.ownerId,
      strokes,
    });
    if (layer.images.length > 0) {
      // Raster inserts are not Grease Pencil strokes. Rather than silently
      // dropping them, the plan records that the substrate cannot carry
      // them and the substrate check refuses to certify agreement.
      layers[layers.length - 1].strokes.push(
        ...layer.images.map<PlanStroke>((im) => ({
          id: `${im.id}#raster`,
          points: [],
          cyclic: false,
          role: 'line',
          z: im.z,
          tag: `unsupported:raster:${im.uri}`,
          ownerId: im.ownerId,
        })),
      );
    }
  }
  return { frame: scene.frame, layers };
}

export function scenesToPlan(scenes: readonly Scene[], options: ExportOptions): BlenderPlan {
  if (scenes.length === 0) throw new Error('A Blender plan needs at least one scene.');
  const first = scenes[0];
  const frames = scenes.map(sceneToPlanFrame);
  const notes = [...(options.notes ?? [])];
  const unsupported = frames
    .flatMap((f) => f.layers.flatMap((l) => l.strokes))
    .filter((s) => s.tag?.startsWith('unsupported:'));
  if (unsupported.length > 0) {
    notes.push(
      `${unsupported.length} raster insert(s) cannot be expressed as Grease Pencil strokes and are recorded as unsupported, not dropped silently.`,
    );
  }
  return {
    version: BLENDER_PLAN_VERSION,
    shotId: options.shotId,
    project: options.project ?? 'untitled',
    fps: options.fps ?? 24,
    width: first.width,
    height: first.height,
    background: toHex(first.background),
    lineScale: options.lineScale ?? 1,
    frames,
    planHash: hashContent(frames),
    notes,
  };
}

/** Count of strokes the substrate cannot carry — zero is required for agreement. */
export function unsupportedCount(plan: BlenderPlan): number {
  let n = 0;
  for (const f of plan.frames)
    for (const l of f.layers) for (const s of l.strokes) if (s.tag?.startsWith('unsupported:')) n++;
  return n;
}

export function planStats(plan: BlenderPlan): {
  frames: number;
  layers: number;
  strokes: number;
  points: number;
  unsupported: number;
} {
  let layers = 0;
  let strokes = 0;
  let points = 0;
  for (const f of plan.frames) {
    layers += f.layers.length;
    for (const l of f.layers) {
      strokes += l.strokes.length;
      for (const s of l.strokes) points += s.points.length;
    }
  }
  return { frames: plan.frames.length, layers, strokes, points, unsupported: unsupportedCount(plan) };
}
