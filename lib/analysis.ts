/**
 * How "line-like" is a 5x5 stencil? An edge or line detector changes along one direction only,
 * so we look for the direction that explains most of the pattern. 0 = speckle, 1 = perfect stripes.
 * Used by the automatic checks (the lab itself never labels stencils).
 */
export function orientedShare(w: ArrayLike<number>, offset = 0): number {
  let mean = 0;
  for (let i = 0; i < 25; i++) mean += w[offset + i] / 25;
  let total = 0;
  for (let i = 0; i < 25; i++) total += (w[offset + i] - mean) ** 2;
  if (total <= 0) return 0;
  let best = 0;
  for (let deg = 0; deg < 180; deg += 15) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const sum = new Float64Array(5);
    const cnt = new Float64Array(5);
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++) {
        const t = (x - 2) * c + (y - 2) * s; // position across the stripes
        const bin = Math.max(0, Math.min(4, Math.round(t / 1.15) + 2));
        sum[bin] += w[offset + y * 5 + x] - mean;
        cnt[bin]++;
      }
    let explained = 0;
    for (let b = 0; b < 5; b++) if (cnt[b]) explained += (sum[b] * sum[b]) / cnt[b];
    if (explained > best) best = explained;
  }
  return best / total;
}
