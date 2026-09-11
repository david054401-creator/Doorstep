import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { prepareRig } from '../src/rig/rig.ts';
import { evaluatePose } from '../src/rig/skeleton.ts';
import { deformMesh, meshArea } from '../src/rig/skin.ts';
import { POSE_BATTERY } from '../src/rig/battery.ts';
import { area as polyArea, bounds } from '../src/geom/polygon.ts';

const { rig } = autoRig(MIBO_DESIGN);
const prep = prepareRig(rig);
const view='sideR';
const vs = prep.skeletonByView.get(view)!;
const rest = evaluatePose(vs.bones, {}, vs.index);
const bp = POSE_BATTERY.find(p=>p.id==='p13_stretch')!;
const posed = evaluatePose(vs.bones, bp.pose, vs.index);
const part = (prep.partsByView.get(view)??[]).find(p=>p.name==='R_upperarm')!;
const m = prep.meshByPart.get(part.id)!;
const rv = deformMesh(m, rest), pv = deformMesh(m, posed);
console.log('tris', m.triangles.length/3, 'verts', m.vertices.length);
console.log('meshArea rest', meshArea(rv,m.triangles).toFixed(1), 'posed', meshArea(pv,m.triangles).toFixed(1));
console.log('polyArea rest contour', polyArea(m.contourVertexIndex[0].map(i=>rv[i])).toFixed(1),
            'posed', polyArea(m.contourVertexIndex[0].map(i=>pv[i])).toFixed(1));
console.log('bounds rest', JSON.stringify(bounds(rv)), 'posed', JSON.stringify(bounds(pv)));
const infl = new Set(m.weights.flat().map(w=>w.bone));
console.log('influences', [...infl]);
console.log('rotors:', [...infl].map(b=>({b, w: JSON.stringify(posed.bones.get(b)!.world)})));
