import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../../src/sim/clock';

const make = () => new FixedStepClock({ stepSeconds: 1 / 60, maxStepsPerAdvance: 8 });

describe('FixedStepClock', () => {
  it('takes the same number of steps regardless of frame pacing', () => {
    const a = make();
    const b = make();
    for (let i = 0; i < 600; i++) a.advance(1 / 60);
    for (let i = 0; i < 200; i++) b.advance(1 / 20);
    expect(Math.abs(a.stepCount - b.stepCount)).toBeLessThanOrEqual(1);
    expect(a.simSeconds).toBeCloseTo(10, 1);
  });

  it('keeps the remainder for the next frame', () => {
    const c = make();
    expect(c.advance(0.01)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.6, 5);
    expect(c.advance(0.01)).toBe(1);
  });

  it('drops the backlog after a long hitch instead of spiralling', () => {
    const c = make();
    expect(c.advance(5)).toBe(8);
    expect(c.alpha).toBe(0);
    expect(c.advance(1 / 60)).toBeLessThanOrEqual(1);
  });

  it('scales and pauses time', () => {
    const c = make();
    c.timeScale = 4;
    expect(c.advance(1 / 60)).toBe(4);
    c.timeScale = 0;
    expect(c.advance(1)).toBe(0);
  });

  it('restores from a saved step count and rejects bad input', () => {
    const c = make();
    c.restore(3600);
    expect(c.simSeconds).toBeCloseTo(60, 9);
    expect(() => c.restore(-1)).toThrow(RangeError);
    expect(() => new FixedStepClock({ stepSeconds: 0, maxStepsPerAdvance: 1 })).toThrow(RangeError);
  });
});
