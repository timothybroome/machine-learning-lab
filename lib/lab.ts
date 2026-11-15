/**
 * The lab engine: the two piles of cards, the training loop, test scoring and the layer-2 favourites.
 * It has no idea about the screen. The page asks it to do a few milliseconds of work each animation frame.
 */
import { RNG } from "./rng";
import { FULL_VARIETY, Variety, generateShape } from "./shapes";
import { Cache, F2, Net, argmax, backward, createCache, createNet, forward, hotSpot, lossOf, sgdStep, zerosLike } from "./net";

export const SEED = 7; // Reset always starts from the same random speckle
export const BATCH = 16;
export const TRAIN_SIZE = 1500;
export const TEST_SIZE = 300;
export const EVAL_EVERY = 25; // steps between test-score points
export const SCAN_EVERY = 100; // steps between refreshes of the layer-2 favourites
const SCAN_WINDOW = 300;
export const TOP_K = 4;

/** A pile of cards: the dots, and the label written on the back of each one. */
export interface Pile {
  x: Float64Array[];
  y: Int32Array;
}

export interface AccPoint {
  step: number;
  /** test score on cards made the same way as the practice cards */
  acc: number;
  /** test score on cards of every kind (only differs when a variety switch is on) */
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

/** Also returns `made`: where in the shuffled pile the 1st, 2nd, 3rd... card that was drawn ended up. */
function makePile(rng: RNG, n: number, variety: Variety): Pile & { made: Int32Array } {
  const x: Float64Array[] = [];
  const y = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = i % 3; // balanced: the same number of each shape
    x.push(generateShape(rng, y[i], variety)); // the picture is drawn from its own label
  }
  // shuffle the pile so it is a mix, not triangle, square, circle over and over.
  // Each picture and its label move together, so they can never get out of step.
  const mix = new RNG(SEED ^ n);
  const from = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = mix.int(i + 1);
    [x[i], x[j]] = [x[j], x[i]];
    [y[i], y[j]] = [y[j], y[i]];
    [from[i], from[j]] = [from[j], from[i]];
  }
  const made = new Int32Array(n);
  for (let i = 0; i < n; i++) made[from[i]] = i;
  return { x, y, made };
}

type Job =
  | { kind: "eval"; pos: number; right: number; rightWide: number }
  | { kind: "scan"; pos: number; candidates: Int32Array; best: TopExample[][] };

export class Lab {
  variety: Variety = { ...FULL_VARIETY };
  net!: Net;
  grads!: Net;
  cache!: Cache;
  train!: Pile;
  test!: Pile;
  /** test cards of every kind; the same pile as `test` when no variety switch is on */
  wideTest!: Pile;
  narrow = false;

  step = 0;
  cardsSeen = 0;
  lossHistory: number[] = [];
  lossSmooth: number[] = [];
  accHistory: AccPoint[] = [];
  top: TopExample[][] = [];
  lastBatch: BatchItem[] = [];
  /** bumps whenever the knobs change, so the page knows to redraw */
  version = 0;
  /** milliseconds of practice so far, by the clock on the wall (the page adds to this while training) */
  trainMs = 0;
  reached85Ms: number | null = null;
  /** true after Reset until the first nudge: it has not practised, so the page shows no guesses or scores */
  fresh = true;

  private order!: Int32Array;
  private cursor = 0;
  private batchRng!: RNG;
  private scanCursor = 0;
  private jobs: Job[] = [];

  constructor(variety: Variety = FULL_VARIETY) {
    this.reset(variety);
  }

  /** New random knobs and new cards. The seed is fixed, so Reset always replays the same run. */
  reset(variety: Variety = this.variety): void {
    this.variety = { ...variety };
    this.narrow = variety.centredOnly || variety.noRotation || variety.outlinesOnly;
    this.net = createNet(3, new RNG(SEED));
    this.grads = zerosLike(this.net);
    this.cache = createCache(3);
    const rng = new RNG(SEED ^ 0x9e3779b9);
    const train = makePile(rng, TRAIN_SIZE, variety);
    this.train = train;
    this.test = makePile(rng, TEST_SIZE, variety);
    this.wideTest = this.narrow ? makePile(rng, TEST_SIZE, FULL_VARIETY) : this.test;
    this.batchRng = new RNG(SEED ^ 0x51ed270b);
    this.order = Int32Array.from(train.made); // practise in a shuffle of the order the cards were drawn in
    this.batchRng.shuffle(this.order);
    this.cursor = 0;
    this.clearHistory();
    this.fresh = true;
  }

  /** Swap in a saved brain. The cards stay the same; the charts start again. */
  loadBrain(net: Net): void {
    this.net = net;
    this.grads = zerosLike(net);
    this.clearHistory();
    this.fresh = false;
  }

  private clearHistory(): void {
    this.scanCursor = 0;
    this.step = 0;
    this.cardsSeen = 0;
    this.lossHistory = [];
    this.lossSmooth = [];
    this.accHistory = [];
    this.top = Array.from({ length: F2 }, () => []);
    this.lastBatch = [];
    this.trainMs = 0;
    this.reached85Ms = null;
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

  /** Fast training: guess, mark and blame 16 cards, then nudge once. */
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
    this.fresh = false;
    this.cardsSeen += BATCH;
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
    this.jobs.push({ kind: "eval", pos: 0, right: 0, rightWide: 0 });
  }

  private queueScan(): void {
    // look at a rolling window of practice cards, plus the current favourites
    const set = new Set<number>();
    for (const list of this.top) for (const t of list) set.add(t.index);
    for (let i = 0; i < SCAN_WINDOW; i++) set.add((this.scanCursor + i) % TRAIN_SIZE);
    this.scanCursor = (this.scanCursor + SCAN_WINDOW) % TRAIN_SIZE;
    this.jobs.push({ kind: "scan", pos: 0, candidates: Int32Array.from(set), best: Array.from({ length: F2 }, () => []) });
  }

  private runJob(job: Job, count: number): boolean {
    const { net, cache } = this;
    if (job.kind === "eval") {
      const end = Math.min(TEST_SIZE, job.pos + count);
      for (let i = job.pos; i < end; i++) {
        forward(net, this.test.x[i], cache);
        if (argmax(cache.probs) === this.test.y[i]) job.right++;
        if (this.narrow) {
          forward(net, this.wideTest.x[i], cache);
          if (argmax(cache.probs) === this.wideTest.y[i]) job.rightWide++;
        }
      }
      job.pos = end;
      if (end < TEST_SIZE) return false;
      const acc = job.right / TEST_SIZE;
      this.accHistory.push({ step: this.step, acc, wide: this.narrow ? job.rightWide / TEST_SIZE : acc });
      if (acc >= 0.85 && this.reached85Ms === null) this.reached85Ms = this.trainMs;
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
   * Work for up to `budgetMs`. Queued scoring always finishes before the next training step,
   * so results depend only on the number of steps, never on how fast the computer is.
   */
  advance(budgetMs: number, training: boolean, lr: number): void {
    const start = performance.now();
    for (let guard = 0; guard < 10000; guard++) {
      if (this.jobs.length) {
        if (this.runJob(this.jobs[0], 24)) this.jobs.shift();
      } else if (training) this.trainStep(lr);
      else break;
      if (performance.now() - start >= budgetMs) break;
    }
  }

  /** Finish any queued scoring right now. */
  flush(): void {
    while (this.jobs.length) if (this.runJob(this.jobs[0], 100000)) this.jobs.shift();
  }

  accuracyOn(pile: Pile): number {
    let right = 0;
    for (let i = 0; i < pile.x.length; i++) {
      forward(this.net, pile.x[i], this.cache);
      if (argmax(this.cache.probs) === pile.y[i]) right++;
    }
    return right / pile.x.length;
  }

  /** Mark one card: what the brain guesses and how wrong it is. Used by the card browser. */
  mark(pile: Pile, i: number): { guess: number; loss: number } {
    forward(this.net, pile.x[i], this.cache);
    return { guess: argmax(this.cache.probs), loss: lossOf(this.cache, pile.y[i]) };
  }
}
