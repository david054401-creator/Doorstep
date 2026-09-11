/**
 * The MIBO demo project.
 *
 * A complete Film Graph assembled in code: style bible, rigged cast,
 * environments with multiplane depth, and a screenplay broken down into
 * shots. This is what the end-to-end pipeline runs on, and what the
 * marketing demo shows with the QA dashboard visible.
 */

import type {
  Project,
  Character,
  Environment,
  DeliverySpec,
  BGLayer,
  LayoutDrawing,
  Point,
} from '../../src/graph/types.ts';
import { MIBO_DESIGN, PIP_DESIGN, MIBO_STYLE_BIBLE, MIBO_PALETTE } from './design.ts';
import { autoRig } from '../../src/rig/autorig.ts';
import { repairRig } from '../../src/rig/repair.ts';
import { scriptToSequence } from '../../src/story/script-to-shots.ts';
import { makeId } from '../../src/core/ids.ts';
import type { Logger } from '../../src/core/log.ts';

export const MIBO_SCRIPT = `Title: MIBO and the Lost Hum
Author: Doorstep Labs
Draft date: 2026

EXT. HILLSIDE MEADOW - DAY

WIDE ON THE MEADOW

The grass holds still. Wind walks through it and moves on.

ON MIBO

MIBO sits on the grass, ears drooping.

MIBO
(quietly)
I lost my hum.

PIP bounces into frame.

PIP
Where did you have it last?

MIBO stands up and looks around the meadow.

MIBO
(thinking)
Under the big tree, maybe.

PIP spins once and points at the tree.

PIP
(brightly)
Then we look there!

ON MIBO

MIBO looks at the tree, then down at the grass, then up again.

MIBO RUNNING

MIBO runs toward the tree, ears flying.

MIBO
(determined)
Together!

UNDER THE BIG TREE

MIBO and PIP stop under the branches and listen.

THE HUM

A low sound moves down through the leaves. MIBO's ears lift. PIP goes still beside MIBO, listening too.
`;

export const MIBO_DELIVERY: DeliverySpec = {
  width: 1920,
  height: 1080,
  fps: 24,
  colorSpace: 'sRGB',
  loudnessTargetLufs: -16,
  masterCodec: 'prores422',
  deliverableCodec: 'h264',
  safeAreaPercent: 0.9,
};

/**
 * World scale.
 *
 * Everything in a Film Graph shares one world space, and it is set by the
 * cast: MIBO stands three head units tall with the feet on y = 0 and up
 * being negative y. So the horizon sits at eye height, not at the bottom of
 * the frame, and a "distant hill" is a shape that straddles the horizon —
 * not a small shape near the character's feet. Getting this wrong is why
 * generated backgrounds so often look like a painted flat behind a puppet.
 */
const GROUND_Y = 0;
const CHARACTER_HEIGHT = 360;
// A high horizon. The cast then plays against the hills rather than the
// sky, which is where the value separation is: a pale warm character on a
// pale sky has hue contrast and almost no value contrast, and reads as
// mush. Preschool layout does this on purpose.
const HORIZON_Y = -CHARACTER_HEIGHT * 1.5;
const WORLD_WIDTH = 9000;

/** A rolling hill silhouette that straddles the horizon. */
function hill(peakY: number, amplitude: number, phase: number, width = WORLD_WIDTH): Point[] {
  const pts: Point[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = -width / 2 + width * t;
    const y =
      peakY -
      Math.sin(t * Math.PI * 2 + phase) * amplitude -
      Math.sin(t * Math.PI * 5.3 + phase * 1.7) * amplitude * 0.34 -
      Math.sin(t * Math.PI * 11 + phase * 0.6) * amplitude * 0.12;
    pts.push({ x, y });
  }
  // Skirt the shape well below frame so it reads as a solid mass.
  pts.push({ x: width / 2, y: GROUND_Y + 4000 });
  pts.push({ x: -width / 2, y: GROUND_Y + 4000 });
  return pts;
}

function band(topY: number, bottomY: number, width = WORLD_WIDTH): Point[] {
  return [
    { x: -width / 2, y: topY },
    { x: width / 2, y: topY },
    { x: width / 2, y: bottomY },
    { x: -width / 2, y: bottomY },
  ];
}

function tree(x: number, baseY: number, scale: number): Point[][] {
  const h = 520 * scale;
  const trunk: Point[] = [
    { x: x - 34 * scale, y: baseY },
    { x: x - 22 * scale, y: baseY - h * 0.62 },
    { x: x + 22 * scale, y: baseY - h * 0.62 },
    { x: x + 34 * scale, y: baseY },
  ];
  const canopy: Point[] = [];
  const cx = x;
  const cy = baseY - h * 0.78;
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 5) * 0.1 + Math.sin(a * 3 + 1.1) * 0.07;
    canopy.push({
      x: cx + Math.cos(a) * 300 * scale * wobble,
      y: cy + Math.sin(a) * 215 * scale * wobble,
    });
  }
  return [trunk, canopy];
}

export function meadowEnvironment(): Environment {
  const layout: LayoutDrawing = {
    id: makeId('layout', 'meadow'),
    // The horizon is at eye height, which is what sets the camera's angle
    // on the world and what the layout validator checks every shot against.
    vanishingPoints: [{ x: 0.5, y: 0.2 }],
    horizonY: 0.2,
    blocks: [
      { id: 'ground', name: 'Ground plane', contours: [band(HORIZON_Y, GROUND_Y + 4000)], depth: 0.85 },
      { id: 'tree', name: 'Hero tree', contours: tree(980, GROUND_Y, 1), depth: 0.7 },
    ],
  };

  const layers: BGLayer[] = [
    {
      id: 'sky',
      name: 'Sky',
      depth: 0.02,
      fill: 'sky.day',
      contours: [band(HORIZON_Y - 4200, HORIZON_Y + 40)],
      haze: 0,
      parallax: 0.02,
    },
    {
      id: 'hills_far',
      name: 'Far hills',
      depth: 0.18,
      fill: 'hill.far',
      contours: [hill(HORIZON_Y - 30, 44, 0.4)],
      haze: 0.34,
      blur: 1.6,
      parallax: 0.18,
    },
    {
      id: 'hills_mid',
      name: 'Mid hills',
      depth: 0.34,
      fill: 'hill.mid',
      contours: [hill(HORIZON_Y + 26, 62, 2.1)],
      haze: 0.16,
      blur: 0.7,
      parallax: 0.34,
    },
    {
      id: 'tree_mid',
      name: 'Hero tree',
      depth: 0.58,
      fill: 'tree.leaf',
      contours: tree(980, GROUND_Y - 10, 1),
      haze: 0.06,
      parallax: 0.58,
    },
    {
      id: 'ground',
      name: 'Near ground',
      depth: 0.78,
      fill: 'ground.near',
      contours: [hill(HORIZON_Y + 96, 22, 1.2)],
      parallax: 0.78,
    },
    {
      id: 'grass_fg',
      name: 'Foreground grass',
      depth: 1,
      fill: 'ground.shade',
      contours: [band(GROUND_Y + 120, GROUND_Y + 2200)],
      blur: 2.4,
      parallax: 1,
    },
  ];

  return {
    id: 'env_hillside_meadow',
    name: 'Hillside Meadow',
    layout,
    layers,
    lightingKey: MIBO_STYLE_BIBLE.lightingRules,
    colorKey: MIBO_PALETTE.filter((s) =>
      ['sky.day', 'hill.far', 'hill.mid', 'ground.near', 'ground.shade', 'tree.leaf', 'tree.trunk'].includes(s.name),
    ),
    locked: true,
  };
}

export type BuildOptions = {
  logger?: Logger;
  /** Run the rig repair loop. On by default — a rig ships validated or not at all. */
  repair?: boolean;
  repairAttempts?: number;
};

export function buildMiboCast(options: BuildOptions = {}): Character[] {
  const designs = [MIBO_DESIGN, PIP_DESIGN];
  return designs.map((design) => {
    const { rig: raw, built } = autoRig(design);
    const rig =
      options.repair === false
        ? raw
        : repairRig(raw, {
            logger: options.logger,
            budget: { attempts: options.repairAttempts ?? 24 },
          }).rig;
    return {
      id: design.id,
      name: design.name,
      description:
        design.id === 'char_mibo'
          ? 'A small, round, hopeful creature who hums when happy and goes quiet when lost.'
          : 'MIBO’s smaller friend: quick, bouncy, and certain that everything is findable.',
      modelSheet: { ...built.modelSheet, locked: true },
      colorModel: design.colorModel,
      rig: { ...rig, locked: true },
      performanceLibrary: [],
      voiceId: design.id === 'char_mibo' ? 'voice_mibo' : 'voice_pip',
    };
  });
}

export function buildMiboProject(options: BuildOptions = {}): Project {
  const characters = buildMiboCast(options);
  const environments = [meadowEnvironment()];
  const sequence = scriptToSequence(MIBO_SCRIPT, {
    fps: MIBO_DELIVERY.fps,
    characterIds: { MIBO: 'char_mibo', PIP: 'char_pip' },
    environmentIds: { hillside_meadow: 'env_hillside_meadow' },
  });

  const now = new Date('2026-09-11T00:00:00.000Z').toISOString();
  return {
    id: 'proj_mibo_lost_hum',
    name: 'MIBO and the Lost Hum',
    logline:
      'A small creature loses the hum it makes when it is happy, and a friend helps it look.',
    styleBible: MIBO_STYLE_BIBLE,
    characters,
    environments,
    sequences: [sequence],
    deliverySpec: MIBO_DELIVERY,
    continuity: {
      entries: [],
      props: [],
    },
    createdAt: now,
    updatedAt: now,
    seed: 20260911,
    schemaVersion: 1,
  };
}
