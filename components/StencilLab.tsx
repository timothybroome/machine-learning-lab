"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Brain as BrainIcon, ChevronRight, Layers, Pause, Play, RotateCcw, Snail, Star, Trash2, X } from "lucide-react";
import { BATCH, Lab, TEST_SIZE, TRAIN_SIZE, TopExample } from "@/lib/lab";
import { C1, Cache, F1, F2, HOT_SIZE, HotSpot, K1, createCache, backward, forward, hotSpot, previewNudge, zerosLike } from "@/lib/net";
import { RNG } from "@/lib/rng";
import { CLASS_NAMES, FULL_VARIETY, GRID, PIXELS, Variety, generateStar, stampSegment } from "@/lib/shapes";
import { drawChart, maxAbs, paintGrid, prepare, strokeHotSpot } from "@/lib/draw";
import { IDEAS, NUDGE_ZOOM, STAGES, TEXT, betText, stageText, sumText } from "@/lib/ideas";
import { ShapeIcon } from "./icons";
import BrainView from "./BrainView";
import CardBrowser from "./CardBrowser";

const PAD = 280;
const CELL = PAD / GRID;
const ROW_W = 152;
const ROW_H = 84;
const MINI_PX = 64;
const THUMB_PX = 31;
const TICK = 24;
const LR_MIN = 0.005;
const LR_MAX = 0.5;
const lrFromSlider = (s: number) => LR_MIN * Math.pow(LR_MAX / LR_MIN, s / 100);
const sliderFromLr = (lr: number) => (100 * Math.log(lr / LR_MIN)) / Math.log(LR_MAX / LR_MIN);

type Kind = "practice" | "test" | "drawn" | "star";
interface Card {
  x: Float64Array;
  label: number | null;
  kind: Kind;
}
/** Everything slow-mo worked out for its one card. Nothing here is written back to the brain. */
interface Slow {
  label: number;
  probs: number[];
  blameAnswer: number[];
  blame2: number[];
  blame1: number[];
  before: Float64Array;
  change: Float64Array; // the real change to the layer-1 knobs for this one card
  most: number;
}
interface Stats {
  step: number;
  cards: number;
  acc: number | null;
  wide: number | null;
  loss: number | null;
  probs: number[];
  blank: boolean;
  narrow: boolean;
}

/** A number on screen, with its one-line hover note. */
function N({ note, children, className }: { note: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`n ${className ?? ""}`} title={note}>
      {children}
    </span>
  );
}

const PANEL_IDEA: Record<string, number> = { A: 1, B: 7, C: 4, D: 3 };
const STORY_PANELS = ["A", "A", "D", "ABCD", "D", "B", "B"];

export default function StencilLab() {
  // ---- things that change every frame live in refs, not React state ----------------------
  const labRef = useRef<Lab | null>(null);
  const card = useRef<Card>({ x: new Float64Array(PIXELS), label: null, kind: "drawn" });
  const view = useRef<Cache | null>(null);
  const dirty = useRef(true);
  const seen = useRef({ version: -1, top: null as TopExample[][] | null, step: -1, accLen: -1 });
  const runningRef = useRef(false);
  const lrRef = useRef(0.1);
  const slowRef = useRef<Slow | null>(null);
  const stageRef = useRef(0);
  const lastStats = useRef(0);
  const lastFrame = useRef(0);

  const padCanvas = useRef<HTMLCanvasElement | null>(null);
  const rowCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const miniCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const topCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const strength = useRef<(HTMLSpanElement | null)[]>([]);
  const barFill = useRef<(HTMLSpanElement | null)[]>([]);
  const barText = useRef<(HTMLSpanElement | null)[]>([]);
  const lossCanvas = useRef<HTMLCanvasElement | null>(null);
  const accCanvas = useRef<HTMLCanvasElement | null>(null);
  const tickCanvas = useRef<HTMLCanvasElement | null>(null);
  const stripCanvas = useRef<HTMLCanvasElement | null>(null);

  // ---- React state: controls and slow-changing read-outs ---------------------------------
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [slider, setSlider] = useState(() => sliderFromLr(0.1));
  const [variety, setVariety] = useState<Variety>({ ...FULL_VARIETY });
  const [applied, setApplied] = useState<Variety>({ ...FULL_VARIETY });
  const [stats, setStats] = useState<Stats | null>(null);
  const [info, setInfo] = useState<{ label: number | null; kind: Kind }>({ label: null, kind: "drawn" });
  const [flipped, setFlipped] = useState(false);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState<Slow | null>(null);
  const [idea, setIdea] = useState(1);
  const [story, setStory] = useState<number | null>(null);
  const [did, setDid] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<"brain" | "cards" | null>(null);
  const [strip, setStrip] = useState<number[]>([0, 1, 2, 3, 4]);

  const lr = lrFromSlider(slider);
  lrRef.current = lr;
  runningRef.current = running;
  stageRef.current = stage;
  slowRef.current = slow;
  const mark = (k: string) => setDid((d) => (d[k] ? d : { ...d, [k]: true }));
  const needsReset = (Object.keys(variety) as (keyof Variety)[]).some((k) => variety[k] !== applied[k]);

  // ---- drawing everything ---------------------------------------------------------------
  const render = useCallback(() => {
    const lab = labRef.current;
    const cache = view.current;
    if (!lab || !cache) return;
    const net = lab.net;
    const x = card.current.x;
    const s = stageRef.current === 5 ? slowRef.current : null;

    const spots: HotSpot[] = [];
    let maxScore = 1e-9;
    for (let u = 0; u < F2; u++) {
      spots.push(hotSpot(cache, u));
      maxScore = Math.max(maxScore, spots[u].score);
    }

    // A. the card on the pad
    if (padCanvas.current) {
      const ctx = prepare(padCanvas.current, PAD, PAD);
      paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", 0, 0, PAD, PAD);
      ctx.strokeStyle = "rgba(31,42,68,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < GRID; i++) {
        ctx.moveTo(i * CELL + 0.5, 0);
        ctx.lineTo(i * CELL + 0.5, PAD);
        ctx.moveTo(0, i * CELL + 0.5);
        ctx.lineTo(PAD, i * CELL + 0.5);
      }
      ctx.stroke();
    }

    // B. each stencil and where it fired; in slow-mo stage 5: before + change = after
    const a1Max = maxAbs(cache.a1, 0, cache.a1.length) || 1;
    const changeMax = s ? maxAbs(s.change, 0, s.change.length) || 1 : 1;
    const grid = (ctx: CanvasRenderingContext2D, v: ArrayLike<number>, off: number, scale: number, px: number, py: number, size: number) => {
      paintGrid(ctx, v, off, K1, K1, scale, "heat", px, py, size, size);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < K1; i++) {
        const q = (i * size) / K1;
        ctx.moveTo(px + q, py);
        ctx.lineTo(px + q, py + size);
        ctx.moveTo(px, py + q);
        ctx.lineTo(px + size, py + q);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(31,42,68,0.25)";
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    };
    for (let f = 0; f < F1; f++) {
      const cv = rowCanvas.current[f];
      if (!cv) continue;
      const ctx = prepare(cv, ROW_W, ROW_H);
      ctx.clearRect(0, 0, ROW_W, ROW_H);
      ctx.fillStyle = "rgba(31,42,68,0.6)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (s) {
        const after = new Float64Array(25);
        for (let i = 0; i < 25; i++) after[i] = s.before[f * 25 + i] + s.change[f * 25 + i] * NUDGE_ZOOM;
        const m = Math.max(maxAbs(s.before, f * 25, 25), maxAbs(after, 0, 25)) || 1;
        grid(ctx, s.before, f * 25, 1 / m, 0, 8, 44);
        grid(ctx, s.change, f * 25, 1 / changeMax, 54, 8, 44);
        grid(ctx, after, 0, 1 / m, 108, 8, 44);
        ctx.font = "800 13px Nunito Variable, Nunito, sans-serif";
        ctx.fillText("+", 49, 30);
        ctx.fillText("=", 103, 30);
        ctx.font = "700 10px Nunito Variable, Nunito, sans-serif";
        ctx.fillText("before", 22, 64);
        ctx.fillText(`change ×${NUDGE_ZOOM}`, 76, 64);
        ctx.fillText("after", 130, 64);
      } else {
        grid(ctx, net.W1, f * 25, 1 / (maxAbs(net.W1, f * 25, 25) || 1), 0, 14, 56);
        ctx.font = "800 13px Nunito Variable, Nunito, sans-serif";
        ctx.fillText("→", 62, 42);
        paintGrid(ctx, cache.a1, f * C1 * C1, C1, C1, 1 / a1Max, "fire", 68, 0, 84, 84);
        ctx.strokeStyle = "rgba(31,42,68,0.2)";
        ctx.strokeRect(68.5, 0.5, 83, 83);
      }
    }

    // C. stencils of stencils: the patch of this card that excited each unit
    for (let u = 0; u < F2; u++) {
      const mc = miniCanvas.current[u];
      const h = spots[u];
      if (mc) {
        const ctx = prepare(mc, MINI_PX, MINI_PX);
        paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", 0, 0, MINI_PX, MINI_PX, h.score > 0 ? 1 : 0.4);
        if (h.score > 0) strokeHotSpot(ctx, h.x, h.y, HOT_SIZE, MINI_PX / GRID, 0, 0, 2);
      }
      const bar = strength.current[u];
      if (bar) bar.style.width = `${Math.round((h.score / maxScore) * 100)}%`;
    }

    // D. the judge shares out 100%
    for (let c = 0; c < 3; c++) {
      if (barFill.current[c]) barFill.current[c]!.style.width = `${cache.probs[c] * 100}%`;
      if (barText.current[c]) barText.current[c]!.textContent = `${Math.round(cache.probs[c] * 100)}%`;
    }
  }, []);

  const thumb = (ctx: CanvasRenderingContext2D, x: Float64Array, ox: number, oy: number, size: number) =>
    paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", ox, oy, size, size);

  const renderSlowParts = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    // favourites of each layer-2 unit
    const S = THUMB_PX * 2 + 2;
    for (let u = 0; u < F2; u++) {
      const cv = topCanvas.current[u];
      if (!cv) continue;
      const ctx = prepare(cv, S, S);
      ctx.clearRect(0, 0, S, S);
      for (let k = 0; k < 4; k++) {
        const ox = (k % 2) * (THUMB_PX + 2);
        const oy = Math.floor(k / 2) * (THUMB_PX + 2);
        const t = lab.top[u][k];
        if (!t) {
          ctx.fillStyle = "rgba(31,42,68,0.05)";
          ctx.fillRect(ox, oy, THUMB_PX, THUMB_PX);
          continue;
        }
        thumb(ctx, lab.train.x[t.index], ox, oy, THUMB_PX);
        strokeHotSpot(ctx, t.hx, t.hy, HOT_SIZE, THUMB_PX / GRID, ox, oy, 1.5);
      }
    }
    // charts
    const xMax = Math.max(200, Math.ceil((lab.step + 1) / 200) * 200);
    if (lossCanvas.current) {
      const w = lossCanvas.current.clientWidth;
      const h = lossCanvas.current.clientHeight;
      drawChart(
        prepare(lossCanvas.current, w, h),
        w,
        h,
        [
          { ys: lab.lossHistory, color: "#f27d16", width: 1, alpha: 0.22 },
          { ys: lab.lossSmooth, color: "#e2560d", width: 2.5, dots: true },
        ],
        { xMax, yMin: 0, yMax: 1.4, yTicks: [0, 0.5, 1], yFormat: (v) => v.toFixed(1), xLabel: "nudges", goal: { y: 1.1, label: "wild guess 1.1", color: "138,79,211" } },
      );
    }
    if (accCanvas.current) {
      const w = accCanvas.current.clientWidth;
      const h = accCanvas.current.clientHeight;
      const xs = lab.accHistory.map((a) => a.step);
      const series = [];
      if (lab.narrow) series.push({ ys: lab.accHistory.map((a) => a.wide * 100), xs, color: "#8a4fd3", width: 2, dash: [5, 4], dots: true });
      series.push({ ys: lab.accHistory.map((a) => a.acc * 100), xs, color: "#0f9d8a", width: 2.5, dots: true });
      drawChart(prepare(accCanvas.current, w, h), w, h, series, { xMax, yMin: 0, yMax: 100, yTicks: [0, 50, 100], yFormat: (v) => `${v}%`, xLabel: "nudges" });
    }
    // ticker: the 16 cards it just practised on, with ticks and crosses
    if (tickCanvas.current) {
      const W = BATCH * (TICK + 4) - 4;
      const ctx = prepare(tickCanvas.current, W, TICK + 14);
      ctx.clearRect(0, 0, W, TICK + 14);
      ctx.font = "900 12px Nunito Variable, Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let k = 0; k < BATCH; k++) {
        const item = lab.lastBatch[k];
        const ox = k * (TICK + 4);
        if (!item) {
          ctx.fillStyle = "rgba(31,42,68,0.06)";
          ctx.fillRect(ox, 0, TICK, TICK);
          continue;
        }
        thumb(ctx, lab.train.x[item.index], ox, 0, TICK);
        const ok = item.guess === item.label;
        ctx.fillStyle = ok ? "#0f9d8a" : "#e5484d";
        ctx.fillText(ok ? "✓" : "✗", ox + TICK / 2, TICK + 8);
      }
    }
  }, []);

  // the strip of practice cards in panel A, each with its label underneath
  useEffect(() => {
    const lab = labRef.current;
    const cv = stripCanvas.current;
    if (!lab || !cv) return;
    const ctx = prepare(cv, 5 * 56 - 6, 50);
    ctx.clearRect(0, 0, 5 * 56, 50);
    strip.forEach((index, k) => thumb(ctx, lab.train.x[index], k * 56, 0, 50));
  }, [strip, ready]);

  const putOnPad = useCallback((x: Float64Array, label: number | null, kind: Kind) => {
    card.current = { x, label, kind };
    setInfo({ label, kind });
    setFlipped(false);
    dirty.current = true;
  }, []);

  // ---- the animation loop: a little training, then redraw ------------------------------
  useEffect(() => {
    const lab = new Lab();
    labRef.current = lab;
    // every knob is inspectable: try `stencilLab.net.W1` in the browser console
    (window as unknown as { stencilLab: Lab }).stencilLab = lab;
    view.current = createCache(3);
    putOnPad(Float64Array.from(lab.train.x[0]), lab.train.y[0], "practice");
    setReady(true);

    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const cache = view.current!;
      const s = seen.current;
      if (runningRef.current) lab.trainMs += Math.min(100, now - lastFrame.current);
      lastFrame.current = now;
      if (runningRef.current || lab.busy) lab.advance(runningRef.current ? 11 : 8, runningRef.current, lrRef.current);

      if (lab.version !== s.version || dirty.current) {
        s.version = lab.version;
        dirty.current = false;
        forward(lab.net, card.current.x, cache);
        render();
      }
      if (lab.top !== s.top || lab.step !== s.step || lab.accHistory.length !== s.accLen) {
        s.top = lab.top;
        s.step = lab.step;
        s.accLen = lab.accHistory.length;
        renderSlowParts();
      }
      if (now - lastStats.current > 140) {
        lastStats.current = now;
        const acc = lab.latestAcc;
        let ink = 0;
        for (let i = 0; i < PIXELS; i++) ink += card.current.x[i];
        setStats({
          step: lab.step,
          cards: lab.cardsSeen,
          acc: acc ? acc.acc : null,
          wide: acc ? acc.wide : null,
          loss: lab.lossSmooth.length ? lab.lossSmooth[lab.lossSmooth.length - 1] : null,
          probs: Array.from(cache.probs),
          blank: ink < 4,
          narrow: lab.narrow,
        });
        if (lab.lastBatch.length && lab.step % 8 === 0) setStrip(lab.lastBatch.slice(0, 5).map((b) => b.index));
      }
    };
    raf = requestAnimationFrame(frame);
    const resize = () => {
      seen.current.step = -1;
      dirty.current = true;
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [render, renderSlowParts, putOnPad]);

  useEffect(() => {
    dirty.current = true;
    seen.current.step = -1;
  }, [stage, slow, modal]);

  // ---- actions --------------------------------------------------------------------------
  const stopSlow = useCallback(() => {
    setStage(0);
    setSlow(null);
  }, []);

  /** Slow-mo: work everything out for one card on a side copy of the sums. The brain itself is not touched. */
  const startSlow = useCallback(
    (x?: Float64Array, label?: number) => {
      const lab = labRef.current;
      const cache = view.current;
      if (!lab || !cache) return;
      setRunning(false);
      if (x === undefined || label === undefined) {
        const i = Math.floor(Math.random() * TRAIN_SIZE);
        x = lab.train.x[i];
        label = lab.train.y[i];
      }
      putOnPad(Float64Array.from(x), label, "practice");
      const g = zerosLike(lab.net);
      forward(lab.net, x, cache);
      backward(lab.net, cache, label, g); // only fills the side copy `g`
      const blame2 = Array.from({ length: F2 }, (_, u) => cache.dp2.subarray(u * 25, u * 25 + 25).reduce((a, v) => a + Math.abs(v), 0));
      const blame1 = Array.from({ length: F1 }, (_, f) => {
        let sum = 0;
        for (let j = f * 144; j < (f + 1) * 144; j++) if (cache.p1[j] > 0) sum += Math.abs(cache.dp1[j]);
        return sum;
      });
      const norm = (a: number[]) => a.map((v) => v / (Math.max(...a) || 1));
      const change = previewNudge(lab.net, g, lrRef.current, 1, "W1");
      let most = 0;
      let mostSum = -1;
      for (let f = 0; f < F1; f++) {
        const sum = change.subarray(f * 25, f * 25 + 25).reduce((a, v) => a + Math.abs(v), 0);
        if (sum > mostSum) [most, mostSum] = [f, sum];
      }
      setSlow({ label, probs: Array.from(cache.probs), blameAnswer: Array.from(cache.dlogits), blame2: norm(blame2), blame1: norm(blame1), before: Float64Array.from(lab.net.W1), change, most });
      setStage(1);
      setIdea(STAGES[0].idea);
      mark("slowmo");
    },
    [putOnPad],
  );

  const nextStage = () => {
    const n = stage + 1;
    setStage(n);
    setIdea(STAGES[n - 1].idea);
    mark(`stage${n}`);
  };

  const train = () => {
    stopSlow();
    setRunning(true);
    setIdea(7);
    mark("train");
  };

  const reset = () => {
    const lab = labRef.current;
    if (!lab) return;
    stopSlow();
    setRunning(false);
    lab.reset({ ...variety });
    setApplied({ ...variety });
    setStrip([0, 1, 2, 3, 4]);
    putOnPad(Float64Array.from(lab.train.x[0]), lab.train.y[0], "practice");
    if (variety.centredOnly) mark("centred");
  };

  const tryStar = () => {
    stopSlow();
    putOnPad(generateStar(new RNG((Math.random() * 2 ** 32) >>> 0)), null, "star");
    setIdea(3);
    mark("star");
  };

  // ---- drawing with mouse or finger -----------------------------------------------------
  const lastPoint = useRef<[number, number] | null>(null);
  const toGrid = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GRID, ((e.clientY - r.top) / r.height) * GRID];
  };
  const onPadDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (card.current.kind !== "drawn") {
      stopSlow();
      putOnPad(new Float64Array(PIXELS), null, "drawn");
    }
    const p = toGrid(e);
    lastPoint.current = p;
    stampSegment(card.current.x, p[0], p[1], p[0], p[1], 2);
    dirty.current = true;
  };
  const onPadMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!lastPoint.current) return;
    const p = toGrid(e);
    stampSegment(card.current.x, lastPoint.current[0], lastPoint.current[1], p[0], p[1], 2);
    lastPoint.current = p;
    dirty.current = true;
  };

  // ---- what to say and what to light up -------------------------------------------------
  const storyIdea = story !== null ? IDEAS[story] : null;
  const active = IDEAS[(stage ? STAGES[stage - 1].idea : storyIdea ? storyIdea.n : idea) - 1];
  const storyDone = story === null ? false : [did.flip, true, did.star, did.stage2, did.stage3, did.stage5, did.train && did.centred][story];
  const lit = stage ? STAGES[stage - 1].panels : story !== null ? STORY_PANELS[story] : "ABCD";
  const panelClass = (p: string) => `panel ${p.toLowerCase()}${lit.includes(p) ? (lit.length < 4 ? " spot" : "") : " dimmed"}`;
  const hover = (p: string) => () => !stage && story === null && setIdea(p === "D" && info.label !== null ? 5 : PANEL_IDEA[p]);
  const probs = stage && slow ? slow.probs : (stats?.probs ?? [1 / 3, 1 / 3, 1 / 3]);
  const guess = probs.indexOf(Math.max(...probs));
  const trained = (stats?.step ?? 0) > 0;
  const sum = info.label !== null ? sumText(probs[info.label], info.label) : null;
  const kindText = { practice: "A practice card", test: "A test card", drawn: "Your own drawing", star: "A star" }[info.kind];
  const lrWord = lr < 0.02 ? "tiny nudges: slow but steady" : lr < 0.2 ? "medium nudges" : "huge nudges: fast but wobbly";
  const lab = labRef.current;

  return (
    <div className={`lab stage-${stage}`}>
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden>
            <ShapeIcon cls={0} size={20} />
            <ShapeIcon cls={1} size={20} />
            <ShapeIcon cls={2} size={20} />
          </div>
          <div>
            <h1>Shape Stencil Lab</h1>
            <p>
              Watch a tiny network teach itself to tell triangles, squares and circles apart. A companion to <em>From Perceptrons to ChatGPT</em>.
            </p>
          </div>
        </div>
        <button
          className={`btn dark${story !== null ? " on" : ""}`}
          onClick={() => {
            stopSlow();
            setStory(story === null ? 0 : null);
          }}
        >
          <BookOpen size={18} /> {story === null ? "Story mode" : "Leave story"}
        </button>
      </header>

      <main className="panels">
        {/* ---------------- A. Cards ---------------- */}
        <section className={panelClass("A")} onPointerEnter={hover("A")}>
          <PanelHead letter="A" title="Cards" tech="input · 28 × 28 dots" />
          <div className={`flip${flipped ? " flipped" : ""}`}>
            <div className="face front">
              <canvas
                ref={padCanvas}
                className="pad"
                style={{ width: PAD, height: PAD }}
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={() => (lastPoint.current = null)}
                onPointerCancel={() => (lastPoint.current = null)}
                aria-label="The card on the pad. Draw here to make your own card."
              />
            </div>
            <div className="face back">
              {info.label !== null ? (
                <>
                  <ShapeIcon cls={info.label} size={90} />
                  <b>{CLASS_NAMES[info.label]}</b>
                  <small>the label on the back</small>
                </>
              ) : (
                <>
                  <b>?</b>
                  <small>{info.kind === "star" ? "Nobody labelled the star." : "Nothing written here: you drew this card."}</small>
                </>
              )}
            </div>
          </div>
          <div className="pad-tools">
            <span className="chip">
              {kindText}
              {info.label !== null && (
                <>
                  {" "}· label: <b>{CLASS_NAMES[info.label]}</b>
                </>
              )}
            </span>
            <button
              className={`btn small${story === 0 ? " pulse" : ""}`}
              onClick={() => {
                setFlipped(!flipped);
                setIdea(1);
                mark("flip");
              }}
            >
              <RotateCcw size={15} /> Flip the card
            </button>
            <button
              className="btn small"
              onClick={() => {
                stopSlow();
                putOnPad(new Float64Array(PIXELS), null, "drawn");
              }}
              title="Wipe the pad, then draw your own shape with mouse or finger"
            >
              <Trash2 size={15} /> Clear and draw
            </button>
          </div>

          <div className="mini-cards">
            <div className="sub">
              Practice cards <small>each with its label</small>
            </div>
            <canvas
              ref={stripCanvas}
              style={{ width: 5 * 56 - 6, height: 50 }}
              title="Click a card to put it on the pad"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const i = strip[Math.min(4, Math.floor((e.clientX - r.left) / 56))];
                if (lab) {
                  stopSlow();
                  putOnPad(Float64Array.from(lab.train.x[i]), lab.train.y[i], "practice");
                }
              }}
            />
            <div className="labels">{lab && strip.map((i, k) => <span key={k}>{CLASS_NAMES[lab.train.y[i]]}</span>)}</div>
          </div>

          <div className="versus" onPointerEnter={() => !stage && story === null && setIdea(2)}>
            <div>
              <b>Drawer</b>
              {TEXT.drawer.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div>
              <b>Learner</b>
              {TEXT.learner.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- B. Stencils ---------------- */}
        <section className={panelClass("B")} onPointerEnter={hover("B")}>
          <PanelHead letter="B" title="Stencils" tech="convolution filters · 8 grids of 5 × 5 knobs" />
          <div className="legend">
            <span>
              <i className="sw blue" /> wants empty
            </span>
            <span>
              <i className="sw orange" /> wants ink
            </span>
            {stage === 5 && <b className="zoom">change drawn ×{NUDGE_ZOOM} bigger</b>}
          </div>
          <div className="stencils">
            {Array.from({ length: F1 }, (_, f) => (
              <div
                key={f}
                className={`stencil${stage === 5 && slow?.most === f ? " most" : ""}`}
                style={stage === 4 && slow ? ({ "--blame": slow.blame1[f] } as React.CSSProperties) : undefined}
                title={
                  stage === 5
                    ? `Stencil ${f + 1}: its knobs before, the nudge (drawn ${NUDGE_ZOOM} times bigger), and after`
                    : `Stencil ${f + 1}: its 25 knobs, and where it fired on this card (points)`
                }
              >
                <span className="num">{f + 1}</span>
                <canvas ref={(el) => { rowCanvas.current[f] = el; }} style={{ width: ROW_W, height: ROW_H }} />
              </div>
            ))}
          </div>
          <p className="hint">
            Left: the stencil’s knobs <small>weights</small>. Right: where it fired on this card <small>points = activation</small>.
          </p>
        </section>

        {/* ---------------- C. Stencils of stencils ---------------- */}
        <section className={panelClass("C")} onPointerEnter={hover("C")}>
          <PanelHead letter="C" title="Stencils of stencils" tech="second convolution layer · 8 units" />
          <div className="legend">
            <span>
              <i className="sw box" /> the patch of this card that excited it
            </span>
          </div>
          <div className="units">
            {Array.from({ length: F2 }, (_, u) => (
              <div
                key={u}
                className="unit"
                style={stage === 4 && slow ? ({ "--blame": slow.blame2[u] } as React.CSSProperties) : undefined}
                title={`Unit ${u + 1}: left, this card with the patch that excited it; right, its 4 favourite practice cards; the bar is its points`}
              >
                <span className="num">{u + 1}</span>
                <span className="unit-pics">
                  <canvas ref={(el) => { miniCanvas.current[u] = el; }} style={{ width: MINI_PX, height: MINI_PX }} />
                  <canvas ref={(el) => { topCanvas.current[u] = el; }} style={{ width: THUMB_PX * 2 + 2, height: THUMB_PX * 2 + 2 }} />
                </span>
                <span className="meter">
                  <span ref={(el) => { strength.current[u] = el; }} />
                </span>
              </div>
            ))}
          </div>
          <p className="hint">Left: this card. Right: the unit’s 4 favourite practice cards. What do its favourites have in common?</p>
        </section>

        {/* ---------------- D. The judge ---------------- */}
        <section className={panelClass("D")} onPointerEnter={hover("D")}>
          <PanelHead letter="D" title="The judge" tech="fully connected layer + softmax" />
          <div className="bars" data-blank={stats?.blank ? "true" : "false"}>
            {[0, 1, 2].map((c) => (
              <div key={c} className={`bar-row${!stats?.blank && guess === c ? " win" : ""}${info.label === c ? " right" : ""}`}>
                <span className="bar-icon">
                  <ShapeIcon cls={c} size={22} />
                </span>
                <span className="bar-name">{CLASS_NAMES[c]}</span>
                <span className="bar-track">
                  <span className="bar-fill" ref={(el) => { barFill.current[c] = el; }} />
                </span>
                <span className="bar-pct n" title={`Its bet that this card is a ${CLASS_NAMES[c]}. The three bets always add up to 100%.`} ref={(el) => { barText.current[c] = el; }}>
                  0%
                </span>
                {stage === 4 && slow && (
                  <N className="blame-tag" note="Blame on this answer: its bet minus what the label says it should have been (100% for the right answer, 0% for the others).">
                    {slow.blameAnswer[c] > 0 ? `${Math.round(slow.blameAnswer[c] * 100)}% too much` : `${Math.round(-slow.blameAnswer[c] * 100)}% too little`}
                  </N>
                )}
              </div>
            ))}
          </div>
          <p className="boxes">Three answer boxes. The builder chose them; there are no others.</p>

          <div className="marking">
            {info.kind === "star" ? (
              <p>
                <Star size={16} /> {TEXT.star} It picked <b>{CLASS_NAMES[guess]}</b>.
              </p>
            ) : sum && info.label !== null ? (
              <>
                <div className="sub">
                  Label on the back: <b>{CLASS_NAMES[info.label]}</b>
                </div>
                <div className="sum">
                  It <N note={`Its bet on the right answer, ${CLASS_NAMES[info.label]}, for this card.`}>{sum.bet}</N>
                  <br />
                  How wrong <small>loss</small> ={" "}
                  <N note="How wrong on this card: minus the natural log (ln) of its bet on the right answer. Sure and right is 0; a wild guess is about 1.1.">
                    {sum.sum}
                  </N>
                </div>
              </>
            ) : (
              <p>{stats?.blank ? "Draw a shape on the pad, or pick a card." : TEXT.noLabel}</p>
            )}
            {!trained && !stats?.blank && <p className="note">No practice yet, so its bets are as good as rolling dice.</p>}
          </div>
        </section>
      </main>

      {/* ---------------- teaching bar ---------------- */}
      <section className="teach" aria-live="polite">
        <div className="teach-num" title={`Idea ${active.n} of 7`}>
          {active.n}
        </div>
        <div className="teach-text">
          <div className="teach-name" title="The app teaches seven ideas. This is the one on screen now.">
            Idea {active.n} of 7 · {active.name}
            {stage > 0 && (
              <>
                {" "}· Slow-mo stage <N note="Slow-mo has five stages: pick a card, guess, mark it, blame flows back, nudge.">{stage} of 5</N>: {STAGES[stage - 1].title}
              </>
            )}
          </div>
          <p className="teach-line">{active.sentence}</p>
          <p className="teach-sub">
            {stage > 0 && slow ? `${stageText(stage, slow.label, slow.probs, slow.most)}${stage === 5 ? ` ${TEXT.slowmoSafe}` : ""}` : storyIdea ? storyIdea.task : active.look}
            {storyDone && !stage && <b className="done"> Done ✓</b>}
          </p>
        </div>
        <div className="teach-nav">
          {stage > 0 ? (
            <>
              {stage < 5 ? (
                <button className="btn primary" onClick={nextStage}>
                  Next <ChevronRight size={18} />
                </button>
              ) : (
                <button className="btn primary" onClick={() => startSlow()}>
                  Another card <ChevronRight size={18} />
                </button>
              )}
              <button className="btn ghost" onClick={stopSlow} aria-label="Stop slow-mo">
                <X size={18} /> Stop
              </button>
            </>
          ) : story !== null ? (
            <>
              <button className="btn ghost" disabled={story === 0} onClick={() => setStory(story - 1)}>
                Back
              </button>
              <button className="btn primary" onClick={() => setStory(story < 6 ? story + 1 : null)}>
                {story < 6 ? "Next idea" : "Finish"} <ChevronRight size={18} />
              </button>
            </>
          ) : (
            <div className="idea-dots">
              {IDEAS.map((i) => (
                <button key={i.n} className={i.n === active.n ? "on" : ""} onClick={() => setIdea(i.n)} title={`Idea ${i.n}: ${i.name}`}>
                  {i.n}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------------- controls ---------------- */}
      <section className="strip">
        <div className="strip-row">
          <div className="buttons">
            <button className={`btn primary big${story === 3 && !stage ? " pulse" : ""}`} onClick={() => startSlow()} disabled={!ready} title="Follow one card through all five stages, one step at a time">
              <Snail size={20} /> Slow-mo
            </button>
            <button className={`btn big${story === 6 && !running ? " pulse" : ""}`} onClick={train} disabled={running || !ready}>
              <Play size={20} /> Train
            </button>
            <button className="btn big" onClick={() => setRunning(false)} disabled={!running}>
              <Pause size={20} /> Pause
            </button>
            <button className={`btn big${needsReset ? " pulse" : ""}`} onClick={reset} disabled={!ready} title="Start again from the same random speckle, with fresh cards">
              <RotateCcw size={20} /> {needsReset ? "Reset to apply" : "Reset"}
            </button>
            <button className={`btn big${story === 2 ? " pulse" : ""}`} onClick={tryStar} disabled={!ready}>
              <Star size={20} /> Try a star
            </button>
          </div>
          <div className="buttons">
            <button
              className="btn big"
              onClick={() => setModal("brain")}
              disabled={!ready}
            >
              <BrainIcon size={20} /> Look inside the brain
            </button>
            <button
              className="btn big"
              onClick={() => {
                setRunning(false);
                setModal("cards");
              }}
              disabled={!ready}
            >
              <Layers size={20} /> Browse the cards
            </button>
          </div>
        </div>

        <div className="fast">
          <span>{TEXT.fastTraining}</span>
          <canvas ref={tickCanvas} style={{ width: BATCH * (TICK + 4) - 4, height: TICK + 14 }} title="The 16 cards it just practised on: a tick if it guessed right, a cross if it guessed wrong" />
        </div>

        <div className="strip-row lower">
          <div className="settings">
            <label className="field">
              <span className="field-label">
                Nudge size <small>learning rate</small>{" "}
                <N note="How far each knob turns per nudge. Bigger learns faster but wobbles more.">
                  <b>{lr.toFixed(3)}</b>
                </N>
              </span>
              <input type="range" min={0} max={100} step={1} value={slider} onChange={(e) => setSlider(Number(e.target.value))} aria-label="Nudge size (learning rate)" />
              <span className="field-note">{lrWord}</span>
            </label>
            <div className="field">
              <span className="field-label">
                Variety of practice cards <small>applies on Reset</small>
              </span>
              <span className={`toggles${story === 6 && did.train && !did.centred ? " focus" : ""}`}>
                {(["centredOnly", "noRotation", "outlinesOnly"] as const).map((k) => (
                  <button key={k} type="button" role="switch" aria-checked={variety[k]} className={`toggle${variety[k] ? " on" : ""}`} onClick={() => setVariety({ ...variety, [k]: !variety[k] })}>
                    <span className="knob" />
                    {{ centredOnly: "centred only", noRotation: "no rotation", outlinesOnly: "outlines only" }[k]}
                  </button>
                ))}
              </span>
            </div>
            <div className="counters">
              <div className="counter">
                <span className="counter-label">cards practised</span>
                <N className="counter-value" note={`Cards it has practised on so far: ${stats?.step ?? 0} nudges of ${BATCH} cards each. The pile has ${TRAIN_SIZE.toLocaleString("en-GB")} cards, so it sees each one many times.`}>
                  {(stats?.cards ?? 0).toLocaleString("en-GB")}
                </N>
              </div>
              <div className={`counter${stats?.acc != null && stats.acc >= 0.85 ? " good" : ""}`}>
                <span className="counter-label">
                  test score <small>accuracy</small>
                </span>
                <N className="counter-value" note={`How many of the ${TEST_SIZE} test cards it gets right. It never practises on these.`}>
                  {stats?.acc != null ? `${Math.round(stats.acc * 100)}%` : "…"}
                </N>
              </div>
              {stats?.narrow && (
                <div className="counter purple">
                  <span className="counter-label">every-kind score</span>
                  <N className="counter-value" note={`Its score on ${TEST_SIZE} test cards of every kind: any place, any angle, filled or outlined. It only practised on the narrow kind.`}>
                    {stats.wide != null ? `${Math.round(stats.wide * 100)}%` : "…"}
                  </N>
                </div>
              )}
            </div>
          </div>

          <div className="charts">
            <figure>
              <figcaption>
                How wrong <small>loss</small>{" "}
                <N note="How wrong on the last 16 cards, smoothed. 0 is sure and right; about 1.1 is a wild guess between three answers.">
                  {stats?.loss != null ? stats.loss.toFixed(2) : ""}
                </N>
              </figcaption>
              <canvas ref={lossCanvas} title="How wrong after each nudge. The dashed line at 1.1 is a wild guess: one chance in three." />
            </figure>
            <figure>
              <figcaption>
                Test score <small>on {TEST_SIZE} cards it never practised</small>
                {stats?.narrow && (
                  <span className="key">
                    <i className="k teal" /> same kind <i className="k purple" /> every kind
                  </span>
                )}
              </figcaption>
              <canvas ref={accCanvas} title={`The share of the ${TEST_SIZE} test cards it gets right, checked every 25 nudges.`} />
            </figure>
          </div>
        </div>
      </section>

      {modal === "brain" && lab && (
        <BrainView
          lab={lab}
          onClose={() => setModal(null)}
          onLoaded={() => {
            setRunning(false);
            stopSlow();
            dirty.current = true;
          }}
        />
      )}
      {modal === "cards" && lab && (
        <CardBrowser
          lab={lab}
          onClose={() => setModal(null)}
          onPick={(x, label, kind, slowmo) => {
            setModal(null);
            stopSlow();
            if (slowmo) startSlow(x, label);
            else putOnPad(Float64Array.from(x), label, kind);
          }}
        />
      )}
      {!ready && <div className="loading">Drawing 1,800 cards…</div>}
    </div>
  );
}

function PanelHead({ letter, title, tech }: { letter: string; title: string; tech: string }) {
  return (
    <div className="panel-head">
      <span className="letter">{letter}</span>
      <div>
        <h2>{title}</h2>
        <small>{tech}</small>
      </div>
    </div>
  );
}
