import { loadBuild } from '@/lib/studio/build';
import { C, stateColor } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Empty } from '@/components/studio/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contract' };

/**
 * The thirteen hard invariants, and whether this build holds them.
 *
 * The distinction this page exists to preserve: *unmeasured* is its own
 * state. A build that never ran a check cannot claim the invariant it
 * would have proved, and rendering that as a pass is the single most
 * dangerous thing a QA surface can do.
 */
export default async function ContractPage() {
  const state = await loadBuild();
  if (!state.ok) return <Empty title="No build to review." body={state.reason} code={state.hint} />;
  const { build } = state;

  const counts = {
    held: build.invariants.filter((i) => i.state === 'held').length,
    broken: build.invariants.filter((i) => i.state === 'broken').length,
    unmeasured: build.invariants.filter((i) => i.state === 'unmeasured').length,
  };

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle note={`${build.invariants.length} invariants`}>The contract</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <Pill color={C.pass}>{counts.held} held</Pill>
          <Pill color={C.fail}>{counts.broken} broken</Pill>
          <Pill color={C.dim}>{counts.unmeasured} unmeasured</Pill>
          <Pill color={build.delivery.ok ? C.pass : C.fail}>
            {build.delivery.ok ? 'deliverable' : 'not deliverable'}
          </Pill>
        </div>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed" style={{ color: C.dim }}>
          A blocking invariant that was never measured blocks delivery just as a broken one does.
          The engine will not report a film as finished on the strength of a check that did not run.
        </p>
      </Panel>

      <Panel padded={false}>
        <ul>
          {build.invariants.map((inv, i) => (
            <li
              key={inv.id}
              className="border-b p-5 last:border-b-0"
              style={{ borderColor: C.border, backgroundColor: i % 2 ? C.panel : 'transparent' }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-[12px] tabular-nums" style={{ color: C.faint }}>
                  {String(inv.number).padStart(2, '0')}
                </span>
                <h3 className="text-[15px] font-semibold" style={{ color: C.text }}>
                  {inv.title}
                </h3>
                <Pill color={stateColor(inv.state)}>{inv.state}</Pill>
                {inv.blocking ? <Pill color={C.accent}>blocking</Pill> : null}
              </div>
              <p className="mt-2 max-w-4xl text-[13px] leading-relaxed" style={{ color: C.dim }}>
                {inv.statement}
              </p>
              <p className="mt-2 text-[12px]" style={{ color: stateColor(inv.state) }}>
                {inv.message}
              </p>
              <p className="mt-2 font-mono text-[11px]" style={{ color: C.faint }}>
                {inv.checks.join(' · ')}
              </p>
              {inv.calibration ? (
                <p className="mt-2 max-w-4xl text-[11px] italic" style={{ color: C.faint }}>
                  Calibration: {inv.calibration}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
