import {
  abs,
  clamp,
  color,
  dot,
  float,
  mix,
  mx_noise_float,
  normalView,
  normalWorld,
  oneMinus,
  oscSquare,
  positionLocal,
  positionViewDirection,
  pow,
  reflectVector,
  smoothstep,
  time,
  uniform,
} from 'three/tsl';
import { DoubleSide, MeshStandardNodeMaterial, type Side } from 'three/webgpu';

/**
 * Materials shared by every machine. Painted metal carries grime thrown up by the tracks and snow
 * lying on its upward faces, so no two panels read as the same flat colour.
 */

/** Daylight for faked sky reflections in glass: 1 at noon, near 0 at night. Set by the game. */
export const machineDaylight = uniform(1);

/** Grime and snow-dusting factors from the part's own coordinates. */
function weathering(scale = 1) {
  const p = positionLocal.mul(scale);
  const broad = mx_noise_float(p.mul(1.7)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(11)).mul(0.5).add(0.5);
  // Track spray is heaviest low down and streaky.
  const low = smoothstep(0.75, -0.55, positionLocal.y);
  const grime = clamp(low.mul(0.75).add(broad.sub(0.55).mul(0.7)).mul(fine.mul(0.7).add(0.55)), 0, 1);
  // Snow settles on faces that point up, in drifts.
  const up = smoothstep(0.72, 0.96, normalWorld.y);
  const drift = up.mul(smoothstep(0.5, 0.72, broad.mul(0.65).add(fine.mul(0.35))));
  return { grime, drift, fine };
}

/** Machine paint: a clear-coated colour with wear. */
export function paint(hex: number, side: Side = DoubleSide): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ side });
  const { grime, drift, fine } = weathering();
  const base = color(hex).mul(fine.mul(0.08).add(0.96));
  m.colorNode = mix(mix(base, color(0x2b2721), grime.mul(0.5)), color(0xf1f5f9), drift.mul(0.92));
  m.roughnessNode = mix(mix(float(0.32), float(0.78), grime), float(0.9), drift);
  m.metalnessNode = float(0.1);
  return m;
}

/** Black-painted frame steel, with the same wear but no visible colour. */
export const frame = (() => {
  const m = new MeshStandardNodeMaterial({ side: DoubleSide });
  const { grime, drift } = weathering();
  m.colorNode = mix(mix(color(0x1d2024), color(0x34302a), grime.mul(0.6)), color(0xe9eef3), drift.mul(0.75));
  m.roughnessNode = mix(float(0.55), float(0.85), grime);
  m.metalnessNode = float(0.25);
  return m;
})();

export const steel = new MeshStandardNodeMaterial({ color: 0x9aa1a8, roughness: 0.34, metalness: 0.9 });
export const chrome = new MeshStandardNodeMaterial({ color: 0xd6dbe0, roughness: 0.12, metalness: 1 });
export const aluminium = new MeshStandardNodeMaterial({ color: 0xb9bfc4, roughness: 0.42, metalness: 0.85 });
export const rubber = new MeshStandardNodeMaterial({
  color: 0x121314,
  roughness: 0.93,
  metalness: 0,
  side: DoubleSide,
});
export const hose = new MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.05 });
export const plastic = new MeshStandardNodeMaterial({ color: 0x2b2f35, roughness: 0.62, metalness: 0.05 });
export const fabric = new MeshStandardNodeMaterial({ color: 0x33373e, roughness: 0.95, metalness: 0 });
export const tread = new MeshStandardNodeMaterial({ color: 0x5d636a, roughness: 0.5, metalness: 0.7 });

/** Cab glazing: tinted, more reflective at grazing angles, reflecting sky above and snow below. */
export const glass = (() => {
  const m = new MeshStandardNodeMaterial({ transparent: true, side: DoubleSide, depthWrite: false });
  const facing = abs(dot(normalView, positionViewDirection));
  const fresnel = pow(oneMinus(facing), 3).mul(0.8).add(0.1);
  const world = mix(color(0xdde6ef), color(0x8fb2dc), smoothstep(-0.12, 0.3, reflectVector.y));
  m.colorNode = color(0x0b141b);
  m.emissiveNode = world.mul(fresnel).mul(machineDaylight.mul(0.85).add(0.04));
  m.opacityNode = fresnel.mul(0.55).add(0.3);
  m.roughnessNode = float(0.05);
  m.metalnessNode = float(0);
  return m;
})();

/** Lamp lenses and coloured lights for one machine, switched together. */
export class MachineLamps {
  /** 0 off, 1 full: headlights and work lights. */
  readonly level = uniform(0);
  readonly lens: MeshStandardNodeMaterial;
  readonly beacon: MeshStandardNodeMaterial;
  readonly tail: MeshStandardNodeMaterial;
  readonly indicator: MeshStandardNodeMaterial;

  constructor() {
    this.lens = new MeshStandardNodeMaterial({ color: 0xe9eef2, roughness: 0.12, metalness: 0.1 });
    this.lens.emissiveNode = color(0xfff0d2).mul(this.level.mul(4).add(0.06));
    this.beacon = new MeshStandardNodeMaterial({ color: 0xff8a1a, roughness: 0.25, metalness: 0 });
    // The beacon flashes whenever the machine is working with its lights on.
    this.beacon.emissiveNode = color(0xff7a10).mul(
      this.level
        .mul(oscSquare(time.mul(1.4)).mul(0.5).add(0.5))
        .mul(3)
        .add(0.15),
    );
    this.tail = new MeshStandardNodeMaterial({ color: 0x7a0c08, roughness: 0.25, metalness: 0 });
    this.tail.emissiveNode = color(0xff1a0a).mul(this.level.mul(1.6).add(0.12));
    this.indicator = new MeshStandardNodeMaterial({ color: 0x9a5a05, roughness: 0.25, metalness: 0 });
    this.indicator.emissiveNode = color(0xffa31a).mul(this.level.mul(0.5).add(0.1));
  }

  dispose(): void {
    this.lens.dispose();
    this.beacon.dispose();
    this.tail.dispose();
    this.indicator.dispose();
  }
}
