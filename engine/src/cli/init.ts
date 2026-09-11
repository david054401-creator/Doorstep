/**
 * `film init` — scaffold a new film.
 *
 * A platform you have to read the source of to start a project with is
 * not a platform. This writes the smallest complete thing that builds:
 * a script, a style bible, a cast, a config, and a README saying which
 * command to run next.
 *
 * What it deliberately does not do is copy MIBO. The scaffold is a
 * blank film with the structure in place — the example lives in
 * `examples/` and stays there.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILENAME } from '../providers/config.ts';
import type { FilmConfig } from '../providers/config.ts';

export type InitOptions = {
  name: string;
  /** Directory to write into. Must be empty of the files we write. */
  directory: string;
  fps?: number;
  width?: number;
  height?: number;
  force?: boolean;
};

export type InitResult = { written: string[]; skipped: string[] };

const SCRIPT = (name: string) => `Title: ${name}
Author: 
Draft date: ${new Date().getFullYear()}

EXT. SOMEWHERE - DAY

WIDE ON THE PLACE

Establish it. One image that says where we are and what the weather of
this story is.

ON THE HERO

HERO stands, deciding something.

HERO
(quietly)
The line they would only say here.

Something answers.
`;

const BIBLE = (name: string) => `/**
 * The style bible for ${name}.
 *
 * This is the taste, written down. Every prompt renders it, every
 * conformance check measures against it, and the forbidden list is
 * enforced rather than hoped for.
 *
 * Own work only. Do not train on, clone, or name another studio's
 * frames, characters or house style.
 */

import type { StyleBible, NamedSwatch } from '@doorstep/film-engine';

/**
 * The value ladder, darkest foreground to lightest distance. Aerial
 * perspective runs the distance lighter; the cast has to separate from
 * the plane it stands on by at least 20 L*.
 */
export const PALETTE: NamedSwatch[] = [
  { name: 'sky.day', hex: '#A9C7D6', role: 'daytime sky', tolerance: 4 },
  { name: 'far', hex: '#7FA98C', role: 'far distance', tolerance: 4 },
  { name: 'mid', hex: '#6C9663', role: 'middle distance', tolerance: 4 },
  { name: 'near', hex: '#37702F', role: 'near ground', tolerance: 4 },
  { name: 'foreground', hex: '#245020', role: 'foreground mass', tolerance: 4 },
  { name: 'line', hex: '#3A2A1C', role: 'character line', tolerance: 4 },
];

export const BIBLE: StyleBible = {
  id: 'bible_main',
  version: 1,
  name: '${name}',
  statement: 'One sentence. What this film looks like and why.',
  palette: PALETTE,
  shapeLanguage: {
    primary: 'round',
    silhouetteRules: ['Read in black at thumbnail size.'],
    heroShapes: ['circle', 'soft oval'],
    antagonistShapes: ['angular'],
  },
  lineRules: {
    weight: 3,
    weightVariance: 0.25,
    quality: 'constant',
    color: '#3A2A1C',
    interiorLines: false,
  },
  lightingRules: {
    keyDirection: -0.6,
    keyColor: '#FFF3D6',
    fillColor: '#9FB6C4',
    shadingModel: 'twoTone',
    shadowQuality: 'hard-edged, one step',
    ambientOcclusion: false,
  },
  textures: [],
  forbidden: [
    'photographic detail',
    'lens flare',
    'gradient meshes in the character fills',
    'text in frame',
  ],
  referenceAssetIds: [],
  canvas: { width: 1920, height: 1080 },
  locked: false,
};
`;

const PROJECT = (name: string, fps: number, width: number, height: number) => `/**
 * ${name} — the Film Graph.
 *
 * Everything downstream reads this and nothing else.
 */

import {
  scriptToSequence,
  buildCharacter,
  preschoolTemplate,
  type Project,
  type DeliverySpec,
} from '@doorstep/film-engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIBLE, PALETTE } from './bible.ts';

export const DELIVERY: DeliverySpec = {
  width: ${width},
  height: ${height},
  fps: ${fps},
  colorSpace: 'sRGB',
  loudnessTargetLufs: -16,
  masterCodec: 'prores422',
  deliverableCodec: 'h264',
  safeAreaPercent: 0.9,
};

export function buildProject(): Project {
  const script = readFileSync(join(import.meta.dirname, 'script.fountain'), 'utf8');

  // One character to start. \`buildCharacter\` constructs the drawing,
  // the model sheet and the rig together, so it is on model and
  // riggable by construction rather than by inspection.
  const hero = buildCharacter({
    id: 'char_hero',
    name: 'HERO',
    description: 'One line of who they are. This is injected into acting prompts.',
    template: preschoolTemplate(),
    palette: PALETTE,
  });

  const sequence = scriptToSequence(script, {
    fps: DELIVERY.fps,
    characterIds: { HERO: 'char_hero' },
    environmentIds: {},
  });

  return {
    id: 'proj_main',
    name: '${name}',
    logline: 'One sentence. What happens and who it happens to.',
    styleBible: BIBLE,
    characters: [hero],
    environments: [],
    sequences: [sequence],
    deliverySpec: DELIVERY,
    version: 1,
  };
}
`;

const README = (name: string) => `# ${name}

Built with the 2D Feature Engine. Structure first, pixels last.

## Run it

\`\`\`bash
film validate          # every check, no pixels
film studio --out out  # build everything the studio UI reads
film contract          # the thirteen hard invariants
\`\`\`

Gates hold by default: nothing downstream of a model sheet, a board or
the animatic runs until a person approves it in the studio. Pass
\`--gates approve\` to stand in for the director, and the build will
record in its caveats that nobody looked.

## Where the work is

| File | What it is |
| --- | --- |
| \`script.fountain\` | The script. Scene headings, shot headings, action, dialogue. |
| \`bible.ts\` | The taste, written down: palette, shape language, line, light, and what is forbidden. |
| \`project.ts\` | The Film Graph. Cast, environments, delivery spec. |
| \`${CONFIG_FILENAME}\` | Providers, substrate, thresholds. |

## Notes, not keyframes

You direct; the engine animates.

\`\`\`bash
film note "more punch on the jump"
\`\`\`

It answers with the operations it will perform, and says so plainly when
it does not understand — it never guesses.
`;

const GITIGNORE = `out/
.cache/
node_modules/
`;

export function scaffold(options: InitOptions): InitResult {
  const { directory, name } = options;
  const config: FilmConfig = {
    project: './project.ts',
    out: './out',
    substrate: 'ts_native',
    providers: {},
    critics: { gating: [] },
  };

  const files: [string, string][] = [
    [CONFIG_FILENAME, `${JSON.stringify(config, null, 2)}\n`],
    ['script.fountain', SCRIPT(name)],
    ['bible.ts', BIBLE(name)],
    [
      'project.ts',
      PROJECT(name, options.fps ?? 24, options.width ?? 1920, options.height ?? 1080),
    ],
    ['README.md', README(name)],
    ['.gitignore', GITIGNORE],
  ];

  mkdirSync(directory, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [file, body] of files) {
    const path = join(directory, file);
    // Never overwrite someone's script.
    if (existsSync(path) && !options.force) {
      skipped.push(path);
      continue;
    }
    writeFileSync(path, body);
    written.push(path);
  }
  return { written, skipped };
}
