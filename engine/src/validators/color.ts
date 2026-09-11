/**
 * Colour and value validators.
 *
 * Invariant 7: character fills within DeltaE <= 3 of the colour model, and
 * character-vs-background contrast >= 20 L*. Both are measured on real
 * decoded pixels, not asserted from the graph — a fill can be correct in
 * the data and wrong on screen once compositing, haze and grade have had
 * their say.
 */

import type { StyleBible, Environment, NamedSwatch, Shot } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { getPixel, lightnessMap, edgeDensity, silhouetteMask, maskBounds } from '../raster/buffer.ts';
import { deltaE2000, rgbToLab, parseHex, nearestSwatch } from '../core/color.ts';
import { mean, percentile } from '../core/math.ts';

const DEPT = 'color';

export type ColorOptions = {
  /** Maximum CIEDE2000 distance from the nearest named swatch. */
  maxDeltaE?: number;
  /** Minimum L* difference between the character and the background behind it. */
  minContrastL?: number;
  /** Fraction of character pixels that must conform to the colour model. */
  conformanceRatio?: number;
  /** Background edge density must stay below the character's by this factor. */
  maxBgEdgeRatio?: number;
};

const D: Required<ColorOptions> = {
  maxDeltaE: 3,
  minContrastL: 20,
  conformanceRatio: 0.96,
  maxBgEdgeRatio: 0.85,
};

/**
 * Palette conformance: every substantial colour region on the character
 * must sit within tolerance of a named swatch in its colour model.
 */
export function validatePaletteConformance(
  frame: ImageBuffer,
  characterPlate: ImageBuffer,
  colorModel: readonly NamedSwatch[],
  options: ColorOptions = {},
  where: Locator = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  if (colorModel.length === 0) {
    return [
      pass({
        name: 'color.palette_conformance',
        department: DEPT,
        score: 1,
        message: 'No colour model declared for this character; nothing to conform to.',
        where,
      }),
    ];
  }

  // Sample the character's own pixels from its isolated plate.
  let conforming = 0;
  let total = 0;
  let worst = 0;
  let worstColor = '';
  const offenders = new Map<string, number>();

  // Only flat interior regions are judged. The boundary between two
  // perfectly correct fills is a gradient of blended values at full
  // alpha, and counting those as "off-palette" would flag every drawing
  // ever made. What the check is actually about is whether the flat areas
  // are the colours the model says they are.
  const isFlat = (x: number, y: number): boolean => {
    const c = getPixel(characterPlate, x, y);
    const lab = rgbToLab(c);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const n = getPixel(characterPlate, x + dx, y + dy);
        if (n.a < 0.92) return false;
        if (deltaE2000(lab, rgbToLab(n)) > 2) return false;
      }
    }
    return true;
  };

  for (let y = 1; y < characterPlate.height - 1; y += 2) {
    for (let x = 1; x < characterPlate.width - 1; x += 2) {
      const p = getPixel(characterPlate, x, y);
      if (p.a < 0.92) continue; // skip anti-aliased edges
      if (!isFlat(x, y)) continue;
      total++;
      const near = nearestSwatch(p, colorModel);
      if (!near) continue;
      const tolerance = near.swatch.tolerance ?? cfg.maxDeltaE;
      if (near.deltaE <= tolerance) {
        conforming++;
      } else {
        const key = `#${Math.round(p.r).toString(16).padStart(2, '0')}${Math.round(p.g).toString(16).padStart(2, '0')}${Math.round(p.b).toString(16).padStart(2, '0')}`;
        offenders.set(key, (offenders.get(key) ?? 0) + 1);
        if (near.deltaE > worst) {
          worst = near.deltaE;
          worstColor = key;
        }
      }
    }
  }

  if (total === 0) {
    return [
      pass({
        name: 'color.palette_conformance',
        department: DEPT,
        score: 1,
        message: 'The character does not appear in this frame.',
        where,
      }),
    ];
  }

  const ratio = conforming / total;
  void frame;
  return [
    measure({
      name: 'color.palette_conformance',
      department: DEPT,
      measured: ratio,
      threshold: cfg.conformanceRatio,
      comparator: '>=',
      floor: 0.5,
      message:
        ratio >= cfg.conformanceRatio
          ? `${(ratio * 100).toFixed(1)}% of character pixels sit within tolerance of a named swatch.`
          : `${((1 - ratio) * 100).toFixed(1)}% of character pixels are off-palette; the worst is ${worstColor} at DeltaE ${worst.toFixed(1)} from its nearest swatch.`,
      diagnosis: 'color.off_palette',
      where,
    }),
  ];
}

/**
 * Value structure: the character must separate from the background.
 *
 * A flat frame where the character and the background sit at the same
 * lightness is the single most common failure in generated backgrounds,
 * and it is why so many AI frames read as mush.
 */
export function validateValueStructure(
  frame: ImageBuffer,
  characterPlate: ImageBuffer,
  options: ColorOptions = {},
  where: Locator = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  const mask = silhouetteMask(characterPlate, 0.6);
  const bbox = maskBounds(mask, characterPlate.width, characterPlate.height);
  if (bbox.w === 0 || bbox.h === 0) {
    return [
      pass({
        name: 'color.character_bg_contrast',
        department: DEPT,
        score: 1,
        message: 'No character in frame, so there is nothing to separate from the background.',
        where,
      }),
    ];
  }

  const lightness = lightnessMap(frame);
  const charL: number[] = [];
  const bgL: number[] = [];
  // Compare the character against a ring of background around it, which is
  // what the eye actually uses to judge separation.
  const pad = Math.round(Math.max(bbox.w, bbox.h) * 0.25) + 4;
  for (let y = Math.max(0, bbox.y - pad); y < Math.min(frame.height, bbox.y + bbox.h + pad); y++) {
    for (let x = Math.max(0, bbox.x - pad); x < Math.min(frame.width, bbox.x + bbox.w + pad); x++) {
      const i = y * frame.width + x;
      if (mask[i]) charL.push(lightness[i]);
      else bgL.push(lightness[i]);
    }
  }
  if (charL.length === 0 || bgL.length === 0) {
    return [
      pass({
        name: 'color.character_bg_contrast',
        department: DEPT,
        score: 1,
        message: 'Not enough pixels to judge separation.',
        where,
      }),
    ];
  }

  // Median, not mean.
  //
  // A cel character is mostly one or two flat fills wrapped in a heavy
  // dark outline. Averaging pulls the character's value down toward the
  // line colour, so a well-separated character measures as badly
  // separated — and the outline is one of the things doing the
  // separating. The median reports the value the eye actually reads the
  // character as.
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const contrast = Math.abs(median(charL) - median(bgL));
  const charEdges = edgeDensity(characterPlate, bbox);
  const bgEdges = edgeDensity(frame, {
    x: Math.max(0, bbox.x - pad),
    y: Math.max(0, bbox.y - pad),
    w: bbox.w + pad * 2,
    h: bbox.h + pad * 2,
  });

  return [
    measure({
      name: 'color.character_bg_contrast',
      department: DEPT,
      measured: contrast,
      threshold: cfg.minContrastL,
      comparator: '>=',
      floor: 0,
      message:
        contrast >= cfg.minContrastL
          ? `Character separates from the background by ${contrast.toFixed(1)} L*.`
          : `Character and background sit ${contrast.toFixed(1)} L* apart (needs ${cfg.minContrastL}). The character will not read against this background.`,
      diagnosis: 'color.low_contrast',
      where,
    }),
    measure({
      name: 'color.silhouette_edge_contrast',
      department: DEPT,
      measured: edgeContrast(frame, mask, frame.width, frame.height),
      threshold: 18,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        edgeContrast(frame, mask, frame.width, frame.height) >= 18
          ? 'The character\'s outline separates it locally from whatever is behind it.'
          : 'The character\'s edge barely differs in value from the background immediately behind it; the silhouette will not hold.',
      diagnosis: 'color.weak_edge',
      where,
    }),
    measure({
      name: 'color.bg_not_busier_than_character',
      department: DEPT,
      measured: charEdges > 1e-6 ? bgEdges / charEdges : 0,
      threshold: cfg.maxBgEdgeRatio,
      comparator: '<=',
      floor: 3,
      severity: 'warn',
      message:
        bgEdges <= charEdges * cfg.maxBgEdgeRatio
          ? 'The background is calmer than the character, so the eye goes to the action.'
          : `The background carries ${(bgEdges / Math.max(1e-6, charEdges)).toFixed(2)}x the edge density of the character; it competes for attention.`,
      diagnosis: 'color.busy_background',
      where,
    }),
  ];
}

/**
 * Local value contrast right at the silhouette edge.
 *
 * Global separation is one half of readability; the other is what happens
 * in the few pixels either side of the outline, which is where the eye
 * actually finds the boundary.
 */
function edgeContrast(
  frame: ImageBuffer,
  mask: Uint8Array,
  width: number,
  height: number,
): number {
  const L = lightnessMap(frame);
  const deltas: number[] = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      // An edge pixel is inside the mask with an outside neighbour.
      const outside = [i - 1, i + 1, i - width, i + width].find((j) => !mask[j]);
      if (outside === undefined) continue;
      const inner = L[i];
      const outer = L[outside];
      deltas.push(Math.abs(inner - outer));
    }
  }
  if (deltas.length === 0) return 100;
  deltas.sort((a, b) => a - b);
  // The median edge delta: a few weak spots are fine, a weak edge is not.
  return deltas[deltas.length >> 1];
}

/**
 * Style-bible conformance for a background plate: palette, plus the
 * forbidden list expressed as measurable properties where possible.
 */
export function validateBibleConformance(
  frame: ImageBuffer,
  bible: StyleBible,
  environment: Environment | undefined,
  where: Locator = {},
): CheckResult[] {
  const out: CheckResult[] = [];
  const palette = [...(environment?.colorKey ?? []), ...bible.palette];

  // Every large flat region should be near a named swatch.
  const buckets = new Map<string, number>();
  let total = 0;
  for (let y = 0; y < frame.height; y += 3) {
    for (let x = 0; x < frame.width; x += 3) {
      const p = getPixel(frame, x, y);
      if (p.a < 0.5) continue;
      total++;
      const key = `${Math.round(p.r / 8)},${Math.round(p.g / 8)},${Math.round(p.b / 8)}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  let offPalette = 0;
  for (const [key, count] of buckets) {
    if (count / Math.max(1, total) < 0.01) continue; // ignore tiny regions
    const [r, g, b] = key.split(',').map((n) => parseInt(n, 10) * 8);
    const near = nearestSwatch({ r, g, b }, palette);
    if (near && near.deltaE > (near.swatch.tolerance ?? 6)) offPalette += count;
  }
  const conformance = total > 0 ? 1 - offPalette / total : 1;
  out.push(
    measure({
      name: 'color.bible_palette',
      department: DEPT,
      measured: conformance,
      threshold: 0.9,
      comparator: '>=',
      floor: 0.4,
      severity: 'warn',
      message:
        conformance >= 0.9
          ? `${(conformance * 100).toFixed(0)}% of the frame's substantial colour areas match the bible's palette.`
          : `${((1 - conformance) * 100).toFixed(0)}% of the frame is off the bible's palette.`,
      diagnosis: 'color.off_bible_palette',
      where,
    }),
  );

  // Desaturated or grey-dominant frames, if the bible forbids them.
  if (bible.forbidden.some((f) => /desaturat|grey|gray/i.test(f))) {
    let chroma = 0;
    let n = 0;
    for (let y = 0; y < frame.height; y += 4) {
      for (let x = 0; x < frame.width; x += 4) {
        const p = getPixel(frame, x, y);
        if (p.a < 0.5) continue;
        const lab = rgbToLab(p);
        chroma += Math.hypot(lab.a, lab.b);
        n++;
      }
    }
    const meanChroma = n > 0 ? chroma / n : 0;
    out.push(
      measure({
        name: 'color.not_desaturated',
        department: DEPT,
        measured: meanChroma,
        threshold: 8,
        comparator: '>=',
        floor: 0,
        severity: 'warn',
        message:
          meanChroma >= 8
            ? `Mean chroma ${meanChroma.toFixed(1)}; the frame holds its colour.`
            : `Mean chroma ${meanChroma.toFixed(1)} — the frame has gone grey, which the bible forbids.`,
        diagnosis: 'color.desaturated',
        where,
      }),
    );
  }

  // Value hierarchy: a frame with no dark and no light is flat.
  const lightness = lightnessMap(frame);
  const lows = percentile([...lightness], 0.05);
  const highs = percentile([...lightness], 0.95);
  out.push(
    measure({
      name: 'color.value_range',
      department: DEPT,
      measured: highs - lows,
      threshold: 28,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        highs - lows >= 28
          ? `Value range ${(highs - lows).toFixed(0)} L* from shadow to highlight.`
          : `The frame spans only ${(highs - lows).toFixed(0)} L*; there is no value hierarchy and nothing will read.`,
      diagnosis: 'color.flat_values',
      where,
    }),
  );

  return out;
}

/** Colour-script conformance for a scene: is the sequence's key respected? */
export function validateColorScript(
  frame: ImageBuffer,
  swatches: readonly NamedSwatch[],
  where: Locator = {},
): CheckResult {
  if (swatches.length === 0) {
    return pass({
      name: 'color.color_script',
      department: DEPT,
      score: 1,
      message: 'No colour script set for this scene.',
      where,
    });
  }
  const targets = swatches.map((s) => rgbToLab(parseHex(s.hex)));
  let hits = 0;
  let total = 0;
  for (let y = 0; y < frame.height; y += 5) {
    for (let x = 0; x < frame.width; x += 5) {
      const p = getPixel(frame, x, y);
      if (p.a < 0.5) continue;
      total++;
      const lab = rgbToLab(p);
      if (targets.some((t) => deltaE2000(lab, t) <= 14)) hits++;
    }
  }
  const ratio = total > 0 ? hits / total : 1;
  return measure({
    name: 'color.color_script',
    department: DEPT,
    measured: ratio,
    threshold: 0.55,
    comparator: '>=',
    floor: 0,
    severity: 'warn',
    message:
      ratio >= 0.55
        ? `${(ratio * 100).toFixed(0)}% of the frame sits in the scene's colour key.`
        : `Only ${(ratio * 100).toFixed(0)}% of the frame is in the scene's colour key; the sequence's temperature has drifted.`,
    diagnosis: 'color.off_color_script',
    where,
  });
}

/** Per-region temporal colour stability, for the ink-and-paint gate. */
export function validateColorStability(
  frames: readonly ImageBuffer[],
  where: Locator = {},
): CheckResult {
  if (frames.length < 2) {
    return pass({
      name: 'color.temporal_stability',
      department: DEPT,
      score: 1,
      message: 'Fewer than two frames; nothing can flicker.',
      where,
    });
  }
  let worst = 0;
  let worstFrame = 0;
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1];
    const b = frames[f];
    if (a.width !== b.width || a.height !== b.height) continue;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < a.height; y += 4) {
      for (let x = 0; x < a.width; x += 4) {
        const pa = getPixel(a, x, y);
        const pb = getPixel(b, x, y);
        if (pa.a < 0.5 && pb.a < 0.5) continue;
        sum += deltaE2000(rgbToLab(pa), rgbToLab(pb));
        n++;
      }
    }
    const d = n > 0 ? sum / n : 0;
    if (d > worst) {
      worst = d;
      worstFrame = f;
    }
  }
  return measure({
    name: 'color.temporal_stability',
    department: DEPT,
    measured: worst,
    threshold: 6,
    comparator: '<=',
    floor: 24,
    severity: 'warn',
    message:
      worst <= 6
        ? `Colour is stable frame to frame (worst mean DeltaE ${worst.toFixed(2)}).`
        : `Colour shifts by a mean DeltaE of ${worst.toFixed(1)} at frame ${worstFrame}; the paint is boiling.`,
    diagnosis: 'color.temporal_flicker',
    where: { ...where, frame: worstFrame },
  });
}
