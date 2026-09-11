/**
 * Skinning: bind parts to bones, build deformable meshes, and compute
 * bounded-blend weights.
 *
 * Weight normalisation is a hard invariant (sum = 1 +/- 1e-3) because an
 * unnormalised vertex is exactly how a limb detaches.
 */

import type { Bone, Part, PartMesh, Point, SkinWeight } from '../graph/types.ts';
import type { Vec2, Mat2D } from '../core/math.ts';
import { mapply, vdist, vsub, vnorm, vlen, EPS, clamp } from '../core/math.ts';
import {
  bounds,
  triangulate,
  resampleClosed,
  pointSegmentDistance,
  triangleQuality,
} from '../geom/polygon.ts';
import type { PosedSkeleton } from './skeleton.ts';
import { indexSkeleton } from './skeleton.ts';
import type { SkeletonIndex } from './skeleton.ts';

const p2v = (p: Point): Vec2 => ({ x: p.x, y: p.y });

export type SkinOptions = {
  /** Vertices per contour after resampling. More = smoother bend, slower. */
  contourSamples?: number;
  /** Interior grid resolution for the deform mesh. */
  interiorGrid?: number;
  /** Falloff exponent for distance-based weighting. Higher = tighter bind. */
  falloff?: number;
  /** Maximum bones influencing one vertex. 4 is the industry norm. */
  maxInfluences?: number;
  /** Bones eligible to deform, in addition to the part's own bone. */
  deformBones?: string[];
  /**
   * Multiplier on the automatically sized crossover band at each joint.
   * 1 leaves the computed width alone; the repair loop raises it to soften
   * a gradient that is tearing the mesh. It scales the computed band rather
   * than replacing it, because the right absolute width depends on how wide
   * the drawing is, which the caller does not know.
   */
  jointBand?: number;
  /**
   * Bone ids that truly hinge on their parent (head coincident with the
   * parent's tail). Decided once from the canonical skeleton, because a
   * projected turnaround view compresses distances and would otherwise
   * answer the question differently for every view.
   */
  hingeBones?: ReadonlySet<string>;
};

/** Distance from a point to a bone segment, in rig space. */
export function distanceToBone(p: Vec2, bone: Bone): number {
  return pointSegmentDistance(p, p2v(bone.head), p2v(bone.tail));
}

/**
 * Which bones are true hinges on their parent.
 *
 * A hinge shares a joint: the bone's head sits on its parent's tail, so the
 * two masses must bend into each other (elbow, knee, ankle, every link of
 * the spine). A non-hinge is a floating attachment — a shoulder or a hip in
 * a cut-out rig — where the child is a separate drawn mass that rotates as
 * one piece and overlaps the parent rather than deforming into it.
 *
 * This is a property of the canonical skeleton, computed once. A projected
 * turnaround view squeezes the character horizontally, and asking the same
 * distance question in that space would answer it differently per view —
 * which is how a rig ends up with a shoulder that blends in side view and
 * not in front.
 */
export function hingeBoneSet(
  bones: readonly Bone[],
  index?: SkeletonIndex,
): Set<string> {
  const ix = index ?? indexSkeleton(bones);
  const out = new Set<string>();
  for (const b of bones) {
    if (!b.parent) continue;
    const parent = ix.byId.get(b.parent);
    if (!parent) continue;
    const tolerance = Math.max(Math.min(b.length, parent.length) * 0.2, 1e-3);
    if (Math.hypot(b.head.x - parent.tail.x, b.head.y - parent.tail.y) <= tolerance) {
      out.add(b.id);
    }
  }
  return out;
}

/**
 * Bounded influence set for a part.
 *
 * "Bounded" is the operative word in bounded biharmonic weights: a vertex is
 * influenced only by bones in its immediate neighbourhood, never by every
 * bone in the rig. Without this bound a knee bone gets a non-zero say in
 * where an eyebrow goes, and the mesh tears the moment the character moves.
 *
 * The neighbourhood is the part's own bone, its parent and grandparent, and
 * its non-spring children. Spring bones drive their own parts and must not
 * deform the mass they hang off, or hair would drag the skull with it.
 */
export function influenceBones(
  part: Part,
  bones: readonly Bone[],
  index?: SkeletonIndex,
): Bone[] {
  const ix = index ?? indexSkeleton(bones);
  const own = part.bone ? ix.byId.get(part.bone) : undefined;
  if (!own) return bones.filter((b) => b.kind === 'deform');

  const set = new Map<string, Bone>();
  const add = (b: Bone | undefined): void => {
    if (b && b.kind === 'deform') set.set(b.id, b);
  };
  add(own);
  const parent = own.parent ? ix.byId.get(own.parent) : undefined;
  add(parent);
  for (const childId of ix.children.get(own.id) ?? []) {
    const child = ix.byId.get(childId);
    if (child && !child.spring) add(child);
  }
  // A part on a spring bone still needs its anchor so it does not detach.
  if (own.spring) add(parent);
  if (set.size === 0) add(own);

  // Distance cutoff: a bone whose segment never comes near the part cannot
  // influence it, even if the hierarchy says they are neighbours.
  const pts = part.contours.flat();
  if (pts.length > 0 && set.size > 1) {
    const bb = bounds(pts.map(p2v));
    const radius = Math.hypot(bb.w, bb.h) * 0.85 + 1;
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    for (const [id, b] of [...set]) {
      if (id === own.id) continue;
      if (distanceToBone({ x: cx, y: cy }, b) > radius) set.delete(id);
    }
  }
  return [...set.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Fallback weighting for geometry with no clean bone axis: inverse distance
 * with bounded support and a partition of unity.
 */
export function computeWeights(
  vertex: Vec2,
  bones: readonly Bone[],
  options: SkinOptions = {},
): SkinWeight[] {
  const falloff = options.falloff ?? 3;
  const maxInf = options.maxInfluences ?? 4;
  const deform = bones.filter((b) => b.kind === 'deform');
  const pool = deform.length > 0 ? deform : bones;
  if (pool.length === 0) return [];

  const scored = pool.map((b) => {
    const d = Math.max(distanceToBone(vertex, b), 1e-4);
    return { bone: b.id, raw: 1 / d ** falloff };
  });
  scored.sort((a, b) => b.raw - a.raw || a.bone.localeCompare(b.bone));
  const top = scored.slice(0, maxInf);
  const sum = top.reduce((a, s) => a + s.raw, 0);
  if (sum < EPS) return [{ bone: top[0].bone, weight: 1 }];
  const out: SkinWeight[] = top.map((s) => ({ bone: s.bone, weight: s.raw / sum }));
  const total = out.reduce((a, w) => a + w.weight, 0);
  out[0].weight += 1 - total;
  return out;
}

/** Smooth Hermite ramp, so weight gradients are continuous across a joint. */
const smoothstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Greatest perpendicular distance from the bone axis to the part outline. */
export function partHalfWidth(part: Part, bone: Bone): number {
  const head = p2v(bone.head);
  const dx = bone.tail.x - head.x;
  const dy = bone.tail.y - head.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return 1;
  const nx = -dy / len;
  const ny = dx / len;
  let worst = 0;
  for (const contour of part.contours) {
    for (const p of contour) {
      const d = Math.abs((p.x - head.x) * nx + (p.y - head.y) * ny);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/**
 * Chain-banded weights — the correct model for a cut-out rig.
 *
 * A drawing belongs to the bones it actually spans. A hand, a head or an
 * eye spans one bone and is rigid: it rotates as one piece and overlaps its
 * neighbours, which is exactly what a cut-out rig is for. A whole arm drawn
 * as one tapered mass spans upperarm, forearm and hand, and must bend at
 * the elbow and wrist inside a single continuous outline.
 *
 * Vertices are projected onto the chain's polyline to get an arc-length
 * position, and each bone owns its own stretch of that arc. At every
 * interior joint the ownership crosses over through a smooth band, 50/50
 * exactly on the joint. Because each crossover is expressed as a single
 * monotone ramp and the weights telescope, the result is a partition of
 * unity by construction — no renormalisation, no discontinuity, and no
 * bone influencing a vertex nowhere near it.
 *
 * Weighting a drawing by raw distance to every nearby bone, by contrast,
 * gives a thigh a real say over the whole shin. A deep crouch then blends
 * two bones 115 degrees apart across an entire limb, and the limb
 * liquefies. That is the failure this model exists to make impossible.
 */
export function chainBlendWeights(
  vertex: Vec2,
  chain: readonly Bone[],
  bandPx: number,
): SkinWeight[] {
  if (chain.length === 0) return [];
  if (chain.length === 1) return [{ bone: chain[0].id, weight: 1 }];

  // Arc-length breakpoints along the chain polyline.
  const joints: number[] = [0];
  for (const b of chain) joints.push(joints[joints.length - 1] + Math.max(b.length, 1e-6));
  const total = joints[joints.length - 1];

  // Project onto the nearest segment, then convert to a global arc position.
  let best = Infinity;
  let s = 0;
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i];
    const hx = b.head.x;
    const hy = b.head.y;
    const dx = b.tail.x - hx;
    const dy = b.tail.y - hy;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) continue;
    const raw = ((vertex.x - hx) * dx + (vertex.y - hy) * dy) / len2;
    const t = clamp(raw, 0, 1);
    const px = hx + dx * t;
    const py = hy + dy * t;
    const d = Math.hypot(vertex.x - px, vertex.y - py);
    if (d < best) {
      best = d;
      // Extrapolate past the ends so caps stay with their own bone.
      s = joints[i] + raw * (joints[i + 1] - joints[i]);
    }
  }
  s = clamp(s, -total, total * 2);

  const b = Math.max(bandPx, 1e-3);
  // H[j] = "already past interior joint j", a smooth 0..1 step.
  const pastJoint = (j: number): number => smoothstep((s - (joints[j] - b)) / (2 * b));

  const out: SkinWeight[] = [];
  for (let i = 0; i < chain.length; i++) {
    const enter = i === 0 ? 1 : pastJoint(i);
    const leave = i === chain.length - 1 ? 0 : pastJoint(i + 1);
    const w = enter - leave;
    if (w > 1e-5) out.push({ bone: chain[i].id, weight: w });
  }
  if (out.length === 0) return [{ bone: chain[0].id, weight: 1 }];
  const sum = out.reduce((a, w) => a + w.weight, 0);
  for (const w of out) w.weight /= sum;
  const rounded = out.reduce((a, w) => a + w.weight, 0);
  out[0].weight += 1 - rounded;
  return out;
}

/**
 * Resolve the bone chain a part spans, root to tip.
 * Falls back to the part's single bone, which makes the part rigid.
 */
export function resolveChain(part: Part, index: SkeletonIndex): Bone[] {
  const ids = part.boneChain && part.boneChain.length ? part.boneChain : part.bone ? [part.bone] : [];
  const out: Bone[] = [];
  for (const id of ids) {
    const b = index.byId.get(id);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Build a deformable mesh for a part: its contour resampled evenly, plus an
 * interior point grid, triangulated and skinned.
 */
export function buildPartMesh(
  part: Part,
  bones: readonly Bone[],
  options: SkinOptions = {},
): PartMesh {
  // Production defaults. A rig is built once and posed thousands of times,
  // so the mesh is worth resolving properly: a coarse outline creases
  // visibly at an extreme bend, and a coarse interior facets the bend.
  const samples = options.contourSamples ?? 40;
  const grid = options.interiorGrid ?? 5;

  const vertices: Vec2[] = [];
  const contourVertexIndex: number[][] = [];

  for (const contour of part.contours) {
    if (contour.length < 3) {
      contourVertexIndex.push([]);
      continue;
    }
    const target = Math.max(8, Math.min(samples, Math.max(8, contour.length * 2)));
    const rs = resampleClosed(contour.map(p2v), target);
    const idxs: number[] = [];
    for (const p of rs) {
      idxs.push(vertices.length);
      vertices.push(p);
    }
    contourVertexIndex.push(idxs);
  }

  // Triangulate the outer contour; interior points are added as Steiner
  // vertices for smoother bending, bound by proximity to the hull triangles.
  const outer = contourVertexIndex[0] ?? [];
  const triangles: number[] = [];
  if (outer.length >= 3) {
    const poly = outer.map((i) => vertices[i]);
    const tri = triangulate(poly);
    for (const t of tri) triangles.push(outer[t]);
  }

  // Interior grid — subdivides big parts so the bend is not faceted.
  if (grid > 1 && outer.length >= 3) {
    const poly = outer.map((i) => vertices[i]);
    const bb = bounds(poly);
    // A Steiner point that lands on an edge splits a triangle into slivers,
    // and a sliver inverts under the slightest deformation — which would
    // make the inversion invariant fire on geometry nobody can see. Keep
    // interior points a real distance clear of the boundary.
    const clearance = Math.min(bb.w, bb.h) * 0.12 + 1e-3;
    for (let gy = 1; gy < grid; gy++) {
      for (let gx = 1; gx < grid; gx++) {
        const p = { x: bb.x + (bb.w * gx) / grid, y: bb.y + (bb.h * gy) / grid };
        if (!insidePolygon(p, poly)) continue;
        if (boundaryDistance(p, poly) < clearance) continue;
        const t = findTriangle(p, triangles, vertices);
        if (t < 0) continue;
        const i0 = triangles[t];
        const i1 = triangles[t + 1];
        const i2 = triangles[t + 2];
        const ni = vertices.length;
        vertices.push(p);
        triangles.splice(t, 3, i0, i1, ni, i1, i2, ni, i2, i0, ni);
      }
    }
  }

  // Drop degenerate triangles.
  //
  // The mesh's triangles are not used to draw anything — deformation runs on
  // vertices and weights, and the renderer fills contours. Triangles exist so
  // the validators can measure area, inversion and stretch. A sliver measures
  // nothing useful: it carries no visible area, and it flips sign under any
  // deformation at all, which would report a broken rig over a triangle no
  // one can see. Filtering on shape quality, not just area, removes them.
  const kept: number[] = [];
  let areaSum = 0;
  let count = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    areaSum += triArea(vertices[triangles[t]], vertices[triangles[t + 1]], vertices[triangles[t + 2]]);
    count++;
  }
  const minArea = Math.max(1e-9, (areaSum / Math.max(1, count)) * 0.02);
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = vertices[triangles[t]];
    const b = vertices[triangles[t + 1]];
    const c = vertices[triangles[t + 2]];
    if (triArea(a, b, c) < minArea) continue;
    if (triangleQuality(a, b, c) < 0.08) continue;
    kept.push(triangles[t], triangles[t + 1], triangles[t + 2]);
  }
  triangles.length = 0;
  triangles.push(...kept);

  // Weights come from the bone chain the drawing actually spans.
  const ix = indexSkeleton(bones);
  const chain = resolveChain(part, ix);
  let weights: SkinWeight[][];
  if (chain.length > 1) {
    // The crossover band has to clear the drawing's half-width. A vertex far
    // off the bone axis sweeps through (offset x weight-gradient x angle) as
    // the joint bends; too steep a gradient relative to how wide the drawing
    // is, and the mesh folds back over itself.
    const halfWidth = partHalfWidth(part, chain[0]);
    const shortest = chain.reduce((a, b) => Math.min(a, b.length), Infinity);
    const autoBand = clamp(
      Math.max(halfWidth * 1.1, shortest * 0.25),
      1,
      Math.max(shortest * 2.5, halfWidth * 2),
    );
    const bandPx = autoBand * (options.jointBand ?? 1);
    weights = vertices.map((v) => chainBlendWeights(v, chain, bandPx));
  } else if (chain.length === 1) {
    weights = vertices.map(() => [{ bone: chain[0].id, weight: 1 }]);
  } else {
    const pool = options.deformBones
      ? bones.filter((b) => options.deformBones?.includes(b.id))
      : bones.filter((b) => b.kind === 'deform');
    weights = vertices.map((v) => computeWeights(v, pool, options));
  }

  return {
    partId: part.id,
    vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
    triangles,
    weights,
    contourVertexIndex,
  };
}


function triArea(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

/** Shortest distance from an interior point to the polygon boundary. */
function boundaryDistance(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = pointSegmentDistance(p, poly[j], poly[i]);
    if (d < best) best = d;
  }
  return best;
}

function insidePolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i].y > p.y !== poly[j].y > p.y) {
      const x = ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

function findTriangle(p: Vec2, triangles: readonly number[], vertices: readonly Vec2[]): number {
  for (let t = 0; t < triangles.length; t += 3) {
    const a = vertices[triangles[t]];
    const b = vertices[triangles[t + 1]];
    const c = vertices[triangles[t + 2]];
    if (inTri(p, a, b, c)) return t;
  }
  return -1;
}

function inTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Skinning: planar dual-quaternion blending.
 *
 * Averaging transformed *positions* — classic linear blend skinning —
 * collapses volume at every bend. That pinch is the "candy wrapper"
 * artefact, and to an audience it reads as a limb deflating mid-action.
 *
 * The fix is to blend the transforms rather than their outputs, and to do it
 * in a representation that stays well conditioned. Naive screw (SE(2) log)
 * blending is not: when two bones sit close to 180 degrees apart — a shin
 * folded under a thigh in a deep crouch, say — the blended rotation lands
 * near pi, where the exponential map's translation term is near-singular,
 * and the mesh is flung across the frame.
 *
 * Dual quaternions do not have that failure, because they carry the
 * *half* angle. Two transforms 230 degrees apart become half-angle
 * representatives 115 degrees apart, a sign flip puts them on the same
 * hemisphere, and the blend takes the short way round. This is the planar
 * (2D) form: a unit complex rotor q = e^{i.theta/2} plus a dual part
 * d = (1/2).t.q. Non-uniform scale is blended separately and applied before
 * the rigid part.
 *
 * The rest transform of each bone is the identity (parts are authored in rig
 * space), so each bone's skinning matrix is simply its world matrix.
 */

type Rotor = {
  qr: number;
  qi: number;
  dr: number;
  di: number;
  /** Residual linear part R(-theta) * A: scale and shear, rotation removed. */
  k00: number;
  k01: number;
  k10: number;
  k11: number;
};

function rotorOf(m: Mat2D): Rotor {
  const theta = Math.atan2(m.b, m.a);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const qr = Math.cos(theta / 2);
  const qi = Math.sin(theta / 2);
  // dual = (1/2) * t * conj(q).
  //
  // The conjugate is not optional. Writing the planar case with complex
  // numbers hides the fact that the underlying quaternion product has
  // i*k = -j, which flips the sign of one component. Using (1/2)*t*q
  // instead produces a blend that does not hold a joint two bones share
  // still: a fully folded elbow then throws the forearm across the frame.
  const dr = 0.5 * (m.e * qr + m.f * qi);
  const di = 0.5 * (m.f * qr - m.e * qi);
  // Factoring the rotation out leaves scale and shear, which live in a
  // linear space and can simply be averaged. A non-uniform root squash
  // composed with a rotated child produces genuine shear, and a plain
  // sx/sy decomposition would silently discard it.
  return {
    qr,
    qi,
    dr,
    di,
    k00: c * m.a + s * m.b,
    k01: c * m.c + s * m.d,
    k10: -s * m.a + c * m.b,
    k11: -s * m.c + c * m.d,
  };
}

export function deformMesh(mesh: PartMesh, posed: PosedSkeleton): Vec2[] {
  const out: Vec2[] = new Array(mesh.vertices.length);

  // One rotor per bone, shared across every vertex of the part.
  const cache = new Map<string, Rotor | null>();
  const rotorFor = (boneId: string): Rotor | null => {
    if (cache.has(boneId)) return cache.get(boneId) ?? null;
    const pb = posed.bones.get(boneId);
    const r = pb ? rotorOf(pb.world) : null;
    cache.set(boneId, r);
    return r;
  };

  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = p2v(mesh.vertices[i]);
    const ws = mesh.weights[i];
    if (!ws || ws.length === 0) {
      out[i] = v;
      continue;
    }
    if (ws.length === 1) {
      const pb = posed.bones.get(ws[0].bone);
      out[i] = pb ? mapply(pb.world, v) : v;
      continue;
    }

    // The heaviest influence fixes the hemisphere every other rotor is
    // brought onto, so the blend always takes the short rotational path.
    let pivot: Rotor | null = null;
    let pivotWeight = -1;
    for (const w of ws) {
      if (w.weight <= pivotWeight) continue;
      const r = rotorFor(w.bone);
      if (!r) continue;
      pivot = r;
      pivotWeight = w.weight;
    }
    if (!pivot) {
      out[i] = v;
      continue;
    }

    let qr = 0;
    let qi = 0;
    let dr = 0;
    let di = 0;
    let k00 = 0;
    let k01 = 0;
    let k10 = 0;
    let k11 = 0;
    let total = 0;
    for (const w of ws) {
      const r = rotorFor(w.bone);
      if (!r) continue;
      const sign = r.qr * pivot.qr + r.qi * pivot.qi < 0 ? -1 : 1;
      const k = w.weight * sign;
      qr += r.qr * k;
      qi += r.qi * k;
      dr += r.dr * k;
      di += r.di * k;
      k00 += r.k00 * w.weight;
      k01 += r.k01 * w.weight;
      k10 += r.k10 * w.weight;
      k11 += r.k11 * w.weight;
      total += w.weight;
    }
    if (total <= EPS) {
      out[i] = v;
      continue;
    }
    const norm = Math.hypot(qr, qi);
    if (norm < 1e-9) {
      out[i] = v;
      continue;
    }
    qr /= norm;
    qi /= norm;
    dr /= norm;
    di /= norm;
    k00 /= total;
    k01 /= total;
    k10 /= total;
    k11 /= total;
    // Averaging two linear parts that differ strongly can produce a matrix
    // with a negative determinant, which mirrors the geometry it is applied
    // to. Falling back to the dominant bone's linear part keeps orientation,
    // and the rotor still carries the blended rotation.
    if (k00 * k11 - k01 * k10 <= 1e-9) {
      k00 = pivot.k00;
      k01 = pivot.k01;
      k10 = pivot.k10;
      k11 = pivot.k11;
    }

    // t = 2 * d * q  (inverse of the d = (1/2) * t * conj(q) encoding)
    const tx = 2 * (dr * qr - di * qi);
    const ty = 2 * (dr * qi + di * qr);
    // R(theta) recovered from the half-angle rotor.
    const c = qr * qr - qi * qi;
    const sN = 2 * qr * qi;
    const ux = k00 * v.x + k01 * v.y;
    const uy = k10 * v.x + k11 * v.y;
    let p: Vec2 = { x: c * ux - sN * uy + tx, y: sN * ux + c * uy + ty };
    p = creaseClamp(p, ws, posed);
    out[i] = p;
  }
  return out;
}

/**
 * Crease clamp.
 *
 * However well a blend is formulated, a mesh spanning a joint will
 * eventually fold through itself: past roughly a right angle the inside of
 * the bend has less room than the geometry occupying it, and triangles
 * invert. That inversion is the melted-elbow artefact in miniature.
 *
 * The geometric constraint that prevents it is simple. At a bend the two
 * bones' angle bisector through the joint divides the plane; everything
 * belonging to the upper bone lives on one side of it and everything
 * belonging to the lower bone on the other. Nothing may cross. A vertex
 * that lands on the wrong side is projected back onto the bisector, which
 * is exactly what an animator draws: the inside of a bent elbow compresses
 * into the crease rather than overlapping through it.
 *
 * The clamp only engages where the bend is sharp enough to matter, so
 * gentle bends pass through untouched.
 */
function creaseClamp(
  p: Vec2,
  ws: readonly SkinWeight[],
  posed: PosedSkeleton,
): Vec2 {
  if (ws.length < 2) return p;
  // Find the dominant parent/child pair among the influences.
  let a: SkinWeight | undefined;
  let b: SkinWeight | undefined;
  for (const w of ws) {
    const pb = posed.bones.get(w.bone);
    if (!pb) continue;
    for (const other of ws) {
      if (other === w) continue;
      const ob = posed.bones.get(other.bone);
      if (!ob) continue;
      if (ob.bone.parent === w.bone) {
        if (!a || w.weight + other.weight > a.weight + (b?.weight ?? 0)) {
          a = w;
          b = other;
        }
      }
    }
  }
  if (!a || !b) return p;
  const pa = posed.bones.get(a.bone);
  const pb = posed.bones.get(b.bone);
  if (!pa || !pb) return p;

  const joint = pb.head;
  const inDir = vnorm(vsub(joint, pa.head));
  const outDir = vnorm(vsub(pb.tail, joint));
  if (vlen(inDir) < 0.5 || vlen(outDir) < 0.5) return p;

  // Angle between the bones. Near-straight joints need no clamp.
  const dot = clamp(-inDir.x * outDir.x - inDir.y * outDir.y, -1, 1);
  const interior = Math.acos(dot); // pi when straight, 0 when folded flat
  if (interior > 2.0) return p; // gentler than ~115 degrees: nothing to do

  const bis = vnorm({ x: -inDir.x + outDir.x, y: -inDir.y + outDir.y });
  if (vlen(bis) < 0.5) return p;
  const n = { x: -bis.y, y: bis.x };

  const sideA = -inDir.x * n.x - inDir.y * n.y;
  if (Math.abs(sideA) < 1e-6) return p;
  const want = a.weight >= b.weight ? Math.sign(sideA) : -Math.sign(sideA);
  const d = (p.x - joint.x) * n.x + (p.y - joint.y) * n.y;
  if (d * want >= 0) return p;
  return { x: p.x - n.x * d, y: p.y - n.y * d };
}

/** Deformed contours, ready to rasterise. */
export function deformContours(mesh: PartMesh, posed: PosedSkeleton): Vec2[][] {
  const verts = deformMesh(mesh, posed);
  return mesh.contourVertexIndex.map((idxs) => idxs.map((i) => verts[i]));
}

/** Rigid fallback: transform a part by a single bone's matrix. */
export function rigidTransform(part: Part, posed: PosedSkeleton): Mat2D | null {
  if (!part.bone) return null;
  const pb = posed.bones.get(part.bone);
  return pb ? pb.world : null;
}

/** Sum of weights per vertex; the normalisation invariant reads this. */
export function weightSums(mesh: PartMesh): number[] {
  return mesh.weights.map((ws) => ws.reduce((a, w) => a + w.weight, 0));
}

/** Re-normalise every vertex in place. The repair move for a failed check. */
export function normalizeWeights(mesh: PartMesh): PartMesh {
  return {
    ...mesh,
    weights: mesh.weights.map((ws) => {
      const sum = ws.reduce((a, w) => a + w.weight, 0);
      if (sum < EPS) return ws.length ? [{ bone: ws[0].bone, weight: 1 }] : ws;
      const scaled = ws.map((w) => ({ bone: w.bone, weight: w.weight / sum }));
      const total = scaled.reduce((a, w) => a + w.weight, 0);
      scaled[0].weight += 1 - total;
      return scaled;
    }),
  };
}

/** Area of a deformed mesh — the volume-conservation metric reads this. */
export function meshArea(vertices: readonly Vec2[], triangles: readonly number[]): number {
  let a = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const p = vertices[triangles[t]];
    const q = vertices[triangles[t + 1]];
    const r = vertices[triangles[t + 2]];
    a += Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
  }
  return a;
}

/** Signed triangle areas, for inversion detection. */
export function triangleSigns(vertices: readonly Vec2[], triangles: readonly number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const p = vertices[triangles[t]];
    const q = vertices[triangles[t + 1]];
    const r = vertices[triangles[t + 2]];
    out.push(((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2);
  }
  return out;
}

/**
 * Tearing metric: the largest *expansion* of a non-degenerate mesh edge
 * relative to its rest length.
 *
 * Only expansion counts. Compression is squash — a legitimate deformation
 * that the volume and inversion checks already police — whereas an edge that
 * stretches is geometry being pulled apart, which is what tearing looks like.
 * Edges shorter than a fraction of the part's diagonal are skipped, because
 * the ratio on a two-pixel interior edge is numerically meaningless.
 */
export function stretchRatio(
  rest: readonly Point[],
  deformed: readonly Vec2[],
  triangles: readonly number[],
): number {
  if (rest.length === 0) return 1;
  const bb = bounds(rest.map(p2v));
  const minEdge = Math.max(1e-3, Math.hypot(bb.w, bb.h) * 0.04);
  let worst = 1;
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = triangles[t + k];
      const j = triangles[t + ((k + 1) % 3)];
      const r = vdist(p2v(rest[i]), p2v(rest[j]));
      if (r < minEdge) continue;
      const d = vdist(deformed[i], deformed[j]);
      const ratio = d / r;
      if (ratio > worst) worst = ratio;
    }
  }
  return clamp(worst, 1, 1e6);
}
