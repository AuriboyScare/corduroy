/**
 * Square grid of samples covering the map. Sample (ix, iz) sits at world (ix * cellM, iz * cellM).
 * All per-cell simulation fields share one Grid so indices are interchangeable.
 */
export class Grid {
  /** Samples per side. */
  readonly n: number;
  /** World metres between samples. */
  readonly cellM: number;
  /** World metres per side. */
  readonly sizeM: number;

  constructor(n: number, cellM: number) {
    if (!Number.isInteger(n) || n < 2) throw new RangeError('grid needs at least 2 samples per side');
    this.n = n;
    this.cellM = cellM;
    this.sizeM = (n - 1) * cellM;
  }

  get count(): number {
    return this.n * this.n;
  }

  index(ix: number, iz: number): number {
    return ix + iz * this.n;
  }

  /** Index of the sample nearest to a world position, clamped to the map. */
  nearest(x: number, z: number): number {
    const max = this.n - 1;
    let ix = Math.round(x / this.cellM);
    let iz = Math.round(z / this.cellM);
    ix = ix < 0 ? 0 : ix > max ? max : ix;
    iz = iz < 0 ? 0 : iz > max ? max : iz;
    return ix + iz * this.n;
  }

  contains(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x <= this.sizeM && z <= this.sizeM;
  }

  /** Bilinear sample of a field at a world position, clamped to the map edge. */
  sample(field: Float32Array, x: number, z: number): number {
    const max = this.n - 1;
    let gx = x / this.cellM;
    let gz = z / this.cellM;
    gx = gx < 0 ? 0 : gx > max ? max : gx;
    gz = gz < 0 ? 0 : gz > max ? max : gz;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    if (ix >= max) ix = max - 1;
    if (iz >= max) iz = max - 1;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = ix + iz * this.n;
    const a = field[i]!;
    const b = field[i + 1]!;
    const c = field[i + this.n]!;
    const d = field[i + this.n + 1]!;
    return a + (b - a) * fx + (c - a + (d - b - c + a) * fx) * fz;
  }
}
