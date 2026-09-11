import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { validateRig } from '../src/rig/validators.ts';
import { poseRig, defaultSwaps } from '../src/rig/rig.ts';
import { renderScene } from '../src/render/renderer.ts';
import { emptyScene } from '../src/render/scene.ts';
import { encodePng } from '../src/raster/png.ts';
import { parseHex } from '../src/core/color.ts';
import { mTranslate } from '../src/core/math.ts';
import { writeFileSync } from 'node:fs';

console.time('autorig');
const { rig } = autoRig(MIBO_DESIGN);
console.timeEnd('autorig');
console.log('bones', rig.skeleton.length, 'parts', rig.parts.length, 'meshes', rig.meshes.length);

console.time('validate');
const res = validateRig(rig);
console.timeEnd('validate');
for (const c of res.checks) {
  if (!c.pass) console.log(`  ${c.pass?'PASS':'FAIL'} [${c.severity}] ${c.name}: ${c.message}`);
}
console.log('checks', res.checks.length, 'failed', res.checks.filter(c=>!c.pass).length);

const scene = emptyScene(480, 640, parseHex('#F2EFE6'));
const posed = poseRig(rig, {}, { view: 'front', swaps: defaultSwaps(rig) });
scene.layers.push(posed.layer);
scene.camera = mTranslate(240, 620);
console.time('render');
const img = renderScene(scene, { samples: 4, supersample: 2 });
console.timeEnd('render');
writeFileSync('/home/user/Doorstep/engine/.scratch/mibo_front.png', encodePng(img));
console.log('rendered', img.width, 'x', img.height, 'bounds', JSON.stringify(posed.bounds));
