import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { Snowpack } from '../sim/snow/snowpack';
import { TREE_STRIDE, type Mountain } from '../sim/terrain/mountain';

const GROUP_M = 128;
const NEAR_RANGE_M = 300;

const NEEDLE = [0.045, 0.1, 0.065] as const;
const NEEDLE_LIT = [0.1, 0.19, 0.11] as const;
const SNOW = [0.86, 0.9, 0.96] as const;
const BARK = [0.16, 0.11, 0.08] as const;

/**
 * Snow-laden spruce of unit height: a trunk and stacked drooping branch tiers. Each tier is
 * green at its ragged outer tips and carries snow toward the trunk, where it would settle.
 */
function createSpruce(tiers: number, segments: number, rings: number): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const push = (x: number, y: number, z: number, c: readonly number[], shade = 1): number => {
    position.push(x, y, z);
    color.push(c[0]! * shade, c[1]! * shade, c[2]! * shade);
    return position.length / 3 - 1;
  };

  // Trunk.
  const trunkBase: number[] = [];
  const trunkTop: number[] = [];
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * Math.PI * 2;
    trunkBase.push(push(Math.cos(a) * 0.022, -0.02, Math.sin(a) * 0.022, BARK));
    trunkTop.push(push(Math.cos(a) * 0.014, 0.42, Math.sin(a) * 0.014, BARK));
  }
  for (let s = 0; s < 6; s++) {
    const t = (s + 1) % 6;
    index.push(trunkBase[s]!, trunkTop[s]!, trunkBase[t]!, trunkBase[t]!, trunkTop[s]!, trunkTop[t]!);
  }

  // Branch tiers, widest at the bottom.
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const yBottom = 0.1 + f * 0.82;
    const tierHeight = (0.9 / tiers) * 1.9;
    const yTop = Math.min(1, yBottom + tierHeight);
    const radius = 0.165 * Math.pow(1 - f, 0.85) + 0.012;
    const ringIds: number[][] = [];
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const ids: number[] = [];
      for (let s = 0; s < segments; s++) {
        const a = ((s + (k % 2) * 0.5) / segments) * Math.PI * 2;
        // Ragged rim: alternate boughs reach further and hang lower.
        const reach = r === 0 ? (s % 2 === 0 ? 1.12 : 0.84) : 1;
        const rad = radius * (1 - t) ** 1.15 * reach + 0.006;
        const droop = r === 0 ? (s % 2 === 0 ? -0.022 : 0.004) : 0;
        const y = yBottom + (yTop - yBottom) * t + droop;
        const c = r === 0 ? NEEDLE : t < 0.5 ? NEEDLE_LIT : SNOW;
        ids.push(push(Math.cos(a) * rad, y, Math.sin(a) * rad, c, r === 0 ? 1 : 1 - 0.1 * f));
      }
      ringIds.push(ids);
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < segments; s++) {
        const t = (s + 1) % segments;
        const a = ringIds[r]![s]!;
        const b = ringIds[r]![t]!;
        const c = ringIds[r + 1]![s]!;
        const d = ringIds[r + 1]![t]!;
        index.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

interface Stand {
  x: number;
  z: number;
  near: InstancedMesh;
  far: InstancedMesh;
}

export interface Forest {
  readonly group: Group;
  /** Swaps detailed and simplified trees by distance. */
  update(camera: Vector3): void;
}

/** Instanced forest, grouped into stands so whole areas cull and change detail together. */
export function createForest(mountain: Mountain, snow: Snowpack): Forest {
  const group = new Group();
  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    side: DoubleSide,
  });
  const detailed = createSpruce(9, 10, 3);
  const simple = createSpruce(4, 6, 2);

  const perSide = Math.ceil(mountain.grid.sizeM / GROUP_M);
  const buckets: number[][] = Array.from({ length: perSide * perSide }, () => []);
  for (let t = 0; t < mountain.treeCount; t++) {
    const bx = Math.min(perSide - 1, Math.floor(mountain.trees[t * TREE_STRIDE]! / GROUP_M));
    const bz = Math.min(perSide - 1, Math.floor(mountain.trees[t * TREE_STRIDE + 1]! / GROUP_M));
    buckets[bx + bz * perSide]!.push(t);
  }

  const stands: Stand[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const place = new Vector3();
  const scale = new Vector3();
  const tint = new Color();
  buckets.forEach((ids, bucket) => {
    if (ids.length === 0) return;
    const near = new InstancedMesh(detailed, material, ids.length);
    const far = new InstancedMesh(simple, material, ids.length);
    ids.forEach((t, k) => {
      const o = t * TREE_STRIDE;
      const x = mountain.trees[o]!;
      const z = mountain.trees[o + 1]!;
      const h = mountain.trees[o + 2]!;
      const seed = mountain.trees[o + 3]!;
      place.set(x, snow.surfaceAt(x, z) - 0.25, z);
      quaternion.setFromAxisAngle(up, seed * Math.PI * 2);
      const girth = h * (0.85 + 0.4 * ((seed * 7.3) % 1));
      scale.set(girth, h, girth);
      matrix.compose(place, quaternion, scale);
      near.setMatrixAt(k, matrix);
      far.setMatrixAt(k, matrix);
      const v = 0.82 + 0.3 * ((seed * 13.7) % 1);
      tint.setRGB(v * (0.96 + 0.08 * ((seed * 3.1) % 1)), v, v * (0.94 + 0.1 * ((seed * 5.9) % 1)));
      near.setColorAt(k, tint);
      far.setColorAt(k, tint);
    });
    for (const mesh of [near, far]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    near.castShadow = true;
    near.visible = false;
    stands.push({
      x: ((bucket % perSide) + 0.5) * GROUP_M,
      z: (Math.floor(bucket / perSide) + 0.5) * GROUP_M,
      near,
      far,
    });
  });

  return {
    group,
    update(camera) {
      for (const stand of stands) {
        const close = Math.hypot(stand.x - camera.x, stand.z - camera.z) < NEAR_RANGE_M;
        stand.near.visible = close;
        stand.far.visible = !close;
      }
    },
  };
}
