/**
 * Automatic checks for the "It works" list in the build spec (section 6), plus the brain and card checks.
 * Run with: npm run check
 */
import { RNG } from "../lib/rng";
import { FULL_VARIETY, brushShape, generateShape } from "../lib/shapes";
import { F1, Net, argmax, backward, brainFromObject, brainToObject, cloneNet, createCache, createNet, forward, gradientCheck, previewNudge, sgdStep, zerosLike } from "../lib/net";
import { Lab, Pile, TEST_SIZE, TRAIN_SIZE } from "../lib/lab";
import { NUDGE_ZOOM, shownBet, sumText } from "../lib/ideas";

const LR = 0.1;
let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

/** How line-like is a 5x5 stencil? The share of its pattern explained by stripes in one direction. Speckle scores about 0.34. */
function stripeShare(w: Float64Array, f: number): number {
  let mean = 0, total = 0, best = 0;
  for (let i = 0; i < 25; i++) mean += w[f * 25 + i] / 25;
  for (let i = 0; i < 25; i++) total += (w[f * 25 + i] - mean) ** 2;
  for (let deg = 0; deg < 180; deg += 15) {
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    const sum = new Float64Array(5), cnt = new Float64Array(5);
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++) {
        const bin = Math.max(0, Math.min(4, Math.round(((x - 2) * c + (y - 2) * s) / 1.15) + 2));
        sum[bin] += w[f * 25 + y * 5 + x] - mean;
        cnt[bin]++;
      }
    let e = 0;
    for (let b = 0; b < 5; b++) if (cnt[b]) e += (sum[b] * sum[b]) / cnt[b];
    best = Math.max(best, e);
  }
  return total > 0 ? best / total : 0;
}

function trainFor(lab: Lab, seconds: number): void {
  const start = performance.now();
  while (performance.now() - start < seconds * 1000) {
    lab.advance(12, true, LR);
    lab.trainMs = performance.now() - start;
  }
  lab.flush();
}

// --- gradient check ----------------------------------------------------------
{
  const rng = new RNG(123);
  const net = createNet(3, rng);
  let worst = 0, n = 0;
  for (let t = 0; t < 8; t++) {
    const cls = rng.int(3);
    for (const r of gradientCheck(net, generateShape(rng, cls, FULL_VARIETY), cls, rng, 6)) {
      n++;
      if (Math.abs(r.numeric) + Math.abs(r.backprop) > 1e-7) worst = Math.max(worst, r.relError);
    }
  }
  check("gradient check: numerical gradient matches backprop", worst < 1e-5, `${n} knobs checked, worst relative error ${worst.toExponential(2)}`);
}

// --- cards: balanced, separate piles -----------------------------------------
const lab = new Lab();
{
  const count = (p: Pile) => [0, 1, 2].map((c) => p.y.filter((v) => v === c).length).join("/");
  const key = (x: Float64Array) => Array.from(x, (v) => v.toFixed(4)).join(",");
  const seen = new Set(lab.train.x.map(key));
  const shared = lab.test.x.filter((x) => seen.has(key(x))).length;
  check("practice and test piles are balanced", count(lab.train) === "500/500/500" && count(lab.test) === "100/100/100", `practice ${count(lab.train)} of ${TRAIN_SIZE}, test ${count(lab.test)} of ${TEST_SIZE} (triangle/square/circle)`);
  check("no card appears in both piles", shared === 0 && seen.size === TRAIN_SIZE, `${shared} shared cards; ${seen.size} distinct practice cards`);
}

// --- same seed, same stencils, same curve ------------------------------------
{
  const a = new Lab(), b = new Lab();
  const sameStart = a.net.W1.every((v, i) => v === b.net.W1[i]);
  while (a.step < 200) a.advance(2, true, LR);
  while (b.step < 200) b.advance(50, true, LR);
  a.flush(); b.flush();
  const sameCurve = a.lossHistory.slice(0, 200).every((v, i) => v === b.lossHistory[i]);
  const acc = (l: Lab) => l.accHistory.filter((p) => p.step <= 200).map((p) => p.acc).join(",");
  check("Reset repeats the same starting stencils and the same training curve", sameStart && sameCurve && acc(a) === acc(b), `identical start: ${sameStart}; first 200 how-wrong values identical: ${sameCurve}; test scores identical: ${acc(a) === acc(b)}`);
}

// --- slow-mo: the sum matches the bet, the change map matches the real nudge, and nothing is disturbed
{
  const l = new Lab();
  while (l.step < 60) l.advance(50, true, LR);
  l.flush();
  const before = cloneNet(l.net);
  const cache = createCache(3), g = zerosLike(l.net);
  const x = l.train.x[11], label = l.train.y[11];
  forward(l.net, x, cache);
  backward(l.net, cache, label, g);
  const shown = previewNudge(l.net, g, LR, 1, "W1").map((v) => v * NUDGE_ZOOM);
  const untouched = (["W1", "b1", "W2", "b2", "W3", "b3"] as const).every((k) => l.net[k].every((v, i) => v === before[k][i]));
  const real = cloneNet(l.net);
  sgdStep(real, g, LR, 1);
  let worst = 0;
  for (let i = 0; i < shown.length; i++) worst = Math.max(worst, Math.abs(shown[i] - (real.W1[i] - before.W1[i]) * NUDGE_ZOOM));
  const t = sumText(cache.probs[label], label);
  const sumOk = Math.abs(t.loss - -Math.log(shownBet(cache.probs[label]))) < 1e-12 && Math.abs(t.loss - -Math.log(cache.probs[label])) < 0.06;
  check("slow-mo does not change the real training run", untouched, "all 1,395 knobs identical before and after a slow-mo card");
  check("slow-mo change map matches the real weight change, scaled", worst < 1e-12, `largest difference ${worst.toExponential(1)} (change drawn ${NUDGE_ZOOM} times bigger)`);
  check("the how-wrong sum matches the displayed bet", sumOk, `${t.bet}, ${t.sum}; exact value ${(-Math.log(cache.probs[label])).toFixed(3)}`);
}

// --- speed, accuracy, edges, drawn shapes -----------------------------------
const startStripes = Array.from({ length: F1 }, (_, f) => stripeShare(lab.net.W1, f));
trainFor(lab, 30);
const acc = lab.latestAcc!.acc;
check("over 85% on the 300 test cards within 30 s", acc > 0.85, `test score ${(acc * 100).toFixed(1)}% after ${lab.step} steps (${lab.cardsSeen} cards); first passed 85% at ${lab.reached85Ms === null ? "never" : (lab.reached85Ms / 1000).toFixed(1) + " s"}`);
{
  const stripes = Array.from({ length: F1 }, (_, f) => stripeShare(lab.net.W1, f));
  const n = stripes.filter((e) => e > 0.55).length;
  check("stencils start as speckle and at least half look edge-like once trained", n >= 4, `stripe share (speckle is about 0.34), start: [${startStripes.map((e) => e.toFixed(2)).join(" ")}] trained: [${stripes.map((e) => e.toFixed(2)).join(" ")}] (${n}/8 above 0.55)`);
}
{
  const rng = new RNG(9), cache = createCache(3), N = 2000, right = [0, 0, 0];
  for (let cls = 0; cls < 3; cls++)
    for (let i = 0; i < N; i++) {
      const r = rng.range(5, 10);
      forward(lab.net, brushShape(cls, rng.range(r + 1.5, 26.5 - r), rng.range(r + 1.5, 26.5 - r), r, rng.range(0, 6.283)), cache);
      if (argmax(cache.probs) === cls) right[cls]++;
    }
  const p = right.map((v) => ((v / N) * 100).toFixed(1) + "%");
  check("a triangle, square or circle drawn anywhere on the pad gets the highest percentage", Math.min(...right) / N > 0.85, `of ${N} brush-drawn shapes each (random place, size and angle): triangles ${p[0]}, squares ${p[1]}, circles ${p[2]}`);
}

// --- download the brain, load it fresh: same test score -----------------------
{
  const file = JSON.stringify(brainToObject(lab.net, acc));
  const fresh = new Lab();
  fresh.loadBrain(brainFromObject(JSON.parse(file)) as Net);
  fresh.flush();
  check("a downloaded brain, loaded fresh, gets exactly the same test score", fresh.latestAcc!.acc === acc, `${(file.length / 1024).toFixed(1)} KB file; before ${acc}, after ${fresh.latestAcc!.acc}, with no training`);
}

// --- "centred only" training, then cards in a corner -------------------------
{
  const variety = { centredOnly: true, noRotation: false, outlinesOnly: false };
  const l = new Lab(variety);
  trainFor(l, 20);
  const rng = new RNG(555);
  const corner: Pile = { x: [], y: new Int32Array(300) };
  for (let i = 0; i < 300; i++) {
    corner.y[i] = i % 3;
    corner.x.push(generateShape(rng, i % 3, FULL_VARIETY, { corner: true }));
  }
  const a = l.latestAcc!;
  const c = l.accuracyOn(corner);
  check("centred-only practice, then cards in a corner", a.acc - c > 0.1, `centred test cards ${(a.acc * 100).toFixed(1)}%, cards of every kind ${(a.wide * 100).toFixed(1)}%, small cards in a corner ${(c * 100).toFixed(1)}%`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
