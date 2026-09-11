'use client';

import { useState } from 'react';
import type { StudioShot } from '@/lib/studio/types';
import { C, assetUrl } from '@/lib/studio/format';
import { AnimaticPlayer } from './animatic-player';
import { DrawOver } from './draw-over';
import { NoteBox } from './note-box';
import { Panel, PanelTitle } from './primitives';
import type { DrawOverStroke } from '@/lib/studio/types';

/**
 * Play the shot, or stop on a frame and draw on it.
 *
 * These are one surface rather than two because they are one action: a
 * director watches until something is wrong, stops, and points at it.
 * The frame the player is parked on is the frame the note is about, and
 * the note carries that number into the Film Graph.
 */
export function ShotReview({ shot, fps }: { shot: StudioShot; fps: number }) {
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<'play' | 'draw'>('play');
  const [marks, setMarks] = useState<DrawOverStroke[]>([]);

  const stride = shot.frames.length > 1 ? Math.max(1, Math.round(shot.durationFrames / shot.frames.length)) : 1;
  const previewIndex = Math.min(shot.frames.length - 1, Math.round(frame / stride));
  const previewSrc = shot.frames[previewIndex] ?? shot.board;

  return (
    <Panel>
      <PanelTitle
        note={
          <span className="flex gap-1">
            {(['play', 'draw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="rounded px-2 py-1 text-[11px]"
                style={{
                  backgroundColor: mode === m ? C.panelHi : 'transparent',
                  color: mode === m ? C.text : C.faint,
                }}
              >
                {m === 'play' ? 'Play' : 'Draw over'}
              </button>
            ))}
          </span>
        }
      >
        Animatic
      </PanelTitle>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {mode === 'play' ? (
            <AnimaticPlayer shot={shot} fps={fps} onFrame={setFrame} initialFrame={0} />
          ) : (
            <>
              <DrawOver
                imageSrc={previewSrc ? assetUrl(previewSrc) : undefined}
                frame={frame}
                strokes={marks}
                onChange={setMarks}
              />
              <input
                type="range"
                min={0}
                max={Math.max(0, shot.durationFrames - 1)}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
                className="mt-3 w-full"
                aria-label="Frame"
              />
              <p className="mt-1 font-mono text-[11px]" style={{ color: C.faint }}>
                frame {String(frame).padStart(4, '0')} · {(frame / fps).toFixed(2)}s
              </p>
            </>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: C.dim }}>
            Note on frame {frame}
          </h3>
          <NoteBox
            shotId={shot.id}
            drawOver={marks.length ? marks : undefined}
            onSubmitted={() => setMarks([])}
          />
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: C.faint }}>
            You direct; the engine animates. A note becomes a set of named operations against named
            frames — never a prompt, never a hand edit.
          </p>
        </div>
      </div>
    </Panel>
  );
}
