export function normalizeSeed(seed: number): number {
  return seed >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = normalizeSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(seed: number, x: number, z: number): number {
  let h = normalizeSeed(seed);
  h ^= Math.imul(x, 0x9e3779b1);
  h ^= Math.imul(z, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hashSeed(seed: number): number {
  let h = normalizeSeed(seed);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function createRandomSeed(source = Date.now()): number {
  return normalizeSeed(Math.imul(source >>> 0, 0x9e3779b1) ^ Math.floor(Math.random() * 0xffffffff));
}
