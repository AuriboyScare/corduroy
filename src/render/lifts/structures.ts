import {
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshStandardNodeMaterial,
} from 'three/webgpu';
import type { Lift } from '../../sim/lifts/lift';
import type { Snowpack } from '../../sim/snow/snowpack';
import { extrudeX, extrudeZ, type Kit, latheX } from '../machines/kit';
import {
  cladding,
  concrete,
  darkSteel,
  darkSteelFine,
  fenceBlue,
  galvanised,
  galvanisedFine,
  hallGlass,
  lampLens,
  liftPaint,
  litWindow,
  mat,
  roofMetal,
  rope,
  rubberLiner,
  safetyYellow,
  signBack,
  timber,
} from './materials';
import { addSign } from './signs';

const euler = new Euler();
const quaternion = new Quaternion();
const ONE = new Vector3(1, 1, 1);

/** A local frame at a point, turned so +z runs along `heading`. */
function frameAt(x: number, y: number, z: number, heading: number): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), quaternion.setFromEuler(euler.set(0, heading, 0)), ONE);
}

/** A grooved sheave with a rubber liner, axis along x. */
function sheaveParts(r: number, w: number): { wheel: BufferGeometry; liner: BufferGeometry } {
  const wheel = latheX(
    [
      [0, -w / 2],
      [r * 0.4, -w * 0.25],
      [r, -w / 2],
      [r * 1.06, -w / 2],
      [r * 1.06, w / 2],
      [r, w / 2],
      [r * 0.4, w * 0.25],
      [0, w / 2],
    ],
    12,
  );
  const liner = latheX(
    [
      [r * 1.065, -w * 0.3],
      [r * 1.02, 0],
      [r * 1.065, w * 0.3],
    ],
    12,
  );
  return { wheel, liner };
}

/** A horizontal bullwheel (axis y): grooved rim, spokes, hub. */
function bullwheel(kit: Kit, r: number, y: number): void {
  kit.add(
    galvanised,
    new LatheGeometry(
      [
        new Vector2(r - 0.14, -0.13),
        new Vector2(r, -0.13),
        new Vector2(r + 0.05, -0.06),
        new Vector2(r - 0.02, 0),
        new Vector2(r + 0.05, 0.06),
        new Vector2(r, 0.13),
        new Vector2(r - 0.14, 0.13),
        new Vector2(r - 0.14, -0.13),
      ],
      48,
    ),
    0,
    y,
    0,
  );
  kit.add(
    rubberLiner,
    new LatheGeometry(
      [new Vector2(r - 0.03, -0.035), new Vector2(r + 0.005, 0), new Vector2(r - 0.03, 0.035)],
      48,
    ),
    0,
    y,
    0,
  );
  kit.post(darkSteel, 0.36, 0.5, 0, y, 0, 0, 0, 16);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    kit.rod(
      galvanised,
      0.06,
      new Vector3(Math.sin(a) * 0.3, y, Math.cos(a) * 0.3),
      new Vector3(Math.sin(a) * (r - 0.12), y, Math.cos(a) * (r - 0.12)),
    );
  }
}

/** A small operator's cabin with windows on three sides, door, roof, lamp and status light. */
function operatorHut(kit: Kit, x: number, z: number, facing: number): void {
  const f = Math.sign(facing) || 1;
  kit.rbox(concrete, 2.9, 0.3, 2.9, 0.04, x, 0.05, z);
  kit.rbox(cladding, 2.6, 2.4, 2.6, 0.05, x, 1.35, z);
  // Windows on the front and both sides, with frames.
  kit.box(litWindow, 2.2, 1.0, 0.04, x, 1.75, z + f * 1.31);
  for (const s of [-1, 1]) kit.box(litWindow, 0.04, 1.0, 1.6, x + s * 1.31, 1.75, z + f * 0.2);
  kit.box(darkSteel, 2.3, 0.06, 0.08, x, 2.28, z + f * 1.32);
  kit.box(darkSteel, 2.3, 0.06, 0.08, x, 1.22, z + f * 1.32);
  kit.box(darkSteel, 0.06, 1.06, 0.08, x, 1.75, z + f * 1.32);
  // Door at the back, roof with overhang, lamp over the door, status light.
  kit.box(darkSteel, 0.9, 2.0, 0.05, x, 1.15, z - f * 1.31);
  kit.rbox(roofMetal, 3.2, 0.2, 3.3, 0.06, x, 2.68, z);
  kit.rbox(darkSteel, 0.25, 0.12, 0.18, 0.03, x, 2.42, z - f * 1.42);
  kit.box(lampLens, 0.18, 0.02, 0.12, x, 2.355, z - f * 1.42);
  kit.post(lampLens, 0.07, 0.12, x + 0.9, 2.85, z + f * 1.0);
}

/** A light pole with a lamp head aimed down at the work area. */
function lightPole(kit: Kit, x: number, z: number, height: number, aim: Vector3): void {
  kit.post(darkSteel, 0.07, height, x, height / 2, z);
  const head = new Vector3(x, height, z);
  const dir = aim.clone().sub(head).setY(0).normalize().multiplyScalar(0.6);
  kit.rod(darkSteel, 0.04, head, head.clone().add(dir));
  kit.rbox(darkSteel, 0.5, 0.16, 0.35, 0.04, head.x + dir.x * 1.3, height - 0.05, head.z + dir.z * 1.3);
  kit.box(lampLens, 0.42, 0.02, 0.28, head.x + dir.x * 1.3, height - 0.14, head.z + dir.z * 1.3);
}

/** The lift's name board on two posts, facing `normalZ` (+1 or -1 along local z). */
function nameBoard(kit: Kit, signs: MeshStandardNodeMaterial, x: number, z: number, normalZ: number): void {
  for (const s of [-1, 1]) kit.post(darkSteel, 0.06, 3.0, x + s * 1.55, 1.5, z);
  kit.box(signBack, 3.5, 0.66, 0.08, x, 2.6, z);
  addSign(kit, signs, 'name', 0.62, new Vector3(x, 2.6, z + normalZ * 0.045), new Vector3(0, 0, normalZ));
}

/** A queue maze: rows of posts with blue rails beside the loading area. */
function maze(kit: Kit, x0: number, x1: number, z0: number, z1: number, rows: number): void {
  for (let r = 0; r <= rows; r++) {
    const z = z0 + ((z1 - z0) * r) / rows;
    const xa = r % 2 === 0 ? x0 : x0 + Math.sign(x1 - x0) * 1.2;
    const xb = r % 2 === 0 ? x1 - Math.sign(x1 - x0) * 1.2 : x1;
    for (const x of [xa, (xa + xb) / 2, xb]) kit.post(darkSteelFine, 0.035, 1.0, x, 0.5, z, 0, 0, 6);
    kit.rod(fenceBlue, 0.03, new Vector3(xa, 0.95, z), new Vector3(xb, 0.95, z));
    kit.rod(fenceBlue, 0.03, new Vector3(xa, 0.55, z), new Vector3(xb, 0.55, z));
  }
}

/** Galvanised tube tower: footing, tapered tube, crossarm, sheave trains, catwalk, caged ladder. */
function tubeTower(
  kit: Kit,
  height: number,
  gauge: number,
  big: boolean,
  number: number,
  signs: MeshStandardNodeMaterial,
): void {
  const half = gauge / 2;
  const rBase = big ? 0.46 : 0.36;
  const rTop = big ? 0.32 : 0.25;
  const armY = height - 0.55;
  const sheaves = big ? 6 : 4;
  kit.rbox(concrete, 1.9, 1.0, 1.9, 0.06, 0, -0.18, 0);
  kit.box(galvanised, 1.05, 0.06, 1.05, 0, 0.35, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) kit.post(galvanised, 0.035, 0.12, sx * 0.42, 0.42, sz * 0.42, 0, 0, 6);
  kit.add(galvanised, new CylinderGeometry(rTop, rBase, armY - 0.25, 20), 0, (armY + 0.25) / 2 + 0.05, 0);
  kit.ring(galvanised, rBase * 0.86, 0.035, 'y', 0, armY * 0.45, 0);
  kit.rbox(liftPaint, gauge + 1.3, 0.42, 0.42, 0.05, 0, armY, 0);
  for (const s of [-1, 1])
    kit.rod(
      liftPaint,
      0.06,
      new Vector3(s * rTop * 0.8, armY - 1.4, 0),
      new Vector3(s * (half - 0.4), armY - 0.2, 0),
    );
  const { wheel, liner } = sheaveParts(0.2, 0.12);
  for (const s of [-1, 1]) {
    const x = s * half;
    kit.box(darkSteel, 0.16, 0.24, 0.16, x, armY + 0.3, 0);
    kit.rbox(darkSteel, 0.2, 0.2, sheaves * 0.48 + 0.2, 0.03, x, height - 0.36, 0);
    for (let k = 0; k < sheaves; k++) {
      const z = (k - (sheaves - 1) / 2) * 0.48;
      kit.add(galvanisedFine, wheel, x, height - 0.2, z);
      kit.add(rubberLiner, liner, x, height - 0.2, z);
    }
    kit.box(galvanised, 0.04, 0.32, 0.24, x + s * 0.22, height - 0.12, 0);
  }
  // Catwalk with handrail on the downhill side.
  kit.box(galvanised, gauge + 1.2, 0.04, 0.7, 0, armY - 0.3, -0.58);
  for (let k = 0; k <= 6; k++) {
    const x = -(gauge + 1.1) / 2 + ((gauge + 1.1) * k) / 6;
    kit.post(galvanisedFine, 0.02, 1.0, x, armY + 0.2, -0.9, 0, 0, 5);
  }
  kit.drum(galvanisedFine, 0.022, gauge + 1.1, 0, armY + 0.7, -0.9, 5);
  kit.drum(galvanisedFine, 0.018, gauge + 1.1, 0, armY + 0.25, -0.9, 5);
  // Ladder up the downhill face with a safety cage.
  const lz = -rBase - 0.16;
  for (const x of [-0.2, 0.2])
    kit.box(darkSteelFine, 0.045, armY - 0.75, 0.045, x, (armY - 0.75) / 2 + 0.45, lz);
  for (let y = 0.7; y < armY - 0.4; y += 0.3) kit.drum(darkSteelFine, 0.013, 0.4, 0, y, lz, 4);
  for (let y = 2.4; y < armY - 0.5; y += 1.0) kit.ring(darkSteelFine, 0.36, 0.013, 'y', 0, y, lz - 0.28);
  addSign(kit, signs, `tower${number}`, 0.45, new Vector3(0, armY, -0.22), new Vector3(0, 0, -1));
}

/** Lattice tower for the tram: four braced legs, rope saddles, platform. */
function latticeTower(
  kit: Kit,
  height: number,
  gauge: number,
  number: number,
  signs: MeshStandardNodeMaterial,
): void {
  const base = 3.2 + height * 0.06;
  const topW = 2.4;
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (sx: number, sz: number, y: number, w: number) => new Vector3((sx * w) / 2, y, (sz * w) / 2);
  const levels = Math.max(3, Math.round(height / 6));
  for (let l = 0; l < levels; l++) {
    const y0 = (height * l) / levels;
    const y1 = (height * (l + 1)) / levels;
    const w0 = base + (topW - base) * (l / levels);
    const w1 = base + (topW - base) * ((l + 1) / levels);
    for (let g = 0; g < 4; g++) {
      const [sx, sz] = legs[g]!;
      const [nx, nz] = legs[(g + 1) % 4]!;
      kit.rod(galvanised, 0.13, at(sx, sz, y0, w0), at(sx, sz, y1, w1), 6);
      kit.rod(galvanised, 0.05, at(sx, sz, y0, w0), at(nx, nz, y1, w1), 5);
      kit.rod(galvanised, 0.05, at(nx, nz, y0, w0), at(sx, sz, y1, w1), 5);
      kit.rod(galvanised, 0.06, at(sx, sz, y1, w1), at(nx, nz, y1, w1), 5);
    }
  }
  for (const [sx, sz] of legs) kit.rbox(concrete, 1.3, 0.9, 1.3, 0.06, (sx * base) / 2, 0.0, (sz * base) / 2);
  // Head frame across both sides with saddles for each track rope and a haul rope sheave.
  kit.rbox(darkSteel, gauge + 3.4, 0.8, 2.0, 0.06, 0, height - 0.6, 0);
  const saddle = extrudeX(
    [
      ...Array.from({ length: 9 }, (_, k) => {
        const z = -1.6 + (3.2 * k) / 8;
        return [z, -(z * z) / 7] as const;
      }),
      [1.6, -0.75],
      [-1.6, -0.75],
    ],
    0.24,
    0.02,
  );
  const half = gauge / 2;
  for (const s of [-1, 1]) {
    for (const o of [-0.45, 0.45]) kit.add(darkSteel, saddle, s * half + o, height + 0.36, 0);
    const { wheel } = sheaveParts(0.35, 0.16);
    kit.add(galvanised, wheel, s * half, height - 0.05, 0);
  }
  kit.box(galvanised, gauge + 3.0, 0.05, 1.0, 0, height - 1.05, -1.4);
  kit.drum(galvanised, 0.025, gauge + 3.0, 0, height - 0.05, -1.88, 6);
  addSign(kit, signs, `tower${number}`, 0.7, new Vector3(0, height - 0.6, -1.02), new Vector3(0, 0, -1));
}

/** Rope tow pole: post, crossarm and a sheave on each side. */
function towPole(kit: Kit, height: number, gauge: number): void {
  kit.rbox(concrete, 0.6, 0.4, 0.6, 0.04, 0, 0, 0);
  kit.post(galvanised, 0.07, height + 0.5, 0, (height + 0.5) / 2, 0, 0, 0, 10);
  kit.rbox(liftPaint, gauge + 0.4, 0.12, 0.12, 0.02, 0, height + 0.22, 0);
  const { wheel, liner } = sheaveParts(0.14, 0.08);
  for (const s of [-1, 1]) {
    kit.add(galvanisedFine, wheel, (s * gauge) / 2, height + 0.02, 0);
    kit.add(rubberLiner, liner, (s * gauge) / 2, height + 0.02, 0);
  }
}

export function buildTowers(kit: Kit, lift: Lift, signs: MeshStandardNodeMaterial): void {
  const t = lift.type;
  kit.roundSegments = 1;
  const heading = Math.atan2(lift.dirX, lift.dirZ);
  const towers = lift.towers;
  for (let k = 1; k < towers.length - 1; k++) {
    const tower = towers[k]!;
    const height = tower.topY - tower.groundY;
    kit.setFrame(frameAt(tower.x, tower.groundY, tower.z, heading));
    if (t.kind === 'ropeTow') towPole(kit, height, t.gaugeM);
    else if (t.kind === 'tram') latticeTower(kit, height, t.gaugeM, k, signs);
    else tubeTower(kit, height, t.gaugeM, t.kind === 'gondola', k, signs);
  }
  kit.setFrame(null);
}

/** Ropes: haul rope on both sides between every support, sagging; the tram's two track ropes. */
export function buildRopes(kit: Kit, lift: Lift): void {
  const t = lift.type;
  const half = t.gaugeM / 2;
  const lx = lift.dirZ;
  const lz = -lift.dirX;
  const step = t.kind === 'ropeTow' ? 3 : 6;
  for (const side of [-1, 1]) {
    const lines = t.kind === 'tram' ? [-0.45, 0.45] : [0];
    for (const offset of lines) {
      const points: Vector3[] = [];
      for (let s = 0; s <= lift.lengthM + 0.01; s += step) {
        const ss = Math.min(s, lift.lengthM);
        points.push(
          new Vector3(
            lift.line.bottom.x + lift.dirX * ss + lx * (side * half + offset),
            lift.ropeY(ss) + (t.kind === 'tram' ? 0.4 : 0),
            lift.line.bottom.z + lift.dirZ * ss + lz * (side * half + offset),
          ),
        );
      }
      const r = t.kind === 'tram' ? 0.03 : 0.022;
      for (let k = 1; k < points.length; k++) kit.rod(rope, r, points[k - 1]!, points[k]!, 5);
    }
  }
}

interface Station {
  lift: Lift;
  /** 0 bottom, 1 top. */
  end: 0 | 1;
  /** Rope height above the ground at the bullwheel. */
  ropeH: number;
  /** Local x of the up line (where riders travel): local +z always points out toward the line. */
  upX: number;
  signs: MeshStandardNodeMaterial;
}

/** Fixed-grip chair terminal: bullwheel under a bonnet on a cantilever, drive or tensioner. */
function chairTerminal(kit: Kit, st: Station): void {
  const R = st.lift.type.gaugeM / 2;
  const h = st.ropeH;
  bullwheel(kit, R, h);
  kit.add(
    liftPaint,
    new SphereGeometry(1, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(R + 0.4, 0.95, R + 0.4),
    0,
    h + 0.2,
    0,
  );
  kit.add(liftPaint, new CylinderGeometry(R + 0.4, R + 0.4, 0.4, 48, 1, true), 0, h + 0.05, 0);
  // Cantilever: column behind the wheel, beam over it, vertical shaft housing.
  const back = -(R + 1.5);
  kit.rbox(liftPaint, 0.75, h + 2.0, 0.75, 0.06, 0, (h + 2.0) / 2, back);
  kit.rbox(liftPaint, 0.65, 0.75, -back + 0.6, 0.06, 0, h + 1.65, back / 2 + 0.2);
  kit.post(darkSteel, 0.28, 1.2, 0, h + 0.85, 0, 0, 0, 14);
  kit.rbox(concrete, 1.6, 0.6, 1.6, 0.06, 0, 0.0, back);
  if (st.end === 0) {
    // Drive: gearbox and motor on the beam.
    kit.rbox(darkSteel, 1.1, 0.9, 1.1, 0.08, 0, h + 2.45, -0.4);
    kit.add(galvanised, new CylinderGeometry(0.36, 0.36, 1.2, 20).rotateZ(Math.PI / 2), 1.1, h + 2.45, -0.4);
    kit.add(darkSteel, new CylinderGeometry(0.38, 0.38, 0.12, 20).rotateZ(Math.PI / 2), 1.76, h + 2.45, -0.4);
  } else {
    // Return: tension carriage with a counterweight hanging in its frame.
    kit.rbox(concrete, 1.3, 1.8, 1.3, 0.06, 0, 1.4, back - 2.4);
    for (const s of [-1, 1])
      kit.rbox(darkSteel, 0.25, h + 3.0, 0.25, 0.03, s * 1.0, (h + 3.0) / 2, back - 2.4);
    kit.rbox(darkSteel, 2.3, 0.3, 0.3, 0.04, 0, h + 3.0, back - 2.4);
    kit.rod(rope, 0.03, new Vector3(0, h + 1.65, back), new Vector3(0, h + 2.95, back - 2.4));
    kit.rod(rope, 0.03, new Vector3(0, h + 2.95, back - 2.4), new Vector3(0, 2.3, back - 2.4));
  }
  // Electrical cabinet with a door seam and status light.
  const cx = -st.upX * (R + 1.8);
  kit.rbox(galvanised, 0.9, 1.9, 0.5, 0.04, cx, 0.95, back + 0.3);
  kit.box(mat, 0.01, 1.7, 0.01, cx, 0.95, back + 0.56);
  kit.post(lampLens, 0.05, 0.06, cx + 0.3, 1.7, back + 0.56);
  const x = st.upX * R;
  if (st.end === 0) {
    // Loading: mat where riders wait, load sign ahead, queue maze to the side.
    kit.box(mat, 2.4, 0.05, 1.0, x, 0.03, 1.8);
    kit.box(safetyYellow, 2.4, 0.06, 0.12, x, 0.04, 2.35);
    kit.post(darkSteel, 0.05, 2.4, x + st.upX * 1.6, 1.2, 6.0);
    addSign(kit, st.signs, 'load', 0.55, new Vector3(x + st.upX * 1.6, 2.2, 5.95), new Vector3(0, 0, -1));
    maze(kit, x + st.upX * 2.4, x + st.upX * 8, -1.0, 3.5, 4);
  } else {
    // Unloading ramp edged with timber, and the unload sign.
    for (const s of [-1, 1]) kit.box(timber, 0.15, 0.3, 4.5, x + s * 1.4, 0.15, 3.0);
    kit.post(darkSteel, 0.05, 2.4, x + st.upX * 1.9, 1.2, 1.2);
    addSign(kit, st.signs, 'unload', 0.55, new Vector3(x + st.upX * 1.9, 2.2, 1.25), new Vector3(0, 0, 1));
    kit.post(darkSteel, 0.05, 2.4, x - st.upX * 1.9, 1.2, 8.5);
    addSign(kit, st.signs, 'tips', 0.5, new Vector3(x - st.upX * 1.9, 2.2, 8.45), new Vector3(0, 0, -1));
  }
  operatorHut(kit, st.upX * (R + 4.2), -1.5, 1);
  lightPole(kit, st.upX * (R + 1.8), -2.5, 5.5, new Vector3(x, 0, 3));
  lightPole(kit, -st.upX * (R + 1.8), 2.5, 5.5, new Vector3(-x, 0, 0));
  nameBoard(kit, st.signs, st.upX * (R + 4.5), 8.0, 1);
}

/** Detachable gondola terminal: a glazed hall with a barrel roof over the station rails. */
function gondolaTerminal(kit: Kit, st: Station): void {
  const R = st.lift.type.gaugeM / 2;
  const h = st.ropeH;
  const len = Math.max(14, st.lift.type.stationLengthM);
  const halfW = R + 3.2;
  const z0 = -(R + 2.5);
  const z1 = len;
  const eave = h + 2.4;
  const mid = (z0 + z1) / 2;
  const depth = z1 - z0;
  kit.rbox(concrete, halfW * 2 + 0.6, 0.4, depth + 0.6, 0.06, 0, 0.0, mid);
  // Steel frame: columns along both sides, a ring beam, and a barrel roof.
  for (let z = z0; z <= z1 + 0.01; z += depth / Math.round(depth / 4)) {
    for (const s of [-1, 1]) kit.rbox(liftPaint, 0.3, eave, 0.3, 0.04, s * halfW, eave / 2, z);
  }
  for (const s of [-1, 1]) kit.rbox(liftPaint, 0.3, 0.4, depth, 0.04, s * halfW, eave, mid);
  const arc: [number, number][] = [];
  for (let k = 0; k <= 16; k++) {
    const a = Math.PI - (k / 16) * Math.PI;
    arc.push([Math.cos(a) * (halfW + 0.4), Math.sin(a) * 1.8]);
  }
  for (let k = 16; k >= 0; k--) {
    const a = Math.PI - (k / 16) * Math.PI;
    arc.push([Math.cos(a) * (halfW + 0.2), Math.sin(a) * 1.65 - 0.15]);
  }
  kit.add(roofMetal, extrudeZ(arc, depth + 1.2, 0.02), 0, eave + 0.2, mid);
  // Walls: solid base, glazing above, mullions; back wall closed; the front stays open to the line.
  for (const s of [-1, 1]) {
    kit.box(cladding, 0.2, 1.2, depth, s * halfW, 0.8, mid);
    kit.box(hallGlass, 0.08, eave - 1.6, depth - 0.4, s * halfW, 1.4 + (eave - 1.6) / 2, mid);
    for (let z = z0 + 2; z < z1; z += 2)
      kit.box(darkSteel, 0.14, eave - 1.4, 0.08, s * (halfW + 0.05), 0.7 + (eave - 1.4) / 2, z);
  }
  kit.box(cladding, halfW * 2, eave, 0.25, 0, eave / 2, z0);
  addSign(kit, st.signs, 'station', 1.1, new Vector3(0, eave + 0.9, z1 + 0.65), new Vector3(0, 0, 1));
  addSign(kit, st.signs, 'brand', 0.6, new Vector3(0, eave - 0.6, z0 - 0.14), new Vector3(0, 0, -1));
  // Inside: bullwheel and drive, the U-shaped station rail with its tyre conveyor, platform edges.
  bullwheel(kit, R, h);
  kit.rbox(darkSteel, 1.6, 1.0, 1.4, 0.08, 0, h + 1.2, 0);
  const railY = h + 0.35;
  const rail: Vector3[] = [];
  for (let z = z1 - 0.5; z > 0; z -= 2) rail.push(new Vector3(R, railY, z));
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI;
    rail.push(new Vector3(Math.cos(a) * R, railY, -Math.sin(a) * R));
  }
  for (let z = 0; z < z1 - 0.4; z += 2) rail.push(new Vector3(-R, railY, z + 2));
  kit.tube(galvanised, rail, 0.06);
  for (const s of [-1, 1]) {
    kit.box(darkSteel, 0.3, 0.25, z1, s * R, railY + 0.45, z1 / 2);
    for (let z = 0.4; z < z1; z += 0.7) kit.drum(rubberLiner, 0.16, 0.12, s * R, railY + 0.3, z, 8);
    kit.box(safetyYellow, 0.15, 0.03, z1 - 1, s * (R - 1.4), 0.22, z1 / 2);
  }
  for (let z = z0 + 2; z < z1; z += 3) kit.box(lampLens, 0.3, 0.03, 1.4, 0, eave + 1.2, z);
  operatorHut(kit, st.upX * (halfW + 2.2), z1 - 3, 1);
  lightPole(kit, st.upX * (halfW + 1.2), z1 + 3, 6, new Vector3(0, 0, z1 + 8));
  lightPole(kit, -st.upX * (halfW + 1.2), z1 + 3, 6, new Vector3(0, 0, z1 + 8));
  nameBoard(kit, st.signs, st.upX * (halfW + 5), z1 + 5, 1);
}

/** Tram station: a concrete hall with a dock and platform, rope anchorages, waiting room windows. */
function tramTerminal(kit: Kit, st: Station, cabinFloor: number): void {
  const half = st.lift.type.gaugeM / 2;
  const h = st.ropeH;
  const halfW = half + 3;
  const z0 = -8;
  const z1 = 11;
  const top = h + 4.5;
  const mid = (z0 + z1) / 2;
  for (const s of [-1, 1]) kit.rbox(concrete, 0.8, top, z1 - z0, 0.08, s * halfW, top / 2, mid);
  kit.rbox(concrete, halfW * 2 + 0.8, top, 0.8, 0.08, 0, top / 2, z0);
  kit.rbox(concrete, halfW * 2 + 1.6, 0.6, z1 - z0 + 1.6, 0.1, 0, top + 0.3, mid);
  kit.rbox(roofMetal, halfW * 2 + 1.2, 0.2, z1 - z0 + 1.2, 0.05, 0, top + 0.7, mid);
  // Front portal frame; pilasters and a reveal line on the outer walls; an upper storey clad in
  // timber with the lit waiting-room windows; a fascia under the roof edge.
  kit.rbox(darkSteel, halfW * 2 + 0.2, 0.8, 0.6, 0.06, 0, top - 0.4, z1);
  for (const s of [-1, 1]) {
    const x = s * (halfW + 0.42);
    for (let z = z0 + 1; z <= z1; z += (z1 - z0 - 1) / 4)
      kit.rbox(concrete, 0.3, top, 0.7, 0.05, x + s * 0.12, top / 2, z);
    kit.box(darkSteel, 0.06, 0.12, z1 - z0, x, top * 0.45, mid);
    kit.box(cladding, 0.1, top * 0.42, z1 - z0 - 1.2, x, top * 0.76, mid);
    for (let z = z0 + 2.2; z < z1 - 1.5; z += 2.6) {
      kit.box(litWindow, 0.06, 1.4, 1.8, x + s * 0.06, top * 0.76, z + 0.9);
      kit.box(darkSteel, 0.08, 1.5, 0.08, x + s * 0.07, top * 0.76, z - 0.05);
    }
  }
  kit.rbox(darkSteel, halfW * 2 + 1.7, 0.35, z1 - z0 + 1.7, 0.04, 0, top + 0.05, mid);
  // Entrance on the up-line side: canopy, glazed doors, lamp.
  const ex = st.upX * (halfW + 0.45);
  kit.box(litWindow, 0.06, 2.4, 2.4, ex + st.upX * 0.02, 1.2, z0 + 3);
  kit.box(darkSteel, 0.08, 2.5, 0.08, ex + st.upX * 0.04, 1.25, z0 + 3);
  kit.rbox(roofMetal, 1.6, 0.18, 3.4, 0.04, ex + st.upX * 0.8, 2.75, z0 + 3);
  kit.box(lampLens, 0.3, 0.02, 0.3, ex + st.upX * 0.8, 2.65, z0 + 3);
  // Platform between the two cabins at cabin floor height, with stairs.
  if (cabinFloor > 0.4) {
    kit.rbox(concrete, half * 2 - 2.4, cabinFloor, 9, 0.06, 0, cabinFloor / 2, 3);
    for (let k = 0; k < Math.floor(cabinFloor / 0.2); k++)
      kit.box(concrete, 1.6, 0.2 * (k + 1), 0.3, 0, 0.1 * (k + 1), -1.65 - k * 0.3);
    kit.box(safetyYellow, 0.1, 0.03, 9, half - 1.25, cabinFloor + 0.01, 3);
    kit.box(safetyYellow, 0.1, 0.03, 9, -(half - 1.25), cabinFloor + 0.01, 3);
  }
  // Track rope anchors: bollards the track ropes wrap round, behind the hall.
  for (const s of [-1, 1]) {
    for (const o of [-0.45, 0.45]) {
      const x = s * half + o;
      kit.post(concrete, 0.55, 1.6, x, 0.8, z0 - 3);
      kit.rod(rope, 0.03, new Vector3(x, h + 0.4, 0), new Vector3(x, 1.4, z0 - 3));
    }
  }
  bullwheel(kit, half, h);
  addSign(kit, st.signs, 'station', 1.4, new Vector3(0, top - 0.4, z1 + 0.32), new Vector3(0, 0, 1));
  addSign(kit, st.signs, 'brand', 0.7, new Vector3(0, top - 1.2, z0 - 0.42), new Vector3(0, 0, -1));
  lightPole(kit, halfW + 2, z1 + 4, 7, new Vector3(0, 0, z1 + 8));
  lightPole(kit, -halfW - 2, z1 + 4, 7, new Vector3(0, 0, z1 + 8));
  nameBoard(kit, st.signs, st.upX * (halfW + 5), z1 + 6, 1);
}

/** Rope tow: drive shed with its wheel at the bottom, return wheel and let-go sign at the top. */
function towTerminal(kit: Kit, st: Station): void {
  const half = st.lift.type.gaugeM / 2;
  const h = st.ropeH;
  kit.post(darkSteel, 0.13, h + 0.4, 0, (h + 0.4) / 2, -0.2, 0, 0, 12);
  kit.add(
    galvanised,
    new LatheGeometry(
      [new Vector2(half - 0.06, -0.07), new Vector2(half + 0.04, 0), new Vector2(half - 0.06, 0.07)],
      36,
    ),
    0,
    h,
    0,
  );
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    kit.rod(
      galvanised,
      0.025,
      new Vector3(0, h, 0),
      new Vector3(Math.sin(a) * (half - 0.06), h, Math.cos(a) * (half - 0.06)),
    );
  }
  if (st.end === 0) {
    kit.rbox(cladding, 2.0, 2.2, 2.2, 0.05, 0, 1.1, -2.4);
    kit.rbox(roofMetal, 2.5, 0.16, 2.7, 0.04, 0, 2.3, -2.4);
    kit.box(darkSteel, 0.8, 1.8, 0.04, 0.4, 0.95, -1.29);
    kit.box(litWindow, 0.8, 0.6, 0.04, -0.45, 1.5, -1.29);
    nameBoard(kit, st.signs, st.upX * 4, 4, 1);
    kit.box(mat, 1.6, 0.05, 0.9, st.upX * half, 0.03, 1.5);
  } else {
    kit.post(darkSteel, 0.05, 2.4, st.upX * (half + 1.5), 1.2, 1.5);
    addSign(
      kit,
      st.signs,
      'unload',
      0.55,
      new Vector3(st.upX * (half + 1.5), 2.2, 1.55),
      new Vector3(0, 0, 1),
    );
  }
}

export function buildStations(kit: Kit, lift: Lift, snow: Snowpack, signs: MeshStandardNodeMaterial): void {
  const t = lift.type;
  const heading = Math.atan2(lift.dirX, lift.dirZ);
  for (const end of [0, 1] as const) {
    const s = end === 0 ? 0 : lift.lengthM;
    const cx = lift.line.bottom.x + lift.dirX * s;
    const cz = lift.line.bottom.z + lift.dirZ * s;
    const ground = snow.surfaceAt(cx, cz);
    // Local +z points from the station out toward the line: uphill at the bottom, downhill at the top.
    kit.setFrame(frameAt(cx, ground, cz, end === 0 ? heading : heading + Math.PI));
    const st: Station = { lift, end, ropeH: lift.ropeY(s) - ground, upX: end === 0 ? 1 : -1, signs };
    if (t.kind === 'ropeTow') towTerminal(kit, st);
    else if (t.kind === 'chair') chairTerminal(kit, st);
    else if (t.kind === 'gondola') gondolaTerminal(kit, st);
    else tramTerminal(kit, st, lift.ropeY(s) - t.hangerM - 2.8 - ground);
  }
  kit.setFrame(null);
}

/** Materials whose parts are too small to show in the shadow map. */
export const SHADOWLESS: ReadonlySet<Material> = new Set([
  galvanisedFine,
  darkSteelFine,
  rubberLiner,
  fenceBlue,
  lampLens,
  safetyYellow,
  mat,
  litWindow,
  hallGlass,
]);
