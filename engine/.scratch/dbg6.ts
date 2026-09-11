import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { repairRig } from '../src/rig/repair.ts';
const { rig } = autoRig(MIBO_DESIGN);
const out = repairRig(rig, { budget: { attempts: 24 } });
for (const c of out.result.checks.filter(c=>!c.pass)) {
  const part = out.rig.parts.find(p=>p.id===c.where.partId);
  console.log(c.name, '| part:', part?.name ?? '-', '| view:', part?.view ?? '-', '| bone:', c.where.boneId ?? '-', '|', c.where.path ?? '-');
}
