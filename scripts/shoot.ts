/**
 * Drives the real page in headless Chromium: takes screenshots and measures the acceptance checks
 * that need a browser (training speed, responsiveness, drawing a triangle, centred-only).
 * Usage: tsx scripts/shoot.ts [url] [outDir] [quick]
 */
import { chromium, Page } from "playwright";

const url = process.argv[2] ?? "http://localhost:3311";
const out = process.argv[3] ?? "shots";
const quick = process.argv[4] === "quick";

async function stats(page: Page) {
  return page.evaluate(() => {
    const L = (window as any).stencilLab;
    const a = L.latestAcc;
    return { step: L.step, examples: L.examplesSeen, acc: a?.acc, wide: a?.wide, trainMs: L.trainMs, reached85Ms: L.reached85Ms };
  });
}
async function bars(page: Page) {
  return page.$$eval(".bar-row", (rows) => rows.map((r) => `${r.querySelector(".bar-name")!.textContent}=${r.querySelector(".bar-pct")!.textContent}`).join(" "));
}
async function fps(page: Page, ms: number): Promise<{ fps: number; worstGap: number }> {
  // passed as text so the bundler does not inject helpers the page does not have
  return page.evaluate(`new Promise((res) => {
    let n = 0, last = performance.now(), worst = 0;
    const t0 = last;
    function tick(t) {
      n++;
      worst = Math.max(worst, t - last);
      last = t;
      if (t - t0 < ${ms}) requestAnimationFrame(tick);
      else res({ fps: Math.round((n / (t - t0)) * 1000), worstGap: Math.round(worst) });
    }
    requestAnimationFrame(tick);
  })`);
}
/** Draw a closed polygon on the pad with the mouse. Points are in grid cells (0..28). */
async function drawPoly(page: Page, pts: [number, number][]) {
  await page.getByRole("button", { name: "Clear" }).click();
  await page.evaluate("window.scrollTo(0, 0)");
  const box = (await page.locator("canvas.pad").boundingBox())!;
  const P = (p: [number, number]) => [box.x + (p[0] / 28) * box.width, box.y + (p[1] / 28) * box.height] as const;
  const all = [...pts, pts[0]];
  await page.mouse.move(...P(all[0]));
  await page.mouse.down();
  for (let i = 1; i < all.length; i++) await page.mouse.move(...P(all[i]), { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
const tri = (cx: number, cy: number, r: number, rot = -Math.PI / 2): [number, number][] =>
  [0, 1, 2].map((k) => [cx + r * Math.cos(rot + (k * 2 * Math.PI) / 3), cy + r * Math.sin(rot + (k * 2 * Math.PI) / 3)]);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).stencilLab);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/01-start.png`, fullPage: true });

  await page.locator(".stencil").nth(2).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/02-hover-stencil.png` });
  await page.mouse.move(5, 5);

  // train for 30 seconds of wall-clock time
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.waitForTimeout(2000);
  const early = await fps(page, 3000);
  await page.screenshot({ path: `${out}/03-training-5s.png`, fullPage: true });
  if (!quick) await page.waitForTimeout(25000);
  const s30 = await stats(page);
  console.log("after ~30 s of training:", JSON.stringify(s30), "| frames/s while training:", JSON.stringify(early));
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/04-trained.png`, fullPage: true });

  await page.locator(".stencil").nth(1).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/05-stencil-numbers.png` });
  {
    const box = (await page.locator("canvas.pad").boundingBox())!;
    await page.mouse.move(box.x + 150, box.y + 30);
    await page.mouse.move(box.x + 110, box.y + 110, { steps: 5 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/05b-slide-by-hand.png` });
  }
  await page.keyboard.press("Escape");
  await page.locator(".unit").nth(3).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/06-hover-unit.png` });
  await page.mouse.move(5, 5);

  // draw triangles in different places
  const spots: [number, number, number, number][] = [[14, 15, 9, -Math.PI / 2], [8, 9, 6, 0.3], [19, 19, 7, 1.1], [20, 8, 6, 2.0], [9, 20, 7, -0.6], [14, 14, 11, 0.9]];
  let wins = 0;
  for (const [cx, cy, r, rot] of spots) {
    await drawPoly(page, tri(cx, cy, r, rot));
    const b = await bars(page);
    const verdict = (await page.locator(".verdict-line").textContent()) ?? "";
    if (verdict.toLowerCase().includes("triangle")) wins++;
    console.log(`triangle at (${cx},${cy}) r=${r}: ${b} -> ${await page.locator(".verdict-line").textContent()}`);
  }
  console.log(`drawn triangles recognised: ${wins}/${spots.length}`);
  await page.screenshot({ path: `${out}/07-drawn-triangle.png`, fullPage: true });

  // story mode
  await page.getByRole("button", { name: "Story mode" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/08-story-1.png`, fullPage: true });
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/09-story-5.png`, fullPage: true });
  await page.getByRole("button", { name: "Done" }).click();

  // centred only
  if (!quick) {
    await page.getByRole("switch", { name: "centred only" }).click();
    await page.getByRole("button", { name: "Reset to apply" }).click();
    await page.getByRole("button", { name: "Train", exact: true }).click();
    await page.waitForTimeout(20000);
    await page.getByRole("button", { name: "Pause" }).click();
    console.log("centred-only after 20 s:", JSON.stringify(await stats(page)));
    await drawPoly(page, tri(7, 7, 5.5, 0.4));
    console.log("triangle in a corner, centred-only network:", await bars(page));
    await drawPoly(page, tri(14, 14, 8, 0.4));
    console.log("triangle in the middle, centred-only network:", await bars(page));
    await page.screenshot({ path: `${out}/10-centred-only.png`, fullPage: true });
  }

  // under the hood: run the gradient check in the browser
  await page.locator("details.hood summary").click();
  await page.getByRole("button", { name: /Run the check/ }).click();
  await page.waitForTimeout(400);
  const verdicts = await page.$$eval("table.math tbody td:last-child", (tds) => tds.map((t) => t.textContent).join(","));
  console.log("in-browser gradient check:", verdicts);
  await page.locator("details.hood").screenshot({ path: `${out}/13-under-the-hood.png` });

  // stretch goal: the 4th class
  if (!quick) {
    await page.evaluate("window.scrollTo(0, 0)");
    if (await page.getByRole("switch", { name: "centred only" }).getAttribute("aria-checked") === "true")
      await page.getByRole("switch", { name: "centred only" }).click();
    await page.getByRole("switch", { name: /4th shape/ }).click();
    await page.getByRole("button", { name: /Reset/ }).click();
    await page.getByRole("button", { name: "Train", exact: true }).click();
    await page.waitForTimeout(20000);
    await page.getByRole("button", { name: "Pause" }).click();
    console.log("4 classes after 20 s:", JSON.stringify(await stats(page)));
    await page.evaluate("window.scrollTo(0, 0)");
    await page.screenshot({ path: `${out}/14-four-classes.png`, fullPage: true });
  }

  // tablet width
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/11-tablet.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/12-laptop-1280.png`, fullPage: true });

  console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
  await browser.close();
})();
