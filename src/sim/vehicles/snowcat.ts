import { clamp01 } from '../rng';
import { PUSHED_DENSITY, type Snowpack } from '../snow/snowpack';
import { RigidBody } from './rigidBody';

/**
 * Tracked snow groomer. Body frame: +x left, +y up, +z forward; origin at the centre of mass.
 * Each track is a row of contact points that carry load through a spring and transmit drive and
 * side forces through snow-dependent friction, so steering is skid steering, not a turn rate.
 */
export interface SnowcatSpec {
  readonly name: string;
  readonly massKg: number;
  /** Half the distance between track centrelines, m. */
  readonly trackOffsetM: number;
  readonly trackWidthM: number;
  /** Fore-aft positions of the contact points along each track, m. */
  readonly contactZ: readonly number[];
  /** Track underside below the centre of mass, m. */
  readonly trackBottomM: number;
  readonly enginePowerW: number;
  readonly maxForwardMs: number;
  readonly maxReverseMs: number;
  /** Density the tracks press loose snow to, kg/m3. */
  readonly trackCompactionDensity: number;
  readonly bladeHalfWidthM: number;
  readonly bladeZ: number;
  readonly bladeCapacityKg: number;
  readonly tillerHalfWidthM: number;
  readonly tillerZ: number;
  readonly tillerPowerW: number;
}

export const KESTREL_420: SnowcatSpec = {
  name: 'Kestrel 420',
  massKg: 9800,
  trackOffsetM: 1.45,
  trackWidthM: 1.4,
  contactZ: [-1.9, -0.95, 0, 0.95, 1.9],
  trackBottomM: 1.0,
  enginePowerW: 310_000,
  maxForwardMs: 6.1,
  maxReverseMs: 3.2,
  trackCompactionDensity: 300,
  bladeHalfWidthM: 2.6,
  bladeZ: 3.35,
  bladeCapacityKg: 2500,
  tillerHalfWidthM: 2.7,
  tillerZ: -3.9,
  tillerPowerW: 70_000,
};

export interface SnowcatInput {
  /** -1 (reverse) .. 1 (forward). */
  throttle: number;
  /** -1 (right) .. 1 (left). */
  steer: number;
  /** -1 lower, 0 hold, 1 raise. */
  bladeLift: number;
  /** Tiller commanded down and running. */
  tillerDown: boolean;
}

export const BLADE_MIN_M = -0.3;
export const BLADE_MAX_M = 0.9;
const GRAVITY = 9.81;
const SUBSTEPS = 4;
const SPRING_SAG_M = 0.05;
const BLADE_SAMPLES = 13;

export class Snowcat {
  readonly spec: SnowcatSpec;
  readonly body: RigidBody;
  /** Track belt speeds, m/s. Index 0 is the left track. */
  readonly trackSpeed = new Float64Array(2);
  /** Distance each belt has travelled, m; drives the cleat animation. */
  readonly trackTravel = new Float64Array(2);
  /** Blade cutting edge above the track underside, m. */
  bladeHeightM = 0.25;
  /** Snow carried in front of the blade, kg. */
  bladeLoadKg = 0;
  /** 0 = tiller raised, 1 = on the snow. */
  tillerPos = 0;
  /** Fraction of engine power in use, can exceed 1 briefly when lugging. */
  engineLoad = 0;
  /** Contacts carrying load after the last step. */
  groundedContacts = 0;
  /** Deepest the tracks are sinking into loose snow, m. */
  sinkM = 0;
  /** Friction coefficient under the tracks, averaged over contacts. */
  grip = 0;
  /** Quality of the grooming being laid right now, 0..1; 0 when the tiller is not working. */
  groomQuality = 0;

  private readonly springK: number;
  private readonly springC: number;
  private readonly sideGroundSpeed = new Float64Array(2);
  private cutRateKgS = 0;

  constructor(spec: SnowcatSpec = KESTREL_420) {
    this.spec = spec;
    const m = spec.massKg;
    // Box-like inertia for a machine about 4.4 m wide, 2.6 m tall and 8 m long with implements.
    this.body = new RigidBody(
      m,
      (m * (2.6 ** 2 + 8 ** 2)) / 12,
      (m * (4.4 ** 2 + 8 ** 2)) / 12,
      (m * (4.4 ** 2 + 2.6 ** 2)) / 12,
    );
    const contacts = spec.contactZ.length * 2;
    this.springK = (m * GRAVITY) / contacts / SPRING_SAG_M;
    this.springC = 2 * 0.75 * Math.sqrt((this.springK * m) / contacts);
  }

  /** Parks the machine on the snow at a position. */
  place(x: number, z: number, heading: number, snow: Snowpack): void {
    const y = snow.supportAt(x, z, this.spec.trackCompactionDensity) + this.spec.trackBottomM - SPRING_SAG_M;
    this.body.reset(x, y, z, heading);
    this.trackSpeed.fill(0);
  }

  get heading(): number {
    this.body.toWorld(0, 0, 1);
    return Math.atan2(this.body.ox, this.body.oz);
  }

  /** Speed along the machine's forward axis, m/s. */
  get forwardSpeed(): number {
    const b = this.body;
    b.toWorld(0, 0, 1);
    return b.vx * b.ox + b.vy * b.oy + b.vz * b.oz;
  }

  /** Nose-up pitch in radians. */
  get pitch(): number {
    this.body.toWorld(0, 0, 1);
    return Math.asin(Math.max(-1, Math.min(1, this.body.oy)));
  }

  /** Roll in radians, positive when the left side is high. */
  get roll(): number {
    this.body.toWorld(1, 0, 0);
    return Math.asin(Math.max(-1, Math.min(1, this.body.oy)));
  }

  get tillerWorking(): boolean {
    return this.tillerPos > 0.95;
  }

  /** Advances one simulation step. `obstacles` yields tree trunks near a position. */
  step(dt: number, input: SnowcatInput, snow: Snowpack, obstacles: ObstacleQuery | null): void {
    this.bladeHeightM = Math.max(
      BLADE_MIN_M,
      Math.min(BLADE_MAX_M, this.bladeHeightM + input.bladeLift * 0.45 * dt),
    );
    this.tillerPos = clamp01(this.tillerPos + (input.tillerDown ? 1 : -1) * 1.3 * dt);

    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h, input, snow, obstacles);
    this.trackTravel[0]! += this.trackSpeed[0]! * dt;
    this.trackTravel[1]! += this.trackSpeed[1]! * dt;
    this.work(dt, snow);
  }

  private substep(h: number, input: SnowcatInput, snow: Snowpack, obstacles: ObstacleQuery | null): void {
    const spec = this.spec;
    const b = this.body;
    const rhoC = spec.trackCompactionDensity;

    // Drive: each belt chases its commanded speed; an overloaded engine drags belts back toward ground speed.
    const base =
      input.throttle >= 0 ? input.throttle * spec.maxForwardMs : input.throttle * spec.maxReverseMs;
    const diff = input.steer * Math.max(1.3, Math.abs(base) * 0.55);
    const over = Math.max(0, this.engineLoad - 1);
    for (let side = 0; side < 2; side++) {
      const target = base + (side === 0 ? -diff : diff);
      let u = this.trackSpeed[side]!;
      const step = 3.6 * h * (1 - Math.min(0.9, over * 2));
      u += Math.max(-step, Math.min(step, target - u));
      if (over > 0) u += (this.sideGroundSpeed[side]! - u) * Math.min(1, over * 6) * h * 5;
      this.trackSpeed[side] = u;
    }

    b.toWorld(0, 0, 1);
    const fwx = b.ox;
    const fwy = b.oy;
    const fwz = b.oz;

    let power = 0;
    let grounded = 0;
    let sink = 0;
    let gripSum = 0;
    for (let side = 0; side < 2; side++) {
      const lx = side === 0 ? spec.trackOffsetM : -spec.trackOffsetM;
      const u = this.trackSpeed[side]!;
      let groundSpeed = 0;
      let touching = 0;
      for (let c = 0; c < spec.contactZ.length; c++) {
        b.toWorld(lx, -spec.trackBottomM, spec.contactZ[c]!);
        const x = b.px + b.ox;
        const y = b.py + b.oy;
        const z = b.pz + b.oz;
        const support = snow.supportAt(x, z, rhoC);
        if (support <= y) continue;

        // Surface normal from the support height gradient.
        let nx = -(snow.supportAt(x + 0.6, z, rhoC) - snow.supportAt(x - 0.6, z, rhoC)) / 1.2;
        let nz = -(snow.supportAt(x, z + 0.6, rhoC) - snow.supportAt(x, z - 0.6, rhoC)) / 1.2;
        const nl = 1 / Math.hypot(nx, 1, nz);
        nx *= nl;
        nz *= nl;
        const ny = nl;

        b.pointVelocity(x, y, z);
        const pvx = b.ox;
        const pvy = b.oy;
        const pvz = b.oz;
        const depth = Math.min(0.6, (support - y) * ny);
        const normalForce = Math.max(
          0,
          this.springK * depth - this.springC * (pvx * nx + pvy * ny + pvz * nz),
        );
        if (normalForce <= 0) continue;

        // Friction frame on the surface: t along the track, l across it.
        const fd = fwx * nx + fwy * ny + fwz * nz;
        let tx = fwx - fd * nx;
        let ty = fwy - fd * ny;
        let tz = fwz - fd * nz;
        const tl = 1 / Math.hypot(tx, ty, tz);
        tx *= tl;
        ty *= tl;
        tz *= tl;
        const lxw = ny * tz - nz * ty;
        const lyw = nz * tx - nx * tz;
        const lzw = nx * ty - ny * tx;

        const i = snow.grid.nearest(x, z);
        const top = snow.top[i]!;
        const rho = snow.density[i]!;
        const mu = top < 0.02 ? (snow.base[i]! > 0.02 ? 0.8 : 0.6) : 0.42 + 0.4 * clamp01((rho - 120) / 280);
        const cellSink = rho < rhoC ? top * (1 - rho / rhoC) : 0;

        const vLong = pvx * tx + pvy * ty + pvz * tz;
        const vLat = pvx * lxw + pvy * lyw + pvz * lzw;
        let fLong = mu * normalForce * Math.tanh((u - vLong) / 0.04);
        let fLat = -0.9 * mu * normalForce * Math.tanh(vLat / 0.15);
        const limit = mu * normalForce;
        const mag = Math.hypot(fLong, fLat);
        if (mag > limit) {
          fLong *= limit / mag;
          fLat *= limit / mag;
        }
        power += Math.max(0, fLong * u);
        // Motion resistance grows with how far the track sinks.
        fLong -= (0.04 + 0.3 * cellSink) * normalForce * Math.tanh(vLong / 0.2);

        b.applyForceAt(
          normalForce * nx + fLong * tx + fLat * lxw,
          normalForce * ny + fLong * ty + fLat * lyw,
          normalForce * nz + fLong * tz + fLat * lzw,
          x,
          y,
          z,
        );
        groundSpeed += vLong;
        touching++;
        gripSum += mu;
        if (cellSink > sink) sink = cellSink;
      }
      this.sideGroundSpeed[side] = touching > 0 ? groundSpeed / touching : this.trackSpeed[side]!;
      grounded += touching;
    }

    // Implement drag acts low at the front (blade) and rear (tiller).
    const vf = b.vx * fwx + b.vy * fwy + b.vz * fwz;
    if (vf > 0.05 && (this.bladeLoadKg > 0 || this.cutRateKgS > 0)) {
      const drag = Math.min(45_000, this.bladeLoadKg * GRAVITY * 0.3 + this.cutRateKgS * 18);
      b.toWorld(0, -0.6, spec.bladeZ);
      b.applyForceAt(-drag * fwx, -drag * fwy, -drag * fwz, b.px + b.ox, b.py + b.oy, b.pz + b.oz);
    }
    if (this.tillerWorking) {
      power += spec.tillerPowerW;
      if (Math.abs(vf) > 0.05) {
        const drag = 5000 * Math.sign(vf);
        b.toWorld(0, -0.8, spec.tillerZ);
        b.applyForceAt(-drag * fwx, -drag * fwy, -drag * fwz, b.px + b.ox, b.py + b.oy, b.pz + b.oz);
      }
    }

    if (obstacles) this.collide(obstacles);

    // Keep the machine on the map.
    const margin = 24;
    const size = snow.grid.sizeM;
    const k = 2e5;
    if (b.px < margin) b.applyForceAt(k * (margin - b.px), 0, 0, b.px, b.py, b.pz);
    if (b.px > size - margin) b.applyForceAt(-k * (b.px - size + margin), 0, 0, b.px, b.py, b.pz);
    if (b.pz < margin) b.applyForceAt(0, 0, k * (margin - b.pz), b.px, b.py, b.pz);
    if (b.pz > size - margin) b.applyForceAt(0, 0, -k * (b.pz - size + margin), b.px, b.py, b.pz);

    b.integrate(h, GRAVITY);
    const damp = 1 - 0.3 * h;
    b.wx *= damp;
    b.wy *= damp;
    b.wz *= damp;

    this.engineLoad += (power / spec.enginePowerW - this.engineLoad) * Math.min(1, h * 12);
    this.groundedContacts = grounded;
    this.sinkM = sink;
    this.grip = grounded > 0 ? gripSum / grounded : 0;
  }

  /** Pushes the hull out of tree trunks with a stiff penalty force. */
  private collide(obstacles: ObstacleQuery): void {
    const b = this.body;
    const hx = this.spec.trackOffsetM + this.spec.trackWidthM / 2;
    const zFront = this.spec.bladeZ + 0.2;
    const zRear = this.spec.tillerZ - 0.5;
    obstacles.forEachNear(b.px, b.pz, 7, (ox, oz, radius) => {
      b.toBody(ox - b.px, 0, oz - b.pz);
      const lx = b.ox;
      const lz = b.oz;
      const cx = Math.max(-hx, Math.min(hx, lx));
      const cz = Math.max(zRear, Math.min(zFront, lz));
      let dx = lx - cx;
      let dz = lz - cz;
      let d = Math.hypot(dx, dz);
      let pen: number;
      if (d > 1e-6) {
        if (d >= radius) return;
        pen = radius - d;
        dx /= d;
        dz /= d;
      } else {
        // Trunk centre is inside the hull outline: leave by the nearest side.
        const toLeft = hx - lx;
        const toRight = lx + hx;
        const toFront = zFront - lz;
        const toRear = lz - zRear;
        d = Math.min(toLeft, toRight, toFront, toRear);
        dx = d === toLeft ? 1 : d === toRight ? -1 : 0;
        dz = dx !== 0 ? 0 : d === toFront ? 1 : -1;
        pen = d + radius;
      }
      b.toWorld(dx, 0, dz);
      const nx = b.ox;
      const nz = b.oz;
      b.toWorld(cx, -0.3, cz);
      const wx = b.px + b.ox;
      const wy = b.py + b.oy;
      const wz = b.pz + b.oz;
      b.pointVelocity(wx, wy, wz);
      const closing = b.ox * nx + b.oz * nz;
      const force = Math.min(6e5, 3e6 * pen + 9e4 * Math.max(0, closing));
      b.applyForceAt(-force * nx, 0, -force * nz, wx, wy, wz);
    });
  }

  /** Applies tracks, blade and tiller to the snow for one step. */
  private work(dt: number, snow: Snowpack): void {
    const spec = this.spec;
    const b = this.body;
    const vf = this.forwardSpeed;
    b.toWorld(0, 0, 1);
    const hl = 1 / Math.max(1e-6, Math.hypot(b.ox, b.oz));
    const dirX = b.ox * hl;
    const dirZ = b.oz * hl;

    // Tracks: compact the snow and leave cleat marks behind the rearmost contact.
    if (Math.abs(vf) > 0.05 && this.groundedContacts > 0) {
      const zEnd = vf > 0 ? spec.contactZ[0]! : spec.contactZ[spec.contactZ.length - 1]!;
      for (let side = 0; side < 2; side++) {
        const centre = side === 0 ? spec.trackOffsetM : -spec.trackOffsetM;
        for (let k = 0; k <= 6; k++) {
          b.toWorld(centre + (k / 6 - 0.5) * spec.trackWidthM, -spec.trackBottomM, zEnd);
          const x = b.px + b.ox;
          const z = b.pz + b.oz;
          if (!snow.grid.contains(x, z)) continue;
          snow.trackOver(snow.grid.nearest(x, z), spec.trackCompactionDensity);
          snow.markSurface(x, z, 0, 235, dirX, dirZ);
        }
      }
    }

    // Blade: cut what stands above the edge, fill hollows below it from the carried load.
    let cutKg = 0;
    const edgeY = -spec.trackBottomM + this.bladeHeightM;
    if (vf > 0.05) {
      for (let k = 0; k < BLADE_SAMPLES; k++) {
        const lx = (k / (BLADE_SAMPLES - 1) - 0.5) * 2 * spec.bladeHalfWidthM;
        b.toWorld(lx, edgeY, spec.bladeZ);
        const x = b.px + b.ox;
        const z = b.pz + b.oz;
        if (!snow.grid.contains(x, z)) continue;
        const i = snow.grid.nearest(x, z);
        const y = b.py + b.oy;
        const cut = snow.cutTo(i, y);
        if (cut > 0) {
          cutKg += cut;
          this.bladeLoadKg += cut;
        } else if (this.bladeLoadKg > 0) {
          this.bladeLoadKg -= snow.fillTo(i, y - 0.02, this.bladeLoadKg, PUSHED_DENSITY);
        }
      }
      // A full blade spills windrows off both ends.
      const spill = this.bladeLoadKg - spec.bladeCapacityKg;
      if (spill > 0) {
        for (const end of [-1, 1]) {
          b.toWorld(end * (spec.bladeHalfWidthM + 0.7), edgeY, spec.bladeZ);
          const x = Math.max(0, Math.min(snow.grid.sizeM, b.px + b.ox));
          const z = Math.max(0, Math.min(snow.grid.sizeM, b.pz + b.oz));
          snow.deposit(snow.grid.nearest(x, z), spill / 2, PUSHED_DENSITY);
        }
        this.bladeLoadKg = spec.bladeCapacityKg;
      }
    } else if (vf < -0.05 && this.bladeLoadKg > 0) {
      // Backing away leaves the pile where it was.
      const share = this.bladeLoadKg / BLADE_SAMPLES;
      for (let k = 0; k < BLADE_SAMPLES; k++) {
        const lx = (k / (BLADE_SAMPLES - 1) - 0.5) * 2 * spec.bladeHalfWidthM;
        b.toWorld(lx, edgeY, spec.bladeZ + 0.4);
        const x = Math.max(0, Math.min(snow.grid.sizeM, b.px + b.ox));
        const z = Math.max(0, Math.min(snow.grid.sizeM, b.pz + b.oz));
        snow.deposit(snow.grid.nearest(x, z), share, PUSHED_DENSITY);
      }
      this.bladeLoadKg = 0;
    }
    this.cutRateKgS += (cutKg / dt - this.cutRateKgS) * Math.min(1, dt * 6);

    // Tiller: mill and re-lay the surface, leaving corduroy. Quality falls off when driven too fast.
    this.groomQuality = 0;
    if (this.tillerWorking && vf > 0.2 && this.groundedContacts > 0) {
      const quality = clamp01(1 - (vf - 4.2) / 2.5);
      this.groomQuality = quality;
      const q = Math.max(1, Math.round(255 * quality));
      const samples = Math.round((spec.tillerHalfWidthM * 2) / 0.2);
      for (let k = 0; k <= samples; k++) {
        const lx = (k / samples - 0.5) * 2 * spec.tillerHalfWidthM;
        b.toWorld(lx, -spec.trackBottomM, spec.tillerZ);
        const x = b.px + b.ox;
        const z = b.pz + b.oz;
        if (!snow.grid.contains(x, z)) continue;
        snow.till(snow.grid.nearest(x, z), q);
        snow.markSurface(x, z, q, 0, dirX, dirZ);
      }
    }
  }
}

/** Finds solid obstacles (tree trunks) near a point. */
export interface ObstacleQuery {
  forEachNear(
    x: number,
    z: number,
    radius: number,
    visit: (x: number, z: number, radius: number) => void,
  ): void;
}
