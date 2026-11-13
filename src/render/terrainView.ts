import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three/webgpu';
import type { Snowpack } from '../sim/snow/snowpack';

const CHUNK_CELLS = 128;
const LOD_STEPS = [1, 2, 4, 8] as const;
/** A chunk uses LOD k while its distance to the camera is below LOD_RANGE_M[k]. */
const LOD_RANGE_M = [230, 500, 1050] as const;
const REBUILD_BUDGET_MS = 4;

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  wantLod: number;
  dirty: boolean;
  distance: number;
  mesh: Mesh;
}

/**
 * Draws the snow surface as a grid of chunks, each at a level of detail chosen by distance.
 * Chunks are rebuilt from the simulation's height fields when their detail level changes or
 * when machinery reshapes the snow inside them. Skirts hide the seams between detail levels.
 */
export class TerrainView {
  readonly group = new Group();
  private readonly chunks: Chunk[] = [];
  private readonly perSide: number;
  private readonly indexCache = new Map<number, Uint16Array>();
  private readonly queue: Chunk[] = [];

  constructor(
    private readonly snow: Snowpack,
    material: Material,
  ) {
    this.perSide = Math.floor((snow.grid.n - 1) / CHUNK_CELLS);
    for (let cz = 0; cz < this.perSide; cz++) {
      for (let cx = 0; cx < this.perSide; cx++) {
        const mesh = new Mesh(new BufferGeometry(), material);
        mesh.position.set(cx * CHUNK_CELLS * snow.grid.cellM, 0, cz * CHUNK_CELLS * snow.grid.cellM);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        const chunk: Chunk = {
          cx,
          cz,
          lod: -1,
          wantLod: LOD_STEPS.length - 1,
          dirty: false,
          distance: 0,
          mesh,
        };
        this.build(chunk);
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
  }

  /** Picks detail levels for the camera position and rebuilds the most important stale chunks. */
  update(camera: Vector3): void {
    const snow = this.snow;
    const size = CHUNK_CELLS * snow.grid.cellM;

    const rect = snow.dirtyRect;
    if (rect.minX <= rect.maxX) {
      // One cell of margin: normals read neighbours, and edge vertices are shared between chunks.
      const x0 = Math.max(0, Math.floor((rect.minX - 2) / CHUNK_CELLS));
      const x1 = Math.min(this.perSide - 1, Math.floor((rect.maxX + 2) / CHUNK_CELLS));
      const z0 = Math.max(0, Math.floor((rect.minZ - 2) / CHUNK_CELLS));
      const z1 = Math.min(this.perSide - 1, Math.floor((rect.maxZ + 2) / CHUNK_CELLS));
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) this.chunks[cx + cz * this.perSide]!.dirty = true;
      snow.clearDirtyRect();
    }

    this.queue.length = 0;
    for (const chunk of this.chunks) {
      const dx = Math.max(0, chunk.cx * size - camera.x, camera.x - (chunk.cx + 1) * size);
      const dz = Math.max(0, chunk.cz * size - camera.z, camera.z - (chunk.cz + 1) * size);
      const dy = Math.max(0, Math.abs(camera.y - chunk.mesh.geometry.boundingSphere!.center.y) - 60);
      chunk.distance = Math.hypot(dx, dy, dz);
      let lod = LOD_STEPS.length - 1;
      for (let k = 0; k < LOD_RANGE_M.length; k++) {
        // Hysteresis so a chunk on a boundary does not flip every frame.
        const range = LOD_RANGE_M[k]! * (chunk.lod >= 0 && chunk.lod <= k ? 1.08 : 1);
        if (chunk.distance < range) {
          lod = k;
          break;
        }
      }
      chunk.wantLod = lod;
      if (chunk.dirty || chunk.lod !== lod) this.queue.push(chunk);
    }
    if (this.queue.length === 0) return;
    this.queue.sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    for (const chunk of this.queue) {
      this.build(chunk);
      if (performance.now() - start > REBUILD_BUDGET_MS) break;
    }
  }

  private build(chunk: Chunk): void {
    const snow = this.snow;
    const { ground, base, top } = snow;
    const n = snow.grid.n;
    const cell = snow.grid.cellM;
    const step = LOD_STEPS[chunk.wantLod]!;
    const side = CHUNK_CELLS / step + 1;
    const gridVerts = side * side;
    const count = gridVerts + side * 4;
    let geometry = chunk.mesh.geometry;

    let position = geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!position || position.count !== count) {
      // New detail level: a fresh geometry, so GPU buffers of the old one are released cleanly.
      geometry.dispose();
      geometry = new BufferGeometry();
      chunk.mesh.geometry = geometry;
      position = new BufferAttribute(new Float32Array(count * 3), 3);
      geometry.setAttribute('position', position);
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('snowDepth', new BufferAttribute(new Float32Array(count), 1));
      geometry.setIndex(new BufferAttribute(this.indexFor(side), 1));
    }
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    const depth = geometry.getAttribute('snowDepth') as BufferAttribute;
    const pos = position.array as Float32Array;
    const nor = normal.array as Float32Array;
    const dep = depth.array as Float32Array;

    const x0 = chunk.cx * CHUNK_CELLS;
    const z0 = chunk.cz * CHUNK_CELLS;
    const max = n - 1;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < side; j++) {
      const gz = z0 + j * step;
      for (let i = 0; i < side; i++) {
        const gx = x0 + i * step;
        const c = gx + gz * n;
        const y = ground[c]! + base[c]! + top[c]!;
        const l = (gx >= step ? gx - step : 0) + gz * n;
        const r = (gx + step <= max ? gx + step : max) + gz * n;
        const u = gx + (gz >= step ? gz - step : 0) * n;
        const d = gx + (gz + step <= max ? gz + step : max) * n;
        const sx = ground[l]! + base[l]! + top[l]! - (ground[r]! + base[r]! + top[r]!);
        const sz = ground[u]! + base[u]! + top[u]! - (ground[d]! + base[d]! + top[d]!);
        const sy = 2 * step * cell;
        const inv = 1 / Math.sqrt(sx * sx + sy * sy + sz * sz);
        const v = (i + j * side) * 3;
        pos[v] = i * step * cell;
        pos[v + 1] = y;
        pos[v + 2] = j * step * cell;
        nor[v] = sx * inv;
        nor[v + 1] = sy * inv;
        nor[v + 2] = sz * inv;
        dep[i + j * side] = base[c]! + top[c]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // Skirt: a copy of each border vertex, dropped below the surface.
    const drop = step * 2 + 0.5;
    let s = gridVerts;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < side; k++) {
        const src = e === 0 ? k : e === 1 ? k + (side - 1) * side : e === 2 ? k * side : k * side + side - 1;
        pos[s * 3] = pos[src * 3]!;
        pos[s * 3 + 1] = pos[src * 3 + 1]! - drop;
        pos[s * 3 + 2] = pos[src * 3 + 2]!;
        nor[s * 3] = nor[src * 3]!;
        nor[s * 3 + 1] = nor[src * 3 + 1]!;
        nor[s * 3 + 2] = nor[src * 3 + 2]!;
        dep[s] = dep[src]!;
        s++;
      }
    }

    position.needsUpdate = true;
    normal.needsUpdate = true;
    depth.needsUpdate = true;
    const half = (CHUNK_CELLS * cell) / 2;
    const rangeY = (maxY - minY) / 2 + drop;
    geometry.boundingSphere = new Sphere(
      new Vector3(half, (minY + maxY) / 2, half),
      Math.hypot(half, half, rangeY),
    );
    chunk.lod = chunk.wantLod;
    chunk.dirty = false;
  }

  /** Triangle indices for a chunk with `side` vertices per edge, including its skirts. */
  private indexFor(side: number): Uint16Array {
    const cached = this.indexCache.get(side);
    if (cached) return cached;
    const quads = (side - 1) * (side - 1);
    const index = new Uint16Array(quads * 6 + (side - 1) * 4 * 12);
    let o = 0;
    for (let j = 0; j < side - 1; j++) {
      for (let i = 0; i < side - 1; i++) {
        const a = i + j * side;
        index[o++] = a;
        index[o++] = a + side;
        index[o++] = a + 1;
        index[o++] = a + 1;
        index[o++] = a + side;
        index[o++] = a + side + 1;
      }
    }
    const gridVerts = side * side;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < side - 1; k++) {
        const a = e === 0 ? k : e === 1 ? k + (side - 1) * side : e === 2 ? k * side : k * side + side - 1;
        const b = e < 2 ? a + 1 : a + side;
        const sa = gridVerts + e * side + k;
        const sb = sa + 1;
        // Both windings, so the skirt is visible whichever way the edge faces.
        index[o++] = a;
        index[o++] = b;
        index[o++] = sa;
        index[o++] = b;
        index[o++] = sb;
        index[o++] = sa;
        index[o++] = a;
        index[o++] = sa;
        index[o++] = b;
        index[o++] = b;
        index[o++] = sa;
        index[o++] = sb;
      }
    }
    this.indexCache.set(side, index);
    return index;
  }
}
