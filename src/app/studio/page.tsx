import Link from 'next/link';
import { loadBuild } from '@/lib/studio/build';
import { C, scoreColor, stateColor, pct, duration, assetUrl } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Stat, Empty, Meter } from '@/components/studio/primitives';

export const dynamic = 'force-dynamic';

export default async function StudioOverview() {
  const state = await loadBuild();
  if (!state.ok) {
    return (
      <Empty
        title="No build to review."
        body={`${state.reason} ${state.hint ? 'Run the engine and point the studio at its output.' : ''}`}
        code={state.hint}
      />
    );
  }

  const { build, decisions } = state;
  const held = build.invariants.filter((i) => i.state === 'held').length;
  const broken = build.invariants.filter((i) => i.state === 'broken');
  const unmeasured = build.invariants.filter((i) => i.state === 'unmeasured');
  const openNotes = decisions.notes.filter((n) => !n.resolved);
  const worstShots = [...build.shots]
    .filter((s) => s.score !== undefined)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: C.text }}>
              {build.project.name}
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: C.dim }}>
              {build.project.logline}
            </p>
            <p className="mt-3 text-[12px]" style={{ color: C.faint }}>
              Style bible: {build.project.styleBible} · {build.project.width}×{build.project.height} at{' '}
              {build.project.fps}fps · {build.project.characters.length} characters ·{' '}
              {build.shots.length} shots
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
            <Stat
              label="Score"
              value={pct(build.score.score)}
              color={scoreColor(build.score.score)}
              hint={`${build.score.passed} passed, ${build.score.failed} failed`}
            />
            <Stat label="Checks" value={build.stats.checks} hint={`${build.stats.nodes} nodes`} />
            <Stat
              label="Invariants"
              value={`${held}/${build.invariants.length}`}
              color={broken.length ? C.fail : unmeasured.length ? C.warn : C.pass}
              hint={`${broken.length} broken, ${unmeasured.length} unmeasured`}
            />
            <Stat
              label="Run"
              value={duration(build.stats.durationMs)}
              hint={`${build.stats.cacheHits} cache hits`}
            />
          </div>
        </div>
      </Panel>

      {/* Delivery verdict. Stated first because it is the only question
          the build can answer on its own. */}
      <Panel>
        <PanelTitle>Can this be delivered</PanelTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Pill color={build.delivery.ok ? C.pass : C.fail}>
            {build.delivery.ok ? 'All blocking invariants hold' : 'Delivery is blocked'}
          </Pill>
          {build.delivery.unmeasured.length ? (
            <Pill color={C.warn}>{build.delivery.unmeasured.length} blocking invariants unmeasured</Pill>
          ) : null}
        </div>
        {build.delivery.blocking.length ? (
          <ul className="mt-3 space-y-1 text-[13px]" style={{ color: C.fail }}>
            {build.delivery.blocking.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        {build.delivery.unmeasured.length ? (
          <p className="mt-3 text-[13px]" style={{ color: C.dim }}>
            Unmeasured is not held: {build.delivery.unmeasured.join(', ')}.{' '}
            <Link href="/studio/contract" className="underline underline-offset-2" style={{ color: C.info }}>
              See the contract
            </Link>
            .
          </p>
        ) : null}
        {build.caveats.length ? (
          <ul className="mt-4 space-y-1 border-t pt-3 text-[12px]" style={{ borderColor: C.border, color: C.faint }}>
            {build.caveats.map((c) => (
              <li key={c}>— {c}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelTitle note="worst first">By department</PanelTitle>
          <ul className="space-y-3">
            {build.departments.map((d) => (
              <li key={d.department}>
                <div className="mb-1 flex items-baseline justify-between text-[13px]">
                  <span style={{ color: C.text }}>{d.department}</span>
                  <span className="tabular-nums" style={{ color: scoreColor(d.score) }}>
                    {pct(d.score)}
                    <span style={{ color: C.faint }}>
                      {' '}
                      · {d.failed} failed, {d.warnings} warn
                    </span>
                  </span>
                </div>
                <Meter value={d.score} color={scoreColor(d.score)} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelTitle note={`${build.awaitingGate.length + openNotes.length} need a person`}>
            Waiting on you
          </PanelTitle>
          {build.gates.length === 0 && openNotes.length === 0 ? (
            <p className="text-sm" style={{ color: C.dim }}>
              Nothing is waiting on a human decision.
            </p>
          ) : (
            <ul className="space-y-2">
              {build.gates.map((g) => {
                const decided = decisions.approvals.find((a) => a.nodeId === g.nodeId);
                return (
                  <li key={g.id}>
                    <Link
                      href={`/studio/gates#${encodeURIComponent(g.nodeId)}`}
                      className="flex items-center gap-3 rounded-lg border p-2"
                      style={{ borderColor: C.border, backgroundColor: C.bg }}
                    >
                      {g.artifact ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetUrl(g.artifact)}
                          alt=""
                          className="h-10 w-16 rounded object-cover"
                          style={{ backgroundColor: '#000' }}
                        />
                      ) : null}
                      <span className="text-[13px]" style={{ color: C.text }}>
                        {g.title}
                      </span>
                      <span className="ml-auto">
                        <Pill color={decided ? (decided.approved ? C.pass : C.fail) : C.warn}>
                          {decided ? (decided.approved ? 'approved' : 'sent back') : `${g.gate} gate`}
                        </Pill>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {openNotes.slice(0, 5).map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border p-2 text-[13px]"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.dim }}
                >
                  <span style={{ color: C.accent }}>note</span> {n.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {worstShots.length ? (
        <Panel>
          <PanelTitle note="lowest scoring">Look at these shots</PanelTitle>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {worstShots.map((s) => (
              <li key={s.id}>
                <Link href={`/studio/shots/${s.id}`} className="block">
                  <div
                    className="aspect-video w-full overflow-hidden rounded-lg border"
                    style={{ borderColor: C.border, backgroundColor: '#000' }}
                  >
                    {s.board || s.frames[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetUrl(s.board ?? s.frames[0])}
                        alt={s.slug}
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-[12px]">
                    <span style={{ color: C.text }}>{s.slug}</span>
                    <span style={{ color: scoreColor(s.score ?? 0) }}>{pct(s.score ?? 0)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px]" style={{ color: C.dim }}>
                    {s.intent}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {build.escalated.length ? (
        <Panel>
          <PanelTitle note="the repair loop gave up and said so">Escalations</PanelTitle>
          <ul className="space-y-3">
            {build.nodes
              .filter((n) => n.escalation)
              .map((n) => (
                <li key={n.id} className="rounded-lg border p-3" style={{ borderColor: `${C.fail}44`, backgroundColor: C.bg }}>
                  <div className="flex items-center gap-2">
                    <Pill color={C.fail}>{n.status}</Pill>
                    <span className="text-[13px]" style={{ color: C.text }}>
                      {n.title}
                    </span>
                    {n.shotId ? (
                      <Link
                        href={`/studio/shots/${n.shotId}`}
                        className="ml-auto text-[11px] underline underline-offset-2"
                        style={{ color: C.info }}
                      >
                        open the shot
                      </Link>
                    ) : null}
                  </div>
                  <pre
                    className="mt-2 overflow-x-auto text-[12px] leading-relaxed whitespace-pre-wrap"
                    style={{ color: C.dim }}
                  >
                    {n.escalation?.summary}
                  </pre>
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle note={`${build.invariants.length} in the contract`}>The invariants</PanelTitle>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {build.invariants.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-[12px]">
              <span
                aria-hidden
                className="mt-[6px] h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: stateColor(i.state) }}
              />
              <span>
                <span style={{ color: C.text }}>
                  {i.number}. {i.title}
                </span>
                <span style={{ color: C.faint }}> · {i.state}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
