/**
 * Colour science. The palette-conformance and value-structure validators are
 * only meaningful if these are the real formulas, so they are: sRGB transfer
 * function, CIEXYZ D65, CIELAB, and the full CIEDE2000 difference.
 */

import { clamp, clamp01 } from './math.ts';

export type RGB = { r: number; g: number; b: number }; // 0..255
export type RGBA = { r: number; g: number; b: number; a: number }; // a: 0..1
export type Lab = { L: number; a: number; b: number };
export type HSL = { h: number; s: number; l: number };

export type NamedSwatch = {
  name: string;
  hex: string;
  /** What this swatch is for, e.g. "MIBO body base", "shadow on skin". */
  role: string;
  /** Tolerance in CIEDE2000 units for conformance checks. */
  tolerance?: number;
};

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHex(hex: string): RGBA {
  const m = HEX_RE.exec(hex.trim());
  if (!m) throw new Error(`invalid hex colour: ${JSON.stringify(hex)}`);
  const h = m[1];
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1,
    };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

export function toHex(c: RGB | RGBA): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex.trim());
}

/** sRGB 0..255 -> linear 0..1 */
export function srgbToLinear(c: number): number {
  const v = clamp01(c / 255);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** linear 0..1 -> sRGB 0..255 */
export function linearToSrgb(v: number): number {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return clamp(s * 255, 0, 255);
}

/** Relative luminance (WCAG / BT.709 coefficients on linear light). */
export function relativeLuminance(c: RGB): number {
  return (
    0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b)
  );
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

export function rgbToXyz(c: RGB): { X: number; Y: number; Z: number } {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  return {
    X: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    Y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    Z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

const labF = (t: number): number =>
  t > 0.008856451679035631 ? Math.cbrt(t) : 7.787037037037035 * t + 16 / 116;

export function rgbToLab(c: RGB): Lab {
  const { X, Y, Z } = rgbToXyz(c);
  const fx = labF(X / XN);
  const fy = labF(Y / YN);
  const fz = labF(Z / ZN);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(lab: Lab): RGB {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const fInv = (t: number) => (t ** 3 > 0.008856451679035631 ? t ** 3 : (t - 16 / 116) / 7.787037037037035);
  const X = XN * fInv(fx);
  const Y = YN * fInv(fy);
  const Z = ZN * fInv(fz);
  const r = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const g = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  const b = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

/** L* of a colour, i.e. perceptual lightness 0..100. Used by contrast checks. */
export const lightness = (c: RGB): number => rgbToLab(c).L;

/**
 * CIEDE2000 colour difference. This is the number the ink-and-paint gate and
 * the palette-conformance gate are specified against (ΔE <= 3).
 */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.hypot(c1.a, c1.b);
  const C2 = Math.hypot(c2.a, c2.b);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));

  const a1p = (1 + G) * c1.a;
  const a2p = (1 + G) * c2.a;
  const C1p = Math.hypot(a1p, c1.b);
  const C2p = Math.hypot(a2p, c2.b);

  const h = (ap: number, bp: number): number => {
    if (Math.abs(ap) < 1e-12 && Math.abs(bp) < 1e-12) return 0;
    const deg = (Math.atan2(bp, ap) * 180) / Math.PI;
    return deg >= 0 ? deg : deg + 360;
  };
  const h1p = h(a1p, c1.b);
  const h2p = h(a2p, c2.b);

  const dLp = c2.L - c1.L;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p < 1e-12) dhp = 0;
  else {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbarp = (c1.L + c2.L) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p < 1e-12) hbarp = h1p + h2p;
  else {
    const diff = Math.abs(h1p - h2p);
    const sum = h1p + h2p;
    if (diff <= 180) hbarp = sum / 2;
    else if (sum < 360) hbarp = (sum + 360) / 2;
    else hbarp = (sum - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;

  const tL = dLp / (kL * Sl);
  const tC = dCp / (kC * Sc);
  const tH = dHp / (kH * Sh);
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

export function deltaERgb(a: RGB, b: RGB): number {
  return deltaE2000(rgbToLab(a), rgbToLab(b));
}

export function rgbToHsl(c: RGB): HSL {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(hsl: HSL): RGB {
  const h = ((hsl.h % 360) + 360) % 360 / 360;
  const s = clamp01(hsl.s);
  const l = clamp01(hsl.l);
  if (s < 1e-9) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/** Nearest swatch in a palette, by ΔE2000. */
export function nearestSwatch(
  c: RGB,
  palette: readonly NamedSwatch[],
): { swatch: NamedSwatch; deltaE: number } | null {
  if (palette.length === 0) return null;
  const lab = rgbToLab(c);
  let best = palette[0];
  let bestD = Infinity;
  for (const s of palette) {
    const d = deltaE2000(lab, rgbToLab(parseHex(s.hex)));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { swatch: best, deltaE: bestD };
}

/** Shade a base colour toward a light/shadow key — the two-tone cel rule. */
export function shade(base: RGB, amount: number): RGB {
  const lab = rgbToLab(base);
  return labToRgb({
    L: clamp(lab.L + amount * 100, 0, 100),
    a: lab.a * (1 - Math.abs(amount) * 0.15),
    b: lab.b * (1 - Math.abs(amount) * 0.15),
  });
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  // Mix in linear light, which is the physically correct thing to do and
  // avoids the muddy midpoints you get mixing in gamma space.
  const f = clamp01(t);
  const l = (x: number, y: number) => linearToSrgb(srgbToLinear(x) * (1 - f) + srgbToLinear(y) * f);
  return { r: l(a.r, b.r), g: l(a.g, b.g), b: l(a.b, b.b) };
}
