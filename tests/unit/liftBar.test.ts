import { describe, expect, it } from 'vitest';
import { barLowered, BAR_DOWN_BY_M, BAR_DOWN_FROM_M } from '../../src/render/lifts/safetyBar';

describe('chair safety bar', () => {
  it('is down on the way up, away from the stations', () => {
    expect(barLowered(400, 900, true)).toBe(1);
    expect(barLowered(900 - BAR_DOWN_BY_M, 900, true)).toBe(1);
  });

  it('is up at both stations and on empty chairs coming down', () => {
    expect(barLowered(5, 900, true)).toBe(0);
    expect(barLowered(900 - BAR_DOWN_FROM_M, 900, true)).toBe(0);
    expect(barLowered(400, 900, false)).toBe(0);
  });

  it('moves smoothly between the two', () => {
    let last = 0;
    for (let s = BAR_DOWN_FROM_M; s <= BAR_DOWN_BY_M; s += 0.5) {
      const now = barLowered(s, 900, true);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now - last).toBeLessThan(0.1);
      last = now;
    }
  });
});
