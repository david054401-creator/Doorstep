import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { blockShot } from '../src/animation/blocking.ts';
import { evaluateShot } from '../src/animation/evaluate.ts';
import { renderScene } from '../src/render/renderer.ts';
import { encodePng } from '../src/raster/png.ts';
import { createImage, paste } from '../src/raster/buffer.ts';
import { parseHex } from '../src/core/color.ts';
import { writeFileSync } from 'node:fs';
import { frameGroup, staticCurve } from '../src/render/camera.ts';

const project = buildMiboProject({ repairAttempts: 24 });
const shots = allShots(project.sequences[0]);
const W=320,H=180;
const picks = [0,1,2,3];
const rows: Buffer[] = [];
const sheet = createImage(W*6, H*picks.length, parseHex('#101014'));
picks.forEach((si,row)=>{
  const shot0 = shots[si];
  // Frame the subject properly rather than leaving the camera at the origin.
  const ch = project.characters.find(c=>c.id===shot0.staging.characters[0]?.characterId);
  const headPx = ch?.modelSheet.construction.headHeightPx ?? 120;
  const totalPx = headPx * (ch?.modelSheet.construction.headUnits ?? 3);
  const cam = frameGroup({ size: shot0.camera.size, subjects: shot0.staging.characters, subjectHeightPx: totalPx, headHeightPx: headPx, canvasWidth: W, canvasHeight: H, subjectTopY: -totalPx });
  const shot = { ...shot0, camera: { ...shot0.camera, move: staticCurve(cam) } };
  const { shot: blocked, idleLayers } = blockShot(shot, project.characters, { fps: 24, seed: 'demo' });
  const frames = evaluateShot(blocked, project, { fps: 24, idleLayers, environment: project.environments[0], width: W, height: H });
  for (let i=0;i<6;i++){
    const f = frames[Math.min(frames.length-1, Math.round(i*(frames.length-1)/5))];
    paste(sheet, renderScene(f.scene, { samples: 4 }), i*W, row*H);
  }
});
writeFileSync('/home/user/Doorstep/engine/.scratch/shots.png', encodePng(sheet));
console.log('rendered', picks.length, 'shots x 6 frames');
