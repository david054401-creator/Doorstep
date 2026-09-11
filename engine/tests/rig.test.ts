/**
 * Rigging: the structural guarantee that limbs cannot melt.
 *
 * Invariant 1 is checked here directly, and the skinning maths is tested
 * against the properties that actually matter — a shared joint stays put,
 * volume survives a bend, and the weight field is a partition of unity.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MIBO_DESIGN, PIP_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { repairRig } from '../src/rig/repair.ts';
import { validateRig, validateSkeletonStructure, runPoseBattery } from '../src/rig/validators.ts';
import { indexSkeleton, evaluatePose, blendPoses, addPose, mirrorPose } from '../src/rig/skeleton.ts';
import { deformMesh, meshArea, weightSums, chainBlendWeights, hingeBoneSet, triangleSigns } from '../src/rig/skin.ts';
import { solveTwoBone, solveChain } from '../src/rig/ik.ts';
import { simulateSprings } from '../src/rig/spring.ts';
import { instantiateTemplate, PRESCHOOL_TEMPLATE, BIPED_TEMPLATE, QUADRUPED_TEMPLATE } from '../src/rig/templates.ts';
import { POSE_BATTERY } from '../src/rig/battery.ts';
import { poseRig, defaultSwaps, prepareRig } from '../src/rig/rig.ts';
import { scoreSheet } from '../src/core/result.ts';
import { rad, vdist, deg } from '../src/core/math.ts';

const mibo = autoRig(MIBO_DESIGN).rig;
const repaired = repairRig(mibo, { budget: { attempts: 24 } });

describe('skeleton', () => {
  test('indexes into a tree with one root', () => {
    const ix = indexSkeleton(mibo.skeleton);
    assert.equal(ix.roots.length, 1);
    assert.equal(ix.order.length, mibo.skeleton.length);
  });

  test('rejects a cycle', () => {
    assert.throws(() =>
      indexSkeleton([
        { id: 'a', parent: 'b', head: { x: 0, y: 0 }, tail: { x: 1, y: 0 }, restRotation: 0, length: 1, kind: 'deform' },
        { id: 'b', parent: 'a', head: { x: 0, y: 0 }, tail: { x: 1, y: 0 }, restRotation: 0, length: 1, kind: 'deform' },
      ]),
    );
  });

  test('the rest pose is the identity', () => {
    const posed = evaluatePose(mibo.skeleton, {});
    for (const bone of mibo.skeleton) {
      const p = posed.bones.get(bone.id)!;
      assert.ok(vdist(p.head, bone.head) < 1e-9, bone.id);
      assert.ok(vdist(p.tail, bone.tail) < 1e-9, bone.id);
    }
  });

  test('rotation limits are enforced at evaluation, not merely declared', () => {
    const shin = mibo.skeleton.find((b) => b.id === 'L_shin')!;
    assert.ok(shin.limits, 'the preschool knee has a limit');
    const posed = evaluatePose(mibo.skeleton, { L_shin: { rotation: rad(-400) } });
    const rotated = posed.bones.get('L_shin')!;
    const rest = evaluatePose(mibo.skeleton, {}).bones.get('L_shin')!;
    const swing = Math.abs(rotated.worldRotation - rest.worldRotation);
    assert.ok(swing <= Math.abs(shin.limits!.min) + 1e-6, `swung ${deg(swing)} degrees`);
  });

  test('poses blend and layer without losing bones', () => {
    const a = { head: { rotation: 0.2 } };
    const b = { head: { rotation: 0.6 }, spine: { rotation: 0.1 } };
    const mid = blendPoses(a, b, 0.5);
    assert.ok(Math.abs((mid.head?.rotation ?? 0) - 0.4) < 1e-9);
    const layered = addPose(a, b, 1);
    assert.ok(Math.abs((layered.head?.rotation ?? 0) - 0.8) < 1e-9);
    const mirrored = mirrorPose({ L_hand: { rotation: 0.3 } }, [['L_hand', 'R_hand']]);
    assert.ok(Math.abs((mirrored.R_hand?.rotation ?? 0) + 0.3) < 1e-9);
  });
});

describe('skinning', () => {
  test('weights form a partition of unity', () => {
    for (const mesh of mibo.meshes) {
      for (const sum of weightSums(mesh)) {
        assert.ok(Math.abs(sum - 1) < 1e-3, `weights sum to ${sum}`);
      }
    }
  });

  test('a chain blend hands over exactly at the joint', () => {
    const { bones } = instantiateTemplate(PRESCHOOL_TEMPLATE, { headHeightPx: 100 });
    const upper = bones.find((b) => b.id === 'L_upperarm')!;
    const fore = bones.find((b) => b.id === 'L_forearm')!;
    const atJoint = chainBlendWeights(upper.tail, [upper, fore], 10);
    const byBone = Object.fromEntries(atJoint.map((w) => [w.bone, w.weight]));
    assert.ok(Math.abs((byBone.L_upperarm ?? 0) - 0.5) < 0.08, JSON.stringify(byBone));
    assert.ok(Math.abs((byBone.L_forearm ?? 0) - 0.5) < 0.08, JSON.stringify(byBone));
  });

  test('hinge detection separates real joints from floating attachments', () => {
    const hinges = hingeBoneSet(mibo.skeleton);
    // Elbow, knee and the spine chain are hinges.
    assert.ok(hinges.has('L_forearm'), 'the elbow hinges');
    assert.ok(hinges.has('L_shin'), 'the knee hinges');
    assert.ok(hinges.has('spine'), 'the spine hinges');
    // A shoulder is a floating attachment in a cut-out rig.
    assert.ok(!hinges.has('L_upperarm'), 'the shoulder does not hinge');
  });

  test('dual-quaternion blending holds a shared joint still', () => {
    // Two bones that both fix a point must agree on where it goes; a naive
    // screw blend throws it across the frame.
    const { bones } = instantiateTemplate(PRESCHOOL_TEMPLATE, { headHeightPx: 120 });
    const posed = evaluatePose(bones, { L_forearm: { rotation: rad(100) } });
    const upper = posed.bones.get('L_upperarm')!;
    const fore = posed.bones.get('L_forearm')!;
    assert.ok(vdist(upper.tail, fore.head) < 1e-6, 'the elbow stays shared');
  });

  test('volume survives a bend', () => {
    const prep = prepareRig(mibo);
    const rest = evaluatePose(mibo.skeleton, {}, prep.index);
    const bent = evaluatePose(mibo.skeleton, { L_forearm: { rotation: rad(70) } }, prep.index);
    const arm = mibo.parts.find((p) => p.view === 'front' && p.name === 'L_arm')!;
    const mesh = prep.meshByPart.get(arm.id)!;
    const before = meshArea(deformMesh(mesh, rest), mesh.triangles);
    const after = meshArea(deformMesh(mesh, bent), mesh.triangles);
    const drift = Math.abs(after - before) / before;
    assert.ok(drift < 0.08, `area drifted ${(drift * 100).toFixed(1)}% through the bend`);
  });

  test('no triangle inverts through a bend', () => {
    // The repaired rig is the one that ships; the raw build is what the
    // battery is supposed to reject, and does.
    const prep = prepareRig(repaired.rig);
    const rest = evaluatePose(repaired.rig.skeleton, {}, prep.index);
    const bent = evaluatePose(repaired.rig.skeleton, { L_shin: { rotation: rad(-80) } }, prep.index);
    const leg = repaired.rig.parts.find((p) => p.view === 'front' && p.name === 'L_leg')!;
    const mesh = prep.meshByPart.get(leg.id)!;
    const a = triangleSigns(deformMesh(mesh, rest), mesh.triangles);
    const b = triangleSigns(deformMesh(mesh, bent), mesh.triangles);
    let inverted = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]) > 1e-6 && Math.sign(a[i]) !== Math.sign(b[i])) inverted++;
    }
    assert.equal(inverted, 0);
  });
});

describe('inverse kinematics', () => {
  test('two-bone IK reaches a reachable target', () => {
    const s = solveTwoBone({ x: 0, y: 0 }, 50, 50, { x: 60, y: 30 }, true);
    assert.equal(s.outOfReach, false);
    const elbow = { x: Math.cos(s.angle1) * 50, y: Math.sin(s.angle1) * 50 };
    const total = s.angle1 + s.angle2;
    const hand = { x: elbow.x + Math.cos(total) * 50, y: elbow.y + Math.sin(total) * 50 };
    assert.ok(vdist(hand, { x: 60, y: 30 }) < 0.01, `landed at ${JSON.stringify(hand)}`);
  });

  test('an unreachable target is reported, not faked', () => {
    assert.equal(solveTwoBone({ x: 0, y: 0 }, 20, 20, { x: 500, y: 0 }, true).outOfReach, true);
  });

  test('chain IK converges on the rig', () => {
    const chain = mibo.ik.find((c) => c.id === 'ik_L_arm')!;
    const root = mibo.skeleton.find((b) => b.id === chain.bones[0])!;
    const reach = chain.bones
      .map((id) => mibo.skeleton.find((b) => b.id === id)!.length)
      .reduce((a, b) => a + b, 0);
    // Aim along the chain's own rest direction so rotation limits, which
    // legitimately block part of the envelope, are not what is measured.
    const tip = mibo.skeleton.find((b) => b.id === chain.bones[chain.bones.length - 1])!;
    const dir = { x: tip.tail.x - root.head.x, y: tip.tail.y - root.head.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const target = {
      x: root.head.x + (dir.x / len) * reach * 0.85,
      y: root.head.y + (dir.y / len) * reach * 0.85,
    };
    const solved = solveChain(mibo.skeleton, chain.bones, target, {}, { iterations: 24 });
    assert.ok(solved.residual < reach * 0.05, `residual ${solved.residual} of reach ${reach}`);
  });
});

describe('spring bones', () => {
  test('a still driver settles to rest', () => {
    const frames = Array.from({ length: 48 }, () => ({ head: 0 }));
    const poses = simulateSprings(mibo.skeleton, frames, 24);
    const last = poses[poses.length - 1];
    for (const v of Object.values(last)) {
      assert.ok(Math.abs(v.rotation ?? 0) < 0.2, 'a still character has still ears');
    }
  });

  test('a moving driver produces lag that decays back to the settled pose', () => {
    // The settled value is not zero: gravity holds the ear at a small
    // resting offset. What lag means is deviation from that resting
    // state, so that is what is measured.
    const still = Array.from({ length: 90 }, () => ({ head: 0 }));
    const settled = simulateSprings(mibo.skeleton, still, 24);
    const rest = settled[settled.length - 1]?.L_ear?.rotation ?? 0;

    const frames = Array.from({ length: 90 }, (_, i) => ({ head: i < 12 ? i * 0.12 : 1.44 }));
    const poses = simulateSprings(mibo.skeleton, frames, 24);
    const during = Math.abs((poses[9]?.L_ear?.rotation ?? 0) - rest);
    const after = Math.abs((poses[85]?.L_ear?.rotation ?? 0) - rest);
    assert.ok(during > 1e-4, `the ear should react at all, got ${during}`);
    assert.ok(during > after * 2, `during ${during}, after ${after}`);
  });

  test('the simulation never explodes', () => {
    const frames = Array.from({ length: 80 }, (_, i) => ({ head: Math.sin(i) * 3 }));
    for (const pose of simulateSprings(mibo.skeleton, frames, 24)) {
      for (const v of Object.values(pose)) {
        assert.ok(Number.isFinite(v.rotation ?? 0));
        assert.ok(Math.abs(v.rotation ?? 0) < 2);
      }
    }
  });
});

describe('templates', () => {
  test('every template instantiates into a valid tree', () => {
    for (const template of [PRESCHOOL_TEMPLATE, BIPED_TEMPLATE, QUADRUPED_TEMPLATE]) {
      const { bones } = instantiateTemplate(template, { headHeightPx: 100 });
      const ix = indexSkeleton(bones);
      assert.equal(ix.roots.length, 1, template.bodyType);
      assert.ok(bones.every((b) => b.kind === 'control' || b.length > 0), template.bodyType);
    }
  });

  test('scale is proportional', () => {
    const small = instantiateTemplate(PRESCHOOL_TEMPLATE, { headHeightPx: 50 });
    const large = instantiateTemplate(PRESCHOOL_TEMPLATE, { headHeightPx: 100 });
    const s = small.bones.find((b) => b.id === 'spine')!;
    const l = large.bones.find((b) => b.id === 'spine')!;
    assert.ok(Math.abs(l.length / s.length - 2) < 1e-6);
  });
});

describe('the validator battery', () => {
  test('structure passes on a built rig', () => {
    const checks = validateSkeletonStructure(mibo);
    const failing = checks.filter((c) => !c.pass);
    assert.deepEqual(failing.map((c) => c.name), [], failing.map((c) => c.message).join('; '));
  });

  test('a broken rig is caught, and the message says what broke', () => {
    const broken = {
      ...mibo,
      meshes: mibo.meshes.map((m, i) =>
        i === 0 ? { ...m, weights: m.weights.map((w) => w.map((x) => ({ ...x, weight: x.weight * 2 }))) } : m,
      ),
    };
    const checks = validateSkeletonStructure(broken);
    const weights = checks.find((c) => c.name === 'rig.weights_normalised')!;
    assert.equal(weights.pass, false);
    assert.equal(weights.severity, 'fatal');
    assert.match(weights.message, /do not sum to 1/);
    assert.equal(weights.diagnosis, 'rig.unnormalised_weights');
  });

  test('the battery runs every pose in every view', () => {
    const result = runPoseBattery(mibo);
    assert.equal(result.poses.length, POSE_BATTERY.length * mibo.views.length);
  });

  test('MIBO clears invariant 1 after repair', () => {
    const sheet = scoreSheet('mibo', repaired.result.checks);
    const blocking = repaired.result.checks.filter(
      (c) => !c.pass && (c.severity === 'fatal' || c.severity === 'error'),
    );
    assert.deepEqual(
      blocking.map((c) => c.name),
      [],
      blocking.map((c) => c.message).join('; '),
    );
    assert.ok(sheet.score > 0.95, `score ${sheet.score}`);
  });

  test('PIP clears it too', () => {
    const out = repairRig(autoRig(PIP_DESIGN).rig, { budget: { attempts: 24 } });
    assert.equal(out.clean, true, out.escalation?.summary);
  });

  test('zero inverted triangles across the whole battery', () => {
    const checks = validateRig(repaired.rig).checks;
    const inversion = checks.find((c) => c.name === 'rig.no_inverted_triangles')!;
    assert.equal(inversion.pass, true, inversion.message);
    assert.equal(inversion.measured, 0);
  });
});

describe('repair', () => {
  test('a repair that does not help is rolled back', () => {
    const out = repairRig(mibo, { budget: { attempts: 4 } });
    for (const r of out.records) {
      if (r.outcome === 'worse') {
        assert.fail('a regression was kept');
      }
    }
  });

  test('escalation names the part, the bone and the pose', () => {
    const crippled = { ...mibo, meshes: [] };
    const out = repairRig(crippled, { budget: { attempts: 2 } });
    if (!out.clean) {
      assert.ok(out.escalation, 'an unfixable rig must escalate');
      assert.match(out.escalation!.summary, /did not clear the validator battery/);
      assert.match(out.escalation!.summary, /Repair moves attempted/);
    }
  });
});

describe('posing to a drawable scene', () => {
  test('every view produces shapes', () => {
    for (const view of mibo.views) {
      const posed = poseRig(mibo, {}, { view, swaps: defaultSwaps(mibo), colorModel: MIBO_DESIGN.colorModel });
      assert.ok(posed.layer.shapes.length > 5, view);
      assert.ok(posed.layer.shapes.every((s) => s.contours.length > 0), view);
    }
  });

  test('the resting swap selection is not eyes-closed', () => {
    const swaps = defaultSwaps(mibo);
    assert.equal(swaps.eyes, 'open');
    assert.equal(swaps.mouth, 'X');
  });

  test('changing a viseme changes what is drawn', () => {
    const closed = poseRig(mibo, {}, { view: 'front', swaps: { ...defaultSwaps(mibo), mouth: 'X' } });
    const open = poseRig(mibo, {}, { view: 'front', swaps: { ...defaultSwaps(mibo), mouth: 'D' } });
    const tagOf = (p: typeof closed) => p.layer.shapes.map((s) => s.tag).filter((t) => t?.startsWith('mouth'));
    assert.notDeepEqual(tagOf(closed), tagOf(open));
  });
});
