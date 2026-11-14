import { describe, expect, it } from 'vitest';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { createTestSlope, type Mountain } from '../../src/sim/terrain/mountain';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { WINCH_POST_HEIGHT_M, World } from '../../src/sim/world';

const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

/** A steep slope rising toward -z, with an anchor at its top centre. */
function steepWorld(slopeDeg: number, density: number, fleet = ['kestrel-600w']) {
  const base = createTestSlope(321, slopeDeg);
  const mountain: Mountain = { ...base, winchAnchors: [{ id: 'top', name: 'Test anchor', x: 160, z: 5 }] };
  const snow = new Snowpack(mountain);
  snow.fillUniform(0.5, 0.25, density);
  const world = new World(mountain, snow, { fleet });
  world.cat.place(160, 260, Math.PI, snow);
  return world;
}

const run = (world: World, seconds: number, input: SnowcatInput) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(input);
};

describe('winch', () => {
  it('only machines with a winch can hook on, and only within cable reach', () => {
    const small = steepWorld(10, 450, ['kestrel-260']);
    expect(small.apply({ type: 'winch', machine: small.activeMachine.owned.uid, hook: true })).toMatchObject({
      ok: false,
      reason: 'This machine has no winch.',
    });
    const big = steepWorld(10, 450);
    const uid = big.activeMachine.owned.uid;
    expect(big.apply({ type: 'winch', machine: uid, hook: true })).toEqual({ ok: true });
    expect(big.winchAnchorName(big.activeMachine)).toBe('Test anchor');
    const anchor = big.cat.winchAnchor!;
    expect(anchor.y).toBeCloseTo(big.snow.ground[big.snow.grid.nearest(160, 5)]! + WINCH_POST_HEIGHT_M, 1);
    expect(big.apply({ type: 'winch', machine: uid, hook: false })).toEqual({ ok: true });
    expect(big.cat.winchAnchor).toBeNull();
    // Out of reach: a 50 m cable cannot get to an anchor 255 m away.
    big.cat.applySpec({ ...big.cat.spec, winchCableM: 50 });
    expect(big.apply({ type: 'winch', machine: uid, hook: true })).toMatchObject({
      ok: false,
      reason: 'No winch anchor within 50 m.',
    });
  });

  it('climbs a slope too steep to climb without it', () => {
    const climb = (hook: boolean) => {
      const world = steepWorld(38, 220);
      if (hook) world.apply({ type: 'winch', machine: world.activeMachine.owned.uid, hook: true });
      world.cat.winchSetting = 1;
      const z = world.cat.body.pz;
      run(world, 20, { ...idle, throttle: 0.7 });
      return z - world.cat.body.pz;
    };
    expect(climb(false)).toBeLessThan(5);
    expect(climb(true)).toBeGreaterThan(40);
  });

  it('holds the machine back going down a steep slope', () => {
    const descend = (hook: boolean) => {
      const world = steepWorld(40, 220);
      world.cat.place(160, 120, 0, world.snow);
      if (hook) world.apply({ type: 'winch', machine: world.activeMachine.owned.uid, hook: true });
      world.cat.winchSetting = 0.8;
      let fastest = 0;
      for (let i = 0; i < 60 * 15; i++) {
        world.step({ ...idle, throttle: 0.3 });
        fastest = Math.max(fastest, Math.hypot(world.cat.body.vx, world.cat.body.vz));
      }
      return fastest;
    };
    const free = descend(false);
    const held = descend(true);
    expect(held).toBeLessThan(free);
    expect(held).toBeLessThan(2.6);
  });

  it('takes engine power to reel in and stops the machine at full cable length', () => {
    const world = steepWorld(0, 450);
    const cat = world.cat;
    world.apply({ type: 'winch', machine: world.activeMachine.owned.uid, hook: true });
    cat.winchSetting = 0.5;
    // Driving toward the anchor reels in: the winch loads the engine.
    run(world, 5, { ...idle, throttle: 0.5 });
    expect(cat.winchForceN).toBeCloseTo(0.5 * cat.spec.winchPullN, -2);
    expect(cat.engineLoad).toBeGreaterThan(0.3);
    // Drive away until the cable runs out. A 150 m cable keeps the test inside the map.
    cat.applySpec({ ...cat.spec, winchCableM: 150 });
    cat.place(160, 5 + 120, 0, world.snow);
    world.apply({ type: 'winch', machine: world.activeMachine.owned.uid, hook: true });
    let worstPitch = 0;
    for (let i = 0; i < 60 * 30; i++) {
      world.step({ ...idle, throttle: 1 });
      worstPitch = Math.max(worstPitch, Math.abs(cat.pitch));
    }
    // The interlock brings it to a stop without rearing up or turning round.
    expect((worstPitch * 180) / Math.PI).toBeLessThan(8);
    expect(Math.abs(cat.heading)).toBeLessThan(0.05);
    const distance = Math.hypot(cat.body.px - 160, cat.body.pz - 5);
    expect(distance).toBeLessThan(cat.spec.winchCableM + 6);
    expect(cat.winchCableOutM).toBeCloseTo(cat.spec.winchCableM, -1);
  });

  it('adjusts the tension setting from the controls', () => {
    const world = steepWorld(0, 450);
    world.cat.winchSetting = 0.6;
    run(world, 1, { ...idle, winchAdjust: 1 });
    expect(world.cat.winchSetting).toBeCloseTo(1, 1);
    run(world, 0.5, { ...idle, winchAdjust: -1 });
    expect(world.cat.winchSetting).toBeCloseTo(0.8, 1);
  });
});
