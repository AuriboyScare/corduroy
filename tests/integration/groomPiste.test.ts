import { beforeAll, describe, expect, it } from 'vitest';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { generateMountain, runById } from '../../src/sim/terrain/mountain';
import { PathFollower } from '../../src/sim/vehicles/autopilot';
import { World } from '../../src/sim/world';

describe('grooming the prototype piste', () => {
  let world: World;
  beforeAll(() => {
    const mountain = generateMountain(11);
    const snow = new Snowpack(mountain);
    snow.fillNatural(11);
    world = new World(mountain, snow, { fleet: ['kestrel-420'] });
  }, 60_000);

  it('climbs the whole piste in fresh powder with the tiller working, then comes back down', () => {
    const { cat, snow, mountain } = world;
    const mass = snow.totalMassKg();
    let slowest = Infinity;
    let steepest = 0;
    let poorQualitySteps = 0;

    // Tilling only: carry the blade high so it does not plough fresh snow onto finished work.
    for (let i = 0; i < 90; i++) world.step({ throttle: 0, steer: 0, bladeLift: 1, tillerDown: false });
    expect(cat.bladeHeightM).toBeGreaterThan(0.85);

    const up = new PathFollower(runById(mountain, 'kestrel').line, -1, 0.62);
    let steps = 0;
    while (!up.done && steps < 60 * 900) {
      world.step(up.update(cat, true));
      steps++;
      if (steps > 600) {
        slowest = Math.min(slowest, cat.forwardSpeed);
        steepest = Math.max(steepest, cat.pitch);
        if (cat.groomQuality < 0.9) poorQualitySteps++;
      }
    }
    expect(up.done).toBe(true);
    const top = runById(mountain, 'kestrel').line;
    expect(Math.hypot(cat.body.px - top[0]!, cat.body.pz - top[1]!)).toBeLessThan(20);
    // Never stalls on the climb, and it is a real climb.
    expect(slowest).toBeGreaterThan(1.5);
    expect((steepest * 180) / Math.PI).toBeGreaterThan(14);
    expect(poorQualitySteps / steps).toBeLessThan(0.02);
    const kestrel = mountain.runs.findIndex((r) => r.id === 'kestrel');
    // One pass of a 5.4 m tiller up a 42 m wide run grooms about an eighth of it.
    const afterClimb = world.runGroomedFraction(kestrel);
    expect(afterClimb).toBeGreaterThan(0.1);
    // Grooming one run leaves the others untouched.
    for (let r = 0; r < mountain.runs.length; r++)
      if (r !== kestrel) expect(world.runGroomedFraction(r)).toBeLessThan(0.01);

    const down = new PathFollower(runById(mountain, 'kestrel').line, 1, 0.62);
    let fastest = 0;
    steps = 0;
    while (!down.done && steps < 60 * 900) {
      world.step(down.update(cat, true));
      steps++;
      fastest = Math.max(fastest, cat.forwardSpeed);
    }
    expect(down.done).toBe(true);
    // The drive holds it back downhill: it may slide a little on steep powder but never runs away.
    expect(fastest).toBeLessThan(cat.spec.maxForwardMs);
    expect(world.runGroomedFraction(kestrel)).toBeGreaterThanOrEqual(afterClimb);
    expect((snow.totalMassKg() + cat.bladeLoadKg) / mass).toBeCloseTo(1, 5);
    expect(Math.abs(cat.roll)).toBeLessThan(0.5);
    expect(cat.bladeLoadKg).toBe(0);
  }, 120_000);
});
