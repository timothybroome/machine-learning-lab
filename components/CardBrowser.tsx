"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Snail, X } from "lucide-react";
import { Lab, Pile } from "@/lib/lab";
import { CLASS_NAMES, GRID } from "@/lib/shapes";
import { paintGrid, prepare } from "@/lib/draw";
import { TEXT } from "@/lib/ideas";

const CW = 58; // one card cell
const CH = 80;
const IMG = 50;
type Marks = { guess: Int8Array; loss: Float64Array };
type Sel = { pile: "practice" | "test"; index: number } | null;

function markPile(lab: Lab, pile: Pile): Marks {
  const guess = new Int8Array(pile.x.length);
  const loss = new Float64Array(pile.x.length);
  for (let i = 0; i < pile.x.length; i++) {
    const m = lab.mark(pile, i);
    guess[i] = m.guess;
    loss[i] = m.loss;
  }
  return { guess, loss };
}

/** Both piles as a file: every card is a 28 by 28 grid of numbers from 0 to 1, plus its label. */
function cardsFile(lab: Lab): Blob {
  const pile = (p: Pile) =>
    p.x.map((x, i) => {
      const rows: string[] = [];
      for (let r = 0; r < GRID; r++) rows.push("[" + Array.from(x.subarray(r * GRID, (r + 1) * GRID), (v) => Number(v.toFixed(2))).join(",") + "]");
      return `{"label":"${CLASS_NAMES[p.y[i]]}","dots":[\n${rows.join(",\n")}]}`;
    });
  return new Blob(
    [`{"what":"Shape Stencil Lab cards. Each card is 28 rows of 28 numbers (0 = empty, 1 = ink) and a label.",\n"practice":[\n`, pile(lab.train).join(",\n"), `],\n"test":[\n`, pile(lab.test).join(",\n"), "]}"],
    { type: "application/json" },
  );
}

export default function CardBrowser({
  lab,
  onClose,
  onPick,
}: {
  lab: Lab;
  onClose: () => void;
  onPick: (x: Float64Array, label: number, kind: "practice" | "test", slowmo: boolean) => void;
}) {
  const [label, setLabel] = useState(-1);
  const [result, setResult] = useState<"all" | "right" | "wrong">("all");
  const [hardest, setHardest] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const canvases = { practice: useRef<HTMLCanvasElement | null>(null), test: useRef<HTMLCanvasElement | null>(null) };
  const piles = { practice: lab.train, test: lab.test };
  const fresh = lab.fresh; // not practised yet: show only the pictures and their names
  const cols = typeof window !== "undefined" && window.innerWidth >= 1200 ? { practice: 12, test: 6 } : { practice: 9, test: 4 };

  // mark every card with the brain as it is right now
  const marks = useMemo(() => ({ practice: markPile(lab, lab.train), test: markPile(lab, lab.test) }), [lab]);

  const lists = useMemo(() => {
    const make = (name: "practice" | "test") => {
      const p = piles[name];
      const m = marks[name];
      const out: number[] = [];
      for (let i = 0; i < p.x.length; i++) {
        const ok = m.guess[i] === p.y[i];
        if ((label < 0 || p.y[i] === label) && (result === "all" || (result === "right") === ok)) out.push(i);
      }
      if (hardest) out.sort((a, b) => m.loss[b] - m.loss[a]);
      return out;
    };
    return { practice: make("practice"), test: make("test") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, label, result, hardest]);

  useEffect(() => {
    for (const name of ["practice", "test"] as const) {
      const cv = canvases[name].current;
      if (!cv) continue;
      const list = lists[name];
      const n = cols[name];
      const W = n * CW;
      const H = Math.max(CH, Math.ceil(list.length / n) * CH);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      // stay inside the canvas size limits of phones and tablets (about 16,000 pixels tall, 16 million in all)
      const ctx = prepare(cv, W, H, Math.min(2, 16000 / H, Math.sqrt(16e6 / (W * H))));
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      list.forEach((i, k) => {
        const ox = (k % n) * CW + (CW - IMG) / 2;
        const oy = Math.floor(k / n) * CH + 3;
        paintGrid(ctx, piles[name].x[i], 0, GRID, GRID, 1, "ink", ox, oy, IMG, IMG);
        if (sel && sel.pile === name && sel.index === i) {
          ctx.strokeStyle = "#e0387a";
          ctx.lineWidth = 3;
          ctx.strokeRect(ox - 1.5, oy - 1.5, IMG + 3, IMG + 3);
        }
        const ok = marks[name].guess[i] === piles[name].y[i];
        ctx.font = "800 10.5px Nunito Variable, Nunito, sans-serif";
        ctx.fillStyle = "rgba(31,42,68,0.85)";
        ctx.fillText(CLASS_NAMES[piles[name].y[i]], ox + IMG / 2, oy + IMG + 9);
        ctx.fillStyle = ok ? "#0a7a6b" : "#d13438";
        if (!fresh) ctx.fillText(`${ok ? "✓" : "✗"} ${marks[name].loss[i].toFixed(2)}`, ox + IMG / 2, oy + IMG + 21);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, sel, marks]);

  const at = (name: "practice" | "test", e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.floor((e.clientY - r.top) / CH) * cols[name] + Math.floor((e.clientX - r.left) / CW);
    return lists[name][k];
  };
  const counts = (name: "practice" | "test") => {
    const p = piles[name];
    const by = [0, 1, 2].map((c) => p.y.filter((v) => v === c).length);
    let right = 0;
    for (let i = 0; i < p.x.length; i++) if (marks[name].guess[i] === p.y[i]) right++;
    return { by, right, total: p.x.length };
  };
  const picked = sel ? { x: piles[sel.pile].x[sel.index], y: piles[sel.pile].y[sel.index], m: marks[sel.pile] } : null;

  const pileView = (name: "practice" | "test", title: string, note: string) => {
    const c = counts(name);
    return (
      <section className={`pile ${name}`}>
        <h3>
          {title} <small>{note}</small>
        </h3>
        <p className="pile-counts">
          <span title={`Cards in the ${name} pile`}>{c.total.toLocaleString("en-GB")} cards</span>:{" "}
          {c.by.map((n, i) => (
            <span key={i} title={`${n} of the ${c.total} ${name} cards are labelled ${CLASS_NAMES[i]}: the pile is balanced`}>
              {n} {CLASS_NAMES[i]}s{i < 2 ? ", " : ""}
            </span>
          ))}
          <br />
          {!fresh && (
            <>
              <span title="How many it guesses right at this moment, with the brain as it is now">
                right now it gets {c.right} right and {c.total - c.right} wrong
              </span>{" "}
              ·{" "}
            </>
          )}
          showing <span title="Cards that match the filters above">{lists[name].length}</span>
        </p>
        <div className="pile-scroll">
          <canvas
            ref={canvases[name]}
            onClick={(e) => {
              const i = at(name, e);
              if (i !== undefined) setSel({ pile: name, index: i });
            }}
            onMouseMove={(e) => {
              const i = at(name, e);
              e.currentTarget.title =
                i === undefined
                  ? ""
                  : fresh
                    ? `Label: ${CLASS_NAMES[piles[name].y[i]]}.`
                    : `Label: ${CLASS_NAMES[piles[name].y[i]]}. It guesses ${CLASS_NAMES[marks[name].guess[i]]}. How wrong: ${marks[name].loss[i].toFixed(2)} (0 is sure and right, about 1.1 is a wild guess).`;
            }}
          />
        </div>
      </section>
    );
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cards" role="dialog" aria-label="Browse the cards">
        <header>
          <div>
            <h2>Browse the cards</h2>
            <p className="say">{TEXT.cards}</p>
          </div>
          <button className="btn small" onClick={onClose} aria-label="Close">
            <X size={16} /> Close
          </button>
        </header>
        <div className="modal-tools">
          <span className="seg" role="group" aria-label="Filter by label">
            {["all shapes", ...CLASS_NAMES.map((n) => `${n}s`)].map((t, i) => (
              <button key={t} className={label === i - 1 ? "on" : ""} onClick={() => setLabel(i - 1)}>
                {t}
              </button>
            ))}
          </span>
          {!fresh && (
            <>
          <span className="seg" role="group" aria-label="Filter by result">
            {(["all", "right", "wrong"] as const).map((r) => (
              <button key={r} className={result === r ? "on" : ""} onClick={() => setResult(r)}>
                {r === "all" ? "any result" : r === "right" ? "got it right" : "got it wrong"}
              </button>
            ))}
          </span>
          <button type="button" role="switch" aria-checked={hardest} className={`toggle${hardest ? " on" : ""}`} onClick={() => setHardest(!hardest)}>
            <span className="knob" />
            hardest first <small>sort by how wrong</small>
          </button>
            </>
          )}
          <button
            className="btn small push-right"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(cardsFile(lab));
              a.download = "shape-stencil-cards.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            title="Saves both piles: each card is a 28 by 28 grid of numbers from 0 to 1, plus its label. A picture is just numbers too."
          >
            <Download size={16} /> Download the cards
          </button>
        </div>

        <div className="modal-body piles">
          {pileView("practice", "Practice pile", "it learns from these")}
          {pileView("test", "Test pile", "kept separate: it never practises on these")}
        </div>

        <footer>
          {picked && sel ? (
            <>
              <span>
                Picked a {sel.pile} card. Label: <b>{CLASS_NAMES[picked.y]}</b>.
                {!fresh && (
                  <>
                    {" "}It guesses <b>{CLASS_NAMES[picked.m.guess[sel.index]]}</b>, how wrong{" "}
                    <b title="How wrong on this card: 0 is sure and right, about 1.1 is a wild guess">{picked.m.loss[sel.index].toFixed(2)}</b>.
                  </>
                )}
              </span>
              <button className="btn" onClick={() => onPick(picked.x, picked.y, sel.pile, false)}>
                Put it on the pad
              </button>
              <button className="btn primary" onClick={() => onPick(picked.x, picked.y, sel.pile, true)}>
                <Snail size={18} /> Slow-mo on this card
              </button>
            </>
          ) : (
            <span>{fresh ? TEXT.freshCards : "Click a card to pick it. Under each card: its label, then a tick or cross and how wrong the brain is on it right now."}</span>
          )}
        </footer>
      </div>
    </div>
  );
}
