# Shape Stencil Lab: build spec

A one-page web app where a curious 12-year-old watches a tiny network teach itself to tell triangles, squares and circles apart. Companion to the picture book *From Perceptrons to ChatGPT*.

**It must do two things: really learn, and show how it learns.** The network is a genuine, working model trained from scratch, not a simulation. On top of that, a learner who finishes should be able to explain the seven ideas below in their own words. Every panel, number and button exists to explain one of them. If something on screen doesn't explain an idea, leave it out.

## 1. The seven ideas

Each idea has one plain sentence, which the app shows word for word, and the one thing on screen that proves it.

| # | Idea | Plain sentence shown in the app | How the app shows it |
| --- | --- | --- | --- |
| 1 | **Labels** | "The computer drew these shapes, so it knows the answer. That answer is written on the back of each card." | Practice cards with their label underneath. A card can be flipped to show the label. |
| 2 | **Nobody gives it rules** | "The drawer knows how to *make* a triangle. The learner is never told. It only sees dots and labels." | A two-column card: Drawer (has drawing rules, never changes) vs Learner (no rules, only knobs). |
| 3 | **The answers are fixed** | "The builder chose the answer boxes. The network only learns how to pick between them." | The answer panel. A "Try a star" button: it has to squeeze the star into triangle, square or circle. |
| 4 | **Making a guess** | "Dots go in, stencils look for patterns, and the judge adds up points and shares out 100%." | Panels left to right, A to D, lighting up in order when a card goes through. |
| 5 | **How wrong** | "How wrong = how surprised it was by the right answer. Sure and right scores 0. A wild guess scores about 1.1." | The worked sum on the current card: "bet 21% on triangle, −ln(0.21) = 1.56". |
| 6 | **Blame and nudge** | "The blame flows backwards, and every knob turns a tiny bit to make that mistake smaller." | Slow-mo (section 3): blame arrows right to left, then a before, after and change map for each stencil. |
| 7 | **Patterns appear by themselves** | "Nobody drew these lines. They appeared because lines help it get the answer right." | Stencils going from speckle to edges during training. A "variety" switch shows narrow practice makes a narrow learner. |

## 2. Screen

One page. Four panels in the order the data flows, a teaching bar under them, and controls at the bottom.

- **A. Cards** (ideas 1, 2): a drawing pad, 28 by 28 dots, the practice cards with their labels, and the Drawer vs Learner card.
- **B. Stencils** (ideas 4, 7): 8 small knob grids, orange for "wants ink" and blue for "wants empty", each with a map of where it fired on the current card.
- **C. Stencils of stencils** (idea 4): 8 units, each showing its 4 favourite practice cards and the patch of the current card that excited it.
- **D. The judge** (ideas 3, 5): the answer bars, the label for the current card, and the how-wrong sum.
- **Teaching bar**: shows the plain sentence for whichever idea is active. Every number on screen has a hover note in one plain line.
- **Controls**: Slow-mo (the main button), Train, Pause, Reset, Try a star, nudge size, and variety switches (centred only, no rotation, outlines only). Charts: how wrong, with a line at 1.1 marked "wild guess", and test score, with "on 300 cards it never practised".

Use the book's words: card, label, stencil, knob, points, judge, how wrong, nudge. Technical terms only in small grey text beside them, for example "stencil (convolution filter)".

## 3. Slow-mo: the heart of the app

One card, five stages, with a Next button. Each stage highlights its panel and shows its sentence in the teaching bar.

1. **Pick a card**: "This card's label says triangle." (Panel A)
2. **Guess**: panels light up A to D. "It bets 21% triangle, 37% square, 42% circle."
3. **Mark it**: "The right answer was triangle. How wrong = −ln(0.21) = 1.56." (Panel D)
4. **Blame flows back**: arrows D to C to B, and units glow by their share of the blame. "The units that pushed towards circle get most of the blame."
5. **Nudge**: before, after and change map for each stencil. "Every knob turned a tiny bit. Look, this one got a bit more like a slanted line."

Make the nudge 20 times bigger so it's visible, and say so on screen. Slow-mo must not affect the real training run.

**Fast training** runs the same five stages without stopping, 16 cards at a time, then nudges once. Say that in one line under Train, and show a ticker of recent cards with ticks and crosses, so the link to slow-mo is obvious.

## 3b. Look inside the brain

A button that opens the trained model itself: every knob, as real numbers. Plain sentence: "This is everything it learned. No pictures, no rules, just numbers. Throw away the practice cards and it still works."

| Part | Knobs | Shown as |
| --- | --- | --- |
| Layer 1 stencils | 8 × (25 + 1) = 208 | Each 5 by 5 grid of numbers, coloured, beside its picture |
| Layer 2 stencils | 8 × (8 × 9 + 1) = 584 | Grids of numbers, one per stencil, per layer-1 map |
| Judge | 3 × (200 + 1) = 603 | Three rows of 200 numbers, one row per answer |
| **Total** | **1,395** | A counter: "This brain is 1,395 numbers. A big chatbot has billions." |

(The "+ 1" is each unit's starting push, known as its bias. Show it in grey.)

- **Live while training:** the numbers update as it learns, and the ones that changed most in the last nudge flash briefly.
- **Download the brain:** saves all the knobs as a small, readable JSON file, labelled with its size in KB and its test score.
- **Load a brain:** loads a saved file. The learner sees it recognise shapes straight away, with no training, which proves the knowledge lives in the numbers.
- **Check:** after a download and a fresh load, the test score matches exactly.

## 3c. Browse the cards

A button that opens every card it learns from and is tested on. Plain sentence: "These are all the examples it practised on, each with the answer written on the back. The test cards are kept in a separate pile it never practises on."

- **Two piles, side by side:** practice (1,500) and test (300), shown as a scrolling grid of small cards with the label under each one.
- **Filters:** by label (triangle, square, circle) and by result (got it right, got it wrong).
- **Sort by how wrong:** puts the cards it finds hardest first, each with its how-wrong score. This shows the learner *what* confuses it, for example tiny circles mistaken for squares.
- **Counts:** how many of each shape are in each pile, which proves the piles are balanced.
- **Click a card** to put it on the pad, or press Slow-mo on it.
- **Download the cards:** saves both piles as a file, with each card as a 28 by 28 grid of numbers from 0 to 1 plus its label, so the learner sees that a picture is just numbers too.
- **Check:** no card appears in both piles, and the counts match section 5.

## 4. Story mode

Walks through ideas 1 to 7 in order, one step each, highlighting the panel and asking the learner to do one thing: flip a card, press Slow-mo, read the sum, press Train, watch the stencils, press Try a star, turn on "centred only" and press Reset.

## 5. Under the hood

- **Data**: a generator draws triangles, squares and circles at random positions, sizes (8 to 20 dots), angles, filled or outlined, with light noise. 1,500 practice cards and 300 test cards, kept separate. Stars come only from Try a star, never from practice.
- **Network**: input 28 by 28 → 8 stencils, 5 by 5 → ReLU → 2 by 2 max pool → 8 stencils, 3 by 3 → ReLU → pool → judge (fully connected, softmax) → 3 answers.
- **Training**: backprop, plain SGD, batches of 16, adjustable nudge size. Loss is cross-entropy, shown as "how wrong". Random start, with a seed so Reset is repeatable.
- **Constraints**: single HTML file, no backend, no ML library. Write the maths by hand so every value can be drawn. The network code must not touch the generator: its only inputs are dots and labels.
- **Speed**: train on animation frames so the page stays responsive. Aim for 85% test score in about 30 seconds.

## 6. Done when

**It works:**

- [ ] Reaches over 85% on the 300 test cards within about 30 seconds on a typical laptop.
- [ ] Once trained, a triangle drawn anywhere on the pad gets the highest percentage. The same goes for squares and circles.
- [ ] A numerical gradient check matches backprop.
- [ ] The same seed gives the same starting stencils and the same training curve.
- [ ] The page stays responsive while training, with visuals updating several times a second.
- [ ] Practice is balanced across the three shapes.

**It explains:**

- [ ] Every idea in section 1 has its sentence and its proof on screen.
- [ ] Every number on screen has a one-line hover note.
- [ ] Slow-mo runs all 5 stages on one card. The stage 3 sum matches the displayed bet. The stage 5 change map matches the real weight change, scaled.
- [ ] Slow-mo doesn't change the real training run.
- [ ] Stencils start as speckle, and at least half look edge-like once trained.
- [ ] Try a star always produces a forced triangle, square or circle answer, with the idea 3 sentence.
- [ ] Training with "centred only", then testing on cards in a corner, shows what happens to accuracy. Report the actual result, since pooling may keep the drop small.

## 7. Build order

Build the explanation alongside the machinery, not after it.

1. Generator and labelled practice cards (idea 1, 2).
2. Network forward pass and panels A to D (idea 3, 4).
3. Loss with the worked sum (idea 5).
4. Backprop, gradient check, then Slow-mo (idea 6).
5. Fast training, charts and the stencil change maps (idea 7).
6. Story mode.

Keep the code compact. Put all on-screen sentences in one list of the seven ideas, so text isn't duplicated across files. Don't add features that aren't in this spec.
