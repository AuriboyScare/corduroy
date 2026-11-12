import type { Snowpack } from './snow/snowpack';
import { TREE_STRIDE, type Mountain } from './terrain/mountain';
import { Snowcat, type ObstacleQuery, type SnowcatInput } from './vehicles/snowcat';

const BUCKET_M = 16;

/** Tree trunks bucketed on a coarse grid for collision queries. */
class TreeIndex implements ObstacleQuery {
  private readonly side: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(private readonly mountain: Mountain) {
    this.side = Math.ceil(mountain.grid.sizeM / BUCKET_M);
    const counts = new Int32Array(this.side * this.side + 1);
    const { trees, treeCount } = mountain;
    for (let t = 0; t < treeCount; t++)
      counts[this.bucket(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 1]!) + 1]!++;
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
    this.start = counts;
    this.items = new Int32Array(treeCount);
    const cursor = counts.slice(0, -1);
    for (let t = 0; t < treeCount; t++) {
      const bucket = this.bucket(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 1]!);
      this.items[cursor[bucket]!++] = t;
    }
  }

  private bucket(x: number, z: number): number {
    const bx = Math.max(0, Math.min(this.side - 1, Math.floor(x / BUCKET_M)));
    const bz = Math.max(0, Math.min(this.side - 1, Math.floor(z / BUCKET_M)));
    return bx + bz * this.side;
  }

  forEachNear(
    x: number,
    z: number,
    radius: number,
    visit: (x: number, z: number, radius: number) => void,
  ): void {
    const trees = this.mountain.trees;
    const x0 = Math.max(0, Math.floor((x - radius) / BUCKET_M));
    const x1 = Math.min(this.side - 1, Math.floor((x + radius) / BUCKET_M));
    const z0 = Math.max(0, Math.floor((z - radius) / BUCKET_M));
    const z1 = Math.min(this.side - 1, Math.floor((z + radius) / BUCKET_M));
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        const bucket = bx + bz * this.side;
        for (let k = this.start[bucket]!; k < this.start[bucket + 1]!; k++) {
          const o = this.items[k]! * TREE_STRIDE;
          visit(trees[o]!, trees[o + 1]!, trunkRadiusM(trees[o + 2]!));
        }
      }
    }
  }
}

/** Trunk radius at hull height for a tree of the given height. */
export function trunkRadiusM(heightM: number): number {
  return 0.16 + 0.013 * heightM;
}

/** Everything that is simulated: the mountain, its snow and the machines on it. */
export class World {
  readonly mountain: Mountain;
  readonly snow: Snowpack;
  readonly cat: Snowcat;
  /** Fixed step length, s. */
  readonly stepSeconds = 1 / 60;
  stepCount = 0;
  private readonly trees: TreeIndex | null;

  constructor(mountain: Mountain, snow: Snowpack) {
    this.mountain = mountain;
    this.snow = snow;
    this.trees = mountain.treeCount > 0 ? new TreeIndex(mountain) : null;
    this.cat = new Snowcat();
    this.cat.place(mountain.depot.x, mountain.depot.z, mountain.depot.heading, snow);
  }

  step(input: SnowcatInput): void {
    this.cat.step(this.stepSeconds, input, this.snow, this.trees);
    this.stepCount++;
  }

  /** Share of the marked piste that is currently groomed, 0..1. */
  get pisteGroomedFraction(): number {
    return this.mountain.pisteCellCount > 0 ? this.snow.groomedPisteCells / this.mountain.pisteCellCount : 0;
  }
}
