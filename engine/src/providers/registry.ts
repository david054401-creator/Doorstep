/**
 * Provider registry and the deterministic fallbacks.
 *
 * The fallbacks are not stubs that pretend to work. Where a deterministic
 * answer exists — a flat-fill background painted from the layout, a
 * rig-rendered inbetween, a silent tone of the right length — it is
 * returned and labelled as deterministic. Where no honest answer exists,
 * the call fails with a reason.
 */

import type {
  ProviderSet,
  ImageProvider,
  InbetweenProvider,
  TtsProvider,
  MusicProvider,
  SfxProvider,
  ProviderResult,
  StyleContext,
} from './types.ts';
import { notConfigured, withStyle } from './types.ts';
import type { ImageBuffer } from '../raster/buffer.ts';
import { createImage, cloneImage, resize, getPixel } from '../raster/buffer.ts';
import { blur as blurImage } from '../raster/filters.ts';
import type { AudioBuffer } from '../audio/wav.ts';
import { createAudio, tone } from '../audio/wav.ts';
import { parseHex } from '../core/color.ts';
import { makeRng } from '../core/rng.ts';
import { provenance } from '../core/ids.ts';

/**
 * Deterministic image provider.
 *
 * `paintBackground` renders the layout's line art over the bible's
 * palette with a seeded texture — a real, usable flat that conforms to
 * the palette by construction. It is not a painting, and it does not
 * claim to be one; it is the baseline a generative plate has to beat.
 */
export function deterministicImageProvider(): ImageProvider {
  const prov = (tool: string, params: Record<string, unknown>) =>
    provenance({ tool, toolVersion: '1', inputs: [], params });

  return {
    name: 'deterministic',
    model: 'engine.flat',
    async paintBackground(request) {
      const { width, height, style } = request;
      const palette = style.bible.palette;
      const sky = palette.find((s) => /sky/i.test(s.name)) ?? palette[0];
      const ground = palette.find((s) => /ground|hill/i.test(s.name)) ?? palette[palette.length - 1];
      const img = createImage(width, height, { ...parseHex(sky?.hex ?? '#DDDDDD'), a: 1 });
      const horizon = Math.round(height * 0.55);
      const g = parseHex(ground?.hex ?? '#888888');
      for (let y = horizon; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          img.data[i] = g.r;
          img.data[i + 1] = g.g;
          img.data[i + 2] = g.b;
          img.data[i + 3] = 255;
        }
      }
      // Composite the layout's line art on top so the structure survives.
      const art = resize(request.lineart, width, height);
      for (let i = 0; i < img.data.length; i += 4) {
        const a = art.data[i + 3] / 255;
        if (a < 0.05) continue;
        img.data[i] = img.data[i] * (1 - a) + art.data[i] * a;
        img.data[i + 1] = img.data[i + 1] * (1 - a) + art.data[i + 1] * a;
        img.data[i + 2] = img.data[i + 2] * (1 - a) + art.data[i + 2] * a;
      }
      return {
        ok: true,
        value: img,
        provenance: prov('image.flat_background', { prompt: withStyle(request.prompt, style).length }),
        costUsd: 0,
      };
    },
    async drawPart() {
      return notConfigured('image generation for character parts');
    },
    async inpaint(request) {
      // Fill the masked region by extending the nearest unmasked colour.
      // Honest, bounded, and enough to close a small occlusion.
      const out = cloneImage(request.image);
      const mask = request.mask;
      for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
          const mi = (y * mask.width + x) * 4;
          if ((mask.data[mi + 3] ?? 0) < 128) continue;
          const source = nearestUnmasked(request.image, mask, x, y);
          if (!source) continue;
          const oi = (y * out.width + x) * 4;
          out.data[oi] = source.r;
          out.data[oi + 1] = source.g;
          out.data[oi + 2] = source.b;
          out.data[oi + 3] = 255;
        }
      }
      const smoothed = blurImage(out, 1.2);
      return { ok: true, value: smoothed, provenance: prov('image.nearest_inpaint', {}), costUsd: 0 };
    },
    async outpaint() {
      return notConfigured('image outpainting');
    },
    async upscale(request) {
      return {
        ok: true,
        value: resize(request.image, request.image.width * request.factor, request.image.height * request.factor),
        provenance: prov('image.bilinear_upscale', { factor: request.factor }),
        costUsd: 0,
      };
    },
    async removeBackground() {
      return notConfigured('background removal');
    },
  };
}

function nearestUnmasked(
  image: ImageBuffer,
  mask: ImageBuffer,
  x: number,
  y: number,
  maxRadius = 24,
): { r: number; g: number; b: number } | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
        const mi = (sy * mask.width + sx) * 4;
        if ((mask.data[mi + 3] ?? 0) >= 128) continue;
        const p = getPixel(image, sx, sy);
        if (p.a < 0.5) continue;
        return p;
      }
    }
  }
  return null;
}

/**
 * The rig-render inbetween provider.
 *
 * This is the baseline in design law 6: it simply returns the rig frames
 * it was handed. Any generative pass has to beat these at the gate, and
 * when none is configured these are what ships.
 */
export function baselineInbetweenProvider(): InbetweenProvider {
  return {
    name: 'baseline',
    model: 'engine.rig_render',
    async interpolate(request) {
      return {
        ok: true,
        value: request.baseline.slice(0, request.frameCount),
        provenance: provenance({ tool: 'inbetween.rig_baseline', toolVersion: '1', inputs: [] }),
        costUsd: 0,
      };
    },
  };
}

/**
 * A silent-placeholder voice provider.
 *
 * It returns silence of exactly the right length so timing, A/V sync and
 * the mix can all be validated before any real voice exists — and the
 * loudness and intelligibility checks correctly report that they had
 * nothing to measure.
 */
export function placeholderTts(sampleRate = 48000): TtsProvider {
  return {
    name: 'placeholder',
    model: 'engine.silence',
    async speak(request) {
      const seconds = request.targetSeconds ?? Math.max(0.4, request.text.split(/\s+/).length / 2.6);
      const audio = createAudio(sampleRate, 1, Math.round(seconds * sampleRate));
      return {
        ok: true,
        value: audio,
        provenance: provenance({
          tool: 'tts.placeholder',
          toolVersion: '1',
          inputs: [],
          params: { characterId: request.characterId, seconds },
        }),
        costUsd: 0,
      };
    },
  };
}

/** A seeded tonal bed, so the mix can be built and measured offline. */
export function placeholderMusic(sampleRate = 48000): MusicProvider {
  return {
    name: 'placeholder',
    model: 'engine.tone_bed',
    async compose(request) {
      const rng = makeRng(`music:${request.brief}`);
      const root = 196 * 2 ** (rng.int(0, 5) / 12);
      const bed = tone(sampleRate, root, request.seconds, 0.06);
      const fifth = tone(sampleRate, root * 1.5, request.seconds, 0.04);
      for (let i = 0; i < bed.channels[0].length; i++) {
        bed.channels[0][i] += fifth.channels[0][i];
      }
      return {
        ok: true,
        value: bed,
        provenance: provenance({ tool: 'music.tone_bed', toolVersion: '1', inputs: [], seed: rng.seed }),
        costUsd: 0,
      };
    },
  };
}

export function placeholderSfx(sampleRate = 48000): SfxProvider {
  return {
    name: 'placeholder',
    model: 'engine.noise_burst',
    async render(request) {
      const rng = makeRng(`sfx:${request.description}`);
      const n = Math.round(request.seconds * sampleRate);
      const ch = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const envelope = Math.exp((-4 * i) / n);
        ch[i] = (rng.next() * 2 - 1) * 0.2 * envelope;
      }
      return {
        ok: true,
        value: { sampleRate, channels: [ch], get length() { return ch.length; } } as AudioBuffer,
        provenance: provenance({ tool: 'sfx.noise_burst', toolVersion: '1', inputs: [], seed: rng.seed }),
        costUsd: 0,
      };
    },
  };
}

/** The offline set: everything deterministic, nothing pretending. */
export function deterministicProviders(): ProviderSet {
  return {
    image: deterministicImageProvider(),
    inbetween: baselineInbetweenProvider(),
    tts: placeholderTts(),
    music: placeholderMusic(),
    sfx: placeholderSfx(),
  };
}

/** Report what is and is not configured, for the score sheet's caveats. */
export function describeProviders(set: ProviderSet): string[] {
  const rows: string[] = [];
  const line = (label: string, p?: { name: string; model: string }): void => {
    rows.push(
      p
        ? `${label}: ${p.name} (${p.model})`
        : `${label}: not configured — the deterministic path is used and the score sheet says so.`,
    );
  };
  line('Image', set.image);
  line('Inbetween (organic pass)', set.inbetween);
  line('Segmentation', set.segment);
  line('Pose detection', set.pose);
  line('Voice', set.tts);
  line('Music', set.music);
  line('Effects', set.sfx);
  return rows;
}

export type { ProviderResult, StyleContext, ProviderSet };
