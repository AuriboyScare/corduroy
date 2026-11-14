import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import { hash2 } from '../sim/rng';
import type { CarrierPose, Lift } from '../sim/lifts/lift';
import type { Snowpack } from '../sim/snow/snowpack';

const steel = new MeshStandardNodeMaterial({ color: 0x7d858c, roughness: 0.45, metalness: 0.8 });
const darkSteel = new MeshStandardNodeMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 });
const rope = new MeshStandardNodeMaterial({ color: 0x2c2e31, roughness: 0.5, metalness: 0.7 });
const concrete = new MeshStandardNodeMaterial({ color: 0x8f8d88, roughness: 0.92 });
const timber = new MeshStandardNodeMaterial({ color: 0x5a3e2b, roughness: 0.85 });
const roofing = new MeshStandardNodeMaterial({ color: 0x30353a, roughness: 0.55, metalness: 0.5 });
const snowCap = new MeshStandardNodeMaterial({ color: 0xeef3f8, roughness: 0.9 });
const glass = new MeshStandardNodeMaterial({ color: 0x1b2631, roughness: 0.08, metalness: 0.1 });
const seat = new MeshStandardNodeMaterial({ color: 0x1f3c66, roughness: 0.6 });
const gondolaShell = new MeshStandardNodeMaterial({ color: 0xc8231a, roughness: 0.35, metalness: 0.2 });
const tramShell = new MeshStandardNodeMaterial({ color: 0xe9ecef, roughness: 0.35, metalness: 0.3 });
const tramStripe = new MeshStandardNodeMaterial({ color: 0x1f4e8c, roughness: 0.4 });
const jacket = new MeshStandardNodeMaterial({ roughness: 0.7 });
const helmet = new MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
const skiMaterial = new MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.4 });

const JACKETS = [
  0xd33a2c, 0x2f6fd6, 0xf2b630, 0x2fa55a, 0x7b3fb5, 0xe8e8e8, 0x16181b, 0xff7a1a, 0x1aa3a3, 0xb5164f,
];

/** Collects geometry per material and merges it into one mesh per material. */
class Parts {
  private readonly lists = new Map<Material, BufferGeometry[]>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly one = new Vector3(1, 1, 1);
  private readonly p = new Vector3();

  add(
    material: Material,
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
    ry = 0,
    rx = 0,
    rz = 0,
  ): void {
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')), this.one);
    geometry.applyMatrix4(this.m);
    const list = this.lists.get(material);
    if (list) list.push(geometry);
    else this.lists.set(material, [geometry]);
  }

  /** A cylinder between two points. */
  bar(
    material: Material,
    radius: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    sides = 6,
  ): void {
    const d = new Vector3(bx - ax, by - ay, bz - az);
    const length = d.length();
    if (length < 1e-4) return;
    const g = new CylinderGeometry(radius, radius, length, sides);
    g.applyQuaternion(this.q.setFromUnitVectors(new Vector3(0, 1, 0), d.divideScalar(length)));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    const list = this.lists.get(material);
    if (list) list.push(g);
    else this.lists.set(material, [g]);
  }

  build(group: Group): void {
    for (const [material, list] of this.lists) {
      const mesh = new Mesh(mergeGeometries(list), material);
      // Ropes are too thin to show in the shadow map; drawing them there only costs time.
      mesh.castShadow = material !== rope;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/** One carrier's look: parts drawn per carrier, and where riders sit or stand. */
interface CarrierDesign {
  parts: [BufferGeometry, Material][];
  seats: { x: number; y: number; z: number }[];
  pose: 'seated' | 'standing' | 'none';
}

function chairDesign(hanger: number): CarrierDesign {
  const frame = mergeGeometries([
    new BoxGeometry(0.08, hanger, 0.08).translate(0, -hanger / 2, -0.25),
    new BoxGeometry(0.5, 0.08, 0.08).translate(0, 0, -0.25),
    new BoxGeometry(2.3, 0.07, 0.07).translate(0, -hanger + 0.05, -0.25),
    new BoxGeometry(2.2, 0.05, 0.05).translate(0, -hanger - 0.35, 0.45),
  ]);
  const bench = mergeGeometries([
    new BoxGeometry(2.2, 0.1, 0.55).translate(0, -hanger, 0.05),
    new BoxGeometry(2.2, 0.6, 0.08).translate(0, -hanger + 0.33, -0.22).rotateX(0),
  ]);
  const bar = mergeGeometries([
    new BoxGeometry(2.2, 0.04, 0.04).translate(0, -hanger + 0.5, 0.42),
    new BoxGeometry(0.04, 0.5, 0.04).translate(-1.05, -hanger + 0.25, 0.42),
    new BoxGeometry(0.04, 0.5, 0.04).translate(1.05, -hanger + 0.25, 0.42),
  ]);
  const seats = [-0.78, -0.26, 0.26, 0.78].map((x) => ({ x, y: -hanger + 0.05, z: 0.08 }));
  return {
    parts: [
      [frame, darkSteel],
      [bench, seat],
      [bar, steel],
    ],
    seats,
    pose: 'seated',
  };
}

function gondolaDesign(hanger: number): CarrierDesign {
  const h = 2.0;
  const body = new BoxGeometry(1.9, h, 1.9, 2, 3, 2);
  // Round the cabin: pull corners in so it reads as a moulded shell, not a box.
  const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const pull = r > 1.2 ? 1.2 / r : 1;
    pos.setXYZ(i, x * (0.88 + 0.12 * pull), y, z * (0.88 + 0.12 * pull));
  }
  body.computeVertexNormals();
  body.translate(0, -hanger - h / 2 + 0.6, 0);
  const windows = mergeGeometries(
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) =>
      new BoxGeometry(1.5, 0.75, 0.04).translate(0, -hanger + 0.35, 0.92).rotateY(a),
    ),
  );
  const hangerBar = mergeGeometries([
    new BoxGeometry(0.1, hanger - 0.5, 0.1).translate(0, -hanger / 2 + 0.25, 0),
    new BoxGeometry(0.5, 0.12, 0.25).translate(0, 0, 0),
  ]);
  return {
    parts: [
      [body, gondolaShell],
      [windows, glass],
      [hangerBar, darkSteel],
    ],
    seats: [],
    pose: 'none',
  };
}

function tramDesign(hanger: number): CarrierDesign {
  const body = mergeGeometries([new BoxGeometry(3.4, 2.8, 8.5).translate(0, -hanger - 1.4, 0)]);
  const stripe = new BoxGeometry(3.42, 0.25, 8.52).translate(0, -hanger - 2.3, 0);
  const windows = mergeGeometries([
    new BoxGeometry(3.44, 1.1, 7.6).translate(0, -hanger - 0.9, 0),
    new BoxGeometry(3.0, 1.1, 8.56).translate(0, -hanger - 0.9, 0),
  ]);
  const carriage = mergeGeometries([
    new BoxGeometry(0.25, hanger, 0.25).translate(0, -hanger / 2, 0),
    new BoxGeometry(1.2, 0.5, 5).translate(0, 0, 0),
    ...[-1.8, -0.6, 0.6, 1.8].flatMap((z) =>
      [-0.55, 0.55].map((x) =>
        new CylinderGeometry(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2).translate(x, 0.25, z),
      ),
    ),
    new BoxGeometry(2.2, 0.2, 0.3).translate(0, -hanger + 0.1, 0),
  ]);
  return {
    parts: [
      [body, tramShell],
      [stripe, tramStripe],
      [windows, glass],
      [carriage, darkSteel],
    ],
    seats: [],
    pose: 'none',
  };
}

function towDesign(hanger: number): CarrierDesign {
  const handle = mergeGeometries([
    new CylinderGeometry(0.012, 0.012, hanger, 5).translate(0, -hanger / 2, 0),
    new CylinderGeometry(0.02, 0.02, 0.25, 6).rotateZ(Math.PI / 2).translate(0, -hanger, 0),
  ]);
  return { parts: [[handle, darkSteel]], seats: [{ x: 0.5, y: 0, z: 0 }], pose: 'standing' };
}

/** Rider meshes: jacket and legs, helmet, skis. Origin at the seat (seated) or the feet (standing). */
function riderParts(pose: 'seated' | 'standing'): [BufferGeometry, Material][] {
  if (pose === 'seated') {
    const body = mergeGeometries([
      new CylinderGeometry(0.17, 0.2, 0.6, 8).translate(0, 0.33, -0.05),
      new CylinderGeometry(0.075, 0.08, 0.45, 6).rotateX(Math.PI / 2).translate(-0.1, 0.06, 0.2),
      new CylinderGeometry(0.075, 0.08, 0.45, 6).rotateX(Math.PI / 2).translate(0.1, 0.06, 0.2),
      new CylinderGeometry(0.07, 0.07, 0.45, 6).translate(-0.1, -0.2, 0.43),
      new CylinderGeometry(0.07, 0.07, 0.45, 6).translate(0.1, -0.2, 0.43),
    ]);
    const head = new SphereGeometry(0.13, 10, 8).translate(0, 0.76, -0.04);
    const skis = mergeGeometries([
      new BoxGeometry(0.08, 0.02, 1.6).translate(-0.11, -0.45, 0.6),
      new BoxGeometry(0.08, 0.02, 1.6).translate(0.11, -0.45, 0.6),
    ]);
    return [
      [body, jacket],
      [head, helmet],
      [skis, skiMaterial],
    ];
  }
  const body = mergeGeometries([
    new CylinderGeometry(0.17, 0.19, 0.65, 8).translate(0, 1.15, 0).rotateX(0.18),
    new CylinderGeometry(0.08, 0.075, 0.82, 6).translate(-0.1, 0.42, 0),
    new CylinderGeometry(0.08, 0.075, 0.82, 6).translate(0.1, 0.42, 0),
  ]);
  const head = new SphereGeometry(0.13, 10, 8).translate(0, 1.62, 0.1);
  const skis = mergeGeometries([
    new BoxGeometry(0.08, 0.02, 1.65).translate(-0.12, 0.01, 0.25),
    new BoxGeometry(0.08, 0.02, 1.65).translate(0.12, 0.01, 0.25),
  ]);
  return [
    [body, jacket],
    [head, helmet],
    [skis, skiMaterial],
  ];
}

/** Draws one built lift: towers, ropes, terminals, and its moving carriers and riders. */
export class LiftView {
  readonly group = new Group();
  private readonly carriers: InstancedMesh[] = [];
  private readonly riders: InstancedMesh[] = [];
  private readonly design: CarrierDesign;
  private readonly pose: CarrierPose = { x: 0, y: 0, z: 0, heading: 0, up: true, swing: 0, trip: 0 };
  private readonly matrix = new Matrix4();
  private readonly seatMatrix = new Matrix4();
  private readonly riderMatrix = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly at = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly tint = new Color();

  constructor(
    readonly lift: Lift,
    private readonly snow: Snowpack,
  ) {
    const t = lift.type;
    this.design =
      t.kind === 'chair'
        ? chairDesign(t.hangerM)
        : t.kind === 'gondola'
          ? gondolaDesign(t.hangerM)
          : t.kind === 'tram'
            ? tramDesign(t.hangerM)
            : towDesign(t.hangerM);
    this.buildStatic(snow);
    const count = lift.carrierCount;
    for (const [geometry, material] of this.design.parts) {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.carriers.push(mesh);
      this.group.add(mesh);
    }
    if (this.design.pose !== 'none') {
      const seats = count * this.design.seats.length;
      for (const [geometry, material] of riderParts(this.design.pose)) {
        const mesh = new InstancedMesh(geometry, material, seats);
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.riders.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Towers, ropes and terminals: built once. */
  private buildStatic(snow: Snowpack): void {
    const lift = this.lift;
    const t = lift.type;
    const parts = new Parts();
    const heading = Math.atan2(lift.dirX, lift.dirZ);
    const half = t.gaugeM / 2;
    // Lateral unit vector toward the up line.
    const lx = lift.dirZ;
    const lz = -lift.dirX;

    const towers = lift.towers;
    for (let k = 1; k < towers.length - 1; k++) {
      const tower = towers[k]!;
      const height = tower.topY - tower.groundY;
      if (t.kind === 'ropeTow') {
        parts.add(
          darkSteel,
          new CylinderGeometry(0.05, 0.06, height + 0.6, 6),
          tower.x,
          tower.groundY + (height + 0.6) / 2 - 0.4,
          tower.z,
        );
        parts.add(
          darkSteel,
          new BoxGeometry(t.gaugeM + 0.4, 0.08, 0.08),
          tower.x,
          tower.topY + 0.15,
          tower.z,
          heading,
        );
        for (const side of [-1, 1]) {
          parts.add(
            steel,
            new TorusGeometry(0.1, 0.025, 6, 12),
            tower.x + lx * side * half,
            tower.topY + 0.05,
            tower.z + lz * side * half,
            heading + Math.PI / 2,
          );
        }
        continue;
      }
      if (t.kind === 'tram') {
        // Lattice tower: four tapering legs with cross bracing.
        const base = 3.2 + height * 0.06;
        const topW = 2.2;
        const legs: [number, number][] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        const at = (sx: number, sz: number, y: number, w: number) => {
          const ox = (sx * w * Math.cos(heading) + sz * w * Math.sin(heading)) / 2;
          const oz = (-sx * w * Math.sin(heading) + sz * w * Math.cos(heading)) / 2;
          return [tower.x + ox, tower.groundY + y, tower.z + oz] as const;
        };
        const levels = Math.max(3, Math.round(height / 7));
        for (let l = 0; l < levels; l++) {
          const y0 = (height * l) / levels;
          const y1 = (height * (l + 1)) / levels;
          const w0 = base + (topW - base) * (l / levels);
          const w1 = base + (topW - base) * ((l + 1) / levels);
          for (let g = 0; g < 4; g++) {
            const [sx, sz] = legs[g]!;
            const [nx, nz] = legs[(g + 1) % 4]!;
            parts.bar(steel, 0.12, ...at(sx, sz, y0, w0), ...at(sx, sz, y1, w1));
            parts.bar(steel, 0.05, ...at(sx, sz, y0, w0), ...at(nx, nz, y1, w1));
            parts.bar(steel, 0.05, ...at(sx, sz, y1, w1), ...at(nx, nz, y1, w1));
          }
        }
        parts.add(
          darkSteel,
          new BoxGeometry(t.gaugeM + 3, 1.2, 2.4),
          tower.x,
          tower.topY - 0.3,
          tower.z,
          heading,
        );
        parts.add(
          concrete,
          new BoxGeometry(base + 1.5, 1.2, base + 1.5),
          tower.x,
          tower.groundY + 0.1,
          tower.z,
          heading,
        );
        continue;
      }
      // Chair and gondola: tapered tube, crossarm, sheave trains, ladder, footing.
      const tubeTop = tower.topY + 0.6;
      parts.add(
        steel,
        new CylinderGeometry(0.28, 0.42, tubeTop - tower.groundY + 0.5, 12),
        tower.x,
        (tubeTop + tower.groundY - 0.5) / 2,
        tower.z,
      );
      parts.add(
        steel,
        new BoxGeometry(t.gaugeM + 1.4, 0.35, 0.35),
        tower.x,
        tubeTop,
        tower.z,
        heading + Math.PI / 2,
      );
      for (const side of [-1, 1]) {
        const sx = tower.x + lx * side * half;
        const sz = tower.z + lz * side * half;
        parts.add(darkSteel, new BoxGeometry(0.22, 0.32, 2.6), sx, tower.topY + 0.1, sz, heading);
        for (let w = 0; w < 4; w++) {
          const along = -0.95 + w * 0.63;
          parts.add(
            steel,
            new CylinderGeometry(0.17, 0.17, 0.1, 12),
            sx + lift.dirX * along,
            tower.topY - 0.05,
            sz + lift.dirZ * along,
            heading,
            0,
            Math.PI / 2,
          );
        }
        parts.add(darkSteel, new BoxGeometry(0.06, 0.6, 0.06), sx, tower.topY + 0.45, sz);
      }
      // Ladder up the downhill face, and a work platform under the crossarm.
      const ladderX = tower.x - lift.dirX * 0.45;
      const ladderZ = tower.z - lift.dirZ * 0.45;
      parts.add(
        darkSteel,
        new BoxGeometry(0.04, height + 0.3, 0.04),
        ladderX + lx * 0.2,
        tower.groundY + height / 2,
        ladderZ + lz * 0.2,
      );
      parts.add(
        darkSteel,
        new BoxGeometry(0.04, height + 0.3, 0.04),
        ladderX - lx * 0.2,
        tower.groundY + height / 2,
        ladderZ - lz * 0.2,
      );
      parts.add(
        darkSteel,
        new BoxGeometry(t.gaugeM + 1.2, 0.05, 0.8),
        tower.x - lift.dirX * 0.35,
        tubeTop - 0.4,
        tower.z - lift.dirZ * 0.35,
        heading + Math.PI / 2,
      );
      parts.add(concrete, new BoxGeometry(1.6, 0.8, 1.6), tower.x, tower.groundY + 0.05, tower.z, heading);
    }

    // Ropes: up and down lines between all supports, sagging, plus the tram's track ropes.
    const step = t.kind === 'ropeTow' ? 3 : 6;
    for (const side of [-1, 1]) {
      const tracks = t.kind === 'tram' ? [-0.45, 0.45] : [0];
      for (const offset of tracks) {
        let px = 0;
        let py = 0;
        let pz = 0;
        for (let s = 0; s <= lift.lengthM + 0.01; s += step) {
          const ss = Math.min(s, lift.lengthM);
          const x = lift.line.bottom.x + lift.dirX * ss + lx * (side * half + offset);
          const z = lift.line.bottom.z + lift.dirZ * ss + lz * (side * half + offset);
          const y = lift.ropeY(ss) + (t.kind === 'tram' ? 0.4 : 0);
          if (s > 0) parts.bar(rope, t.kind === 'tram' ? 0.03 : 0.022, px, py, pz, x, y, z, 5);
          px = x;
          py = y;
          pz = z;
        }
      }
    }

    // Terminals at both ends.
    for (const end of [0, 1] as const) {
      const s = end === 0 ? 0 : lift.lengthM;
      const cx = lift.line.bottom.x + lift.dirX * s;
      const cz = lift.line.bottom.z + lift.dirZ * s;
      const ground = snow.surfaceAt(cx, cz);
      const ropeY = lift.ropeY(s);
      // The terminal extends back from the line end: downhill at the bottom, uphill at the top.
      const back = end === 0 ? -1 : 1;
      const bx = cx + lift.dirX * back * 3;
      const bz = cz + lift.dirZ * back * 3;
      if (t.kind === 'ropeTow') {
        parts.add(
          darkSteel,
          new CylinderGeometry(0.12, 0.15, ropeY - ground + 0.6, 8),
          cx,
          (ropeY + ground) / 2,
          cz,
        );
        parts.add(steel, new CylinderGeometry(half + 0.1, half + 0.1, 0.12, 20), cx, ropeY, cz);
        if (end === 0) parts.add(roofing, new BoxGeometry(1.6, 1.4, 1.2), bx, ground + 0.6, bz, heading);
        continue;
      }
      // Bullwheel at rope height.
      parts.add(steel, new CylinderGeometry(half + 0.2, half + 0.2, 0.3, 32, 1, true), cx, ropeY, cz);
      parts.add(darkSteel, new CylinderGeometry(0.5, 0.5, 0.6, 12), cx, ropeY, cz);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        parts.bar(darkSteel, 0.06, cx, ropeY, cz, cx + Math.sin(a) * half, ropeY, cz + Math.cos(a) * half);
      }
      const length = Math.max(t.stationLengthM, 10) + t.gaugeM;
      const width = t.gaugeM + 4;
      const roofY = ropeY + (t.kind === 'tram' ? 4 : 2.4);
      const mid = end === 0 ? length / 2 - t.gaugeM : -(length / 2 - t.gaugeM);
      const sx = cx + lift.dirX * mid;
      const sz = cz + lift.dirZ * mid;
      // Columns from the ground to the roof at the four corners.
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const ox = (lift.dirX * (a * length)) / 2 + (lx * (b * width)) / 2;
        const oz = (lift.dirZ * (a * length)) / 2 + (lz * (b * width)) / 2;
        const colMaterial = t.kind === 'tram' ? concrete : steel;
        const r = t.kind === 'tram' ? 0.6 : 0.18;
        parts.add(colMaterial, new BoxGeometry(r, roofY - ground, r), sx + ox, (roofY + ground) / 2, sz + oz);
      }
      parts.add(roofing, new BoxGeometry(width + 1.2, 0.35, length + 1.2), sx, roofY + 0.2, sz, heading);
      parts.add(snowCap, new BoxGeometry(width + 1.0, 0.3, length + 1.0), sx, roofY + 0.5, sz, heading);
      if (t.kind === 'gondola' || t.kind === 'tram') {
        // Enclosed sides with a glazed band.
        for (const b of [-1, 1]) {
          parts.add(
            t.kind === 'tram' ? concrete : timber,
            new BoxGeometry(0.3, roofY - ground - 2.5, length),
            sx + (lx * b * width) / 2,
            ground + (roofY - ground - 2.5) / 2,
            sz + (lz * b * width) / 2,
            heading,
          );
          parts.add(
            glass,
            new BoxGeometry(0.1, 1.6, length * 0.9),
            sx + (lx * b * (width + 0.25)) / 2,
            roofY - 1.4,
            sz + (lz * b * (width + 0.25)) / 2,
            heading,
          );
        }
      }
      if (t.kind === 'tram') {
        // Raised platform the cabin docks against.
        parts.add(
          concrete,
          new BoxGeometry(width - 1, ropeY - t.hangerM - 2.8 - ground, length * 0.9),
          sx,
          (ropeY - t.hangerM - 2.8 + ground) / 2,
          sz,
          heading,
        );
      }
      // Operator hut beside the loading area.
      const hx = cx - lift.dirX * back * 4 + lx * (width / 2 + 2.2);
      const hz = cz - lift.dirZ * back * 4 + lz * (width / 2 + 2.2);
      parts.add(timber, new BoxGeometry(2.4, 2.5, 2.4), hx, ground + 1.15, hz, heading);
      parts.add(glass, new BoxGeometry(2.45, 1.0, 2.0), hx, ground + 1.7, hz, heading);
      parts.add(roofing, new BoxGeometry(2.9, 0.2, 2.9), hx, ground + 2.5, hz, heading);
      parts.add(snowCap, new BoxGeometry(2.7, 0.2, 2.7), hx, ground + 2.68, hz, heading);
    }
    parts.build(this.group);
  }

  /** Moves the carriers and seats riders according to how busy the lift is. */
  update(use: number): void {
    const lift = this.lift;
    const design = this.design;
    const pose = this.pose;
    let riderCount = 0;
    for (let i = 0; i < lift.carrierCount; i++) {
      lift.carrierPose(i, pose);
      this.at.set(pose.x, pose.y + lift.type.hangerM, pose.z);
      // Hang from the grip, swinging about the rope.
      this.q.setFromEuler(this.e.set(pose.swing, pose.heading, 0, 'YXZ'));
      this.matrix.compose(this.at, this.q, this.one);
      for (const mesh of this.carriers) mesh.setMatrixAt(i, this.matrix);

      if (design.pose === 'none' || !pose.up) continue;
      // Riders on the way up: each seat is taken with a chance set by how busy the lift is,
      // drawn afresh for every trip.
      for (let s = 0; s < design.seats.length; s++) {
        if (hash2(i * 7 + s, pose.trip, lift.towers.length) > use) continue;
        const seatPos = design.seats[s]!;
        if (design.pose === 'standing') {
          // Tow riders stand on the snow beside the rope, holding the handle.
          this.riderMatrix.compose(
            this.at.set(pose.x, this.snow.surfaceAt(pose.x, pose.z), pose.z),
            this.q.setFromEuler(this.e.set(0, pose.heading, 0)),
            this.one,
          );
          this.seatMatrix.makeTranslation(seatPos.x, 0, -0.2);
          this.riderMatrix.multiply(this.seatMatrix);
        } else {
          this.seatMatrix.makeTranslation(seatPos.x, seatPos.y, seatPos.z);
          this.riderMatrix.multiplyMatrices(this.matrix, this.seatMatrix);
        }
        const look = Math.floor(hash2(i, s * 31 + pose.trip, 5) * JACKETS.length);
        for (let r = 0; r < this.riders.length; r++) {
          this.riders[r]!.setMatrixAt(riderCount, this.riderMatrix);
          if (r === 0) this.riders[r]!.setColorAt(riderCount, this.tint.setHex(JACKETS[look]!));
          if (r === 1)
            this.riders[r]!.setColorAt(
              riderCount,
              this.tint.setHex(JACKETS[(look * 7 + 3) % JACKETS.length]!),
            );
        }
        riderCount++;
      }
    }
    for (const mesh of this.carriers) mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of this.riders) {
      mesh.count = riderCount;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** Views for every built lift, created as lifts are bought. */
export class LiftsView {
  readonly group = new Group();
  private readonly views = new Map<string, LiftView>();

  constructor(private readonly snow: Snowpack) {}

  update(lifts: readonly Lift[], built: ReadonlySet<string>, use: (lift: Lift) => number): void {
    for (const lift of lifts) {
      if (!built.has(lift.line.id)) continue;
      let view = this.views.get(lift.line.id);
      if (!view) {
        view = new LiftView(lift, this.snow);
        this.views.set(lift.line.id, view);
        this.group.add(view.group);
      }
      view.update(use(lift));
    }
  }
}
