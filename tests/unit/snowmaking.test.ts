import { beforeAll, describe, expect, it } from 'vitest';
import { gunEfficiency, MADE_SNOW_DENSITY, Snowmaking } from '../../src/sim/snowmaking';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { generateMountain, type Mountain } from '../../src/sim/terrain/mountain';
import { Weather } from '../../src/sim/weather';

let mountain: Mountain;
beforeAll(() => {
  mountain = generateMountain(11);
}, 60_000);

function setup() {
  const snow = new Snowpack(mountain);
  snow.fillNatural(11);
  const making = new Snowmaking(mountain, snow);
  const weather = new Weather(11, snow.surfaceAt(mountain.depot.x, mountain.depot.z));
  return { snow, making, weather };
}

/** Pins the weather to a fixed state by overriding its conditions. */
function fixedWeather(weather: Weather, tempC: number, humidity: number): void {
  const original = weather.at.bind(weather);
  weather.at = (y, out) => {
    original(y, out);
    out.tempC = tempC;
    out.humidity = humidity;
    out.windMs = 0;
    out.wetBulbC = tempC - (1 - humidity) * 6;
    return out;
  };
}

describe('snowmaking', () => {
  it('works only below a wet-bulb of -2 °C, reaching full output by -9 °C', () => {
    expect(gunEfficiency(0)).toBe(0);
    expect(gunEfficiency(-2)).toBe(0);
    expect(gunEfficiency(-5.5)).toBeCloseTo(0.5);
    expect(gunEfficiency(-12)).toBe(1);
  });

  it('places guns along every run, alternating sides, outside the run edge', () => {
    const { making } = setup();
    for (let r = 0; r < mountain.runs.length; r++) {
      const guns = making.gunsOn(r);
      expect(guns.length).toBeGreaterThanOrEqual(r === 0 ? 2 : 10);
      for (const gun of guns) expect(mountain.runOf[mountain.grid.nearest(gun.x, gun.z)]).not.toBe(r + 1);
    }
  });

  it('makes dense snow into the run when cold, conserving water as snow mass, and nothing when warm', () => {
    const { snow, making, weather } = setup();
    const run = mountain.runs.findIndex((r) => r.id === 'nursery');
    making.installed[run] = true;
    making.mode[run] = 'on';
    fixedWeather(weather, -1, 0.9);
    const before = snow.totalMassKg();
    for (let i = 0; i < 600; i++) making.step(1 / 60, weather);
    expect(snow.totalMassKg()).toBeCloseTo(before, -1);

    fixedWeather(weather, -10, 0.6);
    const gun0 = making.gunsOn(run)[0]!;
    const target = mountain.grid.nearest(gun0.x + gun0.inX * 13, gun0.z + gun0.inZ * 13);
    const coverBefore = snow.coverDepth(target);
    let made = 0;
    for (let i = 0; i < 60 * 30; i++) made += making.step(1 / 60, weather);
    expect(made).toBeGreaterThan(0);
    // Everything made has been laid except what is waiting for the gun's next turn.
    expect(snow.totalMassKg() - before).toBeGreaterThan(made * 0.9);
    expect(snow.totalMassKg() - before).toBeLessThanOrEqual(made + 1);
    // It lands inside the run, as dense machine snow, building cover where it was thin.
    const gun = making.gunsOn(run)[0]!;
    const i = mountain.grid.nearest(gun.x + gun.inX * 13, gun.z + gun.inZ * 13);
    expect(mountain.runOf[i]).toBe(run + 1);
    // Machine snow mixes into the fresh powder above it: the layer gets much denser.
    expect(snow.density[i]).toBeGreaterThan(200);
    // A quarter of an hour at full output lays several centimetres of consolidated cover.
    expect(snow.coverDepth(i) - coverBefore).toBeGreaterThan(0.05);
    expect(i).toBe(target);
    expect(making.pendingCost).toBeGreaterThan(0);
  });

  it('in automatic mode, stops once the cover is deep enough', () => {
    const { snow, making, weather } = setup();
    const run = mountain.runs.findIndex((r) => r.id === 'nursery');
    making.installed[run] = true;
    making.mode[run] = 'auto';
    fixedWeather(weather, -12, 0.5);
    let lastMade = 1;
    for (let minute = 0; minute < 40 && lastMade > 0; minute++) {
      lastMade = 0;
      for (let i = 0; i < 3600; i++) lastMade += making.step(1 / 60, weather);
    }
    expect(lastMade).toBe(0);
    void snow;
  }, 60_000);

  it('makes nothing on runs without guns installed', () => {
    const { making, weather } = setup();
    fixedWeather(weather, -15, 0.4);
    let made = 0;
    for (let i = 0; i < 600; i++) made += making.step(1 / 60, weather);
    expect(made).toBe(0);
    expect(MADE_SNOW_DENSITY).toBeGreaterThan(300);
  });
});
