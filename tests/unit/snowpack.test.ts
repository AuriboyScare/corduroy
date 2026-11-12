import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import { CH_GROOM, CH_TRACK, GROOMED_DENSITY, PUSHED_DENSITY, Snowpack } from '../../src/sim/snow/snowpack';
import { createTestSlope } from '../../src/sim/terrain/mountain';

const make = () => {
  const snow = new Snowpack(createTestSlope(65, 0));
  snow.fillUniform(0.5, 0.25, 115);
  return snow;
};

describe('Snowpack', () => {
  it('conserves mass through random cut, fill, deposit, compaction and tilling', () => {
    const snow = make();
    const rng = createRng(7);
    const start = snow.totalMassKg();
    let carried = 0;
    for (let k = 0; k < 20_000; k++) {
      const i = Math.floor(rng() * snow.grid.count);
      const op = rng();
      if (op < 0.3) carried += snow.cutTo(i, snow.surface(i) - rng() * 0.6);
      else if (op < 0.55) carried -= snow.fillTo(i, snow.surface(i) + rng() * 0.3, carried, PUSHED_DENSITY);
      else if (op < 0.7) snow.compact(i, 200 + rng() * 200);
      else if (op < 0.85) snow.till(i, 200);
      else snow.trackOver(i, 300);
    }
    expect(carried).toBeGreaterThanOrEqual(0);
    expect((snow.totalMassKg() + carried) / start).toBeCloseTo(1, 5);
    for (let i = 0; i < snow.grid.count; i++) {
      expect(snow.top[i]).toBeGreaterThanOrEqual(0);
      expect(snow.base[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('compaction lowers the surface and never reduces density', () => {
    const snow = make();
    const before = snow.surface(100);
    snow.compact(100, 300);
    expect(snow.surface(100)).toBeCloseTo(before - 0.25 * (1 - 115 / 300), 5);
    snow.compact(100, 200);
    expect(snow.density[100]).toBe(300);
  });

  it('support height equals the surface after compaction', () => {
    const snow = make();
    const support = snow.supportAt(20, 20, 300);
    for (let i = 0; i < snow.grid.count; i++) snow.compact(i, 300);
    expect(snow.surfaceAt(20, 20)).toBeCloseTo(support, 5);
  });

  it('tilling lays groomed-density snow once and tracks spoil it', () => {
    const snow = make();
    snow.till(50, 255);
    const depth = snow.top[50]!;
    expect(snow.density[50]).toBe(GROOMED_DENSITY);
    expect(snow.groomedPisteCells).toBe(1);
    snow.till(50, 255);
    expect(snow.top[50]).toBe(depth);
    snow.trackOver(50, 300);
    expect(snow.groomedPisteCells).toBe(0);
  });

  it('cuts through the top layer into the base, down to bare ground', () => {
    const snow = make();
    const mass = snow.cutTo(10, snow.ground[10]! - 1);
    expect(mass).toBeCloseTo(0.25 * 115 + 0.5 * 500, 3);
    expect(snow.surface(10)).toBeCloseTo(snow.ground[10]!, 6);
  });

  it('records surface detail in a fine tile and the coarse summary', () => {
    const snow = make();
    snow.markSurface(40.1, 33.3, 255, 0, 0, 1);
    expect(snow.dirtyTiles.size).toBe(1);
    const tile = snow.tiles[[...snow.dirtyTiles][0]!]!;
    expect(tile.reduce((n, v, k) => n + (k % 4 === CH_GROOM && v === 255 ? 1 : 0), 0)).toBe(1);
    snow.markSurface(40.1, 33.3, -1, 200, 0, 1);
    expect(tile.reduce((n, v, k) => n + (k % 4 === CH_GROOM && v === 255 ? 1 : 0), 0)).toBe(1);
    expect(tile.some((v, k) => k % 4 === CH_TRACK && v === 200)).toBe(true);
    expect(snow.coarseDirty).toBe(true);
  });
});
