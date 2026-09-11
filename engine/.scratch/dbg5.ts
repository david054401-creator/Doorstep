import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { prepareRig } from '../src/rig/rig.ts';
import { evaluatePose } from '../src/rig/skeleton.ts';
import { deformMesh, triangleSigns } from '../src/rig/skin.ts';
import { applicableBattery } from '../src/rig/battery.ts';
const { rig } = autoRig(MIBO_DESIGN);
const prep = prepareRig(rig);
const battery = applicableBattery(new Set(rig.skeleton.map(b=>b.id)));
const tally = new Map<string, number>();
for (const view of rig.views) {
  const vs = prep.skeletonByView.get(view)!;
  const rest = evaluatePose(vs.bones, {}, vs.index);
  for (const bp of battery) {
    const posed = evaluatePose(vs.bones, bp.pose, vs.index);
    for (const part of prep.partsByView.get(view)??[]) {
      const m = prep.meshByPart.get(part.id); if(!m) continue;
      const a = triangleSigns(deformMesh(m,posed), m.triangles);
      const r = triangleSigns(deformMesh(m,rest), m.triangles);
      let n=0; for(let i=0;i<a.length;i++){ if(Math.abs(a[i])<1e-9||Math.abs(r[i])<1e-9)continue; if(Math.sign(a[i])!==Math.sign(r[i]))n++; }
      if(n) tally.set(`${bp.id}`, (tally.get(bp.id)??0)+n);
    }
  }
}
console.table([...tally.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>({part:k,inverted:v})));
