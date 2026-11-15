# Shape Stencil Lab: build spec

A single-page web app that trains a tiny convolutional network on simple shapes in the browser, so a learner can watch random stencils turn into edge and corner detectors. It is a companion to the picture book *From Perceptrons to ChatGPT*, so it needs to work for a curious 12-year-old.

## 1. Goals

- Show, live, that nobody programs what a stencil looks for: they start as random speckle and learn from labelled examples.
- Let the learner draw a shape and see which stencils fire, and where.
- Show the second layer building on the first, from lines to corners to whole shapes.
- Train in seconds on an ordinary laptop, with no server.

**Out of scope:** real photos, saving models, user accounts, mobile-first layout (it should still work on a tablet).

## 2. Technical constraints

- One self-contained web app: HTML, CSS and JavaScript or TypeScript, with no backend.
- **Write the network by hand** in plain code, with no ML library. The point is transparency: every weight, gradient and activation must be inspectable and drawable. The network is small enough that this is practical.
- Draw with HTML canvas or SVG.
- Use a seeded random number generator, so a Reset with the same seed reproduces the same starting stencils.

## 3. The data: shapes on a grid

- **Grid:** 28 by 28 pixels, greyscale values from 0 to 1.
- **Classes:** triangle, square, circle. A stretch goal is a fourth class, "line", as a distractor.
- **Generator:** produce shapes at random positions, sizes from about 8 to 20 pixels, rotations from 0 to 360 degrees, and either outlined or filled. Add a little pixel noise.
- **Training set:** about 1,500 shapes, balanced across classes, regenerated on Reset.
- **Test set:** about 300 shapes kept separate and never trained on, used to report accuracy.
- **Variety controls:** toggles that limit the generator, for example "centred only", "no rotation" or "outlines only". These let the learner see that a narrow training set produces a narrow network.

## 4. The network

Keep it as small as possible while still learning the task.

| Stage | What it does | Size |
| --- | --- | --- |
| Input | The 28 by 28 drawing | 784 values |
| Layer 1 stencils | 8 stencils, each 5 by 5, slid across the image | 8 maps of 24 by 24 |
| Squash | Negative values set to zero (ReLU) | same |
| Shrink | Keep the strongest value in each 2 by 2 patch (max pooling) | 8 maps of 12 by 12 |
| Layer 2 stencils | 8 stencils, each 3 by 3, looking across all 8 layer-1 maps | 8 maps of 10 by 10 |
| Squash + shrink | ReLU, then max pooling 2 by 2 | 8 maps of 5 by 5 |
| Final judge | Fully connected to the 3 classes, softmax for percentages | 3 outputs |

- **Training:** backpropagation with plain stochastic gradient descent, mini-batches of about 16, a learning rate the user can adjust with a slider.
- **Loss:** cross-entropy, shown to the user as "how wrong".
- **Starting weights:** small random values, so the stencils visibly start as speckle.
- **Speed:** train in small steps on animation frames so the page stays responsive and the visuals update while it learns. Target: over 85% test accuracy within about 30 seconds on a typical laptop. Treat this as a goal to check, not a guarantee.

## 5. Screen layout

One page, four panels from left to right, so the eye follows the data the way the network does.

| Panel | Shows | Learner can |
| --- | --- | --- |
| A. Drawing pad | A 28 by 28 grid, drawn large (about 280 px), with the current shape | Draw with mouse or finger, clear, or pick "random shape" |
| B. Layer 1 stencils | 8 stencils as 5 by 5 heat maps (blue for negative, white for zero, orange for positive), and beside each one its 24 by 24 map of where it fired on the current drawing | Hover a stencil to enlarge it; click to see its numbers |
| C. Layer 2 | 8 cards, each showing which parts of the drawing made that unit fire most (see section 6) | Hover to enlarge |
| D. The answer | Three bars: triangle, square, circle, as percentages | See the guess change live as they draw |

Below the panels, a **training strip**:

- Buttons: Train, Pause, Step (one mini-batch), Reset (new random stencils and new data).
- A slider for learning rate and a seed box.
- The variety toggles from section 3.
- Two small line charts that update while training: "how wrong" (loss) and test accuracy, over training steps.
- A counter: examples seen so far.

## 6. Making layer 2 visible

Layer 2 stencils look at layer 1's maps, not at pixels, so drawing them directly means nothing to a learner. Instead, show what they respond to:

- **Top examples:** for each layer-2 unit, keep the 4 training shapes that made it fire most strongly and show them as thumbnails, refreshed every few seconds while training.
- **Hot spots:** on the current drawing, outline the area that drove each unit, by tracing its strongest pooled position back through the layers to a patch of the input.

The hope is that the learner sees units drift towards things like "pointy corners", "right angles" or "smooth curves". Do not label units with these names automatically; let the learner see it.

## 7. Story mode for a 12-year-old

An optional guided walkthrough of 5 short steps, each one sentence of plain English plus a highlight on the relevant panel:

1. "These 8 stencils are random speckle. Nobody has told them what to look for."
2. "Press Train. Each wrong answer nudges every stencil a tiny bit."
3. "Look: some stencils are turning into lines. Lines turned out to be useful."
4. "Draw a triangle. See which stencils light up along its sides?"
5. "Now turn on 'centred only' and Reset. What happens when it only ever sees one kind of shape?"

Use the same plain words as the picture book: stencil, knob, points, how wrong. Put the technical term in small grey text beside it, for example "stencil (convolution filter)".

## 8. Acceptance checks

- [ ] At Reset, layer-1 stencils look like random speckle.
- [ ] After training to over 85% test accuracy, at least half of the layer-1 stencils visibly show an edge-like pattern.
- [ ] Drawing a triangle anywhere on the pad gives it the highest percentage, once trained.
- [ ] Training with "centred only", then testing on shapes in a corner, shows a visible drop in accuracy. Report what actually happens in the notes, since pooling may keep this drop small.
- [ ] The page stays responsive while training, with visuals updating at least a few times a second.
- [ ] The same seed gives the same starting stencils and the same training curve.
- [ ] A numerical gradient check on a few weights matches backprop, to confirm the hand-written maths is right.

## 9. Build order for Claude

1. Shape generator with a preview grid of samples.
2. Network forward pass, then backprop, then the gradient check from section 8.
3. Training loop with loss and accuracy charts.
4. Panels A, B and D.
5. Panel C (layer 2) and the hot-spot tracing.
6. Story mode and final polish.

Check each step works before starting the next.
