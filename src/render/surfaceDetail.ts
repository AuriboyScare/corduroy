import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector2 } from 'three/webgpu';
import { CH_DIR_X, CH_DIR_Z, TILE_CELLS, TILE_M, type Snowpack } from '../sim/snow/snowpack';

/** Tiles per side of the high-detail window that follows the camera focus. */
const WINDOW_TILES = 8;
export const WINDOW_M = WINDOW_TILES * TILE_M;
const WINDOW_CELLS = WINDOW_TILES * TILE_CELLS;
const ROW_BYTES = TILE_CELLS * 4;

/**
 * GPU copies of the snow surface detail: a 0.25 m window around the focus point (corduroy,
 * track marks) and a 2 m whole-map summary so groomed pistes read from across the valley.
 */
export class SurfaceDetailView {
  readonly fine: DataTexture;
  readonly coarse: DataTexture;
  /** World position of the fine window's corner; bound to the snow material. */
  readonly origin = new Vector2(-1e6, -1e6);

  private readonly fineData = new Uint8Array(WINDOW_CELLS * WINDOW_CELLS * 4);
  private readonly blankRow = new Uint8Array(ROW_BYTES);
  private originTileX = Number.NaN;
  private originTileZ = Number.NaN;
  private coarseUploadAt = 0;

  constructor(private readonly snow: Snowpack) {
    for (let k = 0; k < ROW_BYTES; k += 4) {
      this.blankRow[k + CH_DIR_X] = 128;
      this.blankRow[k + CH_DIR_Z] = 128;
    }
    this.fine = makeTexture(this.fineData, WINDOW_CELLS);
    this.coarse = makeTexture(snow.coarse, snow.coarseN);
  }

  /** Recentres the window on the focus point and uploads whatever the simulation changed. */
  update(focusX: number, focusZ: number, nowMs: number): void {
    const snow = this.snow;
    const tx = Math.round(focusX / TILE_M) - WINDOW_TILES / 2;
    const tz = Math.round(focusZ / TILE_M) - WINDOW_TILES / 2;
    let upload = false;
    if (tx !== this.originTileX || tz !== this.originTileZ) {
      this.originTileX = tx;
      this.originTileZ = tz;
      this.origin.set(tx * TILE_M, tz * TILE_M);
      for (let wz = 0; wz < WINDOW_TILES; wz++)
        for (let wx = 0; wx < WINDOW_TILES; wx++) this.copyTile(wx, wz);
      upload = true;
    } else if (snow.dirtyTiles.size > 0) {
      for (const key of snow.dirtyTiles) {
        const wx = (key % snow.tilesPerSide) - tx;
        const wz = Math.floor(key / snow.tilesPerSide) - tz;
        if (wx >= 0 && wz >= 0 && wx < WINDOW_TILES && wz < WINDOW_TILES) {
          this.copyTile(wx, wz);
          upload = true;
        }
      }
    }
    snow.dirtyTiles.clear();
    if (upload) this.fine.needsUpdate = true;

    if (snow.coarseDirty && nowMs - this.coarseUploadAt > 300) {
      snow.coarseDirty = false;
      this.coarseUploadAt = nowMs;
      this.coarse.needsUpdate = true;
    }
  }

  private copyTile(wx: number, wz: number): void {
    const snow = this.snow;
    const tx = this.originTileX + wx;
    const tz = this.originTileZ + wz;
    const inside = tx >= 0 && tz >= 0 && tx < snow.tilesPerSide && tz < snow.tilesPerSide;
    const tile = inside ? snow.tiles[tx + tz * snow.tilesPerSide] : null;
    for (let r = 0; r < TILE_CELLS; r++) {
      const dest = ((wz * TILE_CELLS + r) * WINDOW_CELLS + wx * TILE_CELLS) * 4;
      this.fineData.set(tile ? tile.subarray(r * ROW_BYTES, (r + 1) * ROW_BYTES) : this.blankRow, dest);
    }
  }
}

function makeTexture(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
