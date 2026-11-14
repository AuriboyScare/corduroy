import {
  BASE_AREA,
  GARAGE,
  LIFT_CORRIDOR_HALF_WIDTH_M,
  LIFT_PLANS,
  RUN_PLANS,
  SECTION_LENGTH_M,
  WINCH_ANCHOR_PLANS,
  type Difficulty,
  type LiftKind,
  type RunPlan,
} from '../resort/layout';
import { clamp01, fbm2, hash2, ridged2, smoothstep } from '../rng';
import { Grid } from './grid';

/** Values per tree in Mountain.trees: x, z, height (m), random seed in [0, 1). */
export const TREE_STRIDE = 4;

export interface Run {
  readonly id: string;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly halfWidthM: number;
  /** Centreline as x, z pairs from top to bottom, evenly spaced. */
  readonly line: Float32Array;
  readonly lengthM: number;
  /** Index of the run's first section in Mountain.sections. */
  readonly firstSection: number;
  readonly sectionCount: number;
}

export interface Section {
  /** Index into Mountain.runs. */
  readonly run: number;
  /** Position along its run, 0 at the top. */
  readonly index: number;
  readonly cellCount: number;
}

export interface LiftLine {
  readonly id: string;
  readonly name: string;
  readonly kind: LiftKind;
  readonly bottom: { readonly x: number; readonly z: number };
  readonly top: { readonly x: number; readonly z: number };
  readonly serves: readonly string[];
}

export interface WinchAnchor {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export interface Mountain {
  readonly name: string;
  readonly seed: number;
  readonly grid: Grid;
  /** Bare ground height in metres above the valley datum, one value per grid sample. */
  readonly ground: Float32Array;
  readonly runs: readonly Run[];
  readonly sections: readonly Section[];
  /** Per grid sample: 0 off-piste, otherwise index into runs + 1. */
  readonly runOf: Uint8Array;
  /** Per grid sample: 0 off-piste, otherwise index into sections + 1. */
  readonly sectionOf: Uint16Array;
  readonly pisteCellCount: number;
  readonly lifts: readonly LiftLine[];
  readonly winchAnchors: readonly WinchAnchor[];
  readonly trees: Float32Array;
  readonly treeCount: number;
  /** Where machinery is parked. heading is radians; forward is (sin, 0, cos). */
  readonly depot: { x: number; z: number; heading: number };
  /** Altitude of the datum above sea level, for display. */
  readonly datumAltitudeM: number;
  /** Analytic terrain beyond the editable map, used to draw the horizon. */
  heightOutside(x: number, z: number): number;
}

/** Plans the generator works from; tests substitute their own. */
export interface ResortPlan {
  readonly runs: readonly RunPlan[];
}

const SIZE = 2048;
const PEAK_X = 1024;
const PEAK_Z = 380;
const PEAK_H = 470;
/** How far from a run's centreline its grading blends into natural ground, m. */
const GRADE_REACH_M = 62;
const MIN_GRADE = Math.tan((3 * Math.PI) / 180);
const LIFT_PAD_RADIUS_M = 16;

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

/** Samples a centreline at an even `spacing` in metres of arc length. Returns x, z pairs. */
function sampleCentreline(control: RunPlan['control'], spacing: number): Float64Array {
  // Dense pass along the spline, then walk it at even arc-length steps.
  const dense: number[] = [];
  for (let s = 0; s < control.length - 1; s++) {
    const p0 = control[Math.max(0, s - 1)]!;
    const p1 = control[s]!;
    const p2 = control[s + 1]!;
    const p3 = control[Math.min(control.length - 1, s + 2)]!;
    const steps = Math.max(8, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      dense.push(catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t));
    }
  }
  const last = control[control.length - 1]!;
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
  // crease where the grading folds over itself. The ends stay where they were planned.
  const count = out.length / 2;
  const line = Float64Array.from(out);
  const smoothed = new Float64Array(line.length);
  const window = Math.round(44 / spacing);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      const reach = Math.min(window, i, count - 1 - i);
      let sx = 0;
      let sz = 0;
      for (let k = i - reach; k <= i + reach; k++) {
        sx += line[k * 2]!;
        sz += line[k * 2 + 1]!;
      }
      smoothed[i * 2] = sx / (2 * reach + 1);
      smoothed[i * 2 + 1] = sz / (2 * reach + 1);
    }
    line.set(smoothed);
  }
  return line;
}

/**
 * Height profile along a centreline: the natural slope, smoothed, then held between a minimum
 * grade and the run's maximum so a machine can always work it, and rounded so it has no kinks.
 */
function gradeProfile(line: Float64Array, spacing: number, maxGradeDeg: number, seed: number): Float64Array {
  const m = line.length / 2;
  const raw = new Float64Array(m);
  for (let i = 0; i < m; i++) raw[i] = massif(line[i * 2]!, line[i * 2 + 1]!, seed);
  const profile = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - 25); k <= Math.min(m - 1, i + 25); k++) {
      sum += raw[k]!;
      count++;
    }
    profile[i] = sum / count;
  }
  const maxRise = Math.tan((maxGradeDeg * Math.PI) / 180);
  for (let i = m - 2; i >= 0; i--) {
    const below = profile[i + 1]!;
    profile[i] = Math.min(below + spacing * maxRise, Math.max(below + spacing * MIN_GRADE, profile[i]!));
  }
  const rounded = new Float64Array(m);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let k = i - 10; k <= i + 10; k++) sum += profile[Math.max(0, Math.min(m - 1, k))]!;
      rounded[i] = sum / 21;
    }
    profile.set(rounded);
  }
  return profile;
}

/** Distance from (x, z) to the segment a→b. */
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Distance outside the base area's rounded rectangle (0 inside). */
function baseAreaDistance(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - BASE_AREA.x) - BASE_AREA.halfX);
  const dz = Math.max(0, Math.abs(z - BASE_AREA.z) - BASE_AREA.halfZ);
  return Math.sqrt(dx * dx + dz * dz);
}

interface GradedRun {
  plan: RunPlan;
  line: Float64Array;
  profile: Float64Array;
  firstSection: number;
  sectionCount: number;
  samplesPerSection: number;
}

/** Builds the prototype resort: the massif, graded runs, a levelled base area, lift corridors and forest. */
export function generateMountain(seed: number, plan: ResortPlan = { runs: RUN_PLANS }): Mountain {
  const grid = new Grid(SIZE + 1, 1);
  const n = grid.n;
  const count = grid.count;
  const spacing = 2;

  // Grade every run and split it into sections of roughly equal length.
  const graded: GradedRun[] = [];
  const sectionRuns: number[] = [];
  const sectionIndex: number[] = [];
  for (const runPlan of plan.runs) {
    const line = sampleCentreline(runPlan.control, spacing);
    const samples = line.length / 2;
    const lengthM = (samples - 1) * spacing;
    const sectionCount = Math.max(1, Math.round(lengthM / SECTION_LENGTH_M));
    const firstSection = sectionRuns.length;
    for (let s = 0; s < sectionCount; s++) {
      sectionRuns.push(graded.length);
      sectionIndex.push(s);
    }
    graded.push({
      plan: runPlan,
      line,
      profile: gradeProfile(line, spacing, runPlan.maxGradeDeg, seed),
      firstSection,
      sectionCount,
      samplesPerSection: samples / sectionCount,
    });
  }

  // For every cell near a run: blend weight and graded height summed over runs, and the run and
  // section of the nearest centreline within the run's width.
  const weightSum = new Float32Array(count);
  const gradeSum = new Float32Array(count);
  const weightMax = new Float32Array(count);
  const nearestRunDist = new Float32Array(count).fill(1e9);
  const runOf = new Uint8Array(count);
  const sectionOf = new Uint16Array(count);
  const clearOf = new Uint8Array(count);

  graded.forEach((run, r) => {
    const { line, profile } = run;
    const m = line.length / 2;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < m; i++) {
      x0 = Math.min(x0, line[i * 2]!);
      x1 = Math.max(x1, line[i * 2]!);
      z0 = Math.min(z0, line[i * 2 + 1]!);
      z1 = Math.max(z1, line[i * 2 + 1]!);
    }
    const bx0 = Math.max(0, Math.floor(x0 - GRADE_REACH_M));
    const bx1 = Math.min(n - 1, Math.ceil(x1 + GRADE_REACH_M));
    const bz0 = Math.max(0, Math.floor(z0 - GRADE_REACH_M));
    const bz1 = Math.min(n - 1, Math.ceil(z1 + GRADE_REACH_M));
    const w = bx1 - bx0 + 1;
    const h = bz1 - bz0 + 1;
    const dist = new Float32Array(w * h).fill(1e9);
    const nearest = new Int32Array(w * h).fill(-1);
    for (let i = 0; i < m; i++) {
      const cx = line[i * 2]!;
      const cz = line[i * 2 + 1]!;
      const ix0 = Math.max(bx0, Math.floor(cx - GRADE_REACH_M));
      const ix1 = Math.min(bx1, Math.ceil(cx + GRADE_REACH_M));
      const iz0 = Math.max(bz0, Math.floor(cz - GRADE_REACH_M));
      const iz1 = Math.min(bz1, Math.ceil(cz + GRADE_REACH_M));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const d2 = (ix - cx) * (ix - cx) + (iz - cz) * (iz - cz);
          const k = ix - bx0 + (iz - bz0) * w;
          if (d2 < dist[k]!) {
            dist[k] = d2;
            nearest[k] = i;
          }
        }
      }
    }
    const halfWidth = run.plan.halfWidthM;
    for (let lz = 0; lz < h; lz++) {
      for (let lx = 0; lx < w; lx++) {
        const k = lx + lz * w;
        const i = nearest[k]!;
        if (i < 0) continue;
        const ix = lx + bx0;
        const iz = lz + bz0;
        // Refine to the closest point on the centreline itself, so the graded height varies
        // smoothly along the run instead of stepping from one sample to the next.
        let best = dist[k]!;
        let height = profile[i]!;
        let along = i;
        for (let a = Math.max(0, i - 1); a <= Math.min(m - 2, i); a++) {
          const ax = line[a * 2]!;
          const az = line[a * 2 + 1]!;
          const sx = line[a * 2 + 2]! - ax;
          const sz = line[a * 2 + 3]! - az;
          const t = Math.max(0, Math.min(1, ((ix - ax) * sx + (iz - az) * sz) / (sx * sx + sz * sz)));
          const dx = ix - (ax + sx * t);
          const dz = iz - (az + sz * t);
          const d2 = dx * dx + dz * dz;
          if (d2 <= best) {
            best = d2;
            height = profile[a]! + (profile[a + 1]! - profile[a]!) * t;
            along = a + t;
          }
        }
        const d = Math.sqrt(best);
        const j = ix + iz * n;
        const weight = 1 - smoothstep(halfWidth + 2, GRADE_REACH_M - 4, d);
        if (weight > 0) {
          weightSum[j]! += weight;
          gradeSum[j]! += weight * height;
          if (weight > weightMax[j]!) weightMax[j] = weight;
        }
        if (d < halfWidth + 9) clearOf[j] = 1;
        if (d <= halfWidth && d < nearestRunDist[j]!) {
          nearestRunDist[j] = d;
          runOf[j] = r + 1;
          const section = Math.min(run.sectionCount - 1, Math.floor(along / run.samplesPerSection));
          sectionOf[j] = run.firstSection + section + 1;
        }
      }
    }
  });

  // Lift corridors and the pads their stations stand on.
  const lifts: LiftLine[] = LIFT_PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    bottom: { x: p.bottom[0], z: p.bottom[1] },
    top: { x: p.top[0], z: p.top[1] },
    serves: p.serves,
  }));
  const pads = lifts.map((lift) => ({
    x: lift.top.x,
    z: lift.top.z,
    height: massif(lift.top.x, lift.top.z, seed),
  }));
  for (const lift of lifts) {
    const half = LIFT_CORRIDOR_HALF_WIDTH_M[lift.kind];
    const x0 = Math.max(0, Math.floor(Math.min(lift.bottom.x, lift.top.x) - half));
    const x1 = Math.min(n - 1, Math.ceil(Math.max(lift.bottom.x, lift.top.x) + half));
    const z0 = Math.max(0, Math.floor(Math.min(lift.bottom.z, lift.top.z) - half));
    const z1 = Math.min(n - 1, Math.ceil(Math.max(lift.bottom.z, lift.top.z) + half));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        if (segmentDistance(ix, iz, lift.bottom.x, lift.bottom.z, lift.top.x, lift.top.z) < half)
          clearOf[ix + iz * n] = 1;
      }
    }
  }

  // Heights: natural ground, graded under runs, levelled at the base area and lift pads.
  const ground = new Float32Array(count);
  const baseHeight = massif(BASE_AREA.x, BASE_AREA.z, seed);
  let pisteCellCount = 0;
  const sectionCells = new Array<number>(sectionRuns.length).fill(0);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const j = ix + iz * n;
      const shape = massif(ix, iz, seed);
      const blend = weightMax[j]!;
      let h = shape + detail(ix, iz, seed) * (1 - 0.9 * blend);
      if (blend > 0) h += (gradeSum[j]! / weightSum[j]! - shape) * blend;
      const db = baseAreaDistance(ix, iz);
      if (db < BASE_AREA.blendM) {
        h += (baseHeight - h) * (1 - smoothstep(0, BASE_AREA.blendM, db));
        if (db < 8) clearOf[j] = 1;
      }
      for (const pad of pads) {
        const dp = Math.hypot(ix - pad.x, iz - pad.z);
        if (dp < LIFT_PAD_RADIUS_M + 24) {
          h += (pad.height - h) * (1 - smoothstep(LIFT_PAD_RADIUS_M, LIFT_PAD_RADIUS_M + 24, dp));
          if (dp < LIFT_PAD_RADIUS_M + 6) clearOf[j] = 1;
        }
      }
      ground[j] = h;
      const s = sectionOf[j]!;
      if (s > 0) {
        pisteCellCount++;
        sectionCells[s - 1]!++;
      }
    }
  }

  // Forest: jittered grid, thinned by noise, altitude and slope; clear of runs, lifts and the base.
  const treeSpacing = 6.5;
  const cells = Math.floor(SIZE / treeSpacing);
  const trees: number[] = [];
  for (let cz = 1; cz < cells - 1; cz++) {
    for (let cx = 1; cx < cells - 1; cx++) {
      const x = (cx + hash2(cx, cz, seed + 21)) * treeSpacing;
      const z = (cz + hash2(cx, cz, seed + 22)) * treeSpacing;
      const j = grid.nearest(x, z);
      if (clearOf[j]) continue;
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

  const runs: Run[] = graded.map((g) => ({
    id: g.plan.id,
    name: g.plan.name,
    difficulty: g.plan.difficulty,
    halfWidthM: g.plan.halfWidthM,
    line: Float32Array.from(g.line),
    lengthM: (g.line.length / 2 - 1) * spacing,
    firstSection: g.firstSection,
    sectionCount: g.sectionCount,
  }));
  const sections: Section[] = sectionRuns.map((run, k) => ({
    run,
    index: sectionIndex[k]!,
    cellCount: sectionCells[k]!,
  }));

  return {
    name: 'Prototype resort',
    seed,
    grid,
    ground,
    runs,
    sections,
    runOf,
    sectionOf,
    pisteCellCount,
    lifts,
    winchAnchors: WINCH_ANCHOR_PLANS.map((a) => ({ ...a })),
    trees: Float32Array.from(trees),
    treeCount: trees.length / TREE_STRIDE,
    depot: { x: GARAGE.x, z: GARAGE.z, heading: GARAGE.heading },
    datumAltitudeM: 1480,
    heightOutside: (x, z) => massif(x, z, seed) + detail(x, z, seed),
  };
}

/** Uniform slope for tests: rises along -z at the given angle. The whole slope is one run section. */
export function createTestSlope(n: number, slopeDeg: number): Mountain {
  const grid = new Grid(n, 1);
  const ground = new Float32Array(grid.count);
  const rise = Math.tan((slopeDeg * Math.PI) / 180);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) ground[ix + iz * n] = (n - 1 - iz) * rise;
  const line = new Float32Array([grid.sizeM / 2, 0, grid.sizeM / 2, grid.sizeM]);
  return {
    name: 'Test slope',
    seed: 0,
    grid,
    ground,
    runs: [
      {
        id: 'test',
        name: 'Test run',
        difficulty: 'intermediate',
        halfWidthM: grid.sizeM / 2,
        line,
        lengthM: grid.sizeM,
        firstSection: 0,
        sectionCount: 1,
      },
    ],
    sections: [{ run: 0, index: 0, cellCount: grid.count }],
    runOf: new Uint8Array(grid.count).fill(1),
    sectionOf: new Uint16Array(grid.count).fill(1),
    pisteCellCount: grid.count,
    lifts: [],
    winchAnchors: [],
    trees: new Float32Array(0),
    treeCount: 0,
    depot: { x: grid.sizeM / 2, z: grid.sizeM / 2, heading: Math.PI },
    datumAltitudeM: 0,
    heightOutside: (_x, z) => (n - 1 - z) * rise,
  };
}

/** Finds a run by its id; throws if the resort has no such run. */
export function runById(mountain: Mountain, id: string): Run {
  const run = mountain.runs.find((r) => r.id === id);
  if (!run) throw new Error(`no run "${id}"`);
  return run;
}
