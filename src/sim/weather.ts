import { fbm2 } from './rng';

/** Game time runs this many times faster than real time (a day lasts 48 real minutes). */
export const GAME_TIME_SCALE = 30;
/** The game starts at this hour on day 1. */
export const START_HOUR = 7.5;
/** Temperature falls this much per metre of height. */
export const LAPSE_C_PER_M = 0.0065;

export interface Conditions {
  /** Air temperature, °C. */
  tempC: number;
  /** Relative humidity, 0..1. */
  humidity: number;
  /** Wet-bulb temperature, °C: what decides whether a snow gun can make snow. */
  wetBulbC: number;
  windMs: number;
  /** Direction the wind blows toward, radians: (sin, cos) in x, z. */
  windToward: number;
}

/** Saturation vapour pressure over water (Magnus form), kPa. */
function saturationKPa(tempC: number): number {
  return 0.61094 * Math.exp((17.625 * tempC) / (tempC + 243.04));
}

/** Air pressure at an altitude above sea level (standard atmosphere), kPa. */
export function pressureKPa(altitudeM: number): number {
  return 101.325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
}

/**
 * Wet-bulb temperature: the temperature a wetted thermometer settles at, which decides whether
 * a snow gun's droplets freeze. Solved from the psychrometer equation by bisection, so it
 * accounts for the thinner air at altitude.
 */
export function wetBulbC(tempC: number, humidity: number, pressure = 101.325): number {
  const vapour = Math.max(0.01, Math.min(1, humidity)) * saturationKPa(tempC);
  let lo = tempC - 40;
  let hi = tempC;
  for (let k = 0; k < 40; k++) {
    const tw = (lo + hi) / 2;
    const balance = saturationKPa(tw) - 0.00066 * (1 + 0.00115 * tw) * pressure * (tempC - tw) - vapour;
    if (balance > 0) hi = tw;
    else lo = tw;
  }
  return (lo + hi) / 2;
}

/**
 * Weather at the base area as a function of game time: a daily temperature swing (coldest just
 * before dawn) plus fronts that pass over a few days, and humidity and wind that change with
 * them. It is a pure function of time, so a save only needs the clock.
 */
export class Weather {
  /** Game seconds since midnight on day 1. */
  clockS = START_HOUR * 3600;

  constructor(
    readonly seed: number,
    /** Height of the base area above the datum, m. */
    readonly baseY: number,
    /** Altitude of the datum above sea level, m. */
    readonly datumAltitudeM = 1480,
  ) {}

  advance(realSeconds: number): void {
    this.clockS += realSeconds * GAME_TIME_SCALE;
  }

  get day(): number {
    return Math.floor(this.clockS / 86400) + 1;
  }

  /** Hour of the day, 0..24. */
  get hour(): number {
    return (this.clockS / 3600) % 24;
  }

  /** Conditions at a height above the datum (writes into `out`). */
  at(y: number, out: Conditions): Conditions {
    const days = this.clockS / 86400;
    const front = fbm2(days * 0.45, 3.7, this.seed + 501, 3);
    const hour = this.hour;
    // Coldest around 06:00, warmest around 15:00.
    const daily =
      -Math.cos(((hour - 5.5) / 24) * Math.PI * 2) * 3.8 + Math.sin(((hour - 5.5) / 24) * Math.PI * 4) * 0.6;
    const baseTemp = -4.5 + 5 * front + daily;
    out.tempC = baseTemp - LAPSE_C_PER_M * (y - this.baseY);
    // Humid when a front brings cloud; drier in clear cold spells and on sunny afternoons.
    out.humidity = Math.max(
      0.35,
      Math.min(0.97, 0.72 + 0.22 * fbm2(days * 0.6, 9.1, this.seed + 502, 2) - (0.05 * daily) / 3.8),
    );
    out.wetBulbC = wetBulbC(out.tempC, out.humidity, pressureKPa(this.datumAltitudeM + y));
    const gust = fbm2(days * 4, 1.3, this.seed + 503, 2);
    out.windMs = Math.max(
      0,
      4 + 5 * fbm2(days * 0.8, 5.5, this.seed + 504, 2) + 2 * gust + 0.004 * Math.max(0, y - this.baseY),
    );
    out.windToward = Math.PI * 0.75 + 1.2 * fbm2(days * 0.5, 7.7, this.seed + 505, 2);
    return out;
  }
}
