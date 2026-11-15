/** Seeded random numbers (mulberry32), so the same seed always replays the same lab. */
export class RNG {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal (Box-Muller). */
  gauss(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    while (u < 1e-12) u = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * this.next();
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  shuffle(a: Int32Array | number[]): void {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }
}

/** Turn any text typed in the seed box into a 32-bit seed. */
export function seedFromText(text: string): number {
  const t = text.trim();
  if (/^\d{1,9}$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
