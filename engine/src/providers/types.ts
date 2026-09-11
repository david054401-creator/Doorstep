/**
 * Generative provider seams.
 *
 * Design law 5: generative models are used only inside bounded tasks — a
 * background from a layout, an inbetween from two keys, a part from a
 * model sheet — never "the scene". Every interface here takes structure
 * in and returns one artifact, and every call site gates the result.
 *
 * Design law 6: the deterministic path is the baseline. Nothing here is
 * required for the engine to produce a finished film; a provider that is
 * absent is reported as absent, and the rig render ships.
 */

import type { ImageBuffer } from '../raster/buffer.ts';
import type { AudioBuffer } from '../audio/wav.ts';
import type { Point, ViewName, StyleBible, Viseme } from '../graph/types.ts';
import type { Provenance } from '../core/ids.ts';

export type ProviderResult<T> = {
  ok: boolean;
  value?: T;
  /** Why it failed, in a sentence a human can act on. */
  reason?: string;
  provenance?: Provenance;
  costUsd?: number;
};

export type StyleContext = {
  bible: StyleBible;
  /** Rendered reference images that pin the look. */
  references?: ImageBuffer[];
  seed?: number;
};

/** Text to image, bounded by a control input. */
export type ImageProvider = {
  name: string;
  model: string;
  /**
   * Paint a background from a layout.
   *
   * The layout is the control: line art, depth, or both. The model fills
   * in surface, never composition — composition is the layout stage's
   * job and has already been validated.
   */
  paintBackground(request: {
    lineart: ImageBuffer;
    depth?: ImageBuffer;
    prompt: string;
    style: StyleContext;
    width: number;
    height: number;
  }): Promise<ProviderResult<ImageBuffer>>;

  /** Draw one part of a character on-model, from the model sheet. */
  drawPart(request: {
    reference: ImageBuffer;
    mask?: ImageBuffer;
    partName: string;
    view: ViewName;
    prompt: string;
    style: StyleContext;
  }): Promise<ProviderResult<ImageBuffer>>;

  /** Complete an occluded region so a cut-out part is whole. */
  inpaint(request: {
    image: ImageBuffer;
    mask: ImageBuffer;
    prompt: string;
    style: StyleContext;
  }): Promise<ProviderResult<ImageBuffer>>;

  /** Extend a plate for a camera move. */
  outpaint(request: {
    image: ImageBuffer;
    left: number;
    right: number;
    top: number;
    bottom: number;
    style: StyleContext;
  }): Promise<ProviderResult<ImageBuffer>>;

  upscale(request: { image: ImageBuffer; factor: number }): Promise<ProviderResult<ImageBuffer>>;
  removeBackground(request: { image: ImageBuffer }): Promise<ProviderResult<ImageBuffer>>;
};

/**
 * The organic pass: generated inbetweens between two rig-rendered keys.
 *
 * This is the ToonCrafter / Wan-Animate class of model. It must beat the
 * rig render at the gate or be discarded, so the interface returns
 * candidate frames and never replaces anything on its own.
 */
export type InbetweenProvider = {
  name: string;
  model: string;
  interpolate(request: {
    from: ImageBuffer;
    to: ImageBuffer;
    /** The rig-rendered frames this pass has to beat. */
    baseline: ImageBuffer[];
    frameCount: number;
    style: StyleContext;
  }): Promise<ProviderResult<ImageBuffer[]>>;
};

/** Segmentation, for the part-separation stage. */
export type SegmentProvider = {
  name: string;
  model: string;
  segment(request: {
    image: ImageBuffer;
    /** Point or box prompts, in pixel coordinates. */
    prompts?: { point?: Point; box?: [number, number, number, number]; label?: string }[];
  }): Promise<ProviderResult<{ masks: ImageBuffer[]; labels: string[] }>>;
};

/** 2D pose detection, for auto-rigging a drawing and for performance capture. */
export type PoseProvider = {
  name: string;
  model: string;
  detect(request: { image: ImageBuffer }): Promise<
    ProviderResult<{ keypoints: Record<string, Point>; confidence: Record<string, number> }>
  >;
};

export type VoiceDirection = {
  characterId: string;
  voiceId: string;
  text: string;
  /** Direction tags lifted from the script, e.g. "(quietly)". */
  direction?: string;
  /** Target duration so the line fits its slot. */
  targetSeconds?: number;
};

export type TtsProvider = {
  name: string;
  model: string;
  speak(request: VoiceDirection): Promise<ProviderResult<AudioBuffer>>;
  /** Forced alignment, when the provider can give it. */
  align?(request: {
    audio: AudioBuffer;
    text: string;
    fps: number;
  }): Promise<ProviderResult<{ phoneme: string; startFrame: number; endFrame: number }[]>>;
};

export type MusicProvider = {
  name: string;
  model: string;
  compose(request: {
    brief: string;
    seconds: number;
    bpm: number;
    mood: string[];
  }): Promise<ProviderResult<AudioBuffer>>;
};

export type SfxProvider = {
  name: string;
  model: string;
  render(request: { description: string; seconds: number }): Promise<ProviderResult<AudioBuffer>>;
};

export type ProviderSet = {
  image?: ImageProvider;
  inbetween?: InbetweenProvider;
  segment?: SegmentProvider;
  pose?: PoseProvider;
  tts?: TtsProvider;
  music?: MusicProvider;
  sfx?: SfxProvider;
};

/** A uniform "not configured" result, so absence is never silent. */
export function notConfigured<T>(what: string): ProviderResult<T> {
  return {
    ok: false,
    reason:
      `No ${what} provider is configured, so this step did not run. ` +
      'The deterministic path was used instead, and the score sheet reflects that.',
  };
}

/**
 * Inject the style bible into a prompt.
 *
 * Design law 9: the bible goes into every prompt and every tool call.
 * Doing it in one place means it cannot be forgotten in one department.
 */
export function withStyle(prompt: string, style: StyleContext): string {
  const b = style.bible;
  return [
    prompt,
    '',
    `Style: ${b.statement}`,
    `Shape language: ${b.shapeLanguage.primary}`,
    `Line: ${b.lineRules.quality} weight ${b.lineRules.weight}, colour ${b.lineRules.color}.`,
    `Shading: ${b.lightingRules.shadingModel}, key light at ${b.lightingRules.keyDirection} degrees, ${b.lightingRules.shadowQuality}.`,
    `Palette: ${b.palette.map((s) => `${s.name} ${s.hex}`).join(', ')}.`,
    `Never: ${b.forbidden.join('; ')}.`,
  ].join('\n');
}
