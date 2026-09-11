'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudioShot } from '@/lib/studio/types';
import { C, assetUrl } from '@/lib/studio/format';

/**
 * The animatic player.
 *
 * A review tool has to be honest about time, so this plays on a real
 * clock rather than a `setInterval` that quietly drifts: at 24fps a
 * 16ms timer accumulates about a frame of error per second, and an
 * animator watching for a two-frame hitch would be looking at the
 * player's error, not the film's.
 *
 * It is also frame-exact. Step, scrub and loop all address integer
 * frames, the frame number is always on screen, and a note taken here
 * carries that frame number into the Film Graph.
 */
export function AnimaticPlayer({
  shot,
  fps,
  onFrame,
  initialFrame = 0,
}: {
  shot: StudioShot;
  fps: number;
  onFrame?: (frame: number) => void;
  initialFrame?: number;
}) {
  const count = shot.frames.length;
  // Preview frames may be every Nth; the label must say the real frame.
  const stride = count > 1 ? Math.max(1, Math.round(shot.durationFrames / count)) : 1;

  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialFrame), Math.max(0, count - 1)));
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  // Where playback last resumed from. Held in state rather than a ref
  // so the loop below restarts exactly when it should — on play, and
  // never on an ordinary frame advance.
  const [origin, setOrigin] = useState(0);

  const absoluteFrame = Math.min(shot.durationFrames - 1, index * stride);

  useEffect(() => {
    onFrame?.(absoluteFrame);
  }, [absoluteFrame, onFrame]);

  // The loop lives entirely inside the effect. A self-referencing
  // `useCallback` would reschedule against a stale copy of itself, and
  // the frame that a director is examining would not be the frame the
  // player thinks it is on.
  useEffect(() => {
    if (!playing || count === 0) return;
    let raf = 0;
    const startedAt = performance.now();
    const startedFrom = origin * stride;

    const tick = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      const next = Math.floor((startedFrom + elapsed * fps * rate) / stride);
      if (next >= count) {
        if (!loop) {
          setIndex(count - 1);
          setPlaying(false);
          return;
        }
        // Wrapping by restarting the clock keeps the loop seamless;
        // modulo on a drifting counter does not.
        setIndex(((next % count) + count) % count);
      } else {
        setIndex(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, origin, count, fps, loop, rate, stride]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p) setOrigin(index);
      return !p;
    });
  }, [index]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((i) => Math.max(0, Math.min(count - 1, i + delta)));
    },
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(e.shiftKey ? 8 : 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(e.shiftKey ? -8 : -1);
      } else if (e.key === 'Home') {
        setPlaying(false);
        setIndex(0);
      } else if (e.key === 'End') {
        setPlaying(false);
        setIndex(count - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, step, togglePlay]);

  const beat = useMemo(
    () =>
      shot.beats.find(
        (b) => absoluteFrame >= b.startFrame && absoluteFrame < b.startFrame + b.durationFrames,
      ),
    [shot.beats, absoluteFrame],
  );
  const line = useMemo(
    () =>
      shot.dialogue.find(
        (l) => absoluteFrame >= l.startFrame && absoluteFrame < l.startFrame + l.durationFrames,
      ),
    [shot.dialogue, absoluteFrame],
  );

  if (count === 0) {
    return (
      <div
        className="flex aspect-video items-center justify-center rounded-lg border border-dashed text-sm"
        style={{ borderColor: C.border, color: C.dim }}
      >
        This shot has no rendered frames in the current build.
      </div>
    );
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{ borderColor: C.border, backgroundColor: '#000' }}
      >
        {/* Every frame is in the DOM and only the current one is shown:
            an <img src> swap re-fetches and flashes white at 24fps. */}
        <div className="relative aspect-video w-full">
          {shot.frames.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={assetUrl(src)}
              alt={i === index ? `${shot.slug} frame ${absoluteFrame}` : ''}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ visibility: i === index ? 'visible' : 'hidden' }}
              loading={i < 4 ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute top-2 left-2 rounded px-2 py-1 font-mono text-[11px]"
          style={{ backgroundColor: '#000000AA', color: C.text }}
        >
          {String(absoluteFrame).padStart(4, '0')} / {shot.durationFrames - 1}
          <span style={{ color: C.faint }}> · {(absoluteFrame / fps).toFixed(2)}s</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className="rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: C.accent, color: '#15100C' }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => step(-1)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
          ◀ frame
        </button>
        <button type="button" onClick={() => step(1)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
          frame ▶
        </button>
        <label className="ml-2 flex items-center gap-2 text-[12px]" style={{ color: C.dim }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          loop
        </label>
        <select
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="rounded-lg border px-2 py-1 text-[12px]"
          style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
          aria-label="Playback rate"
        >
          {[0.25, 0.5, 1].map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
        <span className="ml-auto text-[11px]" style={{ color: C.faint }}>
          space · ←/→ step · shift for 8
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={count - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        className="mt-3 w-full"
        aria-label="Scrub"
      />

      {/* The beat strip: intent over time, which is what a director is
          actually judging when they watch an animatic. */}
      <div className="mt-3 flex h-6 w-full overflow-hidden rounded" style={{ backgroundColor: C.panelHi }}>
        {shot.beats.map((b) => (
          <div
            key={b.id}
            title={`${b.intent} (${b.emotion}, intensity ${b.intensity})`}
            className="h-full border-r text-[10px] leading-6 whitespace-nowrap"
            style={{
              width: `${(b.durationFrames / shot.durationFrames) * 100}%`,
              borderColor: C.bg,
              backgroundColor: b === beat ? `${C.accent}44` : `${C.info}22`,
              color: C.dim,
              paddingLeft: 6,
              overflow: 'hidden',
            }}
          >
            {b.intent}
          </div>
        ))}
      </div>

      <div className="mt-2 min-h-[2.5rem] text-[13px]" style={{ color: C.dim }}>
        {beat ? (
          <p>
            <span style={{ color: C.accent }}>beat</span> {beat.intent}{' '}
            <span style={{ color: C.faint }}>
              ({beat.emotion}, intensity {beat.intensity})
            </span>
          </p>
        ) : null}
        {line ? (
          <p style={{ color: C.text }}>
            <span style={{ color: C.faint }}>{line.characterId}</span> “{line.text}”
          </p>
        ) : null}
      </div>
    </div>
  );
}
