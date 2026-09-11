import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { blockShot } from '../src/animation/blocking.ts';
import { evaluateShot } from '../src/animation/evaluate.ts';
import { renderScene, renderCharacterPlate } from '../src/render/renderer.ts';
import { withFraming } from '../src/orchestrator/pipeline.ts';
import { validateValueStructure } from '../src/validators/color.ts';
import { silhouetteMask, maskBounds, lightnessMap } from '../src/raster/buffer.ts';
const project = buildMiboProject({ repair: false });
const env = project.environments[0];
for (const s0 of allShots(project.sequences[0]).slice(0,2)) {
  const shot = withFraming(s0, project, 480, 270, env);
  const { shot: blocked, idleLayers } = blockShot(shot, project.characters, { fps: 24, seed: shot.id });
  const frames = evaluateShot(blocked, project, { fps: 24, idleLayers, environment: env, width: 480, height: 270 });
  const f = frames[Math.floor(frames.length/2)];
  const img = renderScene(f.scene, { samples: 2 });
  for (const p of blocked.staging.characters) {
    const plate = renderCharacterPlate(f.scene, p.characterId, { samples: 2 });
    const mask = silhouetteMask(plate, 0.6); const bb = maskBounds(mask, plate.width, plate.height);
    const L = lightnessMap(img);
    let cs=0,cn=0,bs=0,bn=0; const pad=Math.round(Math.max(bb.w,bb.h)*0.25)+4;
    for(let y=Math.max(0,bb.y-pad);y<Math.min(img.height,bb.y+bb.h+pad);y++)for(let x=Math.max(0,bb.x-pad);x<Math.min(img.width,bb.x+bb.w+pad);x++){const i=y*img.width+x; if(mask[i]){cs+=L[i];cn++;}else{bs+=L[i];bn++;}}
    const r = validateValueStructure(img, plate);
    console.log(shot.number, p.characterId, 'size='+shot.camera.size, 'charL='+(cs/Math.max(1,cn)).toFixed(1), 'bgL='+(bs/Math.max(1,bn)).toFixed(1), 'bbox', JSON.stringify(bb), '->', r[0].pass?'PASS':'FAIL', r[0].measured?.toFixed(1));
  }
}
