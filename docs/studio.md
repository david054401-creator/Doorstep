# The studio

The product surface: a shot board, a QA dashboard, an animatic player,
gate review with draw-over notes, a director's notes box, and score
sheets. It lives at `/studio` in the Next.js app.

## The seam

The engine does not serve HTTP and the studio does not compute scores.
Between them is a **build directory**:

```
out/studio/
  studio.json        the run: nodes, checks, repairs, escalations, invariants
  decisions.json     human decisions: gate approvals and director notes
  project.json       the Film Graph the run measured
  frames/<shot>/     preview frames for the animatic
  boards/<shot>.png  the board for each shot
  contact/<shot>.png a contact sheet per shot
```

Three things follow from that shape:

- **The UI cannot invent a number.** Every score, check, repair and
  escalation it shows came out of a real run, and the footer carries the
  hash of the graph that was measured.
- **A build is archivable and diffable.** "What did we approve on
  Tuesday" is a directory, not a database query.
- **Human decisions survive a rebuild.** Approvals and notes are written
  to `decisions.json`, which the next engine run reads back and replays,
  so re-rendering the frames does not un-approve the film.

## Running it

```bash
cd engine
node bin/film.mjs studio --out ../out/studio

cd ..
FILM_STUDIO_BUILD=$PWD/out/studio npm run dev
# → http://localhost:3000/studio
```

| Variable | Meaning |
| --- | --- |
| `FILM_STUDIO_BUILD` | Build directory to read. Defaults to `./out/studio`. |
| `FILM_ENGINE_BIN` | Path to `bin/film.mjs`, used to parse director notes. Defaults to `./engine/bin/film.mjs`. |

Useful flags on `film studio`:

| Flag | Meaning |
| --- | --- |
| `--preview-width <n>` | Frame width written for the animatic (default 640). The delivery master is written separately, full size. |
| `--every <n>` | Write every Nth frame. |
| `--gates hold \| approve` | Whether the CLI stands in for the director. `hold` is the default and the honest one; `approve` records in the build's caveats that no person looked. |

Frames are served by a route handler rather than out of `public/`,
because a build is an artifact of a run, can be gigabytes, and is chosen
at runtime. `resolveAsset` refuses any path that climbs out of the build
directory.

## The pages

**Overview** — the score, the delivery verdict, per-department rollup,
what is waiting on a human, the lowest-scoring shots, every escalation in
full, and the state of all thirteen invariants. The delivery verdict is
stated first because it is the only question the build can answer on its
own.

**Shots** — the board, in cut order. Not sorted by score: a board is a
reading of the film in sequence, and re-sorting it by quality would
destroy the one thing it is for.

**A shot** — the animatic player, the beat strip, the checks, the
pipeline nodes that produced it, the contact sheet, and the notes. The
player runs on a real clock rather than a `setInterval`, because at 24fps
a 16ms timer drifts about a frame per second and an animator looking for
a two-frame hitch would be watching the player's error instead of the
film's. Step, scrub and loop all address integer frames, and the frame
number is always on screen.

**QA** — every check the run produced, filterable by department,
severity and text, failures first. Beside it, what the repair loop
actually did: which diagnosis, which move, and the score delta, including
the repairs that were rolled back. A dashboard that collapses "passed"
and "failed then was repaired by widening the elbow limit" into one green
tick is hiding the engine's behaviour.

**Gates** — the artifact, the checks that already ran on it, a draw-over
canvas, and two buttons. Rejection requires a reason, because a rejection
with no reason sends the pipeline back around the loop with nothing to
act on. Approving an artifact that has failing checks is allowed and is
recorded under the approver's name.

**Notes** — every note on the build, what the engine turned each one
into, and whether it has been answered. Notes the engine could not route
get their own section: an unmapped note is work for a person, not
something to drop.

**Contract** — the thirteen invariants with their statements, their
evidence checks, their calibration guidance, and their state. **Held**,
**broken** and **unmeasured** are three states here and always will be.

## Draw-over notes

A director points at the frame. That gesture is the note, and losing it
to a paraphrase — "the arm is a bit stiff around the elbow" — is how a
review round gets wasted. Marks are captured in normalised 0..1
coordinates against the frame that was on screen, so they survive a
re-render at a different resolution and can be replayed over the fixed
version to check it.

## What the studio deliberately cannot do

There is no curve editor, no key nudger, no "tweak this frame". Law 5:
the human is the director, not the animator. The two powers the studio
grants are approving a gate and giving a note, and both are recorded as
structured decisions that the engine replays. Everything else is the
engine's job, and if the engine does it badly the fix is a repair move
with a test, not a hand edit that the next render silently discards.
