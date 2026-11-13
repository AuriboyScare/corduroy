import { describe, expect, it } from 'vitest';
import { CAREER_START_MONEY, GROOM_RATE } from '../../src/sim/career';
import {
  effectiveSpec,
  machineModel,
  MACHINE_MODELS,
  UPGRADES,
  upgradePrice,
} from '../../src/sim/machines/catalog';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { createTestSlope } from '../../src/sim/terrain/mountain';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { World, type WorldOptions } from '../../src/sim/world';

const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

function makeWorld(options: WorldOptions = {}, slopeDeg = 0, density = 115): World {
  const mountain = createTestSlope(257, slopeDeg);
  const snow = new Snowpack(mountain);
  snow.fillUniform(0.5, 0.25, density);
  return new World(mountain, snow, options);
}

const run = (world: World, seconds: number, input: SnowcatInput = idle) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(input);
};

describe('machine catalog', () => {
  it('prices every upgrade level and stops at the last one', () => {
    for (const model of MACHINE_MODELS) {
      for (const id of model.upgrades) {
        const levels = UPGRADES[id]!.costFractions.length;
        let previous = 0;
        for (let level = 0; level < levels; level++) {
          const price = upgradePrice(model, id, level)!;
          expect(price).toBeGreaterThan(previous);
          previous = price;
        }
        expect(upgradePrice(model, id, levels)).toBeNull();
      }
    }
  });

  it('applies upgrades to the specification and leaves the catalog untouched', () => {
    const model = machineModel('kestrel-420');
    const spec = effectiveSpec(model, { engine: 2, tiller: 1, cruise: 1, tracks: 2 });
    expect(spec.enginePowerW).toBeCloseTo(model.spec.enginePowerW * 1.24);
    expect(spec.tillerHalfWidthM).toBeCloseTo(model.spec.tillerHalfWidthM + 0.25);
    expect(spec.cruiseControl).toBe(true);
    expect(spec.trackCompactionDensity).toBeLessThan(model.spec.trackCompactionDensity);
    expect(model.spec.cruiseControl).toBe(false);
    expect(model.spec.enginePowerW).toBe(310_000);
  });

  it('ranks the groomers by size, price and power', () => {
    const [small, mid, big] = MACHINE_MODELS;
    for (const key of ['price', 'scale'] as const) {
      expect(small![key]).toBeLessThan(mid![key]);
      expect(mid![key]).toBeLessThan(big![key]);
    }
    expect(small!.spec.tillerHalfWidthM).toBeLessThan(mid!.spec.tillerHalfWidthM);
    expect(big!.spec.winchPullN).toBeGreaterThan(0);
    expect(mid!.spec.winchPullN).toBe(0);
  });
});

describe('career', () => {
  it('starts with the compact groomer and starting money', () => {
    const world = makeWorld();
    expect(world.career.money).toBe(CAREER_START_MONEY);
    expect(world.machines.map((m) => m.owned.model)).toEqual(['kestrel-260']);
  });

  it('pays for newly groomed area, by quality and difficulty', () => {
    const world = makeWorld({ fleet: ['kestrel-420'] });
    run(world, 1, { ...idle, tillerDown: true });
    const before = world.career.money;
    run(world, 12, { ...idle, throttle: 0.5, tillerDown: true });
    const groomedM2 = world.snow.groomedPisteCells;
    const earned = world.career.money - before;
    // Full-quality grooming at the intermediate rate, within rounding of the per-payout cents.
    expect(earned).toBeGreaterThan(groomedM2 * GROOM_RATE.intermediate * 0.95 - 2);
    expect(earned).toBeLessThanOrEqual(groomedM2 * GROOM_RATE.intermediate + 1);
    expect(world.events.length).toBeGreaterThan(0);
    // Driving back over the same strip with the tiller up pays nothing more.
    const after = world.career.money;
    run(world, 6, { ...idle, throttle: -0.5 });
    expect(world.career.money).toBe(after);
  });

  it('pays a section bonus once, and again only after the grooming has worn away', () => {
    const world = makeWorld({ fleet: ['kestrel-420'] });
    const { snow, mountain } = world;
    const money = () => world.career.money;
    // Groom almost the whole slope directly through the snowpack, as a machine would.
    for (let i = 0; i < mountain.grid.count * 0.95; i++) snow.till(i, 255);
    run(world, 1);
    const withBonus = money();
    const area = mountain.sections[0]!.cellCount;
    // Grooming pay for 95% of the area, plus the section bonus and the run bonus (half each).
    expect(withBonus - CAREER_START_MONEY).toBeGreaterThan(area * GROOM_RATE.intermediate * 1.9);
    run(world, 1);
    expect(money()).toBe(withBonus);
    expect(world.sectionBonusPaid[0]).toBe(1);
    for (let i = 0; i < mountain.grid.count * 0.6; i++) snow.trackOver(i, 300);
    run(world, 1);
    expect(world.sectionBonusPaid[0]).toBe(0);
  });

  it('sells machines for money and parks them at the garage', () => {
    const world = makeWorld();
    expect(world.apply({ type: 'buyMachine', model: 'kestrel-420' })).toMatchObject({ ok: false });
    world.career.money = 50_000;
    expect(world.apply({ type: 'buyMachine', model: 'kestrel-420' })).toEqual({ ok: true });
    expect(world.career.money).toBe(12_000);
    expect(world.machines).toHaveLength(2);
    run(world, 2);
    const [a, b] = world.machines;
    expect(
      Math.hypot(a!.vehicle.body.px - b!.vehicle.body.px, a!.vehicle.body.pz - b!.vehicle.body.pz),
    ).toBeGreaterThan(8);
    expect(world.atGarage(b!)).toBe(true);
  });

  it('upgrades only at the garage and only what is affordable', () => {
    const world = makeWorld();
    const uid = world.activeMachine.owned.uid;
    const price = upgradePrice(machineModel('kestrel-260'), 'engine', 0)!;
    world.career.money = price - 1;
    expect(world.apply({ type: 'buyUpgrade', machine: uid, upgrade: 'engine' })).toMatchObject({ ok: false });
    world.career.money = price;
    expect(world.apply({ type: 'buyUpgrade', machine: uid, upgrade: 'engine' })).toEqual({ ok: true });
    expect(world.career.money).toBe(0);
    expect(world.cat.spec.enginePowerW).toBeCloseTo(175_000 * 1.12);
    expect(world.apply({ type: 'buyUpgrade', machine: uid, upgrade: 'winch' })).toMatchObject({ ok: false });

    world.career.money = 1e6;
    run(world, 25, { ...idle, throttle: 1 });
    expect(world.apply({ type: 'buyUpgrade', machine: uid, upgrade: 'engine' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('garage'),
    });
  });

  it('swaps machines only while both are parked at the garage', () => {
    const world = makeWorld({ fleet: ['kestrel-260', 'kestrel-420'] });
    run(world, 1);
    const big = world.machines[1]!.owned.uid;
    expect(world.apply({ type: 'switchMachine', machine: big })).toEqual({ ok: true });
    expect(world.cat.spec.name).toBe('Kestrel 420');
    run(world, 25, { ...idle, throttle: 1 });
    expect(world.apply({ type: 'switchMachine', machine: world.machines[0]!.owned.uid })).toMatchObject({
      ok: false,
    });
  });

  it('gives the sandbox the whole fleet with nothing to pay', () => {
    const world = makeWorld({ mode: 'sandbox' });
    expect(world.machines).toHaveLength(MACHINE_MODELS.length);
    expect(world.cat.spec.name).toBe('Kestrel 420');
    const uid = world.activeMachine.owned.uid;
    run(world, 1);
    expect(world.apply({ type: 'buyUpgrade', machine: uid, upgrade: 'tiller' })).toEqual({ ok: true });
    expect(world.career.money).toBe(Infinity);
  });
});

describe('upgrades change how the machine works', () => {
  const climb = (levels: Record<string, number>) => {
    const world = makeWorld({ fleet: ['kestrel-260'] }, 22, 450);
    world.cat.applySpec(effectiveSpec(machineModel('kestrel-260'), levels));
    const z = world.cat.body.pz;
    run(world, 12, { ...idle, throttle: 1 });
    return z - world.cat.body.pz;
  };

  it('a remapped engine climbs a steep groomed slope faster', () => {
    expect(climb({ engine: 3 })).toBeGreaterThan(climb({}) * 1.05);
  });

  it('a tiller extension grooms a strip as much wider as the extension', () => {
    // Groomed width per metre driven, averaged over start positions across a grid cell.
    const width = (levels: Record<string, number>) => {
      let total = 0;
      for (const offset of [0, 0.25, 0.5, 0.75]) {
        const world = makeWorld({ fleet: ['kestrel-420'] });
        world.cat.applySpec(effectiveSpec(machineModel('kestrel-420'), levels));
        world.cat.place(128 + offset, 200, Math.PI, world.snow);
        run(world, 1, { ...idle, tillerDown: true });
        const z = world.cat.body.pz;
        run(world, 10, { ...idle, throttle: 0.5, tillerDown: true });
        total += world.snow.groomedPisteCells / (z - world.cat.body.pz);
      }
      return total / 4;
    };
    const standard = width({});
    expect(standard).toBeCloseTo(5.4, 0);
    expect(width({ tiller: 2 })).toBeCloseTo(6.4, 0);
  });

  it('a finisher comb keeps full quality at a speed that spoils the standard one', () => {
    const quality = (levels: Record<string, number>) => {
      const world = makeWorld({ fleet: ['kestrel-420'] }, 0, 450);
      world.cat.applySpec(effectiveSpec(machineModel('kestrel-420'), levels));
      run(world, 1, { ...idle, tillerDown: true });
      run(world, 8, { ...idle, throttle: 0.85, tillerDown: true });
      return world.cat.groomQuality;
    };
    expect(quality({})).toBeLessThan(0.9);
    expect(quality({ finisher: 2 })).toBe(1);
  });

  it('wide-grouser tracks sink less in powder', () => {
    const sink = (levels: Record<string, number>) => {
      const world = makeWorld({ fleet: ['kestrel-420'] });
      world.cat.applySpec(effectiveSpec(machineModel('kestrel-420'), levels));
      run(world, 2);
      return world.cat.sinkM;
    };
    expect(sink({ tracks: 2 })).toBeLessThan(sink({}) * 0.95);
  });
});
