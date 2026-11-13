import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalWorld,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshStandardNodeMaterial, type Texture, type Vector2, type Vector3 } from 'three/webgpu';
import { WINDOW_M } from './surfaceDetail';

export interface SnowMaterialInputs {
  fine: Texture;
  coarse: Texture;
  /** World corner of the fine detail window. */
  windowOrigin: Vector2;
  mapSizeM: number;
  /** Unit vector toward the sun. */
  sunDirection: Vector3;
}

/** Corduroy ridge spacing, m. */
const RIDGE_M = 0.05;
/** Track cleat spacing, m. */
const CLEAT_M = 0.16;

/**
 * Snow surface: untouched powder, track marks and tiller corduroy are told apart by surface
 * relief and tone, driven by the simulation's surface detail textures. Bare rock shows where
 * the cover is thin.
 */
export function createSnowMaterial(inputs: SnowMaterialInputs): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const origin = uniform(inputs.windowOrigin);
  const sun = uniform(inputs.sunDirection);

  const p = positionWorld;
  const xz = p.xz;
  const toCamera = cameraPosition.sub(p);
  const distance = length(toCamera);
  const view = toCamera.div(distance);

  // Surface detail: fine window near the focus, coarse summary elsewhere.
  const uvFine = xz.sub(origin).div(WINDOW_M);
  const edge = min(min(uvFine.x, uvFine.y), min(float(1).sub(uvFine.x), float(1).sub(uvFine.y)));
  const inWindow = smoothstep(0.0, 0.06, edge);
  const detail = mix(texture(inputs.coarse, xz.div(inputs.mapSizeM)), texture(inputs.fine, uvFine), inWindow);
  const groom = detail.r;
  const track = detail.a.mul(float(1).sub(groom));
  const rawDir = detail.gb.mul(2).sub(1);
  const dir = rawDir.div(max(length(rawDir), 0.05));
  const across = vec2(dir.y, dir.x.negate());

  // Corduroy: ridges run along the direction of travel. Fade before they alias.
  const ridgeCoord = dot(xz, across).div(RIDGE_M);
  const ridgeVisible = float(1).sub(smoothstep(0.18, 0.5, fwidth(ridgeCoord)));
  const ridgePhase = ridgeCoord.mul(Math.PI * 2);
  const ridgeSlope = cos(ridgePhase).mul(groom).mul(ridgeVisible).mul(0.95);
  const ridgeHeight = sin(ridgePhase).mul(0.5).add(0.5);

  // Track marks: cleat bars across the direction of travel.
  const cleatCoord = dot(xz, dir).div(CLEAT_M);
  const cleatVisible = float(1).sub(smoothstep(0.2, 0.55, fwidth(cleatCoord)));
  const cleatPhase = fract(cleatCoord);
  const cleatBar = smoothstep(0.0, 0.12, cleatPhase).sub(smoothstep(0.3, 0.42, cleatPhase));
  const cleatRise = smoothstep(0.0, 0.03, cleatPhase).mul(smoothstep(0.12, 0.09, cleatPhase));
  const cleatFall = smoothstep(0.3, 0.33, cleatPhase).mul(smoothstep(0.42, 0.39, cleatPhase));
  const cleatSlope = cleatRise.sub(cleatFall).mul(track).mul(cleatVisible).mul(0.8);

  // Untouched snow: fine wind ripple near the camera, and broader wind-worked drifts that stay
  // visible across the slope. Machine-worked snow has neither, so it reads as a smooth ribbon.
  const near = float(1).sub(smoothstep(30, 90, distance));
  const mid = float(1).sub(smoothstep(250, 700, distance));
  const loose = float(1).sub(max(groom, track));
  const rippleX = mx_noise_float(vec3(xz.mul(0.9), 1.7))
    .mul(0.5)
    .add(mx_noise_float(vec3(xz.mul(5.5), 4.1)).mul(0.22));
  const rippleZ = mx_noise_float(vec3(xz.mul(0.9), 9.3))
    .mul(0.5)
    .add(mx_noise_float(vec3(xz.mul(5.5), 7.9)).mul(0.22));
  const driftCoord = vec2(xz.x.mul(0.33), xz.y.mul(0.13));
  const drift = vec2(mx_noise_float(vec3(driftCoord, 3.3)), mx_noise_float(vec3(driftCoord, 8.8)))
    .mul(0.34)
    .mul(mid);
  const ripple = vec2(rippleX, rippleZ).mul(near).mul(0.32).add(drift).mul(loose);

  const offset = across.mul(ridgeSlope).add(dir.mul(cleatSlope)).add(ripple);
  const normal = normalize(normalWorld.add(vec3(offset.x, 0, offset.y)));
  material.normalNode = transformNormalToView(normal);

  // Tone. Passes groomed toward and away from the viewer reflect differently, which is what makes
  // the lanes of a groomed piste visible from far away.
  const viewFlat = normalize(vec2(view.x, view.z).add(vec2(1e-4, 0)));
  const lane = dot(dir, viewFlat).mul(groom).mul(0.075);
  const powderColor = vec3(0.9, 0.93, 0.97);
  const groomedColor = vec3(0.8, 0.845, 0.915);
  const trackColor = vec3(0.7, 0.76, 0.87);
  const grooves = ridgeHeight.oneMinus().mul(ridgeVisible).mul(groom).mul(0.1);
  let snowColor = mix(powderColor, groomedColor, groom);
  snowColor = mix(snowColor, trackColor, track.mul(mix(0.7, 1.0, cleatBar.mul(cleatVisible))));
  snowColor = snowColor.mul(float(1).add(lane).sub(grooves));

  // Bare ground where cover is thin, broken up so the snow line is not a clean contour.
  const depth = attribute('snowDepth', 'float');
  const breakup = mx_noise_float(vec3(xz.mul(0.07), 2.2))
    .mul(0.22)
    .add(mx_noise_float(vec3(xz.mul(0.6), 6.4)).mul(0.1));
  const bare = float(1).sub(smoothstep(0.04, 0.42, depth.add(breakup)));
  // Rock: dark, with tilted strata bands and mottling.
  const strata = sin(p.y.mul(0.55).add(mx_noise_float(vec3(xz.mul(0.04), 1.1)).mul(7)))
    .mul(0.5)
    .add(0.5);
  const mottle = mx_noise_float(vec3(xz.mul(0.4), p.y.mul(0.4)))
    .mul(0.5)
    .add(0.5);
  const rockColor = mix(
    vec3(0.085, 0.082, 0.08),
    vec3(0.2, 0.185, 0.17),
    strata.mul(0.3).add(mottle.mul(0.7)),
  );
  material.colorNode = mix(snowColor, rockColor, bare);

  // Ice crystals catch the sun: sparse glints that change as the camera moves.
  const cell = floor(xz.mul(75));
  const flake = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  const facing = fract(flake.mul(17.0).add(dot(view, vec3(3.1, 5.3, 7.7))));
  const sunward = clamp(dot(normal, sun), 0, 1);
  const glint = smoothstep(0.985, 1.0, flake)
    .mul(smoothstep(0.12, 0.0, abs(facing.sub(0.5))))
    .mul(sunward)
    .mul(float(1).sub(smoothstep(8, 45, distance)))
    .mul(float(1).sub(bare))
    .mul(mix(1.0, 0.45, groom));
  material.emissiveNode = vec3(1.0, 0.98, 0.94).mul(glint).mul(3.0);

  material.roughnessNode = mix(mix(float(0.82), float(0.62), max(groom, track)), float(0.92), bare);
  material.metalnessNode = float(0);
  return material;
}
