import { hash2 } from './rng.js';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = smoothstep(x - x0);
  const zf = smoothstep(z - z0);

  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);

  return lerp(lerp(a, b, xf), lerp(c, d, xf), zf);
}

export function fractalNoise2(
  seed: number,
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2,
  persistence = 0.5
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let max = 0;

  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2(seed + octave * 1013, x * frequency, z * frequency) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return max === 0 ? 0 : value / max;
}
