/** Draws triangles on the real pad with the mouse and reports what the trained network says. */
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(process.argv[2] ?? "http://localhost:3311");
  await page.waitForFunction("window.stencilLab");
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.waitForTimeout(Number(process.env.TRAIN_MS ?? 15000));
  await page.getByRole("button", { name: "Pause" }).click();
  let wins = 0, n = 0;
  for (const [cx, cy, r, rot] of [[14, 15, 9, -1.57], [8, 9, 6, 0.3], [19, 19, 7, 1.1], [20, 8, 6, 2.0], [9, 20, 7, -0.6], [14, 14, 11, 0.9], [10, 10, 5, 0], [18, 12, 8, 2.6], [13, 18, 8, 0.5], [7, 20, 5, 1.0]]) {
    await page.getByRole("button", { name: "Clear" }).click();
    await page.evaluate("window.scrollTo(0, 0)");
    const box = (await page.locator("canvas.pad").boundingBox())!;
    const pts = [0, 1, 2, 0].map((k) => [box.x + ((cx + r * Math.cos(rot + k * 2.0944)) / 28) * box.width, box.y + ((cy + r * Math.sin(rot + k * 2.0944)) / 28) * box.height]);
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const b = await page.$$eval(".bar-row", (rows) => rows.map((x) => x.querySelector(".bar-pct")!.textContent).join(" "));
    const v = await page.locator(".verdict-line").textContent();
    n++;
    if (v!.toLowerCase().includes("triangle")) wins++;
    console.log(`(${cx},${cy}) r=${r} rot=${rot}: ${b} -> ${v}`);
    if (process.argv[3]) await page.screenshot({ path: `${process.argv[3]}/dbg-${n}.png`, clip: { x: 0, y: 80, width: 1500, height: 680 } });
  }
  console.log(`triangles recognised ${wins}/${n}`);
  await browser.close();
})();
