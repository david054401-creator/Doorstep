'use client';

import { useCallback, useRef, useState } from 'react';
import type { DrawOverStroke } from '@/lib/studio/types';
import { C } from '@/lib/studio/format';

/**
 * Draw-over notes.
 *
 * A director points at the frame. That gesture is the note, and losing
 * it to a paraphrase ("the arm is a bit stiff around the elbow") is how
 * a review round gets wasted. Strokes are captured in normalised 0..1
 * coordinates against the frame that was on screen, so they survive a
 * re-render at a different resolution and can be replayed over the
 * fixed version to check it.
 */
export function DrawOver({
  imageSrc,
  frame,
  strokes,
  onChange,
  disabled = false,
}: {
  imageSrc?: string;
  frame: number;
  strokes: DrawOverStroke[];
  onChange: (next: DrawOverStroke[]) => void;
  disabled?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null);

  const toLocal = useCallback((e: React.PointerEvent): { x: number; y: number } | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }, []);

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    const p = toLocal(e);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrawing([p]);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = toLocal(e);
    if (!p) return;
    // Thin the path: a pointer emits far more samples than a note needs,
    // and every one of them ends up in the Film Graph.
    const last = drawing[drawing.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return;
    setDrawing([...drawing, p]);
  };

  const end = () => {
    if (!drawing) return;
    if (drawing.length > 1) onChange([...strokes, { frame, points: drawing }]);
    setDrawing(null);
  };

  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(' ');

  return (
    <div>
      <div
        ref={surface}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative aspect-video w-full touch-none overflow-hidden rounded-lg border select-none"
        style={{
          borderColor: C.border,
          backgroundColor: '#000',
          cursor: disabled ? 'default' : 'crosshair',
        }}
      >
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={`Frame ${frame}`}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: C.dim }}>
            No frame to draw on.
          </div>
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {strokes
            .filter((s) => s.frame === frame)
            .map((s, i) => (
              <path
                key={i}
                d={path(s.points)}
                fill="none"
                stroke={C.accent}
                strokeWidth={0.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {drawing ? (
            <path
              d={path(drawing)}
              fill="none"
              stroke={C.accent}
              strokeWidth={0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[12px]" style={{ color: C.dim }}>
        <span>
          {strokes.length} mark{strokes.length === 1 ? '' : 's'} on this note
          {strokes.length ? ` · ${strokes.filter((s) => s.frame === frame).length} on frame ${frame}` : ''}
        </span>
        {strokes.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="underline underline-offset-2"
            style={{ color: C.faint }}
          >
            clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
