import { MIBO_DESIGN } from '../examples/mibo/design.ts';
import { autoRig } from '../src/rig/autorig.ts';
import { repairRig } from '../src/rig/repair.ts';
import { scoreSheet } from '../src/core/result.ts';
import { createLogger } from '../src/core/log.ts';

const { rig } = autoRig(MIBO_DESIGN);
const log = createLogger({ echo: false, minLevel: 'info', color: false });
console.time('repair');
const out = repairRig(rig, { logger: log, budget: { attempts: 24 } });
console.timeEnd('repair');
const sheet = scoreSheet('rig', out.result.checks);
console.log(`\nscore ${sheet.score.toFixed(3)} passed ${sheet.passed} failed ${sheet.failed} clean=${out.clean}`);
for (const c of out.result.checks.filter(c=>!c.pass)) console.log(`  [${c.severity}] ${c.name}: ${c.message}`);
console.log('\nrepairs:', out.records.map(r=>`${r.move}(${r.outcome} ${r.scoreBefore.toFixed(3)}->${r.scoreAfter.toFixed(3)})`).join(', '));
if (out.escalation) console.log('\n' + out.escalation.summary);
