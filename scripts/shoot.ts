/**
 * Drives the real page in headless Chromium: screenshots, plus the checks that need a browser
 * (slow-mo, speed, responsiveness, drawing, try a star, download and load a brain, the card browser).
 * Usage: tsx scripts/shoot.ts [url] [outDir] [quick]
 */
import { chromium, Page } from "playwright";
import { readFileSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:3311";
const out = process.argv[3] ?? "shots";
const quick = process.argv[4] === "quick";
const say = (k: string, v: unknown) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const stats = (page: Page) =>
  page.evaluate(`(() => { const L = window.stencilLab, a = L.latestAcc; return { step: L.step, acc: a && a.acc, wide: a && a.wide, reached85s: L.reached85Ms && +(L.reached85Ms / 1000).toFixed(1), seconds: +(L.trainMs / 1000).toFixed(1) }; })()`);
const knobSum = (page: Page) => page.evaluate(`(() => { const n = window.stencilLab.net; let s = 0; for (const k of ["W1","b1","W2","b2","W3","b3"]) for (const v of n[k]) s += v; return s; })()`);
const teach = async (page: Page) => (await page.locator(".teach-line").textContent()) + " | " + (await page.locator(".teach-sub").textContent());
const fps = (page: Page, ms: number) =>
  page.evaluate(`new Promise((res) => { let n = 0, last = performance.now(), worst = 0; const t0 = last;
    function tick(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ${ms}) requestAnimationFrame(tick); else res({ fps: Math.round(n / (t - t0) * 1000), worstGapMs: Math.round(worst) }); }
    requestAnimationFrame(tick); })`);

/** Draw a closed outline on the pad with the mouse. Points are in dots (0..28). */
async function draw(page: Page, pts: number[][]) {
  await page.getByRole("button", { name: "Clear and draw" }).click();
  await page.evaluate("window.scrollTo(0, 0)");
  const box = (await page.locator("canvas.pad").boundingBox())!;
  const P = (p: number[]) => [box.x + (p[0] / 28) * box.width, box.y + (p[1] / 28) * box.height] as const;
  await page.mouse.move(...P(pts[0]));
  await page.mouse.down();
  for (const p of [...pts.slice(1), pts[0]]) await page.mouse.move(...P(p), { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  return page.$$eval(".bar-row", (rows) => rows.map((r) => ({ name: r.querySelector(".bar-name")!.textContent!, pct: parseInt(r.querySelector(".bar-pct")!.textContent!) })).sort((a, b) => b.pct - a.pct)[0].name);
}
const poly = (n: number, cx: number, cy: number, r: number, rot: number) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos(rot + (k * 2 * Math.PI) / n), cy + r * Math.sin(rot + (k * 2 * Math.PI) / n)]);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction("window.stencilLab");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/01-start.png`, fullPage: true });
  await page.getByRole("button", { name: "Flip the card" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/02-flipped.png` });

  // slow-mo: five stages on one card, after a little training so there is something to see
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(400);
  const before = await knobSum(page);
  await page.getByRole("button", { name: "Slow-mo", exact: true }).click();
  for (let stage = 1; stage <= 5; stage++) {
    await page.waitForTimeout(stage === 2 ? 2600 : 700);
    say(`slow-mo stage ${stage}`, await teach(page));
    if (stage === 3) {
      const sum = (await page.locator(".sum").textContent())!;
      const bet = Number(/bet ([\d.]+)%/.exec(sum)![1]) / 100;
      const [, p, loss] = /ln\(([\d.e-]+)\) = ([\d.]+)/.exec(sum)!;
      say("stage 3 sum", `${sum.replace(/\s+/g, " ")} -> bet ${bet}, ln of ${p}, shown ${loss}, recomputed ${(-Math.log(Number(p))).toFixed(2)}; consistent: ${Math.abs(bet - Number(p)) < 1e-9 && (-Math.log(Number(p))).toFixed(2) === loss}`);
    }
    await page.screenshot({ path: `${out}/03-slowmo-${stage}.png` });
    if (stage < 5) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  say("slow-mo left the brain unchanged", (await knobSum(page)) === before);
  await page.getByRole("button", { name: "Stop" }).click();

  // fast training for 30 seconds by the clock
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.waitForTimeout(2000);
  const speed = await fps(page, 3000);
  await page.screenshot({ path: `${out}/04-training.png`, fullPage: true });
  if (!quick) await page.waitForTimeout(25000);
  say("after ~30 s of training", await stats(page));
  say("frames a second while training", speed);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/05-trained.png`, fullPage: true });

  // draw each shape in several places
  const places = [[14, 14, 9, -1.57], [9, 9, 6, 0.3], [19, 18, 7, 1.1], [19, 9, 6, 2.0], [10, 18, 7, 0.5], [14, 14, 11, 0.9]];
  for (const [n, name] of [[3, "triangle"], [4, "square"], [24, "circle"]] as const) {
    let wins = 0;
    for (const [cx, cy, r, rot] of places) if ((await draw(page, poly(n, cx, cy, r, rot))) === name) wins++;
    say(`mouse-drawn ${name}s recognised`, `${wins}/${places.length}`);
  }
  await page.screenshot({ path: `${out}/06-drawn.png` });

  // try a star: it has to choose one of the three boxes
  const picks: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Try a star" }).click();
    await page.waitForTimeout(250);
    picks.push((await page.locator(".marking b").textContent())!);
  }
  say("try a star picked", picks.join(", ") + " | " + (await teach(page)));
  await page.screenshot({ path: `${out}/07-star.png` });

  // look inside the brain: download it, reset, load it back
  await page.getByRole("button", { name: "Look inside the brain" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/08-brain.png` });
  say("numbers shown in the brain view", await page.locator(".modal [data-k]").count());
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download the brain/ }).click()]);
  const file = `${out}/brain.json`;
  await download.saveAs(file);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(600);
  const fresh = (await stats(page)) as { acc: number };
  await page.getByRole("button", { name: "Look inside the brain" }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(600);
  const loaded = (await stats(page)) as { acc: number; step: number };
  say("download and load a brain", `${(readFileSync(file).length / 1024).toFixed(1)} KB, ${saved.knobs} knobs; file says ${saved.testScore}; fresh reset scored ${fresh.acc}; after loading ${loaded.acc} at step ${loaded.step}; exact match: ${loaded.acc === saved.testScore}`);
  await page.screenshot({ path: `${out}/09-brain-loaded.png` });
  await page.getByRole("button", { name: "Close" }).click();

  // browse the cards
  await page.getByRole("button", { name: "Browse the cards" }).click();
  await page.waitForTimeout(800);
  say("card piles", (await page.locator(".pile-counts").allTextContents()).map((t) => t.replace(/\s+/g, " ")).join(" || "));
  await page.getByRole("switch", { name: /hardest first/ }).click();
  await page.getByRole("button", { name: "got it wrong" }).click();
  await page.waitForTimeout(400);
  await page.locator(".pile.practice canvas").click({ position: { x: 30, y: 30 } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/10-cards.png` });
  say("picked card", (await page.locator(".modal footer span").textContent())!.replace(/\s+/g, " "));
  await page.getByRole("button", { name: /Slow-mo on this card/ }).click();
  await page.waitForTimeout(600);
  say("slow-mo on a picked card", await teach(page));
  await page.getByRole("button", { name: "Stop" }).click();

  // story mode
  await page.evaluate("window.scrollTo(0, 0)");
  await page.getByRole("button", { name: "Story mode" }).click();
  const steps: string[] = [];
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(250);
    steps.push((await page.locator(".teach-name").textContent())!.trim());
    if (i === 0 || i === 6) await page.screenshot({ path: `${out}/11-story-${i + 1}.png` });
    await page.getByRole("button", { name: i < 6 ? "Next idea" : "Finish" }).click();
  }
  say("story steps", steps.join(" > "));

  // centred only
  if (!quick) {
    await page.getByRole("switch", { name: "centred only" }).click();
    await page.getByRole("button", { name: "Reset to apply" }).click();
    await page.getByRole("button", { name: "Train", exact: true }).click();
    await page.waitForTimeout(20000);
    await page.getByRole("button", { name: "Pause" }).click();
    say("centred-only after 20 s", await stats(page));
    say("small triangle in a corner, centred-only brain", await draw(page, poly(3, 6.5, 6.5, 4.5, 0.4)));
    await page.evaluate("window.scrollTo(0, 0)");
    await page.screenshot({ path: `${out}/12-centred-only.png`, fullPage: true });
  }

  const untitled = await page.evaluate(`[...document.querySelectorAll(".lab *")].filter((e) => e.children.length === 0 && /\\d/.test(e.textContent) && !e.closest("[title]") && !e.closest("h1,h2,.letter,.num,small,.teach-num,.idea-dots,.teach-line,.teach-sub,.hint,.field-note,.versus,.fast,.boxes,.note,.sub,.zoom")).map((e) => e.textContent.trim().slice(0, 40))`);
  say("numbers without a hover note", untitled);

  for (const [w, h, name] of [[1024, 1366, "13-tablet"], [1280, 800, "14-laptop-1280"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  }
  console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
  await browser.close();
})();
