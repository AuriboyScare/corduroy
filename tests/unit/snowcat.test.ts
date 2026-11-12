import { describe, expect, it } from 'vitest';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { createTestSlope } from '../../src/sim/terrain/mountain';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { World } from '../../src/sim/world';

const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

function makeWorld(slopeDeg: number, density = 115, top = 0.25): World {
  const mountain = createTestSlope(257, slopeDeg);
  const snow = new Snowpack(mountain);
  snow.fillUniform(0.5, top, density);
  return new World(mountain, snow);
}

function run(world: World, seconds: number, input: SnowcatInput): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(input);
}

describe('Snowcat', () => {
  it('settles on flat snow and stays put', () => {
    const world = makeWorld(0);
    const { body } = world.cat;
    run(world, 3, idle);
    const x = body.px;
    const z = body.pz;
    run(world, 3, idle);
    expect(world.cat.groundedContacts).toBe(10);
    expect(Math.hypot(body.px - x, body.pz - z)).toBeLessThan(0.02);
    expect(Math.abs(world.cat.pitch)).toBeLessThan(0.01);
    expect(Math.abs(world.cat.roll)).toBeLessThan(0.01);
  });

  it('accelerates to its top speed on packed snow', () => {
    const world = makeWorld(0, 450);
    run(world, 8, { ...idle, throttle: 1 });
    expect(world.cat.forwardSpeed).toBeGreaterThan(5.3);
    expect(world.cat.forwardSpeed).toBeLessThan(6.3);
  });

  it('skid-steers: left input turns left, and it can pivot on the spot', () => {
    const world = makeWorld(0, 450);
    const h0 = world.cat.heading;
    const { px, pz } = world.cat.body;
    run(world, 3, { ...idle, steer: 1 });
    const turned = Math.atan2(Math.sin(world.cat.heading - h0), Math.cos(world.cat.heading - h0));
    expect(turned).toBeGreaterThan(0.5);
    expect(Math.hypot(world.cat.body.px - px, world.cat.body.pz - pz)).toBeLessThan(1.5);
  });

  it('holds on a 15 degree slope with only slow creep', () => {
    const world = makeWorld(15, 450);
    run(world, 3, idle);
    const z = world.cat.body.pz;
    run(world, 5, idle);
    expect(Math.abs(world.cat.body.pz - z) / 5).toBeLessThan(0.05);
  });

  it('climbs a groomed 25 degree slope but slides back on 40 degree powder', () => {
    const groomed = makeWorld(25, 450);
    run(groomed, 6, { ...idle, throttle: 1 });
    expect(groomed.cat.forwardSpeed).toBeGreaterThan(1.5);

    const steep = makeWorld(40, 115);
    const z = steep.cat.body.pz;
    run(steep, 6, { ...idle, throttle: 1 });
    expect(steep.cat.body.pz).toBeGreaterThan(z);
  });

  it('sinks into powder and compacts it under the tracks', () => {
    const world = makeWorld(0);
    run(world, 1, idle);
    expect(world.cat.sinkM).toBeGreaterThan(0.1);
    const mass = world.snow.totalMassKg();
    run(world, 6, { ...idle, throttle: 0.6 });
    const i = world.snow.grid.nearest(world.cat.body.px + 1.45, world.cat.body.pz + 6);
    expect(world.snow.density[i]).toBe(300);
    expect(world.snow.totalMassKg() / mass).toBeCloseTo(1, 6);
  });

  it('lays corduroy behind the tiller and counts the groomed area', () => {
    const world = makeWorld(0);
    run(world, 12, { ...idle, throttle: 0.5, tillerDown: true });
    expect(world.cat.groomQuality).toBe(1);
    expect(world.snow.groomedPisteCells).toBeGreaterThan(100);
    const i = world.snow.grid.nearest(world.cat.body.px, world.cat.body.pz + 12);
    expect(world.snow.groomed[i]).toBe(255);
    expect(world.snow.density[i]).toBe(450);
  });

  it('grooms worse when driven flat out', () => {
    const world = makeWorld(0, 450);
    run(world, 10, { ...idle, throttle: 1, tillerDown: true });
    expect(world.cat.groomQuality).toBeLessThan(0.5);
  });

  it('blade cuts a bump, carries the snow and conserves mass', () => {
    const world = makeWorld(0, 450, 0.1);
    const { snow, cat } = world;
    const n = snow.grid.n;
    // A 0.5 m mound across the path ahead (the cat faces -z).
    for (let iz = 100; iz < 104; iz++) for (let ix = 120; ix < 137; ix++) snow.top[ix + iz * n]! += 0.5;
    const mass = snow.totalMassKg();
    run(world, 1, { ...idle, bladeLift: -1 });
    run(world, 13, { ...idle, throttle: 0.5 });
    expect(cat.body.pz).toBeLessThan(96);
    expect((snow.totalMassKg() + cat.bladeLoadKg) / mass).toBeCloseTo(1, 5);
    let highest = 0;
    for (let iz = 100; iz < 104; iz++) highest = Math.max(highest, snow.top[128 + iz * n]!);
    expect(highest).toBeLessThan(0.3);
  });

  it('stays finite over a long mixed drive', () => {
    const world = makeWorld(12);
    for (let i = 0; i < 3600; i++) {
      world.step({
        throttle: Math.sin(i / 200),
        steer: Math.sin(i / 90),
        bladeLift: Math.sin(i / 50),
        tillerDown: i % 600 < 300,
      });
    }
    const b = world.cat.body;
    expect(Number.isFinite(b.px + b.py + b.pz + b.qx + b.qw + b.vx + b.wy)).toBe(true);
    expect(b.py).toBeGreaterThan(world.snow.ground[world.snow.grid.nearest(b.px, b.pz)]!);
  });
});
