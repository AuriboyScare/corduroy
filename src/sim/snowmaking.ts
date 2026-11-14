import { clamp01 } from './rng';
import { GOOD_COVER_M, type Snowpack } from './snow/snowpack';
import type { Mountain } from './terrain/mountain';
import { GAME_TIME_SCALE, type Conditions, type Weather } from './weather';

/** Distance between guns along a run, m. */
export const GUN_SPACING_M = 60;
/** A fan gun's snow output in ideal conditions, kg per game second (about 50 m³ an hour). */
export const GUN_OUTPUT_KG_S = 5.8;
/** Density of fresh machine-made snow, kg/m³: much denser than natural powder. */
export const MADE_SNOW_DENSITY = 420;
/** Wet-bulb temperature at which a gun starts making snow, and where it reaches full output, °C. */
export const WET_BULB_START_C = -2;
export const WET_BULB_FULL_C = -9;
/** Price of installing one gun with its hydrant and pipework. */
export const GUN_PRICE = 1_800;
/** Water and electricity per cubic metre of snow made. */
export const COST_PER_M3 = 0.45;
/** Snow is laid this far into the run from the gun, and spread over this footprint, m. */
const THROW_M = 13;
const FOOTPRINT_LENGTH_M = 22;
const FOOTPRINT_WIDTH_M = 9;

export type GunMode = 'off' | 'auto' | 'on';

export interface SnowGun {
  readonly run: number;
  readonly x: number;
  readonly z: number;
  /** Ground height at the gun, m. */
  readonly y: number;
  /** Unit vector from the gun into the run. */
  readonly inX: number;
  readonly inZ: number;
}

/** Share of full output a gun reaches at a wet-bulb temperature. */
export function gunEfficiency(wetBulbC: number): number {
  return clamp01((WET_BULB_START_C - wetBulbC) / (WET_BULB_START_C - WET_BULB_FULL_C));
}

/**
 * Snow guns along the runs: each makes snow at a rate set by the wet-bulb temperature where it
 * stands, and lays it in a pile downwind inside the run, which a groomer then has to spread.
 */
export class Snowmaking {
  /** Every gun position on the mountain, whether installed or not. */
  readonly guns: SnowGun[] = [];
  /** Per run: guns installed, and how they are run. */
  readonly installed: boolean[];
  readonly mode: GunMode[];
  /** Per gun: snow produced and not yet laid down, kg. */
  private readonly pending: Float64Array;
  /** Per gun: current output, kg per game second, for the interface and the plumes. */
  readonly output: Float64Array;
  /** Running cost owed but not yet charged. */
  pendingCost = 0;
  private readonly conditions: Conditions = { tempC: 0, humidity: 0, wetBulbC: 0, windMs: 0, windToward: 0 };
  private tick = 0;

  constructor(
    private readonly mountain: Mountain,
    private readonly snow: Snowpack,
  ) {
    mountain.runs.forEach((run, r) => {
      const line = run.line;
      const samples = line.length / 2;
      const step = Math.round(GUN_SPACING_M / 2);
      let side = 1;
      // Start a little below the top and stop short of the base area.
      for (let i = Math.round(step / 2); i < samples - step / 2; i += step) {
        const x = line[i * 2]!;
        const z = line[i * 2 + 1]!;
        const j = Math.min(samples - 1, i + 1);
        const dx = line[j * 2]! - x;
        const dz = line[j * 2 + 1]! - z;
        const len = Math.hypot(dx, dz) || 1;
        // Alternate sides, standing just outside the run edge, pointing in.
        const nx = (-dz / len) * side;
        const nz = (dx / len) * side;
        const gx = x + nx * (run.halfWidthM + 2);
        const gz = z + nz * (run.halfWidthM + 2);
        this.guns.push({ run: r, x: gx, z: gz, y: snow.surfaceAt(gx, gz), inX: -nx, inZ: -nz });
        side = -side;
      }
    });
    this.installed = mountain.runs.map(() => false);
    this.mode = mountain.runs.map((): GunMode => 'auto');
    this.pending = new Float64Array(this.guns.length);
    this.output = new Float64Array(this.guns.length);
  }

  gunsOn(run: number): SnowGun[] {
    return this.guns.filter((g) => g.run === run);
  }

  /** Price of installing snowmaking on a run. */
  price(run: number): number {
    return this.gunsOn(run).length * GUN_PRICE;
  }

  /** Whether a gun on this run should be running now. */
  private running(run: number, wetBulbC: number, cover: number): boolean {
    if (!this.installed[run]) return false;
    const mode = this.mode[run]!;
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    // Automatic: only when it is cold enough to make snow, and only where cover is still short.
    return gunEfficiency(wetBulbC) > 0.15 && cover < GOOD_COVER_M * 2.2;
  }

  /** Advances one real-time step; returns kg of snow made this step. */
  step(realSeconds: number, weather: Weather): number {
    const gameSeconds = realSeconds * GAME_TIME_SCALE;
    let made = 0;
    this.tick++;
    for (let k = 0; k < this.guns.length; k++) {
      const gun = this.guns[k]!;
      const c = weather.at(gun.y, this.conditions);
      const cover = this.snow.coverDepth(
        this.snow.grid.nearest(gun.x + gun.inX * THROW_M, gun.z + gun.inZ * THROW_M),
      );
      if (!this.running(gun.run, c.wetBulbC, cover)) {
        this.output[k] = 0;
        continue;
      }
      const rate = GUN_OUTPUT_KG_S * gunEfficiency(c.wetBulbC);
      this.output[k] = rate;
      const mass = rate * gameSeconds;
      this.pending[k]! += mass;
      made += mass;
      // Guns lay their snow in turn, about once a second each, so the work is spread out.
      if ((this.tick + k) % 60 === 0 && this.pending[k]! > 0) {
        this.lay(gun, this.pending[k]!, c);
        this.pending[k] = 0;
      }
    }
    this.pendingCost += (made / MADE_SNOW_DENSITY) * COST_PER_M3;
    return made;
  }

  /** Spreads a batch of made snow over the gun's footprint, pushed downwind, then lets it settle. */
  private lay(gun: SnowGun, massKg: number, c: Conditions): void {
    const snow = this.snow;
    const drift = Math.min(10, c.windMs * 1.2);
    const cx = gun.x + gun.inX * THROW_M + Math.sin(c.windToward) * drift;
    const cz = gun.z + gun.inZ * THROW_M + Math.cos(c.windToward) * drift;
    // Elliptical footprint along the throw, heaviest in the middle.
    const cells: number[] = [];
    const weights: number[] = [];
    let total = 0;
    const reach = Math.ceil(FOOTPRINT_LENGTH_M / 2);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const along = dx * gun.inX + dz * gun.inZ;
        const across = -dx * gun.inZ + dz * gun.inX;
        const e = (along / (FOOTPRINT_LENGTH_M / 2)) ** 2 + (across / (FOOTPRINT_WIDTH_M / 2)) ** 2;
        if (e > 1) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!snow.grid.contains(x, z)) continue;
        const w = 1 - e;
        cells.push(snow.grid.nearest(x, z));
        weights.push(w);
        total += w;
      }
    }
    if (total <= 0) return;
    for (let k = 0; k < cells.length; k++)
      snow.deposit(cells[k]!, (massKg * weights[k]!) / total, MADE_SNOW_DENSITY);
    snow.relaxAround(cx, cz, FOOTPRINT_LENGTH_M / 2 + 3);
  }

  /** Charges what the guns have cost since the last call; returns the whole dollars charged. */
  takeCost(): number {
    const whole = Math.floor(this.pendingCost);
    this.pendingCost -= whole;
    return whole;
  }
}
