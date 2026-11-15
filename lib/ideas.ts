/**
 * Every sentence the app says lives here, in one list, so nothing is written twice.
 * The seven ideas come first; the page shows each sentence word for word.
 */
import { CLASS_NAMES } from "./shapes";

export interface Idea {
  n: number;
  name: string;
  sentence: string;
  /** where to look for the proof */
  look: string;
  /** the one thing story mode asks the learner to do */
  task: string;
}

export const IDEAS: Idea[] = [
  {
    n: 1,
    name: "Labels",
    sentence: "The computer drew these shapes, so it knows the answer. That answer is written on the back of each card.",
    look: "Panel A: every practice card has its label underneath.",
    task: "Press “Flip the card” to see the label on the back.",
  },
  {
    n: 2,
    name: "Nobody gives it rules",
    sentence: "The drawer knows how to make a triangle. The learner is never told. It only sees dots and labels.",
    look: "Panel A: the Drawer and the Learner, side by side.",
    task: "Read the two columns. Which one has rules?",
  },
  {
    n: 3,
    name: "The answers are fixed",
    sentence: "The builder chose the answer boxes. The network only learns how to pick between them.",
    look: "Panel D: three answer boxes, and no others.",
    task: "Press “Try a star” and watch it squeeze the star into a box.",
  },
  {
    n: 4,
    name: "Making a guess",
    sentence: "Dots go in, stencils look for patterns, and the judge adds up points and shares out 100%.",
    look: "Panels A to D light up in order when a card goes through.",
    task: "Press “Slow-mo”, then Next, and watch the card go through.",
  },
  {
    n: 5,
    name: "How wrong",
    sentence: "How wrong = how surprised it was by the right answer. Sure and right scores 0. A wild guess scores about 1.1.",
    look: "Panel D: the worked sum on the current card.",
    task: "Press Next again and read the sum in panel D.",
  },
  {
    n: 6,
    name: "Blame and nudge",
    sentence: "The blame flows backwards, and every knob turns a tiny bit to make that mistake smaller.",
    look: "Slow-mo: blame arrows from right to left, then before, change and after for each stencil.",
    task: "Press Next twice more: first the blame flows back, then the knobs turn.",
  },
  {
    n: 7,
    name: "Patterns appear by themselves",
    sentence: "Nobody drew these lines. They appeared because lines help it get the answer right.",
    look: "Panel B: the stencils go from speckle to lines while it trains.",
    task: "Press Train and watch the stencils. Then turn on “centred only”, press Reset and Train again.",
  },
];

const pct = (p: number) => `${Math.round(p * 100)}%`;
const name = (c: number) => CLASS_NAMES[c];

/** The bet shown in a sum, rounded the way it is displayed, so the sum on screen can be checked by hand. */
export function shownBet(p: number): number {
  return p >= 0.095 ? Math.round(p * 100) / 100 : Math.max(Number(p.toPrecision(1)), 1e-9);
}
export function betText(p: number): string {
  const s = shownBet(p);
  return s >= 0.095 ? `${Math.round(s * 100)}%` : `${Number((s * 100).toPrecision(1))}%`;
}
/** "bet 21% on triangle, −ln(0.21) = 1.56" */
export function sumText(p: number, label: number): { bet: string; sum: string; loss: number } {
  const s = shownBet(p);
  const loss = -Math.log(s);
  return { bet: `bet ${betText(p)} on ${name(label)}`, sum: `−ln(${s}) = ${loss.toFixed(2)}`, loss };
}

/** Slow-mo: one card, five stages. Each stage belongs to an idea and says one thing. */
export const STAGES = [
  { title: "Pick a card", idea: 1, panels: "A" },
  { title: "Guess", idea: 4, panels: "ABCD" },
  { title: "Mark it", idea: 5, panels: "D" },
  { title: "Blame flows back", idea: 6, panels: "DCB" },
  { title: "Nudge", idea: 6, panels: "B" },
] as const;

export const NUDGE_ZOOM = 20;

export function stageText(stage: number, label: number, probs: ArrayLike<number>, changedMost: number): string {
  if (stage === 1) return `This card’s label says ${name(label)}.`;
  if (stage === 2) return `It bets ${pct(probs[0])} triangle, ${pct(probs[1])} square, ${pct(probs[2])} circle.`;
  if (stage === 3) {
    const t = sumText(probs[label], label);
    return `The right answer was ${name(label)}. How wrong = ${t.sum}.`;
  }
  if (stage === 4) {
    let wrong = -1;
    for (let c = 0; c < 3; c++) if (c !== label && (wrong < 0 || probs[c] > probs[wrong])) wrong = c;
    return `The units that pushed towards ${name(wrong)} get most of the blame.`;
  }
  return `Every knob turned a tiny bit. Stencil ${changedMost + 1} changed the most. The change is drawn ${NUDGE_ZOOM} times bigger so you can see it.`;
}

export const TEXT = {
  fastTraining: "Train runs the same five stages without stopping, 16 cards at a time, then nudges once.",
  brain: "This is everything it learned. No pictures, no rules, just numbers. Throw away the practice cards and it still works.",
  brainSize: "This brain is 1,395 numbers. A big chatbot has billions.",
  cards: "These are all the examples it practised on, each with the answer written on the back. The test cards are kept in a separate pile it never practises on.",
  star: "There is no star box, so it has to squeeze the star into triangle, square or circle.",
  slowmoSafe: "Slow-mo is a rehearsal: the real training run is not changed.",
  noLabel: "You drew this card, so nothing is written on the back. No label means no marking.",
  fresh: "It has not practised yet, so there are no guesses or scores to show. Press Train, or Slow-mo to follow one card.",
  freshCards: "Click a card to pick it. Under each card is its label. It has not practised yet, so there are no guesses, ticks, crosses or scores to show.",
  drawer: ["Has drawing rules", "“Three straight sides make a triangle”", "Never changes"],
  learner: ["Has no rules", "Only sees dots and labels", "Only has 1,395 knobs to turn"],
};
