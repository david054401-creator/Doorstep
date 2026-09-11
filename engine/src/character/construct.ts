/**
 * Constructive character build.
 *
 * Animators do not draw outlines, they build forms: spheres, cylinders,
 * tapered masses, hung on a construction skeleton in head units. This module
 * does the same thing in code, which gives the engine a deterministic,
 * on-model part atlas for every view of a character without asking an image
 * model for anything.
 *
 * In the full pipeline the part atlas can instead come from segmenting an
 * approved model sheet (see `parts.ts`, the SAM-2 / inpaint path). Both
 * produce the same `Part[]`, so everything downstream is identical. This
 * path is the one that always works, offline, byte-identically — and it is
 * what the organic pass has to beat.
 */

import type {
  Part,
  Point,
  ViewName,
  ModelSheet,
  ModelSheetView,
  Construction,
  Viseme,
  ExpressionName,
  NamedSwatch,
} from '../graph/types.ts';
import { VIEW_NAMES, VISEMES } from '../graph/types.ts';
import type { SkeletonTemplate } from '../rig/templates.ts';
import { clamp, lerp, rad } from '../core/math.ts';
import { makeId } from '../core/ids.ts';
import { bounds } from '../geom/polygon.ts';

export type MassShape = 'sphere' | 'egg' | 'capsule' | 'taperedCylinder' | 'bean' | 'wedge';

/** One construction mass: a form hung on a bone, sized in head units. */
export type ConstructionMass = {
  /** Part name, e.g. "head", "L_forearm". */
  name: string;
  bone: string;
  shape: MassShape;
  /** Along-bone extent as a multiple of bone length; 1 = exactly the bone. */
  lengthScale: number;
  /** Cross-bone width at the head and tail, in head units. */
  widthHead: number;
  widthTail: number;
  /** Offset along the bone, in head units, from the bone head. */
  offset?: number;
  /**
   * Bone whose tail is the far end of this mass. Set it to draw a whole
   * limb as one continuous tapered form that bends at the elbow, instead of
   * two cut-out pieces with a visible seam.
   */
  spanTo?: string;
  fill: string;
  shadeFill?: string;
  /** Draw order within the view. */
  z: number;
  /** Per-view z overrides, e.g. an arm goes behind the body in back view. */
  zByView?: Partial<Record<ViewName, number>>;
  /** Views where this mass is not drawn at all. */
  hiddenIn?: ViewName[];
  /**
   * Front-to-back extent as a multiple of the width.
   *
   * A turnaround does not squash a character: it shows the other side of a
   * solid form. In profile a round arm is exactly as wide as it is from the
   * front (depth ratio 1), while a flat ear nearly disappears (0.25).
   * Scaling every mass down by the same factor in side view is the mistake
   * that turns a character into a cardboard sliver.
   */
  depthRatio?: number;
  /** Where the mass sits front-to-back, in head units. Positive = forward. */
  depthOffset?: number;
  outline?: boolean;
};

export type FaceSpec = {
  /** Eye radius in head units. */
  eyeRadius: number;
  /** Eye separation as a fraction of head width. */
  eyeSpacing: number;
  /** Vertical eye position, 0 = top of head, 1 = chin. */
  eyeHeight: number;
  pupilRatio: number;
  browOffset: number;
  mouthWidth: number;
  mouthHeight: number;
  mouthY: number;
  /** How far the face sits forward of the head centre, in head units. */
  faceDepth: number;
  eyeFill: string;
  pupilFill: string;
  mouthFill: string;
  browFill: string;
};

export type CharacterDesign = {
  id: string;
  name: string;
  template: SkeletonTemplate;
  /** Pixel height of one head unit in rig space. */
  headHeightPx: number;
  masses: ConstructionMass[];
  face: FaceSpec;
  colorModel: NamedSwatch[];
  lineColor: string;
  lineWidth: number;
  expressions: ExpressionName[];
  /** Views to author. Five-angle rigs are the series standard. */
  views: ViewName[];
  /** Key-light direction in degrees; 140 is up and to the screen left. */
  lightKeyDirection?: number;
};

const TAU = Math.PI * 2;

/** Even-sampled ellipse. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, segments = 28, rotation = 0): Point[] {
  const out: Point[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return out;
}

/**
 * A capsule / tapered cylinder between two points, with rounded caps.
 * This is the workhorse for limbs and torsos.
 */
export function capsule(
  a: Point,
  b: Point,
  widthA: number,
  widthB: number,
  shape: MassShape = 'capsule',
  segments = 10,
): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const ra = widthA / 2;
  const rb = widthB / 2;
  const out: Point[] = [];

  const capA = shape === 'wedge' ? 0 : 1;
  const capB = shape === 'taperedCylinder' || shape === 'wedge' ? 0 : 1;

  // Right side, head to tail.
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = lerp(ra, rb, easeSide(t, shape));
    out.push({ x: a.x + ux * len * t + nx * w, y: a.y + uy * len * t + ny * w });
  }
  // Tail cap.
  if (capB) {
    for (let i = 1; i < segments; i++) {
      const ang = (i / segments) * Math.PI;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      out.push({
        x: b.x + (nx * c + ux * s) * rb,
        y: b.y + (ny * c + uy * s) * rb,
      });
    }
  }
  // Left side, tail to head.
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const w = lerp(ra, rb, easeSide(t, shape));
    out.push({ x: a.x + ux * len * t - nx * w, y: a.y + uy * len * t - ny * w });
  }
  // Head cap.
  if (capA) {
    for (let i = 1; i < segments; i++) {
      const ang = Math.PI + (i / segments) * Math.PI;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      out.push({
        x: a.x + (nx * c + ux * s) * ra,
        y: a.y + (ny * c + uy * s) * ra,
      });
    }
  }
  return out;
}

function easeSide(t: number, shape: MassShape): number {
  switch (shape) {
    case 'bean':
      // Widest at 40% — the "bean" body that reads friendly.
      return t < 0.4 ? (t / 0.4) * 0.5 : 0.5 + ((t - 0.4) / 0.6) * 0.5;
    case 'egg':
      return t ** 1.6;
    case 'sphere':
      return Math.sin(t * Math.PI) > 0 ? t : t;
    default:
      return t;
  }
}

/**
 * Lateral compression of positions per view.
 *
 * A three-quarter view brings the far side of the body toward the centre; a
 * profile brings it almost all the way. This only moves masses sideways —
 * how wide each mass *draws* is governed by its depth ratio, not by this.
 */
export const VIEW_LATERAL: Record<ViewName, number> = {
  front: 1,
  back: -1,
  threeQuarterL: 0.74,
  threeQuarterR: 0.74,
  sideL: 0.18,
  sideR: 0.18,
};

/** How far the view has turned toward profile, 0 = front/back, 1 = profile. */
export const VIEW_TURN: Record<ViewName, number> = {
  front: 0,
  back: 0,
  threeQuarterL: 0.45,
  threeQuarterR: 0.45,
  sideL: 1,
  sideR: 1,
};

/** Which way a turned view faces: -1 screen left, +1 screen right, 0 flat on. */
export const VIEW_FACING: Record<ViewName, number> = {
  front: 0,
  back: 0,
  threeQuarterL: -1,
  threeQuarterR: 1,
  sideL: -1,
  sideR: 1,
};

/** Project a rig-space point into a given view. */
export function projectToView(p: Point, view: ViewName, centerX: number): Point {
  const dx = p.x - centerX;
  return { x: centerX + dx * VIEW_LATERAL[view], y: p.y };
}

/**
 * Project a rig-space point that also carries a depth offset. As the view
 * turns toward profile, depth becomes horizontal screen distance.
 */
export function projectDepth(
  p: Point,
  view: ViewName,
  centerX: number,
  depthOffsetPx: number,
): Point {
  const base = projectToView(p, view, centerX);
  return { x: base.x + depthOffsetPx * VIEW_TURN[view] * VIEW_FACING[view], y: base.y };
}

/** Drawn width of a mass in a view: its width turning into its depth. */
export function viewWidth(width: number, depthRatio: number, view: ViewName): number {
  const turn = VIEW_TURN[view];
  return width * (1 - turn) + width * depthRatio * turn;
}

/**
 * Project a rest skeleton into a view.
 *
 * The parts of a three-quarter view are drawn in projected space, so the
 * bones that deform them must live in the same space or every weight is
 * computed against the wrong distance. Topology and limits are untouched;
 * only rest geometry moves.
 */
export function projectBones<T extends { id: string; head: Point; tail: Point }>(
  bones: readonly T[],
  view: ViewName,
  centerX: number,
): T[] {
  return bones.map((b) => {
    const head = projectToView(b.head, view, centerX);
    const tail = projectToView(b.tail, view, centerX);
    const dx = tail.x - head.x;
    const dy = tail.y - head.y;
    return {
      ...b,
      head,
      tail,
      restRotation: Math.atan2(dy, dx),
      length: Math.hypot(dx, dy),
    };
  });
}

/** Walk the template hierarchy from an ancestor bone down to a descendant. */
export function boneChainBetween(
  from: string,
  to: string,
  design: CharacterDesign,
): string[] {
  const parentOf = new Map<string, string | null>();
  for (const b of design.template.bones) parentOf.set(b.id, b.parent);
  const up: string[] = [];
  let cur: string | null = to;
  let guard = 0;
  while (cur && guard++ < 256) {
    up.push(cur);
    if (cur === from) return up.reverse();
    cur = parentOf.get(cur) ?? null;
  }
  return [from];
}

export type BuiltCharacter = {
  parts: Part[];
  modelSheet: ModelSheet;
  /** Bone id → part ids bound to it. */
  binding: Record<string, string[]>;
};

/**
 * Build the full part atlas for every requested view, plus the model sheet
 * measured off the built geometry (so the proportions in the sheet are the
 * real proportions of the rig, not an aspiration).
 */
export function buildCharacter(
  design: CharacterDesign,
  boneRest: Record<string, { head: Point; tail: Point }>,
): BuiltCharacter {
  const s = design.headHeightPx;
  const parts: Part[] = [];
  const binding: Record<string, string[]> = {};
  const centerX = boneRest.root?.head.x ?? 0;

  for (const view of design.views) {
    const viewMasses = design.masses.filter((m) => !m.hiddenIn?.includes(view));
    for (const mass of viewMasses) {
      const bone = boneRest[mass.bone];
      if (!bone) continue;
      const farBone = mass.spanTo ? boneRest[mass.spanTo] : undefined;
      const dx = bone.tail.x - bone.head.x;
      const dy = bone.tail.y - bone.head.y;
      const len = Math.hypot(dx, dy) || s * 0.1;
      const ux = dx / len;
      const uy = dy / len;
      const off = (mass.offset ?? 0) * s;
      const depthPx = (mass.depthOffset ?? 0) * s;
      const a: Point = { x: bone.head.x + ux * off, y: bone.head.y + uy * off };
      const b: Point = farBone
        ? { ...farBone.tail }
        : { x: a.x + ux * len * mass.lengthScale, y: a.y + uy * len * mass.lengthScale };

      const depthRatio = mass.depthRatio ?? 1;
      const wHead = viewWidth(mass.widthHead * s, depthRatio, view);
      const wTail = viewWidth(mass.widthTail * s, depthRatio, view);

      // Project the axis first, then build the form around it. Projecting
      // the finished outline instead would squeeze the mass's *width* by the
      // same factor as its position, and a profile view would flatten the
      // whole character into a sliver — the classic paper-doll mistake.
      // Width in a turned view comes from the form's depth, not from
      // squashing its front-facing width.
      const pa = projectDepth(a, view, centerX, depthPx);
      const pb = projectDepth(b, view, centerX, depthPx);
      const axisLen = Math.hypot(pb.x - pa.x, pb.y - pa.y);

      const contour =
        mass.shape === 'sphere' || mass.shape === 'egg'
          ? ellipse(
              (pa.x + pb.x) / 2,
              (pa.y + pb.y) / 2,
              wHead / 2,
              (axisLen + viewWidth(mass.widthTail * s, depthRatio, view)) / 2,
              30,
              Math.atan2(pb.y - pa.y, pb.x - pa.x) + Math.PI / 2,
            )
          : capsule(pa, pb, wHead, wTail, mass.shape, 12);

      const z = mass.zByView?.[view] ?? mass.z;
      const id = makeId('part', `${design.id}:${view}:${mass.name}`);
      const chain = mass.spanTo ? boneChainBetween(mass.bone, mass.spanTo, design) : undefined;
      parts.push({
        id,
        name: mass.name,
        view,
        z,
        contours: [contour],
        fill: mass.fill,
        shadeFill: mass.shadeFill,
        shadeContours: mass.shadeFill ? [shadeContour(contour, design)] : undefined,
        stroke: mass.outline === false ? undefined : { color: design.lineColor, width: design.lineWidth },
        pivot: { ...pa },
        bone: mass.bone,
        boneChain: chain,
      });
      (binding[mass.bone] ??= []).push(id);
    }

    // Face: eyes, brows, pupils, and the full mouth swap set.
    parts.push(...buildFace(design, boneRest, view, centerX));
  }

  const modelSheet = measureModelSheet(design, parts, boneRest);
  return { parts, modelSheet, binding };
}

/** Cel shadow: the lower-left third of a form, offset by the key direction. */
function shadeContour(contour: readonly Point[], design: CharacterDesign): Point[] {
  const bb = bounds(contour);
  const keyDir = rad(design.lightKeyDirection ?? 140);
  const nx = Math.cos(keyDir);
  const ny = -Math.sin(keyDir);
  // Half-plane cut across the form, pushed toward the lit side so the
  // terminator sits about two thirds of the way across rather than
  // splitting the form down the middle — a stripe reads as a stripe, a
  // shadow reads as form.
  const cx = bb.x + bb.w / 2 + nx * bb.w * 0.3;
  const cy = bb.y + bb.h / 2 + ny * bb.h * 0.3;
  const out: Point[] = [];
  for (const p of contour) {
    const d = (p.x - cx) * nx + (p.y - cy) * ny;
    if (d <= 0) out.push({ ...p });
  }
  if (out.length < 3) return [];
  // Close the cut with a straight edge across the form.
  const tx = -ny;
  const ty = nx;
  const projs = out.map((p) => (p.x - cx) * tx + (p.y - cy) * ty);
  const lo = Math.min(...projs);
  const hi = Math.max(...projs);
  out.push({ x: cx + tx * hi, y: cy + ty * hi });
  out.push({ x: cx + tx * lo, y: cy + ty * lo });
  void design;
  return out;
}

function buildFace(
  design: CharacterDesign,
  boneRest: Record<string, { head: Point; tail: Point }>,
  view: ViewName,
  centerX: number,
): Part[] {
  const head = boneRest.head;
  if (!head) return [];
  const s = design.headHeightPx;
  const f = design.face;
  const parts: Part[] = [];
  const headTop = Math.min(head.head.y, head.tail.y);
  const headBottom = Math.max(head.head.y, head.tail.y);
  const headH = headBottom - headTop;
  const hcx = projectToView({ x: (head.head.x + head.tail.x) / 2, y: 0 }, view, centerX).x;

  // Back view shows no face at all.
  if (view === 'back') return [];

  // Features sit on the front of the head, so as the view turns they slide
  // toward the facing side and the far eye is hidden by the skull.
  const facing = VIEW_FACING[view];
  const turn = VIEW_TURN[view];
  const faceShift = facing * turn * f.faceDepth * s;
  const visibleEyes: (-1 | 1)[] =
    turn >= 0.95 ? [facing >= 0 ? 1 : -1] : [-1, 1];

  const eyeY = headTop + headH * f.eyeHeight;
  const spacing = f.eyeSpacing * s;

  for (const side of visibleEyes) {
    // The near eye moves out toward the profile edge, the far eye crowds in.
    const near = facing !== 0 && side === facing;
    const lateral = spacing * side * (1 - turn * (near ? 0.35 : 0.75));
    const ex = hcx + lateral + faceShift;
    // Foreshortening: an eye seen at an angle narrows, it does not shrink.
    const narrow = 1 - turn * (near ? 0.12 : 0.55);
    const label = side < 0 ? 'L' : 'R';
    parts.push({
      id: makeId('part', `${design.id}:${view}:eye_${label}`),
      name: `eye_${label}`,
      view,
      z: 60,
      contours: [ellipse(ex, eyeY, f.eyeRadius * s * narrow, f.eyeRadius * s * 1.12, 20)],
      fill: f.eyeFill,
      stroke: { color: design.lineColor, width: design.lineWidth * 0.7 },
      pivot: { x: ex, y: eyeY },
      bone: 'head',
      swapSet: 'eyes',
      swapKey: 'open',
    });
    parts.push({
      id: makeId('part', `${design.id}:${view}:pupil_${label}`),
      name: `pupil_${label}`,
      view,
      z: 61,
      contours: [
        ellipse(
          ex,
          eyeY + f.eyeRadius * s * 0.08,
          f.eyeRadius * s * f.pupilRatio * narrow,
          f.eyeRadius * s * f.pupilRatio * 1.1,
          16,
        ),
      ],
      fill: f.pupilFill,
      pivot: { x: ex, y: eyeY },
      bone: 'head',
      swapSet: 'eyes',
      swapKey: 'open',
    });
    // Closed-eye variant: a lash line. Blinks swap to this.
    parts.push({
      id: makeId('part', `${design.id}:${view}:eyeclosed_${label}`),
      name: `eye_closed_${label}`,
      view,
      z: 60,
      contours: [
        capsule(
          { x: ex - f.eyeRadius * s * narrow, y: eyeY },
          { x: ex + f.eyeRadius * s * narrow, y: eyeY },
          design.lineWidth * 1.6,
          design.lineWidth * 1.6,
          'capsule',
          6,
        ),
      ],
      fill: design.lineColor,
      pivot: { x: ex, y: eyeY },
      bone: 'head',
      swapSet: 'eyes',
      swapKey: 'closed',
    });
    // Wide variant for surprise.
    parts.push({
      id: makeId('part', `${design.id}:${view}:eyewide_${label}`),
      name: `eye_wide_${label}`,
      view,
      z: 60,
      contours: [
        ellipse(ex, eyeY, f.eyeRadius * s * 1.25 * narrow, f.eyeRadius * s * 1.45, 20),
      ],
      fill: f.eyeFill,
      stroke: { color: design.lineColor, width: design.lineWidth * 0.7 },
      pivot: { x: ex, y: eyeY },
      bone: 'head',
      swapSet: 'eyes',
      swapKey: 'wide',
    });

    const browY = eyeY - f.eyeRadius * s - f.browOffset * s;
    parts.push({
      id: makeId('part', `${design.id}:${view}:brow_${label}`),
      name: `brow_${label}`,
      view,
      z: 62,
      contours: [
        capsule(
          { x: ex - f.eyeRadius * s * 0.95 * narrow, y: browY + f.eyeRadius * s * 0.12 * side },
          { x: ex + f.eyeRadius * s * 0.95 * narrow, y: browY - f.eyeRadius * s * 0.12 * side },
          design.lineWidth * 1.8,
          design.lineWidth * 1.4,
          'capsule',
          5,
        ),
      ],
      fill: f.browFill,
      pivot: { x: ex, y: browY },
      bone: 'head',
    });
  }

  // Mouth swap set: the nine Preston Blair shapes.
  const mouthX = hcx + faceShift * 1.15;
  const mouthY = headTop + headH * f.mouthY;
  for (const v of VISEMES) {
    parts.push({
      id: makeId('part', `${design.id}:${view}:mouth_${v}`),
      name: `mouth_${v}`,
      view,
      z: 63,
      contours: [
        visemeShape(v, mouthX, mouthY, f.mouthWidth * s * (1 - turn * 0.45), f.mouthHeight * s),
      ],
      fill: f.mouthFill,
      stroke: { color: design.lineColor, width: design.lineWidth * 0.6 },
      pivot: { x: mouthX, y: mouthY },
      bone: 'head',
      swapSet: 'mouth',
      swapKey: v,
    });
  }
  return parts;
}

/**
 * Preston Blair mouth shapes, as geometry.
 * X closed/rest, A closed consonant (M/B/P), B slightly open (consonants),
 * C open (E), D wide open (AI), E rounded (O), F teeth-on-lip (F/V),
 * G narrow round (U/W/Q), H tongue (L).
 */
export function visemeShape(v: Viseme, cx: number, cy: number, w: number, h: number): Point[] {
  switch (v) {
    case 'X':
      return capsule({ x: cx - w * 0.34, y: cy }, { x: cx + w * 0.34, y: cy }, h * 0.16, h * 0.16, 'capsule', 6);
    case 'A':
      return capsule({ x: cx - w * 0.38, y: cy }, { x: cx + w * 0.38, y: cy }, h * 0.22, h * 0.22, 'capsule', 6);
    case 'B':
      return ellipse(cx, cy, w * 0.4, h * 0.28, 20);
    case 'C':
      return ellipse(cx, cy, w * 0.46, h * 0.46, 22);
    case 'D':
      return ellipse(cx, cy + h * 0.1, w * 0.44, h * 0.72, 24);
    case 'E':
      return ellipse(cx, cy, w * 0.3, h * 0.44, 20);
    case 'F':
      return ellipse(cx, cy + h * 0.06, w * 0.36, h * 0.2, 18);
    case 'G':
      return ellipse(cx, cy, w * 0.22, h * 0.32, 18);
    case 'H':
      return ellipse(cx, cy + h * 0.06, w * 0.42, h * 0.5, 22);
    default:
      return ellipse(cx, cy, w * 0.3, h * 0.2, 16);
  }
}

/**
 * Measure the model sheet from the built geometry: proportion ratios, head
 * units, per-view keypoints and bounds. The identity and proportion gates
 * compare every future frame against these numbers.
 */
export function measureModelSheet(
  design: CharacterDesign,
  parts: readonly Part[],
  boneRest: Record<string, { head: Point; tail: Point }>,
): ModelSheet {
  const s = design.headHeightPx;
  const views: Partial<Record<ViewName, ModelSheetView>> = {};
  for (const view of design.views) {
    const viewParts = parts.filter((p) => p.view === view);
    const pts = viewParts.flatMap((p) => p.contours.flat());
    const bb = bounds(pts);
    const keypoints: Record<string, Point> = {};
    for (const [bone, rest] of Object.entries(boneRest)) {
      keypoints[bone] = { ...rest.head };
      keypoints[`${bone}_tail`] = { ...rest.tail };
    }
    views[view] = { view, keypoints, bounds: bb };
  }

  const headBone = boneRest.head;
  const headHeightPx = headBone ? Math.abs(headBone.tail.y - headBone.head.y) : s;
  const anyView = views[design.views[0]];
  const totalHeight = anyView ? anyView.bounds.h : s * design.template.headUnits;

  const dist = (a?: Point, b?: Point): number => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
  const proportionRatios: Record<string, number> = {
    totalHeightOverHead: headHeightPx > 0 ? totalHeight / headHeightPx : 0,
    shoulderWidthOverHead:
      headHeightPx > 0
        ? dist(boneRest.L_upperarm?.head, boneRest.R_upperarm?.head) / headHeightPx
        : 0,
    armLengthOverHead:
      headHeightPx > 0
        ? (dist(boneRest.L_upperarm?.head, boneRest.L_forearm?.head) +
            dist(boneRest.L_forearm?.head, boneRest.L_hand?.head)) /
          headHeightPx
        : 0,
    legLengthOverHead:
      headHeightPx > 0
        ? (dist(boneRest.L_thigh?.head, boneRest.L_shin?.head) +
            dist(boneRest.L_shin?.head, boneRest.L_foot?.head)) /
          headHeightPx
        : 0,
    torsoOverHead:
      headHeightPx > 0 ? dist(boneRest.hips?.head, boneRest.neck?.head) / headHeightPx : 0,
  };

  const construction: Construction = {
    headUnits: headHeightPx > 0 ? totalHeight / headHeightPx : design.template.headUnits,
    proportionRatios,
    headHeightPx,
  };

  return {
    id: makeId('sheet', `${design.id}:sheet`),
    version: 1,
    characterId: design.id,
    views,
    expressions: [...design.expressions],
    hands: ['open', 'fist', 'point'],
    construction,
    lineWeight: design.lineWidth,
    locked: false,
  };
}

/** Rest transforms of a bone list, keyed by id — the input `buildCharacter` wants. */
export function restMap(
  bones: readonly { id: string; head: Point; tail: Point }[],
): Record<string, { head: Point; tail: Point }> {
  const out: Record<string, { head: Point; tail: Point }> = {};
  for (const b of bones) out[b.id] = { head: { ...b.head }, tail: { ...b.tail } };
  return out;
}

export const ALL_VIEWS: readonly ViewName[] = VIEW_NAMES;
export const clampUnit = (v: number): number => clamp(v, 0, 1);
