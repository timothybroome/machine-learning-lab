import { RNG } from "./rng";

export const GRID = 28;
export const PIXELS = GRID * GRID;

export const TUNE = { strokeMin: 1.5, strokeMax: 2.6, noise: 0.04 };

export const CLASS_NAMES = ["triangle", "square", "circle", "line"] as const;
export type ShapeClass = 0 | 1 | 2 | 3;

/** The "variety" toggles. Each one narrows what the generator is allowed to make. */
export interface Variety {
  centredOnly: boolean;
  noRotation: boolean;
  outlinesOnly: boolean;
}

export const FULL_VARIETY: Variety = { centredOnly: false, noRotation: false, outlinesOnly: false };

export interface GenExtras {
  /** Push the shape into a corner of the grid (used to test a "centred only" network). */
  corner?: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Signed distance to a convex polygon: negative inside, positive outside. */
function polygonSDF(px: number, py: number, vx: number[], vy: number[]): number {
  const n = vx.length;
  let dMin = Infinity;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = distToSegment(px, py, vx[i], vy[i], vx[j], vy[j]);
    if (d < dMin) dMin = d;
    const cross = (vx[j] - vx[i]) * (py - vy[i]) - (vy[j] - vy[i]) * (px - vx[i]);
    if (cross >= 0) pos++;
    else neg++;
  }
  const inside = pos === n || neg === n;
  return inside ? -dMin : dMin;
}

/**
 * Draw one shape into a fresh 28x28 grid of values from 0 (empty) to 1 (ink).
 * Random position, size 8 to 20 pixels, any rotation, outlined or filled, plus a little pixel noise.
 */
export function generateShape(rng: RNG, cls: number, variety: Variety, extras: GenExtras = {}): Float64Array {
  const out = new Float64Array(PIXELS);

  // "size" is the triangle's side, roughly the square's side, or the circle's width
  let size = rng.range(8, 20);
  if (extras.corner) size = rng.range(8, 12);
  // r is the distance from the middle to the furthest point, so the shape always fits on the grid
  const r = Math.min(12, size * (cls === 0 ? 0.58 : cls === 1 ? 0.62 : 0.5));
  let cx: number;
  let cy: number;
  if (extras.corner) {
    const m = r + 1.5;
    cx = rng.next() < 0.5 ? m + rng.range(0, 1) : GRID - m - rng.range(0, 1);
    cy = rng.next() < 0.5 ? m + rng.range(0, 1) : GRID - m - rng.range(0, 1);
  } else if (variety.centredOnly) {
    cx = GRID / 2 + rng.range(-0.5, 0.5);
    cy = GRID / 2 + rng.range(-0.5, 0.5);
  } else {
    cx = rng.range(r + 1.5, GRID - r - 1.5);
    cy = rng.range(r + 1.5, GRID - r - 1.5);
  }

  const rotation = variety.noRotation ? 0 : rng.range(0, Math.PI * 2);
  const filled = variety.outlinesOnly ? false : rng.next() < 0.5;
  const stroke = rng.range(TUNE.strokeMin, TUNE.strokeMax);
  const ink = rng.range(0.8, 1);
  const wobble = 0.05 * r;

  let sdf: (px: number, py: number) => number;
  let isLine = false;

  if (cls === 2) {
    // circle (very slightly squashed, like a hand-drawn one)
    const aspect = rng.range(0.9, 1);
    const ca = Math.cos(rotation);
    const sa = Math.sin(rotation);
    sdf = (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * ca + dy * sa;
      const v = (-dx * sa + dy * ca) / aspect;
      return Math.sqrt(u * u + v * v) - r;
    };
  } else if (cls === 3) {
    // line (the distractor class)
    isLine = true;
    const ax = cx - Math.cos(rotation) * r;
    const ay = cy - Math.sin(rotation) * r;
    const bx = cx + Math.cos(rotation) * r;
    const by = cy + Math.sin(rotation) * r;
    sdf = (px, py) => distToSegment(px, py, ax, ay, bx, by);
  } else {
    const n = cls === 0 ? 3 : 4;
    // triangle points up and square sits flat when rotation is 0; corners wobble a touch
    const base = cls === 0 ? -Math.PI / 2 : Math.PI / 4;
    const vx: number[] = [];
    const vy: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = base + rotation + (k * 2 * Math.PI) / n;
      vx.push(cx + Math.cos(a) * r + rng.range(-wobble, wobble));
      vy.push(cy + Math.sin(a) * r + rng.range(-wobble, wobble));
    }
    sdf = (px, py) => polygonSDF(px, py, vx, vy);
  }

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      let v: number;
      if (isLine) v = clamp01(stroke / 2 + 0.5 - d);
      else if (filled) v = clamp01(0.5 - d);
      else v = clamp01(stroke / 2 + 0.5 - Math.abs(d));
      out[y * GRID + x] = clamp01(v * ink + rng.gauss() * TUNE.noise);
    }
  }
  return out;
}

/** Stamp a brush stroke (in grid coordinates) onto the grid. Used by the drawing pad. */
export function stampSegment(
  grid: Float64Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width = 2,
): void {
  const pad = width / 2 + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(GRID - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(GRID - 1, Math.ceil(Math.max(y0, y1) + pad));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distToSegment(x + 0.5, y + 0.5, x0, y0, x1, y1);
      const v = clamp01(width / 2 + 0.5 - d);
      const i = y * GRID + x;
      if (v > grid[i]) grid[i] = v;
    }
  }
}

/** Rub out along a stroke (in grid coordinates). */
export function eraseSegment(
  grid: Float64Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width = 4,
): void {
  const pad = width / 2 + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(GRID - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(GRID - 1, Math.ceil(Math.max(y0, y1) + pad));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distToSegment(x + 0.5, y + 0.5, x0, y0, x1, y1);
      const keep = 1 - clamp01(width / 2 + 0.5 - d);
      const i = y * GRID + x;
      if (keep < grid[i]) grid[i] = keep;
    }
  }
}

/**
 * A wobbly, hand-drawn-looking outline made with the same brush as the drawing pad.
 * Only used by the automatic checks, to stand in for a learner's drawing.
 */
export function scribbleShape(rng: RNG, cls: number, cx: number, cy: number, r: number): Float64Array {
  const grid = new Float64Array(PIXELS);
  const pts: [number, number][] = [];
  const rot = rng.range(0, Math.PI * 2);
  if (cls === 2) {
    const n = 20;
    for (let k = 0; k <= n; k++) {
      const a = rot + (k / n) * Math.PI * 2;
      const rr = r * (1 + rng.range(-0.07, 0.07));
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  } else {
    const n = cls === 0 ? 3 : 4;
    const corners: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (k * 2 * Math.PI) / n + rng.range(-0.12, 0.12);
      const rr = r * (1 + rng.range(-0.1, 0.1));
      corners.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    for (let k = 0; k < n; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % n];
      for (let s = 0; s < 4; s++) {
        const t = s / 4;
        pts.push([
          a[0] + (b[0] - a[0]) * t + (s ? rng.range(-0.35, 0.35) : 0),
          a[1] + (b[1] - a[1]) * t + (s ? rng.range(-0.35, 0.35) : 0),
        ]);
      }
    }
    pts.push(pts[0]);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    stampSegment(grid, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2);
  }
  return grid;
}
