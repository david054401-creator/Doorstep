import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { evaluateShot } from '../src/animation/evaluate.ts';
import { frameGroup, staticCurve } from '../src/render/camera.ts';
import { bounds } from '../src/geom/polygon.ts';
const project = buildMiboProject({ repair: false });
const s0 = allShots(project.sequences[0])[0];
const cam = frameGroup({ size: s0.camera.size, subjects: s0.staging.characters, subjectHeightPx: 360, headHeightPx: 120, canvasWidth: 320, canvasHeight: 180, subjectTopY: -360 });
console.log('cam', JSON.stringify(cam));
const shot = { ...s0, camera: { ...s0.camera, move: staticCurve(cam) } };
const frames = evaluateShot(shot, project, { fps: 24, environment: project.environments[0], width: 320, height: 180 });
for (const l of frames[0].scene.layers) {
  const pts = l.shapes.flatMap(sh=>sh.contours.flat());
  const b = pts.length ? bounds(pts) : null;
  console.log(l.id, 'z='+l.z, 'shapes='+l.shapes.length, b?`bounds y ${b.y.toFixed(0)}..${(b.y+b.h).toFixed(0)} x ${b.x.toFixed(0)}..${(b.x+b.w).toFixed(0)}`:'-', 'fill='+ (l.shapes[0]?.fill?JSON.stringify(l.shapes[0].fill):'NONE'));
}
