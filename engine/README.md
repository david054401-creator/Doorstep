# 2D Feature Engine

Intent to structured film to verified frames.

Most AI animation fails the same way: it generates **pixels first** and
hopes the structure emerges. It never does. Characters drift off model,
volumes breathe, feet skate, and every fix is a re-roll of the dice.

This engine inverts the order. Every stage emits a structured,
machine-readable artifact — script, boards, model sheets, rigs, keys,
curves, layers, comp — and pixels are the last, deterministic step. The
artifacts are what get validated, repaired and approved. A frame is a
consequence, not a guess.

```
intent ─▶ script ─▶ boards ─▶ sheets ─▶ rigs ─▶ blocking ─▶ curves
                                                              │
                       layers ◀─ comp ◀─ render ◀─ animation ─┘
```

## The five laws

1. **Structure first, pixels last.** Every stage emits a machine-readable
   artifact. Rendering is the final deterministic step.
2. **Nothing advances without passing a gate that can see.** Every stage
   is measured, and no stage reports success without a score sheet.
3. **Repair, never retry.** A failure produces a diagnosis and a targeted
   fix against the named artifact — never a re-roll.
4. **Taste is code.** The style bible, the twelve principles and the
   critics' rubrics are versioned files with thresholds, not vibes.
5. **The human is the director, not the animator.** People give notes and
   approve gates. They do not push keys, and the engine never claims
   "one prompt, one film".

## Quick start

Node 22 or newer. No install step — the engine core has zero runtime
dependencies and runs straight off its TypeScript sources through Node's
native type stripping.

```bash
cd engine

node bin/film.mjs demo                 # build the MIBO example project
node bin/film.mjs validate             # validate without rendering
node bin/film.mjs rig                  # rig every character, run the pose battery
node bin/film.mjs battery char_mibo    # 20-pose battery as a contact sheet
node bin/film.mjs render --out ../out  # render frames + delivery manifest
node bin/film.mjs contract             # audit against the thirteen invariants
node bin/film.mjs note "more punch on the jump"
node --test 'tests/*.test.ts'          # the test suite
```

To review a build in the studio UI:

```bash
node bin/film.mjs studio --out ../out/studio
cd .. && FILM_STUDIO_BUILD=$PWD/out/studio npm run dev   # → /studio
```

To render through Blender's Grease Pencil instead of the built-in
rasteriser, see [`../blender/README.md`](../blender/README.md).

## What is in here

| Area | Path | What it is |
| --- | --- | --- |
| Film Graph | `src/graph/` | The one canonical IR. Hand-written types with no dependencies; Zod schemas as the validation boundary; a content-addressed store with build-system invalidation. |
| Core | `src/core/` | Vectors and matrices, robust polynomial fitting, CIELAB and CIEDE2000, check results and score sheets, seeded RNG, content hashing, units. |
| Raster | `src/raster/` | Analytic scanline anti-aliased fills, stroking, blur and haze, and a PNG codec over `node:zlib`. Byte-reproducible. |
| Rigging | `src/rig/` | Planar dual-quaternion skinning, analytic two-bone IK, FABRIK, spring bones, five-view skeletons, a twenty-pose battery and a bounded repair loop. |
| Animation | `src/animation/` | Blocking from beats, an asymmetric pose library, walk and run cycles with footstep-driven root motion, curve evaluation, additive idle layers, secondary motion, forced-alignment-compatible lipsync. |
| Timing | `src/timing/` | Easing, curves with real handles, ones-and-twos charts, timing templates. |
| Director | `src/director/` | The twelve principles as measurable metrics, shot grammar, the repair table, and the note parser. |
| Critics | `src/critics/` | Tier-1 perceptual metrics that always run, a VLM client and ensemble, rubrics, and the calibration gate that decides whether a critic may block. |
| Validators | `src/validators/` | Colour, comp, identity, substrate agreement, and the thirteen hard invariants. |
| Orchestrator | `src/orchestrator/` | The department DAG, the node runner with repair and rollback, the content-addressed cache, and the producer's budget ledger. |
| Delivery | `src/delivery/` | Frame sequences, contact sheets, delivery manifests, the Blender export, and the studio build. |

## Honesty rules this codebase keeps

- **Unmeasured is never reported as passed.** An invariant nobody checked
  is a third state, shown as such, and it blocks delivery exactly like a
  broken one.
- **Every check states a number.** Not "failed" — `0.83 against a 0.95
  floor`, with a locator and, where it exists, a rendered frame.
- **A repair that makes the score worse is rolled back**, and a loop that
  runs out of budget escalates with a diagnosis card rather than
  declaring victory.
- **A stand-in metric is named as a stand-in.** The deterministic
  perceptual distance is not LPIPS and never claims to be; the identity
  descriptor is not DINOv2. The provider seam is where the learned model
  goes, and until one is configured the checks say so.
- **A false failure is as bad as a missed one.** A check that flags
  correct work teaches people to ignore the report. Foreshortening in a
  three-quarter view is not going off model; an eased move over a long
  hold is not a stutter; a foot settling two pixels onto the ground is
  not skating. Each of those was a real bug in a validator, found by
  rendering the demo and looking at it.
- **No studio is trained on, cloned, or named.** "Feature-level" is a
  craft bar to clear with our own style bible and our own characters.

## Licence and provenance

The demo project, MIBO, and the style bible in `examples/` are original
work. Nothing here is trained on, derived from, or imitative of any
studio's frames, characters or named house style.
