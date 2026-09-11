/**
 * MIBO — the flagship case study cast.
 *
 * Original IP, original style bible, no studio reference anywhere in it
 * (design law 12). Preschool proportions, rounded shape language, two-tone
 * cel shading, heavy readable linework: the series bar the wedge market
 * already pays for.
 */

import type { CharacterDesign, ConstructionMass, FaceSpec } from '../../src/character/construct.ts';
import type { NamedSwatch, StyleBible, ExpressionName } from '../../src/graph/types.ts';
import { PRESCHOOL_TEMPLATE } from '../../src/rig/templates.ts';

export const MIBO_PALETTE: NamedSwatch[] = [
  { name: 'mibo.body', hex: '#F5B23C', role: 'MIBO body base', tolerance: 3 },
  { name: 'mibo.body.shade', hex: '#D1902A', role: 'MIBO body shadow', tolerance: 3 },
  { name: 'mibo.belly', hex: '#FFE2A8', role: 'MIBO belly / muzzle', tolerance: 3 },
  { name: 'mibo.belly.shade', hex: '#E8C589', role: 'MIBO belly shadow', tolerance: 3 },
  { name: 'mibo.ear', hex: '#E79A2E', role: 'MIBO ear', tolerance: 3 },
  { name: 'mibo.ear.shade', hex: '#C07C22', role: 'MIBO ear shadow', tolerance: 3 },
  { name: 'mibo.eye', hex: '#FFFFFF', role: 'eye white', tolerance: 2 },
  { name: 'mibo.pupil', hex: '#2A2118', role: 'pupil', tolerance: 2 },
  { name: 'mibo.mouth', hex: '#8C3B37', role: 'mouth interior', tolerance: 3 },
  { name: 'mibo.line', hex: '#3A2A1C', role: 'character line', tolerance: 2 },
  { name: 'pip.body', hex: '#6FBF8E', role: 'PIP body base', tolerance: 3 },
  { name: 'pip.body.shade', hex: '#4E9A6D', role: 'PIP body shadow', tolerance: 3 },
  { name: 'pip.belly', hex: '#CFEBD8', role: 'PIP belly', tolerance: 3 },
  { name: 'pip.belly.shade', hex: '#AACDB8', role: 'PIP belly shadow', tolerance: 3 },
  { name: 'sky.day', hex: '#BFE4F2', role: 'daytime sky', tolerance: 4 },
  { name: 'sky.dusk', hex: '#F2C39B', role: 'dusk sky', tolerance: 4 },
  { name: 'hill.far', hex: '#A9CFA0', role: 'far hills', tolerance: 4 },
  { name: 'hill.mid', hex: '#87B87E', role: 'mid hills', tolerance: 4 },
  { name: 'ground.near', hex: '#6FA267', role: 'near ground', tolerance: 4 },
  { name: 'ground.shade', hex: '#568350', role: 'ground shadow', tolerance: 4 },
  { name: 'tree.trunk', hex: '#8A6242', role: 'tree trunk', tolerance: 4 },
  { name: 'tree.leaf', hex: '#5E9E62', role: 'foliage', tolerance: 4 },
  { name: 'prop.lantern', hex: '#FFD98A', role: 'lantern glow', tolerance: 4 },
];

export const MIBO_STYLE_BIBLE: StyleBible = {
  id: 'bible_mibo_v1',
  version: 1,
  name: 'MIBO Series Bible',
  statement:
    'Warm, rounded, hand-held preschool world. Every hero form is built from circles and beans; ' +
    'nothing on a hero is sharp. Two-tone cel shading with a single warm key from the upper left. ' +
    'Line is constant weight and slightly darker than the fill it encloses. Backgrounds are simple, ' +
    'low-contrast and never busier than the character standing in front of them.',
  palette: MIBO_PALETTE,
  shapeLanguage: {
    primary: 'Circles and beans. Hero silhouettes fit inside a rounded triangle, wide at the base.',
    silhouetteRules: [
      'The head reads as a distinct mass from the body at any size.',
      'Limbs never overlap the torso outline for more than a third of their length.',
      'Ears break the head silhouette so the character is identifiable in pure black.',
    ],
    heroShapes: ['circle', 'bean', 'rounded square'],
    antagonistShapes: ['tall narrow rectangle', 'shallow wedge'],
  },
  lineRules: {
    weight: 3,
    weightVariance: 0.25,
    quality: 'constant',
    color: '#3A2A1C',
    interiorLines: false,
  },
  lightingRules: {
    keyDirection: 140,
    keyColor: '#FFF3D6',
    fillColor: '#BBD8E8',
    rimColor: '#FFE9B8',
    shadingModel: 'twoTone',
    shadowQuality: 'hard graphic edge, one shape per form, never feathered',
    ambientOcclusion: false,
  },
  textures: ['flat cel fill', 'very light paper grain on backgrounds only'],
  forbidden: [
    'gradients on characters',
    'photographic textures',
    'lens flare',
    'visible text or watermarks',
    'more than two tones on a single character form',
    'sharp points on any hero form',
    'desaturated or grey-dominant frames',
  ],
  referenceAssetIds: [],
  canvas: { width: 1920, height: 1080 },
  locked: true,
};

const MIBO_EXPRESSIONS: ExpressionName[] = [
  'neutral',
  'happy',
  'sad',
  'surprised',
  'thinking',
  'determined',
  'scared',
  'angry',
];

/**
 * MIBO's masses.
 *
 * Built the way an animator builds: a few big forms, not many small ones.
 * The torso is one bean spanning hips to chest, so it bends as a mass
 * instead of reading as three stacked cans. Each limb is one tapered form
 * spanning its whole chain, so the elbow and knee bend inside a single
 * continuous outline — no seam where two cut-out pieces meet.
 *
 * Depth ratios say what the form is in profile: a round arm is as wide from
 * the side as from the front (1.0); a flat ear nearly vanishes (0.3); the
 * muzzle sticks out forward and so gets a positive depth offset.
 */
const MIBO_MASSES: ConstructionMass[] = [
  // Ears sit behind the head in front view and break the silhouette.
  {
    name: 'L_ear', bone: 'L_ear', shape: 'egg', lengthScale: 1.45,
    widthHead: 0.3, widthTail: 0.18, depthRatio: 0.5, depthOffset: -0.12,
    fill: 'mibo.ear', shadeFill: 'mibo.ear.shade', z: 4, zByView: { back: 44 },
  },
  {
    name: 'R_ear', bone: 'R_ear', shape: 'egg', lengthScale: 1.45,
    widthHead: 0.3, widthTail: 0.18, depthRatio: 0.5, depthOffset: -0.12,
    fill: 'mibo.ear', shadeFill: 'mibo.ear.shade', z: 5, zByView: { back: 45 },
  },

  // Legs: one form each, thigh through shin, bending at the knee.
  {
    name: 'L_leg', bone: 'L_thigh', spanTo: 'L_shin', shape: 'taperedCylinder',
    lengthScale: 1, widthHead: 0.3, widthTail: 0.2, depthRatio: 1,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 10, zByView: { sideR: 8, sideL: 18, threeQuarterR: 9, threeQuarterL: 17 },
  },
  {
    name: 'R_leg', bone: 'R_thigh', spanTo: 'R_shin', shape: 'taperedCylinder',
    lengthScale: 1, widthHead: 0.3, widthTail: 0.2, depthRatio: 1,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 11, zByView: { sideR: 18, sideL: 8, threeQuarterR: 17, threeQuarterL: 9 },
  },
  {
    name: 'L_foot', bone: 'L_foot', shape: 'bean', lengthScale: 1.5,
    widthHead: 0.21, widthTail: 0.17, depthRatio: 1.9,
    fill: 'mibo.body.shade', z: 12, zByView: { sideR: 7, sideL: 19 },
  },
  {
    name: 'R_foot', bone: 'R_foot', shape: 'bean', lengthScale: 1.5,
    widthHead: 0.21, widthTail: 0.17, depthRatio: 1.9,
    fill: 'mibo.body.shade', z: 13, zByView: { sideR: 19, sideL: 7 },
  },

  // Torso: one bean, hips through chest.
  {
    name: 'torso', bone: 'hips', spanTo: 'chest', shape: 'bean',
    lengthScale: 1, widthHead: 0.66, widthTail: 0.52, depthRatio: 0.8,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 20,
  },
  {
    name: 'belly', bone: 'spine', shape: 'egg', lengthScale: 0.92,
    widthHead: 0.4, widthTail: 0.26, offset: -0.12, depthRatio: 0.3, depthOffset: 0.24,
    fill: 'mibo.belly', shadeFill: 'mibo.belly.shade', z: 24, hiddenIn: ['back'],
  },

  // Arms: one form each, shoulder through wrist.
  {
    name: 'L_arm', bone: 'L_upperarm', spanTo: 'L_forearm', shape: 'taperedCylinder',
    lengthScale: 1, widthHead: 0.23, widthTail: 0.17, depthRatio: 1,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 30,
    zByView: { sideR: 6, sideL: 34, threeQuarterR: 7, threeQuarterL: 33, back: 33 },
  },
  {
    name: 'R_arm', bone: 'R_upperarm', spanTo: 'R_forearm', shape: 'taperedCylinder',
    lengthScale: 1, widthHead: 0.23, widthTail: 0.17, depthRatio: 1,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 31,
    zByView: { sideR: 34, sideL: 6, threeQuarterR: 33, threeQuarterL: 7, back: 30 },
  },
  {
    name: 'L_hand', bone: 'L_hand', shape: 'sphere', lengthScale: 1.35,
    widthHead: 0.25, widthTail: 0.2, depthRatio: 0.95,
    fill: 'mibo.belly', shadeFill: 'mibo.belly.shade', z: 32,
    zByView: { sideR: 5, sideL: 35, threeQuarterL: 34 },
  },
  {
    name: 'R_hand', bone: 'R_hand', shape: 'sphere', lengthScale: 1.35,
    widthHead: 0.25, widthTail: 0.2, depthRatio: 0.95,
    fill: 'mibo.belly', shadeFill: 'mibo.belly.shade', z: 33,
    zByView: { sideR: 35, sideL: 5, threeQuarterR: 34 },
  },

  // Head. The neck is deliberately not drawn: at three head units there is
  // no visible neck, the head sits straight on the body.
  {
    name: 'head', bone: 'head', shape: 'sphere', lengthScale: 1,
    widthHead: 1.04, widthTail: 0.08, depthRatio: 0.94,
    fill: 'mibo.body', shadeFill: 'mibo.body.shade', z: 50,
  },
  {
    name: 'muzzle', bone: 'head', shape: 'egg', lengthScale: 0.4,
    widthHead: 0.54, widthTail: 0.18, offset: 0.1, depthRatio: 0.66, depthOffset: 0.17,
    fill: 'mibo.belly', shadeFill: 'mibo.belly.shade', z: 52, hiddenIn: ['back'],
  },
];

const MIBO_FACE: FaceSpec = {
  eyeRadius: 0.118,
  eyeSpacing: 0.215,
  eyeHeight: 0.44,
  pupilRatio: 0.56,
  browOffset: 0.055,
  mouthWidth: 0.3,
  mouthHeight: 0.2,
  mouthY: 0.74,
  faceDepth: 0.2,
  eyeFill: 'mibo.eye',
  pupilFill: 'mibo.pupil',
  mouthFill: 'mibo.mouth',
  browFill: 'mibo.line',
};

export const MIBO_DESIGN: CharacterDesign = {
  id: 'char_mibo',
  name: 'MIBO',
  template: PRESCHOOL_TEMPLATE,
  headHeightPx: 120,
  masses: MIBO_MASSES,
  face: MIBO_FACE,
  colorModel: MIBO_PALETTE.filter((s) => s.name.startsWith('mibo.')),
  lineColor: '#3A2A1C',
  lineWidth: 3,
  expressions: MIBO_EXPRESSIONS,
  views: ['front', 'threeQuarterL', 'threeQuarterR', 'sideR', 'back'],
};

/** PIP — MIBO's smaller companion. Same construction, different colour and scale. */
export const PIP_DESIGN: CharacterDesign = {
  ...MIBO_DESIGN,
  id: 'char_pip',
  name: 'PIP',
  headHeightPx: 88,
  masses: MIBO_MASSES.map((m) => ({
    ...m,
    fill: m.fill.replace('mibo.', 'pip.').replace('pip.ear', 'pip.body').replace('pip.eye', 'mibo.eye').replace('pip.pupil', 'mibo.pupil').replace('pip.mouth', 'mibo.mouth').replace('pip.line', 'mibo.line'),
    shadeFill: m.shadeFill?.replace('mibo.', 'pip.').replace('pip.ear.shade', 'pip.body.shade'),
  })),
  colorModel: [
    ...MIBO_PALETTE.filter((s) => s.name.startsWith('pip.')),
    ...MIBO_PALETTE.filter((s) => ['mibo.eye', 'mibo.pupil', 'mibo.mouth', 'mibo.line'].includes(s.name)),
  ],
};
