/**
 * Frame sequences, contact sheets and masters.
 *
 * The deliverable is a numbered PNG sequence plus a manifest that records
 * exactly what produced it. FFmpeg is invoked when it is present and
 * reported as absent when it is not — the engine never claims to have
 * written a master it did not write.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ImageBuffer } from '../raster/buffer.ts';
import { createImage, paste, resize } from '../raster/buffer.ts';
import { encodePng } from '../raster/png.ts';
import type { DeliverySpec, Shot, Project } from '../graph/types.ts';
import { hashBytes, hashContent } from '../core/ids.ts';
import type { Hash } from '../core/ids.ts';
import { timecode } from '../core/units.ts';
import { parseHex } from '../core/color.ts';
import type { ScoreSheet } from '../core/result.ts';

export type WrittenFrame = {
  frame: number;
  path: string;
  hash: Hash;
  bytes: number;
};

export type SequenceManifest = {
  shotId?: string;
  directory: string;
  frames: WrittenFrame[];
  width: number;
  height: number;
  fps: number;
  colorSpace: DeliverySpec['colorSpace'];
  /** Hash of the whole sequence: change one frame and this changes. */
  sequenceHash: Hash;
  writtenAt: string;
};

export function writeSequence(
  frames: readonly ImageBuffer[],
  directory: string,
  options: {
    prefix?: string;
    startFrame?: number;
    delivery: DeliverySpec;
    shotId?: string;
    /** PNG compression level; 9 for a master. */
    level?: number;
    /** Metadata written into each PNG. */
    text?: Record<string, string>;
  },
): SequenceManifest {
  mkdirSync(directory, { recursive: true });
  const prefix = options.prefix ?? 'frame';
  const start = options.startFrame ?? 0;
  const written: WrittenFrame[] = [];

  frames.forEach((img, i) => {
    const n = start + i;
    const name = `${prefix}_${String(n).padStart(6, '0')}.png`;
    const path = join(directory, name);
    const bytes = encodePng(img, {
      level: options.level ?? 6,
      srgb: options.delivery.colorSpace === 'sRGB',
      text: {
        Frame: String(n),
        Timecode: timecode(n, options.delivery.fps),
        ...(options.shotId ? { Shot: options.shotId } : {}),
        ...(options.text ?? {}),
      },
    });
    writeFileSync(path, bytes);
    written.push({ frame: n, path, hash: hashBytes(bytes), bytes: bytes.length });
  });

  return {
    shotId: options.shotId,
    directory,
    frames: written,
    width: frames[0]?.width ?? options.delivery.width,
    height: frames[0]?.height ?? options.delivery.height,
    fps: options.delivery.fps,
    colorSpace: options.delivery.colorSpace,
    sequenceHash: hashContent(written.map((f) => f.hash)),
    writtenAt: new Date().toISOString(),
  };
}

/**
 * Contact sheet: every Nth frame of a shot on one page, with frame
 * numbers burned in. This is what a human actually reviews, and what an
 * escalation card attaches as evidence.
 */
export function contactSheet(
  frames: readonly ImageBuffer[],
  options: {
    columns?: number;
    thumbWidth?: number;
    every?: number;
    background?: string;
    label?: string;
  } = {},
): ImageBuffer {
  const every = Math.max(1, options.every ?? Math.ceil(frames.length / 24));
  const picked = frames.filter((_, i) => i % every === 0);
  if (picked.length === 0) return createImage(16, 16);
  const columns = options.columns ?? Math.min(6, picked.length);
  const rows = Math.ceil(picked.length / columns);
  const tw = options.thumbWidth ?? 240;
  const th = Math.round((tw * picked[0].height) / picked[0].width);
  const gap = 6;
  const header = options.label ? 22 : 0;
  const sheet = createImage(
    columns * tw + gap * (columns + 1),
    rows * (th + 14) + gap * (rows + 1) + header,
    { ...parseHex(options.background ?? '#141418'), a: 1 },
  );

  picked.forEach((img, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = gap + col * (tw + gap);
    const y = header + gap + row * (th + 14 + gap);
    paste(sheet, resize(img, tw, th), x, y);
    drawNumber(sheet, i * every, x + 2, y + th + 2);
  });
  return sheet;
}

/**
 * A tiny 3x5 bitmap font.
 *
 * Frame numbers have to be legible on a contact sheet without pulling in
 * a font stack, and a reviewer needs to be able to say "frame 41 is the
 * broken one" from the sheet alone.
 */
const DIGITS: Record<string, number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  f: [0b111, 0b100, 0b110, 0b100, 0b100],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000],
};

export function drawNumber(
  img: ImageBuffer,
  value: number,
  x: number,
  y: number,
  scale = 2,
  color = { r: 235, g: 235, b: 240 },
): void {
  const text = `f${value}`;
  let cursor = x;
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (!glyph) {
      cursor += 4 * scale;
      continue;
    }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (!(glyph[row] & (1 << (2 - col)))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + col * scale + sx;
            const py = y + row * scale + sy;
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
            const i = (py * img.width + px) * 4;
            img.data[i] = color.r;
            img.data[i + 1] = color.g;
            img.data[i + 2] = color.b;
            img.data[i + 3] = 255;
          }
        }
      }
    }
    cursor += 4 * scale;
  }
}

export type EncodeResult = {
  ok: boolean;
  path?: string;
  command: string;
  /** Present when ffmpeg is not installed or the encode failed. */
  reason?: string;
  stderr?: string;
};

export function hasFfmpeg(): boolean {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * Encode a frame sequence.
 *
 * Returns an honest failure when ffmpeg is absent rather than throwing or,
 * worse, reporting success: the delivery manifest has to be able to say
 * "the PNG sequence exists, the ProRes master does not, and here is why".
 */
export function encodeMovie(
  manifest: SequenceManifest,
  outputPath: string,
  options: { codec?: DeliverySpec['masterCodec'] | DeliverySpec['deliverableCodec']; crf?: number; audioPath?: string } = {},
): EncodeResult {
  const codec = options.codec ?? 'h264';
  const pattern = join(manifest.directory, 'frame_%06d.png');
  const args = ['-y', '-framerate', String(manifest.fps), '-i', pattern];
  if (options.audioPath && existsSync(options.audioPath)) args.push('-i', options.audioPath);

  switch (codec) {
    case 'prores422':
      args.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le');
      break;
    case 'prores4444':
      args.push('-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le');
      break;
    case 'av1':
      args.push('-c:v', 'libsvtav1', '-crf', String(options.crf ?? 32), '-pix_fmt', 'yuv420p');
      break;
    case 'vp9':
      args.push('-c:v', 'libvpx-vp9', '-crf', String(options.crf ?? 32), '-b:v', '0', '-pix_fmt', 'yuv420p');
      break;
    case 'png_sequence':
      return {
        ok: true,
        path: manifest.directory,
        command: 'none (the PNG sequence is the master)',
      };
    default:
      args.push('-c:v', 'libx264', '-crf', String(options.crf ?? 18), '-pix_fmt', 'yuv420p', '-preset', 'slow');
  }
  if (options.audioPath && existsSync(options.audioPath)) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  args.push('-colorspace', manifest.colorSpace === 'rec709' ? 'bt709' : 'bt709');
  args.push(outputPath);

  const command = `ffmpeg ${args.join(' ')}`;
  if (!hasFfmpeg()) {
    return {
      ok: false,
      command,
      reason:
        'ffmpeg is not installed on this machine, so no movie file was written. The PNG sequence and its manifest are complete; run the command above wherever ffmpeg is available.',
    };
  }
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    return {
      ok: false,
      command,
      reason: `ffmpeg exited with status ${result.status}.`,
      stderr: (result.stderr ?? '').slice(-2000),
    };
  }
  return { ok: true, path: outputPath, command };
}

export type DeliveryManifest = {
  project: { id: string; name: string };
  spec: DeliverySpec;
  shots: {
    shotId: string;
    number: number;
    frames: number;
    sequenceHash: Hash;
    directory: string;
    scoreSheet?: ScoreSheet;
  }[];
  totalFrames: number;
  /** Hash of every shot's sequence hash: the fingerprint of the cut. */
  filmHash: Hash;
  master?: EncodeResult;
  deliverable?: EncodeResult;
  generatedAt: string;
  /** Everything the engine could not verify, stated plainly. */
  caveats: string[];
};

export function buildManifest(
  project: Pick<Project, 'id' | 'name' | 'deliverySpec'>,
  shots: readonly { shot: Shot; manifest: SequenceManifest; scoreSheet?: ScoreSheet }[],
  extras: { master?: EncodeResult; deliverable?: EncodeResult; caveats?: string[] } = {},
): DeliveryManifest {
  const entries = shots.map(({ shot, manifest, scoreSheet }) => ({
    shotId: shot.id,
    number: shot.number,
    frames: manifest.frames.length,
    sequenceHash: manifest.sequenceHash,
    directory: manifest.directory,
    scoreSheet,
  }));
  const caveats = [...(extras.caveats ?? [])];
  if (extras.master && !extras.master.ok) caveats.push(`Master not written: ${extras.master.reason}`);
  if (extras.deliverable && !extras.deliverable.ok) {
    caveats.push(`Deliverable not written: ${extras.deliverable.reason}`);
  }
  return {
    project: { id: project.id, name: project.name },
    spec: project.deliverySpec,
    shots: entries,
    totalFrames: entries.reduce((a, e) => a + e.frames, 0),
    filmHash: hashContent(entries.map((e) => e.sequenceHash)),
    master: extras.master,
    deliverable: extras.deliverable,
    generatedAt: new Date().toISOString(),
    caveats,
  };
}

export function writeManifest(manifest: DeliveryManifest, path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/** Count the PNGs actually on disk, for verifying a delivery after the fact. */
export function countFrames(directory: string): number {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory).filter((f) => f.endsWith('.png')).length;
}
