"""
Tests for the plan format. No Blender required.

    python3 blender/test_plan.py

The point of keeping these `bpy`-free is that the contract between the
engine and the substrate — coordinates, colour, versioning, and the
refusal to render an incomplete plan — is checkable in CI on a machine
with no 3D package installed at all.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plan import (  # noqa: E402
    PLAN_VERSION,
    PlanError,
    hex_to_rgba,
    parse_plan,
    srgb_to_linear,
    summarise,
)


def minimal(**overrides) -> dict:
    data = {
        "version": PLAN_VERSION,
        "shotId": "sh010",
        "project": "test",
        "fps": 24,
        "width": 1920,
        "height": 1080,
        "background": "#f7f2e7",
        "lineScale": 1.0,
        "planHash": "sha256:abc",
        "notes": [],
        "frames": [
            {
                "frame": 0,
                "layers": [
                    {
                        "id": "bg",
                        "kind": "bg",
                        "z": -10,
                        "opacity": 1.0,
                        "blend": "normal",
                        "blur": 0,
                        "parallax": 0.2,
                        "strokes": [
                            {
                                "id": "s1",
                                "points": [[0, 0], [10, 0], [10, 10]],
                                "cyclic": True,
                                "role": "fill",
                                "z": 0,
                                "fill": "#3a7ad9",
                                "fillAlpha": 1,
                                "stroke": {"color": "#20202a", "width": 3, "alpha": 1},
                            }
                        ],
                    }
                ],
            }
        ],
    }
    data.update(overrides)
    return data


class TestCoordinates(unittest.TestCase):
    def test_frame_maps_corner_to_corner(self) -> None:
        p = parse_plan(minimal())
        self.assertEqual(p.to_blender(0, 0), (-8.0, 4.5))
        self.assertEqual(p.to_blender(1920, 1080), (8.0, -4.5))
        self.assertEqual(p.to_blender(960, 540), (0.0, 0.0))

    def test_y_axis_flips(self) -> None:
        """A point lower in the raster frame must be lower in Blender too."""
        p = parse_plan(minimal())
        _, top = p.to_blender(0, 100)
        _, bottom = p.to_blender(0, 900)
        self.assertGreater(top, bottom)

    def test_scale_is_resolution_independent(self) -> None:
        hd = parse_plan(minimal())
        uhd = parse_plan(minimal(width=3840, height=2160))
        # The same fraction of the frame lands at the same scene position,
        # so a plan re-exported at 4K keeps the camera and the depth of
        # field it was approved with.
        self.assertAlmostEqual(hd.to_blender(480, 270)[0], uhd.to_blender(960, 540)[0])
        self.assertAlmostEqual(hd.to_blender(480, 270)[1], uhd.to_blender(960, 540)[1])


class TestColour(unittest.TestCase):
    def test_hex_is_converted_to_linear(self) -> None:
        r, g, b, a = hex_to_rgba("#808080")
        self.assertAlmostEqual(a, 1.0)
        # Mid grey in sRGB is about 0.216 in linear light. Passing 0.5
        # straight through is the classic washed-out render.
        self.assertAlmostEqual(r, srgb_to_linear(128 / 255), places=6)
        self.assertLess(r, 0.25)
        self.assertEqual((r, g, b), (r, r, r))

    def test_short_and_alpha_forms(self) -> None:
        self.assertEqual(hex_to_rgba("#fff"), hex_to_rgba("#ffffff"))
        self.assertAlmostEqual(hex_to_rgba("#ffffff80")[3], 128 / 255, places=6)

    def test_alpha_multiplies(self) -> None:
        self.assertAlmostEqual(hex_to_rgba("#ffffff80", 0.5)[3], 0.5 * 128 / 255, places=6)

    def test_bad_hex_is_refused(self) -> None:
        with self.assertRaises(PlanError):
            hex_to_rgba("not-a-colour")

    def test_white_and_black_round_trip(self) -> None:
        self.assertAlmostEqual(hex_to_rgba("#ffffff")[0], 1.0, places=6)
        self.assertAlmostEqual(hex_to_rgba("#000000")[0], 0.0, places=6)


class TestValidation(unittest.TestCase):
    def test_version_mismatch_refuses(self) -> None:
        with self.assertRaises(PlanError):
            parse_plan(minimal(version=PLAN_VERSION + 1))

    def test_empty_plan_refuses(self) -> None:
        with self.assertRaises(PlanError):
            parse_plan(minimal(frames=[]))

    def test_missing_field_names_itself(self) -> None:
        data = minimal()
        del data["width"]
        with self.assertRaises(PlanError) as ctx:
            parse_plan(data)
        self.assertIn("width", str(ctx.exception))

    def test_unsupported_elements_are_visible(self) -> None:
        data = minimal()
        data["frames"][0]["layers"][0]["strokes"].append(
            {"id": "r1", "points": [], "role": "line", "z": 0, "tag": "unsupported:raster:x.png"}
        )
        p = parse_plan(data)
        self.assertEqual(len(p.unsupported()), 1)
        self.assertIn("cannot carry", summarise(p))


class TestStructure(unittest.TestCase):
    def test_layers_are_ordered_back_to_front(self) -> None:
        data = minimal()
        far = dict(data["frames"][0]["layers"][0])
        near = dict(far, id="fg", z=10)
        data["frames"][0]["layers"] = [near, far]
        p = parse_plan(data)
        order = sorted(p.layer_ids(), key=lambda lid: p.layer_depths()[lid])
        self.assertEqual(order, ["bg", "fg"])

    def test_stroke_fields_survive_parsing(self) -> None:
        p = parse_plan(minimal())
        s = p.frames[0].layers[0].strokes[0]
        self.assertEqual(s.points, ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0)))
        self.assertTrue(s.cyclic)
        self.assertEqual(s.fill, "#3a7ad9")
        self.assertEqual(s.stroke_color, "#20202a")
        self.assertEqual(s.stroke_width, 3.0)
        self.assertFalse(s.unsupported)

    def test_frame_range(self) -> None:
        data = minimal()
        data["frames"].append({"frame": 12, "layers": []})
        self.assertEqual(parse_plan(data).frame_range(), (0, 12))


class TestExportedPlans(unittest.TestCase):
    """If the engine has written plans, hold them to the same contract."""

    def test_any_exported_plan_parses(self) -> None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        found = []
        for base in (os.path.join(root, "out", "plans"), os.path.join(root, "engine", "out", "plans")):
            if os.path.isdir(base):
                found += [os.path.join(base, f) for f in os.listdir(base) if f.endswith(".json")]
        if not found:
            self.skipTest("no exported plans on disk; run `film export-blender` first")
        for path in found:
            with self.subTest(plan=os.path.basename(path)):
                with open(path, encoding="utf-8") as fh:
                    p = parse_plan(json.load(fh))
                self.assertGreater(len(p.frames), 0)
                self.assertEqual(p.unsupported(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
