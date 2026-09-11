/**
 * Post filters: blur, grade, grain, vignette, glow, curves.
 * All deterministic; grain draws from a seeded RNG, never Math.random.
 */

import type { ImageBuffer } from './buffer.ts';
import { createImage, cloneImage, idx } from './buffer.ts';
import { clamp, clamp01 } from '../core/math.ts';
import { parseHex, srgbToLinear, linearToSrgb, rgbToHsl, hslToRgb } from '../core/color.ts';
import type { Rng } from '../core/rng.ts';

/**
 * Three-pass box blur, which converges on a true Gaussian and is O(n) in
 * radius. Used for depth-of-field on background planes and for the glow pass.
 */
export function blur(img: ImageBuffer, radius: number): ImageBuffer {
  if (radius <= 0.01) return cloneImage(img);
  const boxes = boxesForGauss(radius, 3);
  let out = cloneImage(img);
  for (const b of boxes) {
    out = boxBlur(out, Math.max(0, Math.floor((b - 1) / 2)));
  }
  return out;
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlur(img: ImageBuffer, r: number): ImageBuffer {
  if (r <= 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const tmp = createImage(w, h);
  const out = createImage(w, h);
  // Horizontal pass, on premultiplied values so edges do not bleed colour.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const sx = clamp(x + k, 0, w - 1);
        const i = idx(img, sx, y);
        const a = img.data[i + 3] / 255;
        cr += img.data[i] * a;
        cg += img.data[i + 1] * a;
        cb += img.data[i + 2] * a;
        ca += a;
        n++;
      }
      const o = idx(tmp, x, y);
      const am = ca / n;
      tmp.data[o] = am > 1e-6 ? cr / n / am : 0;
      tmp.data[o + 1] = am > 1e-6 ? cg / n / am : 0;
      tmp.data[o + 2] = am > 1e-6 ? cb / n / am : 0;
      tmp.data[o + 3] = am * 255;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const sy = clamp(y + k, 0, h - 1);
        const i = idx(tmp, x, sy);
        const a = tmp.data[i + 3] / 255;
        cr += tmp.data[i] * a;
        cg += tmp.data[i + 1] * a;
        cb += tmp.data[i + 2] * a;
        ca += a;
        n++;
      }
      const o = idx(out, x, y);
      const am = ca / n;
      out.data[o] = am > 1e-6 ? cr / n / am : 0;
      out.data[o + 1] = am > 1e-6 ? cg / n / am : 0;
      out.data[o + 2] = am > 1e-6 ? cb / n / am : 0;
      out.data[o + 3] = am * 255;
    }
  }
  return out;
}

export type Grade = {
  lift: number;
  gamma: number;
  gain: number;
  saturation: number;
  tint?: string;
  tintAmount?: number;
};

/** Lift/gamma/gain in linear light, saturation in HSL, tint toward a swatch. */
export function grade(img: ImageBuffer, g: Grade): ImageBuffer {
  const out = cloneImage(img);
  const tint = g.tint ? parseHex(g.tint) : null;
  const ta = clamp01(g.tintAmount ?? 0);
  const gamma = Math.max(0.05, g.gamma);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    let r = srgbToLinear(out.data[i]);
    let gr = srgbToLinear(out.data[i + 1]);
    let b = srgbToLinear(out.data[i + 2]);
    const apply = (v: number) => clamp01((v * g.gain + g.lift) ** (1 / gamma));
    r = apply(r);
    gr = apply(gr);
    b = apply(b);
    let R = linearToSrgb(r);
    let G = linearToSrgb(gr);
    let B = linearToSrgb(b);
    if (Math.abs(g.saturation - 1) > 1e-6) {
      const hsl = rgbToHsl({ r: R, g: G, b: B });
      const sat = hslToRgb({ ...hsl, s: clamp01(hsl.s * g.saturation) });
      R = sat.r;
      G = sat.g;
      B = sat.b;
    }
    if (tint && ta > 0) {
      R = R * (1 - ta) + tint.r * ta;
      G = G * (1 - ta) + tint.g * ta;
      B = B * (1 - ta) + tint.b * ta;
    }
    out.data[i] = R;
    out.data[i + 1] = G;
    out.data[i + 2] = B;
  }
  return out;
}

/** Film grain. Luminance-weighted so it sits in the midtones, like real stock. */
export function grain(img: ImageBuffer, amount: number, size: number, rng: Rng): ImageBuffer {
  if (amount <= 0) return cloneImage(img);
  const out = cloneImage(img);
  const cell = Math.max(1, Math.round(size));
  const cols = Math.ceil(img.width / cell);
  const rows = Math.ceil(img.height / cell);
  const noise = new Float32Array(cols * rows);
  for (let i = 0; i < noise.length; i++) noise[i] = rng.gaussian(0, 1);
  for (let y = 0; y < img.height; y++) {
    const ny = Math.floor(y / cell) * cols;
    for (let x = 0; x < img.width; x++) {
      const i = idx(out, x, y);
      if (out.data[i + 3] === 0) continue;
      const n = noise[ny + Math.floor(x / cell)];
      const lum = (out.data[i] * 0.2126 + out.data[i + 1] * 0.7152 + out.data[i + 2] * 0.0722) / 255;
      // Peak response in the midtones.
      const weight = 4 * lum * (1 - lum);
      const d = n * amount * 255 * weight;
      out.data[i] = out.data[i] + d;
      out.data[i + 1] = out.data[i + 1] + d;
      out.data[i + 2] = out.data[i + 2] + d;
    }
  }
  return out;
}

export function vignette(img: ImageBuffer, amount: number, radius: number): ImageBuffer {
  if (amount <= 0) return cloneImage(img);
  const out = cloneImage(img);
  const cx = img.width / 2;
  const cy = img.height / 2;
  const maxR = Math.hypot(cx, cy);
  const r0 = clamp01(radius) * maxR;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r0) continue;
      const t = clamp01((d - r0) / Math.max(1e-6, maxR - r0));
      const f = 1 - amount * t * t;
      const i = idx(out, x, y);
      out.data[i] *= f;
      out.data[i + 1] *= f;
      out.data[i + 2] *= f;
    }
  }
  return out;
}

/** Bloom: threshold the highlights, blur, add back. */
export function glow(
  img: ImageBuffer,
  threshold: number,
  amount: number,
  radius: number,
): ImageBuffer {
  if (amount <= 0) return cloneImage(img);
  const bright = createImage(img.width, img.height);
  const th = clamp01(threshold);
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] * 0.2126 + img.data[i + 1] * 0.7152 + img.data[i + 2] * 0.0722) / 255;
    if (lum <= th) continue;
    const k = (lum - th) / Math.max(1e-6, 1 - th);
    bright.data[i] = img.data[i];
    bright.data[i + 1] = img.data[i + 1];
    bright.data[i + 2] = img.data[i + 2];
    bright.data[i + 3] = k * 255;
  }
  const blurred = blur(bright, radius);
  const out = cloneImage(img);
  for (let i = 0; i < out.data.length; i += 4) {
    const a = (blurred.data[i + 3] / 255) * amount;
    if (a <= 0) continue;
    out.data[i] = out.data[i] + blurred.data[i] * a;
    out.data[i + 1] = out.data[i + 1] + blurred.data[i + 1] * a;
    out.data[i + 2] = out.data[i + 2] + blurred.data[i + 2] * a;
  }
  return out;
}

/** Atmospheric haze toward a colour, scaled by depth. */
export function haze(img: ImageBuffer, color: string, amount: number): ImageBuffer {
  const a = clamp01(amount);
  if (a <= 0) return cloneImage(img);
  const c = parseHex(color);
  const out = cloneImage(img);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    out.data[i] = out.data[i] * (1 - a) + c.r * a;
    out.data[i + 1] = out.data[i + 1] * (1 - a) + c.g * a;
    out.data[i + 2] = out.data[i + 2] * (1 - a) + c.b * a;
  }
  return out;
}
