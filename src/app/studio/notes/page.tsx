import Link from 'next/link';
import { loadBuild } from '@/lib/studio/build';
import { C } from '@/lib/studio/format';
import { Panel, PanelTitle, Empty } from '@/components/studio/primitives';
import { NoteBox, NoteList } from '@/components/studio/note-box';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notes' };

/**
 * Every note given on this build.
 *
 * A note is the director's whole interface to the film, so the record of
 * them is a first-class page: what was said, what the engine turned it
 * into, and whether it has been answered.
 */
export default async function NotesPage() {
  const state = await loadBuild();
  if (!state.ok) return <Empty title="No build to review." body={state.reason} code={state.hint} />;

  const open = state.decisions.notes.filter((n) => !n.resolved);
  const resolved = state.decisions.notes.filter((n) => n.resolved);
  const unmapped = open.filter((n) => n.edits.length === 0);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle note={`${open.length} open · ${resolved.length} resolved`}>
          Director&rsquo;s notes
        </PanelTitle>
        <p className="mb-4 max-w-3xl text-[13px] leading-relaxed" style={{ color: C.dim }}>
          A note is parsed by the engine into named operations against named frames. What it cannot
          understand it says it cannot understand, and keeps — an unmapped note is work for a person,
          not something to drop.
        </p>
        <NoteBox />
      </Panel>

      {unmapped.length ? (
        <Panel>
          <PanelTitle note="the engine could not route these">Needs a human</PanelTitle>
          <NoteList notes={unmapped} />
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle>Open</PanelTitle>
        <NoteList notes={open} />
      </Panel>

      {resolved.length ? (
        <Panel>
          <PanelTitle>Resolved</PanelTitle>
          <NoteList notes={resolved} />
        </Panel>
      ) : null}

      <p className="text-[12px]" style={{ color: C.faint }}>
        Notes live in the build&rsquo;s <code>decisions.json</code>.{' '}
        <Link href="/studio/shots" className="underline underline-offset-2" style={{ color: C.info }}>
          Give one against a specific shot
        </Link>{' '}
        to attach it to a frame.
      </p>
    </div>
  );
}
