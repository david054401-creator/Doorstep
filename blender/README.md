# Blender Grease Pencil substrate

The engine renders every frame itself, deterministically, with no
dependencies. That renderer is the **baseline**: it always runs, it is
byte-reproducible, and every gate in the pipeline is calibrated against
it.

This directory is the **production substrate**. Blender's Grease Pencil
gives real line quality, textured fills, depth of field and compositing —
things a scanline rasteriser should not be pretending to do. Both
substrates are driven from the same Film Graph, and the swap between them
is checked rather than trusted.

```
Film Graph ──▶ Scene (the last structured artifact before pixels)
                 ├──▶ engine renderer ──▶ baseline frames
                 └──▶ plan.json ──▶ Blender GP ──▶ production frames
                                         │
                        substrate.agreement compares the two
```

## Files

| File | Runs in | What it is |
| --- | --- | --- |
| `plan.py` | plain Python | The plan format: load, validate, and convert coordinates and colour. No `bpy`, so it is checkable in CI. |
| `gp_build.py` | Blender | Builds Grease Pencil objects, layers, frames and materials from a plan. Handles both the pre-4.3 `GPencil` API and the 4.3+ `GreasePencilv3` one. |
| `render_shot.py` | Blender | Headless entry point: scene setup, camera fit, render, report. |
| `test_plan.py` | plain Python | Tests for the format contract. `python3 blender/test_plan.py` |

## Use

Export plans from the Film Graph:

```bash
cd engine
node bin/film.mjs export-blender --out ../out
```

Render one shot:

```bash
blender --background --factory-startup \
        --python blender/render_shot.py -- \
        --plan out/plans/<shot>.json \
        --out out/blender/<shot> \
        --samples 16
```

Useful flags: `--scale 2` (render at twice the delivery resolution),
`--frame N` (one frame), `--transparent` (render on alpha, for plates),
`--save-blend path.blend` (keep the scene for a human to open),
`--allow-unsupported` (render a plan with known holes anyway).

## Why these choices

**`--factory-startup` is not optional.** A user's saved preferences can
change the render engine, the colour management and the frame rate. A
substrate whose output depends on who is logged in is not a substrate.

**The view transform is `Standard`.** AgX and Filmic are film *looks*;
they would tone-map the art department's colour script into something
else. The colour script is approved upstream as sRGB values, the baseline
renderer writes sRGB, and the comparison between them is only meaningful
if Blender does too. Hex colours are converted to linear light in
`plan.py` before they ever reach a Blender socket — handing an sRGB
triple to a linear socket is the classic way to get a film that is subtly
the wrong colour in every frame.

**The camera is orthographic and fitted to the frame.** A point at pixel
`(x, y)` in the plan lands at pixel `(x, y)` in the render. Multiplane
parallax is already resolved in the Film Graph, per layer, by the same
camera code the baseline renderer uses — so the two substrates cannot
disagree about where anything is. Layers are still separate objects at
separate depths, which is what lets Blender apply real depth of field.

**One Blender unit is not one pixel.** The frame is always 16 units wide,
so re-rendering a plan at 4K keeps the same scene scale, the same camera
and the same depth-of-field numbers as the HD version that was approved.

**It refuses rather than guesses.** Raster inserts have no Grease Pencil
stroke representation. The exporter records them as `unsupported:` tags
instead of dropping them, and `render_shot.py` exits non-zero rather than
producing a frame that is silently missing part of the picture.

## Version support

Grease Pencil was rewritten in Blender 4.3: `bpy.data.grease_pencils`
became `bpy.data.grease_pencils_v3`, and strokes moved from
`frame.strokes` to attribute arrays on a `Drawing`. `gp_build.py` detects
the version and uses the matching API. The render report records which
one ran, so a frame difference can always be traced to the substrate that
produced it.
