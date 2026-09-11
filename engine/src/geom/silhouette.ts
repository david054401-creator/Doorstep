/**
 * Silhouette measurement.
 *
 * "Staging" and "Appeal" are the two principles that resist being turned
 * into numbers, and the silhouette is where both become measurable: if the
 * pose does not read in pure black, it does not read. Everything here works
 * on a rasterised union of the character's contours, because overlapping
 * cut-out parts make a purely geometric area meaningless.
 */

import type { Vec2 } from '../core/math.ts';
import { clamp01 } from '../core/math.ts';
import { bounds, convexHull, signedArea } from './polygon.ts';
import type { Bounds } from './polygon.ts';
import { rasterizeMask, coverageToMask } from '../raster/rasterize.ts';
import { mmul, mScale, mTranslate } from '../core/math.ts';

export type SilhouetteStats = {
  /** Union area in normalised units (fraction of the analysis canvas). */
  area: number;
  /** Union area over convex-hull area. Low = spiky or broken up. */
  solidity: number;
  /** Bounding box in source units. */
  bounds: Bounds;
  /** Width over height of the bounding box. */
  aspect: number;
  /**
   * Left/right asymmetry, 0 = perfectly symmetric. A fully symmetric pose
   * is the "twinning" failure; appeal wants some asymmetry.
   */
  asymmetry: number;
  /** Fraction of the bounding box that is *not* filled — negative space. */
  negativeSpace: number;
  /** Number of disconnected blobs. More than one means the pose falls apart. */
  components: number;
  /** The rasterised mask and its dimensions, for downstream critics. */
  mask: Uint8Array;
  width: number;
  height: number;
};

/**
 * Rasterise contours into a normalised box and measure them.
 * `size` is the long edge of the analysis canvas; 128 is plenty and fast.
 */
export function silhouetteStats(
  contours: readonly (readonly Vec2[])[],
  size = 128,
): SilhouetteStats {
  const pts = contours.flat();
  const bb = bounds(pts);
  if (pts.length < 3 || bb.w < 1e-6 || bb.h < 1e-6) {
    return {
      area: 0,
      solidity: 0,
      bounds: bb,
      aspect: 1,
      asymmetry: 0,
      negativeSpace: 1,
      components: 0,
      mask: new Uint8Array(0),
      width: 0,
      height: 0,
    };
  }

  const pad = 2;
  const scale = (size - pad * 2) / Math.max(bb.w, bb.h);
  const w = Math.max(4, Math.round(bb.w * scale) + pad * 2);
  const h = Math.max(4, Math.round(bb.h * scale) + pad * 2);
  const xf = mmul(mTranslate(pad - bb.x * scale, pad - bb.y * scale), mScale(scale, scale));

  // Every contour must wind the same way before they are rasterised as one
  // shape. Under the nonzero rule two overlapping contours with opposite
  // winding cancel, punching a hole where two parts overlap — which would
  // report a character's own arm as a gap in its silhouette.
  const wound = contours.map((c) => (signedArea(c) < 0 ? [...c].reverse() : [...c]));
  const mask = coverageToMask(rasterizeMask(wound, w, h, xf, 4), 0.5);
  const hull = convexHull(pts);
  const hullMask = coverageToMask(rasterizeMask([hull], w, h, xf, 4), 0.5);

  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  let hullArea = 0;
  for (let i = 0; i < hullMask.length; i++) hullArea += hullMask[i];

  // Mirror comparison for the twinning / appeal measure.
  let diff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = mask[y * w + x];
      const b = mask[y * w + (w - 1 - x)];
      if (a !== b) diff++;
    }
  }

  return {
    area: area / (w * h),
    solidity: hullArea > 0 ? clamp01(area / hullArea) : 0,
    bounds: bb,
    aspect: bb.h > 1e-6 ? bb.w / bb.h : 1,
    asymmetry: area > 0 ? clamp01(diff / (2 * area)) : 0,
    negativeSpace: clamp01(1 - area / Math.max(1, w * h)),
    components: countComponents(mask, w, h),
    mask,
    width: w,
    height: h,
  };
}

function countComponents(mask: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let n = 0;
  // Ignore specks below this size; antialiasing can leave single pixels.
  const minSize = Math.max(4, Math.round(w * h * 0.0015));
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }
    if (size >= minSize) n++;
  }
  return n;
}

/**
 * Intersection-over-union of two silhouettes, resampled to a shared box.
 * Used for identity drift and for comparing an organic frame against the
 * rig render it has to beat.
 */
export function silhouetteIoU(
  a: readonly (readonly Vec2[])[],
  b: readonly (readonly Vec2[])[],
  size = 128,
): number {
  const sa = silhouetteStats(a, size);
  const sb = silhouetteStats(b, size);
  if (sa.width === 0 || sb.width === 0) return 0;
  const w = Math.max(sa.width, sb.width);
  const h = Math.max(sa.height, sb.height);
  const sample = (s: SilhouetteStats, x: number, y: number): number => {
    const sx = Math.min(s.width - 1, Math.floor((x / w) * s.width));
    const sy = Math.min(s.height - 1, Math.floor((y / h) * s.height));
    return s.mask[sy * s.width + sx];
  };
  let inter = 0;
  let union = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = sample(sa, x, y);
      const pb = sample(sb, x, y);
      if (pa && pb) inter++;
      if (pa || pb) union++;
    }
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * Line of action: the dominant axis through the pose, as a segment.
 * A strong pose has a clear one; a weak pose's points form a blob.
 */
export function lineOfAction(points: readonly Vec2[]): {
  from: Vec2;
  to: Vec2;
  strength: number;
} {
  if (points.length < 2) {
    const p = points[0] ?? { x: 0, y: 0 };
    return { from: p, to: p, strength: 0 };
  }
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const n = points.length;
  sxx /= n;
  syy /= n;
  sxy /= n;
  // Principal axis of the covariance matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const t = (p.x - mx) * dirX + (p.y - my) * dirY;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  const strength = l1 > 1e-9 ? clamp01(1 - l2 / l1) : 0;
  return {
    from: { x: mx + dirX * lo, y: my + dirY * lo },
    to: { x: mx + dirX * hi, y: my + dirY * hi },
    strength,
  };
}
