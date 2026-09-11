"""
Headless Grease Pencil render of one shot.

    blender --background --factory-startup \
            --python blender/render_shot.py -- \
            --plan build/plans/sh010.json --out build/blender/sh010

`--factory-startup` is not optional: a user's saved preferences can change
the colour management, the render engine and the frame rate, and a
substrate whose output depends on who is logged in is not a substrate.

What this script guarantees:

  * **Colour is Standard, not a look.** AgX or Filmic would tone-map the
    art department's colour script into something else. The engine's own
    renderer writes sRGB, the comparison is pixel-for-pixel, and a view
    transform here would make every frame disagree for a reason that has
    nothing to do with the drawing.
  * **Framing is exact.** An orthographic camera is fitted to the frame
    rectangle, so a point at pixel (x, y) in the plan lands at pixel
    (x, y) in the render. That is what makes `substrate.agreement`
    meaningful rather than decorative.
  * **It refuses rather than guesses.** A plan carrying elements this
    substrate cannot express fails unless `--allow-unsupported` is
    passed, and even then the omission is printed and written into the
    render report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# Blender runs this file directly, so its directory is not on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # type: ignore

from plan import Plan, load_plan, summarise, hex_to_rgba
import gp_build


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    ap = argparse.ArgumentParser(prog="render_shot.py")
    ap.add_argument("--plan", required=True, help="path to the exported plan JSON")
    ap.add_argument("--out", required=True, help="directory for the rendered frames")
    ap.add_argument("--samples", type=int, default=16, help="EEVEE samples")
    ap.add_argument("--engine", default="BLENDER_EEVEE_NEXT", help="render engine id")
    ap.add_argument("--scale", type=float, default=1.0, help="resolution multiplier")
    ap.add_argument("--frame", type=int, default=None, help="render a single frame")
    ap.add_argument("--save-blend", default=None, help="also write a .blend here")
    ap.add_argument("--allow-unsupported", action="store_true")
    ap.add_argument("--transparent", action="store_true", help="render on alpha")
    return ap.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_scene(plan: Plan, args: argparse.Namespace) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = _resolve_engine(args.engine)
    scene.render.resolution_x = int(plan.width * args.scale)
    scene.render.resolution_y = int(plan.height * args.scale)
    scene.render.resolution_percentage = 100
    scene.render.fps = plan.fps
    scene.render.film_transparent = bool(args.transparent)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if args.transparent else "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 90
    scene.render.use_motion_blur = False
    scene.render.filter_size = 1.5

    # Determinism and colour fidelity. See the module docstring.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    scene.sequencer_colorspace_settings.name = "sRGB"

    if hasattr(scene, "eevee"):
        for attr, value in (
            ("taa_render_samples", args.samples),
            ("use_motion_blur", False),
            ("use_bloom", False),
            ("use_gtao", False),
        ):
            if hasattr(scene.eevee, attr):
                setattr(scene.eevee, attr, value)

    first, last = plan.frame_range()
    scene.frame_start = first + 1
    scene.frame_end = last + 1

    _setup_world(plan, transparent=bool(args.transparent))
    camera = _setup_camera(plan)
    return camera


def _resolve_engine(requested: str) -> str:
    """
    Fall back rather than crash on a Blender whose engine ids differ.

    4.2 renamed EEVEE to `BLENDER_EEVEE_NEXT`; 4.1 and earlier use
    `BLENDER_EEVEE`. Picking the wrong one aborts the render with an enum
    error three minutes into a farm job.
    """
    try:
        options = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    except Exception:
        return requested
    if requested in options:
        return requested
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        if candidate in options:
            print(f"[render_shot] engine {requested!r} unavailable, using {candidate!r}")
            return candidate
    return requested


def _setup_world(plan: Plan, transparent: bool) -> None:
    world = bpy.data.worlds.new("FilmWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = hex_to_rgba(plan.background, 1.0)
        # The plan's background is a paint colour, not a light source.
        bg.inputs[1].default_value = 0.0 if transparent else 1.0


def _setup_camera(plan: Plan) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new("FilmCamera")
    cam_data.type = "ORTHO"
    # The plan maps the frame's full width onto FRAME_WIDTH_UNITS, so an
    # orthographic scale of exactly that width frames it edge to edge.
    cam_data.ortho_scale = plan.width * plan.units_per_pixel
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("FilmCamera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 20.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def render(plan: Plan, args: argparse.Namespace) -> dict:
    os.makedirs(args.out, exist_ok=True)
    scene = bpy.context.scene
    built = gp_build.build_shot(plan)

    frames = [f.frame for f in plan.frames]
    if args.frame is not None:
        frames = [args.frame]

    written: list[dict] = []
    for frame in frames:
        scene.frame_set(frame + 1)
        path = os.path.join(args.out, f"{plan.shot_id}.{frame:05d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append({"frame": frame, "path": path})

    if args.save_blend:
        os.makedirs(os.path.dirname(os.path.abspath(args.save_blend)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))

    return {
        "shotId": plan.shot_id,
        "planHash": plan.plan_hash,
        "substrate": "blender_gp",
        "blenderVersion": ".".join(str(v) for v in bpy.app.version),
        "greasePencilVersion": built["gp_version"],
        "engine": scene.render.engine,
        "viewTransform": scene.view_settings.view_transform,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "fps": scene.render.fps,
        "strokes": built["strokes"],
        "layerOrder": built["order"],
        "frames": written,
        "unsupported": [s.tag for s in plan.unsupported()],
    }


def main() -> int:
    args = parse_args(list(sys.argv))
    plan = load_plan(args.plan)
    print(summarise(plan))

    missing = plan.unsupported()
    if missing and not args.allow_unsupported:
        print(
            f"[render_shot] refusing to render: {len(missing)} element(s) cannot be "
            "expressed as Grease Pencil strokes. Rendering anyway would produce a "
            "frame that silently omits them. Pass --allow-unsupported to accept an "
            "incomplete render; substrate agreement will still fail.",
            file=sys.stderr,
        )
        return 2

    clear_scene()
    setup_scene(plan, args)
    report = render(plan, args)

    report_path = os.path.join(args.out, "render.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"[render_shot] wrote {len(report['frames'])} frame(s) and {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
