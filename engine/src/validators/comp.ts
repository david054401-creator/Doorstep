/**
 * Compositing, camera and safety validators.
 *
 * Invariant 11 (photosensitivity) and invariant 12 (delivery) live here,
 * plus the camera rules that separate a directed move from a slow zoom.
 */

import type { Shot, DeliverySpec, Environment } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { luminanceMap, silhouetteMask, maskBounds, getPixel } from '../raster/buffer.ts';
import { classifyEase } from '../timing/easing.ts';
import { evaluateCamera } from '../render/camera.ts';
import { mean, clamp01 } from '../core/math.ts';
import { hashBytes } from '../core/ids.ts';
import { encodePng } from '../raster/png.ts';
import { DEFAULT_FPS } from '../core/units.ts';

const DEPT = 'comp';

export type CompOptions = {
  fps?: number;
  /** Harding-style: maximum flashes per second. */
  maxFlashesPerSecond?: number;
  /** Luminance delta that counts as a flash, 0..1. */
  flashLuminanceDelta?: number;
  /** Fraction of frame area a flash must cover to count. */
  flashAreaFraction?: number;
  /** Safe title area as a fraction of the frame. */
  safeArea?: number;
  /** Max per-frame mean luminance change before we call it flicker. */
  maxFlicker?: number;
};

const D: Required<CompOptions> = {
  fps: DEFAULT_FPS,
  maxFlashesPerSecond: 3,
  flashLuminanceDelta: 0.1,
  flashAreaFraction: 0.25,
  safeArea: 0.9,
  maxFlicker: 0.06,
};

/**
 * Camera discipline.
 *
 * A linear zoom is the clearest signal that nobody was directing: real
 * camera moves ease in and out, and they have a reason. This check rejects
 * unmotivated linear moves outright.
 */
export function validateCamera(shot: Shot, options: CompOptions = {}): CheckResult[] {
  const cfg = { ...D, ...options };
  const where: Locator = { shotId: shot.id };
  const out: CheckResult[] = [];
  const keys = shot.camera.move.keys;

  if (keys.length < 2) {
    out.push(
      pass({
        name: 'comp.camera_eased',
        department: DEPT,
        score: 1,
        message: 'The camera is static in this shot.',
        where,
      }),
    );
    return out;
  }

  const zooms: number[] = [];
  const xs: number[] = [];
  for (let f = 0; f < shot.durationFrames; f++) {
    const s = evaluateCamera(shot.camera.move, f);
    zooms.push(s.zoom);
    xs.push(s.position.x);
  }
  const zoomRange = Math.max(...zooms) - Math.min(...zooms);
  const panRange = Math.max(...xs) - Math.min(...xs);

  if (zoomRange > 1e-4) {
    const klass = classifyEase(zooms);
    out.push(
      klass.kind === 'linear'
        ? fail({
            name: 'comp.camera_eased',
            department: DEPT,
            score: 0.2,
            message:
              'The zoom runs at a constant rate from start to finish. A linear zoom is the signature of an undirected shot; ease it in and out, or hold the camera still.',
            diagnosis: 'comp.linear_zoom',
            where,
          })
        : pass({
            name: 'comp.camera_eased',
            department: DEPT,
            score: 1,
            message: `The zoom is eased (${klass.kind}).`,
            where,
          }),
    );
  }
  if (panRange > 1e-4) {
    const klass = classifyEase(xs);
    out.push(
      klass.kind === 'linear'
        ? fail({
            name: 'comp.pan_eased',
            department: DEPT,
            score: 0.3,
            severity: 'warn',
            message: 'The pan travels at a constant rate with no ease at either end.',
            diagnosis: 'comp.linear_pan',
            where,
          })
        : pass({
            name: 'comp.pan_eased',
            department: DEPT,
            score: 1,
            message: `The pan is eased (${klass.kind}).`,
            where,
          }),
    );
  }

  // A move needs a reason: a camera move with no beat under it is noise.
  if ((zoomRange > 0.05 || panRange > 20) && shot.beats.every((b) => b.intensity <= 1)) {
    out.push(
      fail({
        name: 'comp.camera_motivated',
        department: DEPT,
        score: 0.5,
        severity: 'warn',
        message: 'The camera moves but nothing in the shot motivates it.',
        diagnosis: 'comp.unmotivated_move',
        where,
      }),
    );
  }
  void cfg;
  return out;
}

/**
 * Depth order sanity: a character must never be drawn behind a background
 * plane that sits in front of it.
 */
export function validateDepthOrder(
  shot: Shot,
  environment: Environment | undefined,
  where: Locator = { shotId: shot.id },
): CheckResult {
  if (!environment) {
    return pass({
      name: 'comp.depth_order',
      department: DEPT,
      score: 1,
      message: 'No environment layers to order against.',
      where,
    });
  }
  const problems: string[] = [];
  for (const placement of shot.staging.characters) {
    for (const layer of environment.layers) {
      // A layer in front of the character must be tagged as foreground, and
      // a character standing on the ground must be in front of the ground.
      if (layer.depth > placement.depth && !/fg|foreground|overlay/i.test(layer.id + layer.name)) {
        problems.push(
          `${placement.characterId} at depth ${placement.depth} sits behind "${layer.name}" at depth ${layer.depth}, which is not marked as a foreground element.`,
        );
      }
    }
  }
  return problems.length === 0
    ? pass({
        name: 'comp.depth_order',
        department: DEPT,
        score: 1,
        message: 'Every character sits in front of the planes it should.',
        where,
      })
    : fail({
        name: 'comp.depth_order',
        department: DEPT,
        score: Math.max(0, 1 - problems.length / 4),
        message: problems[0],
        diagnosis: 'comp.depth_inversion',
        where,
      });
}

/**
 * Head-cutoff and safe area.
 *
 * Slicing the top of a head off, or letting essential action drift outside
 * the safe area, are both things a human notices immediately.
 */
export function validateFraming(
  characterPlate: ImageBuffer,
  delivery: DeliverySpec,
  options: CompOptions = {},
  where: Locator = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  const mask = silhouetteMask(characterPlate, 0.5);
  const bbox = maskBounds(mask, characterPlate.width, characterPlate.height);
  if (bbox.w === 0) {
    return [
      pass({
        name: 'comp.head_not_cut',
        department: DEPT,
        score: 1,
        message: 'No character in frame.',
        where,
      }),
    ];
  }
  const out: CheckResult[] = [];
  // The head is cut when the silhouette touches the top edge but the
  // character is not deliberately framed as a close-up filling the frame.
  const touchesTop = bbox.y <= 1;
  const fillsFrame = bbox.h > characterPlate.height * 0.9;
  out.push(
    !touchesTop || fillsFrame
      ? pass({
          name: 'comp.head_not_cut',
          department: DEPT,
          score: 1,
          message: 'The top of the head is inside the frame.',
          where,
        })
      : fail({
          name: 'comp.head_not_cut',
          department: DEPT,
          score: 0.3,
          message: 'The character touches the top edge of the frame; the head is being clipped.',
          diagnosis: 'comp.head_cutoff',
          where,
        }),
  );

  const safe = clamp01(delivery.safeAreaPercent || cfg.safeArea);
  const marginX = (characterPlate.width * (1 - safe)) / 2;
  const marginY = (characterPlate.height * (1 - safe)) / 2;
  // A medium shot crops the body at the waist on purpose, so running off
  // the bottom of frame is framing, not a fault. What must stay inside the
  // safe area is the head and the horizontal extent — the parts a broadcast
  // crop would actually steal.
  const headBand = { y: bbox.y, h: Math.max(1, bbox.h * 0.4) };
  const insideSafe =
    bbox.x >= marginX * 0.5 &&
    bbox.x + bbox.w <= characterPlate.width - marginX * 0.5 &&
    headBand.y >= marginY * 0.5 &&
    headBand.y + headBand.h <= characterPlate.height - marginY * 0.5;
  out.push(
    insideSafe
      ? pass({
          name: 'comp.safe_area',
          department: DEPT,
          score: 1,
          message: `Head and horizontal extent sit inside the ${(safe * 100).toFixed(0)}% safe area.`,
          where,
        })
      : fail({
          name: 'comp.safe_area',
          department: DEPT,
          score: 0.6,
          severity: 'warn',
          message: `The character's head or horizontal extent falls outside the ${(safe * 100).toFixed(0)}% safe area and may be cropped on delivery.`,
          diagnosis: 'comp.outside_safe_area',
          where,
        }),
  );
  return out;
}

/**
 * Photosensitivity.
 *
 * Harding-style: no more than three flashes per second, where a flash is a
 * luminance swing over a threshold across a substantial area of frame.
 * This is a safety invariant, not a quality one — it is fatal.
 */
export function validatePhotosensitivity(
  frames: readonly ImageBuffer[],
  options: CompOptions = {},
  where: Locator = {},
): CheckResult[] {
  const cfg = { ...D, ...options };
  if (frames.length < 3) {
    return [
      pass({
        name: 'safety.photosensitivity',
        department: 'safety',
        score: 1,
        message: 'Too few frames to constitute a flash sequence.',
        where,
      }),
    ];
  }

  const meanLum: number[] = [];
  for (const f of frames) {
    const lum = luminanceMap(f);
    let s = 0;
    for (let i = 0; i < lum.length; i++) s += lum[i];
    meanLum.push(s / lum.length);
  }

  // Count transitions that exceed the delta over a large enough area.
  const flashes: number[] = [];
  for (let i = 1; i < meanLum.length; i++) {
    if (Math.abs(meanLum[i] - meanLum[i - 1]) < cfg.flashLuminanceDelta) continue;
    // Confirm the swing covers enough of the frame to be a real flash.
    const a = frames[i - 1];
    const b = frames[i];
    let changed = 0;
    let total = 0;
    for (let y = 0; y < a.height; y += 3) {
      for (let x = 0; x < a.width; x += 3) {
        total++;
        const pa = getPixel(a, x, y);
        const pb = getPixel(b, x, y);
        const la = (pa.r * 0.2126 + pa.g * 0.7152 + pa.b * 0.0722) / 255;
        const lb = (pb.r * 0.2126 + pb.g * 0.7152 + pb.b * 0.0722) / 255;
        if (Math.abs(lb - la) >= cfg.flashLuminanceDelta) changed++;
      }
    }
    if (total > 0 && changed / total >= cfg.flashAreaFraction) flashes.push(i);
  }

  // Worst one-second window.
  let worstWindow = 0;
  for (const f of flashes) {
    const inWindow = flashes.filter((g) => g >= f && g < f + cfg.fps).length;
    if (inWindow > worstWindow) worstWindow = inWindow;
  }

  const flicker = meanLum.slice(1).map((v, i) => Math.abs(v - meanLum[i]));
  const meanFlicker = flicker.length ? mean(flicker) : 0;

  return [
    measure({
      name: 'safety.photosensitivity',
      department: 'safety',
      measured: worstWindow,
      threshold: cfg.maxFlashesPerSecond,
      comparator: '<=',
      floor: cfg.maxFlashesPerSecond * 3,
      severity: 'fatal',
      message:
        worstWindow <= cfg.maxFlashesPerSecond
          ? `At most ${worstWindow} large-area luminance flash(es) in any one second.`
          : `${worstWindow} large-area flashes inside one second, over the limit of ${cfg.maxFlashesPerSecond}. This sequence is a photosensitivity risk and must not ship.`,
      diagnosis: 'safety.flash_rate',
      where: flashes.length ? { ...where, frame: flashes[0] } : where,
    }),
    measure({
      name: 'comp.no_flicker',
      department: DEPT,
      measured: meanFlicker,
      threshold: cfg.maxFlicker,
      comparator: '<=',
      floor: cfg.maxFlicker * 5,
      severity: 'warn',
      message:
        meanFlicker <= cfg.maxFlicker
          ? `Mean frame-to-frame luminance change ${meanFlicker.toFixed(4)}; the image is stable.`
          : `Mean frame-to-frame luminance change ${meanFlicker.toFixed(3)}; the image flickers.`,
      diagnosis: 'comp.flicker',
      where,
    }),
  ];
}

/**
 * Delivery integrity: frame count, no dropped or duplicated frames, and
 * the sequence hashes to something. Invariant 12.
 */
export function validateDelivery(
  frames: readonly ImageBuffer[],
  shot: Shot,
  delivery: DeliverySpec,
  where: Locator = { shotId: shot.id },
): CheckResult[] {
  const out: CheckResult[] = [];

  out.push(
    frames.length === shot.durationFrames
      ? pass({
          name: 'delivery.frame_count',
          department: 'delivery',
          score: 1,
          measured: frames.length,
          threshold: shot.durationFrames,
          comparator: '==',
          message: `${frames.length} frames rendered, exactly as specified.`,
          where,
        })
      : fail({
          name: 'delivery.frame_count',
          department: 'delivery',
          score: 0,
          severity: 'fatal',
          measured: frames.length,
          threshold: shot.durationFrames,
          comparator: '==',
          message: `${frames.length} frames rendered but the shot specifies ${shot.durationFrames}.`,
          diagnosis: 'delivery.frame_count_mismatch',
          where,
        }),
  );

  // Duplicate detection by content hash. Consecutive identical frames are
  // expected on twos; identical frames far apart are a render fault.
  const hashes = frames.map((f) => hashBytes(encodePng(f, { level: 1 })));
  const seen = new Map<string, number>();
  const suspicious: { frame: number; original: number }[] = [];
  hashes.forEach((h, i) => {
    const first = seen.get(h);
    if (first === undefined) {
      seen.set(h, i);
      return;
    }
    if (i - first > 3) suspicious.push({ frame: i, original: first });
  });
  out.push(
    suspicious.length === 0
      ? pass({
          name: 'delivery.no_duplicate_frames',
          department: 'delivery',
          score: 1,
          message: `${new Set(hashes).size} distinct frames; no unexplained duplicates.`,
          where,
        })
      : fail({
          name: 'delivery.no_duplicate_frames',
          department: 'delivery',
          score: Math.max(0, 1 - suspicious.length / Math.max(1, frames.length)),
          severity: 'warn',
          message: `Frame ${suspicious[0].frame} is byte-identical to frame ${suspicious[0].original}, too far apart to be a hold on twos.`,
          diagnosis: 'delivery.duplicate_frame',
          where: { ...where, frame: suspicious[0].frame },
        }),
  );

  const wrongSize = frames.filter((f) => f.width !== delivery.width || f.height !== delivery.height);
  out.push(
    wrongSize.length === 0
      ? pass({
          name: 'delivery.resolution',
          department: 'delivery',
          score: 1,
          message: `Every frame is ${delivery.width}x${delivery.height}.`,
          where,
        })
      : fail({
          name: 'delivery.resolution',
          department: 'delivery',
          score: 0,
          severity: 'fatal',
          message: `${wrongSize.length} frame(s) are not ${delivery.width}x${delivery.height}.`,
          diagnosis: 'delivery.wrong_resolution',
          where,
        }),
  );

  return out;
}

/** OCR-free text sweep: detect suspicious glyph-like clusters. */
export function validateNoText(frame: ImageBuffer, where: Locator = {}): CheckResult {
  // Text and watermarks produce many small, high-contrast, similarly-sized
  // connected components in a row. Without a full OCR pass this heuristic
  // catches the common cases: a signature, a caption, a model's watermark.
  const lum = luminanceMap(frame);
  const w = frame.width;
  const h = frame.height;
  let rowsWithRuns = 0;
  for (let y = 1; y < h - 1; y += 2) {
    let runs = 0;
    let inRun = false;
    for (let x = 1; x < w - 1; x++) {
      const c = Math.abs(lum[y * w + x] - lum[y * w + x - 1]) > 0.22;
      if (c && !inRun) {
        runs++;
        inRun = true;
      } else if (!c) inRun = false;
    }
    // A line of text produces many short alternations across one row.
    if (runs > Math.max(14, w / 24)) rowsWithRuns++;
  }
  const ratio = rowsWithRuns / Math.max(1, h / 2);
  return measure({
    name: 'comp.no_text_artifacts',
    department: DEPT,
    measured: ratio,
    threshold: 0.06,
    comparator: '<=',
    floor: 0.4,
    severity: 'warn',
    message:
      ratio <= 0.06
        ? 'No dense glyph-like structure detected; the frame is free of text and watermarks.'
        : `${(ratio * 100).toFixed(0)}% of scanlines carry dense glyph-like alternation — this frame may contain text or a watermark.`,
    diagnosis: 'comp.text_artifact',
    where,
  });
}
