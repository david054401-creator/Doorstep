/**
 * Image buffers. Premultiplied-alpha RGBA in linear-ish 8-bit, plus the
 * derived views (luminance, alpha, edge) that the perceptual critics read.
 */

import type { RGB, RGBA } from '../core/color.ts';
import { clamp, clamp01 } from '../core/math.ts';
import { relativeLuminance, rgbToLab, srgbToLinear, linearToSrgb } from '../core/color.ts';

export type ImageBuffer = {
  width: number;
  height: number;
  /** RGBA, straight (non-premultiplied) alpha, 0..255, row-major. */
  data: Uint8ClampedArray;
};

export function createImage(width: number, height: number, fill?: RGBA): ImageBuffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    const r = clamp(fill.r, 0, 255);
    const g = clamp(fill.g, 0, 255);
    const b = clamp(fill.b, 0, 255);
    const a = clamp01(fill.a) * 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

export function cloneImage(img: ImageBuffer): ImageBuffer {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export const idx = (img: ImageBuffer, x: number, y: number): number =>
  (y * img.width + x) * 4;

export function getPixel(img: ImageBuffer, x: number, y: number): RGBA {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return { r: 0, g: 0, b: 0, a: 0 };
  const i = idx(img, x, y);
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: img.data[i + 3] / 255 };
}

export function setPixel(img: ImageBuffer, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = idx(img, x, y);
  img.data[i] = c.r;
  img.data[i + 1] = c.g;
  img.data[i + 2] = c.b;
  img.data[i + 3] = clamp01(c.a) * 255;
}

/** Source-over composite of one pixel, done in linear light. */
export function blendPixel(img: ImageBuffer, x: number, y: number, c: RGB, alpha: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const a = clamp01(alpha);
  if (a <= 0) return;
  const i = idx(img, x, y);
  const da = img.data[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) {
    img.data[i + 3] = 0;
    return;
  }
  const mix = (src: number, dst: number): number =>
    linearToSrgb((srgbToLinear(src) * a + srgbToLinear(dst) * da * (1 - a)) / outA);
  img.data[i] = mix(c.r, img.data[i]);
  img.data[i + 1] = mix(c.g, img.data[i + 1]);
  img.data[i + 2] = mix(c.b, img.data[i + 2]);
  img.data[i + 3] = outA * 255;
}

/** Bilinear sample with clamped edges, coordinates in pixels. */
export function sampleBilinear(img: ImageBuffer, x: number, y: number): RGBA {
  const fx = clamp(x, 0, img.width - 1);
  const fy = clamp(y, 0, img.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const p00 = getPixel(img, x0, y0);
  const p10 = getPixel(img, x1, y0);
  const p01 = getPixel(img, x0, y1);
  const p11 = getPixel(img, x1, y1);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return {
    r: l(l(p00.r, p10.r, tx), l(p01.r, p11.r, tx), ty),
    g: l(l(p00.g, p10.g, tx), l(p01.g, p11.g, tx), ty),
    b: l(l(p00.b, p10.b, tx), l(p01.b, p11.b, tx), ty),
    a: l(l(p00.a, p10.a, tx), l(p01.a, p11.a, tx), ty),
  };
}

/** Per-pixel relative luminance, 0..1. */
export function luminanceMap(img: ImageBuffer): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = relativeLuminance({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] });
  }
  return out;
}

/** Per-pixel L* (CIE lightness 0..100). Contrast rules are stated in L*. */
export function lightnessMap(img: ImageBuffer): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = rgbToLab({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }).L;
  }
  return out;
}

export function alphaMap(img: ImageBuffer): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let p = 0, i = 3; p < out.length; p++, i += 4) out[p] = img.data[i] / 255;
  return out;
}

/**
 * Edge magnitude over luminance, normalised 0..1.
 *
 * Sobel alone is blind to one-pixel alternation: on a stripe pattern the
 * two neighbours either side are identical, the symmetric kernel cancels,
 * and the busiest image the engine will ever see measures as perfectly
 * flat. Since high-frequency texture is precisely the tell this measure
 * exists to catch — a generated background that dissolves into noise —
 * the forward difference is taken as well and the larger response wins.
 */
export function edgeMap(img: ImageBuffer): Float32Array {
  const lum = luminanceMap(img);
  const { width: w, height: h } = img;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1];
      const t = lum[i - w];
      const tr = lum[i - w + 1];
      const l = lum[i - 1];
      const r = lum[i + 1];
      const bl = lum[i + w - 1];
      const b = lum[i + w];
      const br = lum[i + w + 1];
      const gx = tl + 2 * l + bl - (tr + 2 * r + br);
      const gy = tl + 2 * t + tr - (bl + 2 * b + br);
      const sobel = Math.hypot(gx, gy) / 4;
      const forward = Math.hypot(lum[i] - r, lum[i] - b);
      out[i] = Math.min(1, Math.max(sobel, forward));
    }
  }
  return out;
}

/** Mean edge magnitude over a region — the "busy background" measure. */
export function edgeDensity(
  img: ImageBuffer,
  region?: { x: number; y: number; w: number; h: number },
): number {
  const e = edgeMap(img);
  const r = region ?? { x: 0, y: 0, w: img.width, h: img.height };
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w));
  const y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += e[y * img.width + x];
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Threshold alpha into a binary silhouette mask. */
export function silhouetteMask(img: ImageBuffer, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let p = 0, i = 3; p < out.length; p++, i += 4) {
    out[p] = img.data[i] / 255 >= threshold ? 1 : 0;
  }
  return out;
}

/** Render a mask as a black-on-white image — what the silhouette critic sees. */
export function maskToImage(mask: Uint8Array, width: number, height: number): ImageBuffer {
  const img = createImage(width, height, { r: 255, g: 255, b: 255, a: 1 });
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    img.data[i] = 0;
    img.data[i + 1] = 0;
    img.data[i + 2] = 0;
    img.data[i + 3] = 255;
  }
  return img;
}

export function maskArea(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

export function maskBounds(
  mask: Uint8Array,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/** Connected components on a binary mask (4-connectivity). */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { count: number; labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const label = count++;
    let size = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && mask[p - 1] && labels[p - 1] < 0) {
        labels[p - 1] = label;
        stack.push(p - 1);
      }
      if (x < width - 1 && mask[p + 1] && labels[p + 1] < 0) {
        labels[p + 1] = label;
        stack.push(p + 1);
      }
      if (y > 0 && mask[p - width] && labels[p - width] < 0) {
        labels[p - width] = label;
        stack.push(p - width);
      }
      if (y < height - 1 && mask[p + width] && labels[p + width] < 0) {
        labels[p + width] = label;
        stack.push(p + width);
      }
    }
    sizes.push(size);
  }
  return { count, labels, sizes };
}

/** Downscale by an integer factor with box averaging. */
export function downsample(img: ImageBuffer, factor: number): ImageBuffer {
  const f = Math.max(1, Math.round(factor));
  if (f === 1) return cloneImage(img);
  const w = Math.max(1, Math.floor(img.width / f));
  const h = Math.max(1, Math.floor(img.height / f));
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          const sy = y * f + dy;
          if (sx >= img.width || sy >= img.height) continue;
          const i = idx(img, sx, sy);
          const pa = img.data[i + 3] / 255;
          r += srgbToLinear(img.data[i]) * pa;
          g += srgbToLinear(img.data[i + 1]) * pa;
          b += srgbToLinear(img.data[i + 2]) * pa;
          a += pa;
          n++;
        }
      }
      if (n === 0) continue;
      const o = idx(out, x, y);
      const aa = a / n;
      if (aa > 1e-6) {
        out.data[o] = linearToSrgb(r / n / aa);
        out.data[o + 1] = linearToSrgb(g / n / aa);
        out.data[o + 2] = linearToSrgb(b / n / aa);
      }
      out.data[o + 3] = aa * 255;
    }
  }
  return out;
}

/** Resize to exact dimensions with bilinear sampling. */
export function resize(img: ImageBuffer, width: number, height: number): ImageBuffer {
  const out = createImage(width, height);
  const sx = img.width / out.width;
  const sy = img.height / out.height;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const c = sampleBilinear(img, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
      setPixel(out, x, y, c);
    }
  }
  return out;
}

/** Flatten onto an opaque background — needed before most metrics. */
export function flatten(img: ImageBuffer, bg: RGB = { r: 255, g: 255, b: 255 }): ImageBuffer {
  const out = createImage(img.width, img.height, { ...bg, a: 1 });
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    if (a <= 0) continue;
    const mix = (s: number, d: number) => linearToSrgb(srgbToLinear(s) * a + srgbToLinear(d) * (1 - a));
    out.data[i] = mix(img.data[i], out.data[i]);
    out.data[i + 1] = mix(img.data[i + 1], out.data[i + 1]);
    out.data[i + 2] = mix(img.data[i + 2], out.data[i + 2]);
    out.data[i + 3] = 255;
  }
  return out;
}

/** Paste `src` into `dst` at an offset with source-over blending. */
export function paste(dst: ImageBuffer, src: ImageBuffer, x0: number, y0: number, opacity = 1): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.width) continue;
      const i = idx(src, x, y);
      const a = (src.data[i + 3] / 255) * opacity;
      if (a <= 0) continue;
      blendPixel(dst, dx, dy, { r: src.data[i], g: src.data[i + 1], b: src.data[i + 2] }, a);
    }
  }
}
