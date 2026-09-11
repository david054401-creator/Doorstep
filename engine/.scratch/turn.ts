import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { poseRig, defaultSwaps } from '../src/rig/rig.ts';
import { renderScene } from '../src/render/renderer.ts';
import { emptyScene } from '../src/render/scene.ts';
import { encodePng } from '../src/raster/png.ts';
import { parseHex } from '../src/core/color.ts';
import { mTranslate } from '../src/core/math.ts';
import { createImage, paste } from '../src/raster/buffer.ts';
import { writeFileSync } from 'node:fs';

const { rig } = autoRig(MIBO_DESIGN);
const W=300,H=440;
const sheet = createImage(W*rig.views.length, H, parseHex('#FBF7EF88'));
rig.views.forEach((view, i) => {
  const scene = emptyScene(W, H, parseHex('#F7F2E7'));
  const posed = poseRig(rig, {}, { view, swaps: defaultSwaps(rig), colorModel: MIBO_DESIGN.colorModel });
  scene.layers.push(posed.layer);
  scene.camera = mTranslate(W/2, H-30);
  paste(sheet, renderScene(scene, { samples: 4, supersample: 2 }), i*W, 0);
});
writeFileSync('/home/user/Doorstep/engine/.scratch/turnaround.png', encodePng(sheet));
console.log('views:', rig.views.join(', '));
