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
  /** Outline used for inertia and collisions, m. */
  readonly bodyWidthM: number;
  readonly bodyHeightM: number;
  readonly bodyLengthM: number;
  /** How fast the blade rises or falls, m/s. */
  readonly bladeRateMs: number;
  /** How fast the tiller lowers or lifts, fraction of its travel per second. */
  readonly tillerRate: number;
  /** Fastest working speed at which the finisher still lays full-quality corduroy, m/s. */
  readonly cleanSpeedMs: number;
  /** Multiplier on track friction, from track and grouser options. */
  readonly gripFactor: number;
  /** Winch fitted: maximum line pull, N (0 = no winch). */
  readonly winchPullN: number;
  readonly winchCableM: number;
  /** Cruise control fitted. */
  readonly cruiseControl: boolean;
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
  bodyWidthM: 4.4,
  bodyHeightM: 2.6,
  bodyLengthM: 8,
  bladeRateMs: 0.45,
  tillerRate: 1.3,
  cleanSpeedMs: 4.2,
  gripFactor: 1,
  winchPullN: 0,
  winchCableM: 0,
  cruiseControl: false,
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
  /** -1 lowers, 1 raises the winch tension setting. */
  winchAdjust?: number;
}

export interface WinchPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the cable's pull acts on the frame: the drum, low on the engine deck, in Kestrel 420 body
 * coordinates (scaled per machine). Pulling from higher up pitches the machine over when the
 * cable runs out.
 */
const WINCH_DRUM = { y: 1.02, z: -1.55 } as const;
/** Stiffness of the cable once it is fully paid out, N/m. */
const CABLE_STOP_K = 1.5e5;
/** The drum brake slips above this multiple of the winch's rated pull. */
const CABLE_STOP_LIMIT = 2.2;
/** Over the last stretch of cable the drive interlock slows travel away from the anchor, m. */
const CABLE_END_RAMP_M = 15;

export const BLADE_MIN_M = -0.3;
export const BLADE_MAX_M = 0.9;
const GRAVITY = 9.81;
const SUBSTEPS = 4;
/** How far the bogies deflect under the machine's own weight; also their droop travel. */
const SPRING_SAG_M = 0.12;
/** Share of engine power that reaches the tracks through the hydrostatic drive. */
const DRIVE_EFFICIENCY = 0.85;
/** How quickly the drive can change belt speed, m/s². */
const BELT_ACCEL_MS2 = 3.6;
const BLADE_SAMPLES = 13;

export class Snowcat {
  spec: SnowcatSpec;
  readonly body: RigidBody;
  /** Track belt speeds, m/s. Index 0 is the left track. */
  readonly trackSpeed = new Float64Array(2);
  /** Distance each belt has travelled, m; drives the cleat animation. */
  readonly trackTravel = new Float64Array(2);
  /** Blade cutting edge above the track underside, m. */
  bladeHeightM = 0.4;
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
  /** Anchor the winch cable is hooked to; null when unhooked. */
  winchAnchor: WinchPoint | null = null;
  /** Tension setting as a share of the winch's maximum pull. */
  winchSetting = 0.6;
  /** Cable paid out, m. */
  winchCableOutM = 0;
  /** Pull the cable is exerting, N. */
  winchForceN = 0;
  /** Engine power the winch is drawing to reel in, W. */
  private winchPowerW = 0;
  /** Cable left on the drum, m; Infinity when unhooked. */
  winchRemainingM = Infinity;
  private winchAwayDot = 0;

  private springK = 0;
  private springC = 0;
  /** Traction each track transmitted in the last substep, N. */
  private readonly sideForce = new Float64Array(2);
  private readonly beltTarget = new Float64Array(2);
  private cutRateKgS = 0;

  constructor(spec: SnowcatSpec = KESTREL_420) {
    this.spec = spec;
    this.body = new RigidBody(spec.massKg, 1, 1, 1);
    this.applySpec(spec);
  }

  /**
   * Changes the machine's specification (after an upgrade) without moving it. Mass, inertia and
   * suspension are recomputed so the machine still rests at the same ride height.
   */
  applySpec(spec: SnowcatSpec): void {
    this.spec = spec;
    const m = spec.massKg;
    const { bodyWidthM: w, bodyHeightM: h, bodyLengthM: l } = spec;
    this.body.setMass(m, (m * (h * h + l * l)) / 12, (m * (w * w + l * l)) / 12, (m * (w * w + h * h)) / 12);
    const contacts = spec.contactZ.length * 2;
    this.springK = (m * GRAVITY) / contacts / SPRING_SAG_M;
    this.springC = 2 * 0.75 * Math.sqrt((this.springK * m) / contacts);
    this.bladeHeightM = Math.max(BLADE_MIN_M, Math.min(BLADE_MAX_M, this.bladeHeightM));
    this.bladeLoadKg = Math.min(this.bladeLoadKg, spec.bladeCapacityKg);
  }

  /** Parks the machine on the snow at a position. */
  place(x: number, z: number, heading: number, snow: Snowpack): void {
    // Sit the tracks on the slope: pitch and roll from the snow under the ends and sides of the
    // tracks, so no contact starts buried (which would throw the machine).
    const spec = this.spec;
    const rho = spec.trackCompactionDensity;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const reach = spec.contactZ[spec.contactZ.length - 1]!;
    const side = spec.trackOffsetM;
    const front = snow.supportAt(x + fx * reach, z + fz * reach, rho);
    const rear = snow.supportAt(x - fx * reach, z - fz * reach, rho);
    const left = snow.supportAt(x + fz * side, z - fx * side, rho);
    const right = snow.supportAt(x - fz * side, z + fx * side, rho);
    const noseUp = Math.atan2(front - rear, 2 * reach);
    const leftUp = Math.atan2(left - right, 2 * side);
    const y = (front + rear + left + right) / 4 + spec.trackBottomM / Math.cos(noseUp);
    this.body.reset(x, y, z, heading);
    // Heading about +y, then nose-up pitch (a negative turn about +x), then roll about +z.
    this.body.rotateLocal(1, 0, 0, -noseUp);
    this.body.rotateLocal(0, 0, 1, leftUp);
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

  /** Snow the blade is cutting, kg/s (smoothed). */
  get cutRate(): number {
    return this.cutRateKgS;
  }

  get tillerWorking(): boolean {
    return this.tillerPos > 0.95;
  }

  /** Advances one simulation step. `obstacles` yields tree trunks near a position. */
  step(dt: number, input: SnowcatInput, snow: Snowpack, obstacles: ObstacleQuery | null): void {
    this.bladeHeightM = Math.max(
      BLADE_MIN_M,
      Math.min(BLADE_MAX_M, this.bladeHeightM + input.bladeLift * this.spec.bladeRateMs * dt),
    );
    this.tillerPos = clamp01(this.tillerPos + (input.tillerDown ? 1 : -1) * this.spec.tillerRate * dt);
    if (input.winchAdjust) this.winchSetting = clamp01(this.winchSetting + input.winchAdjust * 0.4 * dt);

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

    // Drive: hydrostatic, so each belt chases its commanded speed but the engine can only supply
    // so much power. When traction times belt speed would exceed it, both belts slow in
    // proportion until it fits; the drive bogs down but never runs backwards on its own.
    let base = input.throttle >= 0 ? input.throttle * spec.maxForwardMs : input.throttle * spec.maxReverseMs;
    // Cable-end interlock: travel away from the anchor slows to a stop as the cable runs out.
    if (this.winchAnchor && base * this.winchAwayDot > 0) {
      base *= clamp01((this.winchRemainingM - 1) / CABLE_END_RAMP_M);
    }
    const diff = input.steer * Math.max(1.3, Math.abs(base) * 0.55);
    const available = Math.max(
      0.1,
      DRIVE_EFFICIENCY * spec.enginePowerW -
        (this.tillerPos > 0.5 ? spec.tillerPowerW : 0) -
        this.winchPowerW,
    );
    let demand = 0;
    for (let side = 0; side < 2; side++) {
      // The outer belt cannot exceed top speed, so a turn at speed slows the inner belt instead.
      const target = Math.max(
        -spec.maxForwardMs,
        Math.min(spec.maxForwardMs, base + (side === 0 ? -diff : diff)),
      );
      this.beltTarget[side] = target;
      demand += Math.abs(this.sideForce[side]! * target);
    }
    const scale = demand > available ? available / demand : 1;
    const step = BELT_ACCEL_MS2 * h;
    for (let side = 0; side < 2; side++) {
      const u = this.trackSpeed[side]!;
      const target = this.beltTarget[side]! * scale;
      this.trackSpeed[side] = u + Math.max(-step, Math.min(step, target - u));
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
      let traction = 0;
      let touching = 0;
      for (let c = 0; c < spec.contactZ.length; c++) {
        b.toWorld(lx, -spec.trackBottomM, spec.contactZ[c]!);
        const x = b.px + b.ox;
        const y = b.py + b.oy;
        const z = b.pz + b.oz;
        // The bogie hangs SPRING_SAG_M below this point when unloaded, so at rest the track
        // underside sits exactly on the snow.
        const support = snow.supportAt(x, z, rhoC) + SPRING_SAG_M;
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
        // Grousers bite into the snow the track has just pressed, so loose powder still gives some
        // grip; what it costs is the sinkage resistance below.
        const bitten = Math.max(rho, rhoC * 0.8);
        const mu =
          top < 0.02 ? (snow.base[i]! > 0.02 ? 0.8 : 0.6) : 0.42 + 0.4 * clamp01((bitten - 120) / 280);
        const cellSink = rho < rhoC ? top * (1 - rho / rhoC) : 0;

        const vLong = pvx * tx + pvy * ty + pvz * tz;
        const vLat = pvx * lxw + pvy * lyw + pvz * lzw;
        const grip = mu * spec.gripFactor;
        let fLong = grip * normalForce * Math.tanh((u - vLong) / 0.04);
        let fLat = -0.9 * grip * normalForce * Math.tanh(vLat / 0.15);
        const limit = grip * normalForce;
        const mag = Math.hypot(fLong, fLat);
        if (mag > limit) {
          fLong *= limit / mag;
          fLat *= limit / mag;
        }
        power += Math.abs(fLong * u) / DRIVE_EFFICIENCY;
        traction += fLong;
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
        touching++;
        gripSum += grip;
        if (cellSink > sink) sink = cellSink;
      }
      this.sideForce[side] = traction;
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

    power += this.pullWinch();
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

  /**
   * Every value that carries from one step to the next, apart from the rigid body, implement
   * positions and winch anchor (saved separately). Restoring it makes a loaded world continue
   * exactly as the saved one would have.
   */
  captureDynamics(): number[] {
    return [
      this.trackSpeed[0]!,
      this.trackSpeed[1]!,
      this.sideForce[0]!,
      this.sideForce[1]!,
      this.beltTarget[0]!,
      this.beltTarget[1]!,
      this.engineLoad,
      this.cutRateKgS,
      this.groundedContacts,
      this.sinkM,
      this.grip,
      this.groomQuality,
      this.winchCableOutM,
      this.winchForceN,
      this.winchPowerW,
      this.winchRemainingM === Infinity ? -1 : this.winchRemainingM,
      this.winchAwayDot,
    ];
  }

  restoreDynamics(values: readonly number[]): void {
    if (values.length !== 17) throw new Error('saved machine state has the wrong length');
    const v = values as number[];
    this.trackSpeed[0] = v[0]!;
    this.trackSpeed[1] = v[1]!;
    this.sideForce[0] = v[2]!;
    this.sideForce[1] = v[3]!;
    this.beltTarget[0] = v[4]!;
    this.beltTarget[1] = v[5]!;
    this.engineLoad = v[6]!;
    this.cutRateKgS = v[7]!;
    this.groundedContacts = v[8]!;
    this.sinkM = v[9]!;
    this.grip = v[10]!;
    this.groomQuality = v[11]!;
    this.winchCableOutM = v[12]!;
    this.winchForceN = v[13]!;
    this.winchPowerW = v[14]!;
    this.winchRemainingM = v[15]! < 0 ? Infinity : v[15]!;
    this.winchAwayDot = v[16]!;
  }

  /** Hooks the winch cable to an anchor. */
  hookWinch(anchor: WinchPoint): void {
    this.winchAnchor = anchor;
    this.winchCableOutM = Math.hypot(
      anchor.x - this.body.px,
      anchor.y - this.body.py,
      anchor.z - this.body.pz,
    );
  }

  unhookWinch(): void {
    this.winchAnchor = null;
    this.winchForceN = 0;
    this.winchPowerW = 0;
    this.winchRemainingM = Infinity;
  }

  /** World position of the winch drum, where the cable pulls (result in body.ox, oy, oz). */
  winchFairlead(): void {
    const scale = this.spec.bodyLengthM / 8;
    const b = this.body;
    b.toWorld(0, WINCH_DRUM.y * scale, WINCH_DRUM.z * scale);
    b.ox += b.px;
    b.oy += b.py;
    b.oz += b.pz;
  }

  /**
   * Constant-tension winch: the cable pays out or reels in to hold the set pull toward the
   * anchor. Reeling in takes engine power; at full length the cable stops the machine.
   * Returns the engine power drawn, W.
   */
  private pullWinch(): number {
    const anchor = this.winchAnchor;
    const spec = this.spec;
    if (!anchor || spec.winchPullN <= 0) {
      this.winchForceN = 0;
      this.winchPowerW = 0;
      return 0;
    }
    const b = this.body;
    this.winchFairlead();
    const x = b.ox;
    const y = b.oy;
    const z = b.oz;
    let dx = anchor.x - x;
    let dy = anchor.y - y;
    let dz = anchor.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) {
      this.winchForceN = 0;
      return 0;
    }
    dx /= d;
    dy /= d;
    dz /= d;
    b.pointVelocity(x, y, z);
    // Speed toward the anchor: positive while the winch reels in.
    const closing = b.ox * dx + b.oy * dy + b.oz * dz;
    let tension = this.winchSetting * spec.winchPullN;
    if (d > spec.winchCableM) {
      const damping = 0.6 * Math.sqrt(CABLE_STOP_K * spec.massKg);
      const stop = CABLE_STOP_K * (d - spec.winchCableM) + damping * Math.max(0, -closing);
      tension = Math.min(CABLE_STOP_LIMIT * spec.winchPullN, Math.max(tension, stop));
    }
    this.winchCableOutM = Math.min(d, spec.winchCableM);
    this.winchRemainingM = spec.winchCableM - d;
    b.toWorld(0, 0, 1);
    // Positive when driving forward takes the machine away from the anchor.
    this.winchAwayDot = -(b.ox * dx + b.oy * dy + b.oz * dz);
    this.winchForceN = tension;
    b.applyForceAt(tension * dx, tension * dy, tension * dz, x, y, z);
    this.winchPowerW = Math.max(0, tension * closing) / DRIVE_EFFICIENCY;
    return this.winchPowerW;
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
          snow.relaxAround(x, z, 3);
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
      b.toWorld(0, 0, spec.bladeZ + 0.4);
      snow.relaxAround(b.px + b.ox, b.pz + b.oz, spec.bladeHalfWidthM + 3);
      this.bladeLoadKg = 0;
    }
    this.cutRateKgS += (cutKg / dt - this.cutRateKgS) * Math.min(1, dt * 6);

    // Tiller: mill and re-lay the surface, leaving corduroy. Quality falls off when driven too fast.
    this.groomQuality = 0;
    if (this.tillerWorking && vf > 0.2 && this.groundedContacts > 0) {
      const quality = clamp01(1 - (vf - spec.cleanSpeedMs) / 2.5);
      this.groomQuality = quality;
      const q = Math.max(1, Math.round(255 * quality));
      const half = spec.tillerHalfWidthM;
      b.toWorld(0, -spec.trackBottomM, spec.tillerZ);
      const cx = b.px + b.ox;
      const cz = b.pz + b.oz;
      // Lateral axis on the ground, to test which cells the drum actually covers.
      b.toWorld(1, 0, 0);
      const al = 1 / Math.max(1e-6, Math.hypot(b.ox, b.oz));
      const ax = b.ox * al;
      const az = b.oz * al;
      const cell = snow.grid.cellM;
      const samples = Math.round((half * 2) / 0.2);
      for (let k = 0; k <= samples; k++) {
        const lx = (k / samples - 0.5) * 2 * half;
        const x = cx + ax * lx;
        const z = cz + az * lx;
        if (!snow.grid.contains(x, z)) continue;
        snow.markSurface(x, z, q, 0, dirX, dirZ);
        // A cell counts as tilled only if its centre lies under the drum, so groomed area
        // matches the tiller's real width instead of rounding up to whole cells.
        const i = snow.grid.nearest(x, z);
        const ix = i % snow.grid.n;
        const iz = (i - ix) / snow.grid.n;
        if (Math.abs((ix * cell - cx) * ax + (iz * cell - cz) * az) <= half) {
          // Thin cover limits the finish however well the machine is driven.
          const cover = snow.coverQuality(i);
          if (cover > 0) snow.till(i, Math.max(1, Math.round(q * cover)));
        }
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
