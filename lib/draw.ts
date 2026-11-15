/** Canvas helpers shared by all the little pictures in the lab. */

export const INK = [31, 42, 68] as const;
export const PAPER = [255, 253, 248] as const;
export const ORANGE = [242, 125, 22] as const;
export const BLUE = [38, 104, 222] as const;
export const PINK = "#e0387a";

type RGB = readonly [number, number, number];

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
let scratchImage: ImageData | null = null;

function getScratch(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratchCtx = scratch.getContext("2d")!;
  }
  if (scratch.width !== w || scratch.height !== h || !scratchImage) {
    scratch.width = w;
    scratch.height = h;
    scratchImage = scratchCtx!.createImageData(w, h);
  }
  return [scratch, scratchCtx!, scratchImage];
}

/** Make a canvas crisp on high-density screens. Returns a context scaled so 1 unit = 1 CSS pixel. */
export function prepare(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * Paint a small grid of values as big chunky pixels.
 * `mode` picks the colours: "ink" (paper to navy), "fire" (white to orange) or "heat" (blue, white, orange).
 */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  values: ArrayLike<number>,
  offset: number,
  w: number,
  h: number,
  scale: number,
  mode: "ink" | "fire" | "heat",
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  alpha = 1,
): void {
  const [cv, sctx, img] = getScratch(w, h);
  const d = img.data;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    let v = values[offset + i] * scale;
    let from: RGB = PAPER;
    let to: RGB = INK;
    if (mode === "fire") {
      from = [255, 255, 255];
      to = ORANGE;
      v = Math.sqrt(v < 0 ? 0 : v); // lift faint firing so it can be seen
    } else if (mode === "heat") {
      from = [255, 255, 255];
      to = v >= 0 ? ORANGE : BLUE;
      v = Math.abs(v);
    }
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    const j = i * 4;
    d[j] = from[0] + (to[0] - from[0]) * v;
    d[j + 1] = from[1] + (to[1] - from[1]) * v;
    d[j + 2] = from[2] + (to[2] - from[2]) * v;
    d[j + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.drawImage(cv, 0, 0, w, h, dx, dy, dw, dh);
  ctx.globalAlpha = 1;
}

export function maxAbs(values: ArrayLike<number>, offset: number, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(values[offset + i]);
    if (a > m) m = a;
  }
  return m;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Outline the patch of the drawing that drove a layer-2 unit. Coordinates are in grid cells. */
export function strokeHotSpot(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  size: number,
  cell: number,
  ox: number,
  oy: number,
  lineWidth: number,
): void {
  const x = ox + gx * cell;
  const y = oy + gy * cell;
  const s = size * cell;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  roundRect(ctx, x, y, s, s, Math.min(6, cell * 1.2));
  ctx.lineWidth = lineWidth + 2;
  ctx.stroke();
  ctx.strokeStyle = PINK;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

export interface Series {
  /** y values; x is taken from `xs` or the index */
  ys: ArrayLike<number>;
  xs?: ArrayLike<number>;
  color: string;
  width?: number;
  dash?: number[];
  alpha?: number;
  dots?: boolean;
}

export interface ChartOptions {
  xMax: number;
  yMin: number;
  yMax: number;
  yTicks: number[];
  yFormat: (v: number) => string;
  goal?: { y: number; label: string };
  xLabel: string;
}

/** A small, calm line chart. */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  series: Series[],
  o: ChartOptions,
): void {
  const left = 38;
  const right = 10;
  const top = 8;
  const bottom = 20;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const X = (x: number) => left + (x / o.xMax) * pw;
  const Y = (y: number) => top + (1 - (y - o.yMin) / (o.yMax - o.yMin)) * ph;

  ctx.clearRect(0, 0, w, h);
  ctx.font = "600 10.5px Nunito Variable, Nunito, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const t of o.yTicks) {
    ctx.strokeStyle = "rgba(31,42,68,0.09)";
    ctx.beginPath();
    ctx.moveTo(left, Math.round(Y(t)) + 0.5);
    ctx.lineTo(w - right, Math.round(Y(t)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = "rgba(31,42,68,0.5)";
    ctx.textAlign = "right";
    ctx.fillText(o.yFormat(t), left - 6, Y(t));
  }
  // x axis labels
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(31,42,68,0.5)";
  ctx.fillText("0", left, h - 8);
  ctx.textAlign = "right";
  ctx.fillText(`${o.xMax} ${o.xLabel}`, w - right, h - 8);

  if (o.goal) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(15,157,138,0.7)";
    ctx.beginPath();
    ctx.moveTo(left, Y(o.goal.y));
    ctx.lineTo(w - right, Y(o.goal.y));
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(15,157,138,0.95)";
    ctx.textAlign = "left";
    ctx.fillText(o.goal.label, left + 6, Y(o.goal.y) - 8);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top - 2, pw + 2, ph + 4);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const s of series) {
    const n = s.ys.length;
    if (!n) continue;
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.setLineDash(s.dash ?? []);
    // thin out very long series so drawing stays cheap
    const stride = Math.max(1, Math.floor(n / (pw * 2)));
    ctx.beginPath();
    for (let i = 0; i < n; i += stride) {
      const x = X(s.xs ? s.xs[i] : i + 1);
      const y = Y(Math.min(o.yMax, Math.max(o.yMin, s.ys[i])));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const lx = X(s.xs ? s.xs[n - 1] : n);
    const ly = Y(Math.min(o.yMax, Math.max(o.yMin, s.ys[n - 1])));
    ctx.lineTo(lx, ly);
    ctx.stroke();
    if (s.dots) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
