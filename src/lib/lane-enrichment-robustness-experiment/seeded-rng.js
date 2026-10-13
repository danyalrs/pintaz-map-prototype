/** Mulberry32 — fixed seed for reproducible synthetic noise. */
export function createRng(seed = 0x1a2b3c4d) {
  let s = seed >>> 0;
  return function next() {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EXPERIMENT_SEED = 0x4c414e45; // 'LANE'
