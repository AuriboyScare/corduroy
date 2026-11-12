/** Seeded PRNG (mulberry32). Deterministic across platforms. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash to [0, 1). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

// 16 unit gradient directions; a table is several times faster than cos/sin per lattice corner.
const GRAD_X = new Float64Array(16);
const GRAD_Z = new Float64Array(16);
for (let k = 0; k < 16; k++) {
  GRAD_X[k] = Math.cos((k / 16) * Math.PI * 2);
  GRAD_Z[k] = Math.sin((k / 16) * Math.PI * 2);
}

function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const k = (h >>> 20) & 15;
  return GRAD_X[k]! * dx + GRAD_Z[k]! * dz;
}

/** 2D gradient noise in roughly [-0.7, 0.7]. */
export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const a = grad(ix, iz, seed, fx, fz);
  const b = grad(ix + 1, iz, seed, fx - 1, fz);
  const c = grad(ix, iz + 1, seed, fx, fz - 1);
  const d = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  return a + (b - a) * u + (c - a + (d - b - c + a) * u) * v;
}

/** Fractal noise, roughly [-1, 1]. */
export function fbm2(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x, z, seed + o * 101) * amp;
    norm += amp * 0.7;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1]: sharp crests, rounded valleys. */
export function ridged2(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.min(1, Math.abs(noise2(x, z, seed + o * 57)) / 0.7);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.11;
    z *= 2.11;
  }
  return sum / norm;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
