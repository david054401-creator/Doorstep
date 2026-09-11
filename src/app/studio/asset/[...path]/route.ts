/**
 * Serve an image out of the engine's build directory.
 *
 * Build output does not live in `public/`: a build is an artifact of a
 * run, it can be gigabytes, and it is chosen at runtime by
 * `FILM_STUDIO_BUILD`. So the studio streams frames from wherever the
 * build actually is, and `resolveAsset` refuses anything that climbs out
 * of it.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolveAsset } from '@/lib/studio/build';

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export async function GET(_request: Request, context: RouteContext<'/studio/asset/[...path]'>) {
  const { path } = await context.params;
  const relative = path.join('/');
  const resolved = resolveAsset(relative);
  if (!resolved) {
    return new Response('Outside the build directory.', { status: 400 });
  }

  const type = TYPES[extname(resolved).toLowerCase()];
  if (!type) {
    return new Response('Not a servable artifact type.', { status: 415 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    return new Response('No such artifact in this build.', { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': type,
      // Frames are content of an immutable build; the build directory
      // changes name when the build does.
      'Cache-Control': 'private, max-age=300',
      'Content-Length': String(bytes.byteLength),
    },
  });
}
