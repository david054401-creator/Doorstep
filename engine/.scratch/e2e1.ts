import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { validateStory, checkContinuity } from '../src/story/validators.ts';
import { blockShot } from '../src/animation/blocking.ts';
import { evaluateShot } from '../src/animation/evaluate.ts';
import { validatePrinciples } from '../src/director/principles.ts';
import { scoreSheet } from '../src/core/result.ts';

console.time('build project');
const project = buildMiboProject({ repairAttempts: 24 });
console.timeEnd('build project');
const seq = project.sequences[0];
console.log('shots', allShots(seq).length, 'chars', project.characters.map(c=>`${c.name}(${c.rig?.parts.length}p)`).join(' '));

const story = [...validateStory(seq, project, { targetSeconds: 22, audience: 'preschool' }), ...checkContinuity(seq).checks];
console.log('STORY', scoreSheet('story', story).score.toFixed(3), story.filter(c=>!c.pass).map(c=>c.name).join(', ') || 'all pass');

const shot = allShots(seq)[0];
console.time('block');
const { shot: blocked, idleLayers } = blockShot(shot, project.characters, { fps: 24, seed: 'demo' });
console.timeEnd('block');
console.log('keys', blocked.keys.length, 'curves', blocked.curves.length, 'secondary', blocked.secondary.length, 'stepping', blocked.timing.stepping.length);
console.time('evaluate');
const frames = evaluateShot(blocked, project, { fps: 24, idleLayers, environment: project.environments[0], width: 640, height: 360 });
console.timeEnd('evaluate');
console.log('frames', frames.length, 'layers/frame', frames[0].scene.layers.length);
console.time('principles');
const primaryFrames = evaluateShot(blocked, project, { fps: 24, environment: project.environments[0], width: 640, height: 360, primaryOnly: true });
const checks = validatePrinciples(blocked, frames, project, { fps: 24, primaryFrames });
console.timeEnd('principles');
const sheet = scoreSheet('shot', checks);
console.log('PRINCIPLES score', sheet.score.toFixed(3), 'passed', sheet.passed, 'failed', sheet.failed);
for (const c of checks.filter(c=>!c.pass)) console.log(`  [${c.severity}] ${c.name}: ${c.message.slice(0,120)}`);

import { repairShot, formatCard } from '../src/director/repair.ts';
console.time('repairShot');
const fixed = repairShot(blocked, project, {
  evaluate: { fps: 24, idleLayers, environment: project.environments[0], width: 640, height: 360 },
  principles: { fps: 24 },
  budget: { attempts: 10 },
});
console.timeEnd('repairShot');
console.log('REPAIRED score', fixed.scoreSheet.score.toFixed(3), 'clean', fixed.clean);
console.log('moves:', fixed.records.map(r=>`${r.move}:${r.outcome}`).join(', '));
if (fixed.card) console.log('\n'+formatCard(fixed.card));
