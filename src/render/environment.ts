import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import { fbm2, smoothstep } from '../sim/rng';
import type { Snowpack } from '../sim/snow/snowpack';
import type { Mountain } from '../sim/terrain/mountain';

const SHADOW_HALF_M = 120;

export interface Environment {
  /** Unit vector toward the sun. */
  readonly sunDirection: Vector3;
  /** Keeps the shadowed area centred on what the player is looking at. */
  update(focus: Vector3): void;
}

/** Sky, sun, fill light, haze and the mountains beyond the playable map. */
export function createEnvironment(
  scene: Scene,
  renderer: WebGPURenderer,
  mountain: Mountain,
  snow: Snowpack,
): Environment {
  // Low morning sun raking across the piste: this is the light that shows corduroy.
  const sunDirection = new Vector3(0.74, 0.34, -0.3).normalize();

  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.shadowMap.enabled = true;

  const sky = new SkyMesh();
  sky.scale.setScalar(45_000);
  sky.turbidity.value = 2.2;
  sky.rayleigh.value = 1.6;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.82;
  sky.sunPosition.value.copy(sunDirection);
  sky.cloudCoverage.value = 0.22;
  sky.cloudDensity.value = 0.3;
  scene.add(sky);

  scene.fog = new FogExp2(0xc6d6e8, 0.000075);

  // Snow bounces a lot of light back up, so the ground term is nearly as bright as the sky.
  scene.add(new HemisphereLight(0xb7d0ff, 0xdfe8f5, 2.3));

  const sun = new DirectionalLight(0xfff0dc, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_HALF_M;
  sun.shadow.camera.right = SHADOW_HALF_M;
  sun.shadow.camera.top = SHADOW_HALF_M;
  sun.shadow.camera.bottom = -SHADOW_HALF_M;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  scene.add(createHorizon(mountain, snow));

  return {
    sunDirection,
    update(focus) {
      // Snap to whole metres so shadow edges do not crawl as the focus moves.
      const x = Math.round(focus.x);
      const y = Math.round(focus.y);
      const z = Math.round(focus.z);
      sun.target.position.set(x, y, z);
      sun.position.set(x + sunDirection.x * 350, y + sunDirection.y * 350, z + sunDirection.z * 350);
    },
  };
}

/** Grid line positions: chunk-aligned inside the map, widening with distance outside it. */
function horizonLines(sizeM: number): number[] {
  const lines: number[] = [];
  const outside: number[] = [];
  let d = 0;
  while (d < 9000) {
    d += d < 1500 ? 100 : d < 4000 ? 220 : 450;
    outside.push(d);
  }
  for (let k = outside.length - 1; k >= 0; k--) lines.push(-outside[k]!);
  for (let v = 0; v <= sizeM; v += 128) lines.push(v);
  for (const o of outside) lines.push(sizeM + o);
  return lines;
}

/**
 * Low-detail terrain surrounding the map out to the horizon. Its inner rim sits exactly on the
 * map boundary; the part under the map is sunk out of sight.
 */
function createHorizon(mountain: Mountain, snow: Snowpack): Mesh {
  const size = mountain.grid.sizeM;
  const lines = horizonLines(size);
  const n = lines.length;
  const position = new Float32Array(n * n * 3);
  const color = new Float32Array(n * n * 3);
  const height = (x: number, z: number): number =>
    x >= 0 && z >= 0 && x <= size && z <= size ? snow.surfaceAt(x, z) : mountain.heightOutside(x, z) + 0.9;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = lines[i]!;
      const z = lines[j]!;
      const inside = x > 0 && z > 0 && x < size && z < size;
      const y = inside ? -400 : height(x, z);
      const o = (i + j * n) * 3;
      position[o] = x;
      position[o + 1] = y;
      position[o + 2] = z;

      const e = 60;
      const slope =
        Math.hypot(height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)) / (2 * e);
      const rock = smoothstep(0.75, 1.15, slope);
      const forest =
        (1 - smoothstep(280, 370, y)) *
        (1 - smoothstep(0.5, 0.8, slope)) *
        smoothstep(-0.1, 0.25, fbm2(x / 260, z / 260, mountain.seed + 30, 3) + 0.25);
      let r = 0.9;
      let g = 0.93;
      let b = 0.97;
      r += (0.27 - r) * rock;
      g += (0.25 - g) * rock;
      b += (0.24 - b) * rock;
      r += (0.22 - r) * forest * 0.8;
      g += (0.29 - g) * forest * 0.8;
      b += (0.27 - b) * forest * 0.8;
      color[o] = r;
      color[o + 1] = g;
      color[o + 2] = b;
    }
  }

  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = i + j * n;
      index[k++] = a;
      index[k++] = a + n;
      index[k++] = a + 1;
      index[k++] = a + 1;
      index[k++] = a + n;
      index[k++] = a + n + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
