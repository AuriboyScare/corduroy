import type { LiftKind } from '../resort/layout';
import type { Snowpack } from '../snow/snowpack';
import type { LiftLine } from '../terrain/mountain';

/** Engineering and operating figures for one kind of lift. */
export interface LiftType {
  readonly kind: LiftKind;
  readonly label: string;
  readonly price: number;
  /** Rope speed on the line, m/s. */
  readonly lineSpeedMs: number;
  /** Speed through the stations: lower for detachable carriers, m/s. */
  readonly stationSpeedMs: number;
  readonly stationLengthM: number;
  /** Rope distance between carriers on the line, m (0 for a jig-back tram). */
  readonly carrierSpacingM: number;
  readonly seats: number;
  /** Horizontal distance between the up and down rope lines, m. */
  readonly gaugeM: number;
  /** Target horizontal span between towers, m. */
  readonly towerSpacingM: number;
  readonly minTowerHeightM: number;
  /** Tallest tower this kind of lift is built with; beyond it another tower goes in instead, m. */
  readonly maxTowerHeightM: number;
  /** Least distance between a hanging carrier's lowest point and the snow, m. */
  readonly clearanceM: number;
  /** Rope height above the snow at the stations, m. */
  readonly stationRopeHeightM: number;
  /** Carrier hangs this far below the rope, m. */
  readonly hangerM: number;
  /** Mid-span sag per metre squared of span. */
  readonly sagPerSpan2: number;
  readonly accelMs2: number;
  readonly emergencyDecelMs2: number;
  /** Seconds a tram cabin waits at a station between trips. */
  readonly dwellS: number;
}

export const LIFT_TYPES: Record<LiftKind, LiftType> = {
  ropeTow: {
    kind: 'ropeTow',
    label: 'Rope tow',
    price: 6_000,
    lineSpeedMs: 2.4,
    stationSpeedMs: 2.4,
    stationLengthM: 0,
    carrierSpacingM: 9,
    seats: 1,
    gaugeM: 2.4,
    towerSpacingM: 30,
    minTowerHeightM: 1.6,
    maxTowerHeightM: 4,
    clearanceM: 0.7,
    stationRopeHeightM: 1.2,
    hangerM: 0.35,
    sagPerSpan2: 0.0004,
    accelMs2: 0.5,
    emergencyDecelMs2: 1.5,
    dwellS: 0,
  },
  chair: {
    kind: 'chair',
    label: 'Fixed-grip quad chair',
    price: 28_000,
    lineSpeedMs: 2.3,
    stationSpeedMs: 2.3,
    stationLengthM: 0,
    carrierSpacingM: 15,
    seats: 4,
    gaugeM: 5.2,
    towerSpacingM: 95,
    minTowerHeightM: 7,
    maxTowerHeightM: 26,
    clearanceM: 3.5,
    stationRopeHeightM: 4.6,
    hangerM: 2.3,
    sagPerSpan2: 0.00016,
    accelMs2: 0.4,
    emergencyDecelMs2: 1.2,
    dwellS: 0,
  },
  gondola: {
    kind: 'gondola',
    label: 'Detachable 8-seat gondola',
    price: 85_000,
    lineSpeedMs: 6,
    stationSpeedMs: 0.35,
    stationLengthM: 22,
    carrierSpacingM: 90,
    seats: 8,
    gaugeM: 6,
    towerSpacingM: 160,
    minTowerHeightM: 9,
    maxTowerHeightM: 36,
    clearanceM: 4,
    stationRopeHeightM: 5.4,
    hangerM: 3.1,
    sagPerSpan2: 0.00012,
    accelMs2: 0.5,
    emergencyDecelMs2: 1.5,
    dwellS: 0,
  },
  tram: {
    kind: 'tram',
    label: 'Aerial tram',
    price: 180_000,
    lineSpeedMs: 10,
    stationSpeedMs: 0.5,
    stationLengthM: 30,
    carrierSpacingM: 0,
    seats: 80,
    gaugeM: 12,
    towerSpacingM: 650,
    minTowerHeightM: 22,
    maxTowerHeightM: 85,
    clearanceM: 8,
    stationRopeHeightM: 9,
    hangerM: 5,
    sagPerSpan2: 0.00009,
    accelMs2: 0.6,
    emergencyDecelMs2: 1.8,
    dwellS: 35,
  },
};

export interface Tower {
  /** Horizontal distance along the line from the bottom station, m. */
  readonly s: number;
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
  /** Rope height at the tower head; the first and last supports are the stations. */
  topY: number;
}

export type LiftState = 'stopped' | 'running' | 'emergency';

/** Pose of one carrier, written by Lift.carrierPose. */
export interface CarrierPose {
  x: number;
  y: number;
  z: number;
  /** Direction of travel, radians: forward is (sin, 0, cos). */
  heading: number;
  /** On the up line (riders aboard) rather than coming back down. */
  up: boolean;
  /** Swing about the rope, radians, positive swinging forward. */
  swing: number;
  /** Which trip this carrier is on, for choosing its passengers. */
  trip: number;
}

const GRAVITY = 9.81;
/** Carriers come down to loading height near the stations; clearance applies beyond this, m. */
const LOADING_ZONE_M = 12;

/**
 * A lift: its line, towers and rope profile, and a simple drive. Carriers are not simulated one
 * by one; their positions follow from how far the rope has travelled.
 */
export class Lift {
  readonly type: LiftType;
  /** Horizontal length of the line, m. */
  readonly lengthM: number;
  readonly towers: Tower[];
  readonly dirX: number;
  readonly dirZ: number;
  state: LiftState = 'stopped';
  /** Commanded share of full line speed. */
  speedSetting = 1;
  /** Rope speed now, m/s. */
  speedMs = 0;
  /** Rope travelled since the lift was built, m; carriers' positions follow from it. */
  travelM = 0;
  /** Swing of the carriers about the rope, radians, and its rate. */
  swing = 0;
  private swingRate = 0;
  /** Jig-back only: cabin position along the line (0..1), direction and dwell left. */
  tramT = 0;
  tramDirection = 1;
  tramDwell = 0;
  private lastSpeed = 0;
  /** Loop length in carrier spacing space (stations stretched for detachable carriers). */
  readonly loopU: number;
  readonly carrierCount: number;

  constructor(
    readonly line: LiftLine,
    snow: Snowpack,
  ) {
    this.type = LIFT_TYPES[line.kind];
    const dx = line.top.x - line.bottom.x;
    const dz = line.top.z - line.bottom.z;
    this.lengthM = Math.hypot(dx, dz);
    this.dirX = dx / this.lengthM;
    this.dirZ = dz / this.lengthM;
    this.towers = this.placeTowers(snow);
    const t = this.type;
    if (t.carrierSpacingM > 0) {
      const slow = t.stationSpeedMs / t.lineSpeedMs;
      // Station stretches are traversed slowly, so in rope-spacing terms they are longer.
      const lineU = this.lengthM - 2 * t.stationLengthM + (2 * t.stationLengthM) / slow;
      const turnU = (Math.PI * t.gaugeM) / 2 / (t.stationLengthM > 0 ? slow : 1);
      this.loopU = 2 * lineU + 2 * turnU;
      this.carrierCount = Math.max(2, Math.round(this.loopU / t.carrierSpacingM));
    } else {
      this.loopU = 0;
      this.carrierCount = 2;
    }
  }

  /** Seats carried up per hour at full speed. */
  get capacityPerHour(): number {
    const t = this.type;
    if (t.carrierSpacingM === 0) {
      const tripS = this.lengthM / t.lineSpeedMs + t.lineSpeedMs / t.accelMs2 + t.dwellS;
      return (t.seats * 3600) / tripS;
    }
    return (t.seats * 3600 * t.lineSpeedMs) / t.carrierSpacingM;
  }

  /** Rope height at horizontal distance s along the line: chords between supports, sagging. */
  ropeY(s: number): number {
    return this.ropeYOn(this.towers, s);
  }

  private ropeYOn(towers: readonly Tower[], s: number): number {
    let k = 0;
    while (k < towers.length - 2 && towers[k + 1]!.s < s) k++;
    const a = towers[k]!;
    const b = towers[k + 1]!;
    const span = b.s - a.s;
    const t = Math.max(0, Math.min(1, (s - a.s) / span));
    const sag = this.type.sagPerSpan2 * span * span;
    return a.topY + (b.topY - a.topY) * t - 4 * sag * t * (1 - t);
  }

  /** Lowest a hanging carrier comes above the snow anywhere on the line, m. */
  minClearance(snow: Snowpack): number {
    let least = Infinity;
    const t = this.type;
    const zone = Math.max(t.stationLengthM, LOADING_ZONE_M);
    for (let s = zone; s <= this.lengthM - zone; s += 2) {
      for (const side of [-1, 1]) {
        const x = this.line.bottom.x + this.dirX * s - this.dirZ * side * (t.gaugeM / 2);
        const z = this.line.bottom.z + this.dirZ * s + this.dirX * side * (t.gaugeM / 2);
        least = Math.min(least, this.ropeY(s) - t.hangerM - snow.surfaceAt(x, z));
      }
    }
    return least;
  }

  private placeTowers(snow: Snowpack): Tower[] {
    const t = this.type;
    const spans = Math.max(1, Math.round(this.lengthM / t.towerSpacingM));
    const towers: Tower[] = [];
    for (let k = 0; k <= spans; k++) {
      const s = (this.lengthM * k) / spans;
      const x = this.line.bottom.x + this.dirX * s;
      const z = this.line.bottom.z + this.dirZ * s;
      const groundY = snow.surfaceAt(x, z);
      const station = k === 0 || k === spans;
      towers.push({ s, x, z, groundY, topY: groundY + (station ? t.stationRopeHeightM : t.minTowerHeightM) });
    }
    // Raise towers wherever a hanging carrier would come too close to the snow.
    for (let pass = 0; pass < 200; pass++) {
      let raised = false;
      for (let k = 0; k < towers.length - 1; k++) {
        const a = towers[k]!;
        const b = towers[k + 1]!;
        let worst = 0;
        let worstT = 0.5;
        const zone = Math.max(t.stationLengthM, LOADING_ZONE_M);
        for (let s = Math.max(a.s, zone); s <= Math.min(b.s, this.lengthM - zone); s += 2) {
          // Both rope lines: on a cross-slope the uphill one is the closer to the snow.
          const x = this.line.bottom.x + this.dirX * s;
          const z = this.line.bottom.z + this.dirZ * s;
          const ox = this.dirZ * (t.gaugeM / 2);
          const oz = -this.dirX * (t.gaugeM / 2);
          const ground = Math.max(
            snow.surfaceAt(x + ox, z + oz),
            snow.surfaceAt(x - ox, z - oz),
            snow.surfaceAt(x, z),
          );
          const deficit = t.clearanceM - (this.ropeYOn(towers, s) - t.hangerM - ground);
          if (deficit > worst) {
            worst = deficit;
            worstT = (s - a.s) / (b.s - a.s);
          }
        }
        if (worst <= 0.01) continue;
        // A big shortfall over a long span means the line crosses a crest: set a tower there
        // rather than stretching its neighbours (trams instead cross on a few very tall towers,
        // until even those would be too tall).
        const lift = worst + 0.25;
        const tooTall = (tower: Tower, extra: number) =>
          tower.topY + extra - tower.groundY > t.maxTowerHeightM;
        const crest = worst > 4 && t.kind !== 'tram';
        if ((crest || tooTall(a, lift) || tooTall(b, lift)) && b.s - a.s > 40) {
          const s = a.s + (b.s - a.s) * Math.min(0.8, Math.max(0.2, worstT));
          const x = this.line.bottom.x + this.dirX * s;
          const z = this.line.bottom.z + this.dirZ * s;
          const groundY = snow.surfaceAt(x, z);
          towers.splice(k + 1, 0, { s, x, z, groundY, topY: groundY + t.minTowerHeightM });
          raised = true;
          break;
        }
        // Share the lift between the two supports by how close the low point is to each. Stations
        // can be built up too, to a limit, where the approach is steep.
        const station = t.stationRopeHeightM * 2.5;
        const raise = (tower: Tower, extra: number, isStation: boolean) => {
          const cap = isStation ? station : t.maxTowerHeightM;
          tower.topY = Math.min(tower.groundY + cap, tower.topY + extra);
        };
        raise(a, lift * (1 - worstT) * 1.2, k === 0);
        raise(b, lift * worstT * 1.2, k + 1 === towers.length - 1);
        raised = true;
      }
      if (!raised) break;
    }
    return towers;
  }

  /** Moving state, for saves: everything that carries from one step to the next. */
  captureState(): number[] {
    const states: LiftState[] = ['stopped', 'running', 'emergency'];
    return [
      states.indexOf(this.state),
      this.speedSetting,
      this.speedMs,
      this.travelM,
      this.swing,
      this.swingRate,
      this.tramT,
      this.tramDirection,
      this.tramDwell,
      this.lastSpeed,
    ];
  }

  restoreState(values: readonly number[]): void {
    if (values.length !== 10) throw new Error('saved lift state has the wrong length');
    const states: LiftState[] = ['stopped', 'running', 'emergency'];
    this.state = states[values[0]!] ?? 'stopped';
    [
      ,
      this.speedSetting,
      this.speedMs,
      this.travelM,
      this.swing,
      this.swingRate,
      this.tramT,
      this.tramDirection,
      this.tramDwell,
      this.lastSpeed,
    ] = values as [number, number, number, number, number, number, number, number, number, number];
  }

  start(): void {
    if (this.state !== 'running') this.state = 'running';
  }

  stop(): void {
    if (this.state === 'running') this.state = 'stopped';
  }

  emergencyStop(): void {
    if (this.speedMs > 0.01) this.state = 'emergency';
    else this.state = 'stopped';
  }

  step(dt: number): void {
    const t = this.type;
    const target = this.state === 'running' ? this.speedSetting * t.lineSpeedMs : 0;
    const rate = this.state === 'emergency' ? t.emergencyDecelMs2 : t.accelMs2;
    const change = target - this.speedMs;
    this.speedMs += Math.max(-rate * dt, Math.min(rate * dt, change));
    if (this.state === 'emergency' && this.speedMs <= 0.001) {
      this.speedMs = 0;
      this.state = 'stopped';
    }

    if (t.carrierSpacingM === 0) this.stepTram(dt);
    else this.travelM += this.speedMs * dt;

    // Carriers swing like pendulums when the rope speeds up or brakes.
    const accel = (this.speedMs - this.lastSpeed) / Math.max(dt, 1e-6);
    this.lastSpeed = this.speedMs;
    const length = t.hangerM;
    const swingAccel = -(GRAVITY / length) * Math.sin(this.swing) - 0.45 * this.swingRate - accel / length;
    this.swingRate += swingAccel * dt;
    this.swing += this.swingRate * dt;
  }

  /** Jig-back: both cabins on one haul rope, one up while the other comes down. */
  private stepTram(dt: number): void {
    const t = this.type;
    if (this.tramDwell > 0) {
      if (this.state === 'running') this.tramDwell -= dt;
      this.speedMs = 0;
      return;
    }
    // Slow for the station approach: the speed that can still stop at the end.
    const remaining = (this.tramDirection > 0 ? 1 - this.tramT : this.tramT) * this.lengthM;
    const braking = Math.sqrt(2 * t.accelMs2 * Math.max(0, remaining - 1)) + t.stationSpeedMs;
    if (this.speedMs > braking) this.speedMs = Math.max(0, braking);
    this.tramT += (this.tramDirection * this.speedMs * dt) / this.lengthM;
    this.travelM += this.speedMs * dt;
    if (this.tramT >= 1 || this.tramT <= 0) {
      this.tramT = Math.max(0, Math.min(1, this.tramT));
      this.tramDirection = -this.tramDirection;
      this.tramDwell = t.dwellS;
      this.speedMs = 0;
    }
  }

  /** Position of carrier i along the loop; for a tram, i is cabin 0 or 1. */
  carrierPose(i: number, out: CarrierPose): CarrierPose {
    const t = this.type;
    const half = t.gaugeM / 2;
    if (t.carrierSpacingM === 0) {
      // Cabin 0 rides the right-hand track, cabin 1 the left; they pass at mid line.
      const along = i === 0 ? this.tramT : 1 - this.tramT;
      const going = i === 0 ? this.tramDirection : -this.tramDirection;
      this.place(out, along * this.lengthM, i === 0 ? -half : half, going > 0);
      out.trip = Math.floor(this.travelM / this.lengthM);
      out.swing = this.swing * 0.4;
      return out;
    }
    const slow = t.stationSpeedMs / t.lineSpeedMs;
    const station = t.stationLengthM;
    const lineU = this.lengthM - 2 * station + (2 * station) / slow;
    const turnU = (Math.PI * t.gaugeM) / 2 / (station > 0 ? slow : 1);
    const raw = this.travelM + (i * this.loopU) / this.carrierCount;
    const lap = Math.floor(raw / this.loopU);
    let u = raw - lap * this.loopU;
    out.trip = lap;
    out.swing = this.swing * (0.8 + 0.4 * (((i * 7919) % 13) / 13));
    // Map loop position to distance along the line, stretching the slow station sections.
    const toS = (along: number): number => {
      const inSlow = station / slow;
      if (along < inSlow) return along * slow;
      if (along > lineU - inSlow) return this.lengthM - (lineU - along) * slow;
      return station + (along - inSlow);
    };
    if (u < lineU) {
      this.place(out, toS(u), -half, true);
      if (station > 0 && (u < station / slow || u > lineU - station / slow)) out.swing *= 0.2;
      return out;
    }
    u -= lineU;
    if (u < turnU) {
      this.bullwheel(out, u / turnU, true);
      return out;
    }
    u -= turnU;
    if (u < lineU) {
      this.place(out, this.lengthM - toS(u), half, false);
      return out;
    }
    u -= lineU;
    this.bullwheel(out, u / turnU, false);
    return out;
  }

  private place(out: CarrierPose, s: number, side: number, up: boolean): void {
    out.x = this.line.bottom.x + this.dirX * s - this.dirZ * side;
    out.z = this.line.bottom.z + this.dirZ * s + this.dirX * side;
    out.y = this.ropeY(s) - this.type.hangerM;
    out.heading = Math.atan2(this.dirX, this.dirZ) + (up ? 0 : Math.PI);
    out.up = up;
  }

  /** Half-turn round the top (atTop) or bottom bullwheel; f runs 0..1 through the turn. */
  private bullwheel(out: CarrierPose, f: number, atTop: boolean): void {
    const half = this.type.gaugeM / 2;
    const cx = atTop ? this.line.top.x : this.line.bottom.x;
    const cz = atTop ? this.line.top.z : this.line.bottom.z;
    const fx = this.dirX;
    const fz = this.dirZ;
    // The up line runs on the (dirZ, -dirX) side; the turn goes round the far side of the wheel.
    const sx = atTop ? fz : -fz;
    const sz = atTop ? -fx : fx;
    const tx = atTop ? fx : -fx;
    const tz = atTop ? fz : -fz;
    const c = Math.cos(Math.PI * f);
    const sn = Math.sin(Math.PI * f);
    out.x = cx + half * (c * sx + sn * tx);
    out.z = cz + half * (c * sz + sn * tz);
    out.y = this.ropeY(atTop ? this.lengthM : 0) - this.type.hangerM;
    out.heading = Math.atan2(-sn * sx + c * tx, -sn * sz + c * tz);
    out.up = !atTop;
    out.swing = 0;
  }
}
