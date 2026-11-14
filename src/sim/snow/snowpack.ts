import { clamp01, fbm2, smoothstep } from '../rng';
import type { Grid } from '../terrain/grid';
import type { Mountain } from '../terrain/mountain';

/** Consolidated base layer density, kg/m3. */
export const BASE_DENSITY = 500;
/** Density a tiller leaves behind, kg/m3. */
export const GROOMED_DENSITY = 450;
/** Density loose snow reaches when pushed and dropped by a blade, kg/m3. */
export const PUSHED_DENSITY = 380;

/** Consolidated cover below which a tiller brings up stones and grass, m. */
export const THIN_COVER_M = 0.12;
/** Consolidated cover a tiller needs for a full-quality finish, m. */
export const GOOD_COVER_M = 0.4;

/** Steepest slope loose, pushed snow can hold before it slumps (about 38 degrees). */
export const REPOSE_SLOPE = 0.78;

/** Surface detail is stored in sparse square tiles, allocated where machines have worked. */
export const TILE_M = 32;
export const FINE_CELL_M = 0.25;
export const TILE_CELLS = TILE_M / FINE_CELL_M;
/** Whole-map summary of the surface detail, for distant views. */
export const COARSE_CELL_M = 2;

/** Surface detail channels (4 bytes per cell): corduroy strength, direction x, direction z, track marks. */
export const CH_GROOM = 0;
export const CH_DIR_X = 1;
export const CH_DIR_Z = 2;
export const CH_TRACK = 3;

/**
 * Two-layer snowpack on the simulation grid: a consolidated base of fixed density and a top
 * layer of variable density. Every operation conserves mass (see tests/unit/snowpack.test.ts).
 */
export class Snowpack {
  readonly grid: Grid;
  readonly ground: Float32Array;
  /** Base layer depth, m. */
  readonly base: Float32Array;
  /** Top layer depth, m. */
  readonly top: Float32Array;
  /** Top layer density, kg/m3. */
  readonly density: Float32Array;
  /** Grooming quality per grid cell, 0 = not groomed. */
  readonly groomed: Uint8Array;

  readonly tilesPerSide: number;
  readonly tiles: (Uint8Array | null)[];
  readonly coarseN: number;
  readonly coarse: Uint8Array;

  /** Fine tiles changed since the renderer last cleared this set. */
  readonly dirtyTiles = new Set<number>();
  /**
   * Per 32 m tile: 1 once anything in it differs from the natural snow cover. Saves store only
   * these tiles; everything else is regenerated from the seed.
   */
  readonly changedTiles: Uint8Array;
  coarseDirty = false;
  /** Grid-cell rectangle whose surface height changed; empty when minX > maxX. */
  readonly dirtyRect = { minX: 1, minZ: 1, maxX: 0, maxZ: 0 };

  /** Piste cells currently groomed. */
  groomedPisteCells = 0;
  /** Groomed cells per run section; index is section + 1, slot 0 counts nothing. */
  readonly groomedBySection: Int32Array;
  /**
   * Newly groomed area per section since the last call to takeGroomCredit(), in cells weighted
   * by grooming quality (0..1). This is what grooming pays for.
   */
  readonly groomCredit: Float64Array;
  private readonly sectionOf: Uint16Array;
  private readonly runOf: Uint8Array;
  private readonly cellArea: number;

  constructor(mountain: Mountain) {
    this.grid = mountain.grid;
    this.ground = mountain.ground;
    this.sectionOf = mountain.sectionOf;
    this.runOf = mountain.runOf;
    this.groomedBySection = new Int32Array(mountain.sections.length + 1);
    this.groomCredit = new Float64Array(mountain.sections.length + 1);
    const count = this.grid.count;
    this.base = new Float32Array(count);
    this.top = new Float32Array(count);
    this.density = new Float32Array(count).fill(130);
    this.groomed = new Uint8Array(count);
    this.cellArea = this.grid.cellM * this.grid.cellM;
    this.tilesPerSide = Math.ceil(this.grid.sizeM / TILE_M);
    this.changedTiles = new Uint8Array(this.tilesPerSide * this.tilesPerSide);
    this.tiles = new Array<Uint8Array | null>(this.tilesPerSide * this.tilesPerSide).fill(null);
    this.coarseN = Math.ceil(this.grid.sizeM / COARSE_CELL_M);
    this.coarse = new Uint8Array(this.coarseN * this.coarseN * 4);
    for (let i = 0; i < this.coarse.length; i += 4) {
      this.coarse[i + CH_DIR_X] = 128;
      this.coarse[i + CH_DIR_Z] = 128;
    }
  }

  /** Uniform cover, for tests. */
  fillUniform(baseM: number, topM: number, densityKgM3: number): void {
    this.base.fill(baseM);
    this.top.fill(topM);
    this.density.fill(densityKgM3);
  }

  /** A settled base with a fresh overnight snowfall on top; thin on very steep ground. */
  fillNatural(seed: number): void {
    const { n } = this.grid;
    const g = this.ground;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = ix + iz * n;
        const xl = g[ix > 0 ? i - 1 : i]!;
        const xr = g[ix < n - 1 ? i + 1 : i]!;
        const zu = g[iz > 0 ? i - n : i]!;
        const zd = g[iz < n - 1 ? i + n : i]!;
        const slope = Math.hypot(xr - xl, zd - zu) / (2 * this.grid.cellM);
        const hold = 1 - smoothstep(0.85, 1.35, slope);
        const drift = fbm2(ix / 38, iz / 38, seed + 40, 3);
        if (this.runOf[i]) {
          // Runs keep a packed base, but it is thin low down near the valley: those stretches
          // need snowmaking before they can be groomed well.
          this.base[i] = 0.12 + 0.43 * smoothstep(15, 200, g[i]!);
          this.top[i] = 0.24 + 0.03 * drift;
          this.density[i] = 115;
        } else {
          this.base[i] = (0.45 + 0.5 * clamp01(g[i]! / 470)) * hold;
          this.top[i] = Math.max(0, 0.3 + 0.09 * drift) * hold;
          this.density[i] = 130;
        }
      }
    }
  }

  surface(i: number): number {
    return this.ground[i]! + this.base[i]! + this.top[i]!;
  }

  surfaceAt(x: number, z: number): number {
    const grid = this.grid;
    return grid.sample(this.ground, x, z) + grid.sample(this.base, x, z) + grid.sample(this.top, x, z);
  }

  /**
   * Height a load settles to once the top layer has been pressed to `compactedDensity`.
   * Vehicles ride on this, so the surface under a track does not jump when the cell is compacted.
   */
  supportAt(x: number, z: number, compactedDensity: number): number {
    const grid = this.grid;
    const max = grid.n - 1;
    let gx = x / grid.cellM;
    let gz = z / grid.cellM;
    gx = gx < 0 ? 0 : gx > max ? max : gx;
    gz = gz < 0 ? 0 : gz > max ? max : gz;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    if (ix >= max) ix = max - 1;
    if (iz >= max) iz = max - 1;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = ix + iz * grid.n;
    const a = this.supportCell(i, compactedDensity);
    const b = this.supportCell(i + 1, compactedDensity);
    const c = this.supportCell(i + grid.n, compactedDensity);
    const d = this.supportCell(i + grid.n + 1, compactedDensity);
    return a + (b - a) * fx + (c - a + (d - b - c + a) * fx) * fz;
  }

  private supportCell(i: number, compactedDensity: number): number {
    const rho = this.density[i]!;
    const top = this.top[i]!;
    return this.ground[i]! + this.base[i]! + (rho < compactedDensity ? (top * rho) / compactedDensity : top);
  }

  /** Depth of the cover as if all of it were consolidated base, m: what holds up to grooming. */
  coverDepth(i: number): number {
    return this.base[i]! + (this.top[i]! * this.density[i]!) / BASE_DENSITY;
  }

  /** How well a tiller can work a cell, 0..1: thin cover means stones and a poor finish. */
  coverQuality(i: number): number {
    return clamp01((this.coverDepth(i) - THIN_COVER_M) / (GOOD_COVER_M - THIN_COVER_M));
  }

  /** Total snow mass on the ground, kg. */
  totalMassKg(): number {
    let sum = 0;
    for (let i = 0; i < this.top.length; i++)
      sum += this.base[i]! * BASE_DENSITY + this.top[i]! * this.density[i]!;
    return sum * this.cellArea;
  }

  /** Presses the top layer of a cell toward `targetDensity`. Depth shrinks so mass is unchanged. */
  compact(i: number, targetDensity: number): void {
    const rho = this.density[i]!;
    if (rho >= targetDensity) return;
    this.top[i] = (this.top[i]! * rho) / targetDensity;
    this.density[i] = targetDensity;
    this.touch(i);
  }

  /** Removes snow above height `y` in a cell (top layer first). Returns the mass removed, kg. */
  cutTo(i: number, y: number): number {
    let excess = this.surface(i) - y;
    if (excess <= 0) return 0;
    const fromTop = Math.min(this.top[i]!, excess);
    let mass = fromTop * this.density[i]!;
    this.top[i]! -= fromTop;
    excess -= fromTop;
    if (excess > 0) {
      const fromBase = Math.min(this.base[i]!, excess);
      mass += fromBase * BASE_DENSITY;
      this.base[i]! -= fromBase;
    }
    this.setGroomed(i, 0);
    this.touch(i);
    return mass * this.cellArea;
  }

  /** Adds loose snow to a cell's top layer. */
  deposit(i: number, massKg: number, densityKgM3: number): void {
    if (massKg <= 0) return;
    const perArea = massKg / this.cellArea;
    const top = this.top[i]!;
    const newTop = top + perArea / densityKgM3;
    this.density[i] = (top * this.density[i]! + perArea) / newTop;
    this.top[i] = newTop;
    this.setGroomed(i, 0);
    this.touch(i);
  }

  /** Fills a cell up to height `y` from `availableKg` of loose snow. Returns the mass used, kg. */
  fillTo(i: number, y: number, availableKg: number, densityKgM3: number): number {
    const gap = y - this.surface(i);
    if (gap <= 0 || availableKg <= 0) return 0;
    const used = Math.min(availableKg, gap * densityKgM3 * this.cellArea);
    this.deposit(i, used, densityKgM3);
    return used;
  }

  /**
   * Tiller pass over a cell: the top layer is milled (with a little base when cover is thin) and
   * re-laid at groomed density. `quality` is 1..255.
   */
  till(i: number, quality: number): void {
    if (this.groomed[i]! > 0) {
      if (quality > this.groomed[i]!) this.setGroomed(i, quality);
      return;
    }
    const top = this.top[i]!;
    const fromBase = top < 0.06 ? Math.min(this.base[i]!, 0.04) : 0;
    const depth = top + fromBase;
    if (depth < 0.01) return;
    const mass = top * this.density[i]! + fromBase * BASE_DENSITY;
    const rho = Math.max(GROOMED_DENSITY, mass / depth);
    this.base[i]! -= fromBase;
    this.top[i] = mass / rho;
    this.density[i] = rho;
    this.setGroomed(i, quality);
    this.touch(i);
  }

  /**
   * Lets loose snow slump around (x, z) until no slope between neighbouring cells exceeds the
   * angle of repose, moving top-layer snow downhill. Only the top layer moves, and mass is
   * conserved. Call after piling snow up (blade spills and dumps).
   */
  relaxAround(x: number, z: number, radiusM: number): void {
    const grid = this.grid;
    const n = grid.n;
    const cell = grid.cellM;
    const area = cell * cell;
    const r = Math.ceil(radiusM / cell);
    const cx = Math.round(x / cell);
    const cz = Math.round(z / cell);
    const x0 = Math.max(1, cx - r);
    const x1 = Math.min(n - 2, cx + r);
    const z0 = Math.max(1, cz - r);
    const z1 = Math.min(n - 2, cz + r);
    const limit = REPOSE_SLOPE * cell;
    const offsets = [1, -1, n, -n];
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const i = ix + iz * n;
          for (const d of offsets) {
            const j = i + d;
            const drop = this.surface(i) - this.surface(j);
            if (drop <= limit + 1e-4) continue;
            // Move half the excess (enough to level that pair to the limit), but only loose snow.
            const depth = Math.min(this.top[i]!, (drop - limit) / 2);
            if (depth <= 1e-5) continue;
            const mass = depth * this.density[i]! * area;
            this.top[i]! -= depth;
            this.deposit(j, mass, this.density[i]!);
            this.touch(i);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  /** A track ran over the cell: compacts it and spoils any grooming. */
  trackOver(i: number, compactedDensity: number): void {
    this.compact(i, compactedDensity);
    this.setGroomed(i, 0);
  }

  private setGroomed(i: number, quality: number): void {
    const was = this.groomed[i]!;
    if (was !== quality) this.markChanged(i);
    const section = this.sectionOf[i]!;
    if (section > 0) {
      if (was === 0 && quality > 0) {
        this.groomedPisteCells++;
        this.groomedBySection[section]!++;
        this.groomCredit[section]! += quality / 255;
      } else if (was > 0 && quality === 0) {
        this.groomedPisteCells--;
        this.groomedBySection[section]!--;
      } else if (quality > was) {
        // A better pass over existing grooming earns the improvement.
        this.groomCredit[section]! += (quality - was) / 255;
      }
    }
    this.groomed[i] = quality;
  }

  /** Recounts groomed cells per section after the grid has been restored from a save. */
  recountGrooming(): void {
    this.groomedBySection.fill(0);
    this.groomedPisteCells = 0;
    for (let i = 0; i < this.groomed.length; i++) {
      const section = this.sectionOf[i]!;
      if (section > 0 && this.groomed[i]! > 0) {
        this.groomedBySection[section]!++;
        this.groomedPisteCells++;
      }
    }
    this.groomCredit.fill(0);
  }

  /** Copies the pending groom credit per section into `out` and resets it. */
  takeGroomCredit(out: Float64Array): void {
    out.set(this.groomCredit);
    this.groomCredit.fill(0);
  }

  /** Marks the save tile holding cell i as changed. */
  private markChanged(i: number): void {
    const n = this.grid.n;
    const ix = i % n;
    const iz = (i - ix) / n;
    const cell = this.grid.cellM;
    const tx = Math.min(this.tilesPerSide - 1, Math.floor((ix * cell) / TILE_M));
    const tz = Math.min(this.tilesPerSide - 1, Math.floor((iz * cell) / TILE_M));
    this.changedTiles[tx + tz * this.tilesPerSide] = 1;
  }

  private touch(i: number): void {
    this.markChanged(i);
    const n = this.grid.n;
    const ix = i % n;
    const iz = (i - ix) / n;
    const r = this.dirtyRect;
    if (r.minX > r.maxX) {
      r.minX = r.maxX = ix;
      r.minZ = r.maxZ = iz;
    } else {
      if (ix < r.minX) r.minX = ix;
      if (ix > r.maxX) r.maxX = ix;
      if (iz < r.minZ) r.minZ = iz;
      if (iz > r.maxZ) r.maxZ = iz;
    }
  }

  clearDirtyRect(): void {
    const r = this.dirtyRect;
    r.minX = r.minZ = 1;
    r.maxX = r.maxZ = 0;
  }

  /**
   * Writes surface detail at a world position. `groom` and `track` are 0..255; pass -1 to leave a
   * channel unchanged. (dirX, dirZ) is the unit travel direction.
   */
  markSurface(x: number, z: number, groom: number, track: number, dirX: number, dirZ: number): void {
    if (!this.grid.contains(x, z)) return;
    const tx = Math.min(this.tilesPerSide - 1, Math.floor(x / TILE_M));
    const tz = Math.min(this.tilesPerSide - 1, Math.floor(z / TILE_M));
    const key = tx + tz * this.tilesPerSide;
    let tile = this.tiles[key];
    if (!tile) {
      tile = new Uint8Array(TILE_CELLS * TILE_CELLS * 4);
      for (let k = 0; k < tile.length; k += 4) {
        tile[k + CH_DIR_X] = 128;
        tile[k + CH_DIR_Z] = 128;
      }
      this.tiles[key] = tile;
    }
    const fx = Math.min(TILE_CELLS - 1, Math.floor((x - tx * TILE_M) / FINE_CELL_M));
    const fz = Math.min(TILE_CELLS - 1, Math.floor((z - tz * TILE_M) / FINE_CELL_M));
    const dx = Math.round(128 + 127 * dirX);
    const dz = Math.round(128 + 127 * dirZ);
    write(tile, (fx + fz * TILE_CELLS) * 4, groom, track, dx, dz);
    this.dirtyTiles.add(key);

    const cx = Math.min(this.coarseN - 1, Math.floor(x / COARSE_CELL_M));
    const cz = Math.min(this.coarseN - 1, Math.floor(z / COARSE_CELL_M));
    write(this.coarse, (cx + cz * this.coarseN) * 4, groom, track, dx, dz);
    this.coarseDirty = true;
  }
}

function write(data: Uint8Array, o: number, groom: number, track: number, dx: number, dz: number): void {
  if (groom >= 0) data[o + CH_GROOM] = groom;
  if (track >= 0) data[o + CH_TRACK] = track;
  data[o + CH_DIR_X] = dx;
  data[o + CH_DIR_Z] = dz;
}
