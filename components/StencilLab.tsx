"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Dices,
  Eraser,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Shuffle,
  StepForward,
  Trash2,
  X,
} from "lucide-react";
import { BATCH, Lab, TEST_SIZE, TRAIN_SIZE, TopExample } from "@/lib/lab";
import {
  C1,
  Cache,
  F1,
  F2,
  GradCheckRow,
  HOT_SIZE,
  HotSpot,
  K1,
  createCache,
  forward,
  gradientCheck,
  hotSpot,
} from "@/lib/net";
import { RNG, seedFromText } from "@/lib/rng";
import { CLASS_NAMES, FULL_VARIETY, GRID, PIXELS, Variety, eraseSegment, generateShape, stampSegment } from "@/lib/shapes";
import { drawChart, maxAbs, paintGrid, prepare, strokeHotSpot } from "@/lib/draw";
import { ShapeIcon } from "./icons";

const PAD = 280;
const CELL = PAD / GRID;
const STENCIL_PX = 56;
const MAP_PX = 84;
const MINI_PX = 64;
const THUMB_PX = 31;
const BATCH_T = 30;
const BATCH_GAP = 5;
const BATCH_COLS = 8;
const DEFAULT_LR = 0.1;
const LR_MIN = 0.005;
const LR_MAX = 0.5;

const lrFromSlider = (s: number) => LR_MIN * Math.pow(LR_MAX / LR_MIN, s / 100);
const sliderFromLr = (lr: number) => (100 * Math.log(lr / LR_MIN)) / Math.log(LR_MAX / LR_MIN);

interface Stats {
  step: number;
  examples: number;
  acc: number | null;
  wide: number | null;
  loss: number | null;
  ms: number;
  reachedMs: number | null;
  guess: number;
  confidence: number;
  blank: boolean;
  narrow: boolean;
  nClasses: number;
}

type Pop = { kind: "stencil" | "unit"; index: number; pinned: boolean; left: number; top: number };

type Zone = "A" | "B" | "C" | "D" | "strip";

const STORY: { text: string; zones: Zone[]; focus?: "train" | "variety"; tip: string }[] = [
  {
    text: "These 8 stencils are random speckle. Nobody has told them what to look for.",
    zones: ["B"],
    tip: "Each stencil is a 5 by 5 grid of knobs. Orange knobs like ink, blue knobs like empty space.",
  },
  {
    text: "Press Train. Each wrong answer nudges every stencil a tiny bit.",
    zones: ["strip", "B"],
    focus: "train",
    tip: "Watch “how wrong” fall and the test score climb while the stencils shimmer.",
  },
  {
    text: "Look: some stencils are turning into lines. Lines turned out to be useful.",
    zones: ["B"],
    tip: "Nobody drew those stripes. They grew out of practice on 1,500 labelled shapes.",
  },
  {
    text: "Draw a triangle. See which stencils light up along its sides?",
    zones: ["A", "B"],
    tip: "Hover over a stencil to see exactly where it fires on your drawing.",
  },
  {
    text: "Now turn on “centred only” and Reset. What happens when it only ever sees one kind of shape?",
    zones: ["strip", "A"],
    focus: "variety",
    tip: "Train again, then draw a shape in a corner of the pad. The purple line shows the score on shapes it never practised.",
  },
];

function formatTime(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

export default function StencilLab() {
  // ---- things that change every frame live in refs, not React state ----------------------
  const labRef = useRef<Lab | null>(null);
  const drawing = useRef<Float64Array>(new Float64Array(PIXELS));
  const view = useRef<Cache | null>(null);
  const dirty = useRef(true);
  const seen = useRef({ version: -1, top: null as TopExample[][] | null, step: -1, accLen: -1, batchStep: -2 });
  const runningRef = useRef(false);
  const lrRef = useRef(DEFAULT_LR);
  const popRef = useRef<Pop | null>(null);
  const hoverUnit = useRef<number | null>(null);
  const padHover = useRef<[number, number] | null>(null);
  const slideText = useRef<HTMLSpanElement | null>(null);
  const lastStats = useRef(0);
  const lastFrame = useRef(0);
  const celebrated = useRef(false);

  const padCanvas = useRef<HTMLCanvasElement | null>(null);
  const stencilCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const mapCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const miniCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const topCanvas = useRef<(HTMLCanvasElement | null)[]>([]);
  const strengthBar = useRef<(HTMLDivElement | null)[]>([]);
  const unitCard = useRef<(HTMLButtonElement | null)[]>([]);
  const barFill = useRef<(HTMLDivElement | null)[]>([]);
  const barText = useRef<(HTMLSpanElement | null)[]>([]);
  const barRow = useRef<(HTMLDivElement | null)[]>([]);
  const lossCanvas = useRef<HTMLCanvasElement | null>(null);
  const accCanvas = useRef<HTMLCanvasElement | null>(null);
  const batchCanvas = useRef<HTMLCanvasElement | null>(null);
  const popStencil = useRef<HTMLCanvasElement | null>(null);
  const popMap = useRef<HTMLCanvasElement | null>(null);
  const popUnit = useRef<HTMLCanvasElement | null>(null);
  const popTops = useRef<HTMLCanvasElement | null>(null);

  // ---- React state: controls and slow-changing read-outs ---------------------------------
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [slider, setSlider] = useState(() => sliderFromLr(DEFAULT_LR));
  const [seedText, setSeedText] = useState("7");
  const [variety, setVariety] = useState<Variety>({ ...FULL_VARIETY });
  const [lineClass, setLineClass] = useState(false);
  const [applied, setApplied] = useState({ seed: "7", variety: { ...FULL_VARIETY }, lineClass: false });
  const [stats, setStats] = useState<Stats | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [erasing, setErasing] = useState(false);
  const [story, setStory] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mathRows, setMathRows] = useState<GradCheckRow[] | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [report, setReport] = useState<number[] | null>(null);

  const lr = lrFromSlider(slider);
  lrRef.current = lr;
  runningRef.current = running;
  popRef.current = pop;

  const needsReset =
    seedText.trim() !== applied.seed ||
    lineClass !== applied.lineClass ||
    variety.centredOnly !== applied.variety.centredOnly ||
    variety.noRotation !== applied.variety.noRotation ||
    variety.outlinesOnly !== applied.variety.outlinesOnly;

  // ---- drawing everything ---------------------------------------------------------------
  const render = useCallback(() => {
    const lab = labRef.current;
    const cache = view.current;
    if (!lab || !cache) return;
    const net = lab.net;
    const x = drawing.current;
    const p = popRef.current;

    // layer-2 hot spots for the current drawing
    const spots: HotSpot[] = [];
    let maxScore = 1e-9;
    for (let u = 0; u < F2; u++) {
      const h = hotSpot(cache, u);
      spots.push(h);
      if (h.score > maxScore) maxScore = h.score;
    }

    // A. drawing pad
    if (padCanvas.current) {
      const ctx = prepare(padCanvas.current, PAD, PAD);
      paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", 0, 0, PAD, PAD);
      // where the hovered stencil fired, painted over the drawing
      if (p && p.kind === "stencil") {
        const base = p.index * C1 * C1;
        const m = maxAbs(cache.a1, base, C1 * C1) || 1;
        ctx.fillStyle = "rgb(242,125,22)";
        for (let i = 0; i < C1 * C1; i++) {
          const v = cache.a1[base + i] / m;
          if (v < 0.06) continue;
          ctx.globalAlpha = Math.min(0.9, Math.sqrt(v));
          ctx.fillRect(((i % C1) + 2) * CELL, (Math.floor(i / C1) + 2) * CELL, CELL, CELL);
        }
        ctx.globalAlpha = 1;
      }
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
      // slide the pinned stencil by hand: show its 5x5 window under the pointer and the points it scores there
      if (p && p.kind === "stencil" && p.pinned) {
        const hover = padHover.current;
        let message = "Move your pointer over the pad to slide this stencil by hand.";
        if (hover) {
          const wx = Math.max(0, Math.min(C1 - 1, Math.floor(hover[0]) - 2));
          const wy = Math.max(0, Math.min(C1 - 1, Math.floor(hover[1]) - 2));
          const f = p.index;
          const m = maxAbs(net.W1, f * 25, 25) || 1;
          let points = net.b1[f];
          for (let ky = 0; ky < K1; ky++)
            for (let kx = 0; kx < K1; kx++) {
              const w = net.W1[f * 25 + ky * K1 + kx];
              points += w * x[(wy + ky) * GRID + wx + kx];
              const a = Math.abs(w) / m;
              ctx.fillStyle = w >= 0 ? `rgba(242,125,22,${0.55 * a})` : `rgba(38,104,222,${0.55 * a})`;
              ctx.fillRect((wx + kx) * CELL, (wy + ky) * CELL, CELL, CELL);
            }
          ctx.strokeStyle = "#1f2a44";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(wx * CELL, wy * CELL, K1 * CELL, K1 * CELL);
          message =
            points > 0
              ? `Here it scores ${points.toFixed(2)} points.`
              : `Here it scores ${points.toFixed(2)}, which is squashed to 0 points.`;
        }
        if (slideText.current) slideText.current.textContent = message;
      }
      const hu = p && p.kind === "unit" ? p.index : hoverUnit.current;
      if (hu !== null && spots[hu].score > 0) strokeHotSpot(ctx, spots[hu].x, spots[hu].y, HOT_SIZE, CELL, 0, 0, 3);
    }

    // B. layer-1 stencils and where each one fired
    const a1Max = maxAbs(cache.a1, 0, cache.a1.length) || 1;
    for (let f = 0; f < F1; f++) {
      const sc = stencilCanvas.current[f];
      if (sc) {
        const ctx = prepare(sc, STENCIL_PX, STENCIL_PX);
        const m = maxAbs(net.W1, f * 25, 25) || 1;
        paintGrid(ctx, net.W1, f * 25, K1, K1, 1 / m, "heat", 0, 0, STENCIL_PX, STENCIL_PX);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < K1; i++) {
          const q = (i * STENCIL_PX) / K1;
          ctx.moveTo(q, 0);
          ctx.lineTo(q, STENCIL_PX);
          ctx.moveTo(0, q);
          ctx.lineTo(STENCIL_PX, q);
        }
        ctx.stroke();
      }
      const mc = mapCanvas.current[f];
      if (mc) {
        const ctx = prepare(mc, MAP_PX, MAP_PX);
        paintGrid(ctx, cache.a1, f * C1 * C1, C1, C1, 1 / a1Max, "fire", 0, 0, MAP_PX, MAP_PX);
      }
    }

    // C. layer-2 cards: where each unit fired on the current drawing
    for (let u = 0; u < F2; u++) {
      const mc = miniCanvas.current[u];
      const h = spots[u];
      if (mc) {
        const ctx = prepare(mc, MINI_PX, MINI_PX);
        paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", 0, 0, MINI_PX, MINI_PX, h.score > 0 ? 1 : 0.45);
        if (h.score > 0) strokeHotSpot(ctx, h.x, h.y, HOT_SIZE, MINI_PX / GRID, 0, 0, 2);
      }
      const bar = strengthBar.current[u];
      if (bar) bar.style.width = `${Math.round((h.score / maxScore) * 100)}%`;
      const card = unitCard.current[u];
      if (card) card.dataset.quiet = h.score > 0 ? "false" : "true";
    }

    // D. the answer
    for (let c = 0; c < lab.nClasses; c++) {
      const fill = barFill.current[c];
      const text = barText.current[c];
      const pct = cache.probs[c] * 100;
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `${Math.round(pct)}%`;
    }

    // enlarged views
    if (p && p.kind === "stencil") {
      const f = p.index;
      if (popStencil.current) {
        const S = 200;
        const ctx = prepare(popStencil.current, S, S);
        const m = maxAbs(net.W1, f * 25, 25) || 1;
        paintGrid(ctx, net.W1, f * 25, K1, K1, 1 / m, "heat", 0, 0, S, S);
        const q = S / K1;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 1; i < K1; i++) {
          ctx.moveTo(i * q, 0);
          ctx.lineTo(i * q, S);
          ctx.moveTo(0, i * q);
          ctx.lineTo(S, i * q);
        }
        ctx.stroke();
        if (p.pinned) {
          ctx.font = "700 12.5px Nunito Variable, Nunito, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (let i = 0; i < 25; i++) {
            const w = net.W1[f * 25 + i];
            ctx.fillStyle = Math.abs(w) / m > 0.6 ? "#fff" : "rgba(31,42,68,0.9)";
            ctx.fillText(w.toFixed(2), (i % 5) * q + q / 2, Math.floor(i / 5) * q + q / 2 + 1);
          }
        }
      }
      if (popMap.current) {
        const S = 196;
        const c = S / GRID;
        const ctx = prepare(popMap.current, S, S);
        paintGrid(ctx, x, 0, GRID, GRID, 0.28, "ink", 0, 0, S, S);
        const base = f * C1 * C1;
        const m = maxAbs(cache.a1, base, C1 * C1) || 1;
        ctx.fillStyle = "rgb(242,125,22)";
        for (let i = 0; i < C1 * C1; i++) {
          const v = cache.a1[base + i] / m;
          if (v < 0.04) continue;
          ctx.globalAlpha = Math.min(0.95, Math.sqrt(v));
          ctx.fillRect(((i % C1) + 2) * c, (Math.floor(i / C1) + 2) * c, c, c);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (p && p.kind === "unit") {
      const u = p.index;
      if (popUnit.current) {
        const S = 196;
        const ctx = prepare(popUnit.current, S, S);
        paintGrid(ctx, x, 0, GRID, GRID, 1, "ink", 0, 0, S, S);
        if (spots[u].score > 0) strokeHotSpot(ctx, spots[u].x, spots[u].y, HOT_SIZE, S / GRID, 0, 0, 3);
      }
      if (popTops.current) {
        const T = 84;
        const gap = 8;
        const ctx = prepare(popTops.current, T * 4 + gap * 3, T);
        ctx.clearRect(0, 0, T * 4 + gap * 3, T);
        lab.top[u].forEach((t, k) => {
          const ox = k * (T + gap);
          paintGrid(ctx, lab.train.x[t.index], 0, GRID, GRID, 1, "ink", ox, 0, T, T);
          strokeHotSpot(ctx, t.hx, t.hy, HOT_SIZE, T / GRID, ox, 0, 2);
        });
      }
    }
  }, []);

  const renderTops = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    const gap = 2;
    const S = THUMB_PX * 2 + gap;
    for (let u = 0; u < F2; u++) {
      const cv = topCanvas.current[u];
      if (!cv) continue;
      const ctx = prepare(cv, S, S);
      ctx.clearRect(0, 0, S, S);
      for (let k = 0; k < 4; k++) {
        const ox = (k % 2) * (THUMB_PX + gap);
        const oy = Math.floor(k / 2) * (THUMB_PX + gap);
        const t = lab.top[u][k];
        if (!t) {
          ctx.fillStyle = "rgba(31,42,68,0.05)";
          ctx.fillRect(ox, oy, THUMB_PX, THUMB_PX);
          continue;
        }
        paintGrid(ctx, lab.train.x[t.index], 0, GRID, GRID, 1, "ink", ox, oy, THUMB_PX, THUMB_PX);
        strokeHotSpot(ctx, t.hx, t.hy, HOT_SIZE, THUMB_PX / GRID, ox, oy, 1.5);
      }
    }
  }, []);

  const renderCharts = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    const xMax = Math.max(200, Math.ceil((lab.step + 1) / 200) * 200);
    if (lossCanvas.current) {
      const w = lossCanvas.current.clientWidth;
      const h = lossCanvas.current.clientHeight;
      const ctx = prepare(lossCanvas.current, w, h);
      const top = lab.nClasses === 4 ? 1.6 : 1.4;
      drawChart(
        ctx,
        w,
        h,
        [
          { ys: lab.lossHistory, color: "#f27d16", width: 1, alpha: 0.22 },
          { ys: lab.lossSmooth, color: "#e2560d", width: 2.5, dots: true },
        ],
        { xMax, yMin: 0, yMax: top, yTicks: [0, 0.5, 1], yFormat: (v) => v.toFixed(1), xLabel: "steps" },
      );
    }
    if (accCanvas.current) {
      const w = accCanvas.current.clientWidth;
      const h = accCanvas.current.clientHeight;
      const ctx = prepare(accCanvas.current, w, h);
      const xs = lab.accHistory.map((a) => a.step);
      const series = [];
      if (lab.narrow)
        series.push({ ys: lab.accHistory.map((a) => a.wide * 100), xs, color: "#8a4fd3", width: 2, dash: [5, 4], dots: true });
      series.push({ ys: lab.accHistory.map((a) => a.acc * 100), xs, color: "#0f9d8a", width: 2.5, dots: true });
      drawChart(ctx, w, h, series, {
        xMax,
        yMin: 0,
        yMax: 100,
        yTicks: [0, 50, 100],
        yFormat: (v) => `${v}%`,
        goal: { y: 85, label: "goal 85%" },
        xLabel: "steps",
      });
    }
  }, []);

  const renderBatch = useCallback(() => {
    const lab = labRef.current;
    const cv = batchCanvas.current;
    if (!lab || !cv) return;
    const T = BATCH_T;
    const gap = BATCH_GAP;
    const cols = BATCH_COLS;
    const W = cols * T + (cols - 1) * gap;
    const H = 2 * (T + 6) + gap;
    const ctx = prepare(cv, W, H);
    ctx.clearRect(0, 0, W, H);
    for (let k = 0; k < BATCH; k++) {
      const item = lab.lastBatch[k];
      const index = item ? item.index : k;
      const ox = (k % cols) * (T + gap);
      const oy = Math.floor(k / cols) * (T + 6 + gap);
      paintGrid(ctx, lab.train.x[index], 0, GRID, GRID, 1, "ink", ox, oy, T, T);
      if (item) {
        ctx.fillStyle = item.guess === item.label ? "#0f9d8a" : "#e5484d";
        ctx.fillRect(ox, oy + T + 2, T, 3);
      }
    }
  }, []);

  // ---- the animation loop: a little training, then redraw ------------------------------
  useEffect(() => {
    const lab = new Lab({ seed: seedFromText("7"), variety: { ...FULL_VARIETY }, lineClass: false });
    labRef.current = lab;
    // every knob is inspectable: try `stencilLab.net.W1` in the browser console
    (window as unknown as { stencilLab: Lab }).stencilLab = lab;
    view.current = createCache(lab.nClasses);
    drawing.current = generateShape(new RNG(4), 0, { centredOnly: true, noRotation: true, outlinesOnly: true }).map((v) =>
      v > 0.2 ? v : 0,
    );
    setReady(true);

    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const L = labRef.current;
      const cache = view.current;
      if (!L || !cache) return;
      const s = seen.current;
      // practice time is measured by the clock on the wall, the way a learner would time it
      if (runningRef.current) L.trainMs += Math.min(100, now - lastFrame.current);
      lastFrame.current = now;
      if (runningRef.current || L.busy) L.advance(runningRef.current ? 11 : 8, runningRef.current, lrRef.current);

      if (L.version !== s.version || dirty.current) {
        s.version = L.version;
        dirty.current = false;
        forward(L.net, drawing.current, cache);
        render();
      }
      if (L.top !== s.top) {
        s.top = L.top;
        renderTops();
        dirty.current = true; // the enlarged view may be showing these
      }
      if (L.step !== s.step || L.accHistory.length !== s.accLen) {
        s.step = L.step;
        if (s.accLen !== L.accHistory.length) setReport(Array.from(L.confusion));
        s.accLen = L.accHistory.length;
        renderCharts();
        renderBatch();
      }
      if (now - lastStats.current > 140) {
        lastStats.current = now;
        const acc = L.latestAcc;
        let ink = 0;
        for (let i = 0; i < PIXELS; i++) ink += drawing.current[i];
        let guess = 0;
        for (let c = 1; c < L.nClasses; c++) if (cache.probs[c] > cache.probs[guess]) guess = c;
        setStats({
          step: L.step,
          examples: L.examplesSeen,
          acc: acc ? acc.acc : null,
          wide: acc ? acc.wide : null,
          loss: L.lossSmooth.length ? L.lossSmooth[L.lossSmooth.length - 1] : null,
          ms: L.trainMs,
          reachedMs: L.reached85Ms,
          guess,
          confidence: cache.probs[guess],
          blank: ink < 4,
          narrow: L.narrow,
          nClasses: L.nClasses,
        });
        if (L.reached85Ms !== null && !celebrated.current) {
          celebrated.current = true;
          setToast(`Passed 85% after ${formatTime(L.reached85Ms)} of practice!`);
          window.setTimeout(() => setToast(null), 5000);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [render, renderTops, renderCharts, renderBatch]);

  // redraw whenever something React-driven changes what the canvases should show
  useEffect(() => {
    dirty.current = true;
    seen.current.top = null;
    seen.current.step = -1;
  }, [pop, ready, resetCount, stats?.nClasses]);

  // ---- actions --------------------------------------------------------------------------
  const doReset = useCallback(
    (seedOverride?: string) => {
      const lab = labRef.current;
      if (!lab) return;
      const seed = (seedOverride ?? seedText).trim() || "7";
      setRunning(false);
      lab.reset({ seed: seedFromText(seed), variety: { ...variety }, lineClass });
      view.current = createCache(lab.nClasses);
      celebrated.current = false;
      setSeedText(seed);
      setApplied({ seed, variety: { ...variety }, lineClass });
      setMathRows(null);
      setToast(null);
      setResetCount((n) => n + 1);
      dirty.current = true;
    },
    [seedText, variety, lineClass],
  );

  const doStep = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    setRunning(false);
    lab.flush();
    lab.trainStep(lrRef.current);
  }, []);

  const randomShape = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    const rng = new RNG((Math.random() * 2 ** 32) >>> 0);
    drawing.current = generateShape(rng, rng.int(lab.nClasses), FULL_VARIETY);
    dirty.current = true;
  }, []);

  const clearPad = useCallback(() => {
    drawing.current = new Float64Array(PIXELS);
    dirty.current = true;
  }, []);

  const pickBatchShape = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const lab = labRef.current;
    if (!lab) return;
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.min(BATCH_COLS - 1, Math.floor((e.clientX - r.left) / (BATCH_T + BATCH_GAP)));
    const row = Math.min(1, Math.floor((e.clientY - r.top) / (BATCH_T + 6 + BATCH_GAP)));
    const k = row * BATCH_COLS + col;
    const index = lab.lastBatch[k] ? lab.lastBatch[k].index : k;
    drawing.current = Float64Array.from(lab.train.x[index]);
    dirty.current = true;
  }, []);

  const runMathCheck = useCallback(() => {
    const lab = labRef.current;
    if (!lab) return;
    const rng = new RNG(lab.step + 1);
    const i = rng.int(TRAIN_SIZE);
    setMathRows(gradientCheck(lab.net, lab.train.x[i], lab.train.y[i], rng, 2));
  }, []);

  // ---- drawing with mouse or finger -----------------------------------------------------
  const lastPoint = useRef<[number, number] | null>(null);
  const toGrid = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GRID, ((e.clientY - r.top) / r.height) * GRID];
  };
  const stroke = (a: [number, number], b: [number, number]) => {
    if (erasing) eraseSegment(drawing.current, a[0], a[1], b[0], b[1], 4.5);
    else stampSegment(drawing.current, a[0], a[1], b[0], b[1], 2);
    dirty.current = true;
  };
  const onPadDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toGrid(e);
    lastPoint.current = p;
    stroke(p, p);
  };
  const onPadMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toGrid(e);
    if (e.pointerType === "mouse") {
      padHover.current = p;
      if (popRef.current?.pinned) dirty.current = true;
    }
    if (!lastPoint.current) return;
    stroke(lastPoint.current, p);
    lastPoint.current = p;
  };
  const onPadUp = () => {
    lastPoint.current = null;
  };

  // ---- hover to enlarge, click to pin ---------------------------------------------------
  const place = (el: HTMLElement, kind: Pop["kind"]): { left: number; top: number } => {
    const r = el.getBoundingClientRect();
    const w = kind === "stencil" ? 452 : 400;
    const h = kind === "stencil" ? 400 : 400;
    let left = r.right + 14;
    if (left + w > window.innerWidth - 8) left = r.left - w - 14;
    if (left < 8) left = Math.max(8, (window.innerWidth - w) / 2);
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
    return { left, top };
  };
  const hoverIn = (kind: Pop["kind"], index: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || popRef.current?.pinned) return;
    setPop({ kind, index, pinned: false, ...place(e.currentTarget, kind) });
  };
  const hoverOut = () => {
    if (popRef.current && !popRef.current.pinned) setPop(null);
  };
  const togglePin = (kind: Pop["kind"], index: number) => (e: React.MouseEvent<HTMLElement>) => {
    const cur = popRef.current;
    if (cur && cur.pinned && cur.kind === kind && cur.index === index) setPop(null);
    else setPop({ kind, index, pinned: true, ...place(e.currentTarget, kind) });
  };
  useEffect(() => {
    if (!pop?.pinned) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-pop], [data-pop-anchor]")) setPop(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPop(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [pop?.pinned]);

  // space bar starts and pauses training; resizing the window redraws the charts
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== "Space" || t.closest("input, button, summary, [role=switch]")) return;
      e.preventDefault();
      setRunning((r) => !r);
    };
    const resize = () => {
      seen.current.step = -1;
      dirty.current = true;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ---- story mode -----------------------------------------------------------------------
  const storyStep = story !== null ? STORY[story] : null;
  const zoneClass = (z: Zone) => (storyStep ? (storyStep.zones.includes(z) ? " spot" : " dimmed") : "");
  const nClasses = stats?.nClasses ?? 3;
  const classList = useMemo(() => Array.from({ length: nClasses }, (_, i) => i), [nClasses]);
  const trained = (stats?.step ?? 0) > 0;
  const lab = labRef.current;

  let verdict = "Draw a shape!";
  let verdictNote = "Use your mouse or finger on the pad.";
  if (stats && !stats.blank) {
    const name = CLASS_NAMES[stats.guess];
    const Name = name[0].toUpperCase() + name.slice(1);
    if (!trained) {
      verdict = `Wild guess: ${name}`;
      verdictNote = "No practice yet, so this is like rolling dice.";
    } else if (stats.confidence > 0.9) {
      verdict = `${Name}!`;
      verdictNote = "It is very sure.";
    } else if (stats.confidence > 0.6) {
      verdict = `Probably a ${name}`;
      verdictNote = "Fairly sure, not certain.";
    } else {
      verdict = `Maybe a ${name}?`;
      verdictNote = "It can’t really decide.";
    }
  }

  const lrWord = lr < 0.02 ? "tiny nudges: slow but steady" : lr < 0.2 ? "medium nudges" : "huge nudges: fast but wobbly";

  return (
    <div className="lab" data-story={story !== null ? "on" : "off"}>
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
              Watch a tiny brain teach itself to tell shapes apart. A companion to{" "}
              <em>From Perceptrons to ChatGPT</em>.
            </p>
          </div>
        </div>
        <button className={`btn story-btn${story !== null ? " on" : ""}`} onClick={() => setStory(story === null ? 0 : null)}>
          <BookOpen size={18} /> {story === null ? "Story mode" : "Leave story"}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {storyStep && story !== null && (
          <motion.section
            className="story"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            aria-live="polite"
          >
            <div className="story-inner">
              <div className="story-num">{story + 1}</div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={story}
                  className="story-text"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                >
                  <p className="story-line">{storyStep.text}</p>
                  <p className="story-tip">{storyStep.tip}</p>
                </motion.div>
              </AnimatePresence>
              <div className="story-nav">
                <div className="dots" aria-hidden>
                  {STORY.map((_, i) => (
                    <span key={i} className={i === story ? "on" : ""} />
                  ))}
                </div>
                <button className="btn ghost" disabled={story === 0} onClick={() => setStory(story - 1)}>
                  <ChevronLeft size={18} /> Back
                </button>
                {story < STORY.length - 1 ? (
                  <button className="btn primary" onClick={() => setStory(story + 1)}>
                    Next <ChevronRight size={18} />
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => setStory(null)}>
                    Done <Check size={18} />
                  </button>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <main className="panels">
        {/* ---------------- A ---------------- */}
        <section className={`panel a${zoneClass("A")}`}>
          <PanelHead letter="A" title="Drawing pad" tech="input · 28 × 28 pixels" />
          <div className="pad-wrap">
            <canvas
              ref={padCanvas}
              className={`pad${erasing ? " erasing" : ""}`}
              style={{ width: PAD, height: PAD }}
              onPointerDown={onPadDown}
              onPointerMove={onPadMove}
              onPointerUp={onPadUp}
              onPointerCancel={onPadUp}
              onPointerLeave={() => {
                padHover.current = null;
                dirty.current = true;
              }}
              aria-label="Drawing pad: draw a shape here"
            />
          </div>
          <div className="pad-tools">
            <button className={`btn small${!erasing ? " on" : ""}`} onClick={() => setErasing(false)} title="Draw">
              <Pencil size={16} /> Draw
            </button>
            <button className={`btn small${erasing ? " on" : ""}`} onClick={() => setErasing(true)} title="Rub out">
              <Eraser size={16} /> Rub out
            </button>
            <button className="btn small" onClick={clearPad}>
              <Trash2 size={16} /> Clear
            </button>
            <button className="btn small" onClick={randomShape}>
              <Shuffle size={16} /> Random shape
            </button>
          </div>
          <p className="hint pad-hint">
            Draw a triangle, a square{nClasses === 4 ? ", a circle or a line" : " or a circle"}. Everything to the right
            updates as you draw.
          </p>
          <figure className="batch">
            <figcaption>
              {trained ? (
                <>
                  Just practised on <small>mini-batch of {BATCH}</small>
                </>
              ) : (
                <>
                  It will practise on <small>{TRAIN_SIZE.toLocaleString("en-GB")} shapes like these</small>
                </>
              )}
            </figcaption>
            <canvas
              ref={batchCanvas}
              style={{ width: BATCH_COLS * (BATCH_T + BATCH_GAP) - BATCH_GAP, height: 2 * (BATCH_T + 6) + BATCH_GAP }}
              onClick={pickBatchShape}
              title="Click a shape to put it on the pad"
            />
            <span className="key">
              {trained ? (
                <>
                  <i className="k teal" /> guessed right <i className="k red" /> guessed wrong
                </>
              ) : (
                <>Click one to put it on the pad.</>
              )}
            </span>
          </figure>
        </section>

        {/* ---------------- B ---------------- */}
        <section className={`panel b${zoneClass("B")}`}>
          <PanelHead letter="B" title="Layer 1: eight stencils" tech="convolution filters · 5 × 5 knobs each" />
          <div className="legend">
            <span><i className="sw blue" /> wants empty</span>
            <span><i className="sw white" /> doesn’t care</span>
            <span><i className="sw orange" /> wants ink</span>
          </div>
          <div className="stencils">
            {Array.from({ length: F1 }, (_, f) => (
              <button
                key={f}
                className={`stencil${pop?.kind === "stencil" && pop.index === f ? " active" : ""}`}
                data-pop-anchor
                onPointerEnter={hoverIn("stencil", f)}
                onPointerLeave={hoverOut}
                onClick={togglePin("stencil", f)}
                aria-label={`Stencil ${f + 1}: click to see its numbers`}
              >
                <span className="num">{f + 1}</span>
                <canvas ref={(el) => { stencilCanvas.current[f] = el; }} style={{ width: STENCIL_PX, height: STENCIL_PX }} />
                <span className="slide" aria-hidden>→</span>
                <canvas ref={(el) => { mapCanvas.current[f] = el; }} className="map" style={{ width: MAP_PX, height: MAP_PX }} />
              </button>
            ))}
          </div>
          <p className="hint">
            Left: the stencil. Right: where it fired on your drawing <small>(feature map, 24 × 24)</small>. Hover to
            enlarge, click for the numbers.
          </p>
        </section>

        {/* ---------------- C ---------------- */}
        <section className={`panel c${zoneClass("C")}`}>
          <PanelHead letter="C" title="Layer 2: stencils of stencils" tech="second convolution layer · 8 units" />
          <div className="legend">
            <span><i className="sw box" /> the patch that excited it most</span>
          </div>
          <div className="units">
            {Array.from({ length: F2 }, (_, u) => (
              <button
                key={u}
                ref={(el) => { unitCard.current[u] = el; }}
                className={`unit${pop?.kind === "unit" && pop.index === u ? " active" : ""}`}
                data-pop-anchor
                onPointerEnter={(e) => {
                  hoverUnit.current = u;
                  dirty.current = true;
                  hoverIn("unit", u)(e);
                }}
                onPointerLeave={() => {
                  hoverUnit.current = null;
                  dirty.current = true;
                  hoverOut();
                }}
                onClick={togglePin("unit", u)}
                aria-label={`Layer 2 unit ${u + 1}`}
              >
                <span className="num">{u + 1}</span>
                <span className="unit-pics">
                  <canvas ref={(el) => { miniCanvas.current[u] = el; }} style={{ width: MINI_PX, height: MINI_PX }} />
                  <canvas
                    ref={(el) => { topCanvas.current[u] = el; }}
                    className="tops"
                    style={{ width: THUMB_PX * 2 + 2, height: THUMB_PX * 2 + 2 }}
                  />
                </span>
                <span className="quiet-tag">quiet on this drawing</span>
                <span className="meter" title="How strongly this unit fired on your drawing (points)">
                  <span ref={(el) => { strengthBar.current[u] = el as HTMLDivElement | null; }} />
                </span>
              </button>
            ))}
          </div>
          <p className="hint">
            Left: your drawing. Right: this unit’s 4 favourite training shapes so far. The bar is its points{" "}
            <small>(activation)</small>. What do its favourites have in common?
          </p>
        </section>

        {/* ---------------- D ---------------- */}
        <section className={`panel d${zoneClass("D")}`}>
          <PanelHead letter="D" title="The answer" tech="final judge · fully connected + softmax" />
          <div className="d-body">
          <div className="d-guess">
          <div className="verdict" data-blank={stats?.blank ? "true" : "false"}>
            <div className="verdict-icon">
              {stats && !stats.blank ? <ShapeIcon cls={stats.guess} size={44} /> : <Pencil size={34} />}
            </div>
            <div>
              <div className="verdict-line">{verdict}</div>
              <div className="verdict-note">{verdictNote}</div>
            </div>
          </div>
          <div className="bars" data-blank={stats?.blank ? "true" : "false"}>
            {classList.map((c) => (
              <div
                key={c}
                ref={(el) => { barRow.current[c] = el; }}
                className={`bar-row${stats && !stats.blank && stats.guess === c ? " win" : ""}`}
              >
                <span className="bar-icon"><ShapeIcon cls={c} size={22} /></span>
                <span className="bar-name">{CLASS_NAMES[c]}</span>
                <span className="bar-track">
                  <span className="bar-fill" ref={(el) => { barFill.current[c] = el as HTMLDivElement | null; }} />
                </span>
                <span className="bar-pct" ref={(el) => { barText.current[c] = el; }}>0%</span>
              </div>
            ))}
          </div>
          <p className="hint judge-hint">
            The judge adds up points from layer 2 and shares out 100% between the shapes.
          </p>
          </div>
          <div className="report">
            <div className="report-title">
              Report card <small>on {TEST_SIZE} test shapes it never practised</small>
            </div>
            {classList.map((c) => {
              const row = report && report.length === nClasses * nClasses ? report.slice(c * nClasses, (c + 1) * nClasses) : null;
              const total = row ? row.reduce((a, b) => a + b, 0) : 0;
              const right = row ? row[c] : 0;
              let worst = -1;
              if (row) for (let k = 0; k < nClasses; k++) if (k !== c && row[k] > 0 && (worst < 0 || row[k] > row[worst])) worst = k;
              return (
                <div className="report-row" key={c}>
                  <span className="bar-icon"><ShapeIcon cls={c} size={18} /></span>
                  <span className="report-track">
                    <span className="report-fill" style={{ width: total ? `${(right / total) * 100}%` : "0%" }} />
                  </span>
                  <span className="report-num">{total ? `${right}/${total}` : "…"}</span>
                  <span className="report-note">
                    {row && worst >= 0 ? `${row[worst]} mistaken for a ${CLASS_NAMES[worst]}` : total ? "all correct" : ""}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        </section>
      </main>

      {/* ---------------- training strip ---------------- */}
      <section className={`strip${zoneClass("strip")}`}>
        <div className="strip-row controls">
          <div className={`buttons${storyStep?.focus === "train" ? " focus" : ""}`}>
            <button className="btn primary big" onClick={() => setRunning(true)} disabled={running || !ready} title="Start practising (space bar)">
              <Play size={20} /> Train
            </button>
            <button className="btn big" onClick={() => setRunning(false)} disabled={!running}>
              <Pause size={20} /> Pause
            </button>
            <button className="btn big" onClick={doStep} disabled={!ready} title="Practise on one mini-batch of 16 shapes">
              <StepForward size={20} /> Step
            </button>
            <button
              className={`btn big${needsReset ? " pulse" : ""}`}
              onClick={() => doReset()}
              disabled={!ready}
              title="New random stencils and new shapes"
            >
              <RotateCcw size={20} /> {needsReset ? "Reset to apply" : "Reset"}
            </button>
          </div>

          <div className="counters">
            <Counter label="examples seen" value={stats ? stats.examples.toLocaleString("en-GB") : "0"} sub={`${stats?.step ?? 0} steps of ${BATCH}`} />
            <Counter
              label="test score"
              tech="accuracy"
              value={stats?.acc != null ? `${(stats.acc * 100).toFixed(0)}%` : "…"}
              sub={`on ${TEST_SIZE} shapes it never practised`}
              tone={stats?.acc != null && stats.acc >= 0.85 ? "good" : undefined}
            />
            {stats?.narrow && (
              <Counter
                label="any-kind score"
                value={stats.wide != null ? `${(stats.wide * 100).toFixed(0)}%` : "…"}
                sub="shapes of every kind"
                tone="purple"
              />
            )}
            <Counter label="how wrong" tech="loss" value={stats?.loss != null ? stats.loss.toFixed(2) : "…"} sub="lower is better" />
            <Counter
              label="practice time"
              value={formatTime(stats?.ms ?? 0)}
              sub={stats?.reachedMs != null ? `85% after ${formatTime(stats.reachedMs)}` : "goal: 85% in 30 s"}
            />
          </div>
        </div>

        <div className="strip-row lower">
          <div className="settings">
            <label className="field">
              <span className="field-label">
                Nudge size <small>learning rate</small> <b>{lr.toFixed(3)}</b>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={slider}
                onChange={(e) => setSlider(Number(e.target.value))}
                aria-label="Nudge size (learning rate)"
              />
              <span className="field-note">{lrWord}</span>
            </label>
            <div className="field seed">
              <span className="field-label">
                Seed <small>same seed, same starting speckle</small>
              </span>
              <span className="seed-row">
                <input
                  type="text"
                  value={seedText}
                  maxLength={16}
                  onChange={(e) => setSeedText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doReset()}
                  aria-label="Seed"
                />
                <button
                  className="btn small"
                  onClick={() => doReset(String(Math.floor(Math.random() * 9000) + 1000))}
                  title="Pick a new seed and reset"
                >
                  <Dices size={16} /> New
                </button>
              </span>
            </div>
            <div className={`field variety${storyStep?.focus === "variety" ? " focus" : ""}`}>
              <span className="field-label">
                Variety of training shapes <small>applies on Reset</small>
              </span>
              <span className="toggles">
                <Toggle label="centred only" on={variety.centredOnly} set={(v) => setVariety({ ...variety, centredOnly: v })} />
                <Toggle label="no rotation" on={variety.noRotation} set={(v) => setVariety({ ...variety, noRotation: v })} />
                <Toggle label="outlines only" on={variety.outlinesOnly} set={(v) => setVariety({ ...variety, outlinesOnly: v })} />
                <Toggle label="add a 4th shape: line" on={lineClass} set={setLineClass} />
              </span>
            </div>
          </div>

          <div className="charts">
            <figure>
              <figcaption>
                How wrong <small>loss</small>
              </figcaption>
              <canvas ref={lossCanvas} />
            </figure>
            <figure>
              <figcaption>
                Test score <small>accuracy</small>
                {stats?.narrow && (
                  <span className="key">
                    <i className="k teal" /> same kind <i className="k purple" /> any kind
                  </span>
                )}
              </figcaption>
              <canvas ref={accCanvas} />
            </figure>
          </div>

        </div>
      </section>

      <details className="hood">
        <summary>Under the hood</summary>
        <div className="hood-body">
          <div>
            <h3>What is inside</h3>
            <table>
              <tbody>
                <tr><th>Input</th><td>your 28 × 28 drawing</td><td>784 values</td></tr>
                <tr><th>Layer 1 stencils</th><td>8 stencils, each 5 × 5, slid across the drawing</td><td>8 maps of 24 × 24</td></tr>
                <tr><th>Squash <small>ReLU</small></th><td>negative values become zero</td><td>same</td></tr>
                <tr><th>Shrink <small>max pooling</small></th><td>keep the strongest value in each 2 × 2 patch</td><td>8 maps of 12 × 12</td></tr>
                <tr><th>Layer 2 stencils</th><td>8 stencils, each 3 × 3, looking across all 8 layer-1 maps</td><td>8 maps of 10 × 10</td></tr>
                <tr><th>Squash + shrink</th><td>as before</td><td>8 maps of 5 × 5</td></tr>
                <tr><th>Final judge</th><td>every value connected to every shape, then percentages <small>softmax</small></td><td>{nClasses} outputs</td></tr>
              </tbody>
            </table>
            <p className="hood-note">
              That is {(8 * 25 + 8 + 8 * 8 * 9 + 8 + nClasses * 200 + nClasses).toLocaleString("en-GB")} knobs{" "}
              <small>(weights)</small> in all. The whole network is written by hand in plain TypeScript, with no
              machine-learning library, and it trains in your browser: nothing is sent anywhere. Training is plain
              stochastic gradient descent on mini-batches of {BATCH}, with two small safety belts: an oversized nudge is
              scaled down, and unused layer-1 knobs fade slowly towards zero.
            </p>
          </div>
          <div>
            <h3>Check the maths</h3>
            <p className="hood-note">
              Backpropagation works out how to nudge each knob. To prove the hand-written maths is right, wiggle a few
              knobs by a hair, measure how “how wrong” really changes, and compare.
            </p>
            <button className="btn small" onClick={runMathCheck} disabled={!ready}>
              <Calculator size={16} /> Run the check <small>gradient check</small>
            </button>
            {mathRows && (
              <table className="math">
                <thead>
                  <tr><th>knob</th><th>backprop says</th><th>measured</th><th /></tr>
                </thead>
                <tbody>
                  {mathRows.map((r, i) => (
                    <tr key={i}>
                      <th>{r.param}[{r.index}]</th>
                      <td>{r.backprop.toExponential(4)}</td>
                      <td>{r.numeric.toExponential(4)}</td>
                      <td className={r.relError < 1e-4 ? "ok" : "bad"}>{r.relError < 1e-4 ? "match" : "differs"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </details>

      {/* ---------------- enlarged views ---------------- */}
      <AnimatePresence>
        {pop && lab && (
          <motion.div
            key={`${pop.kind}-${pop.index}`}
            className={`pop pop-${pop.kind}${pop.pinned ? " pinned" : ""}`}
            data-pop
            style={{ left: pop.left, top: pop.top }}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
          >
            {pop.kind === "stencil" ? (
              <>
                <div className="pop-head">
                  <b>Stencil {pop.index + 1}</b>
                  <small>convolution filter</small>
                  {pop.pinned && (
                    <button className="close" onClick={() => setPop(null)} aria-label="Close">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="pop-body">
                  <figure>
                    <canvas ref={popStencil} style={{ width: 200, height: 200 }} />
                    <figcaption>
                      {pop.pinned ? (
                        <>
                          Its 25 knobs <small>weights</small>, plus one extra knob <small>bias</small>:{" "}
                          <b>{lab.net.b1[pop.index].toFixed(2)}</b>
                        </>
                      ) : (
                        <>Click the stencil to see its numbers.</>
                      )}
                    </figcaption>
                  </figure>
                  <figure>
                    <canvas ref={popMap} style={{ width: 196, height: 196 }} />
                    <figcaption>
                      Orange shows where it fired on your drawing <small>points = activation</small>
                    </figcaption>
                  </figure>
                </div>
                {pop.pinned && (
                  <p className="slide-note">
                    <span ref={slideText}>Move your pointer over the pad to slide this stencil by hand.</span>{" "}
                    <small>points = knob × ink, added up over the 25 squares, plus the extra knob</small>
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="pop-head">
                  <b>Layer-2 unit {pop.index + 1}</b>
                  <small>second-layer filter</small>
                  {pop.pinned && (
                    <button className="close" onClick={() => setPop(null)} aria-label="Close">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="pop-body col">
                  <figure>
                    <canvas ref={popUnit} style={{ width: 196, height: 196 }} />
                    <figcaption>
                      The pink box is the patch of your drawing that excited this unit most.
                    </figcaption>
                  </figure>
                  <figure>
                    <canvas ref={popTops} style={{ width: 84 * 4 + 24, height: 84 }} />
                    <figcaption>Its 4 favourite training shapes so far. Spot a pattern?</figcaption>
                  </figure>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20 }}
            role="status"
          >
            <span className="toast-star">★</span> {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {!ready && <div className="loading">Mixing up 1,800 shapes…</div>}
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

function Counter({
  label,
  tech,
  value,
  sub,
  tone,
}: {
  label: string;
  tech?: string;
  value: string;
  sub?: string;
  tone?: "good" | "purple";
}) {
  return (
    <div className={`counter${tone ? ` ${tone}` : ""}`}>
      <span className="counter-label">
        {label} {tech && <small>{tech}</small>}
      </span>
      <span className="counter-value">{value}</span>
      {sub && <span className="counter-sub">{sub}</span>}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`toggle${on ? " on" : ""}`} onClick={() => set(!on)}>
      <span className="knob" />
      {label}
    </button>
  );
}
