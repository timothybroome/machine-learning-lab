# Shape Stencil Lab

A one-page web app where a curious 12-year-old watches a tiny network teach itself to tell triangles, squares
and circles apart. It really learns, in the browser, and every panel exists to explain one of seven ideas.
Companion to the picture book *From Perceptrons to ChatGPT*.

Live: https://stencil.tjb.app · Spec: [`Shape Stencil Lab build spec-2.md`](./Shape%20Stencil%20Lab%20build%20spec-2.md) ·
The build for the first spec is kept on the `v1-first-spec` branch.

## What is in here

| Path | What it is |
| --- | --- |
| `lib/ideas.ts` | Every sentence the app says: the seven ideas, the slow-mo stage lines, the brain and card sentences. |
| `lib/net.ts` | The network, by hand: forward, backprop, SGD, gradient check, nudge preview, save and load. Its only inputs are dots and labels; it does not import the generator. |
| `lib/shapes.ts` | The drawer: seeded card generator, variety switches, the star, the pad's brush. |
| `lib/lab.ts` | The two piles of cards, the training loop, test scoring, layer-2 favourites. |
| `components/StencilLab.tsx` | Panels A to D, teaching bar, slow-mo, story mode, controls. |
| `components/BrainView.tsx`, `CardBrowser.tsx` | "Look inside the brain" and "Browse the cards". |
| `scripts/check.ts`, `scripts/shoot.ts` | Headless checks, and checks that drive the real page in Chromium. |

```bash
npm install
npm run dev      # http://localhost:3000
npm run check    # about 2 minutes
npx tsx scripts/shoot.ts http://localhost:3000 shots   # needs: npx playwright install chromium
```

Deployed on Coolify from `main` with the `Dockerfile`; pushing to `main` redeploys.

## Done when: what actually happens

Measured on the deployment machine, in Node (`npm run check`) and in headless Chromium (`scripts/shoot.ts`).

| Check | Result |
| --- | --- |
| Over 85% on the 300 test cards within about 30 s | In the browser: 85% after 11.8 s, 92.3% at 30 s. In Node: 85% after 9.4 s, 93.3% at 30 s. |
| A drawn triangle, square or circle gets the highest percentage | Usually, not always. 2,000 brush-drawn shapes of each kind at random places, sizes and angles: triangles 98.3%, squares 89.8%, circles 99.2%. Mouse-drawn in six places in the browser: triangles 6/6, squares 5/6, circles 6/6. Squares are the weak spot. |
| Gradient check | Worst relative error 2e-8 over 288 knobs. |
| Same seed, same start, same curve | Identical. The seed is fixed, so Reset always replays the same run, however fast the computer is. |
| Responsive while training | About 51 frames a second; worst gap between frames 33 ms. |
| Practice is balanced | 500/500/500 practice and 100/100/100 test; no card is in both piles. |
| Every idea has its sentence and proof | The teaching bar shows each sentence word for word; story mode walks all seven. |
| Every number has a hover note | An automatic scan of the page finds no number without one. Numbers drawn inside pictures (chart axes, the card browser) carry the note on the picture. |
| Slow-mo: 5 stages, sum matches bet, change map matches the real change | Yes. The sum is worked out from the bet as displayed, so a learner can check it on a calculator (for example bet 42%, −ln(0.42) = 0.87). The change map equals the real one-card weight change times 20, to the last digit. |
| Slow-mo doesn't change the training run | All 1,395 knobs are identical before and after. |
| Speckle at the start, edge-like once trained | 8 of 8 stencils end up dominated by stripes in one direction. They look like bars and diagonals more than textbook edges. |
| Try a star | Always one of the three answers, with the idea 3 sentence. The trained seed-7 brain called five stars in a row "triangle". |
| Centred only, then cards in a corner | Centred test cards 99%, cards of every kind 56%, small cards in a corner 32% (chance is 33%). A hand-drawn triangle in a corner was still called a triangle, so the drop shows in the scores more reliably than in a single drawing. |
| Download a brain, load it fresh | 29 KB file; the test score after loading equals the score in the file exactly, with no training. |

## Where the build departs from the spec

- **Not a single HTML file.** It is a Next.js app, as originally requested, served as one static page with no
  backend calls. Everything else in the constraints holds.
- **Two safety belts on plain SGD**, as in the first build: an oversized nudge is scaled down (gradient
  clipping at 2.5), and layer-1 knobs decay slightly towards zero (0.01). Without the first, a single bad
  batch can crash the score mid-run; without the second, the stencils never visibly turn into lines. Slow-mo
  shows exactly the nudge this rule produces.
- **Story mode follows ideas 1 to 7 in order.** The spec's list of actions is in a slightly different order
  from its list of ideas; each action is attached to the idea it proves. Idea 2 asks the learner to read the
  Drawer and Learner card rather than press something.
- **A second test score appears when a variety switch is on** ("every-kind score"), because that is what
  shows a narrow learner.
