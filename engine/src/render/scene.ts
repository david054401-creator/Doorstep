/**
 * The drawable scene: the last structured artifact before pixels.
 *
 * Everything upstream — story, rig, curves, layout, comp — resolves into this,
 * and the renderer turns it into a frame with no further decisions. That is
 * what "pixels last" means operationally: a scene is fully determined, and
 * rendering it twice gives the same bytes.
 */

import type { Vec2, Mat2D } from '../core/math.ts';
import type { RGB } from '../core/color.ts';

export type DrawStroke = { color: RGB; width: number; alpha?: number };

export type DrawShape = {
  id: string;
  /** Closed contours in scene space, already deformed and transformed. */
  contours: Vec2[][];
  fill?: RGB;
  fillAlpha?: number;
  stroke?: DrawStroke;
  /** Second-tone cel shading, drawn on top of the fill, clipped to it. */
  shade?: { contours: Vec2[][]; color: RGB; alpha?: number };
  /** Back-to-front ordering key. */
  z: number;
  /** Tag used by validators to locate a shape: part id, bone, layer. */
  tag?: string;
  /** Which character this shape belongs to, for per-character masks. */
  ownerId?: string;
};

export type DrawImage = {
  id: string;
  /** Reference to a raster asset resolved by the renderer's asset resolver. */
  uri: string;
  transform: Mat2D;
  opacity: number;
  z: number;
  tag?: string;
  ownerId?: string;
  blur?: number;
};

export type DrawLayer = {
  id: string;
  kind: 'bg' | 'character' | 'fx' | 'overlay';
  z: number;
  shapes: DrawShape[];
  images: DrawImage[];
  opacity: number;
  blend: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
  /** Depth-of-field blur radius applied to the whole layer. */
  blur?: number;
  /** Atmospheric haze toward a colour. */
  haze?: { color: string; amount: number };
  /** Parallax factor already baked into shape coordinates; kept for audit. */
  parallax?: number;
  ownerId?: string;
};

export type Scene = {
  width: number;
  height: number;
  /** Background fill, drawn before every layer. */
  background: RGB;
  layers: DrawLayer[];
  /** World → screen transform for this frame, from the camera curve. */
  camera: Mat2D;
  /** Absolute frame number, for evidence citations. */
  frame: number;
};

export function emptyScene(width: number, height: number, background: RGB, frame = 0): Scene {
  return {
    width,
    height,
    background,
    layers: [],
    camera: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    frame,
  };
}

export function sortedLayers(scene: Scene): DrawLayer[] {
  return [...scene.layers].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
}

export function sortedShapes(layer: DrawLayer): DrawShape[] {
  return [...layer.shapes].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
}

/** All shapes belonging to one character, across layers. */
export function shapesOf(scene: Scene, ownerId: string): DrawShape[] {
  return scene.layers.flatMap((l) => l.shapes.filter((s) => s.ownerId === ownerId));
}
