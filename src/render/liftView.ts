import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import { hash2 } from '../sim/rng';
import type { CarrierPose, Lift } from '../sim/lifts/lift';
import type { Snowpack } from '../sim/snow/snowpack';
import { chairDesign, gondolaDesign, towDesign, tramDesign, type CarrierDesign } from './lifts/carriers';
import { signMaterial } from './lifts/signs';
import { barLowered } from './lifts/safetyBar';
import { buildRopes, buildStations, buildTowers, SHADOWLESS } from './lifts/structures';
import { Kit } from './machines/kit';

const jacket = new MeshStandardNodeMaterial({ roughness: 0.7 });
const helmet = new MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
const skiMaterial = new MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.4 });

const JACKETS = [
  0xd33a2c, 0x2f6fd6, 0xf2b630, 0x2fa55a, 0x7b3fb5, 0xe8e8e8, 0x16181b, 0xff7a1a, 0x1aa3a3, 0xb5164f,
];

/** Raised bar angle about the hinge, radians. */
const BAR_UP = -1.65;
/** Carriers beyond this distance from the camera are drawn as plain stand-ins, m. */
const NEAR_M = 90;
/** Riders beyond this distance are a few pixels and are not drawn, m. */
const RIDERS_M = 220;

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
  private readonly far: InstancedMesh[] = [];
  private readonly bars: InstancedMesh[] = [];
  private readonly riders: InstancedMesh[] = [];
  private readonly design: CarrierDesign;
  private readonly pose: CarrierPose = { x: 0, y: 0, z: 0, heading: 0, up: true, swing: 0, trip: 0 };
  private readonly matrix = new Matrix4();
  private readonly seatMatrix = new Matrix4();
  private readonly riderMatrix = new Matrix4();
  private readonly barMatrix = new Matrix4();
  private readonly hingeMatrix = new Matrix4();
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
    const signs = signMaterial(lift.line.name, t.label);
    this.design =
      t.kind === 'chair'
        ? chairDesign(t.hangerM)
        : t.kind === 'gondola'
          ? gondolaDesign(t.hangerM, signs)
          : t.kind === 'tram'
            ? tramDesign(t.hangerM, signs)
            : towDesign(t.hangerM);
    const structure = new Kit();
    buildTowers(structure, lift, signs);
    buildStations(structure, lift, snow, signs);
    structure.build(this.group, true, true, new Set([...SHADOWLESS, signs]));
    // Ropes are too thin to show in the shadow map; drawing them there only costs time.
    const ropes = new Kit();
    buildRopes(ropes, lift);
    ropes.build(this.group, false);

    const count = lift.carrierCount;
    const instance = (geometry: BufferGeometry, material: Material, n: number, shadow: boolean) => {
      const mesh = new InstancedMesh(geometry, material, n);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    for (const [geometry, material] of this.design.parts)
      this.carriers.push(instance(geometry, material, count, true));
    for (const [geometry, material] of this.design.far)
      this.far.push(instance(geometry, material, count, false));
    for (const [geometry, material] of this.design.bar?.parts ?? [])
      this.bars.push(instance(geometry, material, count, true));
    if (this.design.pose !== 'none') {
      const seats = count * this.design.seats.length;
      for (const [geometry, material] of riderParts(this.design.pose)) {
        const mesh = instance(geometry, material, seats, false);
        mesh.count = 0;
        this.riders.push(mesh);
      }
    }
  }

  /** How far a chair's bar is lowered, 0 (up) to 1 (down), from where it is on the line. */
  private barDown(pose: CarrierPose): number {
    const lift = this.lift;
    const s = (pose.x - lift.line.bottom.x) * lift.dirX + (pose.z - lift.line.bottom.z) * lift.dirZ;
    return barLowered(s, lift.lengthM, pose.up);
  }

  /** Carriers drawn in detail and as plain stand-ins last frame, for tests. */
  drawn = { near: 0, far: 0 };

  /** Moves the carriers and seats riders according to how busy the lift is. */
  update(use: number, camera: Vector3): void {
    let near = 0;
    let far = 0;
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
      const distant = this.far.length > 0 && camera.distanceTo(this.at) > NEAR_M;
      if (distant) {
        for (const mesh of this.far) mesh.setMatrixAt(far, this.matrix);
        far++;
      } else {
        for (const mesh of this.carriers) mesh.setMatrixAt(near, this.matrix);
      }
      if (!distant && this.bars.length > 0) {
        const hinge = design.bar!.hinge;
        this.hingeMatrix.makeRotationX(BAR_UP * (1 - this.barDown(pose)));
        this.hingeMatrix.setPosition(hinge);
        this.barMatrix.multiplyMatrices(this.matrix, this.hingeMatrix);
        for (const mesh of this.bars) mesh.setMatrixAt(near, this.barMatrix);
      }
      if (!distant) near++;

      if (design.pose === 'none' || !pose.up || camera.distanceTo(this.at) > RIDERS_M) continue;
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
    for (const mesh of [...this.carriers, ...this.bars]) {
      mesh.count = near;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of this.far) {
      mesh.count = far;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.drawn = { near, far };
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

  /** How a built lift's carriers were drawn last frame, for tests. */
  drawn(id: string): { near: number; far: number } | null {
    return this.views.get(id)?.drawn ?? null;
  }

  update(
    lifts: readonly Lift[],
    built: ReadonlySet<string>,
    use: (lift: Lift) => number,
    camera: Vector3,
  ): void {
    for (const lift of lifts) {
      if (!built.has(lift.line.id)) continue;
      let view = this.views.get(lift.line.id);
      if (!view) {
        view = new LiftView(lift, this.snow);
        this.views.set(lift.line.id, view);
        this.group.add(view.group);
      }
      view.update(use(lift), camera);
    }
  }
}
