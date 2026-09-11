/**
 * Orchestration, audio, critics, delivery and the contract.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDag, downstreamOf, upstreamOf, readyNodes, nodeCacheKey } from '../src/orchestrator/dag.ts';
import type { NodeContract } from '../src/orchestrator/dag.ts';
import { runDag } from '../src/orchestrator/runner.ts';
import { memoryCache, fileCache, nullCache } from '../src/orchestrator/cache.ts';
import { encodeArtifact, decodeArtifact, estimateBytes } from '../src/orchestrator/serialize.ts';
import { createLedger, planShots, formatLedger, DEFAULT_POLICY } from '../src/orchestrator/budget.ts';
import { pass, fail, scoreSheet } from '../src/core/result.ts';
import { provenance } from '../src/core/ids.ts';
import { canDeliver, auditInvariants, formatContract, INVARIANTS } from '../src/validators/invariants.ts';
import { measureLoudness, gainToTarget, dialogueBandOverlap } from '../src/audio/loudness.ts';
import { tone, encodeWav, decodeWav, applyGain, truePeak, mixInto, createAudio } from '../src/audio/wav.ts';
import { validateMix, validateSilenceGaps, validateAvSync, wordMatchRatio, validateIntelligibility } from '../src/audio/validators.ts';
import { parseVerdict, offlineVlm } from '../src/critics/vlm/client.ts';
import { runEnsemble } from '../src/critics/vlm/ensemble.ts';
import { emptyRegistry, canGate } from '../src/critics/types.ts';
import { calibrateCritic, withCalibration, bestThreshold, formatCalibration } from '../src/critics/calibration.ts';
import { SILHOUETTE_RUBRIC, ALL_RUBRICS, renderRubricPrompt } from '../src/critics/vlm/rubrics.ts';
import { ssim, warpError, opticalFlow, identityDescriptor, cosineSimilarity, perceptualDistance, flicker } from '../src/critics/tier1/metrics.ts';
import { createImage } from '../src/raster/buffer.ts';
import { fillContours, fillRect } from '../src/raster/rasterize.ts';
import { parseHex } from '../src/core/color.ts';
import { contactSheet, writeSequence, buildManifest, encodeMovie, countFrames } from '../src/delivery/sequence.ts';
import { memoryStore, invalidationBetween, lockAsset, staleShots } from '../src/graph/store.ts';
import { safeParseProject } from '../src/graph/schema.ts';
import { buildMiboProject, MIBO_DELIVERY } from '../examples/mibo/project.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const node = (
  id: string,
  inputs: string[],
  extra: Partial<NodeContract<never, unknown>> = {},
): NodeContract<never, unknown> => ({
  id,
  department: 'test',
  title: id,
  inputs,
  tool: 'test',
  toolVersion: '1',
  budget: { attempts: 1 },
  run: () => ({ id }),
  validate: () => [pass({ name: `${id}.ok`, department: 'test', score: 1, message: '', where: {} })],
  ...extra,
});

describe('the build graph', () => {
  test('orders roots before dependents', () => {
    const dag = buildDag([node('a', []), node('b', ['a']), node('c', ['b'])]);
    assert.deepEqual(dag.order, ['a', 'b', 'c']);
  });

  test('rejects a cycle and a missing input', () => {
    assert.throws(() => buildDag([node('a', ['b']), node('b', ['a'])]), /cycle/);
    assert.throws(() => buildDag([node('a', ['nope'])]), /not in the graph/);
  });

  test('invalidation reaches everything downstream', () => {
    const dag = buildDag([node('a', []), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])]);
    assert.deepEqual(downstreamOf(dag, 'a'), ['b', 'c', 'd']);
    assert.deepEqual(upstreamOf(dag, 'd'), ['a', 'b', 'c']);
  });

  test('readiness respects dependencies', () => {
    const dag = buildDag([node('a', []), node('b', ['a'])]);
    assert.deepEqual(readyNodes(dag, new Set()), ['a']);
    assert.deepEqual(readyNodes(dag, new Set(['a'])), ['b']);
  });

  test('the cache key changes with the tool, the params and the inputs', () => {
    const base = node('a', []);
    const k = nodeCacheKey(base, ['sha256:1']);
    assert.notEqual(k, nodeCacheKey({ ...base, toolVersion: '2' }, ['sha256:1']));
    assert.notEqual(k, nodeCacheKey({ ...base, params: { q: 1 } }, ['sha256:1']));
    assert.notEqual(k, nodeCacheKey(base, ['sha256:2']));
    assert.equal(k, nodeCacheKey(base, ['sha256:1']));
  });
});

describe('the runner', () => {
  test('runs a clean graph to completion', async () => {
    const dag = buildDag([node('a', []), node('b', ['a'])]);
    const report = await runDag(dag, { cache: memoryCache() });
    assert.equal(report.results.get('b')?.status, 'passed');
    assert.equal(report.escalated.length, 0);
  });

  test('a failure blocks everything downstream', async () => {
    const dag = buildDag([
      node('bad', [], {
        validate: () => [
          fail({ name: 'x', department: 'test', score: 0, severity: 'fatal', message: 'broken', where: {} }),
        ],
      }),
      node('after', ['bad']),
    ]);
    const report = await runDag(dag, { cache: memoryCache() });
    assert.equal(report.results.get('bad')?.status, 'escalated');
    assert.equal(report.results.get('after')?.status, 'blocked');
  });

  test('a human gate blocks until someone approves', async () => {
    const dag = buildDag([node('g', [], { gate: 'boards' }), node('after', ['g'])]);
    const blockedRun = await runDag(dag, { cache: memoryCache() });
    assert.equal(blockedRun.results.get('g')?.status, 'blocked');
    assert.match(blockedRun.results.get('g')!.escalation!.summary, /no path from failed to done that skips a human/);

    const approved = await runDag(dag, {
      cache: memoryCache(),
      gates: (gate) => ({ gate, approved: true, by: 'dave', at: 'now' }),
    });
    assert.equal(approved.results.get('after')?.status, 'passed');
  });

  test('a rejected gate escalates rather than proceeding', async () => {
    const dag = buildDag([node('g', [], { gate: 'animatic' }), node('after', ['g'])]);
    const report = await runDag(dag, {
      cache: memoryCache(),
      gates: (gate) => ({ gate, approved: false, by: 'dave', at: 'now', notes: 'staging is wrong' }),
    });
    assert.equal(report.results.get('g')?.status, 'escalated');
    assert.match(report.results.get('g')!.escalation!.summary, /staging is wrong/);
  });

  test('the repair loop fixes, and rolls back what does not help', async () => {
    let attempts = 0;
    const dag = buildDag([
      node('r', [], {
        budget: { attempts: 4 },
        run: () => ({ broken: true }),
        validate: (o) =>
          (o as { broken: boolean }).broken
            ? [fail({ name: 'r.check', department: 'test', score: 0.3, message: 'broken', diagnosis: 'd', where: {} })]
            : [pass({ name: 'r.check', department: 'test', score: 1, message: 'fixed', where: {} })],
        repair: () => {
          attempts++;
          return { broken: false };
        },
      }),
    ]);
    const report = await runDag(dag, { cache: memoryCache() });
    assert.equal(attempts, 1);
    assert.equal(report.results.get('r')?.status, 'passed');
    assert.equal(report.results.get('r')?.repairs[0].outcome, 'fixed');
  });

  test('a useless repair is not kept', async () => {
    const dag = buildDag([
      node('r', [], {
        budget: { attempts: 3 },
        run: () => ({ v: 1 }),
        validate: () => [
          fail({ name: 'r.check', department: 'test', score: 0.5, message: 'broken', diagnosis: 'd', where: {} }),
        ],
        repair: (o) => ({ ...(o as object), touched: true }),
      }),
    ]);
    const report = await runDag(dag, { cache: memoryCache() });
    const result = report.results.get('r')!;
    assert.equal(result.status, 'escalated');
    assert.ok(result.repairs.every((r) => r.outcome !== 'improved'));
    assert.match(result.escalation!.summary, /did not reach a clean score sheet/);
  });

  test('a throwing node fails loudly and does not take the run down', async () => {
    const dag = buildDag([
      node('boom', [], {
        run: () => {
          throw new Error('the renderer exploded');
        },
      }),
      node('other', []),
    ]);
    const report = await runDag(dag, { cache: memoryCache() });
    assert.equal(report.results.get('boom')?.status, 'failed');
    assert.match(report.results.get('boom')!.checks[0].message, /the renderer exploded/);
    assert.equal(report.results.get('other')?.status, 'passed');
  });

  test('a cached node is not re-run', async () => {
    let runs = 0;
    const cache = memoryCache();
    const make = () =>
      buildDag([
        node('c', [], {
          run: () => {
            runs++;
            return { v: 1 };
          },
        }),
      ]);
    await runDag(make(), { cache });
    await runDag(make(), { cache });
    assert.equal(runs, 1);
  });

  test('a forced node is re-run', async () => {
    let runs = 0;
    const cache = memoryCache();
    const make = () =>
      buildDag([
        node('c', [], {
          run: () => {
            runs++;
            return { v: 1 };
          },
        }),
      ]);
    await runDag(make(), { cache });
    await runDag(make(), { cache, force: ['c'] });
    assert.equal(runs, 2);
  });

  test('`when` skips a node without failing it', async () => {
    const dag = buildDag([node('s', [], { when: () => false })]);
    const report = await runDag(dag, { cache: memoryCache() });
    assert.equal(report.results.get('s')?.status, 'skipped');
  });
});

describe('caches', () => {
  test('memory and file caches behave the same', () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-cache-'));
    try {
      for (const cache of [memoryCache(), fileCache(dir)]) {
        const p = provenance({ tool: 't', toolVersion: '1', inputs: [] });
        assert.equal(cache.has('sha256:x'), false);
        cache.set('sha256:x', { v: 42 }, p);
        assert.equal(cache.has('sha256:x'), true);
        assert.deepEqual(cache.get<{ v: number }>('sha256:x')?.value, { v: 42 });
        cache.delete('sha256:x');
        assert.equal(cache.has('sha256:x'), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the null cache never hits', () => {
    const cache = nullCache();
    cache.set('sha256:x', 1, provenance({ tool: 't', toolVersion: '1', inputs: [] }));
    assert.equal(cache.get('sha256:x'), undefined);
  });
});

describe('caching an artifact that contains pixels', () => {
  const frame = (seed: number) => {
    const img = createImage(64, 48, { r: 250, g: 248, b: 240, a: 1 });
    fillRect(img, 4 + seed, 4, 20, 20, parseHex('#3a7ad9'));
    return img;
  };

  test('a frame survives the round trip byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-blob-'));
    try {
      const cache = fileCache(dir);
      const original = frame(2);
      cache.set('sha256:frame', { images: [original] }, provenance({ tool: 't', toolVersion: '1', inputs: [] }));
      // Drop the in-memory copy so the read really comes off disk.
      const reread = fileCache(dir).get<{ images: (typeof original)[] }>('sha256:frame');
      assert.ok(reread, 'the entry should be on disk');
      const back = reread!.value.images[0];
      assert.equal(back.width, original.width);
      assert.equal(back.height, original.height);
      assert.ok(back.data instanceof Uint8ClampedArray, 'the pixel buffer must come back typed');
      assert.deepEqual([...back.data], [...original.data]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a Map of plates is not silently emptied', () => {
    // JSON.stringify turns a Map into {}. The render node returns its
    // per-character plates in one, so before this was handled a cache
    // *hit* produced an output with no plates and the identity gate
    // quietly went from measured to unmeasured.
    const dir = mkdtempSync(join(tmpdir(), 'film-blob-'));
    try {
      const plates = new Map([['char_a', [frame(1), frame(3)]]]);
      fileCache(dir).set('sha256:plates', { plates }, provenance({ tool: 't', toolVersion: '1', inputs: [] }));
      const back = fileCache(dir).get<{ plates: Map<string, unknown[]> }>('sha256:plates');
      assert.ok(back!.value.plates instanceof Map);
      assert.equal(back!.value.plates.get('char_a')?.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('identical pixels are stored once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-blob-'));
    try {
      const cache = fileCache(dir);
      const p = provenance({ tool: 't', toolVersion: '1', inputs: [] });
      cache.set('sha256:a', { img: frame(5) }, p);
      const afterOne = cache.size();
      cache.set('sha256:b', { img: frame(5) }, p);
      const afterTwo = cache.size();
      // The second entry adds its small metadata file and nothing else:
      // a repair that changes one frame must not rewrite the rest.
      assert.ok(afterTwo - afterOne < 4096, `grew by ${afterTwo - afterOne} bytes`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an oversized entry is skipped, not fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-blob-'));
    try {
      const cache = fileCache(dir, { maxEntryMb: 0.001 });
      const entry = cache.set('sha256:big', { img: frame(0) }, provenance({ tool: 't', toolVersion: '1', inputs: [] }));
      assert.ok(entry.bytes > 1024);
      // Still served from memory within the run...
      assert.ok(cache.get('sha256:big'));
      // ...but not persisted, so the next run simply recomputes it.
      assert.equal(fileCache(dir).get('sha256:big'), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing blob is reported, not passed off as an empty frame', () => {
    const encoded = encodeArtifact({ img: frame(1) }, () => 'sha256:absent');
    assert.throws(() => decodeArtifact(encoded, () => undefined), /not in the store/);
  });

  test('NaN does not come back as a plausible zero', () => {
    const encoded = encodeArtifact({ measured: NaN, ratio: Infinity }, () => 'sha256:x');
    const back = decodeArtifact(encoded, () => new Uint8Array()) as { measured: number; ratio: number };
    assert.ok(Number.isNaN(back.measured));
    assert.equal(back.ratio, Infinity);
  });

  test('the size estimate counts pixels without stringifying them', () => {
    const img = frame(0);
    const bytes = estimateBytes({ images: [img, img] });
    assert.ok(bytes > 2 * img.data.byteLength, `estimated ${bytes}`);
    assert.ok(bytes < 3 * img.data.byteLength, `estimated ${bytes}`);
  });

  test('a cycle is refused rather than hung on', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    assert.throws(() => encodeArtifact(a, () => 'sha256:x'), /cycle/);
  });
});

describe('the producer', () => {
  test('ranks shots and stays inside the budget', () => {
    const project = buildMiboProject({ repair: false });
    const shots = project.sequences[0].scenes.flatMap((s) => s.shots);
    const { plans, totalEstimateUsd, withinBudget } = planShots(shots, DEFAULT_POLICY, 24);
    assert.equal(plans.length, shots.length);
    assert.ok(withinBudget, `estimated ${totalEstimateUsd}`);
    assert.ok(plans.every((p) => p.rationale.length > 20), 'every decision is explained');
  });

  test('a tiny budget turns the organic pass off rather than overspending', () => {
    const project = buildMiboProject({ repair: false });
    const shots = project.sequences[0].scenes.flatMap((s) => s.shots);
    const { plans } = planShots(shots, { ...DEFAULT_POLICY, totalBudgetUsd: 1 }, 24);
    assert.ok(plans.every((p) => p.organicPass === 'off'));
  });

  test('the ledger totals by department and by shot', () => {
    const ledger = createLedger();
    ledger.record('a', { department: 'rigging', durationMs: 100, shotId: 's1', costUsd: 0.5 });
    ledger.record('b', { department: 'rigging', durationMs: 200, shotId: 's1' });
    ledger.record('c', { department: 'render', durationMs: 50, shotId: 's2', costUsd: 1 });
    assert.equal(ledger.totalDurationMs(), 350);
    assert.equal(ledger.totalCostUsd(), 1.5);
    assert.equal(ledger.byShot().get('s1')?.nodes, 2);
    assert.match(formatLedger(ledger), /rigging/);
  });
});

describe('audio', () => {
  test('WAV round-trips at every bit depth', () => {
    const a = tone(48000, 440, 0.25, 0.5);
    for (const depth of [16, 24, 32] as const) {
      const back = decodeWav(encodeWav(a, depth));
      assert.equal(back.sampleRate, 48000);
      assert.equal(back.length, a.length);
      const tolerance = depth === 16 ? 1e-4 : 1e-6;
      for (let i = 0; i < a.length; i += 97) {
        assert.ok(Math.abs(back.channels[0][i] - a.channels[0][i]) < tolerance, `depth ${depth}`);
      }
    }
  });

  test('loudness responds correctly to gain', () => {
    const a = tone(48000, 1000, 3, 0.5);
    const base = measureLoudness(a).integrated;
    const quieter = measureLoudness(applyGain(a, -12)).integrated;
    assert.ok(Math.abs(base - quieter - 12) < 0.01, `${base} vs ${quieter}`);
  });

  test('true peak matches the signal', () => {
    assert.ok(Math.abs(truePeak(tone(48000, 100, 0.5, 0.5)) - 0.5) < 0.02);
  });

  test('the gain to target is computed and applying it lands on target', () => {
    const a = tone(48000, 1000, 3, 0.5);
    const g = gainToTarget(measureLoudness(a).integrated, -16);
    assert.ok(Math.abs(measureLoudness(applyGain(a, g)).integrated + 16) < 0.05);
  });

  test('the mix validator catches clipping and off-target loudness', () => {
    const hot = applyGain(tone(48000, 1000, 2, 0.99), 6);
    const checks = validateMix(hot, MIBO_DELIVERY);
    assert.ok(checks.some((c) => c.name === 'audio.no_clipping' && !c.pass));
    assert.ok(checks.some((c) => c.name === 'audio.loudness_on_target' && !c.pass));
  });

  test('dead air is found', () => {
    const audio = createAudio(48000, 1, 48000 * 6);
    mixInto(audio, tone(48000, 440, 1, 0.4), 0);
    const check = validateSilenceGaps(audio, 2.5);
    assert.equal(check.pass, false);
    assert.equal(check.diagnosis, 'audio.dead_air');
  });

  test('A/V sync is measured in frames', () => {
    const audio = tone(48000, 440, 2, 0.3);
    assert.equal(validateAvSync(audio, 48, 24).pass, true);
    assert.equal(validateAvSync(audio, 96, 24).pass, false);
  });

  test('the transcript round-trip is order sensitive', () => {
    assert.equal(wordMatchRatio('the cat sat', 'the cat sat'), 1);
    assert.ok(wordMatchRatio('the cat sat', 'the dog sat') < 1);
    assert.ok(wordMatchRatio('the cat sat', 'sat cat the') < 1);
  });

  test('with no transcriber the check reports unmeasured, never passed', async () => {
    const check = await validateIntelligibility(tone(48000, 440, 1, 0.3), 'hello', undefined);
    assert.equal(check.pass, false);
    assert.match(check.message, /unmeasured, not passed/);
  });

  test('music sitting in the speech band is detected', () => {
    const speech = tone(48000, 2000, 2, 0.5);
    const bass = tone(48000, 80, 2, 0.5);
    const competing = tone(48000, 2500, 2, 0.8);
    assert.ok(dialogueBandOverlap(speech, competing) > dialogueBandOverlap(speech, bass));
  });
});

describe('critics', () => {
  test('an uncited failure is downgraded', () => {
    const v = parseVerdict('{"verdict":"fail","confidence":0.9,"citations":[],"rationale":"bad"}', SILHOUETTE_RUBRIC, 'm');
    assert.equal(v.verdict, 'uncertain');
    assert.match(v.rationale, /cited no frame/);
  });

  test('a cited failure survives, even inside a code fence', () => {
    const v = parseVerdict(
      'Here you go:\n```json\n{"verdict":"fail","confidence":0.8,"citations":[{"frame":7,"note":"blob"}],"rationale":"unreadable"}\n```',
      SILHOUETTE_RUBRIC,
      'm',
    );
    assert.equal(v.verdict, 'fail');
    assert.deepEqual(v.citations.map((c) => c.frame), [7]);
  });

  test('junk from the model becomes uncertain, not a pass', () => {
    const v = parseVerdict('I think it looks great!', SILHOUETTE_RUBRIC, 'm');
    assert.equal(v.verdict, 'uncertain');
  });

  test('every rubric states what a failure looks like and demands citations', () => {
    for (const r of ALL_RUBRICS) {
      assert.ok(r.failWhen.length >= 2, r.id);
      assert.ok(r.passWhen.length >= 1, r.id);
      const prompt = renderRubricPrompt(r, {}, [0, 1]);
      assert.match(prompt, /Cite a frame number/);
      assert.match(prompt, /do not infer from the context/);
    }
  });

  test('with no critic configured the check says unmeasured', async () => {
    const registry = emptyRegistry();
    registry.vlm = [offlineVlm()];
    const result = await runEnsemble(
      registry.vlm,
      { rubric: SILHOUETTE_RUBRIC, images: [{ image: createImage(8, 8), frame: 0 }], context: {} },
      registry,
    );
    assert.equal(result.consensus, 'uncertain');
    assert.match(result.check.message, /unmeasured, not passed/);
  });

  test('disagreement escalates instead of voting', async () => {
    const yes = { name: 'y', model: 'y', critique: async () => ({ critic: 'vlm', rubric: SILHOUETTE_RUBRIC.id, verdict: 'pass' as const, confidence: 1, citations: [], rationale: 'fine', model: 'y' }) };
    const no = { name: 'n', model: 'n', critique: async () => ({ critic: 'vlm', rubric: SILHOUETTE_RUBRIC.id, verdict: 'fail' as const, confidence: 1, citations: [{ frame: 3, note: 'blob' }], rationale: 'broken', model: 'n' }) };
    const result = await runEnsemble([yes, no], { rubric: SILHOUETTE_RUBRIC, images: [], context: {} }, emptyRegistry());
    assert.equal(result.consensus, 'escalate');
    assert.match(result.check.message, /Escalating to a human rather than taking a vote/);
  });

  test('an uncalibrated critic advises but cannot block', async () => {
    const no = { name: 'n', model: 'n', critique: async () => ({ critic: 'vlm', rubric: SILHOUETTE_RUBRIC.id, verdict: 'fail' as const, confidence: 1, citations: [{ frame: 1, note: 'x' }], rationale: 'broken', model: 'n' }) };
    const uncalibrated = await runEnsemble([no], { rubric: SILHOUETTE_RUBRIC, images: [], context: {} }, emptyRegistry());
    assert.equal(uncalibrated.check.severity, 'warn');
    assert.match(uncalibrated.check.message, /not calibrated/);

    const registry = withCalibration(emptyRegistry(), {
      rubricId: SILHOUETTE_RUBRIC.id,
      model: 'n',
      samples: 200,
      truePositives: 95,
      falsePositives: 5,
      trueNegatives: 95,
      falseNegatives: 5,
      precision: 0.95,
      recall: 0.95,
      f1: 0.95,
      gating: true,
      measuredAt: 'now',
    });
    registry.vlm = [no];
    const calibrated = await runEnsemble([no], { rubric: SILHOUETTE_RUBRIC, images: [], context: {} }, registry);
    assert.equal(calibrated.check.severity, SILHOUETTE_RUBRIC.severity);
    assert.equal(canGate(registry, SILHOUETTE_RUBRIC.id, 'n'), true);
  });

  test('calibration measures precision and recall and gates on them', async () => {
    // A critic that flags exactly the broken half.
    const perfect = {
      name: 'p',
      model: 'p',
      critique: async (req: { images: { frame: number }[] }) => ({
        critic: 'vlm',
        rubric: SILHOUETTE_RUBRIC.id,
        verdict: (req.images[0].frame >= 100 ? 'fail' : 'pass') as 'fail' | 'pass',
        confidence: 1,
        citations: [{ frame: req.images[0].frame, note: '' }],
        rationale: '',
        model: 'p',
      }),
    };
    const examples = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      images: [{ image: createImage(4, 4), frame: i < 30 ? i : 100 + i }],
      broken: i >= 30,
    }));
    const c = await calibrateCritic(perfect, SILHOUETTE_RUBRIC, examples);
    assert.equal(c.precision, 1);
    assert.equal(c.recall, 1);
    assert.equal(c.gating, true);
    assert.match(formatCalibration(c), /CALIBRATED/);
  });

  test('a threshold sweep finds the separating value', () => {
    const samples = [
      ...Array.from({ length: 50 }, (_, i) => ({ value: 0.1 + i * 0.002, broken: false })),
      ...Array.from({ length: 50 }, (_, i) => ({ value: 0.6 + i * 0.002, broken: true })),
    ];
    const best = bestThreshold(samples)!;
    assert.ok(best.f1 > 0.99);
    assert.ok(best.threshold > 0.2 && best.threshold < 0.62, `threshold ${best.threshold}`);
  });
});

describe('tier-1 metrics', () => {
  const a = createImage(64, 64, { r: 250, g: 248, b: 240, a: 1 });
  fillContours(a, [[{ x: 10, y: 10 }, { x: 50, y: 12 }, { x: 46, y: 52 }, { x: 14, y: 48 }]], { color: parseHex('#3a7ad9') });
  const shifted = createImage(64, 64, { r: 250, g: 248, b: 240, a: 1 });
  fillContours(shifted, [[{ x: 14, y: 10 }, { x: 54, y: 12 }, { x: 50, y: 52 }, { x: 18, y: 48 }]], { color: parseHex('#3a7ad9') });

  test('SSIM is one against itself and lower against a change', () => {
    assert.ok(ssim(a, a) > 0.999);
    assert.ok(ssim(a, shifted) < 0.95);
  });

  test('optical flow recovers a known translation', () => {
    const f = opticalFlow(a, shifted);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < f.u.length; i++) {
      if (f.confidence[i] < 0.3) continue;
      sum += f.u[i];
      n++;
    }
    assert.ok(n > 0);
    assert.ok(Math.abs(sum / n - 4) < 2.2, `mean u ${sum / n}, expected about 4`);
  });

  test('warp error is lower for coherent motion than for noise', () => {
    const noisy = createImage(64, 64, { r: 250, g: 248, b: 240, a: 1 });
    for (let i = 0; i < noisy.data.length; i += 4) noisy.data[i] = (i * 37) % 255;
    assert.ok(warpError(a, shifted) < warpError(a, noisy));
  });

  test('perceptual distance is zero against itself', () => {
    assert.ok(perceptualDistance(a, a) < 1e-6);
    assert.ok(perceptualDistance(a, shifted) > 0.01);
  });

  test('the identity descriptor separates characters', () => {
    const other = createImage(64, 64, { r: 250, g: 248, b: 240, a: 1 });
    fillRect(other, 10, 10, 40, 40, parseHex('#d94a3a'));
    const da = identityDescriptor(a);
    const db = identityDescriptor(shifted);
    const dc = identityDescriptor(other);
    assert.ok(cosineSimilarity(da, da) > 0.999);
    assert.ok(cosineSimilarity(da, db) > cosineSimilarity(da, dc), 'the same shape should match better');
  });

  test('flicker measures temporal instability', () => {
    const still = [a, a, a];
    const jumpy = [a, shifted, a];
    assert.equal(flicker(still), 0);
    assert.ok(flicker(jumpy) > 0);
  });
});

describe('the graph store', () => {
  test('identical content yields the same version', () => {
    const store = memoryStore();
    const p = buildMiboProject({ repair: false });
    assert.equal(store.commit(p, 'a').hash, store.commit(p, 'b').hash);
    assert.equal(store.history().length, 1);
  });

  test('a model sheet change invalidates only the shots that use it', () => {
    const before = buildMiboProject({ repair: false });
    const after = {
      ...before,
      characters: before.characters.map((c) =>
        c.id === 'char_mibo' ? { ...c, modelSheet: { ...c.modelSheet, version: 2 } } : c,
      ),
    };
    const report = invalidationBetween(before, after);
    const shots = before.sequences[0].scenes.flatMap((s) => s.shots);
    const miboShots = shots.filter((s) => s.staging.characters.some((c) => c.characterId === 'char_mibo'));
    assert.equal(report.invalidatedShots.length, miboShots.length);
    assert.ok(report.invalidatedShots.length < shots.length, 'not everything should be dirty');
    assert.match(report.reasons[0], /model sheet changed/);
  });

  test('the bible invalidates everything', () => {
    const before = buildMiboProject({ repair: false });
    const after = { ...before, styleBible: { ...before.styleBible, version: 2 } };
    const shots = before.sequences[0].scenes.flatMap((s) => s.shots);
    assert.equal(invalidationBetween(before, after).invalidatedShots.length, shots.length);
  });

  test('the ledger records locked versions and finds stale shots', () => {
    let project = buildMiboProject({ repair: false });
    project = lockAsset(project, { assetId: 'sheet_x', kind: 'modelSheet', version: 1, hash: 'sha256:a', usedBy: [] });
    const shot = project.sequences[0].scenes[0].shots[0];
    project = {
      ...project,
      sequences: project.sequences.map((seq, si) => ({
        ...seq,
        scenes: seq.scenes.map((sc, ci) => ({
          ...sc,
          shots: sc.shots.map((s) => (s.id === shot.id ? { ...s, lockedAssets: { sheet_x: 1 } } : s)),
        })),
      })),
    };
    assert.deepEqual(staleShots(project), []);
    project = lockAsset(project, { assetId: 'sheet_x', kind: 'modelSheet', version: 2, hash: 'sha256:b', usedBy: [] });
    assert.equal(staleShots(project).length, 1);
  });

  test('the MIBO project satisfies its own schema', () => {
    const result = safeParseProject(JSON.parse(JSON.stringify(buildMiboProject({ repair: false }))));
    assert.equal(result.ok, true, result.ok ? '' : result.errors.slice(0, 5).join('; '));
  });

  test('the boundary rejects evidence it cannot check', () => {
    // A schema full of `z.any()` is not a validation boundary. These are
    // the shapes that used to slip through: a check with no message, a
    // critic verdict citing nothing, provenance that names no tool.
    const base = JSON.parse(JSON.stringify(buildMiboProject({ repair: false })));
    const shot = base.sequences[0].scenes[0].shots[0];

    shot.validation = {
      checks: [{ name: 'x', department: 'rig', pass: true, score: 1, severity: 'info', where: {} }],
      criticVerdicts: [],
      scoreSheet: {
        subject: 's',
        score: 1,
        passed: 1,
        failed: 0,
        warnings: 0,
        clean: true,
        blocking: [],
        checks: [],
        generatedAt: '2026-01-01T00:00:00Z',
      },
    };
    assert.equal(safeParseProject(base).ok, false, 'a check with no message must not parse');

    shot.validation.checks[0].message = 'the weights sum to one on every vertex';
    assert.equal(safeParseProject(base).ok, true);

    shot.validation.criticVerdicts = [
      { critic: 'c', rubric: 'silhouette', verdict: 'fail', confidence: 0.9, rationale: 'bad' },
    ];
    assert.equal(
      safeParseProject(base).ok,
      false,
      'a verdict with no citations array is not admissible',
    );

    shot.validation.criticVerdicts[0].citations = [{ frame: 3, note: 'arm reads as a stump' }];
    assert.equal(safeParseProject(base).ok, true);
  });

  test('a score outside 0..1 is not a score', () => {
    const base = JSON.parse(JSON.stringify(buildMiboProject({ repair: false })));
    base.sequences[0].scenes[0].shots[0].validation = {
      checks: [
        {
          name: 'x',
          department: 'rig',
          pass: true,
          score: 1.4,
          severity: 'info',
          message: 'm',
          where: {},
        },
      ],
      criticVerdicts: [],
      scoreSheet: {
        subject: 's',
        score: 1,
        passed: 1,
        failed: 0,
        warnings: 0,
        clean: true,
        blocking: [],
        checks: [],
        generatedAt: '2026-01-01T00:00:00Z',
      },
    };
    assert.equal(safeParseProject(base).ok, false);
  });
});

describe('delivery', () => {
  test('a sequence writes, hashes and counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-seq-'));
    try {
      const frames = [0, 1, 2].map((i) => {
        const img = createImage(16, 12, { r: 10 * i, g: 20, b: 30, a: 1 });
        return img;
      });
      const manifest = writeSequence(frames, dir, { delivery: MIBO_DELIVERY, shotId: 's1' });
      assert.equal(manifest.frames.length, 3);
      assert.equal(countFrames(dir), 3);
      assert.match(manifest.sequenceHash, /^sha256:/);
      const again = writeSequence(frames, dir, { delivery: MIBO_DELIVERY, shotId: 's1' });
      assert.equal(again.sequenceHash, manifest.sequenceHash, 'the same frames hash the same');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a contact sheet fits every frame it was given', () => {
    const frames = Array.from({ length: 7 }, () => createImage(32, 18, { r: 100, g: 100, b: 100, a: 1 }));
    const sheet = contactSheet(frames, { columns: 4, thumbWidth: 40, every: 1 });
    assert.ok(sheet.width >= 4 * 40);
    assert.ok(sheet.height >= 2 * 22);
  });

  test('a missing encoder is reported, not faked', () => {
    const manifest = {
      shotId: 's',
      directory: '/tmp/nowhere',
      frames: [],
      width: 16,
      height: 16,
      fps: 24,
      colorSpace: 'sRGB' as const,
      sequenceHash: 'sha256:x',
      writtenAt: 'now',
    };
    const result = encodeMovie(manifest, '/tmp/nowhere.mov', { codec: 'prores422' });
    if (!result.ok) {
      assert.match(result.reason!, /ffmpeg/);
      assert.ok(result.command.includes('ffmpeg'), 'the command to run is printed');
    }
  });

  test('the manifest carries its own caveats', () => {
    const project = buildMiboProject({ repair: false });
    const m = buildManifest(project, [], {
      master: { ok: false, command: 'ffmpeg ...', reason: 'ffmpeg is absent' },
    });
    assert.ok(m.caveats.some((c) => /ffmpeg is absent/.test(c)));
  });
});

describe('the contract', () => {
  test('an unmeasured invariant is never reported as held', () => {
    const verdict = canDeliver([]);
    assert.equal(verdict.deliverable, false);
    assert.ok(verdict.unmeasured.length > 0);
    assert.match(formatContract(verdict), /UNMEAS/);
    assert.match(formatContract(verdict), /An unmeasured invariant is not a passed one/);
  });

  test('a broken blocking invariant stops delivery', () => {
    const verdict = canDeliver([
      fail({ name: 'safety.photosensitivity', department: 'safety', score: 0, severity: 'fatal', message: 'too many flashes', where: {} }),
    ]);
    assert.equal(verdict.deliverable, false);
    assert.ok(verdict.blocked.some((b) => b.invariant.id === 'safety'));
  });

  test('every invariant names the checks that prove it', () => {
    for (const inv of INVARIANTS) {
      assert.ok(inv.checks.length > 0, inv.id);
      assert.ok(inv.statement.length > 30, inv.id);
    }
  });

  test('the audit distinguishes held, broken and unmeasured', () => {
    const statuses = auditInvariants([
      pass({ name: 'safety.photosensitivity', department: 'safety', score: 1, message: '', where: {} }),
      fail({ name: 'audio.lipsync_offset', department: 'audio', score: 0, message: '', where: {} }),
    ]);
    assert.equal(statuses.find((s) => s.invariant.id === 'safety')?.state, 'held');
    assert.equal(statuses.find((s) => s.invariant.id === 'lipsync')?.state, 'broken');
    assert.equal(statuses.find((s) => s.invariant.id === 'arcs')?.state, 'unmeasured');
  });
});
