/**
 * The lab engine: data sets, the training loop, test scoring and the layer-2 "top examples".
 * It has no idea about the screen. The page asks it to do a few milliseconds of work each animation frame.
 */
import { RNG } from "./rng";
import { FULL_VARIETY, Variety, generateShape, PIXELS } from "./shapes";
import {
  Cache,
  F2,
  Net,
  argmax,
  backward,
  createCache,
  createNet,
  forward,
  hotSpot,
  sgdStep,
  zerosLike,
} from "./net";

export const BATCH = 16;
export const TRAIN_SIZE = 1500;
export const TEST_SIZE = 300;
export const EVAL_EVERY = 25; // steps between test-accuracy points
export const SCAN_EVERY = 100; // steps between refreshes of the layer-2 top examples
const SCAN_WINDOW = 300;
export const TOP_K = 4;

export interface LabConfig {
  seed: number;
  variety: Variety;
  /** stretch goal: add "line" as a 4th, distractor class */
  lineClass: boolean;
}

export interface DataSet {
  x: Float64Array[];
  y: Int32Array;
}

export interface AccPoint {
  step: number;
  /** accuracy on test shapes made the same way as the training shapes */
  acc: number;
  /** accuracy on test shapes of every kind (only differs when variety toggles are on) */
  wide: number;
}

export interface TopExample {
  index: number;
  score: number;
  hx: number;
  hy: number;
}

export interface BatchItem {
  index: number;
  label: number;
  guess: number;
}

function makeSet(rng: RNG, n: number, nClasses: number, variety: Variety): DataSet {
  const x: Float64Array[] = [];
  const y = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cls = i % nClasses; // balanced across classes
    y[i] = cls;
    x.push(generateShape(rng, cls, variety));
  }
  return { x, y };
}

function isNarrow(v: Variety): boolean {
  return v.centredOnly || v.noRotation || v.outlinesOnly;
}

type Job =
  | { kind: "eval"; pos: number; right: number; rightWide: number; confusion: Int32Array }
  | { kind: "scan"; pos: number; candidates: Int32Array; best: TopExample[][] };

export class Lab {
  config: LabConfig;
  nClasses: number;
  net!: Net;
  grads!: Net;
  cache!: Cache;
  train!: DataSet;
  test!: DataSet;
  /** test shapes of every kind; the same object as `test` when no variety toggle is on */
  wideTest!: DataSet;
  narrow = false;

  step = 0;
  examplesSeen = 0;
  /** "how wrong" for every mini-batch so far */
  lossHistory: number[] = [];
  /** smoothed version, nicer to read on a chart */
  lossSmooth: number[] = [];
  accHistory: AccPoint[] = [];
  top: TopExample[][] = [];
  lastBatch: BatchItem[] = [];
  /** report card: confusion[true shape * nClasses + guessed shape], on the test shapes */
  confusion: Int32Array = new Int32Array(9);
  /** bumps whenever the weights change, so the page knows to redraw */
  version = 0;
  /** milliseconds of practice so far, by the clock on the wall (the page adds to this while training) */
  trainMs = 0;
  /** trainMs at the moment the test score first passed 85% */
  reached85Ms: number | null = null;
  reached85Step: number | null = null;

  private order!: Int32Array;
  private cursor = 0;
  private batchRng!: RNG;
  private scanCursor = 0;
  private jobs: Job[] = [];

  constructor(config: LabConfig) {
    this.config = config;
    this.nClasses = config.lineClass ? 4 : 3;
    this.reset(config);
  }

  /** New random stencils and new data. The same seed always gives the same start. */
  reset(config: LabConfig = this.config): void {
    this.config = { ...config, variety: { ...config.variety } };
    this.nClasses = config.lineClass ? 4 : 3;
    const seed = config.seed >>> 0;
    // separate streams, so the starting stencils depend only on the seed, not on the toggles
    this.net = createNet(this.nClasses, new RNG(seed));
    this.grads = zerosLike(this.net);
    this.cache = createCache(this.nClasses);
    const dataRng = new RNG((seed ^ 0x9e3779b9) >>> 0);
    this.narrow = isNarrow(config.variety);
    this.train = makeSet(dataRng, TRAIN_SIZE, this.nClasses, config.variety);
    this.test = makeSet(dataRng, TEST_SIZE, this.nClasses, config.variety);
    this.wideTest = this.narrow ? makeSet(dataRng, TEST_SIZE, this.nClasses, FULL_VARIETY) : this.test;
    this.batchRng = new RNG((seed ^ 0x51ed270b) >>> 0);
    this.order = new Int32Array(TRAIN_SIZE);
    for (let i = 0; i < TRAIN_SIZE; i++) this.order[i] = i;
    this.batchRng.shuffle(this.order);
    this.cursor = 0;
    this.scanCursor = 0;
    this.step = 0;
    this.examplesSeen = 0;
    this.lossHistory = [];
    this.lossSmooth = [];
    this.accHistory = [];
    this.top = [];
    for (let u = 0; u < F2; u++) this.top.push([]);
    this.lastBatch = [];
    this.confusion = new Int32Array(this.nClasses * this.nClasses);
    this.trainMs = 0;
    this.reached85Ms = null;
    this.reached85Step = null;
    this.jobs = [];
    this.version++;
    this.queueEval();
    this.queueScan();
  }

  get busy(): boolean {
    return this.jobs.length > 0;
  }

  get latestAcc(): AccPoint | null {
    return this.accHistory.length ? this.accHistory[this.accHistory.length - 1] : null;
  }

  /** One mini-batch of plain SGD. */
  trainStep(lr: number): number {
    const { net, grads, cache, train } = this;
    let lossSum = 0;
    const batch: BatchItem[] = [];
    for (let b = 0; b < BATCH; b++) {
      if (this.cursor >= TRAIN_SIZE) {
        this.batchRng.shuffle(this.order);
        this.cursor = 0;
      }
      const index = this.order[this.cursor++];
      const label = train.y[index];
      forward(net, train.x[index], cache);
      batch.push({ index, label, guess: argmax(cache.probs) });
      lossSum += backward(net, cache, label, grads);
    }
    sgdStep(net, grads, lr, BATCH);
    const loss = lossSum / BATCH;
    this.step++;
    this.examplesSeen += BATCH;
    this.lastBatch = batch;
    this.lossHistory.push(loss);
    const prev = this.lossSmooth.length ? this.lossSmooth[this.lossSmooth.length - 1] : loss;
    this.lossSmooth.push(prev * 0.92 + loss * 0.08);
    this.version++;
    if (this.step % EVAL_EVERY === 0) this.queueEval();
    if (this.step % SCAN_EVERY === 0 || this.step === 20 || this.step === 50) this.queueScan();
    return loss;
  }

  private queueEval(): void {
    this.jobs.push({ kind: "eval", pos: 0, right: 0, rightWide: 0, confusion: new Int32Array(this.nClasses * this.nClasses) });
  }

  private queueScan(): void {
    // look at a rolling window of training shapes, plus the current champions
    const set = new Set<number>();
    for (const list of this.top) for (const t of list) set.add(t.index);
    for (let i = 0; i < SCAN_WINDOW; i++) set.add((this.scanCursor + i) % TRAIN_SIZE);
    this.scanCursor = (this.scanCursor + SCAN_WINDOW) % TRAIN_SIZE;
    const best: TopExample[][] = [];
    for (let u = 0; u < F2; u++) best.push([]);
    this.jobs.push({ kind: "scan", pos: 0, candidates: Int32Array.from(set), best });
  }

  /** Do a slice of a queued job (test scoring or top-example scan). Returns true when that job finished. */
  private runJob(job: Job, count: number): boolean {
    const { net, cache } = this;
    if (job.kind === "eval") {
      const end = Math.min(TEST_SIZE, job.pos + count);
      for (let i = job.pos; i < end; i++) {
        forward(net, this.test.x[i], cache);
        const guess = argmax(cache.probs);
        if (guess === this.test.y[i]) job.right++;
        job.confusion[this.test.y[i] * this.nClasses + guess]++;
        if (this.narrow) {
          forward(net, this.wideTest.x[i], cache);
          if (argmax(cache.probs) === this.wideTest.y[i]) job.rightWide++;
        }
      }
      job.pos = end;
      if (end < TEST_SIZE) return false;
      const acc = job.right / TEST_SIZE;
      const wide = this.narrow ? job.rightWide / TEST_SIZE : acc;
      this.accHistory.push({ step: this.step, acc, wide });
      this.confusion = job.confusion;
      if (acc >= 0.85 && this.reached85Ms === null) {
        this.reached85Ms = this.trainMs;
        this.reached85Step = this.step;
      }
      return true;
    }
    const end = Math.min(job.candidates.length, job.pos + count);
    for (let i = job.pos; i < end; i++) {
      const index = job.candidates[i];
      forward(net, this.train.x[index], cache);
      for (let u = 0; u < F2; u++) {
        const h = hotSpot(cache, u);
        if (h.score <= 0) continue;
        const list = job.best[u];
        if (list.length < TOP_K || h.score > list[list.length - 1].score) {
          list.push({ index, score: h.score, hx: h.x, hy: h.y });
          list.sort((a, b) => b.score - a.score);
          if (list.length > TOP_K) list.pop();
        }
      }
    }
    job.pos = end;
    if (end < job.candidates.length) return false;
    this.top = job.best;
    return true;
  }

  /**
   * Work for up to `budgetMs`. Queued scoring jobs always finish before the next training step,
   * so results depend only on the seed and the number of steps, never on how fast the computer is.
   */
  advance(budgetMs: number, training: boolean, lr: number, now: () => number = () => performance.now()): void {
    const start = now();
    let guard = 0;
    while (guard++ < 10000) {
      if (this.jobs.length) {
        if (this.runJob(this.jobs[0], 24)) this.jobs.shift();
      } else if (training) {
        this.trainStep(lr);
      } else {
        break;
      }
      if (now() - start >= budgetMs) break;
    }
  }

  /** Finish any queued scoring right now (used by the Step button and the automatic checks). */
  flush(): void {
    while (this.jobs.length) {
      if (this.runJob(this.jobs[0], 100000)) this.jobs.shift();
    }
  }

  /** Accuracy on any labelled set. Used by the automatic checks. */
  accuracyOn(set: DataSet): number {
    let right = 0;
    for (let i = 0; i < set.x.length; i++) {
      forward(this.net, set.x[i], this.cache);
      if (argmax(this.cache.probs) === set.y[i]) right++;
    }
    return right / set.x.length;
  }
}

export function emptyDrawing(): Float64Array {
  return new Float64Array(PIXELS);
}
