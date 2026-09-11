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
import { luminanceMap, edgeMap, alphaMap, getPixel, resize, flatten } from '../../raster/buffer.ts';
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
    // Sampling with clamped coordinates is not a nicety here. The window
    // runs from y = half, so dy = -half reads row -1 and dy = +half at the
    // last row reads row h: raw indexing returns `undefined`, the gradient
    // becomes NaN, and because `Math.abs(NaN) < 1e-8` is false the guard
    // below waves it straight through into the flow field.
    const at = (data: Float32Array, x: number, y: number): number =>
      data[clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1)];
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
              const ix = (at(A, px + 1, py) - at(A, px - 1, py)) / 2;
              const iy = (at(A, px, py + 1) - at(A, px, py - 1)) / 2;
              const wx = clamp(px + u[i], 0, w - 1);
              const wy = clamp(py + v[i], 0, h - 1);
              const bval = bilinear(B, w, h, wx, wy);
              const it = bval - at(A, px, py);
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
 * A compact, deterministic feature vector in three blocks: oriented
 * gradient structure, a CIELAB colour histogram, and scale-free shape
 * moments. Cosine similarity between two descriptors is the identity
 * metric the gate uses when no learned embedding provider is configured —
 * and it is labelled as such, never passed off as DINOv2.
 *
 * Three properties matter more than the exact choice of features:
 *
 * 1. **The grid is anchored on the subject, not on the frame.** Identity
 *    is who the character is, not where they stand. The spatial grid is
 *    centred on the support centroid and sized by the support radius, so
 *    a character who walks four pixels left is still the same character.
 *    An absolute frame grid fails that test outright.
 * 2. **Binning is soft.** Hard cell and orientation assignment puts a
 *    cliff at every bin boundary, and a sub-cell shift dumps a block of
 *    energy across it. Trilinear interpolation over the two cell axes and
 *    the orientation axis removes the cliff.
 * 3. **Blocks are normalised and weighted explicitly.** Concatenating raw
 *    features lets whichever block happens to carry the largest numbers
 *    decide the metric — and the block that dominated here was the one
 *    carrying no identity information at all.
 */
export const IDENTITY_BLOCK_WEIGHTS = { structure: 0.55, colour: 0.33, shape: 0.12 };

/** Working resolution for the descriptor. Fixed so it is resolution-free. */
const DESCRIPTOR_SIZE = 64;

export function identityDescriptor(img: ImageBuffer, gridSize = 4, orientations = 8): number[] {
  const size = DESCRIPTOR_SIZE;
  const small = resize(img, size, size);
  const opaque = flatten(small, { r: 255, g: 255, b: 255 });
  const lum = luminanceMap(opaque);
  const alpha = alphaMap(small);

  const at = (data: Float32Array, x: number, y: number): number =>
    data[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)];
  const gradient = (x: number, y: number): { gx: number; gy: number } => ({
    gx: (at(lum, x + 1, y) - at(lum, x - 1, y)) / 2,
    gy: (at(lum, x, y + 1) - at(lum, x, y - 1)) / 2,
  });

  // Support — where the subject is.
  //
  // On an isolated character plate that is the alpha channel, which is why
  // the identity check renders plates on transparency. On a flattened
  // frame nothing is transparent, so fall back to gradient energy: it
  // picks out the drawing and ignores flat paper.
  let alphaMass = 0;
  for (let i = 0; i < alpha.length; i++) alphaMass += alpha[i];
  const isolated = alphaMass < 0.98 * alpha.length;
  const support = new Float32Array(size * size);
  if (isolated) {
    support.set(alpha);
  } else {
    let peak = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const { gx, gy } = gradient(x, y);
        const m = Math.hypot(gx, gy);
        support[y * size + x] = m;
        if (m > peak) peak = m;
      }
    }
    if (peak > 1e-6) for (let i = 0; i < support.length; i++) support[i] /= peak;
  }

  // Centroid and radius of the support, which place and size the grid.
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = support[y * size + x];
      if (s <= 0) continue;
      mass += s;
      sx += s * x;
      sy += s * y;
    }
  }
  const cx = mass > 0 ? sx / mass : size / 2;
  const cy = mass > 0 ? sy / mass : size / 2;
  let mxx = 0;
  let myy = 0;
  let mxy = 0;
  let m4 = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = support[y * size + x];
      if (s <= 0) continue;
      const dx = x - cx;
      const dy = y - cy;
      mxx += s * dx * dx;
      myy += s * dy * dy;
      mxy += s * dx * dy;
      m4 += s * (dx * dx + dy * dy) ** 2;
    }
  }
  if (mass > 0) {
    mxx /= mass;
    myy /= mass;
    mxy /= mass;
    m4 /= mass;
  }
  const radius = Math.sqrt(Math.max(1, mxx + myy));
  // 1.5 sigma covers a filled silhouette with margin without letting a
  // single stray speck of support inflate the window.
  const extent = clamp(radius * 1.5, size / 8, size);
  const cellSize = (2 * extent) / gridSize;

  // Oriented gradient histogram, trilinear over (cell x, cell y, angle).
  const hog = new Array<number>(gridSize * gridSize * orientations).fill(0);
  const addHog = (gx: number, gy: number, ob: number, weight: number): void => {
    if (weight <= 0) return;
    if (gx < -0.5 || gx > gridSize - 0.5 || gy < -0.5 || gy > gridSize - 0.5) return;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const o0 = Math.floor(ob);
    const tx = gx - x0;
    const ty = gy - y0;
    const to = ob - o0;
    for (let i = 0; i <= 1; i++) {
      const cxi = x0 + i;
      if (cxi < 0 || cxi >= gridSize) continue;
      const wx = i === 0 ? 1 - tx : tx;
      for (let j = 0; j <= 1; j++) {
        const cyi = y0 + j;
        if (cyi < 0 || cyi >= gridSize) continue;
        const wy = j === 0 ? 1 - ty : ty;
        for (let k = 0; k <= 1; k++) {
          // Orientation is unsigned, so the bin axis wraps at pi.
          const oi = (((o0 + k) % orientations) + orientations) % orientations;
          const wo = k === 0 ? 1 - to : to;
          hog[(cyi * gridSize + cxi) * orientations + oi] += weight * wx * wy * wo;
        }
      }
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = support[y * size + x];
      if (s <= 0.02) continue;
      const { gx, gy } = gradient(x, y);
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 1e-4) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      addHog(
        (x - (cx - extent)) / cellSize - 0.5,
        (y - (cy - extent)) / cellSize - 0.5,
        (angle / Math.PI) * orientations - 0.5,
        magnitude * s,
      );
    }
  }

  // Coarse CIELAB histogram, which carries the character's colour
  // identity. Soft-binned for the same reason as the gradients, and
  // weighted by support so the background does not vote.
  const bins = 4;
  const colour = new Array<number>(bins * bins * bins).fill(0);
  let colourMass = 0;
  const addColour = (l: number, a: number, b: number, weight: number): void => {
    const f = [l, a, b];
    const base = f.map((t) => Math.floor(t));
    const frac = f.map((t, i) => t - base[i]);
    for (let i = 0; i <= 1; i++) {
      const li = base[0] + i;
      if (li < 0 || li >= bins) continue;
      const wl = i === 0 ? 1 - frac[0] : frac[0];
      for (let j = 0; j <= 1; j++) {
        const ai = base[1] + j;
        if (ai < 0 || ai >= bins) continue;
        const wa = j === 0 ? 1 - frac[1] : frac[1];
        for (let k = 0; k <= 1; k++) {
          const bi = base[2] + k;
          if (bi < 0 || bi >= bins) continue;
          const wb = k === 0 ? 1 - frac[2] : frac[2];
          colour[(li * bins + ai) * bins + bi] += weight * wl * wa * wb;
        }
      }
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = getPixel(small, x, y);
      if (p.a < 0.5) continue;
      // Inside the subject window, and weighted by how much of the subject
      // is actually here. A flat background outside the window is not
      // part of who this character is.
      if (Math.abs(x - cx) > extent || Math.abs(y - cy) > extent) continue;
      const s = isolated ? p.a : Math.max(support[y * size + x], 0.15);
      const lab = rgbToLab(p);
      colourMass += s;
      addColour(
        clamp((lab.L / 100) * bins - 0.5, 0, bins - 1),
        clamp(((lab.a + 100) / 200) * bins - 0.5, 0, bins - 1),
        clamp(((lab.b + 100) / 200) * bins - 0.5, 0, bins - 1),
        s,
      );
    }
  }

  // Shape, as scale- and translation-free moments of the support.
  //
  // The old descriptor put the centroid and the frame coverage here, both
  // of which say where the character is standing and how close the camera
  // is — placement, not identity — and between them they carried more of
  // the vector's length than the gradients and colour combined.
  const trace = mxx + myy;
  const shape = trace > 1e-6
    ? [
        (mxx - myy) / trace,
        (2 * mxy) / trace,
        // Fourth moment against the square of the second: flat for a disc,
        // high for a subject with distant limbs.
        clamp(m4 / (trace * trace), 0, 4) / 4,
        // How densely the support fills its own window.
        clamp01(mass / Math.max(1, 4 * extent * extent)),
      ]
    : [0, 0, 0, 0];

  const vec = [
    ...scaleBlock(l2hys(hog), IDENTITY_BLOCK_WEIGHTS.structure),
    ...scaleBlock(l2(l1(colour, colourMass)), IDENTITY_BLOCK_WEIGHTS.colour),
    ...scaleBlock(l2(shape), IDENTITY_BLOCK_WEIGHTS.shape),
  ];
  return l2(vec);
}

function scaleBlock(v: readonly number[], weight: number): number[] {
  return v.map((x) => x * weight);
}

/**
 * L2-Hys: normalise, clip, renormalise. The clip stops one very strong
 * edge — a black outline against paper — from swamping every softer
 * gradient in the same cell.
 */
function l2hys(v: readonly number[], clip = 0.2): number[] {
  const n = l2(v);
  return l2(n.map((x) => Math.min(x, clip)));
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
