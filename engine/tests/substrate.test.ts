/**
 * The Blender Grease Pencil substrate: export, coverage, agreement.
 *
 * The tests that matter here are the ones about *sameness*. A substrate
 * swap is only safe if it can be shown not to have changed the film, so
 * these check that the plan carries the scene faithfully and that the
 * agreement validator actually fails when it should.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  scenesToPlan,
  sceneToPlanFrame,
  planStats,
  unsupportedCount,
  BLENDER_PLAN_VERSION,
} from '../src/delivery/blender.ts';
import {
  validateSubstrateAgreement,
  validatePlanCoverage,
  measureRegistration,
} from '../src/validators/substrate.ts';
import { emptyScene } from '../src/render/scene.ts';
import type { Scene } from '../src/render/scene.ts';
import { renderScene } from '../src/render/renderer.ts';
import { parseHex } from '../src/core/color.ts';
import { mTranslate, mScale } from '../src/core/math.ts';
import { createImage } from '../src/raster/buffer.ts';
import { blur as blurImage } from '../src/raster/filters.ts';

const BG = parseHex('#F7F2E7');

function quad(x: number, y: number, w: number, h: number): { x: number; y: number }[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function demoScene(frame = 0, offset = 0): Scene {
  const scene = emptyScene(320, 180, BG, frame);
  scene.camera = mTranslate(0, 0);
  scene.layers.push({
    id: 'bg',
    kind: 'bg',
    z: -100,
    opacity: 1,
    blend: 'normal',
    parallax: 0.3,
    // A multiplane plate travels at its own rate, which is the case most
    // likely to be baked in twice or not at all.
    camera: mTranslate(offset * 0.3, 0),
    shapes: [
      {
        id: 'sky',
        contours: [quad(0, 0, 320, 120)],
        fill: parseHex('#9FC6E8'),
        z: 0,
        tag: 'sky',
      },
    ],
    images: [],
  });
  scene.layers.push({
    id: 'char',
    kind: 'character',
    z: 10,
    opacity: 1,
    blend: 'normal',
    camera: mTranslate(offset, 0),
    shapes: [
      {
        id: 'body',
        contours: [quad(120, 60, 60, 90), quad(140, 90, 20, 20)],
        fill: parseHex('#E4793B'),
        stroke: { color: parseHex('#20202A'), width: 2 },
        shade: { contours: [quad(120, 120, 60, 30)], color: parseHex('#B45A28'), alpha: 0.5 },
        z: 1,
        tag: 'body',
        ownerId: 'char_a',
      },
    ],
    images: [],
    ownerId: 'char_a',
  });
  return scene;
}

describe('the Blender plan', () => {
  test('carries every stroke of every layer', () => {
    const plan = scenesToPlan([demoScene()], { shotId: 'sh010', project: 'test' });
    assert.equal(plan.version, BLENDER_PLAN_VERSION);
    const stats = planStats(plan);
    assert.equal(stats.frames, 1);
    assert.equal(stats.layers, 2);
    // sky + body outline + body hole + shade
    assert.equal(stats.strokes, 4);
    assert.ok(stats.points > 0);
  });

  test('the per-layer multiplane camera is baked exactly once', () => {
    // The background plane moves at 0.3x, the character at 1x. If the
    // exporter applied the scene camera as well, or not at all, the two
    // layers would shift by the same amount — which is precisely the bug
    // that makes a multiplane look like a flat pan.
    const a = sceneToPlanFrame(demoScene(0, 0));
    const b = sceneToPlanFrame(demoScene(1, 100));
    const bgA = a.layers.find((l) => l.id === 'bg')!.strokes[0].points[0][0];
    const bgB = b.layers.find((l) => l.id === 'bg')!.strokes[0].points[0][0];
    const chA = a.layers.find((l) => l.id === 'char')!.strokes[0].points[0][0];
    const chB = b.layers.find((l) => l.id === 'char')!.strokes[0].points[0][0];
    assert.equal(bgB - bgA, 30);
    assert.equal(chB - chA, 100);
  });

  test('holes are separate strokes, not an even-odd fill rule', () => {
    const plan = scenesToPlan([demoScene()], { shotId: 'sh010' });
    const roles = plan.frames[0].layers.flatMap((l) => l.strokes.map((s) => s.role));
    assert.deepEqual(roles, ['fill', 'fill', 'hole', 'shade']);
  });

  test('identical scenes hash identically and a moved one does not', () => {
    const a = scenesToPlan([demoScene(0, 0)], { shotId: 'sh010' });
    const b = scenesToPlan([demoScene(0, 0)], { shotId: 'sh010' });
    const c = scenesToPlan([demoScene(0, 4)], { shotId: 'sh010' });
    assert.equal(a.planHash, b.planHash);
    assert.notEqual(a.planHash, c.planHash);
  });

  test('a raster insert is recorded as unsupported, never dropped', () => {
    const scene = demoScene();
    scene.layers[1].images.push({
      id: 'plate',
      uri: 'asset://smoke.png',
      transform: mScale(1, 1),
      opacity: 1,
      z: 5,
    });
    const plan = scenesToPlan([scene], { shotId: 'sh010' });
    assert.equal(unsupportedCount(plan), 1);
    assert.match(plan.notes.join(' '), /cannot be expressed/);

    const checks = validatePlanCoverage(plan, { shotId: 'sh010' });
    assert.equal(checks[0].pass, false);
    assert.equal(checks[0].diagnosis, 'substrate.unsupported_element');
  });

  test('a clean plan passes coverage', () => {
    const plan = scenesToPlan([demoScene()], { shotId: 'sh010' });
    const checks = validatePlanCoverage(plan, { shotId: 'sh010' });
    assert.equal(checks[0].pass, true);
  });

  test('an empty scene list is refused rather than exported', () => {
    assert.throws(() => scenesToPlan([], { shotId: 'sh010' }), /at least one scene/);
  });
});

describe('substrate agreement', () => {
  const baseline = renderScene(demoScene(), { samples: 4 });

  test('a substrate that matches the baseline agrees', () => {
    const checks = validateSubstrateAgreement(
      [{ frame: 0, baseline, candidate: renderScene(demoScene(), { samples: 4 }) }],
      { shotId: 'sh010' },
    );
    assert.ok(checks.every((c) => c.pass), checks.filter((c) => !c.pass).map((c) => c.message).join('\n'));
  });

  test('softer lines still agree — that is the improvement, not a fault', () => {
    // A substrate with better line quality differs from the baseline
    // everywhere. Demanding identical pixels would forbid exactly the
    // upgrade the swap exists for, so the check has to tolerate this.
    const softened = blurImage(renderScene(demoScene(), { samples: 4 }), 0.6);
    const checks = validateSubstrateAgreement([{ frame: 0, baseline, candidate: softened }], {
      shotId: 'sh010',
    });
    assert.equal(checks.find((c) => c.name === 'substrate.layout_agreement')?.pass, true);
  });

  test('a two-pixel shift fails layout agreement', () => {
    // Two pixels is not a lot. It is also exactly what a wrong
    // pixel-centre convention or an off-by-one camera fit produces, and
    // it is the difference between a substrate port that is correct and
    // one that is nearly correct.
    const moved = renderScene(demoScene(0, 2), { samples: 4 });
    const checks = validateSubstrateAgreement([{ frame: 0, baseline, candidate: moved }], {
      shotId: 'sh010',
    });
    const layout = checks.find((c) => c.name === 'substrate.layout_agreement')!;
    assert.equal(layout.pass, false);
    assert.equal(layout.diagnosis, 'substrate.layout_drift');
    assert.match(layout.message, /px right of where/);
  });

  test('the measured offset is the offset that was applied', () => {
    const moved = renderScene(demoScene(0, 12), { samples: 4 });
    const r = measureRegistration(baseline, moved);
    // The background plane travels at 0.3x, so the confidence-weighted
    // net offset lands between the two rates rather than on either.
    assert.ok(r.dx > 3 && r.dx < 12, `dx ${r.dx}`);
    assert.ok(Math.abs(r.dy) < 1, `dy ${r.dy}`);
  });

  test('a view-transform colour shift is caught and named', () => {
    // What a film look does: everything gets darker by a few L*.
    const darker = renderScene(demoScene(), { samples: 4 });
    for (let i = 0; i < darker.data.length; i += 4) {
      darker.data[i] *= 0.72;
      darker.data[i + 1] *= 0.72;
      darker.data[i + 2] *= 0.72;
    }
    const checks = validateSubstrateAgreement([{ frame: 0, baseline, candidate: darker }], {
      shotId: 'sh010',
    });
    const colour = checks.find((c) => c.name === 'substrate.colour_agreement')!;
    assert.equal(colour.pass, false);
    assert.match(colour.message, /view transform/);
  });

  test('a resolution mismatch stops the comparison instead of resizing', () => {
    const checks = validateSubstrateAgreement(
      [{ frame: 0, baseline, candidate: createImage(160, 90, BG) }],
      { shotId: 'sh010' },
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0].diagnosis, 'substrate.resolution_mismatch');
  });

  test('no frames means unmeasured, never held', () => {
    const checks = validateSubstrateAgreement([], { shotId: 'sh010' });
    assert.equal(checks[0].pass, false);
    assert.equal(checks[0].diagnosis, 'substrate.not_measured');
    assert.match(checks[0].message, /unmeasured, not held/);
  });
});

describe('the python side of the substrate', () => {
  const script = join(import.meta.dirname, '..', '..', 'blender', 'test_plan.py');

  test('the plan format contract holds', (t) => {
    if (!existsSync(script)) {
      t.skip('blender/test_plan.py is not present');
      return;
    }
    // unittest writes its summary to stderr, so both streams are read.
    const run = spawnSync('python3', [script], { encoding: 'utf8' });
    if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') {
      t.skip('python3 is not available');
      return;
    }
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    assert.equal(run.status, 0, output);
    assert.match(output, /OK/);
  });

  test('an exported plan round-trips through the python loader', (t) => {
    const loader = join(import.meta.dirname, '..', '..', 'blender', 'plan.py');
    if (!existsSync(loader)) {
      t.skip('blender/plan.py is not present');
      return;
    }
    const plan = scenesToPlan([demoScene(0, 0), demoScene(1, 8)], {
      shotId: 'sh_roundtrip',
      project: 'test',
      fps: 24,
    });
    let out = '';
    try {
      out = execFileSync(
        'python3',
        [
          '-c',
          [
            'import json,sys',
            `sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, '..', '..', 'blender'))})`,
            'from plan import parse_plan',
            'p = parse_plan(json.load(sys.stdin))',
            'print(p.shot_id, len(p.frames), len(p.layer_ids()), p.to_blender(0, 0))',
          ].join('\n'),
        ],
        { encoding: 'utf8', input: JSON.stringify(plan), stdio: 'pipe' },
      );
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: string };
      if (err.code === 'ENOENT') {
        t.skip('python3 is not available');
        return;
      }
      assert.fail(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
    assert.match(out, /sh_roundtrip 2 2 \(-8\.0, 4\.5\)/);
  });
});
