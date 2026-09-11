/**
 * PNG encode / decode using node:zlib. No native modules, no image library.
 *
 * The engine has to be able to write a frame and read it back bit-exactly,
 * because every perceptual validator operates on decoded pixels, and the
 * delivery validator hashes frames to detect drops and duplicates.
 */

import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import type { ImageBuffer } from './buffer.ts';
import { createImage } from './buffer.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc(buf: Buffer): number {
  // node:zlib exposes crc32 from v20.15/22; fall back to a table if absent.
  if (typeof crc32 === 'function') return crc32(buf) >>> 0;
  return crcFallback(buf);
}

let CRC_TABLE: Uint32Array | null = null;
function crcFallback(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export type PngOptions = {
  /** 0-9. 6 is a good size/time trade; 9 for masters. */
  level?: number;
  /** Write an sRGB chunk so the colour space is tagged (delivery invariant). */
  srgb?: boolean;
  /** Optional textual metadata, written as tEXt chunks. Keys must be ASCII. */
  text?: Record<string, string>;
};

/** Paeth predictor, the strongest general-purpose PNG filter. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function encodePng(img: ImageBuffer, options: PngOptions = {}): Buffer {
  const { width, height, data } = img;
  const bpp = 4;
  const stride = width * bpp;
  // One filter byte per row + filtered row bytes.
  const raw = Buffer.alloc((stride + 1) * height);
  let prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const filtered = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    for (let i = 0; i < stride; i++) cur[i] = data[y * stride + i];
    // Adaptive filtering: pick the filter with the smallest sum of absolute
    // differences, which is the heuristic the PNG spec itself recommends.
    let bestType = 0;
    let bestScore = Infinity;
    const bestBuf = Buffer.alloc(stride);
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        switch (type) {
          case 0:
            v = cur[i];
            break;
          case 1:
            v = cur[i] - a;
            break;
          case 2:
            v = cur[i] - b;
            break;
          case 3:
            v = cur[i] - ((a + b) >> 1);
            break;
          default:
            v = cur[i] - paeth(a, b, c);
        }
        filtered[i] = v & 0xff;
        const sv = filtered[i] > 127 ? 256 - filtered[i] : filtered[i];
        score += sv;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        filtered.copy(bestBuf);
      }
    }
    raw[y * (stride + 1)] = bestType;
    bestBuf.copy(raw, y * (stride + 1) + 1);
    const t = prev;
    prev = Buffer.from(cur);
    t.fill(0);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr)];
  if (options.srgb !== false) {
    parts.push(chunk('sRGB', Buffer.from([0]))); // perceptual rendering intent
    const gama = Buffer.alloc(4);
    gama.writeUInt32BE(45455, 0); // 1/2.2 * 100000
    parts.push(chunk('gAMA', gama));
  }
  for (const [k, v] of Object.entries(options.text ?? {})) {
    parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
  }
  parts.push(chunk('IDAT', deflateSync(raw, { level: options.level ?? 6 })));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

export function decodePng(buffer: Buffer): ImageBuffer {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bpp = channels;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = createImage(width, height);
  const line = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (filter) {
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          v = (v + paeth(a, b, c)) & 0xff;
          break;
        default:
          break;
      }
      line[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out.data[o] = line[x * 4];
        out.data[o + 1] = line[x * 4 + 1];
        out.data[o + 2] = line[x * 4 + 2];
        out.data[o + 3] = line[x * 4 + 3];
      } else if (colorType === 2) {
        out.data[o] = line[x * 3];
        out.data[o + 1] = line[x * 3 + 1];
        out.data[o + 2] = line[x * 3 + 2];
        out.data[o + 3] = 255;
      } else if (colorType === 4) {
        const g = line[x * 2];
        out.data[o] = g;
        out.data[o + 1] = g;
        out.data[o + 2] = g;
        out.data[o + 3] = line[x * 2 + 1];
      } else if (colorType === 3 && palette) {
        const pi = line[x] * 3;
        out.data[o] = palette[pi];
        out.data[o + 1] = palette[pi + 1];
        out.data[o + 2] = palette[pi + 2];
        out.data[o + 3] = trns && line[x] < trns.length ? trns[line[x]] : 255;
      } else {
        const g = line[x];
        out.data[o] = g;
        out.data[o + 1] = g;
        out.data[o + 2] = g;
        out.data[o + 3] = 255;
      }
    }
    prev = Buffer.from(line);
  }
  return out;
}
