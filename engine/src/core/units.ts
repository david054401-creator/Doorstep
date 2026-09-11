/** Frames, seconds, and the arithmetic that keeps A/V sync honest. */

export type Fps = 24 | 25 | 30 | 48 | 60;

export const DEFAULT_FPS: Fps = 24;

export const framesToSeconds = (frames: number, fps: number = DEFAULT_FPS): number => frames / fps;
export const secondsToFrames = (seconds: number, fps: number = DEFAULT_FPS): number =>
  Math.round(seconds * fps);

/** Frames are the unit of truth; never round twice. */
export function timecode(frame: number, fps: number = DEFAULT_FPS): string {
  const f = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(f / fps);
  const ff = f % fps;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function parseTimecode(tc: string, fps: number = DEFAULT_FPS): number {
  const parts = tc.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) throw new Error(`bad timecode: ${tc}`);
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts;
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

/**
 * Read-aloud duration estimate for dialogue, in frames. Calibrated against
 * conversational delivery at ~2.6 words/second with pause allowances for
 * punctuation — the script and animatic gates compare against this.
 */
export function speechFrames(
  text: string,
  fps: number = DEFAULT_FPS,
  wordsPerSecond = 2.6,
): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const commas = (text.match(/[,;:]/g) ?? []).length;
  const terminals = (text.match(/[.!?]/g) ?? []).length;
  const seconds = words / wordsPerSecond + commas * 0.18 + terminals * 0.32;
  return Math.max(1, Math.round(seconds * fps));
}
