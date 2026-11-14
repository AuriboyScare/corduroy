import {
  color,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { paint } from '../machines/materials';

/**
 * Materials for lifts and resort buildings. Outdoor surfaces carry weathering from their world
 * position, so towers and stations along a line do not all look freshly painted.
 */

/** 0 by day, 1 at night: station lamps, lit windows and cabin lights. Set by the game. */
export const resortLights = uniform(0);

function weathered(
  hex: number,
  roughness: number,
  metalness: number,
  streaks = 0.25,
): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ side: DoubleSide });
  const p = positionWorld;
  const broad = mx_noise_float(p.mul(0.35)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(4.1)).mul(0.5).add(0.5);
  // Rain and melt streaks run down vertical faces; snow lies on the upward ones.
  const streak = mx_noise_float(p.mul(vec3(6, 0.4, 6)))
    .mul(0.5)
    .add(0.5);
  const up = smoothstep(0.75, 0.95, normalWorld.y);
  const base = color(hex).mul(fine.mul(0.1).add(0.95)).mul(broad.mul(0.12).add(0.94));
  const dirty = mix(base, base.mul(0.72), streak.mul(streaks).mul(float(1).sub(up)));
  m.colorNode = mix(dirty, color(0xf1f5f9), up.mul(smoothstep(0.35, 0.6, broad)).mul(0.9));
  m.roughnessNode = mix(float(roughness), float(0.9), up.mul(0.6));
  m.metalnessNode = float(metalness);
  return m;
}

export const galvanised = weathered(0x9aa3aa, 0.42, 0.75, 0.3);
export const darkSteel = weathered(0x2a2f35, 0.5, 0.55, 0.15);
/** The same finishes for small fittings (sheaves, ladders, railings), kept out of the shadow map. */
export const galvanisedFine = weathered(0x9aa3aa, 0.42, 0.75, 0.3);
export const darkSteelFine = weathered(0x2a2f35, 0.5, 0.55, 0.15);
export const concrete = weathered(0x9a978f, 0.92, 0, 0.4);
export const cladding = weathered(0x6b4a33, 0.8, 0, 0.35);
export const roofMetal = weathered(0x2f3a44, 0.5, 0.55, 0.2);
export const liftPaint = paint(0x1f6a52);
export const signBack = weathered(0x1d2a22, 0.6, 0.1, 0.1);
export const timber = weathered(0x7a5634, 0.85, 0, 0.3);

export const rope = new MeshStandardNodeMaterial({ color: 0x34373b, roughness: 0.45, metalness: 0.75 });
export const rubberLiner = new MeshStandardNodeMaterial({ color: 0x141517, roughness: 0.85, metalness: 0 });
export const safetyYellow = new MeshStandardNodeMaterial({ color: 0xf2c21b, roughness: 0.5, metalness: 0.1 });
export const fenceBlue = new MeshStandardNodeMaterial({ color: 0x1d5fb8, roughness: 0.6 });
export const mat = new MeshStandardNodeMaterial({ color: 0x1b1d20, roughness: 0.95 });

/** Lamp heads: dim glass by day, bright at night. */
export const lampLens = (() => {
  const m = new MeshStandardNodeMaterial({ color: 0xdfe6ec, roughness: 0.2 });
  m.emissiveNode = color(0xffe2b0).mul(resortLights.mul(5).add(0.03));
  return m;
})();

/** Windows of occupied buildings: reflective glass by day, warm light at night, unevenly. */
export const litWindow = (() => {
  const m = new MeshStandardNodeMaterial({ color: 0x1a2530, roughness: 0.08, metalness: 0.2 });
  const patch = mx_noise_float(positionWorld.mul(0.6)).mul(0.5).add(0.5);
  m.emissiveNode = mix(color(0x0d1a26), color(0xffb35c).mul(patch.mul(0.6).add(0.45)), resortLights);
  return m;
})();

/** Glazing of large halls: dark glass that lets the lit interior show, with a soft glow. */
export const hallGlass = (() => {
  const m = new MeshStandardNodeMaterial({
    color: 0x0f1922,
    roughness: 0.05,
    metalness: 0.3,
    transparent: true,
  });
  m.opacityNode = float(0.6);
  m.emissiveNode = mix(color(0x0a141d), color(0xffd08a).mul(0.35), resortLights);
  return m;
})();

/** Cabin interior light: on at night, so gondolas read as lit boxes on the line. */
export const cabinGlass = (() => {
  const m = new MeshStandardNodeMaterial({
    color: 0x14202a,
    roughness: 0.06,
    metalness: 0.1,
    transparent: true,
  });
  m.opacityNode = float(0.55);
  m.emissiveNode = mix(color(0x0b141c), color(0xfff0d0).mul(0.45), resortLights);
  return m;
})();

export const fabricBlue = new MeshStandardNodeMaterial({ color: 0x1f3c66, roughness: 0.85 });
export const cabinRed = paint(0xc8231a);
export const tramWhite = paint(0xe7eaed);
export const tramBlue = paint(0x1f4e8c);
