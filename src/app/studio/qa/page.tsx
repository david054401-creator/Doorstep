import { loadBuild } from '@/lib/studio/build';
import { C, scoreColor, statusColor, pct, duration } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Empty, Meter } from '@/components/studio/primitives';
import { CheckList } from '@/components/studio/check-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'QA' };

/**
 * The QA dashboard.
 *
 * Everything the run measured, in one place, with the repair history
 * beside it. The repair table is the interesting half: "this failed and
 * was fixed by widening the elbow limit" is a different fact from "this
 * passed", and a dashboard that collapses them is hiding the engine's
 * actual behaviour.
 */
export default async function QaDashboard() {
  const state = await loadBuild();
  if (!state.ok) return <Empty title="No build to review." body={state.reason} code={state.hint} />;

  const { build } = state;
  const checks = build.nodes.flatMap((n) => n.checks);
  const repairs = build.nodes.flatMap((n) => n.repairs.map((r) => ({ ...r, node: n.title })));
  const slowest = [...build.nodes].sort((a, b) => b.durationMs - a.durationMs).slice(0, 6);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle note={`${checks.length} checks across ${build.nodes.length} nodes`}>
          Quality
        </PanelTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {build.departments.map((d) => (
            <div key={d.department} className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px]" style={{ color: C.text }}>
                  {d.department}
                </span>
                <span className="text-[13px] tabular-nums" style={{ color: scoreColor(d.score) }}>
                  {pct(d.score)}
                </span>
              </div>
              <div className="mt-2">
                <Meter value={d.score} color={scoreColor(d.score)} />
              </div>
              <p className="mt-2 text-[11px]" style={{ color: C.faint }}>
                {d.passed} passed · {d.failed} failed · {d.warnings} warnings
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelTitle note="failures first">Every check</PanelTitle>
        <CheckList checks={checks} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelTitle note={`${repairs.length} attempt${repairs.length === 1 ? '' : 's'}`}>
            What the repair loop did
          </PanelTitle>
          {repairs.length === 0 ? (
            <p className="text-sm" style={{ color: C.dim }}>
              Nothing needed repairing in this run.
            </p>
          ) : (
            <ul className="space-y-2">
              {repairs.map((r, i) => {
                const delta = r.scoreAfter - r.scoreBefore;
                const color =
                  r.outcome === 'fixed' || r.outcome === 'improved'
                    ? C.pass
                    : r.outcome === 'escalated' || r.outcome === 'worse'
                      ? C.fail
                      : C.warn;
                return (
                  <li key={i} className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill color={color}>{r.outcome}</Pill>
                      <code className="text-[12px]" style={{ color: C.text }}>
                        {r.move}
                      </code>
                      <span className="text-[11px]" style={{ color: C.faint }}>
                        attempt {r.attempt} · {r.node}
                      </span>
                      <span className="ml-auto text-[12px] tabular-nums" style={{ color: delta >= 0 ? C.pass : C.fail }}>
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(3)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px]" style={{ color: C.dim }}>
                      {r.failedCheck} → {r.diagnosis}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelTitle note="where the time went">Nodes</PanelTitle>
          <ul className="space-y-2">
            {slowest.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Pill color={statusColor(n.status)}>{n.status}</Pill>
                <span style={{ color: C.text }}>{n.title}</span>
                {n.fromCache ? <Pill color={C.info}>cached</Pill> : null}
                <span className="ml-auto tabular-nums" style={{ color: C.faint }}>
                  {duration(n.durationMs)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px]" style={{ color: C.faint }}>
            {build.stats.cacheHits} of {build.nodes.length} nodes came from the content-addressed
            cache.
          </p>
        </Panel>
      </div>
    </div>
  );
}
