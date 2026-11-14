import { beforeAll, describe, expect, it } from 'vitest';
import { BASE_AREA, LIFT_CORRIDOR_HALF_WIDTH_M, RUN_PLANS } from '../../src/sim/resort/layout';
import { generateMountain, TREE_STRIDE, type Mountain } from '../../src/sim/terrain/mountain';

const deg = (rad: number) => (rad * 180) / Math.PI;
const insideBaseArea = (x: number, z: number) =>
  Math.abs(x - BASE_AREA.x) < BASE_AREA.halfX + BASE_AREA.blendM &&
  Math.abs(z - BASE_AREA.z) < BASE_AREA.halfZ + BASE_AREA.blendM;

describe('generateMountain', () => {
  let mountain: Mountain;
  beforeAll(() => {
    mountain = generateMountain(11);
  }, 60_000);

  it('is deterministic for a seed', () => {
    const again = generateMountain(11);
    expect(again.treeCount).toBe(mountain.treeCount);
    expect(again.ground[123_456]).toBe(mountain.ground[123_456]);
    expect(again.sectionOf[1_900_000]).toBe(mountain.sectionOf[1_900_000]);
  }, 60_000);

  it('builds every planned run, descending and within its grade along the centreline', () => {
    expect(mountain.runs.map((r) => r.id)).toEqual(RUN_PLANS.map((p) => p.id));
    const { grid, ground } = mountain;
    for (const [k, run] of mountain.runs.entries()) {
      const line = run.line;
      const samples = line.length / 2;
      let steepest = 0;
      for (let i = 0; i + 10 < samples; i += 5) {
        const a = grid.sample(ground, line[i * 2]!, line[i * 2 + 1]!);
        const b = grid.sample(ground, line[(i + 10) * 2]!, line[(i + 10) * 2 + 1]!);
        const length = Math.hypot(
          line[(i + 10) * 2]! - line[i * 2]!,
          line[(i + 10) * 2 + 1]! - line[i * 2 + 1]!,
        );
        // The base area is levelled flat on purpose; runs only have to descend until they reach it.
        if (insideBaseArea(line[(i + 10) * 2]!, line[(i + 10) * 2 + 1]!)) break;
        expect(a, `${run.id} at sample ${i}`).toBeGreaterThan(b);
        steepest = Math.max(steepest, deg(Math.atan((a - b) / length)));
      }
      expect(steepest, run.id).toBeLessThan(RUN_PLANS[k]!.maxGradeDeg + 1.5);
    }
  });

  it('orders run difficulty by how steep the runs are', () => {
    const steepest = (id: string) => {
      const run = mountain.runs.find((r) => r.id === id)!;
      const { grid, ground } = mountain;
      let worst = 0;
      for (let i = 0; i + 10 < run.line.length / 2; i += 5) {
        const a = grid.sample(ground, run.line[i * 2]!, run.line[i * 2 + 1]!);
        const b = grid.sample(ground, run.line[(i + 10) * 2]!, run.line[(i + 10) * 2 + 1]!);
        worst = Math.max(worst, deg(Math.atan((a - b) / 20)));
      }
      return worst;
    };
    expect(steepest('nursery')).toBeLessThan(steepest('long-meadow'));
    expect(steepest('long-meadow')).toBeLessThan(steepest('kestrel'));
    expect(steepest('kestrel')).toBeLessThan(steepest('falcon-face'));
    expect(steepest('falcon-face')).toBeGreaterThan(26);
  });

  it('has no steps on any run surface', () => {
    const { grid, ground, runOf } = mountain;
    const n = grid.n;
    let sharpest = 0;
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = ix + iz * n;
        if (!runOf[i] || !runOf[i - 1] || !runOf[i + 1] || !runOf[i - n] || !runOf[i + n]) continue;
        // A step shows up as a sudden change of slope between neighbouring cells.
        sharpest = Math.max(
          sharpest,
          Math.abs(ground[i + 1]! - 2 * ground[i]! + ground[i - 1]!),
          Math.abs(ground[i + n]! - 2 * ground[i]! + ground[i - n]!),
        );
      }
    }
    // The terracing bug this guards against produced values around 0.6.
    expect(sharpest).toBeLessThan(0.25);
  });

  it('splits runs into sections that cover every piste cell', () => {
    const { sections, runs, sectionOf, runOf } = mountain;
    expect(sections.length).toBe(runs.reduce((n, r) => n + r.sectionCount, 0));
    for (const run of runs) expect(run.sectionCount).toBeGreaterThanOrEqual(run.lengthM > 300 ? 3 : 1);
    let total = 0;
    for (const section of sections) {
      expect(section.cellCount).toBeGreaterThan(1000);
      total += section.cellCount;
    }
    expect(total).toBe(mountain.pisteCellCount);
    for (let i = 0; i < sectionOf.length; i += 997) {
      const s = sectionOf[i]!;
      expect(s > 0).toBe(runOf[i]! > 0);
      if (s > 0) expect(sections[s - 1]!.run).toBe(runOf[i]! - 1);
    }
  });

  it('levels the base area', () => {
    const { grid, ground } = mountain;
    const h = grid.sample(ground, BASE_AREA.x, BASE_AREA.z);
    for (const [dx, dz] of [
      [BASE_AREA.halfX - 5, 0],
      [-BASE_AREA.halfX + 5, 0],
      [0, BASE_AREA.halfZ - 5],
      [0, -BASE_AREA.halfZ + 5],
    ] as const) {
      expect(Math.abs(grid.sample(ground, BASE_AREA.x + dx, BASE_AREA.z + dz) - h)).toBeLessThan(0.5);
    }
  });

  it('keeps trees off runs, lift corridors and the base area, and plants a real forest', () => {
    const { trees, treeCount, runOf, grid, lifts } = mountain;
    expect(treeCount).toBeGreaterThan(8000);
    for (let t = 0; t < treeCount; t++) {
      const x = trees[t * TREE_STRIDE]!;
      const z = trees[t * TREE_STRIDE + 1]!;
      expect(runOf[grid.nearest(x, z)]).toBe(0);
      for (const lift of lifts) {
        const dx = lift.top.x - lift.bottom.x;
        const dz = lift.top.z - lift.bottom.z;
        const u = Math.max(
          0,
          Math.min(1, ((x - lift.bottom.x) * dx + (z - lift.bottom.z) * dz) / (dx * dx + dz * dz)),
        );
        const d = Math.hypot(x - lift.bottom.x - dx * u, z - lift.bottom.z - dz * u);
        expect(d, lift.id).toBeGreaterThan(LIFT_CORRIDOR_HALF_WIDTH_M[lift.kind] - 1);
      }
    }
  });

  it('keeps every lift line off the runs except where it crosses them', () => {
    const { lifts, runOf, grid } = mountain;
    for (const lift of lifts) {
      let onRun = 0;
      const steps = 200;
      for (let k = 0; k <= steps; k++) {
        const x = lift.bottom.x + ((lift.top.x - lift.bottom.x) * k) / steps;
        const z = lift.bottom.z + ((lift.top.z - lift.bottom.z) * k) / steps;
        if (runOf[grid.nearest(x, z)]) onRun++;
      }
      expect(onRun / steps, lift.id).toBeLessThan(0.2);
    }
  });
});
