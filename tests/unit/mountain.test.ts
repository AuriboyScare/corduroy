import { beforeAll, describe, expect, it } from 'vitest';
import { generateMountain, TREE_STRIDE, type Mountain } from '../../src/sim/terrain/mountain';

describe('generateMountain', () => {
  let mountain: Mountain;
  beforeAll(() => {
    mountain = generateMountain(11);
  }, 30_000);

  it('is deterministic for a seed', () => {
    const again = generateMountain(11);
    expect(again.treeCount).toBe(mountain.treeCount);
    expect(again.ground[123_456]).toBe(mountain.ground[123_456]);
  }, 30_000);

  it('grades the piste so a cat can work it: always downhill, never over 21 degrees along its centreline', () => {
    const { pisteLine, grid, ground } = mountain;
    let steepest = 0;
    for (let i = 0; i + 21 < pisteLine.length / 2; i += 5) {
      const a = grid.sample(ground, pisteLine[i * 2]!, pisteLine[i * 2 + 1]!);
      const b = grid.sample(ground, pisteLine[(i + 20) * 2]!, pisteLine[(i + 20) * 2 + 1]!);
      const run = Math.hypot(
        pisteLine[(i + 20) * 2]! - pisteLine[i * 2]!,
        pisteLine[(i + 20) * 2 + 1]! - pisteLine[i * 2 + 1]!,
      );
      expect(a).toBeGreaterThan(b);
      steepest = Math.max(steepest, (Math.atan((a - b) / run) * 180) / Math.PI);
    }
    expect(steepest).toBeLessThan(21);
    expect(steepest).toBeGreaterThan(11);
  });

  it('has no steps on the piste surface', () => {
    const { grid, ground, pisteMask } = mountain;
    const n = grid.n;
    let sharpest = 0;
    let steepest = 0;
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = ix + iz * n;
        if (!pisteMask[i] || !pisteMask[i - 1] || !pisteMask[i + 1] || !pisteMask[i - n] || !pisteMask[i + n])
          continue;
        // A step shows up as a sudden change of slope between neighbouring cells.
        sharpest = Math.max(
          sharpest,
          Math.abs(ground[i + 1]! - 2 * ground[i]! + ground[i - 1]!),
          Math.abs(ground[i + n]! - 2 * ground[i]! + ground[i - n]!),
        );
        steepest = Math.max(
          steepest,
          Math.hypot(ground[i + 1]! - ground[i - 1]!, ground[i + n]! - ground[i - n]!) / 2,
        );
      }
    }
    // The terracing bug this guards against produced values around 0.6.
    expect(sharpest).toBeLessThan(0.2);
    // The inside of a bend is steeper than the centreline, but still workable on groomed snow.
    expect((Math.atan(steepest) * 180) / Math.PI).toBeLessThan(34);
  });

  it('has a level depot pad', () => {
    const { depot, grid, ground } = mountain;
    const h = grid.sample(ground, depot.x, depot.z);
    for (const [dx, dz] of [
      [30, 0],
      [-30, 0],
      [0, 30],
      [0, -30],
    ] as const) {
      expect(Math.abs(grid.sample(ground, depot.x + dx, depot.z + dz) - h)).toBeLessThan(0.3);
    }
  });

  it('keeps trees off the piste and plants a real forest', () => {
    const { trees, treeCount, pisteMask, grid } = mountain;
    expect(treeCount).toBeGreaterThan(8000);
    for (let t = 0; t < treeCount; t++) {
      expect(pisteMask[grid.nearest(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 1]!)]).toBe(0);
    }
    expect(mountain.pisteCellCount).toBeGreaterThan(40_000);
  });
});
