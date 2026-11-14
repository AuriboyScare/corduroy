import { describe, expect, it } from 'vitest';
import { GAME_TIME_SCALE, pressureKPa, Weather, wetBulbC, type Conditions } from '../../src/sim/weather';

const c = (): Conditions => ({ tempC: 0, humidity: 0, wetBulbC: 0, windMs: 0, windToward: 0 });

describe('weather', () => {
  it('computes wet-bulb temperature from the psychrometer equation', () => {
    // Textbook value: 20 °C at 50% RH at sea level is a 13.7 °C wet-bulb.
    expect(wetBulbC(20, 0.5)).toBeCloseTo(13.7, 0);
    // At saturation the wet-bulb equals the air temperature.
    expect(wetBulbC(-5, 1)).toBeCloseTo(-5, 1);
    // Drier air cools further; thinner air at altitude cools a little more.
    expect(wetBulbC(-2, 0.4)).toBeLessThan(wetBulbC(-2, 0.8));
    expect(wetBulbC(0, 0.5, pressureKPa(1500))).toBeLessThan(wetBulbC(0, 0.5));
    expect(pressureKPa(1500)).toBeCloseTo(84.6, 0);
  });

  it('is colder higher up, by the standard lapse rate', () => {
    const w = new Weather(11, 0);
    const low = w.at(0, c()).tempC;
    const high = w.at(470, c()).tempC;
    expect(low - high).toBeCloseTo(3.05, 1);
  });

  it('swings through the day: colder before dawn than in the afternoon, on average', () => {
    const w = new Weather(11, 0);
    let dawn = 0;
    let afternoon = 0;
    for (let day = 0; day < 20; day++) {
      w.clockS = day * 86400 + 6 * 3600;
      dawn += w.at(0, c()).tempC;
      w.clockS = day * 86400 + 15 * 3600;
      afternoon += w.at(0, c()).tempC;
    }
    expect(afternoon / 20 - dawn / 20).toBeGreaterThan(5);
  });

  it('advances the clock faster than real time, and the same clock gives the same weather', () => {
    const w = new Weather(11, 0);
    const start = w.clockS;
    w.advance(60);
    expect(w.clockS - start).toBe(60 * GAME_TIME_SCALE);
    const a = new Weather(11, 0);
    a.clockS = w.clockS;
    expect(a.at(200, c())).toEqual(w.at(200, c()));
  });

  it('stays in a believable winter range', () => {
    const w = new Weather(11, 0);
    for (let k = 0; k < 500; k++) {
      w.clockS = k * 3571;
      const now = w.at(0, c());
      expect(now.tempC).toBeGreaterThan(-25);
      expect(now.tempC).toBeLessThan(10);
      expect(now.humidity).toBeGreaterThanOrEqual(0.35);
      expect(now.windMs).toBeGreaterThanOrEqual(0);
    }
  });
});
