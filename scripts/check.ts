/**
 * Automatic checks for the acceptance list in the build spec (section 8).
 * Run with: npm run check
 */
import { RNG } from "../lib/rng";
import { FULL_VARIETY, generateShape, scribbleShape } from "../lib/shapes";
import { F1, argmax, createCache, createNet, forward, gradientCheck } from "../lib/net";
import { DataSet, Lab } from "../lib/lab";
import { orientedShare } from "../lib/analysis";

const edgeScore = (w: Float64Array, f: number) => orientedShare(w, f * 25);

const LR = Number(process.env.LR ?? 0.1);
const SEEDS = (process.env.SEEDS ?? "7,42,2024").split(",").map(Number);
let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

function trainFor(lab: Lab, seconds: number, lr: number): void {
  const start = performance.now();
  while (performance.now() - start < seconds * 1000) {
    lab.advance(12, true, lr);
    lab.trainMs = performance.now() - start;
  }
  lab.flush();
}

// --- 1. gradient check -------------------------------------------------------
{
  const rng = new RNG(123);
  let worst = 0;
  let n = 0;
  for (const nClasses of [3, 4]) {
    const net = createNet(nClasses, rng);
    for (let t = 0; t < 4; t++) {
      const cls = rng.int(nClasses);
      const rows = gradientCheck(net, generateShape(rng, cls, FULL_VARIETY), cls, rng, 6);
      for (const r of rows) {
        n++;
        if (Math.abs(r.numeric) + Math.abs(r.backprop) > 1e-7) worst = Math.max(worst, r.relError);
      }
    }
  }
  check("gradient check: numerical gradient matches backprop", worst < 1e-5, `${n} knobs checked, worst relative error ${worst.toExponential(2)}`);
}

// --- 2. same seed, same stencils, same curve ---------------------------------
{
  const a = new Lab({ seed: 99, variety: FULL_VARIETY, lineClass: false });
  const b = new Lab({ seed: 99, variety: FULL_VARIETY, lineClass: false });
  const c = new Lab({ seed: 100, variety: FULL_VARIETY, lineClass: false });
  const sameStart = a.net.W1.every((v, i) => v === b.net.W1[i]);
  const differentSeedDiffers = a.net.W1.some((v, i) => v !== c.net.W1[i]);
  // run them with very different time slices, as a fast and a slow computer would
  while (a.step < 200) a.advance(2, true, LR);
  while (b.step < 200) b.advance(50, true, LR);
  a.flush();
  b.flush();
  const n = Math.min(a.lossHistory.length, b.lossHistory.length, 200);
  let sameCurve = true;
  for (let i = 0; i < n; i++) if (a.lossHistory[i] !== b.lossHistory[i]) sameCurve = false;
  const accA = a.accHistory.filter((p) => p.step <= 200).map((p) => p.acc).join(",");
  const accB = b.accHistory.filter((p) => p.step <= 200).map((p) => p.acc).join(",");
  check("same seed gives the same starting stencils", sameStart && differentSeedDiffers, `identical W1: ${sameStart}; other seed differs: ${differentSeedDiffers}`);
  check("same seed gives the same training curve", sameCurve && accA === accB, `first ${n} loss values identical: ${sameCurve}; accuracy points identical: ${accA === accB}`);
}

// --- 3. speed, accuracy, edges, drawn triangles -----------------------------
for (const seed of SEEDS) {
  const lab = new Lab({ seed, variety: FULL_VARIETY, lineClass: false });
  const startEdges = Array.from({ length: F1 }, (_, f) => edgeScore(lab.net.W1, f));
  trainFor(lab, 30, LR);
  const acc = lab.latestAcc!.acc;
  check(
    `seed ${seed}: over 85% test accuracy within 30 s`,
    acc > 0.85,
    `test accuracy ${(acc * 100).toFixed(1)}% after ${lab.step} steps (${lab.examplesSeen} examples); first passed 85% at ${lab.reached85Ms === null ? "never" : (lab.reached85Ms / 1000).toFixed(1) + " s"}`,
  );
  const edges = Array.from({ length: F1 }, (_, f) => edgeScore(lab.net.W1, f));
  const edgy = edges.filter((e) => e > 0.55).length;
  check(
    `seed ${seed}: at least half of the layer-1 stencils look edge-like`,
    edgy >= 4,
    `stripe share per stencil (random speckle is about 0.34), start: [${startEdges.map((e) => e.toFixed(2)).join(" ")}]  trained: [${edges.map((e) => e.toFixed(2)).join(" ")}]  (${edgy}/8 above 0.55)`,
  );

  // hand-drawn (scribbled) shapes all over the pad
  const rng = new RNG(seed + 1);
  const cache = createCache(3);
  const right = [0, 0, 0];
  const N = 200;
  for (let cls = 0; cls < 3; cls++)
    for (let i = 0; i < N; i++) {
      const r = rng.range(5, 9.5);
      const g = scribbleShape(rng, cls, rng.range(r + 2, 26 - r), rng.range(r + 2, 26 - r), r);
      forward(lab.net, g, cache);
      if (argmax(cache.probs) === cls) right[cls]++;
    }
  check(
    `seed ${seed}: a scribbled triangle anywhere on the pad wins`,
    right[0] / N > 0.85,
    `scribbled shapes recognised: triangle ${((right[0] / N) * 100).toFixed(0)}%, square ${((right[1] / N) * 100).toFixed(0)}%, circle ${((right[2] / N) * 100).toFixed(0)}%`,
  );
}

// --- 4. "centred only" training, then shapes in a corner --------------------
{
  const seed = SEEDS[0];
  const variety = { centredOnly: true, noRotation: false, outlinesOnly: false };
  const lab = new Lab({ seed, variety, lineClass: false });
  trainFor(lab, 20, LR);
  const rng = new RNG(555);
  const corner: DataSet = { x: [], y: new Int32Array(300) };
  const centredSmall: DataSet = { x: [], y: new Int32Array(300) };
  for (let i = 0; i < 300; i++) {
    corner.y[i] = i % 3;
    corner.x.push(generateShape(rng, i % 3, FULL_VARIETY, { corner: true }));
    centredSmall.y[i] = i % 3;
    centredSmall.x.push(generateShape(rng, i % 3, variety));
  }
  const centredAcc = lab.latestAcc!.acc;
  const wideAcc = lab.latestAcc!.wide;
  const cornerAcc = lab.accuracyOn(corner);
  check(
    "centred-only training drops on shapes in a corner",
    centredAcc - cornerAcc > 0.1,
    `centred test ${(centredAcc * 100).toFixed(1)}%, any-position test ${(wideAcc * 100).toFixed(1)}%, corner shapes ${(cornerAcc * 100).toFixed(1)}%`,
  );
}

// --- 5. the 4-class stretch goal still learns --------------------------------
{
  const lab = new Lab({ seed: SEEDS[0], variety: FULL_VARIETY, lineClass: true });
  trainFor(lab, 30, LR);
  check("with the 'line' distractor class it still learns", lab.latestAcc!.acc > 0.8, `4-class test accuracy ${(lab.latestAcc!.acc * 100).toFixed(1)}% after ${lab.step} steps`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
