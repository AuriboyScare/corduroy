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
import { hash2 } from '../sim/rng';
import type { Snowpack } from '../sim/snow/snowpack';
import { TREE_STRIDE, type Mountain } from '../sim/terrain/mountain';

const GROUP_M = 128;
const NEAR_RANGE_M = 300;

const BARK = [0.16, 0.11, 0.08] as const;
const PINE_BARK = [0.3, 0.19, 0.12] as const;
const SNOW = [0.86, 0.9, 0.96] as const;

/** Shape of one conifer species; trees are built at unit height and scaled per instance. */
interface Species {
  readonly name: string;
  /** Branch tiers from the crown base to the top. */
  readonly tiers: number;
  /** Fraction of the height that is bare trunk below the crown. */
  readonly crownBase: number;
  /** Crown radius at its base, as a fraction of height. */
  readonly radius: number;
  /** >1 broadens the lower crown (fir), <1 rounds it off (pine). */
  readonly taper: number;
  /** How far the bough tips hang below their tier. */
  readonly droop: number;
  /** How uneven the bough lengths are. */
  readonly ragged: number;
  /** Share of each tier's upper surface carrying snow. */
  readonly snow: number;
  readonly needle: readonly [number, number, number];
  readonly needleLit: readonly [number, number, number];
  readonly bark: readonly [number, number, number];
  readonly trunkRadius: number;
}

const SPRUCE: Species = {
  name: 'spruce',
  tiers: 12,
  crownBase: 0.07,
  radius: 0.17,
  taper: 0.92,
  droop: 0.035,
  ragged: 0.32,
  snow: 0.55,
  needle: [0.025, 0.06, 0.045],
  needleLit: [0.05, 0.1, 0.07],
  bark: BARK,
  trunkRadius: 0.022,
};

const FIR: Species = {
  name: 'fir',
  tiers: 10,
  crownBase: 0.1,
  radius: 0.2,
  taper: 1.15,
  droop: 0.015,
  ragged: 0.22,
  snow: 0.75,
  needle: [0.03, 0.065, 0.055],
  needleLit: [0.06, 0.11, 0.085],
  bark: BARK,
  trunkRadius: 0.024,
};

const PINE: Species = {
  name: 'pine',
  tiers: 7,
  crownBase: 0.42,
  radius: 0.2,
  taper: 0.55,
  droop: 0.01,
  ragged: 0.45,
  snow: 0.45,
  needle: [0.035, 0.06, 0.035],
  needleLit: [0.07, 0.105, 0.06],
  bark: PINE_BARK,
  trunkRadius: 0.02,
};

/** Deterministic pseudo-random sequence for tree shapes. */
function shapeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A snow-laden conifer of unit height: a trunk and stacked drooping bough tiers with uneven tips.
 * Each tier is green at its ragged rim and underneath, and carries patchy snow on top.
 */
function createConifer(species: Species, detail: 'near' | 'far', seed: number): BufferGeometry {
  const near = detail === 'near';
  const tiers = near ? species.tiers : Math.max(4, Math.round(species.tiers / 2));
  const segments = near ? 11 : 6;
  const rings = near ? 4 : 2;
  const rnd = shapeRng(seed);
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const push = (x: number, y: number, z: number, c: readonly number[], shade = 1): number => {
    position.push(x, y, z);
    color.push(c[0]! * shade, c[1]! * shade, c[2]! * shade);
    return position.length / 3 - 1;
  };

  // Trunk, visible below the crown (and through gaps in a pine's).
  const trunkTop = 1 - 0.12;
  const trunkBase: number[] = [];
  const trunkUp: number[] = [];
  const sides = near ? 7 : 5;
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    trunkBase.push(
      push(Math.cos(a) * species.trunkRadius, -0.02, Math.sin(a) * species.trunkRadius, species.bark),
    );
    trunkUp.push(
      push(
        Math.cos(a) * species.trunkRadius * 0.35,
        trunkTop,
        Math.sin(a) * species.trunkRadius * 0.35,
        species.bark,
        0.8,
      ),
    );
  }
  for (let s = 0; s < sides; s++) {
    const t = (s + 1) % sides;
    index.push(trunkBase[s]!, trunkUp[s]!, trunkBase[t]!, trunkBase[t]!, trunkUp[s]!, trunkUp[t]!);
  }

  const crownHeight = 1 - species.crownBase;
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    // Tiers are not evenly spaced or level: each sits a little higher or lower and tilts.
    const yBottom = species.crownBase + (f + (rnd() - 0.5) * (0.6 / tiers)) * crownHeight * 0.95;
    const tiltX = (rnd() - 0.5) * 0.12;
    const tiltZ = (rnd() - 0.5) * 0.12;
    const tierHeight = (crownHeight / tiers) * (near ? 1.9 : 2.2);
    const yTop = Math.min(1.02, yBottom + tierHeight);
    // Crown outline: conical for spruce and fir, rounded for pine.
    const outline =
      species.taper >= 1
        ? Math.pow(1 - f, species.taper)
        : Math.sin(Math.PI * Math.min(1, (1 - f) * 0.95 + 0.05)) * 0.8 + 0.2 * (1 - f);
    const radius = species.radius * outline + 0.01;
    const twist = rnd() * Math.PI * 2;
    const reach: number[] = [];
    for (let s = 0; s < segments; s++) reach.push(1 - species.ragged * 0.5 + species.ragged * rnd());
    const ringIds: number[][] = [];
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const ids: number[] = [];
      for (let s = 0; s < segments; s++) {
        const a = twist + (s / segments) * Math.PI * 2;
        // Boughs reach further at the rim; alternate tips hang lower.
        const tip = r === 0 ? reach[s]! : 1 - (1 - reach[s]!) * (1 - t);
        const rad = radius * Math.pow(1 - t, 1.15) * tip + 0.006;
        const hang = r === 0 ? -species.droop * (0.5 + reach[s]!) * (1 - f * 0.6) : 0;
        const bx = Math.cos(a) * rad;
        const bz = Math.sin(a) * rad;
        const y =
          yBottom +
          (yTop - yBottom) * Math.pow(t, 0.85) +
          hang +
          bx * tiltX +
          bz * tiltZ +
          (r === 0 ? (rnd() - 0.5) * 0.012 : 0);
        let c: readonly number[];
        if (r === 0) c = species.needle;
        else if (t < 0.5) c = rnd() < species.snow * 0.5 ? SNOW : species.needleLit;
        else c = rnd() < species.snow + 0.25 ? SNOW : species.needleLit;
        ids.push(push(bx, y, bz, c, r === 0 ? 1 : 1 - 0.12 * f));
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
  const species = [SPRUCE, FIR, PINE];
  const detailed = species.map((sp, k) => createConifer(sp, 'near', 17 + k * 101));
  const simple = species.map((sp, k) => createConifer(sp, 'far', 17 + k * 101));

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
    // Each stand is one species: pine on the lower slopes, spruce and fir mixed higher up.
    const bx = bucket % perSide;
    const bz = Math.floor(bucket / perSide);
    const altitude = snow.surfaceAt((bx + 0.5) * GROUP_M, (bz + 0.5) * GROUP_M);
    const roll = hash2(bx, bz, mountain.seed + 91);
    const kind = altitude < 140 ? (roll < 0.55 ? 2 : 0) : roll < 0.55 ? 0 : 1;
    const near = new InstancedMesh(detailed[kind]!, material, ids.length);
    const far = new InstancedMesh(simple[kind]!, material, ids.length);
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
      // Conifers read nearly black-green against snow; the light bounced off the snow lifts them enough.
      const v = 0.55 + 0.22 * ((seed * 13.7) % 1);
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
