"""
Build Grease Pencil geometry from a plan. Requires `bpy`.

Grease Pencil changed shape in Blender 4.3: the old `bpy.types.GPencil`
datablock with `frame.strokes` became `bpy.types.GreasePencilv3`, where a
frame owns a `Drawing` and strokes are curve entries backed by attribute
arrays. Both are supported here, behind one interface, because a studio
does not get to insist everyone upgrade on the same afternoon — and
because silently rendering nothing on the version you happen to have
installed is exactly the kind of failure the engine refuses to ship.

Nothing creative is decided in this file. Every coordinate, colour and
line width arrives from the plan, which came from the Film Graph.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import bpy  # type: ignore

from plan import Plan, Layer, Stroke, hex_to_rgba

#: Grease Pencil v3 landed in 4.3.
GP_V3 = bpy.app.version >= (4, 3, 0)

#: Depth between consecutive layers, in Blender units. Large enough that
#: the sorter never has to break a tie, small enough that an orthographic
#: camera sees no parallax of its own.
LAYER_GAP = 0.02


def _material(name: str, fill: tuple[float, float, float, float] | None,
              stroke: tuple[float, float, float, float] | None) -> bpy.types.Material:
    """A Grease Pencil material, created once and reused by name."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    bpy.data.materials.create_gpencil_data(mat)
    gp = mat.grease_pencil
    gp.show_stroke = stroke is not None
    gp.show_fill = fill is not None
    if stroke is not None:
        gp.color = stroke
        gp.mode = "LINE"
        # A constant round cap is the engine's stroke model; anything
        # tapered would be a quality difference the substrate check
        # cannot distinguish from a rigging bug.
        gp.stroke_style = "SOLID"
    if fill is not None:
        gp.fill_color = fill
        gp.fill_style = "SOLID"
    return mat


def _material_key(stroke: Stroke) -> tuple[str, Any, Any]:
    fill = hex_to_rgba(stroke.fill, stroke.fill_alpha) if stroke.fill else None
    line = (
        hex_to_rgba(stroke.stroke_color, stroke.stroke_alpha)
        if stroke.stroke_color and stroke.stroke_width > 0
        else None
    )
    if fill is None and line is None:
        # A stroke with neither is a hole: it punches through what is
        # under it rather than drawing anything of its own.
        return ("holdout", None, None)
    name = "gp_" + "_".join(
        [
            f"f{'-'.join(f'{c:.3f}' for c in fill)}" if fill else "nofill",
            f"s{'-'.join(f'{c:.3f}' for c in line)}" if line else "noline",
        ]
    )
    return (name, fill, line)


def ensure_object(name: str, collection: bpy.types.Collection) -> bpy.types.Object:
    data = (
        bpy.data.grease_pencils_v3.new(name) if GP_V3 else bpy.data.grease_pencils.new(name)
    )
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


def _ensure_layer(data: Any, name: str) -> Any:
    if GP_V3:
        existing = data.layers.get(name) if hasattr(data.layers, "get") else None
        return existing or data.layers.new(name)
    existing = data.layers.get(name)
    return existing or data.layers.new(name, set_active=False)


def _slot_for(obj: bpy.types.Object, stroke: Stroke) -> int:
    name, fill, line = _material_key(stroke)
    if name == "holdout":
        mat = bpy.data.materials.get("gp_holdout")
        if mat is None:
            mat = bpy.data.materials.new("gp_holdout")
            bpy.data.materials.create_gpencil_data(mat)
            mat.grease_pencil.show_fill = True
            mat.grease_pencil.show_stroke = False
            mat.grease_pencil.use_fill_holdout = True
    else:
        mat = _material(name, fill, line)
    for i, slot in enumerate(obj.material_slots):
        if slot.material is mat:
            return i
    obj.data.materials.append(mat)
    return len(obj.material_slots) - 1


def _write_strokes_v2(gp_frame: Any, obj: bpy.types.Object, plan: Plan,
                      strokes: Iterable[Stroke], depth: float) -> int:
    written = 0
    for s in strokes:
        if len(s.points) < 2:
            continue
        gs = gp_frame.strokes.new()
        gs.display_mode = "3DSPACE"
        gs.use_cyclic = s.cyclic
        gs.material_index = _slot_for(obj, s)
        gs.line_width = max(1, int(round(s.stroke_width * plan.line_scale * 100 * plan.units_per_pixel)))
        gs.points.add(len(s.points))
        for i, (x, y) in enumerate(s.points):
            bx, by = plan.to_blender(x, y)
            p = gs.points[i]
            p.co = (bx, by, depth)
            p.pressure = 1.0
            p.strength = 1.0
        written += 1
    return written


def _write_strokes_v3(drawing: Any, obj: bpy.types.Object, plan: Plan,
                      strokes: Iterable[Stroke], depth: float) -> int:
    usable = [s for s in strokes if len(s.points) >= 2]
    if not usable:
        return 0
    drawing.add_strokes([len(s.points) for s in usable])
    positions = drawing.attributes["position"].data
    radii = drawing.attributes["radius"].data if "radius" in drawing.attributes else None
    cursor = 0
    for curve, s in zip(drawing.strokes, usable):
        curve.cyclic = s.cyclic
        curve.material_index = _slot_for(obj, s)
        radius = max(0.0005, s.stroke_width * plan.line_scale * plan.units_per_pixel * 0.5)
        for (x, y) in s.points:
            bx, by = plan.to_blender(x, y)
            positions[cursor].vector = (bx, by, depth)
            if radii is not None:
                radii[cursor].value = radius
            cursor += 1
    return len(usable)


def build_shot(plan: Plan, collection: bpy.types.Collection | None = None) -> dict[str, Any]:
    """
    One Grease Pencil object per plan layer, one GP frame per plan frame.

    A layer keeps its own object so the compositor can reach it: depth of
    field, haze and blend modes are per-layer in the Film Graph and stay
    per-layer here.
    """
    scene = bpy.context.scene
    collection = collection or scene.collection
    depths = plan.layer_depths()
    ordered = sorted(plan.layer_ids(), key=lambda lid: depths.get(lid, 0.0))

    objects: dict[str, bpy.types.Object] = {}
    for index, layer_id in enumerate(ordered):
        obj = ensure_object(f"GP_{plan.shot_id}_{layer_id}", collection)
        # Back-to-front: the first layer sits furthest from the camera.
        obj.location = (0.0, 0.0, index * LAYER_GAP)
        objects[layer_id] = obj

    written = 0
    for pf in plan.frames:
        for layer in pf.layers:
            obj = objects[layer.id]
            data = obj.data
            gp_layer = _ensure_layer(data, layer.id)
            gp_layer.opacity = layer.opacity
            gp_layer.blend_mode = _blend_mode(layer.blend)
            gp_frame = gp_layer.frames.new(pf.frame + 1)  # Blender frames are 1-based
            if GP_V3:
                written += _write_strokes_v3(
                    gp_frame.drawing, obj, plan, sorted(layer.strokes, key=lambda s: s.z), 0.0
                )
            else:
                written += _write_strokes_v2(
                    gp_frame, obj, plan, sorted(layer.strokes, key=lambda s: s.z), 0.0
                )

    return {
        "objects": objects,
        "strokes": written,
        "order": ordered,
        "gp_version": 3 if GP_V3 else 2,
    }


def _blend_mode(blend: str) -> str:
    return {
        "normal": "REGULAR",
        "multiply": "MULTIPLY",
        "screen": "SCREEN",
        "add": "ADD",
        "overlay": "OVERLAY",
    }.get(blend, "REGULAR")
