/**
 * Core: maths, colour, determinism, content addressing.
 *
 * These are the foundations every validator stands on. If ΔE2000 or the
 * arc fit is wrong, every gate above it is wrong and nobody finds out.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitArc,
  splitAtReversals,
  polyfit,
  polyval,
  mTRS,
  mapply,
  minvert,
  mmul,
  IDENTITY,
  wrapAngle,
  correlation,
  round,
} from '../src/core/math.ts';
import {
  deltaE2000,
  rgbToLab,
  labToRgb,
  parseHex,
  toHex,
  relativeLuminance,
  nearestSwatch,
  srgbToLinear,
  linearToSrgb,
} from '../src/core/color.ts';
import { hashContent, stableStringify, cacheKey, makeId } from '../src/core/ids.ts';
import { makeRng } from '../src/core/rng.ts';
import { scoreSheet, pass, fail, measure } from '../src/core/result.ts';
import { speechFrames, timecode, parseTimecode } from '../src/core/units.ts';

describe('matrices', () => {
  test('TRS round-trips through its inverse', () => {
    const m = mTRS({ x: 12, y: -4 }, 0.7, { x: 1.4, y: 0.8 }, { x: 3, y: 9 });
    const p = { x: 17, y: -23 };
    const back = mapply(minvert(m), mapply(m, p));
    assert.ok(Math.abs(back.x - p.x) < 1e-9, `x ${back.x}`);
    assert.ok(Math.abs(back.y - p.y) < 1e-9, `y ${back.y}`);
  });

  test('composition applies right to left', () => {
    const a = mTRS({ x: 10, y: 0 }, 0, { x: 1, y: 1 });
    const b = mTRS({ x: 0, y: 5 }, 0, { x: 2, y: 2 });
    const composed = mmul(a, b);
    const p = mapply(composed, { x: 1, y: 1 });
    assert.deepEqual({ x: round(p.x), y: round(p.y) }, { x: 12, y: 7 });
  });

  test('identity is identity', () => {
    const p = { x: 3, y: -8 };
    assert.deepEqual(mapply(IDENTITY, p), p);
  });
});

describe('arc fitting', () => {
  test('a straight line fits perfectly', () => {
    const line = Array.from({ length: 12 }, (_, i) => ({ x: i * 4, y: i * 2.5 }));
    assert.ok(fitArc(line).r2 > 0.999, 'straight line should fit');
  });

  test('a circular arc fits', () => {
    const arc = Array.from({ length: 24 }, (_, i) => {
      const t = (i / 23) * Math.PI;
      return { x: Math.cos(t) * 50, y: Math.sin(t) * 50 };
    });
    assert.ok(fitArc(arc).r2 > 0.99, 'semicircle should fit');
  });

  test('an S-curve fits, because real arcs overshoot and settle', () => {
    const s = Array.from({ length: 30 }, (_, i) => {
      const t = i / 29;
      return { x: t * 120, y: Math.sin(t * Math.PI * 2) * 25 };
    });
    assert.ok(fitArc(s).r2 > 0.98, 'S-curve should fit a cubic');
  });

  test('a zig-zag does not fit', () => {
    const zig = Array.from({ length: 16 }, (_, i) => ({ x: i * 5, y: (i % 2) * 18 }));
    assert.ok(fitArc(zig).r2 < 0.9, 'machine-made zig-zag must be caught');
  });

  test('a stationary run does not poison the fit', () => {
    // A planted foot contributes many samples at one position; without
    // deduplication the fit has to explain several residuals at one
    // parameter value and scores a smooth path as broken.
    const path = [
      ...Array.from({ length: 10 }, () => ({ x: 0, y: 0 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: i * 3, y: i * i * 0.2 })),
    ];
    assert.ok(fitArc(path).r2 > 0.97, 'a hold followed by a smooth move should fit');
  });

  test('reversals split into separate runs', () => {
    const out = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ];
    assert.equal(splitAtReversals(out).length, 2);
  });
});

describe('polynomial fitting is well conditioned', () => {
  test('fits a known cubic exactly', () => {
    const xs = Array.from({ length: 12 }, (_, i) => i / 11);
    const ys = xs.map((x) => 2 - 3 * x + 4 * x * x - x * x * x);
    const c = polyfit(xs, ys, 3);
    for (const x of xs) {
      assert.ok(Math.abs(polyval(c, x) - (2 - 3 * x + 4 * x * x - x * x * x)) < 1e-6);
    }
  });

  test('degrades rather than exploding with too few samples', () => {
    const c = polyfit([0, 1, 2], [0, 1, 2], 3);
    assert.ok(c.every(Number.isFinite));
  });
});

describe('colour', () => {
  test('CIEDE2000 is zero for identical colours', () => {
    const lab = rgbToLab({ r: 120, g: 40, b: 200 });
    assert.equal(round(deltaE2000(lab, lab), 9), 0);
  });

  test('CIEDE2000 matches published Sharma test pairs', () => {
    // Sharma, Wu and Dalal (2005), table 1.
    const cases: [number[], number[], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
      [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    ];
    for (const [a, b, expected] of cases) {
      const got = deltaE2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
      assert.ok(
        Math.abs(got - expected) < 0.001,
        `expected ${expected}, got ${got.toFixed(4)}`,
      );
    }
  });

  test('Lab round-trips through RGB', () => {
    for (const hex of ['#F5B23C', '#2B5D28', '#88B2C1', '#000000', '#FFFFFF']) {
      const rgb = parseHex(hex);
      const back = labToRgb(rgbToLab(rgb));
      assert.ok(Math.abs(back.r - rgb.r) < 0.6, hex);
      assert.ok(Math.abs(back.g - rgb.g) < 0.6, hex);
      assert.ok(Math.abs(back.b - rgb.b) < 0.6, hex);
    }
  });

  test('sRGB transfer round-trips', () => {
    for (let v = 0; v <= 255; v += 17) {
      assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-6);
    }
  });

  test('luminance ordering is sane', () => {
    assert.ok(relativeLuminance(parseHex('#FFFFFF')) > relativeLuminance(parseHex('#808080')));
    assert.ok(relativeLuminance(parseHex('#808080')) > relativeLuminance(parseHex('#000000')));
  });

  test('nearest swatch finds the right one', () => {
    const palette = [
      { name: 'a', hex: '#F5B23C', role: '' },
      { name: 'b', hex: '#2B5D28', role: '' },
    ];
    const hit = nearestSwatch(parseHex('#F4B140'), palette);
    assert.equal(hit?.swatch.name, 'a');
    assert.ok(hit && hit.deltaE < 3);
  });

  test('hex parsing and printing round-trip', () => {
    assert.equal(toHex(parseHex('#1a2B3c')).toLowerCase(), '#1a2b3c');
    assert.equal(toHex(parseHex('abc')).toLowerCase(), '#aabbcc');
  });
});

describe('content addressing', () => {
  test('key order does not change the hash', () => {
    assert.equal(hashContent({ a: 1, b: 2 }), hashContent({ b: 2, a: 1 }));
  });

  test('values do change the hash', () => {
    assert.notEqual(hashContent({ a: 1 }), hashContent({ a: 2 }));
  });

  test('negative zero and zero serialise the same', () => {
    assert.equal(stableStringify({ v: -0 }), stableStringify({ v: 0 }));
  });

  test('cache keys ignore input order but not input identity', () => {
    const base = { tool: 't', toolVersion: '1', params: { q: 1 } };
    assert.equal(
      cacheKey({ ...base, inputs: ['sha256:a', 'sha256:b'] }),
      cacheKey({ ...base, inputs: ['sha256:b', 'sha256:a'] }),
    );
    assert.notEqual(
      cacheKey({ ...base, inputs: ['sha256:a'] }),
      cacheKey({ ...base, inputs: ['sha256:c'] }),
    );
  });

  test('seeded ids are reproducible', () => {
    assert.equal(makeId('x', 'seed'), makeId('x', 'seed'));
    assert.notEqual(makeId('x', 'seed'), makeId('x', 'other'));
  });
});

describe('determinism', () => {
  test('the same seed gives the same stream', () => {
    const a = makeRng('mibo');
    const b = makeRng('mibo');
    for (let i = 0; i < 200; i++) assert.equal(a.next(), b.next());
  });

  test('different seeds diverge', () => {
    assert.notEqual(makeRng('a').next(), makeRng('b').next());
  });

  test('forks are independent and reproducible', () => {
    const a = makeRng('root').fork('idle');
    const b = makeRng('root').fork('idle');
    const c = makeRng('root').fork('grain');
    assert.equal(a.next(), b.next());
    assert.notEqual(a.next(), c.next());
  });

  test('gaussian has roughly the requested moments', () => {
    const rng = makeRng(7);
    const xs = Array.from({ length: 20000 }, () => rng.gaussian(0, 1));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
    assert.ok(Math.abs(sd - 1) < 0.05, `sd ${sd}`);
  });
});

describe('score sheets', () => {
  test('a clean sheet scores one', () => {
    const sheet = scoreSheet('x', [
      pass({ name: 'a', department: 'd', score: 1, message: '', where: {} }),
    ]);
    assert.equal(sheet.score, 1);
    assert.equal(sheet.clean, true);
  });

  test('a fatal failure is never clean', () => {
    const sheet = scoreSheet('x', [
      pass({ name: 'a', department: 'd', score: 1, message: '', where: {} }),
      fail({ name: 'b', department: 'd', score: 0, severity: 'fatal', message: '', where: {} }),
    ]);
    assert.equal(sheet.clean, false);
    assert.deepEqual(sheet.blocking, ['b']);
  });

  test('warnings do not block', () => {
    const sheet = scoreSheet('x', [
      fail({ name: 'w', department: 'd', score: 0.5, severity: 'warn', message: '', where: {} }),
    ]);
    assert.equal(sheet.clean, true);
    assert.equal(sheet.warnings, 1);
  });

  test('measure scores partial credit, not pass/fail', () => {
    const near = measure({
      name: 'm',
      department: 'd',
      measured: 0.9,
      threshold: 0.95,
      comparator: '>=',
      floor: 0.5,
      message: '',
      where: {},
    });
    assert.equal(near.pass, false);
    assert.ok(near.score > 0.5 && near.score < 1, `score ${near.score}`);
  });
});

describe('units', () => {
  test('timecode round-trips', () => {
    for (const f of [0, 1, 23, 24, 25, 1440, 86399]) {
      assert.equal(parseTimecode(timecode(f, 24), 24), f);
    }
  });

  test('speech duration scales with length', () => {
    const short = speechFrames('Hello.', 24);
    const long = speechFrames('Hello, this is a considerably longer line of dialogue.', 24);
    assert.ok(long > short * 3, `${short} vs ${long}`);
  });

  test('punctuation adds pause', () => {
    assert.ok(speechFrames('one two three.', 24) > speechFrames('one two three', 24));
  });
});

describe('statistics', () => {
  test('correlation detects a lag', () => {
    const a = Array.from({ length: 40 }, (_, i) => Math.sin(i / 3));
    const b = a.map((_, i) => Math.sin((i - 3) / 3));
    assert.ok(Math.abs(correlation(a.slice(0, 37), b.slice(3))) > 0.98);
  });

  test('angles wrap to the shortest arc', () => {
    assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9);
    assert.ok(Math.abs(wrapAngle(-Math.PI * 3) - Math.PI) < 1e-9);
  });
});
