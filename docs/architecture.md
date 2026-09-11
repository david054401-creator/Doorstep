# Architecture

> Every claim in this document is backed by code in `engine/src` and by a
> test in `engine/tests`. Where something is a stand-in for a learned
> model, it says so.

## The thesis

AI animation demos fail because they generate **pixels first**. A
diffusion model given "a small robot walks across a meadow" produces
twenty-four plausible images a second and no two of them are the same
robot. Nothing in the process can answer "is the elbow in the right
place", because nothing in the process ever represented an elbow.

So the engine inverts the order. The pipeline is a chain of structured
artifacts, each one machine-readable, each one measurable, each one
repairable in place:

```
script ─▶ boards ─▶ model sheets ─▶ rigs ─▶ blocking ─▶ curves
                                                          │
                  delivery ◀─ comp ◀─ render ◀─ layers ◀──┘
```

Pixels are the final deterministic step. If the render is wrong, the
structure was wrong, and the structure is the thing you can point at.

## The Film Graph

`engine/src/graph/types.ts` is the whole IR: project, style bible,
characters, model sheets, rigs, environments, sequences, scenes, shots,
beats, key poses, channels, timing charts, staging, camera curves, layer
stacks, audio, validation records, repairs and notes.

Three properties make it the single source of truth rather than one
format among several:

**It has no dependencies.** The types are hand-written. The engine core
runs on a machine with no `node_modules` at all, straight off its
TypeScript sources through Node 22's native type stripping. That is not
asceticism; it is what lets the renderer be trusted as a baseline.

**Its boundary is real.** `engine/src/graph/schema.ts` mirrors every type
as a Zod schema, declared `z.ZodType<T>` against the hand-written type so
the compiler rejects a schema that drifts. Nothing crosses into the
engine from disk, an API or a model without being parsed there. A check
with no message, a critic verdict with no frame citation and a score
outside 0..1 are all rejected at the boundary — tested in
`tests/orchestrator.test.ts`.

**It is content-addressed.** `engine/src/graph/store.ts` hashes the graph,
records provenance on every artifact, and computes invalidation the way a
build system does: change a model sheet and exactly the shots that
reference it go stale.

## Departments as a DAG

`engine/src/orchestrator/pipeline.ts` turns a project into a graph of
department nodes — story, visdev, character, rigging, layout, audio,
boards, animation, render — and `runner.ts` executes it:

```
run(node) ─▶ validate
   pass → commit, advance
   fail → diagnose → repair this node only → re-validate
          over budget → escalate with a card
```

Three guarantees the runner exists to provide:

- Nothing advances past a failed gate. A blocked node's dependents do not
  run, and the escalation says so in words: *there is no path from failed
  to done that skips a human.*
- A node never reports "done" without a score sheet.
- A repair that lowers the score is rolled back, and one that does not
  improve it by at least `minImprovement` stops the loop rather than
  burning the budget.

## Rigging, and why it is the hard part

Identity is the failure everyone recognises: the character who is subtly
a different character in every shot. A rig makes it *mostly* impossible,
which is why so much of the engine is rigging.

**Skinning is planar dual-quaternion** (`engine/src/rig/skin.ts`). Linear
blend skinning collapses a joint at large angles — the candy-wrapper
artifact — and a cut-out character bends further than a 3D one ever does.
The dual quaternion `d = ½·t·q̄` interpolates rotation and translation
together and keeps the volume. That conjugate is load-bearing: writing
the planar case with complex numbers hides that the underlying quaternion
product has `i·k = −j`, and getting the sign wrong produced 8998% volume
drift where the correct form gives 24%.

**Influence is bounded and topological.** A drawing spans an ordered
chain of bones and is weighted by arc length along it, as a partition of
unity. Joint neighbours are capped at 50% influence. Hinges are found
topologically, in canonical space, and bands are sized to the part's own
extent — not a global constant that is wrong for both a finger and a
thigh.

**Views are projected, not reused.** A five-angle turnaround gets a
skeleton per view, with mass projected by depth. Projecting only position
and not width is what collapses a side view into a sliver.

**The battery is the gate.** Twenty extreme poses across five views,
checked for inverted triangles, volume drift, joint collapse and
self-intersection. The rig ships at zero inversions or it does not ship.
`engine/src/rig/repair.ts` holds a ten-move repair table and runs it to a
budget with rollback and an escalation card.

## Taste as code

**The twelve principles are measurements** (`engine/src/director/principles.ts`).
Arcs are a cubic fit to the end-effector path, per action span, split at
reversals, with trailing holds excluded and the travel threshold scaled
to head units — because measuring an arc across a pose change or across a
hold produces a number that means nothing. Volume, squash-and-stretch,
overlap phase lag, twinning, foot slide, anticipation, staging, appeal
and exaggeration each have a threshold and a diagnosis that routes into
the repair table.

**The style bible is injected, not implied.** Palette, shape language,
line rules, lighting rules and an explicit forbidden list, versioned and
referenced by every prompt and every conformance check.

**Critics are calibrated before they may block.** `engine/src/critics/`
ships a tier-1 stack of deterministic perceptual metrics that always run,
and a VLM ensemble behind a provider seam. A vision verdict must cite
frames to be admissible, and an uncalibrated critic advises rather than
gates — the bar is 0.9 agreement with a human-labelled set on the broken
class.

**Stand-ins are named.** `perceptualDistance` is not LPIPS.
`identityDescriptor` is not DINOv2. Both say so in the check they
produce, and the provider interface is where the real model goes.

## Repair, not retry

A failing check carries a `diagnosis`. The repair table maps a diagnosis
to a named operation on the named artifact — `widen_joint_limit`,
`rebind_weights`, `add_overshoot`, `stagger_overlap`, `rerender_from_sheet`
— and the loop applies one, re-measures, and keeps it only if the score
improved.

This is the difference between a system you can direct and a slot
machine. "More punch on the jump" parses
(`engine/src/director/notes.ts`) into a structured edit with a rationale
the director reads *before* anything re-renders, and a note the engine
cannot understand is reported as not understood rather than guessed at.

## The contract

Thirteen hard invariants (`engine/src/validators/invariants.ts`), each
with the checks that establish it and whether a failure blocks delivery:

| # | Invariant |
| --- | --- |
| 1 | The rig is sound |
| 2 | Identity holds |
| 3 | Volume is conserved |
| 4 | Motion travels on arcs |
| 5 | The pose reads in silhouette |
| 6 | The organic pass earns its place |
| 7 | Colour is on model and reads |
| 8 | Continuity holds |
| 9 | Lipsync lands |
| 10 | The mix is deliverable |
| 11 | It is safe to watch |
| 12 | Delivery is exact |
| 13 | A person approved it |

`auditInvariants` returns three states, not two: **held**, **broken** and
**unmeasured**. A blocking invariant that was never measured blocks
delivery exactly as a broken one does. This is the single most important
line in the codebase: a build does not get to call itself finished on the
strength of a check that did not run.

## Render substrates

The built-in renderer (`engine/src/render/renderer.ts`) is deterministic,
CPU-only and dependency-free: analytic scanline coverage, union fills so
strokes do not double-darken at joins, per-layer multiplane cameras,
depth-of-field blur and atmospheric haze, and a PNG codec with adaptive
Paeth filtering. The same scene renders to the same bytes.

Blender Grease Pencil is the production substrate
(`blender/`, exported by `engine/src/delivery/blender.ts`). Both are
driven from the same Film Graph, and the swap is *checked*:
`validateSubstrateAgreement` measures the net optical-flow displacement
between the two renders, so a substrate is allowed to draw a better line
but not to put it somewhere else. A two-pixel shift — exactly what a
wrong pixel-centre convention produces — fails.

## The studio

The engine writes a build directory; the studio reads it. See
[`studio.md`](studio.md).
