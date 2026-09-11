/**
 * The deterministic render substrate.
 *
 * Design law 6 says the rig render is the baseline that the organic pass
 * must beat. A baseline is only meaningful if it is exact, so these tests
 * check coverage accuracy, byte-stability and codec round-trips.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, getPixel, downsample, resize, maskIoU, silhouetteMask, edgeDensity, connectedComponents } from '../src/raster/buffer.ts';
import { fillContours, rasterizeMask, coverageToMask, strokePolyline, fillRect } from '../src/raster/rasterize.ts';
import { encodePng, decodePng } from '../src/raster/png.ts';
import { blur, grade, vignette, grain } from '../src/raster/filters.ts';
import { parseHex } from '../src/core/color.ts';
import { makeRng } from '../src/core/rng.ts';
import { hashBytes } from '../src/core/ids.ts';
import { silhouetteStats, silhouetteIoU, lineOfAction } from '../src/geom/silhouette.ts';
import { polygonIoU, triangulate, selfIntersections, signedArea, solidity, convexHull } from '../src/geom/polygon.ts';

const square = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('rasteriser', () => {
  test('an axis-aligned rectangle covers exactly its area', () => {
    const coverage = rasterizeMask([square(10, 10, 30, 20)], 64, 64);
    let total = 0;
    for (const c of coverage) total += c;
    assert.ok(Math.abs(total - 600) < 1, `covered ${total}, expected 600`);
  });

  test('a sub-pixel rectangle produces fractional coverage, not a dropout', () => {
    const coverage = rasterizeMask([square(10.25, 10, 0.5, 10)], 32, 32);
    let total = 0;
    for (const c of coverage) total += c;
    assert.ok(total > 4 && total < 6, `covered ${total}, expected about 5`);
  });

  test('a triangle covers half its bounding box', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ];
    const coverage = rasterizeMask([tri], 48, 48, undefined, 8);
    let total = 0;
    for (const c of coverage) total += c;
    assert.ok(Math.abs(total - 800) < 20, `covered ${total}, expected about 800`);
  });

  test('winding rule cuts a hole', () => {
    const outer = square(0, 0, 40, 40);
    const inner = [...square(10, 10, 20, 20)].reverse();
    const coverage = rasterizeMask([outer, inner], 48, 48);
    let total = 0;
    for (const c of coverage) total += c;
    assert.ok(Math.abs(total - (1600 - 400)) < 4, `covered ${total}`);
  });

  test('rendering is byte-identical across runs', () => {
    const draw = () => {
      const img = createImage(80, 60, { r: 250, g: 248, b: 240, a: 1 });
      fillContours(img, [square(10, 10, 40, 30)], { color: parseHex('#3a7ad9') });
      strokePolyline(img, square(10, 10, 40, 30), { color: { r: 20, g: 20, b: 30 }, width: 3 }, true);
      return encodePng(img);
    };
    assert.equal(hashBytes(draw()), hashBytes(draw()));
  });

  test('a stroke does not double-darken at its joins', () => {
    const img = createImage(60, 60, { r: 255, g: 255, b: 255, a: 1 });
    strokePolyline(
      img,
      [
        { x: 10, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 10 },
      ],
      { color: { r: 0, g: 0, b: 0 }, width: 6, join: 'round' },
      false,
    );
    const corner = getPixel(img, 30, 30);
    const middle = getPixel(img, 20, 30);
    assert.ok(Math.abs(corner.r - middle.r) < 12, `corner ${corner.r} vs middle ${middle.r}`);
  });
});

describe('PNG codec', () => {
  test('round-trips every pixel exactly', () => {
    const rng = makeRng('png');
    const img = createImage(37, 23);
    for (let i = 0; i < img.data.length; i++) img.data[i] = rng.int(0, 256);
    const back = decodePng(encodePng(img));
    assert.equal(back.width, 37);
    assert.equal(back.height, 23);
    for (let i = 0; i < img.data.length; i++) {
      assert.equal(back.data[i], img.data[i], `byte ${i}`);
    }
  });

  test('preserves alpha', () => {
    const img = createImage(8, 8, { r: 10, g: 20, b: 30, a: 0.5 });
    const back = decodePng(encodePng(img));
    assert.equal(back.data[3], img.data[3]);
  });

  test('rejects non-PNG input', () => {
    assert.throws(() => decodePng(Buffer.from('not a png')));
  });

  test('encodes metadata without corrupting pixels', () => {
    const img = createImage(16, 16, { r: 200, g: 100, b: 50, a: 1 });
    const back = decodePng(encodePng(img, { text: { Frame: '12', Shot: 'sh_1' } }));
    assert.equal(getPixel(back, 8, 8).r, 200);
  });
});

describe('filters', () => {
  test('blur conserves total energy', () => {
    const img = createImage(40, 40, { r: 0, g: 0, b: 0, a: 1 });
    fillRect(img, 15, 15, 10, 10, { r: 255, g: 255, b: 255 });
    const sum = (b: typeof img) => {
      let s = 0;
      for (let i = 0; i < b.data.length; i += 4) s += b.data[i];
      return s;
    };
    const before = sum(img);
    const after = sum(blur(img, 3));
    assert.ok(Math.abs(after - before) / before < 0.06, `${before} -> ${after}`);
  });

  test('grade with unit parameters is close to a no-op', () => {
    const img = createImage(16, 16, { r: 120, g: 90, b: 60, a: 1 });
    const out = grade(img, { lift: 0, gamma: 1, gain: 1, saturation: 1 });
    assert.ok(Math.abs(getPixel(out, 8, 8).r - 120) < 1.5);
  });

  test('vignette darkens corners and not the centre', () => {
    const img = createImage(41, 41, { r: 200, g: 200, b: 200, a: 1 });
    const out = vignette(img, 0.6, 0.3);
    assert.ok(getPixel(out, 20, 20).r > 195);
    assert.ok(getPixel(out, 0, 0).r < 160);
  });

  test('grain is reproducible from a seed', () => {
    const img = createImage(24, 24, { r: 128, g: 128, b: 128, a: 1 });
    const a = grain(img, 0.1, 2, makeRng('g'));
    const b = grain(img, 0.1, 2, makeRng('g'));
    assert.equal(hashBytes(encodePng(a)), hashBytes(encodePng(b)));
  });
});

describe('geometry', () => {
  test('signed area has the expected sign and magnitude', () => {
    assert.equal(signedArea(square(0, 0, 10, 10)), 100);
    assert.equal(signedArea([...square(0, 0, 10, 10)].reverse()), -100);
  });

  test('triangulation covers the polygon', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ];
    const tris = triangulate(poly);
    assert.equal(tris.length % 3, 0);
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [poly[tris[t]], poly[tris[t + 1]], poly[tris[t + 2]]];
      area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }
    assert.ok(Math.abs(area - 1200) < 1, `triangulated area ${area}`);
  });

  test('self-intersection is detected on a bowtie and not on a square', () => {
    assert.equal(selfIntersections(square(0, 0, 10, 10)).length, 0);
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    assert.ok(selfIntersections(bowtie).length > 0);
  });

  test('IoU is one for identical polygons and zero for disjoint ones', () => {
    assert.ok(polygonIoU(square(0, 0, 10, 10), square(0, 0, 10, 10)) > 0.99);
    assert.equal(polygonIoU(square(0, 0, 10, 10), square(50, 50, 10, 10)), 0);
  });

  test('solidity separates a blob from a star', () => {
    const blob = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return { x: Math.cos(a) * 20, y: Math.sin(a) * 20 };
    });
    const star = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 ? 20 : 6;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    assert.ok(solidity(blob) > 0.95);
    assert.ok(solidity(star) < 0.7);
  });

  test('convex hull of a square is the square', () => {
    assert.equal(convexHull(square(0, 0, 10, 10)).length, 4);
  });
});

describe('silhouette measurement', () => {
  test('overlapping parts merge instead of cancelling', () => {
    // Two overlapping contours with opposite winding would punch a hole
    // under the nonzero rule. A character's own arm is not a gap.
    const a = square(0, 0, 40, 40);
    const b = [...square(20, 20, 40, 40)].reverse();
    const stats = silhouetteStats([a, b], 64);
    assert.equal(stats.components, 1, 'the union must be one shape');
    assert.ok(stats.solidity > 0.5);
  });

  test('detached parts are counted', () => {
    const stats = silhouetteStats([square(0, 0, 20, 20), square(60, 60, 20, 20)], 96);
    assert.equal(stats.components, 2);
  });

  test('a symmetric shape measures as symmetric', () => {
    const stats = silhouetteStats([square(0, 0, 40, 40)], 64);
    assert.ok(stats.asymmetry < 0.05, `asymmetry ${stats.asymmetry}`);
  });

  test('IoU of a shape with itself is one', () => {
    const shape = [square(5, 5, 30, 40)];
    assert.ok(silhouetteIoU(shape, shape) > 0.98);
  });

  test('line of action finds the dominant axis', () => {
    const diagonal = Array.from({ length: 20 }, (_, i) => ({ x: i * 3, y: i * 3 }));
    const axis = lineOfAction(diagonal);
    assert.ok(axis.strength > 0.9, `strength ${axis.strength}`);
    const blobPoints = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: Math.cos(a) * 20, y: Math.sin(a) * 20 };
    });
    assert.ok(lineOfAction(blobPoints).strength < 0.3);
  });
});

describe('image analysis', () => {
  test('masks compare by IoU', () => {
    const a = coverageToMask(rasterizeMask([square(0, 0, 20, 20)], 40, 40));
    const b = coverageToMask(rasterizeMask([square(10, 0, 20, 20)], 40, 40));
    const iou = maskIoU(a, b);
    assert.ok(iou > 0.3 && iou < 0.4, `iou ${iou}`);
  });

  test('edge density separates flat from busy', () => {
    const flat = createImage(40, 40, { r: 128, g: 128, b: 128, a: 1 });
    const busy = createImage(40, 40, { r: 128, g: 128, b: 128, a: 1 });
    for (let y = 0; y < 40; y += 2) fillRect(busy, 0, y, 40, 1, { r: 0, g: 0, b: 0 });
    assert.equal(edgeDensity(flat), 0, 'a flat field has no edges');
    // One-pixel stripes are the worst case for a symmetric kernel and the
    // most important case for detecting generated texture.
    assert.ok(edgeDensity(busy) > 0.1, `busy measured ${edgeDensity(busy)}`);
  });

  test('connected components counts blobs', () => {
    const img = createImage(60, 30);
    fillRect(img, 2, 2, 10, 10, { r: 255, g: 255, b: 255 });
    fillRect(img, 40, 2, 10, 10, { r: 255, g: 255, b: 255 });
    const mask = silhouetteMask(img, 0.5);
    assert.equal(connectedComponents(mask, 60, 30).count, 2);
  });

  test('downsample averages rather than dropping', () => {
    const img = createImage(4, 4, { r: 0, g: 0, b: 0, a: 1 });
    fillRect(img, 0, 0, 2, 4, { r: 255, g: 255, b: 255 });
    const small = downsample(img, 4);
    assert.ok(Math.abs(getPixel(small, 0, 0).r - 188) < 12, `got ${getPixel(small, 0, 0).r}`);
  });

  test('resize preserves a solid colour', () => {
    const img = createImage(10, 10, { r: 40, g: 80, b: 160, a: 1 });
    const out = resize(img, 25, 25);
    assert.equal(Math.round(getPixel(out, 12, 12).b), 160);
  });
});
