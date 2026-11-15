"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { Lab } from "@/lib/lab";
import { F1, F2, Net, brainFromObject, brainToObject } from "@/lib/net";
import { CLASS_NAMES } from "@/lib/shapes";
import { maxAbs, paintGrid, prepare } from "@/lib/draw";
import { TEXT } from "@/lib/ideas";

/** Every knob in one flat list: layer-1 stencils, their starting pushes, layer 2, the judge. */
const PARTS = ["W1", "b1", "W2", "b2", "W3", "b3"] as const;
const OFFSET = { W1: 0, b1: 200, W2: 208, b2: 784, W3: 792, b3: 1392 };
const TOTAL = 1395;

function flat(net: Net): Float64Array {
  const out = new Float64Array(TOTAL);
  for (const p of PARTS) out.set(net[p], OFFSET[p]);
  return out;
}

/** Readable JSON: one row of numbers per line. */
function brainFile(lab: Lab, score: number): string {
  return JSON.stringify(brainToObject(lab.net, score)).replace(/\],\[/g, "],\n[").replace(/\{"/g, '\n{"');
}

function Knobs({ from, rows, cols, note }: { from: number; rows: number; cols: number; note: string }) {
  return (
    <div className="knobs" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }} title={note}>
      {Array.from({ length: rows * cols }, (_, i) => (
        <span key={i} data-k={from + i} />
      ))}
    </div>
  );
}
const Push = ({ k }: { k: number }) => (
  <span className="push" title="This unit’s starting push (bias): a number added before any dots are looked at.">
    + <span data-k={k} data-push />
  </span>
);

export default function BrainView({ lab, onClose, onLoaded }: { lab: Lab; onClose: () => void; onLoaded: () => void }) {
  const root = useRef<HTMLDivElement | null>(null);
  const pics = useRef<(HTMLCanvasElement | null)[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [meta, setMeta] = useState({ kb: 0, score: 0 });
  const [message, setMessage] = useState("");

  // live numbers: refresh a few times a second, and flash the knobs the last nudges changed most
  useEffect(() => {
    const spans: HTMLElement[] = [];
    root.current!.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => (spans[Number(el.dataset.k)] = el));
    let prev: Float64Array | null = null;
    let version = -1;
    let count = 0;
    const tick = () => {
      const net = lab.net;
      const v = flat(net);
      const scale = { W1: maxAbs(net.W1, 0, 200) || 1, W2: maxAbs(net.W2, 0, 576) || 1, W3: maxAbs(net.W3, 0, 600) || 1 };
      let cut = Infinity;
      if (prev && lab.version !== version) {
        const d = Array.from(v, (x, i) => Math.abs(x - prev![i])).sort((a, b) => b - a);
        cut = Math.max(d[30], 1e-9);
      }
      for (let i = 0; i < TOTAL; i++) {
        const el = spans[i];
        el.textContent = v[i].toFixed(2);
        if (!("push" in el.dataset)) {
          const m = i < 200 ? scale.W1 : i < 784 ? scale.W2 : scale.W3;
          const a = Math.min(1, Math.abs(v[i]) / m);
          el.style.background = v[i] >= 0 ? `rgba(242,125,22,${a * 0.85})` : `rgba(38,104,222,${a * 0.85})`;
        }
        if (prev && Math.abs(v[i] - prev[i]) > cut) el.animate([{ boxShadow: "0 0 0 3px #e0387a", zIndex: 2 }, { boxShadow: "0 0 0 0 transparent" }], { duration: 700 });
      }
      for (let f = 0; f < F1; f++) {
        const cv = pics.current[f];
        if (cv) paintGrid(prepare(cv, 60, 60), net.W1, f * 25, 5, 5, 1 / (maxAbs(net.W1, f * 25, 25) || 1), "heat", 0, 0, 60, 60);
      }
      prev = v;
      version = lab.version;
      if (count++ % 4 === 0) {
        const score = lab.latestAcc?.acc ?? 0;
        setMeta({ kb: new Blob([brainFile(lab, score)]).size / 1024, score });
      }
    };
    tick();
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [lab]);

  const download = () => {
    const score = lab.accuracyOn(lab.test); // marked fresh, so the file says exactly what this brain scores
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([brainFile(lab, score)], { type: "application/json" }));
    a.download = `shape-stencil-brain-${Math.round(score * 100)}pct.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(`Saved. This brain scores ${(score * 100).toFixed(1)}% on the test cards.`);
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const saved = JSON.parse(await file.text());
      lab.loadBrain(brainFromObject(saved));
      lab.flush();
      onLoaded();
      const now = lab.latestAcc!.acc;
      setMessage(
        `Loaded ${file.name}. With no training at all it scores ${(now * 100).toFixed(1)}% on the test cards` +
          (typeof saved.testScore === "number" ? ` (the file said ${(saved.testScore * 100).toFixed(1)}%).` : ".") +
          " The knowledge lives in the numbers.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That file could not be read.");
    }
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal brain" ref={root} role="dialog" aria-label="Look inside the brain">
        <header>
          <div>
            <h2>Look inside the brain</h2>
            <p className="say">{TEXT.brain}</p>
            <p className="count" title="208 knobs in layer 1, 584 in layer 2 and 603 in the judge">
              {TEXT.brainSize}
            </p>
          </div>
          <button className="btn small" onClick={onClose} aria-label="Close">
            <X size={16} /> Close
          </button>
        </header>
        <div className="modal-tools">
          <button className="btn primary" onClick={download}>
            <Download size={18} /> Download the brain
            <small title="The size of the saved file, and this brain’s score on the 300 test cards">
              {meta.kb.toFixed(0)} KB · test score {Math.round(meta.score * 100)}%
            </small>
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <Upload size={18} /> Load a brain
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="msg" role="status">{message || "The numbers update while it trains. The ones that just changed most flash pink."}</span>
        </div>

        <div className="modal-body">
          <h3>
            Layer 1 stencils <small>8 × (25 + 1) = 208 knobs</small>
          </h3>
          <div className="brain-row">
            {Array.from({ length: F1 }, (_, f) => (
              <div className="brain-block" key={f}>
                <b>Stencil {f + 1}</b>
                <div className="pair">
                  <canvas ref={(el) => { pics.current[f] = el; }} style={{ width: 60, height: 60 }} title={`Stencil ${f + 1} as a picture: orange wants ink, blue wants empty`} />
                  <Knobs from={f * 25} rows={5} cols={5} note={`The 25 knobs (weights) of stencil ${f + 1}, laid out like its picture`} />
                </div>
                <Push k={OFFSET.b1 + f} />
              </div>
            ))}
          </div>

          <h3>
            Layer 2 stencils <small>8 × (8 × 9 + 1) = 584 knobs · one 3 × 3 grid for each layer-1 map</small>
          </h3>
          <div className="brain-row">
            {Array.from({ length: F2 }, (_, u) => (
              <div className="brain-block" key={u}>
                <b>Unit {u + 1}</b>
                <div className="grids2">
                  {Array.from({ length: F1 }, (_, f) => (
                    <Knobs key={f} from={OFFSET.W2 + (u * F1 + f) * 9} rows={3} cols={3} note={`Unit ${u + 1}: the 9 knobs it uses to look at the map from layer-1 stencil ${f + 1}`} />
                  ))}
                </div>
                <Push k={OFFSET.b2 + u} />
              </div>
            ))}
          </div>

          <h3>
            The judge <small>3 × (200 + 1) = 603 knobs · one row of 200 for each answer</small>
          </h3>
          {CLASS_NAMES.map((name, c) => (
            <div className="judge-row" key={c}>
              <b>{name}</b>
              <div className="grids8">
                {Array.from({ length: F2 }, (_, u) => (
                  <Knobs key={u} from={OFFSET.W3 + c * 200 + u * 25} rows={5} cols={5} note={`How many points for “${name}” each of unit ${u + 1}’s 25 values is worth`} />
                ))}
              </div>
              <Push k={OFFSET.b3 + c} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
