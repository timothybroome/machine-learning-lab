/**
 * A tiny convolutional network, written by hand. No ML library.
 *
 *   input 28x28
 *   -> layer 1: 8 stencils of 5x5      -> 8 maps of 24x24 -> squash (ReLU) -> shrink (max pool 2x2) -> 8 maps of 12x12
 *   -> layer 2: 8 stencils of 3x3 x 8  -> 8 maps of 10x10 -> squash        -> shrink                -> 8 maps of 5x5
 *   -> final judge: fully connected to the classes, softmax for percentages
 *
 * Every weight ("knob"), gradient and activation lives in a plain Float64Array so it can be inspected and drawn.
 */
import { RNG } from "./rng";

export const IN = 28;
export const K1 = 5;
export const F1 = 8;
export const C1 = IN - K1 + 1; // 24
export const P1 = C1 / 2; // 12
export const K2 = 3;
export const F2 = 8;
export const C2 = P1 - K2 + 1; // 10
export const P2 = C2 / 2; // 5
export const FC_IN = F2 * P2 * P2; // 200

const C1N = C1 * C1; // 576
const P1N = P1 * P1; // 144
const C2N = C2 * C2; // 100
const P2N = P2 * P2; // 25
const K1N = K1 * K1; // 25
const K2N = K2 * K2; // 9

export interface Net {
  nClasses: number;
  /** layer-1 stencils: [stencil][ky][kx] */
  W1: Float64Array;
  b1: Float64Array;
  /** layer-2 stencils: [unit][layer-1 map][ky][kx] */
  W2: Float64Array;
  b2: Float64Array;
  /** final judge: [class][200 inputs] */
  W3: Float64Array;
  b3: Float64Array;
}

/** Everything the network computed for one drawing, kept so it can be drawn and so backprop can use it. */
export interface Cache {
  x: Float64Array;
  a1: Float64Array; // layer-1 maps after squash, F1 x 24 x 24
  p1: Float64Array; // after shrink, F1 x 12 x 12
  i1: Int32Array; // which a1 cell won each 2x2 patch
  a2: Float64Array; // layer-2 maps after squash, F2 x 10 x 10
  p2: Float64Array; // after shrink, F2 x 5 x 5
  i2: Int32Array; // which a2 cell won each 2x2 patch
  logits: Float64Array;
  probs: Float64Array;
  // scratch space for backprop
  dp1: Float64Array;
  dlogits: Float64Array;
}

/** Starting sizes of the random knobs, and the two safety belts used while training. */
export const SETTINGS = { w1: 0.1, w2: 0.2, w3: 0.1, decay: 0.01, clip: 2.5 };

export function createNet(nClasses: number, rng: RNG): Net {
  const net: Net = {
    nClasses,
    W1: new Float64Array(F1 * K1N),
    b1: new Float64Array(F1),
    W2: new Float64Array(F2 * F1 * K2N),
    b2: new Float64Array(F2),
    W3: new Float64Array(nClasses * FC_IN),
    b3: new Float64Array(nClasses),
  };
  // Small random starting values: this is the "random speckle".
  for (let i = 0; i < net.W1.length; i++) net.W1[i] = rng.gauss() * SETTINGS.w1;
  for (let i = 0; i < net.W2.length; i++) net.W2[i] = rng.gauss() * SETTINGS.w2;
  for (let i = 0; i < net.W3.length; i++) net.W3[i] = rng.gauss() * SETTINGS.w3;
  return net;
}

export function zerosLike(net: Net): Net {
  return {
    nClasses: net.nClasses,
    W1: new Float64Array(net.W1.length),
    b1: new Float64Array(net.b1.length),
    W2: new Float64Array(net.W2.length),
    b2: new Float64Array(net.b2.length),
    W3: new Float64Array(net.W3.length),
    b3: new Float64Array(net.b3.length),
  };
}

export function createCache(nClasses: number): Cache {
  return {
    x: new Float64Array(IN * IN),
    a1: new Float64Array(F1 * C1N),
    p1: new Float64Array(F1 * P1N),
    i1: new Int32Array(F1 * P1N),
    a2: new Float64Array(F2 * C2N),
    p2: new Float64Array(FC_IN),
    i2: new Int32Array(FC_IN),
    logits: new Float64Array(nClasses),
    probs: new Float64Array(nClasses),
    dp1: new Float64Array(F1 * P1N),
    dlogits: new Float64Array(nClasses),
  };
}

/** Squash + shrink in one pass: ReLU the map in place, then keep the strongest value of each 2x2 patch. */
function reluPool(
  a: Float64Array,
  p: Float64Array,
  idx: Int32Array,
  channels: number,
  size: number,
): void {
  const half = size / 2;
  const n = size * size;
  for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0;
  let o = 0;
  for (let c = 0; c < channels; c++) {
    const base = c * n;
    for (let py = 0; py < half; py++) {
      const row = base + py * 2 * size;
      for (let px = 0; px < half; px++) {
        const tl = row + px * 2;
        let bi = tl;
        let bv = a[tl];
        if (a[tl + 1] > bv) { bv = a[tl + 1]; bi = tl + 1; }
        if (a[tl + size] > bv) { bv = a[tl + size]; bi = tl + size; }
        if (a[tl + size + 1] > bv) { bv = a[tl + size + 1]; bi = tl + size + 1; }
        p[o] = bv;
        idx[o] = bi;
        o++;
      }
    }
  }
}

/** Run one drawing through the network. Fills the cache; the percentages end up in cache.probs. */
export function forward(net: Net, x: Float64Array, cache: Cache): void {
  const { W1, b1, W2, b2, W3, b3, nClasses } = net;
  const { a1, p1, i1, a2, p2, i2, logits, probs } = cache;
  if (cache.x !== x) cache.x.set(x);

  // layer 1: slide each 5x5 stencil across the image
  for (let f = 0; f < F1; f++) {
    const base = f * C1N;
    a1.fill(b1[f], base, base + C1N);
    for (let ky = 0; ky < K1; ky++) {
      const wi = f * K1N + ky * K1;
      const w0 = W1[wi], w1 = W1[wi + 1], w2 = W1[wi + 2], w3 = W1[wi + 3], w4 = W1[wi + 4];
      for (let y = 0; y < C1; y++) {
        const o = base + y * C1;
        const i = (y + ky) * IN;
        for (let xx = 0; xx < C1; xx++) {
          const j = i + xx;
          a1[o + xx] += w0 * x[j] + w1 * x[j + 1] + w2 * x[j + 2] + w3 * x[j + 3] + w4 * x[j + 4];
        }
      }
    }
  }
  reluPool(a1, p1, i1, F1, C1);

  // layer 2: each 3x3 stencil looks across all 8 layer-1 maps
  for (let u = 0; u < F2; u++) {
    const base = u * C2N;
    a2.fill(b2[u], base, base + C2N);
    for (let f = 0; f < F1; f++) {
      const inBase = f * P1N;
      const wBase = (u * F1 + f) * K2N;
      for (let ky = 0; ky < K2; ky++) {
        const wi = wBase + ky * K2;
        const w0 = W2[wi], w1 = W2[wi + 1], w2 = W2[wi + 2];
        for (let y = 0; y < C2; y++) {
          const o = base + y * C2;
          const i = inBase + (y + ky) * P1;
          for (let xx = 0; xx < C2; xx++) {
            const j = i + xx;
            a2[o + xx] += w0 * p1[j] + w1 * p1[j + 1] + w2 * p1[j + 2];
          }
        }
      }
    }
  }
  reluPool(a2, p2, i2, F2, C2);

  // final judge
  let max = -Infinity;
  for (let c = 0; c < nClasses; c++) {
    let s = b3[c];
    const wBase = c * FC_IN;
    for (let j = 0; j < FC_IN; j++) s += W3[wBase + j] * p2[j];
    logits[c] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let c = 0; c < nClasses; c++) {
    probs[c] = Math.exp(logits[c] - max);
    sum += probs[c];
  }
  for (let c = 0; c < nClasses; c++) probs[c] /= sum;
}

/** "How wrong" (cross-entropy) for the drawing currently in the cache. */
export function lossOf(cache: Cache, label: number): number {
  return -Math.log(Math.max(cache.probs[label], 1e-300));
}

/**
 * Backpropagation for the drawing currently in the cache.
 * Adds this example's gradients into `g` and returns how wrong the network was.
 */
export function backward(net: Net, cache: Cache, label: number, g: Net): number {
  const { W2, W3, nClasses } = net;
  const { x, p1, i1, p2, i2, probs, dp1, dlogits } = cache;

  // softmax + cross-entropy: gradient at the outputs is (percentages - right answer)
  for (let c = 0; c < nClasses; c++) {
    const d = probs[c] - (c === label ? 1 : 0);
    dlogits[c] = d;
    g.b3[c] += d;
    const wBase = c * FC_IN;
    for (let j = 0; j < FC_IN; j++) g.W3[wBase + j] += d * p2[j];
  }

  dp1.fill(0);

  // back through the judge, shrink 2 and squash 2: only the winner of each 2x2 patch gets blamed
  for (let u = 0; u < F2; u++) {
    for (let j = 0; j < P2N; j++) {
      const o = u * P2N + j;
      if (p2[o] <= 0) continue; // squashed to zero: no blame passes through
      let d = 0;
      for (let c = 0; c < nClasses; c++) d += W3[c * FC_IN + o] * dlogits[c];
      if (d === 0) continue;
      const local = i2[o] - u * C2N;
      const y = (local / C2) | 0;
      const xx = local - y * C2;
      g.b2[u] += d;
      for (let f = 0; f < F1; f++) {
        const wBase = (u * F1 + f) * K2N;
        const inBase = f * P1N + y * P1 + xx;
        for (let ky = 0; ky < K2; ky++) {
          for (let kx = 0; kx < K2; kx++) {
            const wi = wBase + ky * K2 + kx;
            const pi = inBase + ky * P1 + kx;
            g.W2[wi] += d * p1[pi];
            dp1[pi] += d * W2[wi];
          }
        }
      }
    }
  }

  // back through shrink 1 and squash 1 into the layer-1 stencils
  for (let f = 0; f < F1; f++) {
    const wBase = f * K1N;
    for (let j = 0; j < P1N; j++) {
      const o = f * P1N + j;
      const d = dp1[o];
      if (d === 0 || p1[o] <= 0) continue;
      const local = i1[o] - f * C1N;
      const y = (local / C1) | 0;
      const xx = local - y * C1;
      g.b1[f] += d;
      for (let ky = 0; ky < K1; ky++) {
        const xi = (y + ky) * IN + xx;
        const wi = wBase + ky * K1;
        for (let kx = 0; kx < K1; kx++) g.W1[wi + kx] += d * x[xi + kx];
      }
    }
  }

  return lossOf(cache, label);
}

const PARAM_KEYS = ["W1", "b1", "W2", "b2", "W3", "b3"] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

/**
 * Plain stochastic gradient descent: nudge every knob a little, downhill. Then clear the gradients.
 *
 * Two small safety belts, both visible here:
 *  - if one mini-batch asks for a huge nudge, the whole nudge is scaled down (gradient clipping),
 *    which stops a single surprising batch from wrecking what has been learned;
 *  - layer-1 knobs are pulled very slightly towards zero each step (weight decay), so knobs that
 *    are not earning their keep fade to white and the useful pattern is easier to see.
 * Returns the size of the nudge that was asked for (the gradient norm), before clipping.
 */
export function sgdStep(net: Net, g: Net, lr: number, batchSize: number): number {
  let sq = 0;
  for (const key of PARAM_KEYS) {
    const d = g[key];
    for (let i = 0; i < d.length; i++) sq += d[i] * d[i];
  }
  const norm = Math.sqrt(sq) / batchSize;
  const scale = (lr / batchSize) * (norm > SETTINGS.clip ? SETTINGS.clip / norm : 1);
  for (const key of PARAM_KEYS) {
    const w = net[key];
    const d = g[key];
    const keep = key === "W1" ? 1 - lr * SETTINGS.decay : 1;
    for (let i = 0; i < w.length; i++) {
      w[i] = w[i] * keep - scale * d[i];
      d[i] = 0;
    }
  }
  return norm;
}

export function argmax(a: Float64Array): number {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

export interface GradCheckRow {
  param: ParamKey;
  index: number;
  backprop: number;
  numeric: number;
  relError: number;
}

/**
 * Numerical gradient check: wiggle a few knobs by a tiny amount, measure how the loss changes,
 * and compare with what backprop says. If the hand-written maths is right these agree closely.
 */
export function gradientCheck(net: Net, x: Float64Array, label: number, rng: RNG, perParam = 4): GradCheckRow[] {
  const cache = createCache(net.nClasses);
  const g = zerosLike(net);
  forward(net, x, cache);
  backward(net, cache, label, g);
  const eps = 1e-5;
  const rows: GradCheckRow[] = [];
  // Squash and shrink have sharp corners. If a wiggle flips which cell wins a 2x2 patch (or switches a
  // cell on or off), the slope is not defined there, so that knob is skipped and another one is tried.
  const pattern = () => {
    let h = 0;
    for (let i = 0; i < cache.i1.length; i++) h = (Math.imul(h, 31) + cache.i1[i] + (cache.p1[i] > 0 ? 7 : 0)) | 0;
    for (let i = 0; i < cache.i2.length; i++) h = (Math.imul(h, 31) + cache.i2[i] + (cache.p2[i] > 0 ? 7 : 0)) | 0;
    return h;
  };
  for (const key of PARAM_KEYS) {
    const w = net[key];
    // prefer knobs that actually matter for this drawing, so the check is not just 0 vs 0
    const live: number[] = [];
    for (let i = 0; i < w.length; i++) if (Math.abs(g[key][i]) > 1e-9) live.push(i);
    let found = 0;
    for (let tries = 0; found < perParam && tries < perParam * 6; tries++) {
      const index = live.length ? live[rng.int(live.length)] : rng.int(w.length);
      const keep = w[index];
      w[index] = keep + eps;
      forward(net, x, cache);
      const up = lossOf(cache, label);
      const patUp = pattern();
      w[index] = keep - eps;
      forward(net, x, cache);
      const down = lossOf(cache, label);
      const patDown = pattern();
      w[index] = keep;
      if (patUp !== patDown) continue;
      found++;
      const numeric = (up - down) / (2 * eps);
      const backprop = g[key][index];
      const relError = Math.abs(numeric - backprop) / Math.max(1e-12, Math.abs(numeric) + Math.abs(backprop));
      rows.push({ param: key, index, backprop, numeric, relError });
    }
  }
  forward(net, x, cache);
  return rows;
}

export interface HotSpot {
  /** strongest pooled value of this layer-2 unit (its "points") */
  score: number;
  /** top-left corner and size of the input patch that drove it */
  x: number;
  y: number;
  size: number;
}

/** The patch of input one layer-2 cell can see: 3x3 on 12x12, each a 2x2 patch of 24x24, each a 5x5 stencil. */
export const HOT_SIZE = (K2 - 1) * 2 + 2 + (K1 - 1); // 10

/** Trace a layer-2 unit's strongest pooled position back through the layers to a patch of the input. */
export function hotSpot(cache: Cache, unit: number): HotSpot {
  let best = -1;
  let score = 0;
  for (let j = 0; j < P2N; j++) {
    const v = cache.p2[unit * P2N + j];
    if (v > score) {
      score = v;
      best = j;
    }
  }
  if (best < 0) return { score: 0, x: 0, y: 0, size: HOT_SIZE };
  const local = cache.i2[unit * P2N + best] - unit * C2N;
  const y2 = (local / C2) | 0;
  const x2 = local - y2 * C2;
  return { score, x: x2 * 2, y: y2 * 2, size: HOT_SIZE };
}
