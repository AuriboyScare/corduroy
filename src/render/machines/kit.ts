import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Group } from 'three/webgpu';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three/webgpu';

/** A side profile as (z, y) points, counter-clockwise with z to the right and y up. */
export type Profile = readonly (readonly [number, number])[];

/** Extrudes a (z, y) profile across x, centred on x = 0, with bevelled edges. */
export function extrudeX(profile: Profile, width: number, bevel = 0.03, curveSegments = 6): BufferGeometry {
  const shape = new Shape(profile.map(([z, y]) => new Vector2(z, y)));
  const depth = Math.max(0.001, width - 2 * bevel);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  // Shape x -> z, shape y -> y, extrusion -> x.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(depth / 2, 0, 0);
  return geometry;
}

/** Extrudes an (x, y) outline along z, centred on z = 0: plates, brackets, gear wheels. */
export function extrudeZ(outline: Profile, depth: number, bevel = 0.01): BufferGeometry {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const core = Math.max(0.001, depth - 2 * bevel);
  const geometry = new ExtrudeGeometry(shape, {
    depth: core,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -core / 2);
  return geometry;
}

/** Sweeps a (y, z) profile through stations across x; each span creases, so wings can sweep. */
export function sweep(
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

/** A flat four-cornered panel (glass, screens, decals), corners in order round the face. */
export function quad(
  a: Vector3,
  b: Vector3,
  c: Vector3,
  d: Vector3,
  uv = [0, 0, 1, 0, 1, 1, 0, 1],
): BufferGeometry {
  const geometry = new BufferGeometry();
  const p = [a, b, c, a, c, d].flatMap((v) => [v.x, v.y, v.z]);
  const t = [0, 1, 2, 0, 2, 3].flatMap((k) => [uv[k * 2]!, uv[k * 2 + 1]!]);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(t), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A wheel or drum turned from an (radius, x) outline, axis along x. */
export function latheX(outline: readonly (readonly [number, number])[], segments = 24): BufferGeometry {
  const geometry = new LatheGeometry(
    outline.map(([r, x]) => new Vector2(r, x)),
    segments,
  );
  // Lathe axis is y; turn it to x.
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

/** A tube along points (hoses, handrails, cables). */
export function tube(points: readonly Vector3[], radius: number, closed = false, radial = 7): BufferGeometry {
  const curve = new CatmullRomCurve3(points as Vector3[], closed, 'centripetal');
  const segments = Math.max(4, Math.round(curve.getLength() / 0.12));
  return new TubeGeometry(curve, segments, radius, radial, closed);
}

/**
 * Merges parts and re-indexes the result, so vertices shared by neighbouring triangles (round
 * surfaces especially) are shaded once instead of once per triangle.
 */
function merged(list: BufferGeometry[]): BufferGeometry {
  return mergeVertices(mergeGeometries(list), 1e-5);
}

/**
 * Collects parts per material and merges them, so a whole assembly of hundreds of parts is one
 * draw call per material.
 */
export class Kit {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  private readonly matrix = new Matrix4();
  private readonly euler = new Euler();
  private readonly quaternion = new Quaternion();
  private readonly offset = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  /** Segments in each rounded edge of `rbox`; 1 gives a cheap chamfer for parts seen from afar. */
  roundSegments = 2;
  /** Applied to every part after its own placement: lets an assembly be built in local coordinates. */
  private frame: Matrix4 | null = null;

  /** Places everything added from now on in this frame (null: world coordinates). */
  setFrame(frame: Matrix4 | null): void {
    this.frame = frame;
  }

  add(material: Material, geometry: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
    this.matrix.compose(
      this.offset.set(x, y, z),
      this.quaternion.setFromEuler(this.euler.set(rx, ry, rz, 'YXZ')),
      this.scale,
    );
    // Merging needs every part non-indexed; cloning also lets callers reuse a shape.
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv'))
      g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g = g.applyMatrix4(this.matrix);
    if (this.frame) g.applyMatrix4(this.frame);
    const list = this.parts.get(material);
    if (list) list.push(g);
    else this.parts.set(material, [g]);
  }

  box(
    m: Material,
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
    this.add(m, new BoxGeometry(w, h, l), x, y, z, rx, ry, rz);
  }

  /** Box with rounded edges and corners. */
  rbox(
    m: Material,
    w: number,
    h: number,
    l: number,
    radius: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, l / 2 - 1e-3);
    this.add(m, new RoundedBoxGeometry(w, h, l, this.roundSegments, Math.max(1e-3, r)), x, y, z, rx, ry, rz);
  }

  /** Cylinder with its axis along x. */
  drum(m: Material, radius: number, width: number, x: number, y: number, z: number, segments = 20): void {
    this.add(m, new CylinderGeometry(radius, radius, width, segments), x, y, z, 0, 0, Math.PI / 2);
  }

  /** Cylinder with its axis along y, optionally tilted. */
  post(
    m: Material,
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    rz = 0,
    segments = 10,
  ): void {
    this.add(m, new CylinderGeometry(radius, radius, height, segments), x, y, z, rx, 0, rz);
  }

  /** Cylinder with its axis along z. */
  pipe(m: Material, radius: number, length: number, x: number, y: number, z: number, segments = 12): void {
    this.add(m, new CylinderGeometry(radius, radius, length, segments), x, y, z, Math.PI / 2, 0, 0);
  }

  /** A rod between two points. */
  rod(m: Material, radius: number, from: Vector3, to: Vector3, segments = 8): void {
    const d = new Vector3().subVectors(to, from);
    const length = d.length();
    const g = new CylinderGeometry(radius, radius, length, segments);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
    g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    this.add(m, g);
  }

  /** A ring, axis along the given direction ('x', 'y' or 'z'). */
  ring(
    m: Material,
    radius: number,
    thickness: number,
    axis: 'x' | 'y' | 'z',
    x: number,
    y: number,
    z: number,
  ): void {
    const g = new TorusGeometry(radius, thickness, 6, 20);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    else if (axis === 'y') g.rotateX(Math.PI / 2);
    this.add(m, g, x, y, z);
  }

  tube(m: Material, points: readonly Vector3[], radius: number, closed = false): void {
    this.add(m, tube(points, radius, closed));
  }

  /** The parts merged into one geometry per material, without making meshes (for instancing). */
  geometries(): [BufferGeometry, Material][] {
    const out: [BufferGeometry, Material][] = [];
    for (const [material, list] of this.parts) out.push([merged(list), material]);
    this.parts.clear();
    return out;
  }

  get empty(): boolean {
    return this.parts.size === 0;
  }

  /** Merges into one mesh per material; parts in `noShadow` materials stay out of the shadow map. */
  build(
    parent: Group,
    castShadow = true,
    receiveShadow = true,
    noShadow: ReadonlySet<Material> = new Set(),
  ): Map<Material, Mesh> {
    const meshes = new Map<Material, Mesh>();
    for (const [material, list] of this.parts) {
      const mesh = new Mesh(merged(list), material);
      mesh.castShadow = castShadow && !noShadow.has(material);
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      meshes.set(material, mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
