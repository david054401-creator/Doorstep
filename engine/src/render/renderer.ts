/**
 * Scene renderer. Deterministic, CPU-only, no external binaries.
 *
 * Everything the engine ships as a "baseline frame" comes out of here. The
 * organic pass (ToonCrafter-class models) must beat this at the gate or be
 * discarded — so this has to be genuinely good, not a placeholder.
 */

import type { Scene, DrawLayer, DrawShape } from './scene.ts';
import { sortedLayers, sortedShapes } from './scene.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { createImage, paste, createImage as newImage } from '../raster/buffer.ts';
import { fillContours, strokePolyline, rasterizeMask, coverageToMask } from '../raster/rasterize.ts';
import { blur as blurImage, haze as hazeFilter } from '../raster/filters.ts';
import { mapply } from '../core/math.ts';
import type { Vec2 } from '../core/math.ts';

export type RenderOptions = {
  /** Sub-scanline samples per pixel. 4 preview, 8 final. */
  samples?: number;
  /** Supersample factor; 2 gives a visibly cleaner line at 2x the cost. */
  supersample?: number;
  /** Resolve raster asset URIs to decoded buffers. */
  resolveImage?: (uri: string) => ImageBuffer | null;
  /** Render only this owner's shapes — used for per-character masks. */
  onlyOwner?: string;
  /** Skip background fill, producing an RGBA plate with real alpha. */
  transparent?: boolean;
};

export function renderScene(scene: Scene, options: RenderOptions = {}): ImageBuffer {
  const ss = Math.max(1, Math.round(options.supersample ?? 1));
  const samples = options.samples ?? 4;
  const w = scene.width * ss;
  const h = scene.height * ss;

  const canvas = options.transparent
    ? createImage(w, h)
    : createImage(w, h, { ...scene.background, a: 1 });

  const scaleWith = (m: typeof scene.camera) => (p: Vec2): Vec2 => {
    const c = mapply(m, p);
    return { x: c.x * ss, y: c.y * ss };
  };

  for (const layer of sortedLayers(scene)) {
    if (options.onlyOwner && layer.ownerId && layer.ownerId !== options.onlyOwner) continue;
    // A multiplane plane travels at its own rate and so carries its own
    // camera; everything else rides the scene camera.
    const scale = scaleWith(layer.camera ?? scene.camera);
    const needsOwnBuffer =
      (layer.blur ?? 0) > 0 || layer.opacity < 1 || layer.blend !== 'normal' || !!layer.haze;
    const target = needsOwnBuffer ? createImage(w, h) : canvas;
    drawLayer(target, layer, scale, samples, ss, options);
    if (needsOwnBuffer) {
      let composed = target;
      if (layer.haze) composed = hazeFilter(composed, layer.haze.color, layer.haze.amount);
      if ((layer.blur ?? 0) > 0) composed = blurImage(composed, (layer.blur ?? 0) * ss);
      compositeLayer(canvas, composed, layer.opacity, layer.blend);
    }
  }

  return ss === 1 ? canvas : downsampleBox(canvas, ss);
}

function drawLayer(
  img: ImageBuffer,
  layer: DrawLayer,
  scale: (p: Vec2) => Vec2,
  samples: number,
  ss: number,
  options: RenderOptions,
): void {
  // Images first within a layer, then vector shapes by z.
  const images = [...layer.images].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  for (const im of images) {
    if (options.onlyOwner && im.ownerId !== options.onlyOwner) continue;
    const src = options.resolveImage?.(im.uri);
    if (!src) continue;
    const p = scale({ x: im.transform.e, y: im.transform.f });
    const scaled =
      ss === 1 && Math.abs(im.transform.a - 1) < 1e-6 && Math.abs(im.transform.d - 1) < 1e-6
        ? src
        : resampleImage(src, Math.round(src.width * im.transform.a * ss), Math.round(src.height * im.transform.d * ss));
    const withBlur = (im.blur ?? 0) > 0 ? blurImage(scaled, (im.blur ?? 0) * ss) : scaled;
    paste(img, withBlur, Math.round(p.x), Math.round(p.y), im.opacity);
  }

  for (const shape of sortedShapes(layer)) {
    if (options.onlyOwner && shape.ownerId !== options.onlyOwner) continue;
    drawShape(img, shape, scale, samples, ss);
  }
}

function drawShape(
  img: ImageBuffer,
  shape: DrawShape,
  scale: (p: Vec2) => Vec2,
  samples: number,
  ss: number,
): void {
  const contours = shape.contours.map((c) => c.map(scale));
  if (shape.fill) {
    fillContours(img, contours, { color: shape.fill, alpha: shape.fillAlpha ?? 1 }, undefined, samples);
  }
  if (shape.shade && shape.shade.contours.length) {
    // Clip the shade to the fill so a cel shadow never leaks off the part.
    const shadeContours = shape.shade.contours.map((c) => c.map(scale));
    const fillMask = coverageToMask(rasterizeMask(contours, img.width, img.height, undefined, samples), 0.5);
    const shadePlate = newImage(img.width, img.height);
    fillContours(
      shadePlate,
      shadeContours,
      { color: shape.shade.color, alpha: shape.shade.alpha ?? 1 },
      undefined,
      samples,
    );
    for (let p = 0, i = 3; p < fillMask.length; p++, i += 4) {
      if (!fillMask[p]) shadePlate.data[i] = 0;
    }
    paste(img, shadePlate, 0, 0, 1);
  }
  if (shape.stroke && shape.stroke.width > 0) {
    for (const c of contours) {
      strokePolyline(
        img,
        c,
        {
          color: shape.stroke.color,
          width: shape.stroke.width * ss,
          alpha: shape.stroke.alpha ?? 1,
          join: 'round',
          cap: 'round',
        },
        true,
        undefined,
        samples,
      );
    }
  }
}

function compositeLayer(
  dst: ImageBuffer,
  src: ImageBuffer,
  opacity: number,
  blend: DrawLayer['blend'],
): void {
  if (blend === 'normal') {
    paste(dst, src, 0, 0, opacity);
    return;
  }
  for (let i = 0; i < dst.data.length; i += 4) {
    const sa = (src.data[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const s = src.data[i + k] / 255;
      const d = dst.data[i + k] / 255;
      let v: number;
      switch (blend) {
        case 'multiply':
          v = s * d;
          break;
        case 'screen':
          v = 1 - (1 - s) * (1 - d);
          break;
        case 'add':
          v = Math.min(1, s + d);
          break;
        case 'overlay':
          v = d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
          break;
        default:
          v = s;
      }
      dst.data[i + k] = (d * (1 - sa) + v * sa) * 255;
    }
    dst.data[i + 3] = Math.max(dst.data[i + 3], sa * 255);
  }
}

function downsampleBox(img: ImageBuffer, f: number): ImageBuffer {
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * img.width + (x * f + dx)) * 4;
          const pa = img.data[i + 3] / 255;
          r += img.data[i] * pa;
          g += img.data[i + 1] * pa;
          b += img.data[i + 2] * pa;
          a += pa;
        }
      }
      const n = f * f;
      const o = (y * w + x) * 4;
      const am = a / n;
      if (am > 1e-6) {
        out.data[o] = r / n / am;
        out.data[o + 1] = g / n / am;
        out.data[o + 2] = b / n / am;
      }
      out.data[o + 3] = am * 255;
    }
  }
  return out;
}

function resampleImage(src: ImageBuffer, w: number, h: number): ImageBuffer {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  const out = createImage(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const syi = Math.min(src.height - 1, Math.floor(y * sy));
    for (let x = 0; x < width; x++) {
      const sxi = Math.min(src.width - 1, Math.floor(x * sx));
      const si = (syi * src.width + sxi) * 4;
      const oi = (y * width + x) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = src.data[si + 3];
    }
  }
  return out;
}

/**
 * Render only a character's silhouette as a binary mask. The staging and
 * appeal validators, and the VLM silhouette test, all read this.
 */
export function renderSilhouette(scene: Scene, ownerId: string, samples = 4): Uint8Array {
  const img = renderScene(scene, { onlyOwner: ownerId, transparent: true, samples });
  const mask = new Uint8Array(img.width * img.height);
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) mask[p] = img.data[i] > 127 ? 1 : 0;
  return mask;
}

/** Render one character alone on transparency — the per-character plate. */
export function renderCharacterPlate(scene: Scene, ownerId: string, options: RenderOptions = {}): ImageBuffer {
  return renderScene(scene, { ...options, onlyOwner: ownerId, transparent: true });
}
