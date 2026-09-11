"""
Film Graph -> Grease Pencil: the plan format.

This module is deliberately free of `bpy`. It loads, validates and
normalises the JSON that `film export-blender` writes, so the plan can be
checked on a machine with no Blender installed — in CI, or before a render
farm submission — and so the Blender-side code has nothing to do but
build geometry.

Coordinates arrive in the engine's raster space: x right, y DOWN, origin
at the top-left of the frame, in pixels. Blender is y-up with the origin
in the middle, so `to_blender` is the single place that conversion
happens. Doing it anywhere else is how a film ends up mirrored.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

PLAN_VERSION = 1

#: Blender units per pixel. One frame is 16 units wide regardless of the
#: delivery resolution, so a plan re-rendered at 4K keeps the same scene
#: scale, the same camera and the same depth-of-field numbers.
FRAME_WIDTH_UNITS = 16.0


class PlanError(ValueError):
    """The plan is not something we are willing to render."""


@dataclass(frozen=True)
class Stroke:
    id: str
    points: tuple[tuple[float, float], ...]
    cyclic: bool
    role: str
    z: float
    fill: str | None = None
    fill_alpha: float = 1.0
    stroke_color: str | None = None
    stroke_width: float = 0.0
    stroke_alpha: float = 1.0
    tag: str | None = None
    owner_id: str | None = None

    @property
    def unsupported(self) -> bool:
        return bool(self.tag and self.tag.startswith("unsupported:"))


@dataclass(frozen=True)
class Layer:
    id: str
    kind: str
    z: float
    opacity: float
    blend: str
    blur: float
    parallax: float
    strokes: tuple[Stroke, ...]
    haze: dict[str, Any] | None = None
    owner_id: str | None = None


@dataclass(frozen=True)
class Frame:
    frame: int
    layers: tuple[Layer, ...]


@dataclass
class Plan:
    version: int
    shot_id: str
    project: str
    fps: int
    width: int
    height: int
    background: str
    line_scale: float
    frames: list[Frame] = field(default_factory=list)
    plan_hash: str = ""
    notes: list[str] = field(default_factory=list)

    # -- derived -----------------------------------------------------------

    @property
    def units_per_pixel(self) -> float:
        return FRAME_WIDTH_UNITS / float(self.width)

    @property
    def aspect(self) -> float:
        return self.width / float(self.height)

    def to_blender(self, x: float, y: float) -> tuple[float, float]:
        """Raster pixel (y down, top-left origin) -> Blender XY (y up, centred)."""
        u = self.units_per_pixel
        return ((x - self.width / 2.0) * u, (self.height / 2.0 - y) * u)

    def frame_range(self) -> tuple[int, int]:
        if not self.frames:
            return (0, 0)
        numbers = [f.frame for f in self.frames]
        return (min(numbers), max(numbers))

    def unsupported(self) -> list[Stroke]:
        return [
            s
            for f in self.frames
            for l in f.layers
            for s in l.strokes
            if s.unsupported
        ]

    def layer_ids(self) -> list[str]:
        """Every layer id in the plan, in draw order, first appearance wins."""
        seen: list[str] = []
        for f in self.frames:
            for l in f.layers:
                if l.id not in seen:
                    seen.append(l.id)
        return seen

    def layer_depths(self) -> dict[str, float]:
        """Back-to-front z per layer, taken from its first appearance."""
        out: dict[str, float] = {}
        for f in self.frames:
            for l in f.layers:
                out.setdefault(l.id, l.z)
        return out


def hex_to_rgba(value: str | None, alpha: float = 1.0) -> tuple[float, float, float, float]:
    """
    sRGB hex -> linear RGBA, which is what Blender's colour sockets want.

    Handing Blender an sRGB triple and letting the view transform "fix" it
    is the classic way to get a film that is subtly the wrong colour
    everywhere, and the substrate agreement check would then blame the
    renderer for a mistake made here.
    """
    if not value:
        return (0.0, 0.0, 0.0, 0.0)
    h = value.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:
        alpha = alpha * (int(h[6:8], 16) / 255.0)
        h = h[:6]
    if len(h) != 6:
        raise PlanError(f"{value!r} is not a hex colour")
    srgb = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return (*(srgb_to_linear(c) for c in srgb), alpha)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _require(obj: dict[str, Any], key: str, kind: type | tuple[type, ...]) -> Any:
    if key not in obj:
        raise PlanError(f"plan is missing {key!r}")
    value = obj[key]
    if not isinstance(value, kind):
        raise PlanError(f"{key!r} should be {kind}, got {type(value).__name__}")
    return value


def parse_stroke(raw: dict[str, Any]) -> Stroke:
    points = tuple(
        (float(p[0]), float(p[1])) for p in raw.get("points", []) if len(p) >= 2
    )
    s = raw.get("stroke") or {}
    return Stroke(
        id=str(raw.get("id", "stroke")),
        points=points,
        cyclic=bool(raw.get("cyclic", True)),
        role=str(raw.get("role", "fill")),
        z=float(raw.get("z", 0.0)),
        fill=raw.get("fill"),
        fill_alpha=float(raw.get("fillAlpha", 1.0) or 0.0),
        stroke_color=s.get("color"),
        stroke_width=float(s.get("width", 0.0) or 0.0),
        stroke_alpha=float(s.get("alpha", 1.0) or 0.0),
        tag=raw.get("tag"),
        owner_id=raw.get("ownerId"),
    )


def parse_layer(raw: dict[str, Any]) -> Layer:
    return Layer(
        id=str(_require(raw, "id", str)),
        kind=str(raw.get("kind", "character")),
        z=float(raw.get("z", 0.0)),
        opacity=float(raw.get("opacity", 1.0)),
        blend=str(raw.get("blend", "normal")),
        blur=float(raw.get("blur", 0.0) or 0.0),
        parallax=float(raw.get("parallax", 1.0) or 1.0),
        haze=raw.get("haze"),
        owner_id=raw.get("ownerId"),
        strokes=tuple(parse_stroke(s) for s in raw.get("strokes", [])),
    )


def parse_plan(data: dict[str, Any]) -> Plan:
    version = _require(data, "version", int)
    if version != PLAN_VERSION:
        raise PlanError(
            f"plan version {version} but this script speaks version {PLAN_VERSION}. "
            "Re-export with a matching engine build rather than rendering a guess."
        )
    plan = Plan(
        version=version,
        shot_id=str(_require(data, "shotId", str)),
        project=str(data.get("project", "untitled")),
        fps=int(data.get("fps", 24)),
        width=int(_require(data, "width", int)),
        height=int(_require(data, "height", int)),
        background=str(data.get("background", "#000000")),
        line_scale=float(data.get("lineScale", 1.0)),
        plan_hash=str(data.get("planHash", "")),
        notes=list(data.get("notes", [])),
        frames=[
            Frame(
                frame=int(f.get("frame", i)),
                layers=tuple(parse_layer(l) for l in f.get("layers", [])),
            )
            for i, f in enumerate(_require(data, "frames", list))
        ],
    )
    if not plan.frames:
        raise PlanError("a plan with no frames renders to nothing")
    if plan.width <= 0 or plan.height <= 0:
        raise PlanError("frame size must be positive")
    return plan


def load_plan(path: str) -> Plan:
    with open(path, "r", encoding="utf-8") as fh:
        return parse_plan(json.load(fh))


def summarise(plan: Plan) -> str:
    first, last = plan.frame_range()
    strokes = sum(len(l.strokes) for f in plan.frames for l in f.layers)
    points = sum(len(s.points) for f in plan.frames for l in f.layers for s in l.strokes)
    unsupported = len(plan.unsupported())
    lines = [
        f"shot {plan.shot_id} of {plan.project}",
        f"  {len(plan.frames)} frame(s) {first}..{last} at {plan.fps} fps, {plan.width}x{plan.height}",
        f"  {len(plan.layer_ids())} layer(s), {strokes} stroke(s), {points} point(s)",
        f"  plan hash {plan.plan_hash or '(none)'}",
    ]
    if unsupported:
        lines.append(
            f"  {unsupported} element(s) this substrate cannot carry — "
            "the render will be incomplete and substrate agreement will fail"
        )
    for note in plan.notes:
        lines.append(f"  note: {note}")
    return "\n".join(lines)


if __name__ == "__main__":  # pragma: no cover - a convenience, not a product
    import sys

    if len(sys.argv) < 2:
        print("usage: python3 plan.py <plan.json>")
        raise SystemExit(2)
    print(summarise(load_plan(sys.argv[1])))
