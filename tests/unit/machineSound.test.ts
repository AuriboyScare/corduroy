import { beforeAll, describe, expect, it } from 'vitest';

const SR = 48_000;
type Params = Record<string, number>;
interface Processor {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
let Machine: new () => Processor;

beforeAll(async () => {
  // Stand-ins for the audio-thread globals the worklet expects.
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.AudioWorkletProcessor = class {};
  g.registerProcessor = (_name: string, cls: new () => Processor) => {
    Machine = cls;
  };
  await import('../../src/game/sound/machineWorklet.js');
});

const DEFAULTS: Params = {
  rpm: 850,
  load: 0,
  beltLeft: 0,
  beltRight: 0,
  hardness: 0.5,
  tiller: 0,
  speed: 0,
  cut: 0,
  bladeLoad: 0,
  hydraulics: 0,
  winchReel: 0,
  winchTension: 0,
  reverse: 0,
};

/** Renders `seconds` of all four outputs with fixed parameters. */
function render(params: Params, seconds: number): Float32Array[] {
  const processor = new Machine();
  const p = { ...DEFAULTS, ...params };
  const parameters = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, new Float32Array([v])]));
  const total = Math.round(seconds * SR);
  const out = [0, 1, 2, 3].map(() => new Float32Array(total));
  for (let o = 0; o < total; o += 128) {
    const blocks = [0, 1, 2, 3].map(() => [new Float32Array(128)]);
    processor.process([], blocks, parameters);
    for (let k = 0; k < 4; k++) out[k]!.set(blocks[k]![0]!.subarray(0, Math.min(128, total - o)), o);
  }
  return out;
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / (to - from));
};

/** Mean upward zero-crossing rate, Hz: a rough measure of brightness. */
const crossings = (x: Float32Array) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++;
  return n / (x.length / SR);
};

/** Strongest repetition period of the signal's envelope in [minMs, maxMs]. */
function envelopePeriodMs(x: Float32Array, minMs: number, maxMs: number): number {
  const env = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += 0.05 * (Math.abs(x[i]!) - y);
    env[i] = y;
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.round((minMs * SR) / 1000); lag <= Math.round((maxMs * SR) / 1000); lag++) {
    let c = 0;
    for (let i = 0; i + lag < env.length; i += 4) c += (env[i]! - mean) * (env[i + lag]! - mean);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return (bestLag / SR) * 1000;
}

describe('machine sound synthesis', () => {
  it('fires six cylinders per two revolutions: the beat follows engine speed', () => {
    const [slow] = render({ rpm: 900, load: 0.5 }, 1.5);
    const [fast] = render({ rpm: 1500, load: 0.5 }, 1.5);
    // Firing interval = 20 / rpm seconds: 22.2 ms at 900 rpm, 13.3 ms at 1500 rpm.
    expect(envelopePeriodMs(slow!, 15, 30)).toBeCloseTo(22.2, 0);
    expect(envelopePeriodMs(fast!, 11.5, 18)).toBeCloseTo(13.3, 0);
  });

  it('gets louder and harsher under load', () => {
    const [idle] = render({ rpm: 1400, load: 0.05 }, 1);
    const [working] = render({ rpm: 1400, load: 1 }, 1);
    expect(rms(working!)).toBeGreaterThan(rms(idle!) * 1.3);
    expect(crossings(working!)).toBeGreaterThan(crossings(idle!));
  });

  it('clanks once per cleat: the rate follows belt speed', () => {
    const tracks = render({ beltLeft: 1.6, beltRight: 1.6, hardness: 0.8 }, 2)[1]!;
    // 1.6 m/s over a 0.16 m cleat pitch is 10 cleats a second per side.
    const left = envelopePeriodMs(tracks, 70, 130);
    expect(left).toBeGreaterThan(90);
    expect(left).toBeLessThan(110);
    const still = render({}, 0.5)[1]!;
    expect(rms(still)).toBeLessThan(1e-4);
  });

  it('crunches harder and higher on hard snow than in powder', () => {
    const powder = render({ beltLeft: 2, beltRight: 2, hardness: 0 }, 1)[1]!;
    const hard = render({ beltLeft: 2, beltRight: 2, hardness: 1 }, 1)[1]!;
    expect(crossings(hard)).toBeGreaterThan(crossings(powder) * 1.2);
  });

  it('hisses only while the tiller is working, and the blade roars when it cuts', () => {
    const off = render({ speed: 3 }, 0.5)[2]!;
    const tilling = render({ tiller: 1, speed: 3 }, 0.5)[2]!;
    const cutting = render({ cut: 1, speed: 3 }, 0.5)[2]!;
    expect(rms(off)).toBeLessThan(1e-4);
    expect(rms(tilling)).toBeGreaterThan(0.05);
    expect(rms(cutting)).toBeGreaterThan(0.05);
  });

  it('sounds the reversing alarm half a second on, half a second off, only in reverse', () => {
    const forward = render({}, 1)[3]!;
    const reverse = render({ reverse: 1 }, 1)[3]!;
    expect(rms(reverse, 0, SR / 2)).toBeGreaterThan(0.08);
    expect(rms(reverse, SR / 2 + 480, SR)).toBeLessThan(0.02);
    expect(rms(forward)).toBeLessThan(0.02);
  });

  it('never produces invalid or runaway samples', () => {
    const outs = render(
      {
        rpm: 2300,
        load: 1.2,
        beltLeft: 6,
        beltRight: -6,
        hardness: 1,
        tiller: 1,
        speed: 6,
        cut: 1,
        bladeLoad: 1,
        hydraulics: 1,
        winchReel: 1,
        winchTension: 1,
        reverse: 1,
      },
      2,
    );
    for (const out of outs) {
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(2);
      }
    }
  });
});
