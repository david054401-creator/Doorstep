# Conformance

Where each thing the blueprint asks for actually lives, and how to check
it yourself. Every row names a file and a way to run it.

## The five keystone laws

**1. Structure first, pixels last.**
Every stage emits a typed artifact in `engine/src/graph/types.ts` —
script, boards, model sheets, rigs, key poses, channels, timing charts,
staging, camera curves, layer stacks. `render/scene.ts` is the last
structured artifact before pixels, and `render/renderer.ts` turns it into
a frame with no further decisions. Nothing in the renderer chooses
anything.

```bash
cd engine && node bin/film.mjs validate      # everything, without rendering a pixel
```

**2. Nothing advances without passing a gate that can see.**
`orchestrator/runner.ts` runs `run → validate → commit`, and a node's
dependents do not run until it passes. A node cannot report success
without a score sheet: `NodeResult.scoreSheet` is populated by the runner
itself, not by the node. Human gates block outright, and the escalation
says so in words.

```bash
cd engine && node bin/film.mjs studio --out ../out/studio   # gates hold by default
```

**3. Repair, never retry.**
Every failing check carries a `diagnosis`. `director/repair-table.ts`
(18 moves) and `rig/repair.ts` (10 moves) map a diagnosis to a named
operation on the named artifact. The loop re-measures, rolls back
anything that lowered the score, and escalates with a card when the
budget runs out. There is no re-roll anywhere in the codebase.

**4. Taste is code.**
`director/principles.ts` — the twelve principles as thresholds.
`examples/mibo/design.ts` — the style bible, with an explicit forbidden
list. `critics/vlm/rubrics.ts` — the critics' rubrics.
`critics/calibration.ts` — the 0.9-agreement bar a critic must clear
before it may block anything.

**5. The human is the director, not the animator.**
The studio grants exactly two powers: approve or reject a gate, and give
a note. There is no curve editor. `director/notes.ts` turns a note into
structured edits and reports the ones it does not understand as not
understood.

```bash
cd engine && node bin/film.mjs note "more punch on the jump" --json
```

## The design laws

| Law | Where it lives |
| --- | --- |
| One source of truth | `graph/types.ts` is the only IR. Every department reads and writes it and nothing else. |
| Three-way validation | Deterministic checks in `validators/`, perceptual metrics in `critics/tier1/`, human gates in `orchestrator/runner.ts`. |
| Generative models only inside bounded tasks | `providers/` and `critics/types.ts` are the only seams a model can enter through, and each is a named task with a schema. |
| A deterministic render substrate is the baseline | `render/renderer.ts`. Same scene, same bytes. `validators/substrate.ts` proves a swap to Blender changed nothing structural. |
| Immutable, content-addressed artifacts with provenance | `core/ids.ts`, `graph/store.ts`, `orchestrator/cache.ts`. Binary payloads are content-addressed blobs, deduped across entries. |
| Budgeted loops, honest escalation | `orchestrator/budget.ts` and the runner's `minImprovement` policy. No node says "done" without a score sheet. |
| The style bible is injected, not implied | `validateBibleConformance` in `validators/color.ts`; every rubric prompt renders the bible into itself. |
| Human gates on cheap artifacts only | Gates sit on boards, model sheets and the animatic — never on a finished render. |
| Upstream changes invalidate downstream | `graph/store.ts` `invalidationBetween` and `staleShots`, with build-system semantics. |
| Never train on, clone, or name a studio | MIBO, the meadow and the bible in `examples/` are original. Nothing here is trained on or derived from anyone's frames, and no studio is named anywhere in the product. |

## The thirteen invariants

`engine/src/validators/invariants.ts`. Each names the checks that
establish it and whether a failure blocks delivery.

```bash
cd engine && node bin/film.mjs contract
```

| # | Invariant | Established by |
| --- | --- | --- |
| 1 | The rig is sound | `rig/validators.ts`, the 20-pose battery across 5 views |
| 2 | Identity holds | `validators/identity.ts`, subject-anchored descriptor or a learned embedding |
| 3 | Volume is conserved | `principle.volume_per_frame`, per-part area tracking |
| 4 | Motion travels on arcs | `principle.arcs`, cubic fit per action span |
| 5 | The pose reads in silhouette | `geom/silhouette.ts`, solidity and line of action |
| 6 | The organic pass earns its place | tier-1 metrics against the rig render; it ships only if it wins |
| 7 | Colour is on model and reads | `validators/color.ts`, CIEDE2000 and L* separation |
| 8 | Continuity holds | `story/validators.ts`, `director/grammar.ts` |
| 9 | Lipsync lands | `animation/lipsync.ts`, phoneme drift against the forced alignment |
| 10 | The mix is deliverable | `audio/loudness.ts`, ITU-R BS.1770-4 |
| 11 | It is safe to watch | `validatePhotosensitivity`, Harding-style |
| 12 | Delivery is exact | `delivery/sequence.ts`, resolution, fps, colour space, frame count |
| 13 | A person approved it | `HumanApproval` records in the graph |

`auditInvariants` returns **held**, **broken** or **unmeasured**. A
blocking invariant that nobody measured blocks delivery exactly as a
broken one does.

## Substrates

| | Baseline | Production |
| --- | --- | --- |
| Where | `engine/src/render/renderer.ts` | `blender/` |
| Dependencies | none | Blender 4.x |
| Determinism | byte-identical | fixed seed, `--factory-startup`, Standard view transform |
| Proven equivalent by | — | `validators/substrate.ts` |

```bash
cd engine && node bin/film.mjs export-blender --out ../out
blender --background --factory-startup --python blender/render_shot.py -- \
        --plan out/plans/<shot>.json --out out/blender/<shot>
python3 blender/test_plan.py      # the format contract, no Blender needed
```

## The product UI

`src/app/studio/` — shot board, QA dashboard with the repair history,
frame-exact animatic player, gate review with draw-over notes, the
director's notes box, score sheets, and the contract. See
[`studio.md`](studio.md).

## Monday

> *Push one 20-second MIBO shot through the whole thing. Nothing else
> matters until that exists.*

It exists, and then some: nine shots, ~24 seconds, script to delivery.

```bash
cd engine
node bin/film.mjs studio --out ../out/studio --gates approve
cd .. && FILM_STUDIO_BUILD=$PWD/out/studio npm run dev      # → /studio
```

## Running everything

```bash
cd engine
node --test 'tests/*.test.ts'    # the engine
npx tsc --noEmit                 # types
cd .. && python3 blender/test_plan.py
npx eslint src/app/studio src/components/studio src/lib/studio
npx next build
```
