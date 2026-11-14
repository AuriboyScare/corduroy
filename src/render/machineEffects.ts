import type { Snowpack } from '../sim/snow/snowpack';
import type { Snowcat } from '../sim/vehicles/snowcat';
import { POWDER, SMOKE, SNOW, type Particles } from './particles';

/** Rate accumulators so emission is smooth at any frame rate. */
interface Emitters {
  tiller: number;
  tracks: number;
  blade: number;
  exhaust: number;
  lastLoad: number;
}

/** Height and position of the exhaust outlet, Kestrel 420 body frame. */
const EXHAUST = { x: -0.82, y: 1.92, z: -0.14 } as const;

/**
 * Turns what a machine is doing into particles: snow thrown by the tiller, carried round by the
 * tracks, rolled and spilled by the blade, and exhaust smoke.
 */
export class MachineEffects {
  private readonly state = new Map<Snowcat, Emitters>();

  constructor(
    private readonly particles: Particles,
    private readonly snow: Snowpack,
  ) {}

  update(dt: number, cat: Snowcat): void {
    let e = this.state.get(cat);
    if (!e) {
      e = { tiller: 0, tracks: 0, blade: 0, exhaust: 0, lastLoad: 0 };
      this.state.set(cat, e);
    }
    const p = this.particles;
    const b = cat.body;
    const spec = cat.spec;
    const scale = spec.bodyLengthM / 8;
    const speed = cat.forwardSpeed;
    const under = this.snow.grid.nearest(b.px, b.pz);
    const loose = 1 - Math.min(1, Math.max(0, (this.snow.density[under]! - 120) / 300));
    const rnd = Math.random;
    b.toWorld(0, 0, 1);
    const fx = b.ox;
    const fz = b.oz;
    b.toWorld(1, 0, 0);
    const lx = b.ox;
    const lz = b.oz;

    // Tiller: snow thrown up behind the drum and out of its ends.
    if (cat.tillerWorking && Math.abs(speed) > 0.2) {
      e.tiller += dt * (180 + 420 * loose) * Math.min(1.5, Math.abs(speed) / 3);
      while (e.tiller >= 1) {
        e.tiller -= 1;
        const across = (rnd() * 2 - 1) * spec.tillerHalfWidthM;
        b.toWorld(across, -spec.trackBottomM + 0.25, spec.tillerZ - 0.6 * scale);
        const back = 0.6 + rnd() * 1.4;
        const ends =
          Math.abs(across) > spec.tillerHalfWidthM * 0.85 ? Math.sign(across) * (1 + rnd() * 2) : 0;
        p.emit(
          SNOW,
          b.px + b.ox,
          b.py + b.oy,
          b.pz + b.oz,
          speed * fx - fx * back + lx * ends,
          0.8 + rnd() * 1.8,
          speed * fz - fz * back + lz * ends,
          0.35 + rnd() * 0.4,
          0.025 + rnd() * 0.035,
          0.86,
          0.9,
          0.96,
        );
        if (rnd() < 0.12 * loose) {
          p.emit(
            POWDER,
            b.px + b.ox,
            b.py + b.oy + 0.2,
            b.pz + b.oz,
            speed * fx * 0.5,
            0.6,
            speed * fz * 0.5,
            1.4 + rnd(),
            0.35,
            0.93,
            0.95,
            0.99,
          );
        }
      }
    }

    // Tracks: snow carried round on the cleats drops off the top of the rear sprockets.
    const belt = (Math.abs(cat.trackSpeed[0]!) + Math.abs(cat.trackSpeed[1]!)) / 2;
    if (belt > 0.3 && cat.groundedContacts > 0) {
      e.tracks += dt * belt * (30 + 60 * loose);
      while (e.tracks >= 1) {
        e.tracks -= 1;
        const side = rnd() < 0.5 ? 1 : -1;
        const rearZ =
          speed >= 0
            ? spec.contactZ[0]! - 0.55 * scale
            : spec.contactZ[spec.contactZ.length - 1]! + 0.55 * scale;
        b.toWorld(
          side * spec.trackOffsetM + (rnd() - 0.5) * spec.trackWidthM,
          -spec.trackBottomM + 0.85 * scale,
          rearZ,
        );
        const away = speed >= 0 ? -1 : 1;
        p.emit(
          SNOW,
          b.px + b.ox,
          b.py + b.oy,
          b.pz + b.oz,
          speed * fx + fx * away * (0.4 + rnd()) + (rnd() - 0.5) * 0.6,
          0.4 + rnd() * 0.9,
          speed * fz + fz * away * (0.4 + rnd()) + (rnd() - 0.5) * 0.6,
          0.4 + rnd() * 0.35,
          0.025 + rnd() * 0.04,
          0.84,
          0.88,
          0.95,
        );
      }
    }

    // Blade: snow tumbling over the mouldboard while it cuts, spilling off the ends when full.
    const cutting = Math.min(1, cat.cutRate / 300);
    const full = cat.bladeLoadKg / spec.bladeCapacityKg;
    if (speed > 0.1 && (cutting > 0.02 || full > 0.5)) {
      e.blade += dt * (25 * cutting + 90 * Math.max(0, full - 0.7));
      while (e.blade >= 1) {
        e.blade -= 1;
        const spill = full > 0.95 && rnd() < 0.5;
        const across = spill
          ? Math.sign(rnd() - 0.5) * (spec.bladeHalfWidthM + 0.3)
          : (rnd() * 2 - 1) * spec.bladeHalfWidthM * 0.9;
        b.toWorld(
          across,
          -spec.trackBottomM + cat.bladeHeightM + (spill ? 0.3 : 0.6 + rnd() * 0.5),
          spec.bladeZ + 0.5 * scale,
        );
        p.emit(
          SNOW,
          b.px + b.ox,
          b.py + b.oy,
          b.pz + b.oz,
          speed * fx * 1.1 + (spill ? lx * Math.sign(across) * 1.5 : 0),
          0.3 + rnd() * (spill ? 0.5 : 1.4),
          speed * fz * 1.1 + (spill ? lz * Math.sign(across) * 1.5 : 0),
          0.5 + rnd() * 0.4,
          0.03 + rnd() * 0.05,
          0.88,
          0.91,
          0.96,
        );
      }
    }

    // Exhaust: a light haze at idle, dark puffs when the load comes on.
    const load = Math.min(1.2, cat.engineLoad);
    const surge = Math.max(0, load - e.lastLoad) / Math.max(dt, 1e-3);
    e.lastLoad += (load - e.lastLoad) * Math.min(1, dt * 1.5);
    e.exhaust += dt * (5 + 18 * load + Math.min(40, surge * 6));
    while (e.exhaust >= 1) {
      e.exhaust -= 1;
      b.toWorld(EXHAUST.x * scale, EXHAUST.y * scale, EXHAUST.z * scale);
      const soot = Math.min(1, 0.15 + load * 0.35 + Math.min(0.5, surge * 0.2));
      const shade = 0.75 - 0.45 * soot;
      p.emit(
        SMOKE,
        b.px + b.ox,
        b.py + b.oy,
        b.pz + b.oz,
        b.vx + (rnd() - 0.5) * 0.3,
        1.6 + load * 1.8,
        b.vz + (rnd() - 0.5) * 0.3,
        1.6 + rnd() * 1.2,
        0.18 + rnd() * 0.1,
        shade,
        shade,
        shade * 1.02,
      );
    }
  }
}
