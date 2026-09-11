import { loadBuild, shotById } from '@/lib/studio/build';
import { C } from '@/lib/studio/format';
import { Panel, PanelTitle, Pill, Empty } from '@/components/studio/primitives';
import { GateReview } from '@/components/studio/gate-review';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gates' };

/**
 * Gate review.
 *
 * Every gate in the build, waiting ones first, each with the artifact,
 * the checks that already ran on it, a draw-over surface and two
 * buttons. Nothing downstream of an unapproved gate exists in the build,
 * which is the point: there is no path from failed to done that skips a
 * human.
 */
export default async function GatesPage() {
  const state = await loadBuild();
  if (!state.ok) return <Empty title="No build to review." body={state.reason} code={state.hint} />;

  const { build, decisions } = state;
  const gates = [...build.gates].sort((a, b) => {
    const da = decisions.approvals.find((x) => x.nodeId === a.nodeId) ? 1 : 0;
    const db = decisions.approvals.find((x) => x.nodeId === b.nodeId) ? 1 : 0;
    return da - db;
  });

  if (gates.length === 0) {
    return (
      <Empty
        title="This build has no gates."
        body="Gates are attached to the artifacts a human should see — the first board, a model sheet, the animatic, the final. A build with none has not reached them yet."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle note={`${gates.length} gate${gates.length === 1 ? '' : 's'}`}>Gate review</PanelTitle>
        <p className="max-w-3xl text-[13px] leading-relaxed" style={{ color: C.dim }}>
          Gates sit on cheap artifacts — a board, a model sheet, an animatic — because that is where
          a change is cheap. Approving one lets the work downstream of it run; sending it back costs
          a rebuild of that artifact and nothing else.
        </p>
      </Panel>

      {gates.map((gate) => {
        const node = build.nodes.find((n) => n.id === gate.nodeId);
        const shot = gate.shotId ? shotById(build, gate.shotId) : undefined;
        const decision = decisions.approvals.find((a) => a.nodeId === gate.nodeId);
        return (
          <Panel key={gate.id}>
            <div id={gate.nodeId} className="scroll-mt-24">
              <PanelTitle
                note={
                  <span className="flex items-center gap-2">
                    <code style={{ color: C.faint }}>{gate.nodeId}</code>
                    {node ? <Pill color={C.dim}>{node.status}</Pill> : null}
                  </span>
                }
              >
                {gate.title}
              </PanelTitle>
              <GateReview
                gate={gate}
                checks={node?.checks ?? []}
                decision={decision}
                frames={shot?.frames ?? []}
              />
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
