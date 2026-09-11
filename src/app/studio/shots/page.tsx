import Link from 'next/link';
import { loadBuild } from '@/lib/studio/build';
import { C, scoreColor, statusColor, pct, assetUrl } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Empty } from '@/components/studio/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shot board' };

/**
 * The shot board.
 *
 * Ordered by the cut, not by score — a board is a reading of the film in
 * sequence, and re-sorting it by quality would destroy the one thing it
 * is for. The score rides along on each card instead.
 */
export default async function ShotBoard() {
  const state = await loadBuild();
  if (!state.ok) {
    return <Empty title="No build to review." body={state.reason} code={state.hint} />;
  }
  const { build } = state;

  const scenes = new Map<string, typeof build.shots>();
  for (const shot of build.shots) {
    const key = `${shot.sequenceName} · ${shot.sceneName}`;
    const list = scenes.get(key);
    if (list) list.push(shot);
    else scenes.set(key, [shot]);
  }

  const totalFrames = build.shots.reduce((a, s) => a + s.durationFrames, 0);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle
          note={`${build.shots.length} shots · ${totalFrames} frames · ${(totalFrames / build.project.fps).toFixed(1)}s`}
        >
          Shot board
        </PanelTitle>
        <p className="text-[13px]" style={{ color: C.dim }}>
          In cut order. Every card carries what the engine measured on that shot.
        </p>
      </Panel>

      {[...scenes].map(([scene, shots]) => (
        <Panel key={scene}>
          <PanelTitle note={`${shots.length} shot${shots.length === 1 ? '' : 's'}`}>{scene}</PanelTitle>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shots.map((s) => (
              <li key={s.id}>
                <Link href={`/studio/shots/${s.id}`} className="group block">
                  <div
                    className="relative aspect-video w-full overflow-hidden rounded-lg border"
                    style={{ borderColor: C.border, backgroundColor: '#000' }}
                  >
                    {s.board || s.frames[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetUrl(s.board ?? s.frames[0])}
                        alt={s.slug}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[12px]" style={{ color: C.faint }}>
                        not rendered
                      </div>
                    )}
                    <span
                      className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                      style={{ backgroundColor: '#000000AA', color: C.dim }}
                    >
                      {s.size} · {s.angle} · {s.move}
                    </span>
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium" style={{ color: C.text }}>
                      {s.slug}
                    </span>
                    <span className="text-[12px] tabular-nums" style={{ color: C.faint }}>
                      {s.timecode}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-snug" style={{ color: C.dim }}>
                    {s.intent || '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Pill color={statusColor(s.status)}>{s.status}</Pill>
                    {s.score !== undefined ? (
                      <Pill color={scoreColor(s.score)}>{pct(s.score)}</Pill>
                    ) : (
                      <Pill color={C.dim}>unscored</Pill>
                    )}
                    {s.frames.length ? null : <Pill color={C.faint}>no frames</Pill>}
                    {s.dialogue.length ? <Pill color={C.info}>{s.dialogue.length} line</Pill> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
