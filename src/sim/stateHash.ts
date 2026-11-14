import type { World } from './world';

/**
 * A 32-bit fingerprint of the world's moving state, for checking that two copies of a world
 * stepped from the same inputs are still identical. It covers every machine's full dynamics, the
 * books, the clock, lifts and snowmaking; the snow follows from those, so a difference shows up
 * here within a step or two of it starting.
 */
export function worldHash(world: World): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (value: number): void => {
    view.setFloat64(0, value);
    for (let k = 0; k < 8; k++) {
      h ^= view.getUint8(k);
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(world.stepCount);
  mix(world.weather.clockS);
  mix(world.career.mode === 'sandbox' ? 0 : world.career.money);
  mix(world.career.earned);
  mix(world.pendingPay);
  mix(world.pendingTickets);
  for (const machine of world.machines) {
    const v = machine.vehicle;
    const b = v.body;
    mix(machine.owned.uid);
    for (const x of [b.px, b.py, b.pz, b.qx, b.qy, b.qz, b.qw, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz]) mix(x);
    mix(v.bladeHeightM);
    mix(v.bladeLoadKg);
    mix(v.tillerPos);
    mix(v.trackTravel[0]!);
    mix(v.trackTravel[1]!);
    for (const x of v.captureDynamics()) mix(x);
  }
  for (const lift of world.lifts)
    if (world.career.lifts.has(lift.line.id)) for (const x of lift.captureState()) mix(x);
  for (const x of world.snowmaking.output) mix(x);
  return h >>> 0;
}
