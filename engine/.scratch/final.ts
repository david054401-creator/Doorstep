import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { repairRig } from '../src/rig/repair.ts';
import { poseRig, defaultSwaps } from '../src/rig/rig.ts';
import { renderScene } from '../src/render/renderer.ts';
import { emptyScene } from '../src/render/scene.ts';
import { encodePng } from '../src/raster/png.ts';
import { parseHex } from '../src/core/color.ts';
import { mTranslate } from '../src/core/math.ts';
import { createImage, paste } from '../src/raster/buffer.ts';
import { POSE_BATTERY } from '../src/rig/battery.ts';
import { writeFileSync } from 'node:fs';
const { rig: raw } = autoRig(MIBO_DESIGN);
const { rig } = repairRig(raw, { budget: { attempts: 24 } });
const W=250,H=380;
const cells: {view:any,pose:any,label:string}[] = [];
for (const v of rig.views) cells.push({view:v, pose:{}, label:v});
for (const id of ['p03_reach_forward','p05_crouch','p07_run_extreme','p12_squash','p19_wave']) {
  const bp = POSE_BATTERY.find(p=>p.id===id)!;
  cells.push({view:'front', pose:bp.pose, label:id});
}
const cols=5, rows=Math.ceil(cells.length/cols);
const sheet = createImage(W*cols, H*rows, parseHex('#FBF7EF'));
cells.forEach((c,i)=>{
  const scene = emptyScene(W,H,parseHex('#F7F2E7'));
  scene.layers.push(poseRig(rig, c.pose, { view:c.view, swaps: defaultSwaps(rig), colorModel: MIBO_DESIGN.colorModel }).layer);
  scene.camera = mTranslate(W/2, H-30);
  paste(sheet, renderScene(scene,{samples:4,supersample:2}), (i%cols)*W, Math.floor(i/cols)*H);
});
writeFileSync('/home/user/Doorstep/engine/.scratch/final.png', encodePng(sheet));
console.log(cells.map(c=>c.label).join(' | '));
