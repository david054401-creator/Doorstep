import { buildMiboProject } from '../examples/mibo/project.ts';
import { allShots } from '../src/story/script-to-shots.ts';
import { blockShot } from '../src/animation/blocking.ts';
import { evaluateShot, effectorPath } from '../src/animation/evaluate.ts';
import { fitArc } from '../src/core/math.ts';
const project = buildMiboProject({ repair: false });
const shot = allShots(project.sequences[0])[0];
const { shot: blocked } = blockShot(shot, project.characters, { fps: 24, seed: 'demo' });
const frames = evaluateShot(blocked, project, { fps: 24, width: 320, height: 180, primaryOnly: true });
const keyFrames = [...new Set(blocked.keys.filter(k=>k.characterId==='char_mibo'&&k.kind==='key').map(k=>k.frame))].sort((a,b)=>a-b);
console.log('keys at', keyFrames, 'duration', blocked.durationFrames);
const p = effectorPath(frames, 'char_mibo', 'L_hand');
console.log('L_hand path:', p.map((q,i)=>i%4===0?`${i}:(${q.x.toFixed(0)},${q.y.toFixed(0)})`:'').filter(Boolean).join(' '));
const bounds=[0,...keyFrames,frames.length-1].filter((f,i,a)=>a.indexOf(f)===i);
for (let i=0;i<bounds.length-1;i++){
  const seg=p.slice(bounds[i],bounds[i+1]+1);
  if(seg.length<6) continue;
  const f=fitArc(seg);
  console.log(`  span ${bounds[i]}-${bounds[i+1]} len=${f.pathLength.toFixed(1)} R2=${f.r2.toFixed(3)} straight=${f.straightness.toFixed(2)}`);
}
