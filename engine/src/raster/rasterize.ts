/**
 * Deterministic anti-aliased 2D rasteriser.
 *
 * Design law 6: the rig render is the baseline, and the baseline must be
 * deterministic. Same graph in, byte-identical pixels out, on any machine,
 * with no GPU and no external binary. That is what this file buys.
 *
 * Coverage is computed by analytic scanline accumulation over NxN sub-samples
 * per pixel row, which is exact enough that a 1px line never shimmers.
 */

import type { Vec2, Mat2D } from '../core/math.ts';
import { mapply, clamp, clamp01 } from '../core/math.ts';
import type { RGB } from '../core/color.ts';
import type { ImageBuffer } from './buffer.ts';
import { blendPixel } from './buffer.ts';

export type FillRule = 'nonzero' | 'evenodd';

export type FillStyle = {
  color: RGB;
  alpha?: number;
  rule?: FillRule;
};

export type StrokeStyle = {
  color: RGB;
  width: number;
  alpha?: number;
  /** Line caps matter for tapered cartoon linework. */
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
};

/** Sub-scanlines per pixel row. 4 is visually clean; 8 for final renders. */
export const DEFAULT_SAMPLES = 4;

type Edge = { x0: number; y0: number; x1: number; y1: number; dir: number };

function buildEdges(contours: readonly (readonly Vec2[])[], transform?: Mat2D): Edge[] {
  const edges: Edge[] = [];
  for (const contour of contours) {
    if (contour.length < 2) continue;
    const pts = transform ? contour.map((p) => mapply(transform, p)) : contour;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y === b.y) continue; // horizontal edges contribute nothing
      edges.push(
        a.y < b.y
          ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: 1 }
          : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, dir: -1 },
      );
    }
  }
  return edges;
}

/**
 * Fill a set of closed contours. Coverage per pixel is accumulated from
 * `samples` sub-scanlines, each of which contributes exact horizontal span
 * coverage — so horizontal edges are perfectly smooth and vertical edges get
 * `samples` levels of gradation.
 */
export function fillContours(
  img: ImageBuffer,
  contours: readonly (readonly Vec2[])[],
  style: FillStyle,
  transform?: Mat2D,
  samples: number = DEFAULT_SAMPLES,
): void {
  const edges = buildEdges(contours, transform);
  if (edges.length === 0) return;
  const rule = style.rule ?? 'nonzero';
  const alpha = style.alpha ?? 1;
  if (alpha <= 0) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    if (e.y0 < minY) minY = e.y0;
    if (e.y1 > maxY) maxY = e.y1;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(img.height - 1, Math.ceil(maxY));
  if (yEnd < yStart) return;

  const coverage = new Float32Array(img.width);
  const xs: { x: number; dir: number }[] = [];

  for (let py = yStart; py <= yEnd; py++) {
    coverage.fill(0);
    let touched = false;
    for (let s = 0; s < samples; s++) {
      const sy = py + (s + 0.5) / samples;
      xs.length = 0;
      for (const e of edges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        const t = (sy - e.y0) / (e.y1 - e.y0);
        xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);

      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += rule === 'nonzero' ? xs[i].dir : 1;
        const inside = rule === 'nonzero' ? winding !== 0 : winding % 2 !== 0;
        if (!inside) continue;
        const spanStart = xs[i].x;
        const spanEnd = xs[i + 1].x;
        if (spanEnd <= 0 || spanStart >= img.width) continue;
        touched = true;
        addSpan(coverage, spanStart, spanEnd, 1 / samples, img.width);
      }
    }
    if (!touched) continue;
    for (let px = 0; px < img.width; px++) {
      const c = coverage[px];
      if (c <= 0.0005) continue;
      blendPixel(img, px, py, style.color, clamp01(c) * alpha);
    }
  }
}

/** Accumulate exact horizontal coverage of [x0,x1) into a scanline. */
function addSpan(
  coverage: Float32Array,
  x0: number,
  x1: number,
  weight: number,
  width: number,
): void {
  const a = clamp(x0, 0, width);
  const b = clamp(x1, 0, width);
  if (b <= a) return;
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  if (ia === ib) {
    if (ia >= 0 && ia < width) coverage[ia] += (b - a) * weight;
    return;
  }
  if (ia >= 0 && ia < width) coverage[ia] += (ia + 1 - a) * weight;
  for (let i = ia + 1; i < ib; i++) {
    if (i >= 0 && i < width) coverage[i] += weight;
  }
  if (ib >= 0 && ib < width) coverage[ib] += (b - ib) * weight;
}

/**
 * Stroke a polyline by expanding it into a filled quad per segment plus a
 * join disc at every interior vertex. Simple, robust, and matches how cel
 * linework actually reads — no miter spikes on tight elbows.
 */
export function strokePolyline(
  img: ImageBuffer,
  points: readonly Vec2[],
  style: StrokeStyle,
  closed = false,
  transform?: Mat2D,
  samples: number = DEFAULT_SAMPLES,
): void {
  if (points.length < 2 || style.width <= 0) return;
  const pts = transform ? points.map((p) => mapply(transform, p)) : [...points];
  const half = style.width / 2;
  const alpha = style.alpha ?? 1;
  const segs = closed ? pts.length : pts.length - 1;

  const quads: Vec2[][] = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    if (style.cap === 'square' && !closed) {
      const ex = (dx / len) * half;
      const ey = (dy / len) * half;
      if (i === 0) {
        ax -= ex;
        ay -= ey;
      }
      if (i === segs - 1) {
        bx += ex;
        by += ey;
      }
    }
    quads.push([
      { x: ax + nx, y: ay + ny },
      { x: bx + nx, y: by + ny },
      { x: bx - nx, y: by - ny },
      { x: ax - nx, y: ay - ny },
    ]);
  }

  // Joins and round caps: a disc at each relevant vertex.
  const joinFrom = closed ? 0 : 1;
  const joinTo = closed ? pts.length : pts.length - 1;
  const discs: Vec2[][] = [];
  const roundJoin = (style.join ?? 'round') === 'round';
  if (roundJoin && half > 0.35) {
    for (let i = joinFrom; i < joinTo; i++) discs.push(circle(pts[i], half, 12));
  }
  if (!closed && style.cap === 'round' && half > 0.35) {
    discs.push(circle(pts[0], half, 12));
    discs.push(circle(pts[pts.length - 1], half, 12));
  }

  // Fill each piece separately with nonzero so overlaps do not cancel, but
  // draw them into one coverage pass to avoid double-darkening at joins.
  fillDisjoint(img, [...quads, ...discs], { color: style.color, alpha }, samples);
}

function circle(c: Vec2, r: number, segments: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * Fill a set of overlapping shapes as their union: coverage is maxed rather
 * than summed, so a stroke does not go double-opaque where segments meet.
 */
export function fillDisjoint(
  img: ImageBuffer,
  shapes: readonly (readonly Vec2[])[],
  style: FillStyle,
  samples: number = DEFAULT_SAMPLES,
): void {
  if (shapes.length === 0) return;
  const alpha = style.alpha ?? 1;
  if (alpha <= 0) return;

  let minY = Infinity;
  let maxY = -Infinity;
  const edgeSets = shapes.map((s) => buildEdges([s]));
  for (const es of edgeSets) {
    for (const e of es) {
      if (e.y0 < minY) minY = e.y0;
      if (e.y1 > maxY) maxY = e.y1;
    }
  }
  if (!Number.isFinite(minY)) return;
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(img.height - 1, Math.ceil(maxY));

  const total = new Float32Array(img.width);
  const one = new Float32Array(img.width);
  const xs: { x: number; dir: number }[] = [];

  for (let py = yStart; py <= yEnd; py++) {
    total.fill(0);
    let touched = false;
    for (const es of edgeSets) {
      if (es.length === 0) continue;
      one.fill(0);
      let any = false;
      for (let s = 0; s < samples; s++) {
        const sy = py + (s + 0.5) / samples;
        xs.length = 0;
        for (const e of es) {
          if (sy < e.y0 || sy >= e.y1) continue;
          const t = (sy - e.y0) / (e.y1 - e.y0);
          xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.dir });
        }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a.x - b.x);
        let winding = 0;
        for (let i = 0; i < xs.length - 1; i++) {
          winding += xs[i].dir;
          if (winding === 0) continue;
          any = true;
          addSpan(one, xs[i].x, xs[i + 1].x, 1 / samples, img.width);
        }
      }
      if (!any) continue;
      touched = true;
      for (let px = 0; px < img.width; px++) {
        if (one[px] > total[px]) total[px] = one[px];
      }
    }
    if (!touched) continue;
    for (let px = 0; px < img.width; px++) {
      const c = total[px];
      if (c <= 0.0005) continue;
      blendPixel(img, px, py, style.color, clamp01(c) * alpha);
    }
  }
}

/**
 * Rasterise contours into a binary/coverage mask instead of colour. This is
 * how part masks, silhouettes and region maps are produced for validators.
 */
export function rasterizeMask(
  contours: readonly (readonly Vec2[])[],
  width: number,
  height: number,
  transform?: Mat2D,
  samples: number = DEFAULT_SAMPLES,
): Float32Array {
  const out = new Float32Array(width * height);
  const edges = buildEdges(contours, transform);
  if (edges.length === 0) return out;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    if (e.y0 < minY) minY = e.y0;
    if (e.y1 > maxY) maxY = e.y1;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(height - 1, Math.ceil(maxY));
  const coverage = new Float32Array(width);
  const xs: { x: number; dir: number }[] = [];
  for (let py = yStart; py <= yEnd; py++) {
    coverage.fill(0);
    for (let s = 0; s < samples; s++) {
      const sy = py + (s + 0.5) / samples;
      xs.length = 0;
      for (const e of edges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        const t = (sy - e.y0) / (e.y1 - e.y0);
        xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += xs[i].dir;
        if (winding === 0) continue;
        addSpan(coverage, xs[i].x, xs[i + 1].x, 1 / samples, width);
      }
    }
    const row = py * width;
    for (let px = 0; px < width; px++) {
      const c = coverage[px];
      if (c > 0) out[row + px] = Math.min(1, c);
    }
  }
  return out;
}

export function coverageToMask(coverage: Float32Array, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i++) out[i] = coverage[i] >= threshold ? 1 : 0;
  return out;
}

/** Fill an axis-aligned rectangle. */
export function fillRect(
  img: ImageBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  alpha = 1,
): void {
  fillContours(
    img,
    [
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    ],
    { color, alpha },
  );
}
