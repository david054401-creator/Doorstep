/**
 * Deterministic 2D math. No dependencies, no floating-point surprises that we
 * do not control: every public function here is pure and reproducible.
 */

export type Vec2 = { x: number; y: number };

/** Affine 2D matrix, row-major: [a c e ; b d f ; 0 0 1] (SVG ordering). */
export type Mat2D = { a: number; b: number; c: number; d: number; e: number; f: number };

export const EPS = 1e-9;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const vadd = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
export const vsub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
export const vmul = (p: Vec2, s: number): Vec2 => ({ x: p.x * s, y: p.y * s });
export const vdot = (p: Vec2, q: Vec2): number => p.x * q.x + p.y * q.y;
export const vcross = (p: Vec2, q: Vec2): number => p.x * q.y - p.y * q.x;
export const vlen = (p: Vec2): number => Math.hypot(p.x, p.y);
export const vdist = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);
export const vlerp = (p: Vec2, q: Vec2, t: number): Vec2 => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});
export function vnorm(p: Vec2): Vec2 {
  const l = vlen(p);
  return l < EPS ? { x: 0, y: 0 } : { x: p.x / l, y: p.y / l };
}
export const vangle = (p: Vec2): number => Math.atan2(p.y, p.x);
export function vrot(p: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export const vperp = (p: Vec2): Vec2 => ({ x: -p.y, y: p.x });

export const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mat(a: number, b: number, c: number, d: number, e: number, f: number): Mat2D {
  return { a, b, c, d, e, f };
}

/** m1 then m2 applied to a point == mmul(m2, m1). */
export function mmul(m2: Mat2D, m1: Mat2D): Mat2D {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export function mapply(m: Mat2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Transform a direction (ignores translation). */
export function mapplyDir(m: Mat2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

export const mdet = (m: Mat2D): number => m.a * m.d - m.b * m.c;

export function minvert(m: Mat2D): Mat2D {
  const det = mdet(m);
  if (Math.abs(det) < EPS) return { ...IDENTITY };
  const id = 1 / det;
  return {
    a: m.d * id,
    b: -m.b * id,
    c: -m.c * id,
    d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
}

export function mTranslate(x: number, y: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}
export function mScale(sx: number, sy: number): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}
export function mRotate(rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

/** TRS built around a pivot, the form every rig bone and part uses. */
export function mTRS(
  translate: Vec2,
  rotation: number,
  scale: Vec2,
  pivot: Vec2 = { x: 0, y: 0 },
): Mat2D {
  let m = mTranslate(translate.x + pivot.x, translate.y + pivot.y);
  m = mmul(m, mRotate(rotation));
  m = mmul(m, mScale(scale.x, scale.y));
  m = mmul(m, mTranslate(-pivot.x, -pivot.y));
  return m;
}

/** Uniform-ish scale magnitude of a matrix (geometric mean of axis lengths). */
export function mScaleMagnitude(m: Mat2D): number {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  return Math.sqrt(Math.max(0, sx * sy));
}

export function mRotationOf(m: Mat2D): number {
  return Math.atan2(m.b, m.a);
}

// ---------------------------------------------------------------------------
// scalar helpers
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number =>
  Math.abs(b - a) < EPS ? 0 : (v - a) / (b - a);
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Wrap an angle into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** Shortest signed angular delta from a to b. */
export const angleDelta = (a: number, b: number): number => wrapAngle(b - a);

/** Round to a fixed number of decimals so serialised output is byte-stable. */
export function round(v: number, decimals = 6): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

// ---------------------------------------------------------------------------
// statistics — every validator reports numbers, so these must be exact
// ---------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

export const stddev = (xs: readonly number[]): number => Math.sqrt(variance(xs));

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((p, q) => p - q);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp((s.length - 1) * clamp01(p), 0, s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : lerp(s[lo], s[hi], idx - lo);
}

/** Pearson correlation. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < EPS || syy < EPS) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

// ---------------------------------------------------------------------------
// curve fitting — used by the "Arcs" principle validator (R^2 >= 0.95)
// ---------------------------------------------------------------------------

/** Least-squares polynomial fit of degree `d`. Returns coefficients low→high. */
export function polyfit(xs: readonly number[], ys: readonly number[], d: number): number[] {
  const n = Math.min(xs.length, ys.length);
  const m = d + 1;
  if (n < m) return new Array(m).fill(0);
  // Normal equations via Vandermonde, solved with Gaussian elimination.
  const ata: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const atb: number[] = new Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    const pows: number[] = new Array(m);
    pows[0] = 1;
    for (let k = 1; k < m; k++) pows[k] = pows[k - 1] * xs[i];
    for (let r = 0; r < m; r++) {
      atb[r] += pows[r] * ys[i];
      for (let c = 0; c < m; c++) ata[r][c] += pows[r] * pows[c];
    }
  }
  return solveLinear(ata, atb);
}

export function polyval(coeffs: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * x + coeffs[i];
  return acc;
}

/** Gaussian elimination with partial pivoting. Returns zeros for singular systems. */
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) continue;
    if (piv !== col) {
      const t = m[piv];
      m[piv] = m[col];
      m[col] = t;
    }
    const d = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (Math.abs(f) < 1e-15) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => (Number.isFinite(row[n]) ? row[n] : 0));
}

export type ArcFit = {
  /** Coefficient of determination of the best-fit smooth curve. */
  r2: number;
  /** Total path length in the same units as the input points. */
  pathLength: number;
  /** Max deviation from the fitted curve. */
  maxResidual: number;
  /** How straight the path is: 1 = perfect straight line. */
  straightness: number;
};

/**
 * Fit a smooth arc to an end-effector path.
 *
 * The path is re-parameterised by cumulative arc length, then x(t) and y(t)
 * are each fit with a cubic. Cubic, not quadratic: a real animated arc
 * usually overshoots its target and settles back, which traces an S, and a
 * parabola cannot represent an S — it would score good animation as broken.
 * A straight line, a circular arc, an S and a there-and-back all fit well;
 * a zig-zag, which is the machine-made "linear interpolation between poses"
 * tell, does not.
 */
export function fitArc(rawPoints: readonly Vec2[], degree = 3): ArcFit {
  if (rawPoints.length < 3) {
    return { r2: 1, pathLength: 0, maxResidual: 0, straightness: 1 };
  }
  // An arc is a property of the *path*, not of the time series that traced
  // it. Frames where the effector is stationary — a planted foot, a hold —
  // pile many samples onto one arc-length position, and the fit then has
  // to explain several different residuals at the same parameter value.
  // Collapsing those repeats first is what makes the measure mean "does
  // this travel on a curve" rather than "did it ever pause".
  let gross = 0;
  for (let i = 1; i < rawPoints.length; i++) gross += vdist(rawPoints[i - 1], rawPoints[i]);
  const minStep = gross * 0.005;
  const points: Vec2[] = [rawPoints[0]];
  for (let i = 1; i < rawPoints.length; i++) {
    if (vdist(points[points.length - 1], rawPoints[i]) >= minStep) points.push(rawPoints[i]);
  }
  const last = rawPoints[rawPoints.length - 1];
  if (vdist(points[points.length - 1], last) > 1e-9) points.push(last);
  if (points.length < 3) {
    return { r2: 1, pathLength: gross, maxResidual: 0, straightness: 1 };
  }

  const t: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += vdist(points[i - 1], points[i]);
    t.push(total);
  }
  if (total < EPS) {
    return { r2: 1, pathLength: 0, maxResidual: 0, straightness: 1 };
  }
  const tn = t.map((v) => v / total);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = polyfit(tn, xs, degree);
  const cy = polyfit(tn, ys, degree);

  let ssRes = 0;
  let ssTot = 0;
  let maxResidual = 0;
  const mx = mean(xs);
  const my = mean(ys);
  for (let i = 0; i < points.length; i++) {
    const px = polyval(cx, tn[i]);
    const py = polyval(cy, tn[i]);
    const r = Math.hypot(px - xs[i], py - ys[i]);
    maxResidual = Math.max(maxResidual, r);
    ssRes += r * r;
    ssTot += (xs[i] - mx) ** 2 + (ys[i] - my) ** 2;
  }
  const r2 = ssTot < EPS ? 1 : clamp01(1 - ssRes / ssTot);
  const chord = vdist(points[0], points[points.length - 1]);
  return { r2, pathLength: total, maxResidual, straightness: clamp01(chord / total) };
}

/** Cubic Bezier evaluation. */
export function bezier3(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Solve a 1D cubic Bezier for t where x(t) = target. Used by CSS-style eases. */
export function bezierSolveT(x1: number, x2: number, target: number, iterations = 24): number {
  // x(t) = 3(1-t)^2 t x1 + 3(1-t) t^2 x2 + t^3
  let lo = 0;
  let hi = 1;
  let t = clamp01(target);
  for (let i = 0; i < iterations; i++) {
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    if (Math.abs(x - target) < 1e-7) return t;
    if (x < target) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

/** Finite-difference derivative of a uniformly sampled series. */
export function derivative(xs: readonly number[], dt = 1): number[] {
  const n = xs.length;
  if (n < 2) return new Array(n).fill(0);
  const out = new Array<number>(n);
  out[0] = (xs[1] - xs[0]) / dt;
  out[n - 1] = (xs[n - 1] - xs[n - 2]) / dt;
  for (let i = 1; i < n - 1; i++) out[i] = (xs[i + 1] - xs[i - 1]) / (2 * dt);
  return out;
}

/** Moving-average smoothing with a symmetric window. */
export function smooth(xs: readonly number[], window = 3): number[] {
  if (window <= 1 || xs.length === 0) return [...xs];
  const half = Math.floor(window / 2);
  return xs.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j >= 0 && j < xs.length) {
        s += xs[j];
        n++;
      }
    }
    return n === 0 ? 0 : s / n;
  });
}
