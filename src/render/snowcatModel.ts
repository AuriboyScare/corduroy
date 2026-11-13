import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three/webgpu';
import type { Snowcat } from '../sim/vehicles/snowcat';

/**
 * Procedural model of the Kestrel groomers (original, fictional machines). Built at the size of
 * the Kestrel 420 and scaled; blade and tiller widths come from the machine's specification.
 * Model frame matches the simulation body: +x left, +y up, +z forward, origin at the centre of mass.
 */

export interface SnowcatLook {
  /** Model name, e.g. "Kestrel 420"; the first word is painted on as the maker's name. */
  readonly name: string;
  readonly paint: number;
  /** Size relative to the Kestrel 420. */
  readonly scale: number;
  readonly bladeHalfWidthM: number;
  readonly tillerHalfWidthM: number;
  readonly winch: boolean;
}

const dark = new MeshStandardNodeMaterial({ color: 0x1a1c20, roughness: 0.62, metalness: 0.2 });
const steel = new MeshStandardNodeMaterial({ color: 0x8d949c, roughness: 0.38, metalness: 0.85 });
const chrome = new MeshStandardNodeMaterial({ color: 0xcfd4d8, roughness: 0.18, metalness: 1 });
const rubber = new MeshStandardNodeMaterial({
  color: 0x101112,
  roughness: 0.92,
  metalness: 0,
  side: DoubleSide,
});
const interior = new MeshStandardNodeMaterial({ color: 0x3a3e45, roughness: 0.8, metalness: 0 });
const white = new MeshStandardNodeMaterial({ color: 0xe6e9ec, roughness: 0.5, metalness: 0.05 });
const glass = new MeshStandardNodeMaterial({
  color: 0x16222c,
  roughness: 0.06,
  metalness: 0,
  transparent: true,
  opacity: 0.42,
  side: DoubleSide,
});
const lamp = new MeshStandardNodeMaterial({
  color: 0xffffff,
  emissive: 0xfff3d6,
  emissiveIntensity: 1.6,
  roughness: 0.3,
});
const amber = new MeshStandardNodeMaterial({
  color: 0xff9a1a,
  emissive: 0xff7a00,
  emissiveIntensity: 1.2,
  roughness: 0.3,
});

/** Collects geometry per material and merges it, so the static hull is a handful of draw calls. */
class Kit {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  private readonly matrix = new Matrix4();
  private readonly euler = new Euler();
  private readonly quaternion = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);

  add(
    material: Material,
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    this.matrix.compose(
      new Vector3(x, y, z),
      this.quaternion.setFromEuler(this.euler.set(rx, ry, rz)),
      this.one,
    );
    geometry.applyMatrix4(this.matrix);
    const list = this.parts.get(material);
    if (list) list.push(geometry);
    else this.parts.set(material, [geometry]);
  }

  box(
    material: Material,
    w: number,
    h: number,
    l: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    this.add(material, new BoxGeometry(w, h, l), x, y, z, rx, ry, rz);
  }

  /** Cylinder with its axis along x. */
  drum(
    material: Material,
    radius: number,
    width: number,
    x: number,
    y: number,
    z: number,
    segments = 20,
  ): void {
    this.add(material, new CylinderGeometry(radius, radius, width, segments), x, y, z, 0, 0, Math.PI / 2);
  }

  /** Cylinder with its axis along y. */
  post(
    material: Material,
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    rz = 0,
  ): void {
    this.add(material, new CylinderGeometry(radius, radius, height, 10), x, y, z, rx, 0, rz);
  }

  build(parent: Group, castShadow = true): Map<Material, Mesh> {
    const meshes = new Map<Material, Mesh>();
    for (const [material, list] of this.parts) {
      const mesh = new Mesh(mergeGeometries(list), material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.set(material, mesh);
    }
    return meshes;
  }
}

/**
 * Sweeps a side profile of (y, z) points across the machine. Each pair of stations is its own
 * span with its own vertices, so the surface creases where the sweep changes direction.
 */
function sweep(
  profile: readonly (readonly [number, number])[],
  stations: readonly { x: number; dz: number }[],
): BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  const m = profile.length;
  for (let s = 0; s < stations.length - 1; s++) {
    const start = position.length / 3;
    for (const station of [stations[s]!, stations[s + 1]!]) {
      for (const [y, z] of profile) position.push(station.x, y, z + station.dz);
    }
    for (let k = 0; k < m - 1; k++) {
      const a = start + k;
      const b = start + m + k;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array((position.length / 3) * 2), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const TRACK_X = 1.45;
const TRACK_W = 1.4;
const TRACK_BOTTOM = -1.0;
const CLEAT_SPACING = 0.16;
const WHEEL_Z = [-1.9, -0.95, 0, 0.95, 1.9] as const;
const WHEEL_R = 0.3;
const IDLER = { z: 2.32, y: -0.6, r: 0.36 };
const SPROCKET = { z: -2.36, y: -0.58, r: 0.38 };
const BLADE_PIVOT = new Vector3(0, -0.5, 2.3);
const TILLER_PIVOT = new Vector3(0, -0.45, -2.5);

/** Closed path of the track belt in the side (y, z) plane, sampled densely. */
function trackPath(): { y: Float32Array; z: Float32Array; s: Float32Array; length: number } {
  const ys: number[] = [];
  const zs: number[] = [];
  const pad = 0.03;
  const bottom = TRACK_BOTTOM + pad;
  const arc = (cz: number, cy: number, r: number, from: number, to: number): void => {
    const steps = Math.max(4, Math.round((Math.abs(to - from) * r) / 0.04));
    for (let k = 1; k <= steps; k++) {
      const a = from + ((to - from) * k) / steps;
      zs.push(cz + Math.cos(a) * r);
      ys.push(cy + Math.sin(a) * r);
    }
  };
  // Bottom run, front to rear is not needed: go rear to front along the ground.
  for (let z = WHEEL_Z[0] - 0.2; z <= WHEEL_Z[4] + 0.2; z += 0.04) {
    zs.push(z);
    ys.push(bottom);
  }
  // Up around the front idler.
  const frontTangent = Math.atan2(IDLER.y - IDLER.r - bottom, IDLER.z - (WHEEL_Z[4] + 0.2));
  arc(IDLER.z, IDLER.y, IDLER.r + pad, -Math.PI / 2 + frontTangent, Math.PI / 2);
  // Top run back to the drive sprocket, with a little belt sag.
  const topFront = IDLER.y + IDLER.r + pad;
  const topRear = SPROCKET.y + SPROCKET.r + pad;
  for (let k = 1; k < 110; k++) {
    const t = k / 110;
    zs.push(IDLER.z + (SPROCKET.z - IDLER.z) * t);
    ys.push(topFront + (topRear - topFront) * t - Math.sin(t * Math.PI) * 0.035);
  }
  // Down around the sprocket and back onto the ground.
  const rearTangent = Math.atan2(SPROCKET.y - SPROCKET.r - bottom, WHEEL_Z[0] - 0.2 - SPROCKET.z);
  arc(SPROCKET.z, SPROCKET.y, SPROCKET.r + pad, Math.PI / 2, (3 * Math.PI) / 2 - rearTangent);

  const n = ys.length;
  const s = new Float32Array(n + 1);
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n;
    s[k + 1] = s[k]! + Math.hypot(ys[m]! - ys[k]!, zs[m]! - zs[k]!);
  }
  return { y: Float32Array.from(ys), z: Float32Array.from(zs), s, length: s[n]! };
}

/** Rubber belts: four bands running the full loop of one track. */
function beltGeometry(path: ReturnType<typeof trackPath>): BufferGeometry {
  const n = path.y.length;
  const bands = 4;
  const bandWidth = 0.27;
  const position: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < bands; b++) {
    const x0 = -TRACK_W / 2 + (b * (TRACK_W - bandWidth)) / (bands - 1);
    const startIndex = position.length / 3;
    for (let k = 0; k < n; k++) {
      position.push(x0, path.y[k]!, path.z[k]!, x0 + bandWidth, path.y[k]!, path.z[k]!);
    }
    for (let k = 0; k < n; k++) {
      const a = startIndex + k * 2;
      const c = startIndex + ((k + 1) % n) * 2;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** A wheel with hub bolts so its rotation is visible. Axis along x. */
function wheelGeometry(
  radius: number,
  width: number,
  toothed: boolean,
): { tyre: BufferGeometry; hub: BufferGeometry } {
  const tyre = new CylinderGeometry(radius, radius, width, toothed ? 12 : 22).rotateZ(Math.PI / 2);
  const parts: BufferGeometry[] = [
    new CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.04, 16).rotateZ(Math.PI / 2),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (const side of [-1, 1]) {
      parts.push(
        new BoxGeometry(0.03, 0.05, 0.05).translate(
          side * (width / 2 + 0.03),
          Math.cos(a) * radius * 0.36,
          Math.sin(a) * radius * 0.36,
        ),
      );
    }
  }
  return { tyre, hub: mergeGeometries(parts) };
}

function logoTexture(name: string): CanvasTexture {
  const [maker = '', model = ''] = name.split(' ');
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = '#f2f4f6';
  ctx.font = 'italic 800 76px "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(maker.toUpperCase(), 14, 60);
  ctx.font = '600 30px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = '#ffd9a0';
  ctx.fillText(model, 408, 86);
  ctx.fillRect(14, 104, 380, 6);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A bar that is re-aimed between two points every frame (lift arms, hydraulic rams). */
class Link {
  private static readonly up = new Vector3(0, 1, 0);
  private static readonly direction = new Vector3();
  constructor(
    readonly mesh: Mesh,
    private readonly restLength: number,
  ) {}

  aim(from: Vector3, to: Vector3, stretch: boolean): void {
    const direction = Link.direction.subVectors(to, from);
    const length = direction.length();
    this.mesh.position
      .copy(from)
      .addScaledVector(direction, stretch ? 0.5 : (this.restLength * 0.5) / length);
    this.mesh.quaternion.setFromUnitVectors(Link.up, direction.divideScalar(length));
    if (stretch) this.mesh.scale.set(1, length / this.restLength, 1);
  }
}

export class SnowcatModel {
  /** Posed from the simulation each frame. */
  readonly group = new Group();
  /** Everything else, scaled to the machine's size. */
  private readonly inner = new Group();
  private readonly paint: Material;
  private readonly paintTwoSided: Material;
  private readonly bladeHalf: number;
  private readonly tillerHalf: number;
  private readonly winchBoom = new Group();
  private readonly blade = new Group();
  private readonly tiller = new Group();
  private readonly wheels: { mesh: Group; radius: number; side: number }[] = [];
  private readonly cleats: InstancedMesh[] = [];
  private readonly path = trackPath();
  private readonly cleatCount: number;
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly position = new Vector3();
  private readonly unit = new Vector3(1, 1, 1);
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly links: { link: Link; from: Vector3; to: Vector3; stretch: boolean; onBlade: boolean }[] =
    [];
  private readonly scratchA = new Vector3();
  private readonly scratchB = new Vector3();
  private glassMesh: Mesh | undefined;

  constructor(private readonly look: SnowcatLook) {
    this.paint = new MeshStandardNodeMaterial({ color: look.paint, roughness: 0.42, metalness: 0.15 });
    this.paintTwoSided = new MeshStandardNodeMaterial({
      color: look.paint,
      roughness: 0.5,
      metalness: 0.15,
      side: DoubleSide,
    });
    // Implement widths are given in metres; the model is drawn before scaling.
    this.bladeHalf = look.bladeHalfWidthM / look.scale;
    this.tillerHalf = look.tillerHalfWidthM / look.scale;
    this.inner.scale.setScalar(look.scale);
    this.group.add(this.inner);
    this.buildHull();
    if (look.winch) this.buildWinch();
    this.buildTracks();
    this.buildBlade();
    this.buildTiller();
    this.cleatCount = Math.floor(this.path.length / CLEAT_SPACING);
  }

  /** Winch tower on the engine deck: frame, cable drum, and a boom that swings toward the anchor. */
  private buildWinch(): void {
    const kit = new Kit();
    for (const side of [-1, 1]) {
      kit.box(dark, 0.12, 1.1, 0.12, side * 0.62, 1.15, -1.0, 0.18);
      kit.box(dark, 0.12, 1.1, 0.12, side * 0.62, 1.15, -2.1, -0.18);
      kit.box(this.paint, 0.06, 0.62, 0.62, side * 0.52, 1.02, -1.55);
    }
    kit.box(dark, 1.36, 0.12, 1.4, 0, 1.68, -1.55);
    kit.drum(steel, 0.32, 0.96, 0, 1.02, -1.55, 22);
    kit.drum(dark, 0.36, 0.04, 0.48, 1.02, -1.55, 22);
    kit.drum(dark, 0.36, 0.04, -0.48, 1.02, -1.55, 22);
    kit.build(this.inner);

    // Boom: pivots on top of the tower, carries the fairlead sheave the cable leaves from.
    const boom = new Kit();
    boom.box(this.paint, 0.22, 0.2, 1.9, 0, 0, -0.9);
    boom.box(dark, 0.3, 0.3, 0.3, 0, 0, 0);
    boom.drum(steel, 0.17, 0.08, 0, -0.05, -1.85, 18);
    boom.box(dark, 0.06, 0.4, 0.4, 0.07, -0.05, -1.85);
    boom.box(dark, 0.06, 0.4, 0.4, -0.07, -0.05, -1.85);
    boom.build(this.winchBoom);
    this.winchBoom.position.set(0, 1.86, -1.55);
    this.inner.add(this.winchBoom);
  }

  /** Swings the winch boom toward a world point (the anchor), within its travel. */
  aimWinch(worldX: number, worldZ: number): void {
    if (!this.look.winch) return;
    const local = this.scratchA.set(worldX, this.group.position.y, worldZ);
    this.group.worldToLocal(local);
    // The boom rests pointing rearward (-z); yaw it toward the anchor, up to 100 degrees each way.
    const yaw = Math.atan2(-local.x, -local.z);
    this.winchBoom.rotation.y = Math.max(-1.75, Math.min(1.75, yaw));
  }

  /** World position of the fairlead the winch cable leaves from. */
  fairlead(out: Vector3): Vector3 {
    out.set(0, -0.05, -1.85);
    return this.winchBoom.localToWorld(out);
  }

  /** Releases GPU resources when the machine is rebuilt or sold. */
  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const material = mesh.material as Material;
        if (material === this.paint || material === this.paintTwoSided || (material as { map?: unknown }).map)
          material.dispose();
      }
    });
    this.paint.dispose();
    this.paintTwoSided.dispose();
  }

  /** The cab glazing is hidden when the camera sits inside the cab. */
  setInteriorView(inside: boolean): void {
    if (this.glassMesh) this.glassMesh.visible = !inside;
  }

  private buildHull(): void {
    const kit = new Kit();
    // Chassis and track frames.
    kit.box(dark, 1.5, 0.42, 4.5, 0, -0.52, -0.05);
    for (const side of [-1, 1]) {
      kit.box(dark, 0.22, 0.2, 4.3, side * TRACK_X, -0.6, 0);
      kit.box(dark, 0.6, 0.14, 0.3, side * 1.0, -0.55, 1.3);
      kit.box(dark, 0.6, 0.14, 0.3, side * 1.0, -0.55, -1.3);
      // Narrow guard over the inner edge of each track; the belts themselves run open.
      kit.box(this.paint, 0.34, 0.05, 4.3, side * 0.92, -0.08, -0.02);
      kit.box(this.paint, 0.05, 0.22, 4.3, side * 0.76, -0.2, -0.02);
      // Handrail along the engine deck.
      kit.post(steel, 0.02, 2.2, side * 1.02, 0.98, -1.25, Math.PI / 2);
      for (const z of [-0.2, -1.25, -2.3]) kit.post(steel, 0.02, 0.38, side * 1.02, 0.79, z);
      // Mirrors.
      kit.post(dark, 0.018, 0.55, side * 1.32, 1.02, 1.72, 0, side * -1.1);
      kit.box(dark, 0.05, 0.36, 0.2, side * 1.58, 1.12, 1.72);
      // Steps up to the cab.
      kit.box(steel, 0.42, 0.03, 0.5, side * 1.28, -0.02, 0.9);
    }
    // Engine deck with intake louvres and service hatches.
    kit.box(this.paint, 2.1, 0.72, 2.5, 0, 0.24, -1.25);
    kit.box(dark, 1.7, 0.05, 2.1, 0, 0.62, -1.25);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) kit.box(dark, 0.03, 0.045, 0.7, side * 1.06, -0.04 + k * 0.07, -2.05);
      kit.box(dark, 0.02, 0.2, 1.5, side * 1.06, -0.02, -0.9);
    }
    kit.box(dark, 1.5, 0.5, 0.04, 0, 0.24, -2.51);
    // Exhaust stack.
    kit.post(steel, 0.07, 1.25, -0.82, 1.2, -0.2);
    kit.post(dark, 0.085, 0.5, -0.82, 0.95, -0.2);
    kit.post(chrome, 0.05, 0.22, -0.82, 1.9, -0.16, 0.5);

    // Cab: painted lower shell, glazed upper, roof with light bar.
    kit.box(this.paint, 2.14, 0.6, 1.95, 0, 0.18, 0.98);
    kit.box(dark, 2.16, 0.06, 1.97, 0, 0.5, 0.98);
    kit.box(glass, 2.04, 0.92, 1.86, 0, 0.98, 0.98);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) kit.box(dark, 0.08, 0.94, 0.08, sx * 1.03, 0.98, 0.98 + sz * 0.93);
    kit.box(white, 2.24, 0.1, 2.1, 0, 1.49, 1.0);
    kit.box(dark, 2.24, 0.03, 0.16, 0, 1.47, 2.1, 0.2);
    for (const x of [-0.84, -0.42, 0.42, 0.84]) {
      kit.box(dark, 0.22, 0.16, 0.12, x, 1.63, 1.9);
      kit.box(lamp, 0.18, 0.12, 0.02, x, 1.63, 1.97);
    }
    for (const x of [-0.8, 0.8]) {
      kit.box(dark, 0.22, 0.16, 0.12, x, 1.63, 0.1);
      kit.box(lamp, 0.18, 0.12, 0.02, x, 1.63, 0.03);
      kit.box(lamp, 0.22, 0.1, 0.03, x, 0.02, 1.97);
    }
    kit.post(dark, 0.07, 0.05, 0.75, 1.57, 0.45);
    kit.post(amber, 0.06, 0.12, 0.75, 1.65, 0.45);
    kit.post(steel, 0.006, 0.9, -0.9, 2.0, 0.3);
    // Wiper and windscreen frame.
    kit.box(dark, 0.015, 0.42, 0.015, 0.5, 0.74, 1.93, 0, 0, 0.9);

    // Cab interior, seen from the operator's seat.
    kit.box(interior, 1.9, 0.14, 0.3, 0, 0.5, 1.74, -0.35);
    kit.box(interior, 0.52, 0.12, 0.5, 0, 0.55, 0.95);
    kit.box(interior, 0.52, 0.62, 0.12, 0, 0.92, 0.68, -0.12);
    for (const x of [-0.42, 0.42]) {
      kit.box(interior, 0.16, 0.1, 0.5, x, 0.7, 1.12);
      kit.post(steel, 0.016, 0.16, x, 0.83, 1.3, 0.25);
      kit.post(dark, 0.03, 0.05, x, 0.92, 1.32);
    }
    kit.box(lamp, 0.26, 0.12, 0.01, 0.62, 0.6, 1.66, -0.35);

    const meshes = kit.build(this.inner);
    this.glassMesh = meshes.get(glass);
    if (this.glassMesh) this.glassMesh.castShadow = false;

    // Maker's name on both sides of the engine deck.
    const logo = new MeshStandardNodeMaterial({
      map: logoTexture(this.look.name),
      transparent: true,
      roughness: 0.5,
    });
    for (const side of [-1, 1]) {
      const plate = new Mesh(new PlaneGeometry(1.5, 0.375), logo);
      plate.position.set(side * 1.056, 0.36, -1.05);
      plate.rotation.y = (side * Math.PI) / 2;
      this.inner.add(plate);
    }
  }

  private buildTracks(): void {
    const belt = beltGeometry(this.path);
    const cleat = new BoxGeometry(TRACK_W + 0.04, 0.045, 0.06);
    cleat.translate(0, -0.03, 0);
    const count = Math.floor(this.path.length / CLEAT_SPACING);
    const road = wheelGeometry(WHEEL_R, 0.46, false);
    const idler = wheelGeometry(IDLER.r, 0.4, false);
    const sprocket = wheelGeometry(SPROCKET.r, 0.36, true);

    for (let side = 0; side < 2; side++) {
      const x = side === 0 ? TRACK_X : -TRACK_X;
      const beltMesh = new Mesh(belt, rubber);
      beltMesh.position.x = x;
      beltMesh.castShadow = true;
      this.inner.add(beltMesh);

      const cleats = new InstancedMesh(cleat, steel, count);
      cleats.position.x = x;
      cleats.castShadow = true;
      cleats.frustumCulled = false;
      this.cleats.push(cleats);
      this.inner.add(cleats);

      const addWheel = (
        shape: { tyre: BufferGeometry; hub: BufferGeometry },
        tyreMaterial: Material,
        y: number,
        z: number,
        radius: number,
      ): void => {
        const wheel = new Group();
        const tyre = new Mesh(shape.tyre, tyreMaterial);
        tyre.castShadow = true;
        wheel.add(tyre, new Mesh(shape.hub, steel));
        wheel.position.set(x, y, z);
        this.wheels.push({ mesh: wheel, radius, side });
        this.inner.add(wheel);
      };
      for (const z of WHEEL_Z) addWheel(road, rubber, TRACK_BOTTOM + WHEEL_R + 0.05, z, WHEEL_R);
      addWheel(idler, rubber, IDLER.y, IDLER.z, IDLER.r);
      addWheel(sprocket, steel, SPROCKET.y, SPROCKET.z, SPROCKET.r);
    }
  }

  private buildBlade(): void {
    const kit = new Kit();
    // Curved mouldboard with forward-swept wings. Local origin is the centre of the cutting edge.
    const profile: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      profile.push([1.12 * t, -0.27 * Math.sin(Math.PI * t ** 0.9) + 0.2 * t * t]);
    }
    const wing = 0.9;
    const hinge = this.bladeHalf - wing * Math.cos(0.42);
    const sweepAngle = 0.42;
    const tipX = hinge + wing * Math.cos(sweepAngle);
    const tipDz = wing * Math.sin(sweepAngle);
    kit.add(
      this.paintTwoSided,
      sweep(profile, [
        { x: -tipX, dz: tipDz },
        { x: -hinge, dz: 0 },
        { x: hinge, dz: 0 },
        { x: tipX, dz: tipDz },
      ]),
      0,
      0,
      0,
    );
    for (const side of [-1, 1]) {
      // Wing end plates and hinge posts.
      kit.box(dark, 0.04, 1.14, 0.34, side * (tipX + 0.01), 0.57, tipDz - 0.06, 0, side * -sweepAngle, 0);
      kit.post(dark, 0.045, 1.16, side * hinge, 0.57, -0.3);
    }
    // Cutting edge with teeth, spill guard on top, and the frame the lift arms carry.
    const edge = 2 * hinge + 0.02;
    kit.box(steel, edge, 0.09, 0.025, 0, 0.03, 0.01, -0.2);
    const teeth = Math.round(edge / 0.122);
    for (let k = 0; k < teeth; k++) {
      kit.box(
        steel,
        0.07,
        0.07,
        0.025,
        -edge / 2 + 0.06 + (k * (edge - 0.12)) / (teeth - 1),
        -0.03,
        0.02,
        -0.2,
      );
    }
    kit.box(dark, edge, 0.04, 0.1, 0, 1.13, 0.17);
    kit.box(dark, edge - 0.16, 0.14, 0.12, 0, 0.3, -0.36);
    kit.box(dark, edge - 0.16, 0.14, 0.12, 0, 0.82, -0.36);
    const outer = hinge - 0.32;
    for (const x of [-outer, -0.7, 0.7, outer]) kit.box(dark, 0.1, 0.66, 0.1, x, 0.56, -0.36);
    for (const x of [-outer, -0.7, 0.7, outer]) kit.box(dark, 0.08, 0.08, 0.2, x, 0.56, -0.28);
    kit.build(this.blade);
    this.inner.add(this.blade);

    // Lift arms and hydraulic rams between the chassis and the blade frame.
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(0.14, 1, 0.16), dark);
      const barrel = new Mesh(new CylinderGeometry(0.055, 0.055, 0.62, 10), dark);
      const rod = new Mesh(new CylinderGeometry(0.03, 0.03, 1, 10), chrome);
      for (const mesh of [arm, barrel, rod]) {
        mesh.castShadow = true;
        this.inner.add(mesh);
      }
      const x = side * 0.7;
      this.links.push(
        {
          link: new Link(arm, 1),
          from: new Vector3(x, BLADE_PIVOT.y, BLADE_PIVOT.z),
          to: new Vector3(x, 0.3, -0.22),
          stretch: true,
          onBlade: true,
        },
        {
          link: new Link(barrel, 0.62),
          from: new Vector3(x * 0.6, 0.12, 2.0),
          to: new Vector3(x * 0.6, 0.82, -0.3),
          stretch: false,
          onBlade: true,
        },
        {
          link: new Link(rod, 1),
          from: new Vector3(x * 0.6, 0.12, 2.0),
          to: new Vector3(x * 0.6, 0.82, -0.3),
          stretch: true,
          onBlade: true,
        },
      );
    }
  }

  private buildTiller(): void {
    const kit = new Kit();
    const half = this.tillerHalf;
    // Local origin is the hitch pivot at the rear of the chassis; the tiller trails toward -z.
    const housing: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const a = -0.25 + (k / 10) * (Math.PI + 0.5);
      housing.push([-0.32 + 0.35 * Math.sin(a), -1.4 + 0.35 * Math.cos(a)]);
    }
    const knives = Math.max(4, Math.round((half - 0.14) / 0.165));
    for (const side of [-1, 1]) {
      kit.box(dark, 0.12, 0.14, 1.3, side * 0.55, 0.0, -0.62);
      // Cutter drum housing, one half per side, with end plates.
      kit.add(
        this.paintTwoSided,
        sweep(housing, [
          { x: side * 0.03, dz: 0 },
          { x: side * (half - 0.01), dz: 0 },
        ]),
        0,
        0,
        0,
      );
      kit.box(dark, 0.04, 0.5, 0.74, side * (half + 0.01), -0.3, -1.42);
      kit.drum(steel, 0.2, half - 0.1, side * (0.05 + (half - 0.1) / 2), -0.4, -1.4, 14);
      for (let k = 0; k < knives; k++)
        kit.box(steel, 0.05, 0.56, 0.05, side * (0.14 + k * 0.165), -0.4, -1.4, k * 0.9, 0, 0);
      // Side finisher wings.
      kit.box(rubber, 0.03, 0.2, 0.9, side * (half + 0.04), -0.5, -1.75);
    }
    kit.box(dark, 0.36, 0.3, 0.5, 0, -0.14, -1.3);
    kit.box(dark, 2 * half + 0.02, 0.07, 0.1, 0, 0.02, -1.4);
    kit.box(dark, 1.3, 0.1, 0.1, 0, 0.02, -0.02);
    // Finisher: the flexible comb mat that presses the corduroy.
    kit.box(rubber, 2 * half + 0.04, 0.025, 0.62, 0, -0.5, -1.98, 0.16);
    const teeth = Math.round((2 * half) / 0.06);
    for (let k = 0; k < teeth; k++) {
      kit.box(
        rubber,
        0.03,
        0.05,
        0.14,
        -half + 0.02 + (k * (2 * half - 0.04)) / (teeth - 1),
        -0.58,
        -2.3,
        0.16,
      );
    }
    kit.box(steel, 2 * half + 0.04, 0.04, 0.05, 0, -0.42, -1.72);
    kit.build(this.tiller);
    this.tiller.position.copy(TILLER_PIVOT);
    this.inner.add(this.tiller);

    for (const side of [-1, 1]) {
      const barrel = new Mesh(new CylinderGeometry(0.05, 0.05, 0.5, 10), dark);
      const rod = new Mesh(new CylinderGeometry(0.028, 0.028, 1, 10), chrome);
      barrel.castShadow = true;
      rod.castShadow = true;
      this.inner.add(barrel, rod);
      const x = side * 0.3;
      const from = new Vector3(x, 0.45, -2.35);
      const to = new Vector3(x, 0.06, -1.1);
      this.links.push(
        { link: new Link(barrel, 0.5), from, to, stretch: false, onBlade: false },
        { link: new Link(rod, 1), from, to, stretch: true, onBlade: false },
      );
    }
  }

  /** Poses the model from the simulated machine. */
  sync(cat: Snowcat): void {
    const b = cat.body;
    this.group.position.set(b.px, b.py, b.pz);
    this.group.quaternion.set(b.qx, b.qy, b.qz, b.qw);

    const scale = this.look.scale;
    this.blade.position.set(0, TRACK_BOTTOM + cat.bladeHeightM / scale, cat.spec.bladeZ / scale);
    this.tiller.rotation.x = 0.42 * (1 - cat.tillerPos);

    for (const item of this.links) {
      const target = item.onBlade ? this.blade : this.tiller;
      const to = this.scratchB.copy(item.to).applyQuaternion(target.quaternion).add(target.position);
      item.link.aim(this.scratchA.copy(item.from), to, item.stretch);
    }

    for (const wheel of this.wheels)
      wheel.mesh.rotation.x = cat.trackTravel[wheel.side]! / scale / wheel.radius;

    // Cleats ride the belt: each sits at a fixed spacing along the loop, advanced by belt travel.
    const path = this.path;
    const n = path.y.length;
    for (let side = 0; side < 2; side++) {
      const mesh = this.cleats[side]!;
      // The belt's ground run moves rearward when the machine drives forward.
      let offset = (-cat.trackTravel[side]! / scale) % CLEAT_SPACING;
      if (offset < 0) offset += CLEAT_SPACING;
      let segment = 0;
      for (let k = 0; k < this.cleatCount; k++) {
        const s = k * CLEAT_SPACING + offset;
        while (segment < n - 1 && path.s[segment + 1]! < s) segment++;
        const next = (segment + 1) % n;
        const span = path.s[segment + 1]! - path.s[segment]!;
        const t = span > 0 ? (s - path.s[segment]!) / span : 0;
        const y = path.y[segment]! + (path.y[next]! - path.y[segment]!) * t;
        const z = path.z[segment]! + (path.z[next]! - path.z[segment]!) * t;
        const angle = Math.atan2(path.y[next]! - path.y[segment]!, path.z[next]! - path.z[segment]!);
        this.quaternion.setFromAxisAngle(this.xAxis, -angle);
        this.matrix.compose(this.position.set(0, y, z), this.quaternion, this.unit);
        mesh.setMatrixAt(k, this.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
