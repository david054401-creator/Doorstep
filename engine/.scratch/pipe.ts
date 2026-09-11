import { buildMiboProject } from '../examples/mibo/project.ts';
import { buildPipeline } from '../src/orchestrator/pipeline.ts';
import { runDag } from '../src/orchestrator/runner.ts';
import { formatLedger } from '../src/orchestrator/budget.ts';
import { createLogger } from '../src/core/log.ts';

const log = createLogger({ echo: false });
console.time('project');
const project = buildMiboProject({ repairAttempts: 24 });
console.timeEnd('project');
const dag = buildPipeline(project, { width: 480, height: 270, samples: 2, throughStage: 'render', logger: log });
console.log('DAG nodes:', dag.order.length);
console.time('run');
const report = await runDag(dag, {
  concurrency: 4,
  logger: log,
  gates: (gate, node) => ({ gate, approved: true, by: 'dave', at: new Date().toISOString(), notes: 'auto-approved for the demo run' }),
});
console.timeEnd('run');
const byStatus = new Map<string, number>();
for (const r of report.results.values()) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
console.log('statuses:', [...byStatus].map(([k,v])=>`${k}=${v}`).join(' '));
console.log('score', report.scoreSheet.score.toFixed(3), 'passed', report.scoreSheet.passed, 'failed', report.scoreSheet.failed);
for (const [id, r] of report.results) {
  const bad = r.checks.filter(c=>!c.pass && c.severity !== 'info');
  if (bad.length) console.log(`  ${id}: ` + bad.map(c=>`${c.name}(${c.severity})`).join(', '));
}
console.log('\n' + formatLedger(report.ledger));
