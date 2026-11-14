import { beforeAll, describe, expect, it } from 'vitest';
import { captureWorld, restoreWorld, type WorldSnapshot } from '../../src/sim/save/worldSave';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { generateMountain, type Mountain } from '../../src/sim/terrain/mountain';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { World } from '../../src/sim/world';

const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };
let mountain: Mountain;

function fresh(mode: 'career' | 'sandbox' = 'career'): World {
  const snow = new Snowpack(mountain);
  snow.fillNatural(11);
  return new World(mountain, snow, { mode });
}
const run = (world: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(idle);
};

beforeAll(() => {
  mountain = generateMountain(11);
}, 60_000);

describe('lift operations', () => {
  it('starts a career with the nursery tow running, and the sandbox with every lift', () => {
    const career = fresh();
    expect([...career.career.lifts]).toEqual(['nursery-tow']);
    run(career, 10);
    expect(career.liftById('nursery-tow')!.speedMs).toBeCloseTo(2.4, 1);
    expect(career.liftById('summit-gondola')!.speedMs).toBe(0);
    expect(fresh('sandbox').career.lifts.size).toBe(4);
  }, 30_000);

  it('builds a lift for its price, once, and only built lifts can be run', () => {
    const world = fresh();
    expect(world.apply({ type: 'liftControl', lift: 'meadow-quad', action: 'start' })).toMatchObject({
      ok: false,
    });
    expect(world.apply({ type: 'buyLift', lift: 'meadow-quad' })).toMatchObject({ ok: false });
    world.career.money = 30_000;
    expect(world.apply({ type: 'buyLift', lift: 'meadow-quad' })).toEqual({ ok: true });
    expect(world.career.money).toBe(2_000);
    expect(world.apply({ type: 'buyLift', lift: 'meadow-quad' })).toMatchObject({ ok: false });
    run(world, 10);
    expect(world.liftById('meadow-quad')!.speedMs).toBeGreaterThan(2);
    world.apply({ type: 'liftControl', lift: 'meadow-quad', action: 'emergency' });
    run(world, 3);
    expect(world.liftById('meadow-quad')!.state).toBe('stopped');
    world.apply({ type: 'liftControl', lift: 'meadow-quad', action: 'speed', speed: 0.5 });
    world.apply({ type: 'liftControl', lift: 'meadow-quad', action: 'start' });
    run(world, 10);
    expect(world.liftById('meadow-quad')!.speedMs).toBeCloseTo(1.15, 2);
  }, 30_000);

  it('earns ticket money while running, more when its runs are groomed, nothing when stopped', () => {
    const earned = (groom: boolean, stop: boolean) => {
      const world = fresh();
      if (groom) {
        const nursery = mountain.runs.findIndex((r) => r.id === 'nursery');
        for (let i = 0; i < mountain.grid.count; i++)
          if (mountain.runOf[i] === nursery + 1) world.snow.till(i, 255);
      }
      if (stop) world.apply({ type: 'liftControl', lift: 'nursery-tow', action: 'stop' });
      run(world, 5);
      const start = world.career.money;
      run(world, 60);
      return world.career.money - start;
    };
    const ungroomed = earned(false, false);
    const groomed = earned(true, false);
    // 960 riders an hour at a fifth of capacity, $1.10 each, cut further by the nursery's thin
    // natural cover: about a dollar a minute.
    expect(ungroomed).toBeGreaterThanOrEqual(1);
    expect(ungroomed).toBeLessThan(6);
    expect(groomed).toBeGreaterThan(ungroomed * 3.5);
    expect(earned(false, true)).toBe(0);
  }, 60_000);

  it('fills lifts better once their runs have good cover', () => {
    const world = fresh();
    const lift = world.liftById('nursery-tow')!;
    const thin = world.liftUse(lift);
    const nursery = mountain.runs.findIndex((r) => r.id === 'nursery');
    expect(world.runCover[nursery]).toBeLessThan(0.5);
    for (let i = 0; i < mountain.grid.count; i++)
      if (mountain.runOf[i] === nursery + 1) world.snow.base[i] = 0.6;
    world.refreshCover();
    expect(world.runCover[nursery]).toBe(1);
    expect(world.liftUse(lift)).toBeGreaterThan(thin * 2);
  }, 30_000);

  it('saves and restores lifts exactly, and upgrades version 1 saves', () => {
    const world = fresh('sandbox');
    run(world, 30);
    world.apply({ type: 'liftControl', lift: 'ridge-tram', action: 'emergency' });
    run(world, 0.5);
    const restored = restoreWorld(captureWorld(world));
    for (const lift of world.lifts) {
      expect(restored.liftById(lift.line.id)!.captureState()).toEqual(lift.captureState());
    }
    run(world, 10);
    run(restored, 10);
    expect(restored.liftById('summit-gondola')!.travelM).toBe(world.liftById('summit-gondola')!.travelM);
    expect(restored.career.money).toBe(world.career.money);

    const v1 = captureWorld(fresh());
    const old = { ...v1, meta: { ...v1.meta, version: 1 } } as WorldSnapshot;
    delete (old.meta as Partial<WorldSnapshot['meta']>).lifts;
    delete (old.meta as Partial<WorldSnapshot['meta']>).pendingTickets;
    const upgraded = restoreWorld(old);
    expect([...upgraded.career.lifts]).toEqual(['nursery-tow']);
    run(upgraded, 5);
    expect(upgraded.liftById('nursery-tow')!.speedMs).toBeGreaterThan(1);
  }, 60_000);
});
