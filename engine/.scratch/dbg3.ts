import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { prepareRig } from '../src/rig/rig.ts';
import { evaluatePose } from '../src/rig/skeleton.ts';
import { deformMesh } from '../src/rig/skin.ts';
import { mRotationOf, deg, mapply } from '../src/core/math.ts';
import { rad } from '../src/core/math.ts';

const { rig } = autoRig(MIBO_DESIGN);
const prep = prepareRig(rig);
const vs = prep.skeletonByView.get('front')!;
const pose = { hips:{translate:{x:0,y:28}}, L_thigh:{rotation:rad(-72)}, R_thigh:{rotation:rad(-72)}, L_shin:{rotation:rad(-115)}, R_shin:{rotation:rad(-115)}, L_foot:{rotation:rad(38)}, R_foot:{rotation:rad(38)} };
const posed = evaluatePose(vs.bones, pose, vs.index);
for (const id of ['hips','R_thigh','R_shin','R_foot']) {
  const pb = posed.bones.get(id)!;
  console.log(id, 'worldRot(deg)=', deg(mRotationOf(pb.world)).toFixed(1), 'head=', pb.head.x.toFixed(1), pb.head.y.toFixed(1), 'tail=', pb.tail.x.toFixed(1), pb.tail.y.toFixed(1));
}
const part = (prep.partsByView.get('front')??[]).find(p=>p.name==='R_shin')!;
const m = prep.meshByPart.get(part.id)!;
console.log('weights sample:', JSON.stringify(m.weights.slice(0,3)));
const d = deformMesh(m, posed);
console.log('vert0 rest', m.vertices[0], '-> posed', d[0]);
// direct single-bone transform for comparison
const shin = posed.bones.get('R_shin')!;
console.log('vert0 by R_shin only ->', mapply(shin.world, m.vertices[0]));
let mx=0,mi=0;
for(let i=0;i<d.length;i++){const e=Math.hypot(d[i].x,d[i].y); if(e>mx){mx=e;mi=i;}}
console.log('max |posed|', mx.toFixed(1), 'at vert', mi, JSON.stringify(m.weights[mi]));
