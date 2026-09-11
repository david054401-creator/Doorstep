/**
 * Substrate agreement.
 *
 * Design law 4 in §2: a deterministic render substrate is the baseline.
 * The corollary nobody writes down is that swapping substrates has to be
 * provably safe — otherwise "we moved to Blender" quietly becomes "the
 * film changed and nobody can say how".
 *
 * This validator renders the same frames through both substrates and
 * compares them. It is deliberately not a pixel-identity test: Blender
 * contributes better line quality and real depth of field, and demanding
 * identical bytes would forbid exactly the improvement the swap exists
 * for. What it demands instead is that nothing *structural* moved —
 * layout, silhouette, colour and identity — and it reports the numbers
 * rather than a verdict alone.
 */

import type { ImageBuffer } from '../raster/buffer.ts';
import type { CheckResult, Locator } from '../core/result.ts';
import { pass, fail, measure } from '../core/result.ts';
import { ssim, opticalFlow, identityDescriptor, cosineSimilarity } from '../critics/tier1/metrics.ts';
import { lightnessMap } from '../raster/buffer.ts';
import { mean } from '../core/math.ts';
import type { BlenderPlan } from '../delivery/blender.ts';
import { unsupportedCount } from '../delivery/blender.ts';

const DEPT = 'render';

export type SubstrateFrame = {
  frame: number;
  baseline: ImageBuffer;
  candidate: ImageBuffer;
};

export type SubstrateOptions = {
  /** Largest acceptable net displacement between the two renders, in pixels. */
  maxOffsetPx?: number;
  /** Structural similarity floor. */
  minSsim?: number;
  /** Identity similarity floor between the two renders of the same frame. */
  minIdentity?: number;
  /** Max mean L* shift, in L* units — the colour script must survive. */
  maxLightnessShift?: number;
  /** Name of the substrate under test, for the message. */
  substrate?: string;
};

const D = {
  maxOffsetPx: 1,
  minSsim: 0.8,
  minIdentity: 0.9,
  maxLightnessShift: 4,
  substrate: 'blender_gp',
};

export type Registration = {
  /** Net displacement of the candidate relative to the baseline, in pixels. */
  dx: number;
  dy: number;
  offset: number;
  /** Mean local disagreement after the net displacement is removed. */
  residual: number;
};

/**
 * How far the candidate render sits from the baseline, measured rather
 * than eyeballed.
 *
 * Structural similarity is the obvious choice here and it is the wrong
 * one: on a frame that is mostly flat colour — which most animation
 * frames are — SSIM barely moves when the whole drawing slides sideways,
 * and it drops sharply when a line merely gets softer. That is backwards.
 * A substrate is allowed to draw a better line; it is not allowed to put
 * it somewhere else.
 *
 * So the layout check measures the net optical-flow displacement. A
 * softer line produces flow that points outward from every edge and
 * cancels to nothing; a misfitted camera, a pixel-centre convention or a
 * flipped axis produces flow that all points the same way and does not.
 * The residual is reported alongside it so a genuine local deformation
 * cannot hide behind a zero average.
 */
export function measureRegistration(baseline: ImageBuffer, candidate: ImageBuffer): Registration {
  const flow = opticalFlow(baseline, candidate, { levels: 4 });
  let su = 0;
  let sv = 0;
  let weight = 0;
  for (let i = 0; i < flow.u.length; i++) {
    const c = flow.confidence[i];
    if (c < 0.05) continue;
    su += flow.u[i] * c;
    sv += flow.v[i] * c;
    weight += c;
  }
  if (weight <= 0) return { dx: 0, dy: 0, offset: 0, residual: 0 };
  const dx = su / weight;
  const dy = sv / weight;
  let residual = 0;
  for (let i = 0; i < flow.u.length; i++) {
    const c = flow.confidence[i];
    if (c < 0.05) continue;
    residual += Math.hypot(flow.u[i] - dx, flow.v[i] - dy) * c;
  }
  return { dx, dy, offset: Math.hypot(dx, dy), residual: residual / weight };
}

export function validateSubstrateAgreement(
  frames: readonly SubstrateFrame[],
  where: Locator,
  options: SubstrateOptions = {},
): CheckResult[] {
  const maxOffset = options.maxOffsetPx ?? D.maxOffsetPx;
  const minSsim = options.minSsim ?? D.minSsim;
  const minIdentity = options.minIdentity ?? D.minIdentity;
  const maxShift = options.maxLightnessShift ?? D.maxLightnessShift;
  const substrate = options.substrate ?? D.substrate;

  if (frames.length === 0) {
    return [
      fail({
        name: 'substrate.agreement',
        department: DEPT,
        score: 0.5,
        severity: 'warn',
        message:
          `No frame pairs were supplied, so agreement between the baseline renderer and ${substrate} is unmeasured, not held.`,
        diagnosis: 'substrate.not_measured',
        where,
      }),
    ];
  }

  const sizeMismatch = frames.find(
    (f) =>
      f.baseline.width !== f.candidate.width || f.baseline.height !== f.candidate.height,
  );
  if (sizeMismatch) {
    return [
      fail({
        name: 'substrate.agreement',
        department: DEPT,
        score: 0,
        severity: 'error',
        message:
          `Frame ${sizeMismatch.frame} came back at ${sizeMismatch.candidate.width}x${sizeMismatch.candidate.height} from ${substrate} but ${sizeMismatch.baseline.width}x${sizeMismatch.baseline.height} from the baseline renderer. A resolution difference makes every other comparison meaningless, so nothing else was measured.`,
        diagnosis: 'substrate.resolution_mismatch',
        where: { ...where, frame: sizeMismatch.frame },
      }),
    ];
  }

  const registration = frames.map((f) => ({
    frame: f.frame,
    value: measureRegistration(f.baseline, f.candidate),
  }));
  const structural = frames.map((f) => ({ frame: f.frame, value: ssim(f.baseline, f.candidate) }));
  const identity = frames.map((f) => ({
    frame: f.frame,
    value: cosineSimilarity(identityDescriptor(f.baseline), identityDescriptor(f.candidate)),
  }));
  const lightness = frames.map((f) => ({
    frame: f.frame,
    value: Math.abs(mean([...lightnessMap(f.baseline)]) - mean([...lightnessMap(f.candidate)])),
  }));

  const worstOffset = registration.reduce((a, b) => (b.value.offset > a.value.offset ? b : a));
  const worstSsim = structural.reduce((a, b) => (b.value < a.value ? b : a));
  const worstIdentity = identity.reduce((a, b) => (b.value < a.value ? b : a));
  const worstShift = lightness.reduce((a, b) => (b.value > a.value ? b : a));
  const r = worstOffset.value;
  const direction =
    Math.abs(r.dx) >= Math.abs(r.dy)
      ? `${Math.abs(r.dx).toFixed(2)} px ${r.dx > 0 ? 'right' : 'left'}`
      : `${Math.abs(r.dy).toFixed(2)} px ${r.dy > 0 ? 'down' : 'up'}`;

  return [
    measure({
      name: 'substrate.layout_agreement',
      department: DEPT,
      measured: r.offset,
      threshold: maxOffset,
      comparator: '<=',
      floor: maxOffset * 8,
      message:
        r.offset <= maxOffset
          ? `${substrate} places the drawing where the baseline renderer does (largest net offset ${r.offset.toFixed(2)} px at frame ${worstOffset.frame} across ${frames.length} frame(s), local residual ${r.residual.toFixed(2)} px).`
          : `${substrate} puts the drawing ${direction} of where the baseline renderer puts it at frame ${worstOffset.frame}, past the ${maxOffset} px allowance. Something moved that the Film Graph did not ask to move — check the camera fit, the pixel-centre convention and the axis direction before blaming line quality.`,
      diagnosis: 'substrate.layout_drift',
      where: { ...where, frame: worstOffset.frame },
      evidence: [
        { kind: 'frame', ref: `frame:${worstOffset.frame}`, caption: `${substrate} render` },
        { kind: 'frame', ref: `baseline:${worstOffset.frame}`, caption: 'Baseline render' },
      ],
    }),
    measure({
      name: 'substrate.structure_agreement',
      department: DEPT,
      measured: worstSsim.value,
      threshold: minSsim,
      comparator: '>=',
      floor: 0.3,
      message:
        worstSsim.value >= minSsim
          ? `The two substrates draw the same picture (worst structural similarity ${worstSsim.value.toFixed(3)} at frame ${worstSsim.frame}).`
          : `Frame ${worstSsim.frame} is structurally different between substrates: similarity ${worstSsim.value.toFixed(3)} against a ${minSsim} floor, with no net displacement to explain it. Content is present in one render and absent in the other.`,
      diagnosis: 'substrate.content_mismatch',
      where: { ...where, frame: worstSsim.frame },
    }),
    measure({
      name: 'substrate.identity_agreement',
      department: DEPT,
      measured: worstIdentity.value,
      threshold: minIdentity,
      comparator: '>=',
      floor: 0.5,
      message:
        worstIdentity.value >= minIdentity
          ? `The characters read as the same characters in both substrates (worst identity similarity ${worstIdentity.value.toFixed(3)} at frame ${worstIdentity.frame}).`
          : `The character changes across substrates at frame ${worstIdentity.frame}: identity similarity ${worstIdentity.value.toFixed(3)} against a ${minIdentity} floor.`,
      diagnosis: 'substrate.identity_drift',
      where: { ...where, frame: worstIdentity.frame },
    }),
    measure({
      name: 'substrate.colour_agreement',
      department: DEPT,
      measured: worstShift.value,
      threshold: maxShift,
      comparator: '<=',
      floor: maxShift * 4,
      message:
        worstShift.value <= maxShift
          ? `The colour script survives the substrate swap (largest mean L* shift ${worstShift.value.toFixed(2)} at frame ${worstShift.frame}).`
          : `Frame ${worstShift.frame} shifts by ${worstShift.value.toFixed(2)} L* between substrates, past the ${maxShift} allowance. The usual cause is a view transform: the render must be written with a Standard transform, not a film look.`,
      diagnosis: 'substrate.colour_shift',
      where: { ...where, frame: worstShift.frame },
    }),
  ];
}

/**
 * A plan that cannot carry every element of the scene is not a substrate
 * failure to be argued about later — it is a known hole, and it says so
 * before a single frame is rendered.
 */
export function validatePlanCoverage(plan: BlenderPlan, where: Locator): CheckResult[] {
  const missing = unsupportedCount(plan);
  if (missing === 0) {
    return [
      pass({
        name: 'substrate.plan_coverage',
        department: DEPT,
        score: 1,
        message: `Every element of shot ${plan.shotId} is expressible as Grease Pencil geometry (${plan.frames.length} frame(s), plan ${plan.planHash.slice(0, 14)}).`,
        where,
      }),
    ];
  }
  return [
    fail({
      name: 'substrate.plan_coverage',
      department: DEPT,
      score: 0,
      severity: 'error',
      message: `${missing} element(s) of shot ${plan.shotId} cannot be expressed as Grease Pencil strokes — raster inserts have no stroke representation. The export recorded them rather than dropping them, and the render would be missing them.`,
      diagnosis: 'substrate.unsupported_element',
      where,
      evidence: [{ kind: 'json', ref: `plan:${plan.planHash}`, caption: 'Exported plan' }],
    }),
  ];
}
