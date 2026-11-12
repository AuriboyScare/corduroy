import { clamp01, fbm2, hash2, ridged2, smoothstep } from '../rng';
import { Grid } from './grid';

/** Values per tree in Mountain.trees: x, z, height (m), random seed in [0, 1). */
export const TREE_STRIDE = 4;

export interface Mountain {
  readonly name: string;
  readonly seed: number;
  readonly grid: Grid;
  /** Bare ground height in metres above the valley datum, one value per grid sample. */
  readonly ground: Float32Array;
  /** 1 where a sample lies on the marked piste. */
  readonly pisteMask: Uint8Array;
  readonly pisteCellCount: number;
  /** Piste centreline as x, z pairs from top to bottom. */
  readonly pisteLine: Float32Array;
  readonly trees: Float32Array;
  readonly treeCount: number;
  /** Where machinery is parked. heading is radians; forward is (sin, 0, cos). */
  readonly depot: { x: number; z: number; heading: number };
  /** Altitude of the datum above sea level, for display. */
  readonly datumAltitudeM: number;
  /** Analytic terrain beyond the editable map, used to draw the horizon. */
  heightOutside(x: number, z: number): number;
}

const SIZE = 2048;
const PEAK_X = 1024;
const PEAK_Z = 380;
const PEAK_H = 470;
const PISTE_HALF_WIDTH = 21;
const DEPOT = { x: 1024, z: 1890, radius: 46 };
const PISTE_CONTROL: ReadonlyArray<readonly [number, number]> = [
  [1024, 470],
  [1010, 600],
  [905, 800],
  [1075, 1040],
  [955, 1290],
  [1045, 1540],
  [1024, 1760],
  [1024, 1850],
];

function radial(x: number, z: number): number {
  const dx = (x - PEAK_X) * 0.62;
  const dz = z - PEAK_Z;
  return Math.sqrt(dx * dx + (dz > 0 ? dz * dz : dz * dz * 3.6)) / 1500;
}

/** Large-scale mountain shape without small detail. */
function massif(x: number, z: number, seed: number): number {
  const u = radial(x, z);
  const main = PEAK_H * 0.5 * (1 + Math.cos(Math.PI * Math.min(u, 1)));
  const spurs = (ridged2(x / 420, z / 420, seed, 4) - 0.5) * 110 * Math.sin(Math.PI * clamp01(u * 1.1));
  const dc = Math.sqrt((x - SIZE / 2) * (x - SIZE / 2) + (z - SIZE / 2) * (z - SIZE / 2));
  if (dc <= 1100) return main + spurs;
  return main + spurs + smoothstep(1100, 2600, dc) * (120 + 700 * ridged2(x / 1900, z / 1900, seed + 9, 5));
}

function detail(x: number, z: number, seed: number): number {
  return fbm2(x / 90, z / 90, seed + 3, 4) * 9 + fbm2(x / 17, z / 17, seed + 5, 3) * 1.1;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** Samples the piste centreline at an even `spacing` in metres of arc length. Returns x, z pairs. */
function sampleCentreline(spacing: number): number[] {
  // Dense pass along the spline, then walk it at even arc-length steps.
  const dense: number[] = [];
  const pts = PISTE_CONTROL;
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = pts[Math.max(0, s - 1)]!;
    const p1 = pts[s]!;
    const p2 = pts[s + 1]!;
    const p3 = pts[Math.min(pts.length - 1, s + 2)]!;
    const steps = Math.max(8, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      dense.push(catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t));
    }
  }
  const last = pts[pts.length - 1]!;
  dense.push(last[0], last[1]);

  const out: number[] = [dense[0]!, dense[1]!];
  let carried = 0;
  for (let k = 1; k < dense.length / 2; k++) {
    const ax = dense[k * 2 - 2]!;
    const az = dense[k * 2 - 1]!;
    const dx = dense[k * 2]! - ax;
    const dz = dense[k * 2 + 1]! - az;
    const length = Math.sqrt(dx * dx + dz * dz);
    let at = spacing - carried;
    while (at <= length) {
      out.push(ax + (dx * at) / length, az + (dz * at) / length);
      at += spacing;
    }
    carried = length - (at - spacing);
  }
  // Open up the bends: a tight inside line would be far steeper than the centreline and would
  // crease where the grading folds over itself.
  const count = out.length / 2;
  const smoothed = new Float64Array(out.length);
  const window = Math.round(44 / spacing);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      let sx = 0;
      let sz = 0;
      for (let k = i - window; k <= i + window; k++) {
        const c = Math.max(0, Math.min(count - 1, k));
        sx += out[c * 2]!;
        sz += out[c * 2 + 1]!;
      }
      smoothed[i * 2] = sx / (2 * window + 1);
      smoothed[i * 2 + 1] = sz / (2 * window + 1);
    }
    for (let i = 0; i < out.length; i++) out[i] = smoothed[i]!;
  }
  return out;
}

/** Builds the prototype mountain: one massif, one graded piste, a depot pad and forest. */
export function generateMountain(seed: number): Mountain {
  const grid = new Grid(SIZE + 1, 1);
  const n = grid.n;
  const ground = new Float32Array(grid.count);

  // Piste profile: follow the massif, smoothed, always descending and never steeper than a cat can work.
  const line = sampleCentreline(2);
  const m = line.length / 2;
  const raw = new Float32Array(m);
  for (let i = 0; i < m; i++) raw[i] = massif(line[i * 2]!, line[i * 2 + 1]!, seed);
  const profile = new Float32Array(m);
  const radius = 25;
  for (let i = 0; i < m; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(m - 1, i + radius); k++) {
      sum += raw[k]!;
      count++;
    }
    profile[i] = sum / count;
  }
  const minRise = Math.tan((3 * Math.PI) / 180);
  const maxRise = Math.tan((20 * Math.PI) / 180);
  for (let i = m - 2; i >= 0; i--) {
    const ds = Math.hypot(line[i * 2]! - line[i * 2 + 2]!, line[i * 2 + 1]! - line[i * 2 + 3]!);
    const below = profile[i + 1]!;
    profile[i] = Math.min(below + ds * maxRise, Math.max(below + ds * minRise, profile[i]!));
  }
  // Clamping leaves kinks where the grade changes abruptly; round them off. Averaging keeps the
  // profile descending and within the same grade limits.
  const rounded = new Float32Array(m);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let k = i - 10; k <= i + 10; k++) sum += profile[Math.max(0, Math.min(m - 1, k))]!;
      rounded[i] = sum / 21;
    }
    profile.set(rounded);
  }
  const depotHeight = profile[m - 1]!;

  // Nearest centreline sample for every cell within reach of the piste.
  const dist = new Float32Array(grid.count).fill(1e9);
  const nearestSample = new Uint16Array(grid.count);
  const reach = 62;
  for (let i = 0; i < m; i++) {
    const cx = line[i * 2]!;
    const cz = line[i * 2 + 1]!;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(n - 1, Math.ceil(cx + reach));
    const z0 = Math.max(0, Math.floor(cz - reach));
    const z1 = Math.min(n - 1, Math.ceil(cz + reach));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const d2 = (ix - cx) * (ix - cx) + (iz - cz) * (iz - cz);
        const j = ix + iz * n;
        if (d2 < dist[j]!) {
          dist[j] = d2;
          nearestSample[j] = i;
        }
      }
    }
  }
  // Refine to the closest point on the centreline itself, so the graded height varies smoothly
  // along the piste instead of stepping from one sample to the next.
  const graded = new Float32Array(grid.count);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const j = ix + iz * n;
      if (dist[j]! >= 1e9) continue;
      const i = nearestSample[j]!;
      let best = dist[j]!;
      let height = profile[i]!;
      for (let a = Math.max(0, i - 1); a <= Math.min(m - 2, i); a++) {
        const ax = line[a * 2]!;
        const az = line[a * 2 + 1]!;
        const bx = line[a * 2 + 2]! - ax;
        const bz = line[a * 2 + 3]! - az;
        const t = Math.max(0, Math.min(1, ((ix - ax) * bx + (iz - az) * bz) / (bx * bx + bz * bz)));
        const dx = ix - (ax + bx * t);
        const dz = iz - (az + bz * t);
        const d2 = dx * dx + dz * dz;
        if (d2 <= best) {
          best = d2;
          height = profile[a]! + (profile[a + 1]! - profile[a]!) * t;
        }
      }
      dist[j] = best;
      graded[j] = height;
    }
  }

  const pisteMask = new Uint8Array(grid.count);
  let pisteCellCount = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const j = ix + iz * n;
      const d = Math.sqrt(dist[j]!);
      const shape = massif(ix, iz, seed);
      const blend = 1 - smoothstep(PISTE_HALF_WIDTH + 2, reach - 4, d);
      let h = shape + detail(ix, iz, seed) * (1 - 0.9 * blend);
      if (blend > 0) h += (graded[j]! - shape) * blend;
      const dr = Math.sqrt((ix - DEPOT.x) * (ix - DEPOT.x) + (iz - DEPOT.z) * (iz - DEPOT.z));
      const pad = 1 - smoothstep(DEPOT.radius, DEPOT.radius + 34, dr);
      if (pad > 0) h += (depotHeight - h) * pad;
      ground[j] = h;
      if (d <= PISTE_HALF_WIDTH) {
        pisteMask[j] = 1;
        pisteCellCount++;
      }
    }
  }

  // Forest: jittered grid, thinned by noise, altitude and slope; cleared around the piste and depot.
  const spacing = 6.5;
  const cells = Math.floor(SIZE / spacing);
  const trees: number[] = [];
  for (let cz = 1; cz < cells - 1; cz++) {
    for (let cx = 1; cx < cells - 1; cx++) {
      const x = (cx + hash2(cx, cz, seed + 21)) * spacing;
      const z = (cz + hash2(cx, cz, seed + 22)) * spacing;
      const j = grid.nearest(x, z);
      if (dist[j]! < (PISTE_HALF_WIDTH + 9) ** 2) continue;
      if (Math.hypot(x - DEPOT.x, z - DEPOT.z) < DEPOT.radius + 16) continue;
      const y = ground[j]!;
      const sx = (grid.sample(ground, x + 2, z) - grid.sample(ground, x - 2, z)) / 4;
      const sz = (grid.sample(ground, x, z + 2) - grid.sample(ground, x, z - 2)) / 4;
      const slope = Math.hypot(sx, sz);
      const cover =
        (0.5 + 0.9 * fbm2(x / 260, z / 260, seed + 30, 3)) *
        (1 - smoothstep(285, 365, y)) *
        (1 - smoothstep(0.62, 0.85, slope));
      if (hash2(cx, cz, seed + 23) > cover) continue;
      const vigour = 1 - 0.55 * smoothstep(220, 365, y);
      trees.push(x, z, (9 + 15 * hash2(cx, cz, seed + 24)) * vigour, hash2(cx, cz, seed + 25));
    }
  }

  return {
    name: 'Prototype massif',
    seed,
    grid,
    ground,
    pisteMask,
    pisteCellCount,
    pisteLine: Float32Array.from(line),
    trees: Float32Array.from(trees),
    treeCount: trees.length / TREE_STRIDE,
    depot: { x: DEPOT.x, z: DEPOT.z, heading: Math.PI },
    datumAltitudeM: 1480,
    heightOutside: (x, z) => massif(x, z, seed) + detail(x, z, seed),
  };
}

/** Uniform slope for tests: rises along -z at the given angle. */
export function createTestSlope(n: number, slopeDeg: number): Mountain {
  const grid = new Grid(n, 1);
  const ground = new Float32Array(grid.count);
  const rise = Math.tan((slopeDeg * Math.PI) / 180);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) ground[ix + iz * n] = (n - 1 - iz) * rise;
  const pisteMask = new Uint8Array(grid.count).fill(1);
  return {
    name: 'Test slope',
    seed: 0,
    grid,
    ground,
    pisteMask,
    pisteCellCount: grid.count,
    pisteLine: new Float32Array(0),
    trees: new Float32Array(0),
    treeCount: 0,
    depot: { x: grid.sizeM / 2, z: grid.sizeM / 2, heading: Math.PI },
    datumAltitudeM: 0,
    heightOutside: (_x, z) => (n - 1 - z) * rise,
  };
}
