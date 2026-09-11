'use client';

import { useState, useTransition } from 'react';
import { submitNote, setNoteResolved } from '@/lib/studio/actions';
import type { DirectorNote, DrawOverStroke } from '@/lib/studio/types';
import type { NoteResult } from '@/lib/studio/actions';
import { C } from '@/lib/studio/format';
import { Pill } from './primitives';

/**
 * The director's notes box.
 *
 * What makes this more than a comment field is the echo: the note goes
 * to the engine, and the engine answers with the operations it will
 * perform. The director sees "shorten the anticipation-to-peak span,
 * add an overshoot at the landing" before anything is re-rendered, and
 * a note the engine does not understand is said to be not understood
 * rather than quietly filed.
 */
export function NoteBox({
  shotId,
  drawOver,
  onSubmitted,
}: {
  shotId?: string;
  drawOver?: DrawOverStroke[];
  onSubmitted?: () => void;
}) {
  const [text, setText] = useState('');
  const [by, setBy] = useState('');
  const [result, setResult] = useState<NoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await submitNote({ text, by, shotId, drawOver });
        setResult(r);
        setText('');
        onSubmitted?.();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="More punch on the jump. Hold the landing two frames longer."
        className="w-full resize-y rounded-lg border p-3 text-sm outline-none"
        style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={by}
          onChange={(e) => setBy(e.target.value)}
          placeholder="Your name"
          className="w-44 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
        />
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={send}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: C.accent, color: '#15100C' }}
        >
          {pending ? 'Sending…' : 'Give the note'}
        </button>
        {drawOver?.length ? (
          <span className="text-[12px]" style={{ color: C.dim }}>
            {drawOver.length} draw-over mark{drawOver.length === 1 ? '' : 's'} attached
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-[13px]" style={{ color: C.fail }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className="mt-3 rounded-lg border p-3"
          style={{
            borderColor: result.edits.length ? `${C.pass}55` : `${C.warn}55`,
            backgroundColor: C.bg,
          }}
        >
          <p className="text-[13px]" style={{ color: C.text }}>
            {result.message}
          </p>
          {result.edits.length ? (
            <ul className="mt-2 space-y-2">
              {result.edits.map((e, i) => (
                <li key={i}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={C.accent}>{e.op}</Pill>
                    {e.params.diagnosis ? (
                      <span className="text-[11px]" style={{ color: C.faint }}>
                        {String(e.params.diagnosis)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px]" style={{ color: C.dim }}>
                    {e.rationale}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[11px]" style={{ color: C.faint }}>
            Recorded in the build&rsquo;s decisions. Re-run the engine to apply it.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function NoteList({ notes }: { notes: DirectorNote[] }) {
  const [pending, startTransition] = useTransition();
  if (notes.length === 0) {
    return (
      <p className="text-sm" style={{ color: C.dim }}>
        No notes yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {notes.map((n) => (
        <li
          key={n.id}
          className="rounded-lg border p-3"
          style={{ borderColor: C.border, backgroundColor: C.bg, opacity: n.resolved ? 0.55 : 1 }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px]" style={{ color: C.faint }}>
              {n.by} · {new Date(n.at).toLocaleString()}
            </span>
            {n.shotId ? <Pill color={C.info}>{n.shotId}</Pill> : null}
            {n.edits.length ? (
              <Pill color={C.pass}>
                {n.edits.length} edit{n.edits.length === 1 ? '' : 's'}
              </Pill>
            ) : (
              <Pill color={C.warn}>unmapped</Pill>
            )}
            {n.drawOver?.length ? <Pill color={C.accent}>{n.drawOver.length} marks</Pill> : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => setNoteResolved(n.id, !n.resolved))}
              className="ml-auto text-[11px] underline underline-offset-2"
              style={{ color: C.dim }}
            >
              {n.resolved ? 'reopen' : 'mark resolved'}
            </button>
          </div>
          <p className="mt-2 text-[14px]" style={{ color: C.text }}>
            {n.text}
          </p>
          {n.edits.length ? (
            <p className="mt-1 text-[12px]" style={{ color: C.dim }}>
              {n.edits.map((e) => e.op).join(', ')}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
