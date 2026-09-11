/**
 * TIER 1 — perceptual metrics.
 *
 * Real measurements on decoded pixels: structural similarity, dense
 * optical flow, warp error, flicker, edge statistics, and a descriptor
 * used for identity. These are what gate the organic pass against the rig
 * render, and they run everywhere with no model weights.
 *
 * Where the blueprint names a learned metric (LPIPS, DINOv2), the provider
 * interface in `critics/types.ts` is the seam: a hosted or local model can
 * be dropped in and the thresholds re-calibrated. What is here is the
 * deterministic floor that always runs, and it is never silently passed
 * off as the learned metric.
 */

import type { ImageBuffer } from '../../raster/buffer.ts';
import { luminanceMap, edgeMap, getPixel, resize, flatten } from '../../raster/buffer.ts';
import { mean, clamp01, clamp } from '../../core/math.ts';
import { rgbToLab, deltaE2000 } from '../../core/color.ts';

/** Mean absolute difference over luminance, 0..1. */
export function mae(a: ImageBuffer, b: ImageBuffer): number {
  const la = luminanceMap(a);
  const lb = luminanceMap(b);
  const n = Math.min(la.length, lb.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(la[i] - lb[i]);
  return s / n;
}

export function psnr(a: ImageBuffer, b: ImageBuffer): number {
  const la = luminanceMap(a);
  const lb = luminanceMap(b);
  const n = Math.min(la.length, lb.length);
  if (n === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) s += (la[i] - lb[i]) ** 2;
  const mse = s / n;
  return mse <= 1e-12 ? Infinity : 10 * Math.log10(1 / mse);
}

/**
 * Structural similarity, windowed 8x8 with the standard constants.
 * Returns the mean SSIM over the image, 0..1.
 */
export function ssim(a: ImageBuffer, b: ImageBuffer, window = 8): number {
  if (a.width !== b.width || a.height !== b.height) {
    const rb = resize(b, a.width, a.height);
    return ssim(a, rb, window);
  }
  const la = luminanceMap(a);
  const lb = luminanceMap(b);
  const C1 = 0.01 ** 2;
  const C2 = 0.03 ** 2;
  const scores: number[] = [];
  for (let y = 0; y + window <= a.height; y += window) {
    for (let x = 0; x + window <= a.width; x += window) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      const n = window * window;
      for (let dy = 0; dy < window; dy++) {
        for (let dx = 0; dx < window; dx++) {
          const i = (y + dy) * a.width + (x + dx);
          const va = la[i];
          const vb = lb[i];
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      const s =
        ((2 * ma * mb + C1) * (2 * cov + C2)) /
        ((ma * ma + mb * mb + C1) * (va + vb + C2));
      scores.push(s);
    }
  }
  return scores.length ? clamp01(mean(scores)) : 1;
}

export type FlowField = {
  width: number;
  height: number;
  /** Per-pixel displacement, in pixels. */
  u: Float32Array;
  v: Float32Array;
  /** Per-pixel confidence, 0..1. */
  confidence: Float32Array;
};

/**
 * Dense optical flow by Lucas-Kanade on a Gaussian pyramid.
 *
 * Good enough to measure warp error and to detect the tell-tale
 * inconsistent motion of a generated inbetween. Not a replacement for
 * RAFT — it is the floor that always runs, and the provider seam is there
 * for the learned version.
 */
export function opticalFlow(
  a: ImageBuffer,
  b: ImageBuffer,
  options: { levels?: number; window?: number; iterations?: number } = {},
): FlowField {
  const levels = options.levels ?? 3;
  const win = options.window ?? 7;
  const iterations = options.iterations ?? 3;

  const pyramid = (img: ImageBuffer): Float32Array[] => {
    const out: Float32Array[] = [luminanceMap(img)];
    let w = img.width;
    let h = img.height;
    const sizes: [number, number][] = [[w, h]];
    for (let l = 1; l < levels; l++) {
      const pw = Math.max(4, Math.floor(w / 2));
      const ph = Math.max(4, Math.floor(h / 2));
      const prev = out[l - 1];
      const [ow] = sizes[l - 1];
      const down = new Float32Array(pw * ph);
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const sx = x * 2;
          const sy = y * 2;
          down[y * pw + x] =
            (prev[sy * ow + sx] +
              prev[sy * ow + Math.min(ow - 1, sx + 1)] +
              prev[Math.min(sizes[l - 1][1] - 1, sy + 1) * ow + sx] +
              prev[Math.min(sizes[l - 1][1] - 1, sy + 1) * ow + Math.min(ow - 1, sx + 1)]) /
            4;
        }
      }
      out.push(down);
      sizes.push([pw, ph]);
      w = pw;
      h = ph;
    }
    return out;
  };

  const sizesOf = (img: ImageBuffer): [number, number][] => {
    const out: [number, number][] = [[img.width, img.height]];
    for (let l = 1; l < levels; l++) {
      out.push([Math.max(4, Math.floor(out[l - 1][0] / 2)), Math.max(4, Math.floor(out[l - 1][1] / 2))]);
    }
    return out;
  };

  const pa = pyramid(a);
  const pb = pyramid(b);
  const sizes = sizesOf(a);

  let u = new Float32Array(sizes[levels - 1][0] * sizes[levels - 1][1]);
  let v = new Float32Array(u.length);

  for (let l = levels - 1; l >= 0; l--) {
    const [w, h] = sizes[l];
    if (l < levels - 1) {
      const [pw, ph] = sizes[l + 1];
      const nu = new Float32Array(w * h);
      const nv = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.min(pw - 1, x >> 1);
          const sy = Math.min(ph - 1, y >> 1);
          nu[y * w + x] = u[sy * pw + sx] * 2;
          nv[y * w + x] = v[sy * pw + sx] * 2;
        }
      }
      u = nu;
      v = nv;
    }

    const A = pa[l];
    const B = pb[l];
    const half = Math.floor(win / 2);
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = half; y < h - half; y++) {
        for (let x = half; x < w - half; x++) {
          const i = y * w + x;
          let sxx = 0;
          let syy = 0;
          let sxy = 0;
          let sxt = 0;
          let syt = 0;
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const px = x + dx;
              const py = y + dy;
              const j = py * w + px;
              const ix = (A[j + 1] - A[j - 1]) / 2;
              const iy = (A[j + w] - A[j - w]) / 2;
              const wx = clamp(px + u[i], 0, w - 1);
              const wy = clamp(py + v[i], 0, h - 1);
              const bval = bilinear(B, w, h, wx, wy);
              const it = bval - A[j];
              sxx += ix * ix;
              syy += iy * iy;
              sxy += ix * iy;
              sxt += ix * it;
              syt += iy * it;
            }
          }
          const det = sxx * syy - sxy * sxy;
          if (Math.abs(det) < 1e-8) continue;
          const du = (-sxt * syy + syt * sxy) / det;
          const dv = (-syt * sxx + sxt * sxy) / det;
          u[i] += clamp(du, -2, 2);
          v[i] += clamp(dv, -2, 2);
        }
      }
    }
  }

  // Confidence from the gradient structure at the finest level.
  const [w, h] = sizes[0];
  const confidence = new Float32Array(w * h);
  const A = pa[0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const ix = (A[i + 1] - A[i - 1]) / 2;
      const iy = (A[i + w] - A[i - w]) / 2;
      confidence[i] = clamp01(Math.hypot(ix, iy) * 6);
    }
  }
  return { width: w, height: h, u, v, confidence };
}

function bilinear(data: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * Warp error: warp frame A by the measured flow and compare to frame B.
 *
 * A generated inbetween that invents detail shows up here even when it
 * looks plausible in isolation, because the invented detail cannot be
 * explained by any consistent motion.
 */
export function warpError(a: ImageBuffer, b: ImageBuffer, flow?: FlowField): number {
  const f = flow ?? opticalFlow(a, b);
  const la = luminanceMap(a);
  const lb = luminanceMap(b);
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const c = f.confidence[i];
      if (c < 0.05) continue;
      // The solver estimates (u, v) such that B(p + d) matches A(p): the
      // feature at p in A shows up at p + d in B. Reconstructing B at q
      // therefore samples A at q - d, not q + d. Getting this backwards
      // makes a perfectly tracked motion look like a large warp error.
      const wx = clamp(x - f.u[i], 0, f.width - 1);
      const wy = clamp(y - f.v[i], 0, f.height - 1);
      const warped = bilinear(la, f.width, f.height, wx, wy);
      sum += Math.abs(warped - lb[i]) * c;
      weight += c;
    }
  }
  return weight > 0 ? sum / weight : 0;
}

/** Mean flow magnitude — how much the frame actually moved. */
export function flowMagnitude(f: FlowField): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < f.u.length; i++) {
    if (f.confidence[i] < 0.05) continue;
    s += Math.hypot(f.u[i], f.v[i]);
    n++;
  }
  return n > 0 ? s / n : 0;
}

/** Temporal flicker: mean absolute luminance change across a sequence. */
export function flicker(frames: readonly ImageBuffer[]): number {
  if (frames.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < frames.length; i++) total += mae(frames[i - 1], frames[i]);
  return total / (frames.length - 1);
}

/**
 * A perceptual distance in the spirit of LPIPS, built from multi-scale
 * structure and colour rather than learned features.
 *
 * Named honestly: this is not LPIPS and is not claimed to correlate with
 * it. It is a deterministic stand-in with the same role in the gate, and
 * the calibration harness re-fits its threshold against labelled frames.
 */
export function perceptualDistance(a: ImageBuffer, b: ImageBuffer): number {
  const scales = [1, 2, 4];
  let total = 0;
  let weightSum = 0;
  let ca = a;
  let cb = b;
  for (const s of scales) {
    const w = Math.max(8, Math.floor(a.width / s));
    const h = Math.max(8, Math.floor(a.height / s));
    ca = resize(a, w, h);
    cb = resize(b, w, h);
    const structural = 1 - ssim(ca, cb, Math.max(4, Math.floor(8 / s)));
    const ea = edgeMap(ca);
    const eb = edgeMap(cb);
    let edgeDiff = 0;
    for (let i = 0; i < ea.length; i++) edgeDiff += Math.abs(ea[i] - eb[i]);
    edgeDiff /= Math.max(1, ea.length);
    const weight = 1 / s;
    total += (structural * 0.7 + edgeDiff * 0.3) * weight;
    weightSum += weight;
  }
  // Colour term in CIELAB, which structural measures ignore entirely.
  const sa = resize(a, 32, 32);
  const sb = resize(b, 32, 32);
  let colour = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      colour += deltaE2000(rgbToLab(getPixel(sa, x, y)), rgbToLab(getPixel(sb, x, y)));
    }
  }
  colour = colour / (32 * 32) / 100;
  return clamp01(total / weightSum + colour * 0.25);
}

/**
 * Identity descriptor.
 *
 * A compact, deterministic feature vector: a coarse CIELAB colour
 * histogram, an oriented-gradient histogram over a spatial grid, and
 * normalised shape moments. Cosine similarity between two descriptors is
 * the identity metric the gate uses when no learned embedding provider is
 * configured — and it is labelled as such, never passed off as DINOv2.
 */
export function identityDescriptor(img: ImageBuffer, gridSize = 4, orientations = 8): number[] {
  const flat = flatten(img, { r: 255, g: 255, b: 255 });
  const small = resize(flat, 64, 64);
  const lum = luminanceMap(small);
  const w = 64;
  const h = 64;
  const cellW = w / gridSize;
  const cellH = h / gridSize;

  // Oriented gradient histogram per cell.
  const hog = new Array<number>(gridSize * gridSize * orientations).fill(0);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      const mag = Math.hypot(gx, gy);
      if (mag < 1e-4) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI; // unsigned orientation
      const bin = Math.min(orientations - 1, Math.floor((angle / Math.PI) * orientations));
      const cx = Math.min(gridSize - 1, Math.floor(x / cellW));
      const cy = Math.min(gridSize - 1, Math.floor(y / cellH));
      hog[(cy * gridSize + cx) * orientations + bin] += mag;
    }
  }

  // Coarse CIELAB histogram, which carries the character's colour identity.
  const bins = 4;
  const colour = new Array<number>(bins * bins * bins).fill(0);
  let opaque = 0;
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const p = getPixel(img, x, y);
      if (p.a < 0.5) continue;
      opaque++;
      const lab = rgbToLab(p);
      const li = Math.min(bins - 1, Math.floor((lab.L / 100) * bins));
      const ai = Math.min(bins - 1, Math.floor(((lab.a + 100) / 200) * bins));
      const bi = Math.min(bins - 1, Math.floor(((lab.b + 100) / 200) * bins));
      colour[(li * bins + ai) * bins + bi]++;
    }
  }

  // Normalised shape moments from the alpha channel.
  let m00 = 0;
  let m10 = 0;
  let m01 = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3] / 255;
      if (a < 0.5) continue;
      m00 += 1;
      m10 += x;
      m01 += y;
    }
  }
  const cx = m00 > 0 ? m10 / m00 / Math.max(1, img.width) : 0.5;
  const cy = m00 > 0 ? m01 / m00 / Math.max(1, img.height) : 0.5;
  const fill = m00 / Math.max(1, img.width * img.height);

  const vec = [...l2(hog), ...l1(colour, opaque), cx, cy, fill];
  return l2(vec);
}

function l2(v: readonly number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n > 1e-9 ? v.map((x) => x / n) : v.map(() => 0);
}
function l1(v: readonly number[], total: number): number[] {
  const t = total > 0 ? total : v.reduce((a, x) => a + x, 0) || 1;
  return v.map((x) => x / t);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return clamp(dot / Math.sqrt(na * nb), -1, 1);
}
