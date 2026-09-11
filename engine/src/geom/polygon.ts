/**
 * Polygon geometry. The rig validator battery lives or dies on these:
 * "inverted triangle", "self-intersection", "tearing" and "reassembly IoU"
 * are all statements about polygons, and they must be exact.
 */

import type { Vec2 } from '../core/math.ts';
import { EPS, vcross, vsub, vdist, clamp } from '../core/math.ts';

export type Polygon = Vec2[];
export type Bounds = { x: number; y: number; w: number; h: number };

/** Signed area. Positive = counter-clockwise in a y-down screen space. */
export function signedArea(poly: readonly Vec2[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a / 2;
}

export const area = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

export function centroid(poly: readonly Vec2[]): Vec2 {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function perimeter(poly: readonly Vec2[]): number {
  let p = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    p += vdist(poly[j], poly[i]);
  }
  return p;
}

export function bounds(points: readonly Vec2[]): Bounds {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > p.y !== pj.y > p.y) {
      const xInt = ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (p.x < xInt) inside = !inside;
    }
  }
  return inside;
}

export type SegmentHit = { point: Vec2; t: number; u: number };

/** Proper segment intersection; shared endpoints do not count. */
export function segmentIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  strict = true,
): SegmentHit | null {
  const r = vsub(a2, a1);
  const s = vsub(b2, b1);
  const denom = vcross(r, s);
  if (Math.abs(denom) < 1e-12) return null; // parallel or collinear
  const qp = vsub(b1, a1);
  const t = vcross(qp, s) / denom;
  const u = vcross(qp, r) / denom;
  const lo = strict ? 1e-9 : 0;
  const hi = strict ? 1 - 1e-9 : 1;
  if (t < lo || t > hi || u < lo || u > hi) return null;
  return { point: { x: a1.x + t * r.x, y: a1.y + t * r.y }, t, u };
}

export type SelfIntersection = { i: number; j: number; point: Vec2 };

/**
 * Every pair of non-adjacent edges is tested. O(n^2) with a bounds
 * pre-filter — parts are tens of points, not thousands, and correctness here
 * matters more than speed.
 */
export function selfIntersections(poly: readonly Vec2[]): SelfIntersection[] {
  const n = poly.length;
  const hits: SelfIntersection[] = [];
  if (n < 4) return hits;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // Skip the wrap-around adjacency of the first and last edge.
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      const hit = segmentIntersection(a1, a2, b1, b2, true);
      if (hit) hits.push({ i, j, point: hit.point });
    }
  }
  return hits;
}

export const isSimple = (poly: readonly Vec2[]): boolean => selfIntersections(poly).length === 0;

/**
 * Triangle orientation sign. A deformed mesh whose triangles flip sign has
 * folded over itself — this is the "inverted triangle" check, and it is the
 * single most reliable detector of the melted-limb failure.
 */
export function triangleSign(a: Vec2, b: Vec2, c: Vec2): number {
  const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return cr > EPS ? 1 : cr < -EPS ? -1 : 0;
}

export function triangleArea(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

/**
 * Aspect quality of a triangle, 0 (degenerate sliver) .. 1 (equilateral).
 * Slivers are where tearing artefacts appear before a full inversion does.
 */
export function triangleQuality(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = vdist(a, b);
  const bc = vdist(b, c);
  const ca = vdist(c, a);
  const s = (ab + bc + ca) / 2;
  if (s < EPS) return 0;
  const ar = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  const longest = Math.max(ab, bc, ca);
  if (longest < EPS) return 0;
  // 4*sqrt(3)*A / (sum of squares of sides) is 1 for equilateral.
  const denom = ab * ab + bc * bc + ca * ca;
  return denom < EPS ? 0 : clamp((4 * Math.sqrt(3) * ar) / denom, 0, 1);
}

/**
 * Ear-clipping triangulation for a simple polygon. Returns index triples.
 * Deterministic: always clips the highest-quality available ear, so the same
 * polygon always yields the same mesh.
 */
export function triangulate(poly: readonly Vec2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const ccw = signedArea(poly) > 0;
  const indices = Array.from({ length: n }, (_, i) => (ccw ? i : n - 1 - i));
  const pts = indices.map((i) => poly[i]);
  const out: number[] = [];
  const remaining = indices.map((_, i) => i);

  let guard = 0;
  while (remaining.length > 3 && guard++ < n * n + 16) {
    let bestEar = -1;
    let bestQ = -1;
    for (let k = 0; k < remaining.length; k++) {
      const i0 = remaining[(k - 1 + remaining.length) % remaining.length];
      const i1 = remaining[k];
      const i2 = remaining[(k + 1) % remaining.length];
      const a = pts[i0];
      const b = pts[i1];
      const c = pts[i2];
      if (triangleSign(a, b, c) <= 0) continue; // reflex in CCW ordering
      let contains = false;
      for (const m of remaining) {
        if (m === i0 || m === i1 || m === i2) continue;
        if (pointInTriangle(pts[m], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      const q = triangleQuality(a, b, c);
      if (q > bestQ) {
        bestQ = q;
        bestEar = k;
      }
    }
    if (bestEar < 0) break; // degenerate input; emit what we have
    const k = bestEar;
    const i0 = remaining[(k - 1 + remaining.length) % remaining.length];
    const i1 = remaining[k];
    const i2 = remaining[(k + 1) % remaining.length];
    out.push(indices[i0], indices[i1], indices[i2]);
    remaining.splice(k, 1);
  }
  if (remaining.length === 3) {
    out.push(indices[remaining[0]], indices[remaining[1]], indices[remaining[2]]);
  }
  return out;
}

export function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

/** Resample a closed contour to a fixed vertex count, evenly by arc length. */
export function resampleClosed(poly: readonly Vec2[], count: number): Vec2[] {
  if (poly.length < 2 || count < 3) return [...poly];
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i <= poly.length; i++) {
    total += vdist(poly[i - 1], poly[i % poly.length]);
    lengths.push(total);
  }
  if (total < EPS) return [...poly];
  const out: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count;
    let seg = 1;
    while (seg < lengths.length - 1 && lengths[seg] < target) seg++;
    const l0 = lengths[seg - 1];
    const l1 = lengths[seg];
    const t = l1 - l0 < EPS ? 0 : (target - l0) / (l1 - l0);
    const p0 = poly[(seg - 1) % poly.length];
    const p1 = poly[seg % poly.length];
    out.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
  }
  return out;
}

/** Douglas-Peucker simplification, for SVG cleanup after vectorisation. */
export function simplify(poly: readonly Vec2[], tolerance: number): Vec2[] {
  if (poly.length < 3) return [...poly];
  const keep = new Array<boolean>(poly.length).fill(false);
  keep[0] = true;
  keep[poly.length - 1] = true;
  const stack: [number, number][] = [[0, poly.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(poly[i], poly[s], poly[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return poly.filter((_, i) => keep[i]);
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return vdist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Intersection-over-union of two polygons, computed on a raster grid.
 * Used by the part-reassembly check (IoU >= 0.98 vs. the original drawing).
 * A grid of 512 gives ~0.2% precision, well under the tolerance we gate on.
 */
export function polygonIoU(a: readonly Vec2[], b: readonly Vec2[], grid = 512): number {
  if (a.length < 3 || b.length < 3) return 0;
  const bb = unionBounds(bounds(a), bounds(b));
  if (bb.w < EPS || bb.h < EPS) return 0;
  const cols = grid;
  const rows = Math.max(1, Math.round((grid * bb.h) / Math.max(bb.w, EPS)));
  let inter = 0;
  let union = 0;
  for (let r = 0; r < rows; r++) {
    const y = bb.y + ((r + 0.5) / rows) * bb.h;
    for (let c = 0; c < cols; c++) {
      const x = bb.x + ((c + 0.5) / cols) * bb.w;
      const p = { x, y };
      const inA = pointInPolygon(p, a);
      const inB = pointInPolygon(p, b);
      if (inA && inB) inter++;
      if (inA || inB) union++;
    }
  }
  return union === 0 ? 0 : inter / union;
}

/** Convex hull (monotone chain). Used for silhouette and appeal measures. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  if (pts.length < 3) return pts;
  const half = (src: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of src) {
      while (out.length >= 2 && triangleSign(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Solidity: area / hull area. Low solidity = spiky, high = blobby. */
export function solidity(poly: readonly Vec2[]): number {
  const h = convexHull(poly);
  const ha = area(h);
  return ha < EPS ? 0 : clamp(area(poly) / ha, 0, 1);
}

/** Offset a closed polygon outward (positive) or inward, by vertex normals. */
export function offsetPolygon(poly: readonly Vec2[], distance: number): Vec2[] {
  const n = poly.length;
  if (n < 3) return [...poly];
  const ccw = signedArea(poly) > 0 ? 1 : -1;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    const d1 = { x: p.x - prev.x, y: p.y - prev.y };
    const d2 = { x: next.x - p.x, y: next.y - p.y };
    const l1 = Math.hypot(d1.x, d1.y) || 1;
    const l2 = Math.hypot(d2.x, d2.y) || 1;
    const n1 = { x: -d1.y / l1, y: d1.x / l1 };
    const n2 = { x: -d2.y / l2, y: d2.x / l2 };
    let nx = (n1.x + n2.x) / 2;
    let ny = (n1.y + n2.y) / 2;
    const nl = Math.hypot(nx, ny);
    if (nl < EPS) return { ...p };
    nx /= nl;
    ny /= nl;
    return { x: p.x + nx * distance * ccw, y: p.y + ny * distance * ccw };
  });
}
