'use client';

import { useState, useTransition } from 'react';
import { recordGateDecision } from '@/lib/studio/actions';
import type { CheckResult, DrawOverStroke, HumanApproval, StudioBuild } from '@/lib/studio/types';
import { C, assetUrl } from '@/lib/studio/format';
import { DrawOver } from './draw-over';
import { NoteBox } from './note-box';
import { CheckList } from './check-list';
import { Pill } from './primitives';

/**
 * A gate.
 *
 * Design law: gates sit on cheap artifacts, and nothing downstream runs
 * until a person decides. So this screen shows the artifact, shows every
 * check the engine already ran on it, and offers exactly two buttons —
 * with a required reason on the reject, because a rejection with no
 * reason sends the pipeline back around the loop with nothing to act on.
 */
export function GateReview({
  gate,
  checks,
  decision,
  frames,
}: {
  gate: StudioBuild['gates'][number];
  checks: CheckResult[];
  decision?: HumanApproval;
  frames: string[];
}) {
  const [by, setBy] = useState(decision?.by ?? '');
  const [notes, setNotes] = useState(decision?.notes ?? '');
  const [marks, setMarks] = useState<DrawOverStroke[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  const artifact = gate.artifact ?? frames[frameIndex];
  const failing = checks.filter((c) => !c.pass && c.severity !== 'info');

  const decide = (approved: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        await recordGateDecision({
          nodeId: gate.nodeId,
          gate: gate.gate as HumanApproval['gate'],
          approved,
          by,
          notes,
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <DrawOver
          imageSrc={artifact ? assetUrl(artifact) : undefined}
          frame={frameIndex}
          strokes={marks}
          onChange={setMarks}
        />
        {frames.length > 1 ? (
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={(e) => setFrameIndex(Number(e.target.value))}
            className="mt-3 w-full"
            aria-label="Frame"
          />
        ) : null}

        <div className="mt-6">
          <h3 className="mb-2 text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: C.dim }}>
            What the engine already measured
          </h3>
          {checks.length ? (
            <CheckList checks={checks} />
          ) : (
            <p className="text-sm" style={{ color: C.dim }}>
              No checks ran on this artifact, which means this gate is the only thing looking at it.
            </p>
          )}
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.panel }}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill color={C.accent}>{gate.gate}</Pill>
            {decision ? (
              <Pill color={decision.approved ? C.pass : C.fail}>
                {decision.approved ? 'approved' : 'rejected'} by {decision.by}
              </Pill>
            ) : (
              <Pill color={C.warn}>waiting</Pill>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold" style={{ color: C.text }}>
            {gate.title}
          </h3>
          {failing.length ? (
            <p className="mt-2 text-[13px]" style={{ color: C.warn }}>
              {failing.length} check{failing.length === 1 ? '' : 's'} did not pass on this artifact.
              Approving anyway is a decision the build will record under your name.
            </p>
          ) : (
            <p className="mt-2 text-[13px]" style={{ color: C.dim }}>
              Every automated check on this artifact passed. The gate exists for what they cannot see.
            </p>
          )}

          <label className="mt-4 block text-[12px]" style={{ color: C.dim }}>
            Your name
            <input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
            />
          </label>
          <label className="mt-3 block text-[12px]" style={{ color: C.dim }}>
            Reason (required to reject)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
            />
          </label>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(true)}
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: C.pass, color: '#0C1408' }}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(false)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ borderColor: C.fail, color: C.fail }}
            >
              Send back
            </button>
          </div>
          {error ? (
            <p className="mt-2 text-[12px]" style={{ color: C.fail }}>
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-[11px]" style={{ color: C.faint }}>
            Decisions are written to the build&rsquo;s <code>decisions.json</code> and replayed on the
            next engine run. Nothing downstream of this gate runs until then.
          </p>
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.panel }}>
          <h3 className="mb-3 text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: C.dim }}>
            Note with the marks
          </h3>
          <NoteBox shotId={gate.shotId} drawOver={marks} onSubmitted={() => setMarks([])} />
        </div>
      </aside>
    </div>
  );
}
