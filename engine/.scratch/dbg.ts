import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { evaluatePose, indexSkeleton } from '../src/rig/skeleton.ts';
import { deformMesh, meshArea, stretchRatio } from '../src/rig/skin.ts';
import { rad } from '../src/core/math.ts';

const { rig } = autoRig(MIBO_DESIGN);
const ix = indexSkeleton(rig.skeleton);
const rest = evaluatePose(rig.skeleton, {}, ix);
// check rest identity
let worstRest = 0, worstRestPart='';
for (const m of rig.meshes) {
  const d = deformMesh(m, rest);
  for (let i=0;i<d.length;i++){
    const e = Math.hypot(d[i].x-m.vertices[i].x, d[i].y-m.vertices[i].y);
    if (e>worstRest){worstRest=e;worstRestPart=m.partId;}
  }
}
console.log('rest deviation max:', worstRest.toFixed(6), worstRestPart);

const pose = { L_forearm: { rotation: rad(60) } };
const p = evaluatePose(rig.skeleton, pose, ix);
const front = rig.parts.filter(x=>x.view==='front');
const byId = new Map(front.map(x=>[x.id,x]));
const rows:any[] = [];
for (const m of rig.meshes) {
  const part = byId.get(m.partId); if(!part) continue;
  const a0 = meshArea(deformMesh(m, rest), m.triangles);
  const a1 = meshArea(deformMesh(m, p), m.triangles);
  const st = stretchRatio(m.vertices, deformMesh(m,p), m.triangles);
  rows.push({name: part.name, a0: a0.toFixed(0), drift: a0>0?((a1-a0)/a0*100).toFixed(1):'-', stretch: st.toFixed(2), infl: [...new Set(m.weights.flat().map(w=>w.bone))].join(',')});
}
rows.sort((a,b)=>Math.abs(+b.drift)-Math.abs(+a.drift));
console.table(rows.slice(0,8));
