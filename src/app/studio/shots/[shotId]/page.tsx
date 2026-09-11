import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadBuild, nodesForShot, shotById } from '@/lib/studio/build';
import { C, scoreColor, statusColor, pct, assetUrl } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Stat, Empty } from '@/components/studio/primitives';
import { CheckList } from '@/components/studio/check-list';
import { NoteBox, NoteList } from '@/components/studio/note-box';
import { ShotReview } from '@/components/studio/shot-review';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/studio/shots/[shotId]'>) {
  const { shotId } = await props.params;
  const state = await loadBuild();
  const shot = state.ok ? shotById(state.build, shotId) : undefined;
  return { title: shot ? shot.slug : 'Shot' };
}

export default async function ShotPage(props: PageProps<'/studio/shots/[shotId]'>) {
  const { shotId } = await props.params;
  const state = await loadBuild();
  if (!state.ok) return <Empty title="No build to review." body={state.reason} code={state.hint} />;

  const shot = shotById(state.build, shotId);
  if (!shot) notFound();

  const nodes = nodesForShot(state.build, shotId);
  const checks = nodes.flatMap((n) => n.checks);
  const notes = state.decisions.notes.filter((n) => n.shotId === shotId);
  const index = state.build.shots.findIndex((s) => s.id === shotId);
  const prev = state.build.shots[index - 1];
  const next = state.build.shots[index + 1];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight" style={{ color: C.text }}>
                {shot.slug}
              </h1>
              <Pill color={statusColor(shot.status)}>{shot.status}</Pill>
              {shot.score !== undefined ? (
                <Pill color={scoreColor(shot.score)}>{pct(shot.score)}</Pill>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: C.dim }}>
              {shot.intent || 'No stated intent for this shot.'}
            </p>
            <p className="mt-2 text-[12px]" style={{ color: C.faint }}>
              {shot.sequenceName} · {shot.sceneName} · {shot.size} · {shot.angle} · {shot.move} ·{' '}
              {shot.characters.join(', ') || 'no cast'}
            </p>
          </div>
          <div className="flex items-start gap-8">
            <Stat label="Length" value={shot.timecode} hint={`${shot.durationFrames} frames`} />
            <Stat label="Beats" value={shot.beats.length} hint={`${shot.dialogue.length} line(s)`} />
            <div className="flex gap-2 pt-1">
              {prev ? (
                <Link
                  href={`/studio/shots/${prev.id}`}
                  className="rounded-lg border px-3 py-2 text-[12px]"
                  style={{ borderColor: C.border, color: C.dim }}
                >
                  ← {prev.slug}
                </Link>
              ) : null}
              {next ? (
                <Link
                  href={`/studio/shots/${next.id}`}
                  className="rounded-lg border px-3 py-2 text-[12px]"
                  style={{ borderColor: C.border, color: C.dim }}
                >
                  {next.slug} →
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      <ShotReview shot={shot} fps={state.build.project.fps} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelTitle note={`${checks.length} on this shot`}>Checks</PanelTitle>
          {checks.length ? (
            <CheckList checks={checks} />
          ) : (
            <p className="text-sm" style={{ color: C.dim }}>
              Nothing was measured on this shot in this build.
            </p>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelTitle>Beats</PanelTitle>
            <ol className="space-y-2">
              {shot.beats.map((b) => (
                <li key={b.id} className="text-[13px]">
                  <span className="tabular-nums" style={{ color: C.faint }}>
                    {String(b.startFrame).padStart(3, '0')}–
                    {String(b.startFrame + b.durationFrames - 1).padStart(3, '0')}
                  </span>{' '}
                  <span style={{ color: C.text }}>{b.intent}</span>
                  <span style={{ color: C.faint }}>
                    {' '}
                    · {b.emotion} {b.intensity}
                  </span>
                </li>
              ))}
              {shot.beats.length === 0 ? (
                <li className="text-sm" style={{ color: C.dim }}>
                  No beats.
                </li>
              ) : null}
            </ol>
            {shot.dialogue.length ? (
              <>
                <h3 className="mt-5 mb-2 text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: C.dim }}>
                  Dialogue
                </h3>
                <ul className="space-y-2">
                  {shot.dialogue.map((l) => (
                    <li key={l.id} className="text-[13px]">
                      <span className="tabular-nums" style={{ color: C.faint }}>
                        {String(l.startFrame).padStart(3, '0')}
                      </span>{' '}
                      <span style={{ color: C.faint }}>{l.characterId}</span>{' '}
                      <span style={{ color: C.text }}>&ldquo;{l.text}&rdquo;</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Panel>

          <Panel>
            <PanelTitle note={`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}>Pipeline</PanelTitle>
            <ul className="space-y-2">
              {nodes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Pill color={statusColor(n.status)}>{n.status}</Pill>
                  <span style={{ color: C.text }}>{n.title}</span>
                  {n.repairs.length ? <Pill color={C.warn}>{n.repairs.length} repair</Pill> : null}
                  {n.score !== undefined ? (
                    <span className="ml-auto tabular-nums" style={{ color: scoreColor(n.score) }}>
                      {pct(n.score)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelTitle note={`${notes.length} on this shot`}>Notes</PanelTitle>
            <NoteBox shotId={shot.id} />
            <div className="mt-4">
              <NoteList notes={notes} />
            </div>
          </Panel>
        </div>
      </div>

      {shot.contactSheet ? (
        <Panel>
          <PanelTitle note="every frame at a glance">Contact sheet</PanelTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(shot.contactSheet)}
            alt={`Contact sheet for ${shot.slug}`}
            className="w-full rounded-lg border"
            style={{ borderColor: C.border, backgroundColor: '#000' }}
          />
        </Panel>
      ) : null}
    </div>
  );
}
