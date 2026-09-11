import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { prepareRig } from '../src/rig/rig.ts';
import { evaluatePose } from '../src/rig/skeleton.ts';
import { deformMesh, meshArea, stretchRatio } from '../src/rig/skin.ts';
import { applicableBattery } from '../src/rig/battery.ts';

const { rig } = autoRig(MIBO_DESIGN);
const prep = prepareRig(rig);
const boneIds = new Set(rig.skeleton.map(b=>b.id));
const battery = applicableBattery(boneIds);
const rows:any[]=[];
for (const view of rig.views) {
  const vs = prep.skeletonByView.get(view)!;
  const rest = evaluatePose(vs.bones, {}, vs.index);
  for (const bp of battery) {
    const posed = evaluatePose(vs.bones, bp.pose, vs.index);
    for (const part of prep.partsByView.get(view) ?? []) {
      const m = prep.meshByPart.get(part.id); if(!m) continue;
      const a0 = meshArea(deformMesh(m,rest), m.triangles);
      const a1 = meshArea(deformMesh(m,posed), m.triangles);
      const st = stretchRatio(m.vertices, deformMesh(m,posed), m.triangles);
      const drift = a0>1 ? Math.abs(a1-a0)/a0 : 0;
      rows.push({view, pose:bp.id, part:part.name, drift:+(drift*100).toFixed(1), stretch:+st.toFixed(2)});
    }
  }
}
rows.sort((a,b)=>b.drift-a.drift);
console.log('WORST DRIFT'); console.table(rows.slice(0,8));
rows.sort((a,b)=>b.stretch-a.stretch);
console.log('WORST STRETCH'); console.table(rows.slice(0,8));
