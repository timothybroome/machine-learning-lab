# Shape Stencil Lab

A single-page web app that trains a tiny convolutional network on triangles, squares and circles, in the
browser, so a learner can watch random stencils turn into edge and line detectors. It is a companion to the
picture book *From Perceptrons to ChatGPT* and is written for a curious 12-year-old.

Live: https://stencil.tjb.app

The build spec is in [`Shape Stencil Lab build spec.md`](./Shape%20Stencil%20Lab%20build%20spec.md).

## What is in here

| Path | What it is |
| --- | --- |
| `lib/net.ts` | The network, written by hand: forward pass, backpropagation, SGD, gradient check, hot-spot tracing. No ML library. |
| `lib/shapes.ts` | The seeded shape generator, the variety toggles, and the drawing-pad brush. |
| `lib/lab.ts` | The training loop, test scoring, report card and layer-2 "top examples". Knows nothing about the screen. |
| `lib/rng.ts` | Seeded random numbers (mulberry32). |
| `lib/draw.ts` | Canvas helpers: pixel grids, heat maps, charts. |
| `components/StencilLab.tsx` | The page: panels A to D, the training strip, story mode, enlarged views. |
| `scripts/check.ts` | Headless acceptance checks (spec section 8). |
| `scripts/shoot.ts` | Drives the real page in headless Chromium: screenshots, speed, drawn triangles. |

The page is static; Next.js only serves it. All training happens on the visitor's device and nothing is sent
anywhere. In the browser console, `stencilLab` exposes the live engine, for example `stencilLab.net.W1`.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run check        # acceptance checks, about 3 minutes
npm run build && npm start
```

Browser checks and screenshots (needs `npx playwright install chromium` once):

```bash
npx tsx scripts/shoot.ts http://localhost:3000 shots
```

## Deployment

Deployed on Coolify from this repository's `main` branch using the `Dockerfile` (Next.js standalone output,
port 3000). Pushing to `main` redeploys automatically. Coolify's health check must use host `127.0.0.1`,
not `localhost`: inside the Alpine image `localhost` resolves to IPv6 first and the check fails.

## Acceptance checks: what actually happens

Measured on the deployment machine. `npm run check` covers three seeds (7, 42, 2024); the browser numbers
are from `scripts/shoot.ts` in headless Chromium with seed 7 and the default nudge size of 0.1.

| Check | Result |
| --- | --- |
| At Reset, layer-1 stencils look like random speckle | Yes. Starting knobs are small random values; each stencil is drawn scaled to its own largest knob. |
| Over 85% test accuracy, with at least half the stencils edge-like | 85% is passed after about 8 to 11 s and about 1,100 steps; 92 to 95% after 30 s. After training, 7 or 8 of the 8 stencils are dominated by a single stripe direction (a "stripe share" above 0.55, where random speckle scores about 0.34). To the eye they are bars and diagonals rather than textbook edges, because most of the ink is thin outlines. |
| Drawing a triangle anywhere gives it the highest percentage | Mostly. Mouse-drawn triangles in six places: five recognised. Simulated wobbly scribbles all over the pad: 89 to 99% of triangles recognised. The failures are triangles that touch the very edge of the pad: training shapes keep 1.5 pixels clear of the edge and the first layer cannot see the outer 2 pixels well. Squares are the weakest class for hand drawings (about 80 to 88%). |
| "Centred only", then shapes in a corner | A clear drop. Centred test score 99 to 100%, but 55 to 57% on shapes of every kind (the purple line on the chart), and about 30% on small shapes pushed into a corner, which is chance. Pooling does not rescue it, because the final judge has only ever seen points arrive in the middle. A large triangle drawn towards a corner is still often recognised. |
| Page stays responsive while training | About 52 frames a second while training, worst gap between frames 33 ms. Training gets 11 ms of each animation frame. |
| Same seed, same stencils and curve | Yes, bit for bit, including when run with very different time slices. Scoring jobs always finish before the next training step, so results depend only on the seed and step count, not on how fast the computer is. |
| Numerical gradient check | Worst relative error about 3e-8 over 288 knobs. The same check can be run in the page under "Under the hood". |

## Where the build departs from the spec, and why

- **Two safety belts on plain SGD.** The update is plain mini-batch SGD, plus (1) the whole nudge is scaled
  down when its size exceeds 2.5 (gradient clipping) and (2) layer-1 knobs decay very slightly towards zero
  each step (weight decay 0.01). Without clipping, one unlucky batch occasionally knocked accuracy from 90%
  down to about 45%, which is confusing to watch. Without the decay, the starting speckle never fades and
  the stencils do not visibly turn into lines. Both are stated in the page under "Under the hood".
- **Shapes are regular.** Making triangles lopsided and squares oblong, or letting shapes touch the grid
  edge, cost 6 to 8 points of test accuracy at this network size, so the generator keeps shapes regular with
  a small corner wobble.
- **"Size" means** the triangle's side, roughly the square's side, or the circle's width, from 8 to 20 pixels.
- **Additions:** a report card (per-shape results on the test set), an eraser, the latest mini-batch shown
  under the pad (click a shape to load it), "slide the stencil by hand" (pin a stencil, then move the pointer
  over the pad to see the points it scores there), and the "line" distractor class from the stretch goal.
- **Practice time** is wall-clock time while Train is on, which is how a learner would time it.
