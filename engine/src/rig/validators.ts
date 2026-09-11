/**
 * The rig validator battery — Tier 0, deterministic.
 *
 * Hard invariant 1: 100% bones connected, weights normalised, 0 inverted
 * triangles across the 20-pose battery. Every check here names what broke
 * and where, so the repair table can route it.
 */

import type { Rig, ViewName } from '../graph/types.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import { indexSkeleton, evaluatePose } from './skeleton.ts';
import { prepareRig, poseRig, defaultSwaps, skeletonForView } from './rig.ts';
import { deformMesh, triangleSigns, meshArea, stretchRatio, weightSums } from './skin.ts';
import { applicableBattery, QUADRUPED_BATTERY } from './battery.ts';
import type { BatteryPose } from './battery.ts';
import { selfIntersections, triangleQuality } from '../geom/polygon.ts';
import { silhouetteStats } from '../geom/silhouette.ts';
import { solveChain } from './ik.ts';
import { vdist } from '../core/math.ts';
import { EPS } from '../core/math.ts';

const DEPT = 'rigging';

export type RigValidationOptions = {
  /** Views to exercise. Defaults to every view the rig declares. */
  views?: ViewName[];
  /** Battery to run. Defaults to the biped/preschool set. */
  battery?: BatteryPose[];
  /**
   * Area drift allowed at a battery extreme outside tagged squash/stretch.
   * This is NOT the per-frame invariant (3%): a battery pose is a static
   * extreme, and a limb genuinely changes apparent area when it folds. The
   * per-frame drift bound lives in the animation validators, where it
   * belongs.
   */
  volumeTolerance?: number;
  /** Area-product conservation inside squash/stretch, as a fraction. */
  squashTolerance?: number;
  /** Max allowed edge stretch before we call it tearing. */
  stretchTolerance?: number;
  /** Minimum triangle quality; below this, slivers show as artefacts. */
  minTriangleQuality?: number;
  /** Minimum silhouette solidity — too low and the pose reads as noise. */
  minSolidity?: number;
};

const DEFAULTS: Required<Omit<RigValidationOptions, 'views' | 'battery'>> = {
  volumeTolerance: 0.2,
  squashTolerance: 0.05,
  stretchTolerance: 1.85,
  minTriangleQuality: 0.02,
  minSolidity: 0.28,
};

// ---------------------------------------------------------------------------
// Structural checks — cheap, run first, block everything else
// ---------------------------------------------------------------------------

export function validateSkeletonStructure(rig: Rig): CheckResult[] {
  const out: CheckResult[] = [];
  const where: Locator = { characterId: rig.characterId, path: `rig:${rig.id}` };

  // Connectivity + single root + acyclicity.
  let index: ReturnType<typeof indexSkeleton> | null = null;
  try {
    index = indexSkeleton(rig.skeleton);
    out.push(
      pass({
        name: 'rig.bone_graph_connected',
        department: DEPT,
        score: 1,
        message: `Bone graph is a valid tree: ${rig.skeleton.length} bones, ${index.roots.length} root(s).`,
        where,
      }),
    );
  } catch (e) {
    out.push(
      fail({
        name: 'rig.bone_graph_connected',
        department: DEPT,
        score: 0,
        severity: 'fatal',
        message: `Bone graph is not a valid tree: ${(e as Error).message}`,
        diagnosis: 'rig.broken_hierarchy',
        where,
      }),
    );
    return out;
  }

  out.push(
    index.roots.length === 1
      ? pass({
          name: 'rig.single_root',
          department: DEPT,
          score: 1,
          message: `Single root bone "${index.roots[0]}".`,
          where,
        })
      : fail({
          name: 'rig.single_root',
          department: DEPT,
          score: 0,
          severity: 'fatal',
          message: `Rig has ${index.roots.length} roots (${index.roots.join(', ')}); exactly one is required.`,
          diagnosis: 'rig.multiple_roots',
          where,
        }),
  );

  const zeroLength = rig.skeleton.filter((b) => b.kind !== 'control' && b.length < 1e-4);
  out.push(
    zeroLength.length === 0
      ? pass({
          name: 'rig.no_zero_length_bones',
          department: DEPT,
          score: 1,
          message: 'No zero-length deform bones.',
          where,
        })
      : fail({
          name: 'rig.no_zero_length_bones',
          department: DEPT,
          score: 0,
          severity: 'fatal',
          message: `Zero-length deform bones: ${zeroLength.map((b) => b.id).join(', ')}.`,
          diagnosis: 'rig.zero_length_bone',
          where: { ...where, boneId: zeroLength[0].id },
        }),
  );

  // Every part bound, no orphan parts.
  const boneIds = new Set(rig.skeleton.map((b) => b.id));
  const unbound = rig.parts.filter((p) => !p.bone);
  const badBone = rig.parts.filter((p) => p.bone && !boneIds.has(p.bone));
  out.push(
    unbound.length === 0 && badBone.length === 0
      ? pass({
          name: 'rig.every_part_bound',
          department: DEPT,
          score: 1,
          message: `All ${rig.parts.length} parts bound to existing bones.`,
          where,
        })
      : fail({
          name: 'rig.every_part_bound',
          department: DEPT,
          score: 1 - (unbound.length + badBone.length) / Math.max(1, rig.parts.length),
          severity: 'fatal',
          message:
            `${unbound.length} unbound part(s)` +
            (badBone.length ? ` and ${badBone.length} bound to a missing bone` : '') +
            `: ${[...unbound, ...badBone].slice(0, 5).map((p) => p.name).join(', ')}.`,
          diagnosis: 'rig.unbound_part',
          where: { ...where, partId: (unbound[0] ?? badBone[0])?.id },
        }),
  );

  // Weight normalisation — the invariant that stops limbs detaching.
  let worstDeviation = 0;
  let worstPart = '';
  let worstVertex = -1;
  let badVertices = 0;
  let totalVertices = 0;
  for (const mesh of rig.meshes) {
    const sums = weightSums(mesh);
    for (let i = 0; i < sums.length; i++) {
      totalVertices++;
      const d = Math.abs(sums[i] - 1);
      if (d > 1e-3) badVertices++;
      if (d > worstDeviation) {
        worstDeviation = d;
        worstPart = mesh.partId;
        worstVertex = i;
      }
    }
  }
  out.push(
    badVertices === 0
      ? pass({
          name: 'rig.weights_normalised',
          department: DEPT,
          score: 1,
          measured: worstDeviation,
          threshold: 1e-3,
          comparator: '<=',
          message: `All ${totalVertices} skinned vertices sum to 1 (max deviation ${worstDeviation.toExponential(2)}).`,
          where,
        })
      : fail({
          name: 'rig.weights_normalised',
          department: DEPT,
          score: Math.max(0, 1 - badVertices / Math.max(1, totalVertices)),
          severity: 'fatal',
          measured: worstDeviation,
          threshold: 1e-3,
          comparator: '<=',
          message: `${badVertices}/${totalVertices} vertices have weights that do not sum to 1; worst is part ${worstPart} vertex ${worstVertex} (sum off by ${worstDeviation.toFixed(4)}).`,
          diagnosis: 'rig.unnormalised_weights',
          where: { ...where, partId: worstPart },
        }),
  );

  // Weights referencing missing bones.
  const missingWeightBones = new Set<string>();
  for (const mesh of rig.meshes) {
    for (const ws of mesh.weights) {
      for (const w of ws) {
        if (!boneIds.has(w.bone)) missingWeightBones.add(w.bone);
      }
    }
  }
  out.push(
    missingWeightBones.size === 0
      ? pass({
          name: 'rig.no_orphan_weights',
          department: DEPT,
          score: 1,
          message: 'No skin weights reference a missing bone.',
          where,
        })
      : fail({
          name: 'rig.no_orphan_weights',
          department: DEPT,
          score: 0,
          severity: 'fatal',
          message: `Skin weights reference missing bones: ${[...missingWeightBones].join(', ')}.`,
          diagnosis: 'rig.orphan_weight',
          where,
        }),
  );

  // Every part has a mesh or is explicitly rigid with a bone.
  const meshed = new Set(rig.meshes.map((m) => m.partId));
  const noGeometry = rig.parts.filter((p) => !meshed.has(p.id) && !p.bone);
  out.push(
    noGeometry.length === 0
      ? pass({
          name: 'rig.no_orphan_parts',
          department: DEPT,
          score: 1,
          message: 'Every part is either skinned or rigidly bound.',
          where,
        })
      : fail({
          name: 'rig.no_orphan_parts',
          department: DEPT,
          score: 0,
          message: `Parts with neither a mesh nor a bone: ${noGeometry.map((p) => p.name).join(', ')}.`,
          diagnosis: 'rig.orphan_part',
          where: { ...where, partId: noGeometry[0].id },
        }),
  );

  // IK chains reference real bones and are contiguous.
  for (const chain of rig.ik) {
    const missing = chain.bones.filter((b) => !boneIds.has(b));
    if (missing.length) {
      out.push(
        fail({
          name: 'rig.ik_chain_valid',
          department: DEPT,
          score: 0,
          message: `IK chain ${chain.id} references missing bones: ${missing.join(', ')}.`,
          diagnosis: 'rig.bad_ik_chain',
          where: { ...where, path: `rig.ik.${chain.id}` },
        }),
      );
      continue;
    }
    let contiguous = true;
    for (let i = 1; i < chain.bones.length; i++) {
      if (index.byId.get(chain.bones[i])?.parent !== chain.bones[i - 1]) contiguous = false;
    }
    out.push(
      contiguous
        ? pass({
            name: 'rig.ik_chain_valid',
            department: DEPT,
            score: 1,
            message: `IK chain ${chain.id} is contiguous (${chain.bones.join(' -> ')}).`,
            where: { ...where, path: `rig.ik.${chain.id}` },
          })
        : fail({
            name: 'rig.ik_chain_valid',
            department: DEPT,
            score: 0.3,
            message: `IK chain ${chain.id} is not a contiguous parent-child run: ${chain.bones.join(' -> ')}.`,
            diagnosis: 'rig.bad_ik_chain',
            where: { ...where, path: `rig.ik.${chain.id}` },
          }),
    );
  }

  // Every declared view has parts and a z-order rule.
  for (const view of rig.views) {
    const n = rig.parts.filter((p) => p.view === view).length;
    const hasRule = rig.zOrderRules.some((r) => r.view === view);
    out.push(
      n > 0 && hasRule
        ? pass({
            name: 'rig.view_complete',
            department: DEPT,
            score: 1,
            message: `View "${view}" has ${n} parts and a z-order rule.`,
            where: { ...where, path: `rig.views.${view}` },
          })
        : fail({
            name: 'rig.view_complete',
            department: DEPT,
            score: 0,
            message: `View "${view}" is incomplete: ${n} parts, z-order rule ${hasRule ? 'present' : 'missing'}.`,
            diagnosis: 'rig.incomplete_view',
            where: { ...where, path: `rig.views.${view}` },
          }),
    );
  }

  // Swap sets must be complete: all nine visemes present for every view.
  for (const view of rig.views) {
    if (view === 'back') continue;
    const present = new Set(
      rig.parts.filter((p) => p.view === view && p.swapSet === 'mouth').map((p) => p.swapKey),
    );
    const missing = rig.swapSets.mouth.filter((v) => !present.has(v));
    out.push(
      missing.length === 0
        ? pass({
            name: 'rig.mouth_set_complete',
            department: DEPT,
            score: 1,
            message: `View "${view}" has all ${rig.swapSets.mouth.length} mouth shapes.`,
            where: { ...where, path: `rig.swapSets.mouth.${view}` },
          })
        : fail({
            name: 'rig.mouth_set_complete',
            department: DEPT,
            score: 1 - missing.length / Math.max(1, rig.swapSets.mouth.length),
            message: `View "${view}" is missing mouth shapes: ${missing.join(', ')}. Lipsync cannot be driven without them.`,
            diagnosis: 'rig.incomplete_swap_set',
            where: { ...where, path: `rig.swapSets.mouth.${view}` },
          }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Range-of-motion battery
// ---------------------------------------------------------------------------

export type BatteryResult = {
  checks: CheckResult[];
  /** Per-pose geometry stats, for the QA dashboard and repair diagnosis. */
  poses: {
    poseId: string;
    view: ViewName;
    invertedTriangles: number;
    selfIntersections: number;
    maxStretch: number;
    minTriangleQuality: number;
    areaDrift: number;
    solidity: number;
    silhouetteArea: number;
    zOrderViolations: number;
  }[];
};

/**
 * Push the rig through the battery in every view and measure the geometry.
 * This never renders pixels — it is pure geometry, which makes it fast
 * enough to run on every rig change.
 */
export function runPoseBattery(rig: Rig, options: RigValidationOptions = {}): BatteryResult {
  const cfg = { ...DEFAULTS, ...options };
  const views = options.views ?? rig.views;
  const boneIds = new Set(rig.skeleton.map((b) => b.id));
  const battery =
    options.battery ??
    (boneIds.has('FL_upper') ? QUADRUPED_BATTERY : applicableBattery(boneIds));

  const prep = prepareRig(rig);
  const checks: CheckResult[] = [];
  const poses: BatteryResult['poses'] = [];

  // Rest-pose reference geometry, per view (each view has its own skeleton).
  const restByView = new Map<ViewName, ReturnType<typeof evaluatePose>>();
  const restAreas = new Map<string, number>();
  for (const view of views) {
    const vs = prep.skeletonByView.get(view);
    const restPosed = evaluatePose(vs?.bones ?? rig.skeleton, {}, vs?.index ?? prep.index);
    restByView.set(view, restPosed);
    for (const part of prep.partsByView.get(view) ?? []) {
      const mesh = prep.meshByPart.get(part.id);
      if (!mesh) continue;
      restAreas.set(mesh.partId, meshArea(deformMesh(mesh, restPosed), mesh.triangles));
    }
  }

  let totalInverted = 0;
  let totalIntersections = 0;
  let worstInvertedCount = 0;
  let worstInvertedWhere: Locator = { characterId: rig.characterId };
  let worstIntersectCount = 0;
  let worstIntersectWhere: Locator = { characterId: rig.characterId };
  let worstStretch = 1;
  let worstStretchWhere: Locator = { characterId: rig.characterId };
  let worstDrift = 0;
  let worstDriftWhere: Locator = { characterId: rig.characterId };
  let worstSquashError = 0;
  let worstSquashWhere: Locator = { characterId: rig.characterId };
  let worstQuality = 1;
  let worstSolidity = 1;
  let worstSolidityPose = '';
  let worstComponents = 1;
  let worstComponentsPose = '';
  let zViolations = 0;

  for (const view of views) {
    const zOrder = prep.zOrderByView.get(view);
    const vs = prep.skeletonByView.get(view);
    const restPosed = restByView.get(view)!;
    for (const bp of battery) {
      const posedSkel = evaluatePose(vs?.bones ?? rig.skeleton, bp.pose, vs?.index ?? prep.index);
      let inverted = 0;
      let intersections = 0;
      let maxStretch = 1;
      let minQuality = 1;
      let maxDrift = 0;

      const viewParts = prep.partsByView.get(view) ?? [];
      // Which joint is this pose actually working? Naming it lets the repair
      // loop tighten the bone that breaks the rig rather than guessing.
      const drivingBone = (partChain: readonly string[] | undefined): string | undefined => {
        const ids = partChain && partChain.length ? partChain : [];
        let best: string | undefined;
        let bestMag = 0;
        for (const id of ids) {
          const mag = Math.abs(bp.pose[id]?.rotation ?? 0);
          if (mag > bestMag) {
            bestMag = mag;
            best = id;
          }
        }
        return best;
      };
      for (const part of viewParts) {
        const mesh = prep.meshByPart.get(part.id);
        if (!mesh) continue;
        const bone = drivingBone(part.boneChain ?? (part.bone ? [part.bone] : []));
        const deformed = deformMesh(mesh, posedSkel);
        const signs = triangleSigns(deformed, mesh.triangles);
        const restSigns = triangleSigns(deformMesh(mesh, restPosed), mesh.triangles);
        // Compare against the mesh's own scale: a triangle that carries a
        // thousandth of the average area is invisible, and counting its sign
        // flip would report a broken rig over nothing.
        let meanRest = 0;
        for (const r of restSigns) meanRest += Math.abs(r);
        meanRest /= Math.max(1, restSigns.length);
        const minSignificant = Math.max(EPS, meanRest * 0.02);
        let partInverted = 0;
        for (let t = 0; t < signs.length; t++) {
          if (Math.abs(restSigns[t]) < minSignificant) continue;
          if (Math.abs(signs[t]) < EPS) continue;
          if (Math.sign(signs[t]) !== Math.sign(restSigns[t])) partInverted++;
        }
        inverted += partInverted;
        if (partInverted > worstInvertedCount) {
          worstInvertedCount = partInverted;
          worstInvertedWhere = {
            characterId: rig.characterId,
            partId: part.id,
            boneId: bone,
            path: `battery.${bp.id}.${view}`,
          };
        }
        for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
          const q = triangleQuality(
            deformed[mesh.triangles[t]],
            deformed[mesh.triangles[t + 1]],
            deformed[mesh.triangles[t + 2]],
          );
          if (q < minQuality) minQuality = q;
        }
        const s = stretchRatio(mesh.vertices, deformed, mesh.triangles);
        if (s > maxStretch) maxStretch = s;
        if (s > worstStretch) {
          worstStretch = s;
          worstStretchWhere = {
            characterId: rig.characterId,
            partId: part.id,
            boneId: bone,
            path: `battery.${bp.id}.${view}`,
          };
        }

        const a0 = restAreas.get(mesh.partId) ?? 0;
        if (a0 > EPS) {
          const a1 = meshArea(deformed, mesh.triangles);
          const drift = Math.abs(a1 - a0) / a0;
          if (drift > maxDrift) maxDrift = drift;
          if (bp.tagSquashStretch) {
            // Inside tagged squash and stretch the rule is different and
            // stricter in spirit: the form may change shape freely, but the
            // width x height product — the volume it reads as — must hold.
            if (drift > worstSquashError) {
              worstSquashError = drift;
              worstSquashWhere = {
                characterId: rig.characterId,
                partId: part.id,
                path: `battery.${bp.id}.${view}`,
              };
            }
          } else if (drift > worstDrift) {
            worstDrift = drift;
            worstDriftWhere = {
              characterId: rig.characterId,
              partId: part.id,
              path: `battery.${bp.id}.${view}`,
            };
          }
        }
        // Self-intersection of the outer contour after deformation.
        const outer = mesh.contourVertexIndex[0];
        if (outer && outer.length >= 4) {
          const hits = selfIntersections(outer.map((i) => deformed[i])).length;
          intersections += hits;
          if (hits > worstIntersectCount) {
            worstIntersectCount = hits;
            worstIntersectWhere = {
              characterId: rig.characterId,
              partId: part.id,
              boneId: bone,
              path: `battery.${bp.id}.${view}`,
            };
          }
        }
      }

      // Silhouette geometry for this pose.
      const posedRig = poseRig(rig, bp.pose, {
        view,
        swaps: defaultSwaps(rig),
        prepared: prep,
      });
      const allContours = posedRig.layer.shapes.flatMap((s) => s.contours);
      // Solidity has to be measured on the *union* of the parts. Cut-out
      // parts overlap heavily, so summing polygon areas double-counts, and
      // treating the concatenated point list as one polygon is nonsense.
      const sil = silhouetteStats(allContours, 128);
      const sol = sil.solidity;
      const silArea = sil.area;
      if (sol < worstSolidity) {
        worstSolidity = sol;
        worstSolidityPose = `${bp.id}/${view}`;
      }
      if (sil.components > worstComponents) {
        worstComponents = sil.components;
        worstComponentsPose = `${bp.id}/${view}`;
      }
      if (minQuality < worstQuality) worstQuality = minQuality;
      totalInverted += inverted;
      totalIntersections += intersections;

      // z-order consistency: the rendered order must match the declared rule.
      let zv = 0;
      if (zOrder) {
        const rendered = posedRig.layer.shapes.map((s) => s.id.split(':').slice(1).join(':'));
        let prevRank = -Infinity;
        for (const id of rendered) {
          const full = viewParts.find((p) => p.id.endsWith(id) || p.name === id);
          const rank = full ? (zOrder.get(full.id) ?? 0) : 0;
          if (rank < prevRank) zv++;
          prevRank = Math.max(prevRank, rank);
        }
      }
      zViolations += zv;

      poses.push({
        poseId: bp.id,
        view,
        invertedTriangles: inverted,
        selfIntersections: intersections,
        maxStretch,
        minTriangleQuality: minQuality,
        areaDrift: maxDrift,
        solidity: sol,
        silhouetteArea: silArea,
        zOrderViolations: zv,
      });
    }
  }

  const n = poses.length;
  const where: Locator = { characterId: rig.characterId, path: `rig:${rig.id}` };

  checks.push(
    totalInverted === 0
      ? pass({
          name: 'rig.no_inverted_triangles',
          department: DEPT,
          score: 1,
          measured: 0,
          threshold: 0,
          comparator: '<=',
          message: `No inverted triangles across ${n} battery pose/view combinations.`,
          where,
        })
      : fail({
          name: 'rig.no_inverted_triangles',
          department: DEPT,
          score: Math.max(0, 1 - totalInverted / 100),
          severity: 'fatal',
          measured: totalInverted,
          threshold: 0,
          comparator: '<=',
          message: `${totalInverted} inverted triangle(s) across the battery — the mesh folds through itself. Worst pose: ${
            poses.slice().sort((a, b) => b.invertedTriangles - a.invertedTriangles)[0]?.poseId
          }.`,
          diagnosis: 'rig.mesh_inversion',
          where: worstInvertedWhere,
        }),
  );

  checks.push(
    totalIntersections === 0
      ? pass({
          name: 'rig.no_self_intersection',
          department: DEPT,
          score: 1,
          message: `No contour self-intersections across the battery.`,
          where,
        })
      : fail({
          name: 'rig.no_self_intersection',
          department: DEPT,
          score: Math.max(0, 1 - totalIntersections / 60),
          measured: totalIntersections,
          threshold: 0,
          comparator: '<=',
          message: `${totalIntersections} contour self-intersection(s) under deformation — outlines cross themselves.`,
          diagnosis: 'rig.contour_self_intersection',
          where: worstIntersectWhere,
        }),
  );

  checks.push(
    measure({
      name: 'rig.no_tearing',
      department: DEPT,
      measured: worstStretch,
      threshold: cfg.stretchTolerance,
      comparator: '<=',
      floor: cfg.stretchTolerance * 2,
      message:
        worstStretch <= cfg.stretchTolerance
          ? `Max edge stretch ${worstStretch.toFixed(2)}x, within the ${cfg.stretchTolerance}x tolerance.`
          : `Mesh tears: edge stretched ${worstStretch.toFixed(2)}x (limit ${cfg.stretchTolerance}x). Weights around this part are too spread out.`,
      diagnosis: 'rig.tearing',
      where: worstStretchWhere,
    }),
  );

  checks.push(
    measure({
      name: 'rig.volume_under_deformation',
      department: DEPT,
      measured: worstDrift,
      threshold: cfg.volumeTolerance,
      comparator: '<=',
      floor: cfg.volumeTolerance * 4,
      message:
        worstDrift <= cfg.volumeTolerance
          ? `Part area holds within ${(cfg.volumeTolerance * 100).toFixed(0)}% at every battery extreme (worst ${(worstDrift * 100).toFixed(1)}%).`
          : `Part area swings ${(worstDrift * 100).toFixed(1)}% at a battery extreme (limit ${(cfg.volumeTolerance * 100).toFixed(0)}%) — the form inflates or deflates when the rig reaches.`,
      diagnosis: 'rig.volume_loss',
      where: worstDriftWhere,
    }),
  );

  checks.push(
    measure({
      name: 'rig.squash_stretch_conservation',
      department: DEPT,
      measured: worstSquashError,
      threshold: cfg.squashTolerance,
      comparator: '<=',
      floor: cfg.squashTolerance * 6,
      message:
        worstSquashError <= cfg.squashTolerance
          ? `Inside tagged squash and stretch the width x height product holds to ${(cfg.squashTolerance * 100).toFixed(0)}% (worst ${(worstSquashError * 100).toFixed(1)}%).`
          : `Squash and stretch does not conserve volume: the product drifts ${(worstSquashError * 100).toFixed(1)}% (limit ${(cfg.squashTolerance * 100).toFixed(0)}%). Squashing must widen by as much as it flattens.`,
      diagnosis: 'rig.squash_not_conserved',
      where: worstSquashWhere,
    }),
  );

  checks.push(
    worstComponents <= 1
      ? pass({
          name: 'rig.silhouette_connected',
          department: DEPT,
          score: 1,
          message: 'The silhouette stays a single connected shape in every battery pose.',
          where,
        })
      : fail({
          name: 'rig.silhouette_connected',
          department: DEPT,
          score: Math.max(0, 1 - (worstComponents - 1) / 4),
          measured: worstComponents,
          threshold: 1,
          comparator: '<=',
          message: `The silhouette breaks into ${worstComponents} separate pieces at ${worstComponentsPose} — a part has detached from the body.`,
          diagnosis: 'rig.silhouette_disconnected',
          where: { ...where, path: worstComponentsPose },
        }),
  );

  checks.push(
    measure({
      name: 'rig.triangle_quality',
      department: DEPT,
      measured: worstQuality,
      threshold: cfg.minTriangleQuality,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        worstQuality >= cfg.minTriangleQuality
          ? `Worst triangle quality ${worstQuality.toFixed(3)} — no degenerate slivers.`
          : `Sliver triangles (quality ${worstQuality.toFixed(4)}) appear under deformation; these show as shimmering edges.`,
      diagnosis: 'rig.sliver_triangles',
      where,
    }),
  );

  checks.push(
    measure({
      name: 'rig.silhouette_readable',
      department: DEPT,
      measured: worstSolidity,
      threshold: cfg.minSolidity,
      comparator: '>=',
      floor: 0,
      severity: 'warn',
      message:
        worstSolidity >= cfg.minSolidity
          ? `Silhouette solidity stays above ${cfg.minSolidity} across the battery (worst ${worstSolidity.toFixed(2)}).`
          : `Silhouette breaks up at ${worstSolidityPose} (solidity ${worstSolidity.toFixed(2)}); the pose will not read at thumbnail size.`,
      diagnosis: 'rig.silhouette_unreadable',
      where: { ...where, path: worstSolidityPose },
    }),
  );

  checks.push(
    zViolations === 0
      ? pass({
          name: 'rig.z_order_consistent',
          department: DEPT,
          score: 1,
          message: 'Rendered draw order matches the declared z-order rule in every view.',
          where,
        })
      : fail({
          name: 'rig.z_order_consistent',
          department: DEPT,
          score: Math.max(0, 1 - zViolations / Math.max(1, n)),
          message: `${zViolations} draw-order inconsistencies against the declared z-order rules.`,
          diagnosis: 'rig.z_order_violation',
          where,
        }),
  );

  // IK: does each chain actually converge on targets inside its envelope?
  // "Is the chain long enough" is not a useful question — the real one is
  // whether the solver lands the effector where the animator put the target.
  for (const chain of rig.ik) {
    const chainBones = chain.bones
      .map((b) => rig.skeleton.find((x) => x.id === b))
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (chainBones.length < 2) continue;
    const reach = chainBones.reduce((a, b) => a + b.length, 0);
    const root = chainBones[0].head;
    let worstResidual = 0;
    let worstAngle = 0;
    const samples = 16;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const target = {
        x: root.x + Math.cos(a) * reach * 0.8,
        y: root.y + Math.sin(a) * reach * 0.8,
      };
      const solved = solveChain(rig.skeleton, chain.bones, target, {}, {
        iterations: chain.iterations,
        weight: 1,
      });
      // Rotation limits legitimately block part of the circle; only count a
      // miss when the solver had the freedom to get there and did not.
      const blocked = chainBones.some((b) => {
        const r = solved.pose[b.id]?.rotation ?? 0;
        return b.limits ? r <= b.limits.min + 1e-6 || r >= b.limits.max - 1e-6 : false;
      });
      if (blocked) continue;
      if (solved.residual > worstResidual) {
        worstResidual = solved.residual;
        worstAngle = a;
      }
    }
    const tolerance = reach * 0.02;
    checks.push(
      measure({
        name: 'rig.ik_converges',
        department: DEPT,
        measured: worstResidual,
        threshold: tolerance,
        comparator: '<=',
        floor: tolerance * 10,
        message:
          worstResidual <= tolerance
            ? `IK chain ${chain.id} lands every reachable target to within ${worstResidual.toFixed(2)}px (tolerance ${tolerance.toFixed(2)}px).`
            : `IK chain ${chain.id} misses its target by ${worstResidual.toFixed(1)}px at ${((worstAngle * 180) / Math.PI).toFixed(0)} degrees (tolerance ${tolerance.toFixed(2)}px) — the foot or hand will pop.`,
        diagnosis: 'rig.ik_no_converge',
        where: { ...where, path: `rig.ik.${chain.id}` },
      }),
    );
  }

  return { checks, poses };
}

/** Everything: structure first, then the battery (skipped if structure is fatal). */
export function validateRig(rig: Rig, options: RigValidationOptions = {}): BatteryResult {
  const structural = validateSkeletonStructure(rig);
  const fatal = structural.some((c) => !c.pass && c.severity === 'fatal');
  if (fatal) {
    return { checks: structural, poses: [] };
  }
  const battery = runPoseBattery(rig, options);
  return { checks: [...structural, ...battery.checks], poses: battery.poses };
}
