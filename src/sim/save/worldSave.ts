import type { GameMode, OwnedMachine } from '../career';
import { Snowpack, TILE_CELLS, TILE_M } from '../snow/snowpack';
import { generateMountain } from '../terrain/mountain';
import { World } from '../world';

/** Version of the world data inside a save. Bump it and add a migration when the shape changes. */
export const WORLD_SAVE_VERSION = 1;

interface MachineState {
  uid: number;
  pose: number[];
  bladeHeightM: number;
  bladeLoadKg: number;
  tillerPos: number;
  trackTravel: [number, number];
  winchAnchor: string | null;
  winchSetting: number;
  dynamics: number[];
}

/** The JSON part of a save. */
export interface WorldMeta {
  version: number;
  seed: number;
  mode: GameMode;
  stepCount: number;
  /** null in the sandbox, where money is unlimited. */
  money: number | null;
  earned: number;
  nextUid: number;
  fleet: OwnedMachine[];
  activeIndex: number;
  machines: MachineState[];
  sectionBonusPaid: number[];
  runBonusPaid: number[];
  pendingPay: number;
  pendingLabel: string;
  /** Grooming done since the last payout, per section, not yet paid. */
  groomCredit: number[];
}

/** Everything needed to rebuild a world: JSON metadata and binary snow data. */
export interface WorldSnapshot {
  meta: WorldMeta;
  /** Changed 1 m grid tiles: base, top, density and grooming. */
  cells: Uint8Array;
  /** Allocated 0.25 m surface-detail tiles. */
  surface: Uint8Array;
  /** Whole-map surface summary. */
  coarse: Uint8Array;
}

/** The grid cell range covered by save tile `t` along one axis (the last tile takes the edge sample). */
function tileRange(t: number, tilesPerSide: number, n: number): [number, number] {
  const start = t * TILE_M;
  const end = t === tilesPerSide - 1 ? n - 1 : start + TILE_M - 1;
  return [start, end];
}

function encodeCells(snow: Snowpack): Uint8Array {
  const n = snow.grid.n;
  const side = snow.tilesPerSide;
  const tiles: number[] = [];
  let cells = 0;
  for (let t = 0; t < snow.changedTiles.length; t++) {
    if (!snow.changedTiles[t]) continue;
    tiles.push(t);
    const [x0, x1] = tileRange(t % side, side, n);
    const [z0, z1] = tileRange(Math.floor(t / side), side, n);
    cells += (x1 - x0 + 1) * (z1 - z0 + 1);
  }
  // Per tile: index; then per cell three float32 (base, top, density) and one byte of grooming.
  const out = new Uint8Array(4 + tiles.length * 4 + cells * 13);
  const view = new DataView(out.buffer);
  view.setUint32(0, tiles.length, true);
  let o = 4;
  for (const t of tiles) {
    view.setUint32(o, t, true);
    o += 4;
    const [x0, x1] = tileRange(t % side, side, n);
    const [z0, z1] = tileRange(Math.floor(t / side), side, n);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = ix + iz * n;
        view.setFloat32(o, snow.base[i]!, true);
        view.setFloat32(o + 4, snow.top[i]!, true);
        view.setFloat32(o + 8, snow.density[i]!, true);
        out[o + 12] = snow.groomed[i]!;
        o += 13;
      }
    }
  }
  return out;
}

function decodeCells(snow: Snowpack, data: Uint8Array): void {
  const n = snow.grid.n;
  const side = snow.tilesPerSide;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  let o = 4;
  for (let k = 0; k < count; k++) {
    const t = view.getUint32(o, true);
    o += 4;
    if (t >= snow.changedTiles.length) throw new Error('save tile index out of range');
    snow.changedTiles[t] = 1;
    const [x0, x1] = tileRange(t % side, side, n);
    const [z0, z1] = tileRange(Math.floor(t / side), side, n);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = ix + iz * n;
        snow.base[i] = view.getFloat32(o, true);
        snow.top[i] = view.getFloat32(o + 4, true);
        snow.density[i] = view.getFloat32(o + 8, true);
        snow.groomed[i] = data[o + 12]!;
        o += 13;
      }
    }
  }
  if (o !== data.byteLength) throw new Error('save cell data has the wrong length');
}

const SURFACE_TILE_BYTES = TILE_CELLS * TILE_CELLS * 4;

function encodeSurface(snow: Snowpack): Uint8Array {
  const keys: number[] = [];
  snow.tiles.forEach((tile, key) => tile && keys.push(key));
  const out = new Uint8Array(4 + keys.length * (4 + SURFACE_TILE_BYTES));
  const view = new DataView(out.buffer);
  view.setUint32(0, keys.length, true);
  let o = 4;
  for (const key of keys) {
    view.setUint32(o, key, true);
    out.set(snow.tiles[key]!, o + 4);
    o += 4 + SURFACE_TILE_BYTES;
  }
  return out;
}

function decodeSurface(snow: Snowpack, data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  if (data.byteLength !== 4 + count * (4 + SURFACE_TILE_BYTES))
    throw new Error('save surface data has the wrong length');
  let o = 4;
  for (let k = 0; k < count; k++) {
    const key = view.getUint32(o, true);
    if (key >= snow.tiles.length) throw new Error('save surface tile out of range');
    snow.tiles[key] = data.slice(o + 4, o + 4 + SURFACE_TILE_BYTES);
    snow.dirtyTiles.add(key);
    o += 4 + SURFACE_TILE_BYTES;
  }
}

/** Captures everything that differs from a freshly generated world. */
export function captureWorld(world: World): WorldSnapshot {
  const { career, snow } = world;
  const machines: MachineState[] = world.machines.map((m) => {
    const v = m.vehicle;
    const b = v.body;
    return {
      uid: m.owned.uid,
      pose: [b.px, b.py, b.pz, b.qx, b.qy, b.qz, b.qw, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz],
      bladeHeightM: v.bladeHeightM,
      bladeLoadKg: v.bladeLoadKg,
      tillerPos: v.tillerPos,
      trackTravel: [v.trackTravel[0]!, v.trackTravel[1]!],
      winchAnchor: world.winchAnchorName(m),
      winchSetting: v.winchSetting,
      dynamics: v.captureDynamics(),
    };
  });
  return {
    meta: {
      version: WORLD_SAVE_VERSION,
      seed: world.mountain.seed,
      mode: career.mode,
      stepCount: world.stepCount,
      money: career.mode === 'sandbox' ? null : career.money,
      earned: career.earned,
      nextUid: career.nextUid,
      fleet: career.machines.map((m) => ({ uid: m.uid, model: m.model, levels: { ...m.levels } })),
      activeIndex: world.activeIndex,
      machines,
      sectionBonusPaid: Array.from(world.sectionBonusPaid),
      runBonusPaid: Array.from(world.runBonusPaid),
      pendingPay: world.pendingPay,
      pendingLabel: world.pendingLabel,
      groomCredit: Array.from(snow.groomCredit),
    },
    cells: encodeCells(snow),
    surface: encodeSurface(snow),
    coarse: snow.coarse.slice(),
  };
}

/** Rebuilds a world from a snapshot: regenerates the mountain from its seed, then applies the changes. */
export function restoreWorld(snapshot: WorldSnapshot): World {
  const { meta } = snapshot;
  if (meta.version !== WORLD_SAVE_VERSION) throw new Error(`unsupported world save version ${meta.version}`);
  const mountain = generateMountain(meta.seed);
  const snow = new Snowpack(mountain);
  snow.fillNatural(meta.seed);
  decodeCells(snow, snapshot.cells);
  decodeSurface(snow, snapshot.surface);
  if (snapshot.coarse.byteLength !== snow.coarse.byteLength)
    throw new Error('save surface summary has the wrong size');
  snow.coarse.set(snapshot.coarse);
  snow.coarseDirty = true;
  snow.recountGrooming();

  const world = new World(mountain, snow, { mode: meta.mode, fleet: [] });
  const career = world.career;
  if (meta.mode === 'career') career.money = meta.money ?? 0;
  career.earned = meta.earned;
  for (const owned of meta.fleet) {
    const state = meta.machines.find((m) => m.uid === owned.uid);
    if (!state) throw new Error(`save has no state for machine ${owned.uid}`);
    const anchor = state.winchAnchor
      ? (mountain.winchAnchors.find((a) => a.name === state.winchAnchor) ?? null)
      : null;
    const machine = world.restoreMachine(owned, anchor ? anchor.name : null);
    const v = machine.vehicle;
    const b = v.body;
    const p = state.pose;
    [b.px, b.py, b.pz, b.qx, b.qy, b.qz, b.qw, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz] = p as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    v.bladeHeightM = state.bladeHeightM;
    v.bladeLoadKg = state.bladeLoadKg;
    v.tillerPos = state.tillerPos;
    v.trackTravel[0] = state.trackTravel[0];
    v.trackTravel[1] = state.trackTravel[1];
    v.winchSetting = state.winchSetting;
    if (anchor) {
      const point = world.nearestAnchorPoint(anchor.name);
      if (point) v.hookWinch(point);
    }
    v.restoreDynamics(state.dynamics);
  }
  career.nextUid = Math.max(career.nextUid, meta.nextUid);
  world.activeIndex = Math.min(Math.max(0, meta.activeIndex), Math.max(0, world.machines.length - 1));
  world.stepCount = meta.stepCount;
  world.sectionBonusPaid.set(meta.sectionBonusPaid);
  world.runBonusPaid.set(meta.runBonusPaid);
  world.pendingPay = meta.pendingPay;
  world.pendingLabel = meta.pendingLabel;
  snow.groomCredit.set(meta.groomCredit);
  return world;
}
