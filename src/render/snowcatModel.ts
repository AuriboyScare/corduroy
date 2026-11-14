import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type Material,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PUSHED_DENSITY } from '../sim/snow/snowpack';
import type { Snowcat } from '../sim/vehicles/snowcat';
import { Dashboard } from './machines/dashboard';
import { decalAspect, decalMaterial, decalUv, type DecalName } from './machines/decals';
import { extrudeX, Kit, latheX, quad, sweep, type Profile } from './machines/kit';
import {
  aluminium,
  chrome,
  fabric,
  frame,
  glass,
  hose,
  MachineLamps,
  paint as paintMaterial,
  plastic,
  rubber,
  steel,
  tread,
} from './machines/materials';

/**
 * Procedural models of the Kestrel groomers (original, fictional machines). Each model has its own
 * build: proportions, cab, lights and equipment differ, not just the size. Drawn in Kestrel 420
 * body coordinates and scaled; implement widths come from the machine's specification.
 * Model frame matches the simulation body: +x left, +y up, +z forward, origin at the centre of mass.
 */

export interface SnowcatLook {
  /** Model name, e.g. "Kestrel 420"; the first word is the maker's mark. */
  readonly name: string;
  /** Catalogue id, which picks the build. */
  readonly model: string;
  readonly paint: number;
  /** Size relative to the Kestrel 420. */
  readonly scale: number;
  readonly bladeHalfWidthM: number;
  readonly tillerHalfWidthM: number;
  readonly winch: boolean;
  /** Fitted upgrade levels; several show on the machine. */
  readonly levels: Readonly<Record<string, number>>;
}

interface Build {
  /** Road wheel stations per track. */
  wheels: number;
  cab: { rear: number; front: number; half: number; roof: number; rake: number };
  hood: { rear: number; top: number; half: number };
  roofLamps: number;
  rails: boolean;
  airCon: boolean;
}

const BUILDS: Record<string, Build> = {
  // Compact: short glasshouse, low hood, four lamps.
  'kestrel-260': {
    wheels: 4,
    cab: { rear: 0.32, front: 1.96, half: 0.93, roof: 1.44, rake: 0.3 },
    hood: { rear: -2.3, top: 0.9, half: 0.9 },
    roofLamps: 4,
    rails: false,
    airCon: false,
  },
  // Full-size resort groomer.
  'kestrel-420': {
    wheels: 5,
    cab: { rear: 0.06, front: 2.0, half: 1.05, roof: 1.52, rake: 0.33 },
    hood: { rear: -2.42, top: 1.0, half: 0.98 },
    roofLamps: 6,
    rails: false,
    airCon: true,
  },
  // Heavy winch machine: long hood, wide cab, roof rails, eight lamps.
  'kestrel-600w': {
    wheels: 6,
    cab: { rear: 0.0, front: 2.02, half: 1.1, roof: 1.58, rake: 0.35 },
    hood: { rear: -2.5, top: 1.08, half: 1.02 },
    roofLamps: 8,
    rails: true,
    airCon: true,
  },
};

const TRACK_X = 1.45;
const TRACK_W = 1.4;
const TRACK_BOTTOM = -1.0;
const CLEAT_SPACING = 0.16;
const WHEEL_R = 0.3;
const WHEEL_Y = TRACK_BOTTOM + WHEEL_R + 0.05;
const GROUND_RUN = 2.1;
const IDLER = { z: 2.32, y: -0.6, r: 0.36 };
const SPROCKET = { z: -2.36, y: -0.58, r: 0.38 };
const BLADE_PIVOT = new Vector3(0, -0.5, 2.3);
const TILLER_PIVOT = new Vector3(0, -0.45, -2.5);
/** Twin wheels sit either side of the belt's centre guide. */
const TWIN = 0.36;
/** Beyond this distance the small parts, interior and stickers are not drawn, m. */
const DETAIL_RANGE_M = 75;

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
  for (let z = -GROUND_RUN; z <= GROUND_RUN; z += 0.04) {
    zs.push(z);
    ys.push(bottom);
  }
  const frontTangent = Math.atan2(IDLER.y - IDLER.r - bottom, IDLER.z - GROUND_RUN);
  arc(IDLER.z, IDLER.y, IDLER.r + pad, -Math.PI / 2 + frontTangent, Math.PI / 2);
  const topFront = IDLER.y + IDLER.r + pad;
  const topRear = SPROCKET.y + SPROCKET.r + pad;
  for (let k = 1; k < 110; k++) {
    const t = k / 110;
    zs.push(IDLER.z + (SPROCKET.z - IDLER.z) * t);
    ys.push(topFront + (topRear - topFront) * t - Math.sin(t * Math.PI) * 0.035);
  }
  const rearTangent = Math.atan2(SPROCKET.y - SPROCKET.r - bottom, -GROUND_RUN - SPROCKET.z);
  arc(SPROCKET.z, SPROCKET.y, SPROCKET.r + pad, Math.PI / 2, (3 * Math.PI) / 2 - rearTangent);
  const n = ys.length;
  const s = new Float32Array(n + 1);
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n;
    s[k + 1] = s[k]! + Math.hypot(ys[m]! - ys[k]!, zs[m]! - zs[k]!);
  }
  return { y: Float32Array.from(ys), z: Float32Array.from(zs), s, length: s[n]! };
}

/** Rubber belt: two wide bands either side of the centre guide, running the whole loop. */
function beltGeometry(path: ReturnType<typeof trackPath>): BufferGeometry {
  const n = path.y.length;
  const position: number[] = [];
  const index: number[] = [];
  for (const [x0, x1] of [
    [-TRACK_W / 2, -0.05],
    [0.05, TRACK_W / 2],
  ] as const) {
    const start = position.length / 3;
    for (let k = 0; k < n; k++) position.push(x0, path.y[k]!, path.z[k]!, x1, path.y[k]!, path.z[k]!);
    for (let k = 0; k < n; k++) {
      const a = start + k * 2;
      const c = start + ((k + 1) % n) * 2;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Aluminium grouser: a base plate bolted to the belt and a fin standing out from it. */
function cleatGeometry(fin: number): BufferGeometry {
  const profile: Profile = [
    [-0.045, 0],
    [-0.045, -0.012],
    [-0.012, -0.012],
    [-0.006, -fin],
    [0.006, -fin],
    [0.012, -0.012],
    [0.045, -0.012],
    [0.045, 0],
  ];
  const g = extrudeX(profile, TRACK_W + 0.04, 0.003, 1);
  g.translate(0, -0.005, 0);
  return g;
}

/** Road wheel tyre and rim (with bolts, so rotation shows), axis along x, one twin wheel. */
function wheelParts(): { tyre: BufferGeometry; rim: BufferGeometry } {
  const w = 0.12;
  const tyre = latheX(
    [
      [0.2, -w],
      [0.27, -w],
      [0.296, -w + 0.025],
      [0.3, 0],
      [0.296, w - 0.025],
      [0.27, w],
      [0.2, w],
    ],
    28,
  );
  const parts: BufferGeometry[] = [
    latheX(
      [
        [0.0, -w - 0.01],
        [0.12, -w - 0.01],
        [0.2, -w + 0.01],
        [0.2, w - 0.01],
        [0.12, w + 0.01],
        [0.0, w + 0.01],
      ],
      20,
    ),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const bolt = new CylinderGeometry(0.014, 0.014, 0.02, 6).rotateZ(Math.PI / 2);
      bolt.translate(side * (w + 0.02), Math.cos(a) * 0.08, Math.sin(a) * 0.08);
      parts.push(bolt);
    }
  }
  return { tyre, rim: mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))) };
}

/** Drive sprocket: a toothed wheel with a domed hub. */
function sprocketGeometry(): BufferGeometry {
  const teeth = 14;
  const outline: [number, number][] = [];
  for (let k = 0; k < teeth; k++) {
    for (const [f, r] of [
      [0, 0.33],
      [0.18, 0.4],
      [0.32, 0.4],
      [0.5, 0.33],
    ] as const) {
      const a = ((k + f) / teeth) * Math.PI * 2;
      outline.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const plate = extrudeX(
    outline.map(([z, y]) => [z, y] as const),
    0.08,
    0.006,
    1,
  );
  const parts = [-0.15, 0.15].map((x) => plate.clone().translate(x, 0, 0));
  parts.push(
    latheX(
      [
        [0.0, -0.24],
        [0.22, -0.24],
        [0.24, -0.2],
        [0.24, 0.2],
        [0.22, 0.24],
        [0.0, 0.24],
      ],
      20,
    ),
  );
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** The berm of snow on the blade: a lumpy half-roll one unit wide and one unit in radius. */
function bermGeometry(): BufferGeometry {
  const nu = 40;
  const nv = 14;
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu - 0.5;
    const taper = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 6)));
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * Math.PI;
      const lump =
        1 + 0.1 * Math.sin(u * 37 + v * 3.1) * Math.cos(v * 5 + u * 13) + 0.05 * Math.sin(u * 91 + v * 7);
      const r = taper * lump;
      position.push(u, Math.sin(v) * r, Math.cos(v) * r);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const bermMaterial = new MeshStandardNodeMaterial({ color: 0xe9eef5, roughness: 0.92, metalness: 0 });

/** A hydraulic ram or arm between two points, re-aimed each frame. */
interface Link {
  kind: 'arm' | 'barrel' | 'rod';
  index: number;
  from: Vector3;
  to: Vector3;
  /** Body the far end is fixed to. */
  on: 'blade' | 'tiller';
  /** Rest length when not stretched (barrels keep their length). */
  rest: number;
}

export class SnowcatModel {
  /** Posed from the simulation each frame. */
  readonly group = new Group();
  /** Where the operator's eyes are, in body coordinates (metres, scaled). */
  readonly cabEye: Vector3;
  /** Exhaust outlet, in body coordinates (metres, scaled). */
  readonly exhaust: Vector3;
  private readonly inner = new Group();
  /** Interior, stickers and small fittings, hidden at a distance. */
  private readonly fine = new Group();
  private readonly build: Build;
  private readonly paint: Material;
  private readonly lamps = new MachineLamps();
  private readonly decals: MeshStandardNodeMaterial;
  private readonly dashboard: Dashboard;
  private readonly bladeHalf: number;
  private readonly tillerHalf: number;
  private readonly winchBoom = new Group();
  private readonly berm: Mesh;
  private readonly blade = new Group();
  private readonly tiller = new Group();
  private readonly path = trackPath();
  private readonly cleatCount: number;
  private readonly cleats: InstancedMesh;
  private readonly tyres: InstancedMesh;
  private readonly rims: InstancedMesh;
  private readonly sprockets: InstancedMesh;
  /** Per wheel instance: side, position, radius. */
  private readonly wheelSlots: { side: number; x: number; y: number; z: number; r: number }[] = [];
  private readonly links: Link[] = [];
  private readonly linkMeshes: Record<Link['kind'], InstancedMesh>;
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly position = new Vector3();
  private readonly scaleV = new Vector3(1, 1, 1);
  private readonly unit = new Vector3(1, 1, 1);
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly scratchA = new Vector3();
  private readonly scratchB = new Vector3();
  private readonly scratchC = new Vector3();
  private glassMeshes: Mesh[] = [];
  private driven = false;

  constructor(private readonly look: SnowcatLook) {
    this.build = BUILDS[look.model] ?? BUILDS['kestrel-420']!;
    this.paint = paintMaterial(look.paint);
    const [maker = 'Kestrel', number = ''] = look.name.split(' ');
    this.decals = decalMaterial(maker, number);
    this.dashboard = new Dashboard(look.name);
    this.bladeHalf = look.bladeHalfWidthM / look.scale;
    this.tillerHalf = look.tillerHalfWidthM / look.scale;
    this.inner.scale.setScalar(look.scale);
    this.group.add(this.inner);
    this.inner.add(this.fine);

    const cab = this.build.cab;
    this.cabEye = new Vector3(0, cab.roof - 0.3, (cab.rear + cab.front) / 2 - 0.12).multiplyScalar(
      look.scale,
    );
    this.exhaust = new Vector3(-(this.build.hood.half - 0.2), cab.roof + 0.42, cab.rear - 0.2).multiplyScalar(
      look.scale,
    );

    this.berm = new Mesh(bermGeometry(), bermMaterial);
    this.berm.castShadow = true;
    this.berm.receiveShadow = true;
    this.berm.visible = false;

    const level = (id: string) => look.levels[id] ?? 0;
    const finKit = new Kit();
    this.buildBody(finKit, level);
    this.buildCab(finKit, level);
    this.buildInterior(finKit);
    this.buildRunningGear(finKit);
    this.buildBlade(finKit, level('hydraulics'));
    this.buildTiller(level('finisher'));
    if (look.winch) this.buildWinch();
    finKit.build(this.fine, false, true);

    // Instanced moving parts: one draw call each for every wheel, cleat and ram on the machine.
    const wheel = wheelParts();
    const slots = this.wheelSlots;
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? TRACK_X : -TRACK_X;
      const stations = this.build.wheels;
      for (let k = 0; k < stations; k++) {
        const z = -1.95 + (3.9 * k) / (stations - 1);
        for (const t of [-TWIN, TWIN]) slots.push({ side, x: sx + t, y: WHEEL_Y, z, r: WHEEL_R });
      }
      for (const t of [-TWIN, TWIN]) slots.push({ side, x: sx + t, y: IDLER.y, z: IDLER.z, r: IDLER.r });
    }
    this.tyres = this.instanced(wheel.tyre, rubber, slots.length);
    this.rims = this.instanced(wheel.rim, steel, slots.length);
    this.sprockets = this.instanced(sprocketGeometry(), steel, 2);
    const fin = 0.045 + 0.015 * level('tracks');
    this.cleatCount = Math.floor(this.path.length / CLEAT_SPACING);
    this.cleats = this.instanced(cleatGeometry(fin), aluminium, this.cleatCount * 2);
    const count = (kind: Link['kind']) => this.links.filter((l) => l.kind === kind).length;
    this.linkMeshes = {
      arm: this.instanced(new BoxGeometry(0.14, 1, 0.16), frame, count('arm')),
      barrel: this.instanced(new CylinderGeometry(0.06, 0.06, 1, 12), frame, count('barrel')),
      rod: this.instanced(new CylinderGeometry(0.032, 0.032, 1, 10), chrome, count('rod')),
    };
    this.updateDetail(0);
  }

  private instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
    mesh.count = count;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.inner.add(mesh);
    return mesh;
  }

  /** A sticker from the machine's decal sheet, `height` tall, centred at a point, facing `normal`. */
  private decal(
    kit: Kit,
    name: DecalName,
    height: number,
    centre: Vector3,
    normal: Vector3,
    up = this.yAxis,
  ): void {
    const width = height * decalAspect(name);
    const right = this.scratchC.crossVectors(up, normal).normalize();
    const u = new Vector3().copy(up).multiplyScalar(height / 2);
    const r = new Vector3().copy(right).multiplyScalar(width / 2);
    const c = new Vector3().copy(centre).addScaledVector(normal, 0.006);
    kit.add(
      this.decals,
      quad(
        c.clone().sub(r).sub(u),
        c.clone().add(r).sub(u),
        c.clone().add(r).add(u),
        c.clone().sub(r).add(u),
        decalUv(name),
      ),
    );
  }

  /** Lower body, nose with grille and headlights, engine hood with louvres, exhaust and rear. */
  private buildBody(fine: Kit, level: (id: string) => number): void {
    const kit = new Kit();
    const { cab, hood } = this.build;
    const p = this.paint;
    // Lower body with a raked nose; the cab and hood sit on it.
    kit.add(
      p,
      extrudeX(
        [
          [-2.5, -0.2],
          [2.12, -0.2],
          [2.22, -0.06],
          [2.22, 0.22],
          [2.02, 0.46],
          [-2.38, 0.46],
          [-2.5, 0.34],
        ],
        2.08,
        0.045,
      ),
    );
    kit.box(frame, 1.48, 0.3, 4.6, 0, -0.4, -0.05);
    // Nose: recessed grille, slats, round headlights with chrome bezels, indicators.
    kit.rbox(frame, 1.3, 0.26, 0.06, 0.02, 0, 0.09, 2.235);
    for (let k = 0; k < 4; k++) kit.box(steel, 1.2, 0.022, 0.03, 0, 0.0 + k * 0.06, 2.27);
    for (const s of [-1, 1]) {
      kit.ring(chrome, 0.095, 0.018, 'z', s * 0.8, 0.1, 2.25);
      kit.pipe(frame, 0.1, 0.05, s * 0.8, 0.1, 2.235, 16);
      kit.pipe(this.lamps.lens, 0.082, 0.02, s * 0.8, 0.1, 2.262, 16);
      kit.rbox(this.lamps.indicator, 0.12, 0.06, 0.03, 0.01, s * 0.96, 0.24, 2.218);
      // Tow eyes.
      kit.ring(steel, 0.06, 0.018, 'x', s * 0.45, -0.24, 2.18);
    }
    // Push-frame mount and the hydraulic block the blade hoses run from.
    kit.rbox(frame, 1.35, 0.22, 0.32, 0.03, 0, -0.42, 2.18);
    kit.rbox(frame, 0.42, 0.18, 0.24, 0.03, 0, -0.08, 2.24);

    // Engine hood behind the cab, sloping down at the rear.
    const hr = hood.rear;
    const top = hood.top;
    kit.add(
      p,
      extrudeX(
        [
          [hr, 0.46],
          [cab.rear - 0.02, 0.46],
          [cab.rear - 0.02, top],
          [hr + 0.34, top],
          [hr, top - 0.26],
        ],
        hood.half * 2,
        0.05,
      ),
    );
    const hoodLen = cab.rear - hr;
    for (const s of [-1, 1]) {
      const x = s * (hood.half + 0.004);
      // Louvred intake panel at the rear of each side.
      const louvre = Math.min(0.85, hoodLen * 0.34);
      const lz = hr + 0.2 + louvre / 2;
      const mid = (0.46 + top) / 2;
      kit.box(frame, 0.012, 0.36, louvre, x, mid, lz);
      for (let k = 0; k < 7; k++)
        kit.box(steel, 0.03, 0.022, louvre - 0.04, x + s * 0.01, mid - 0.135 + k * 0.045, lz, s * 0.5);
      // Service door ahead of it, carrying the maker's mark, with seams and latches.
      const zs = hr + 0.3 + louvre;
      const ze = cab.rear - 0.12;
      const dy = Math.min(0.2, (top - 0.46) / 2 - 0.06);
      fine.box(frame, 0.008, 0.008, ze - zs, x, mid + dy, (zs + ze) / 2);
      fine.box(frame, 0.008, 0.008, ze - zs, x, mid - dy, (zs + ze) / 2);
      fine.box(frame, 0.008, 2 * dy, 0.008, x, mid, zs);
      fine.box(frame, 0.008, 2 * dy, 0.008, x, mid, ze);
      fine.box(steel, 0.02, 0.05, 0.08, x + s * 0.01, mid + dy - 0.06, ze - 0.12);
      fine.box(steel, 0.02, 0.05, 0.08, x + s * 0.01, mid - dy + 0.06, ze - 0.12);
      const logo = Math.min(0.19, (ze - zs - 0.16) / decalAspect('maker'));
      this.decal(fine, 'maker', logo, new Vector3(x, mid, (zs + ze) / 2), new Vector3(s, 0, 0));
      // Pinstripe along the lower body.
      this.decal(fine, 'stripe', 0.07, new Vector3(s * 1.083, 0.04, -0.1), new Vector3(s, 0, 0));
      // Keep-clear stickers by the blade arms.
      this.decal(fine, 'keepClear', 0.17, new Vector3(s * 1.083, 0.22, 1.85), new Vector3(s, 0, 0));
    }
    // Raised vent on the hood top, with slats; the engine upgrade adds an intercooler grille.
    const ventZ = hr + hoodLen * 0.5;
    kit.rbox(p, 1.0, 0.09, Math.min(0.8, hoodLen * 0.4), 0.03, 0, top + 0.04, ventZ);
    for (let k = 0; k < 8; k++)
      kit.box(
        frame,
        0.92,
        0.012,
        0.035,
        0,
        top + 0.09,
        ventZ - Math.min(0.32, hoodLen * 0.16) + k * Math.min(0.09, hoodLen * 0.045),
      );
    if (level('engine') >= 3) {
      kit.rbox(frame, 0.8, 0.06, 0.4, 0.02, 0, top + 0.03, hr + 0.5);
      for (let k = 0; k < 6; k++) kit.box(steel, 0.74, 0.01, 0.02, 0, top + 0.065, hr + 0.36 + k * 0.055);
    }

    // Exhaust stack behind the cab: muffler, heat shield, clamps and a hinged rain cap. Bigger
    // with the engine upgrade, and twin stacks from level 2.
    const stacks = level('engine') >= 2 ? [0, 0.24] : [0];
    const r = level('engine') >= 1 ? 0.075 : 0.065;
    for (const dx of stacks) {
      const ex = this.exhaustLocal().x + dx;
      const ez = cab.rear - 0.2;
      const tip = cab.roof + 0.4;
      kit.post(frame, 0.13, 0.48, ex, top + 0.24, ez, 0, 0, 16);
      kit.post(steel, r, tip - top - 0.4, ex, (top + 0.4 + tip) / 2, ez, 0, 0, 14);
      kit.post(frame, r + 0.022, 0.42, ex, top + 0.72, ez, 0, 0, 14);
      for (const y of [top + 0.5, top + 0.92]) kit.ring(steel, r + 0.026, 0.01, 'y', ex, y, ez);
      kit.add(
        level('engine') >= 1 ? chrome : steel,
        new CylinderGeometry(r + 0.012, r + 0.012, 0.012, 14),
        ex,
        tip + 0.02,
        ez - 0.02,
        -0.5,
        0,
        0,
      );
    }
    // Air intake snorkel on the other side.
    {
      const ix = hood.half - 0.24;
      const iz = cab.rear - 0.22;
      kit.rbox(frame, 0.2, cab.roof - top - 0.1, 0.2, 0.03, ix, (top + cab.roof - 0.1) / 2, iz);
      kit.rbox(frame, 0.28, 0.12, 0.3, 0.04, ix, cab.roof - 0.08, iz - 0.04);
    }
    // Deck handrails along both edges of the hood.
    for (const s of [-1, 1]) {
      const x = s * (hood.half - 0.06);
      const z0 = hr + 0.25;
      const z1 = cab.rear - 0.35;
      kit.tube(
        steel,
        [
          new Vector3(x, top, z0 - 0.05),
          new Vector3(x, top + 0.3, z0 + 0.05),
          new Vector3(x, top + 0.3, z1 - 0.05),
          new Vector3(x, top, z1 + 0.05),
        ],
        0.018,
      );
    }
    // Rear: tail lights, rear lamps, bumper with hazard stripes, tow hitch, tiller hitch frame.
    for (const s of [-1, 1]) {
      kit.rbox(frame, 0.24, 0.12, 0.05, 0.02, s * 0.78, 0.26, -2.52);
      kit.rbox(this.lamps.tail, 0.18, 0.08, 0.02, 0.01, s * 0.78, 0.26, -2.548);
      kit.rbox(this.lamps.indicator, 0.06, 0.08, 0.02, 0.01, s * 0.6, 0.26, -2.548);
    }
    kit.rbox(frame, 2.0, 0.16, 0.16, 0.04, 0, -0.06, -2.58);
    this.decal(fine, 'hazard', 0.1, new Vector3(0, -0.06, -2.66), new Vector3(0, 0, -1));
    kit.ring(steel, 0.07, 0.02, 'y', 0, -0.17, -2.68);
    for (const s of [-1, 1]) {
      kit.rod(
        frame,
        0.055,
        new Vector3(s * 0.62, -0.32, -2.45),
        new Vector3(s * 0.32, TILLER_PIVOT.y, TILLER_PIVOT.z + 0.02),
      );
      kit.tube(
        hose,
        [
          new Vector3(s * 0.25, 0.1, -2.5),
          new Vector3(s * 0.3, -0.05, -2.62),
          new Vector3(s * 0.32, 0.25, -2.78),
        ],
        0.016,
      );
    }
    kit.build(this.inner);
  }

  /** The cab: frame and pillars, individual glazed panes, roof, door, mirrors, wipers, lamps. */
  private buildCab(fine: Kit, level: (id: string) => number): void {
    const kit = new Kit();
    const { rear: cr, front: cf, half: h, roof, rake } = this.build.cab;
    const sill = 0.72;
    const zb = cr + (cf - cr) * 0.46;
    const p = this.paint;
    // Panel below the windows, then black pillars and sills.
    kit.add(
      p,
      extrudeX(
        [
          [cr, 0.44],
          [cf, 0.44],
          [cf, sill],
          [cr, sill],
        ],
        h * 2,
        0.03,
      ),
    );
    const pillar = (a: Vector3, b: Vector3, r = 0.045) => kit.rod(frame, r, a, b, 8);
    for (const s of [-1, 1]) {
      const x = s * h;
      pillar(new Vector3(x, sill, cf), new Vector3(x, roof, cf - rake), 0.05);
      pillar(new Vector3(x, sill, zb), new Vector3(x, roof, zb), 0.04);
      pillar(new Vector3(x, sill, cr), new Vector3(x, roof, cr), 0.05);
      pillar(new Vector3(x, sill, cr), new Vector3(x, sill, cf), 0.035);
    }
    pillar(new Vector3(-h, sill, cf), new Vector3(h, sill, cf), 0.04);
    pillar(new Vector3(-h, sill, cr), new Vector3(h, sill, cr), 0.04);
    // Panes, set just inside the frame.
    const glassKit = new Kit();
    const gh = h - 0.01;
    glassKit.add(
      glass,
      quad(
        new Vector3(-gh, sill + 0.02, cf - 0.005),
        new Vector3(gh, sill + 0.02, cf - 0.005),
        new Vector3(gh, roof - 0.02, cf - rake + 0.005),
        new Vector3(-gh, roof - 0.02, cf - rake + 0.005),
      ),
    );
    glassKit.add(
      glass,
      quad(
        new Vector3(gh, sill + 0.02, cr + 0.005),
        new Vector3(-gh, sill + 0.02, cr + 0.005),
        new Vector3(-gh, roof - 0.02, cr + 0.005),
        new Vector3(gh, roof - 0.02, cr + 0.005),
      ),
    );
    const frontAt = (y: number) => cf - (rake * (y - sill)) / (roof - sill);
    for (const s of [-1, 1]) {
      const x = s * (h - 0.004);
      glassKit.add(
        glass,
        quad(
          new Vector3(x, sill + 0.02, zb + 0.03),
          new Vector3(x, sill + 0.02, frontAt(sill + 0.02) - 0.04),
          new Vector3(x, roof - 0.02, frontAt(roof - 0.02) - 0.04),
          new Vector3(x, roof - 0.02, zb + 0.03),
        ),
      );
      glassKit.add(
        glass,
        quad(
          new Vector3(x, sill + 0.02, cr + 0.04),
          new Vector3(x, sill + 0.02, zb - 0.03),
          new Vector3(x, roof - 0.02, zb - 0.03),
          new Vector3(x, roof - 0.02, cr + 0.04),
        ),
      );
    }
    this.glassMeshes = [...glassKit.build(this.inner, false, false).values()];

    // Roof with a forward visor and drip rails.
    const roofLen = cf - rake - cr + 0.24;
    kit.rbox(p, h * 2 + 0.16, 0.12, roofLen, 0.05, 0, roof + 0.06, cr + roofLen / 2 - 0.1);
    kit.rbox(frame, h * 2 + 0.02, 0.035, 0.22, 0.015, 0, roof + 0.0, cf - rake + 0.16, -0.25);
    // Front light bar on brackets; the work light upgrade adds a second row.
    const barZ = cf - rake + 0.04;
    const lampRows = level('lights') >= 2 ? 2 : 1;
    const perRow = this.build.roofLamps + (level('lights') >= 1 ? 2 : 0);
    for (let row = 0; row < lampRows; row++) {
      const y = roof + 0.2 + row * 0.17;
      kit.rbox(frame, h * 2 - 0.1, 0.05, 0.08, 0.02, 0, y - 0.09, barZ);
      for (let k = 0; k < perRow; k++) {
        const x = -h + 0.18 + ((2 * h - 0.36) * k) / Math.max(1, perRow - 1);
        kit.rbox(frame, 0.16, 0.12, 0.11, 0.02, x, y, barZ);
        kit.rbox(this.lamps.lens, 0.13, 0.09, 0.012, 0.004, x, y, barZ + 0.058);
      }
    }
    for (const s of [-1, 1]) kit.box(frame, 0.04, 0.2, 0.06, s * (h - 0.25), roof + 0.1, barZ);
    // Rear work lamps and the beacon.
    for (const s of [-1, 1]) {
      kit.rbox(frame, 0.16, 0.12, 0.11, 0.02, s * (h - 0.3), roof + 0.2, cr - 0.02);
      kit.rbox(this.lamps.lens, 0.13, 0.09, 0.012, 0.004, s * (h - 0.3), roof + 0.2, cr - 0.08);
    }
    kit.post(frame, 0.075, 0.04, h - 0.35, roof + 0.14, cr + 0.25, 0, 0, 16);
    kit.add(
      this.lamps.beacon,
      new LatheGeometry(
        [new Vector2(0, 0.14), new Vector2(0.035, 0.135), new Vector2(0.06, 0.09), new Vector2(0.068, 0)],
        16,
      ),
      h - 0.35,
      roof + 0.16,
      cr + 0.25,
    );
    kit.post(steel, 0.006, 0.9, -(h - 0.2), roof + 0.55, cr + 0.15);
    if (this.build.airCon) {
      kit.rbox(p, 0.9, 0.14, 0.55, 0.05, 0, roof + 0.18, cr + 0.38);
      for (let k = 0; k < 6; k++) kit.box(frame, 0.8, 0.01, 0.03, 0, roof + 0.255, cr + 0.18 + k * 0.08);
    }
    if (this.build.rails) {
      const y = roof + 0.3;
      const pts = [
        new Vector3(h - 0.04, y, cr + 0.02),
        new Vector3(h - 0.04, y, cf - rake - 0.12),
        new Vector3(-h + 0.04, y, cf - rake - 0.12),
        new Vector3(-h + 0.04, y, cr + 0.02),
      ];
      kit.tube(steel, pts, 0.02, true);
      for (const v of pts) kit.post(steel, 0.016, 0.18, v.x, roof + 0.21, v.z);
    }

    // Door on the left side: seams, handle, hinges; steps up from the track and a grab rail.
    const dx = h + 0.012;
    fine.box(frame, 0.008, sill - 0.44, 0.012, dx, (sill + 0.44) / 2, zb + 0.02);
    fine.box(frame, 0.008, sill - 0.44, 0.012, dx, (sill + 0.44) / 2, cf - 0.08);
    fine.box(chrome, 0.03, 0.03, 0.14, dx + 0.015, 0.62, zb + 0.16);
    for (const y of [0.55, 1.1]) kit.box(frame, 0.04, 0.08, 0.05, dx + 0.01, y, cf - 0.1);
    this.decal(fine, 'badge', 0.1, new Vector3(dx, 0.56, (zb + cf) / 2 + 0.05), new Vector3(1, 0, 0));
    for (const [y, x0] of [
      [0.2, h - 0.02],
      [-0.06, h + 0.05],
    ] as const) {
      kit.box(tread, 0.4, 0.025, 0.36, x0 + 0.2, y, zb + 0.32);
      kit.box(frame, 0.02, 0.1, 0.36, x0 + 0.39, y - 0.04, zb + 0.32);
    }
    this.decal(
      fine,
      'step',
      0.09,
      new Vector3(h + 0.27, -0.045, zb + 0.32),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, -1),
    );
    kit.tube(
      steel,
      [
        new Vector3(dx + 0.01, 0.62, zb - 0.02),
        new Vector3(dx + 0.07, 0.66, zb - 0.02),
        new Vector3(dx + 0.07, 1.2, zb - 0.02),
        new Vector3(dx + 0.01, 1.24, zb - 0.02),
      ],
      0.016,
    );

    // Mirrors on swan-neck arms.
    for (const s of [-1, 1]) {
      const base = new Vector3(s * h, 0.92, cf - 0.12);
      const head = new Vector3(s * (h + 0.42), 1.02, cf - 0.04);
      kit.tube(frame, [base, new Vector3(s * (h + 0.2), 1.08, cf - 0.06), head], 0.016);
      kit.rbox(frame, 0.08, 0.34, 0.2, 0.03, head.x, head.y, head.z);
      fine.box(chrome, 0.012, 0.29, 0.16, head.x - s * 0.044, head.y, head.z - 0.0, 0, 0, 0);
    }
    // Wipers parked low on the windscreen.
    const up = new Vector3(0, roof - sill, -rake).normalize();
    const out = new Vector3(0, rake, roof - sill).normalize();
    for (const x of [-0.45, 0.45]) {
      const pivot = new Vector3(x, sill + 0.05, cf).addScaledVector(out, 0.03);
      const tip = pivot
        .clone()
        .addScaledVector(up, 0.5)
        .add(new Vector3(-0.32 * Math.sign(x), 0, 0));
      fine.rod(frame, 0.01, pivot, tip, 5);
      fine.rod(
        rubber,
        0.013,
        tip.clone().addScaledVector(new Vector3().subVectors(pivot, tip).normalize(), 0.42),
        tip,
        5,
      );
    }
    kit.build(this.inner);
  }

  /** Operator's seat, armrest consoles with joystick, steering wheel, dashboard with screen. */
  private buildInterior(fine: Kit): void {
    const { rear: cr, front: cf, half: h, roof, rake } = this.build.cab;
    const zc = this.cabEye.z / this.look.scale;
    fine.box(rubber, h * 2 - 0.1, 0.02, cf - cr - 0.1, 0, 0.47, (cr + cf) / 2);
    // Seat on a suspension pedestal.
    fine.post(frame, 0.08, 0.18, 0, 0.56, zc - 0.05, 0, 0, 12);
    fine.rbox(fabric, 0.5, 0.12, 0.48, 0.05, 0, 0.7, zc - 0.02);
    fine.rbox(fabric, 0.5, 0.6, 0.12, 0.05, 0, 1.02, zc - 0.28, -0.14);
    fine.rbox(fabric, 0.3, 0.16, 0.1, 0.04, 0, 1.42, zc - 0.34, -0.14);
    // Armrest consoles: joystick on the right (-x), switch panel on the left.
    for (const s of [-1, 1]) {
      fine.rbox(plastic, 0.13, 0.1, 0.46, 0.03, s * 0.34, 0.86, zc + 0.04);
      fine.post(frame, 0.04, 0.2, s * 0.34, 0.74, zc - 0.06);
    }
    fine.add(rubber, new CylinderGeometry(0.02, 0.045, 0.05, 10), -0.34, 0.935, zc + 0.12);
    fine.add(
      plastic,
      new LatheGeometry(
        [
          new Vector2(0, 0),
          new Vector2(0.022, 0.0),
          new Vector2(0.03, 0.06),
          new Vector2(0.028, 0.13),
          new Vector2(0.0, 0.15),
        ],
        12,
      ),
      -0.34,
      0.95,
      zc + 0.12,
      -0.15,
    );
    for (let k = 0; k < 3; k++)
      fine.box(this.lamps.indicator, 0.012, 0.008, 0.012, -0.34 + (k - 1) * 0.015, 1.1, zc + 0.1);
    for (let k = 0; k < 6; k++)
      fine.box(
        k % 3 === 0 ? this.lamps.indicator : frame,
        0.025,
        0.012,
        0.025,
        0.31 + (k % 2) * 0.05,
        0.915,
        zc + 0.0 + Math.floor(k / 2) * 0.06,
      );
    // Steering column and wheel.
    const colTop = new Vector3(0, 0.9, zc + 0.62);
    fine.rod(frame, 0.035, new Vector3(0, 0.6, cf - 0.18), colTop, 10);
    const wheel = new Group();
    const wheelKit = new Kit();
    wheelKit.ring(plastic, 0.15, 0.016, 'z', 0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      wheelKit.rod(
        plastic,
        0.012,
        new Vector3(0, 0, 0),
        new Vector3(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0),
        5,
      );
    }
    wheelKit.build(wheel, false);
    wheel.position.copy(colTop);
    wheel.rotation.x = -0.95;
    this.fine.add(wheel);
    // Dashboard across the front with the main screen and an instrument strip.
    const dashZ = cf - 0.24;
    fine.rbox(plastic, h * 2 - 0.16, 0.2, 0.34, 0.05, 0, 0.8, dashZ);
    fine.rbox(plastic, 0.5, 0.32, 0.05, 0.02, -0.4, 0.98, dashZ - 0.04, 0.35);
    const sw = 0.44;
    const sh = 0.26;
    // The screen leans back, facing the operator's eyes.
    const tilt = new Vector3(0, Math.cos(0.35), Math.sin(0.35));
    const out = new Vector3(0, Math.sin(0.35), -Math.cos(0.35));
    const screen = new Vector3(-0.4, 0.98, dashZ - 0.04).addScaledVector(out, 0.026);
    const corner = (dx: number, dy: number) =>
      screen
        .clone()
        .add(new Vector3(dx, 0, 0))
        .addScaledVector(tilt, dy)
        .addScaledVector(out, 0.003);
    fine.add(
      this.dashboard.material,
      quad(
        corner(sw / 2, -sh / 2),
        corner(-sw / 2, -sh / 2),
        corner(-sw / 2, sh / 2),
        corner(sw / 2, sh / 2),
      ),
    );
    for (let k = 0; k < 8; k++)
      fine.box(
        k % 4 === 1 ? this.lamps.tail : this.lamps.indicator,
        0.02,
        0.012,
        0.01,
        0.12 + k * 0.035,
        0.91,
        dashZ - 0.17,
      );
    // Pedals and the overhead switch console.
    for (const s of [-1, 1]) fine.box(plastic, 0.09, 0.02, 0.18, s * 0.12, 0.56, cf - 0.36, -0.7);
    fine.rbox(plastic, 1.0, 0.08, 0.3, 0.03, 0, roof - 0.07, cf - rake - 0.25);
    for (let k = 0; k < 10; k++)
      fine.box(
        k % 3 ? frame : this.lamps.indicator,
        0.03,
        0.01,
        0.03,
        -0.4 + k * 0.09,
        roof - 0.115,
        cf - rake - 0.2,
      );
  }

  /** Track frames, bogie arms and dampers, axles, idler tensioners, final drives and the belts. */
  private buildRunningGear(fine: Kit): void {
    const kit = new Kit();
    const belt = beltGeometry(this.path);
    for (const sx of [TRACK_X, -TRACK_X]) {
      kit.add(rubber, belt, sx, 0, 0);
      kit.box(frame, 0.16, 0.18, 3.9, sx, -0.36, 0);
      const stations = this.build.wheels;
      for (let k = 0; k < stations; k++) {
        const z = -1.95 + (3.9 * k) / (stations - 1);
        const pivot = new Vector3(sx, -0.36, z + 0.32);
        const axle = new Vector3(sx, WHEEL_Y, z);
        kit.rod(frame, 0.05, pivot, axle, 8);
        kit.drum(steel, 0.05, TWIN * 2 + 0.1, sx, WHEEL_Y, z, 10);
        fine.rod(
          chrome,
          0.018,
          new Vector3(sx, -0.3, z - 0.18),
          new Vector3(sx, WHEEL_Y + 0.08, z - 0.06),
          6,
        );
        fine.rod(frame, 0.032, new Vector3(sx, -0.3, z - 0.18), new Vector3(sx, -0.42, z - 0.13), 8);
      }
      // Idler on its tensioner.
      kit.drum(steel, 0.06, TWIN * 2 + 0.1, sx, IDLER.y, IDLER.z, 10);
      kit.rod(frame, 0.07, new Vector3(sx, -0.38, 1.5), new Vector3(sx, IDLER.y, IDLER.z - 0.2), 10);
      kit.rod(chrome, 0.035, new Vector3(sx, IDLER.y, IDLER.z - 0.25), new Vector3(sx, IDLER.y, IDLER.z), 8);
      // Final drive housing between body and sprocket.
      const inner = Math.sign(sx) * 0.95;
      kit.drum(frame, 0.22, 0.32, inner, SPROCKET.y, SPROCKET.z, 18);
    }
    kit.build(this.inner);
  }

  private buildBlade(fine: Kit, hydraulics: number): void {
    const kit = new Kit();
    const profile: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      profile.push([1.12 * t, -0.27 * Math.sin(Math.PI * t ** 0.9) + 0.2 * t * t]);
    }
    const wing = 0.9;
    const sweepAngle = 0.42;
    const hinge = this.bladeHalf - wing * Math.cos(sweepAngle);
    const tipX = hinge + wing * Math.cos(sweepAngle);
    const tipDz = wing * Math.sin(sweepAngle);
    kit.add(
      this.paint,
      sweep(profile, [
        { x: -tipX, dz: tipDz },
        { x: -hinge, dz: 0 },
        { x: hinge, dz: 0 },
        { x: tipX, dz: tipDz },
      ]),
    );
    // Stiffening ribs behind the mouldboard.
    const back: [number, number][] = profile.map(([y, z]) => [z - 0.012, y]);
    const rib: Profile = [...back, [-0.32, 1.02], [-0.32, 0.1]];
    const ribs = Math.max(4, Math.round((2 * hinge) / 0.5));
    for (let k = 0; k <= ribs; k++)
      kit.add(this.paint, extrudeX(rib, 0.035, 0.008, 1), -hinge + (2 * hinge * k) / ribs, 0, 0);
    // Wing end plates, hinge pins and the wing rams.
    const endPlate: Profile = [
      [-0.12, 0],
      [0.32, 0],
      [0.32, 0.22],
      [0.22, 1.0],
      [0.02, 1.18],
      [-0.12, 1.04],
    ];
    for (const s of [-1, 1]) {
      kit.add(
        this.paint,
        extrudeX(endPlate, 0.035, 0.008, 1),
        s * (tipX + 0.015),
        0,
        tipDz - 0.06,
        0,
        s * -sweepAngle,
        0,
      );
      kit.post(steel, 0.05, 1.18, s * hinge, 0.58, -0.3);
      kit.rod(
        frame,
        0.045,
        new Vector3(s * (hinge - 0.55), 0.6, -0.3),
        new Vector3(s * (hinge + 0.15), 0.62, -0.24),
      );
      kit.rod(
        chrome,
        0.025,
        new Vector3(s * (hinge + 0.1), 0.62, -0.25),
        new Vector3(s * (hinge + 0.42), 0.6, tipDz * 0.45 - 0.2),
      );
    }
    // Cutting edge with bolts, top rail, and the frame behind.
    const edge = 2 * hinge + 0.02;
    kit.box(steel, edge, 0.1, 0.03, 0, 0.04, 0.01, -0.2);
    for (let x = -edge / 2 + 0.12; x < edge / 2 - 0.1; x += 0.3)
      fine.add(steel, new CylinderGeometry(0.014, 0.014, 0.02, 6), x, 0.05, 0.035, Math.PI / 2 - 0.2, 0, 0);
    kit.drum(steel, 0.035, edge, 0, 1.13, 0.2, 10);
    kit.box(frame, edge - 0.16, 0.14, 0.12, 0, 0.3, -0.36);
    kit.box(frame, edge - 0.16, 0.14, 0.12, 0, 0.82, -0.36);
    const outer = hinge - 0.32;
    for (const x of [-outer, -0.7, 0.7, outer]) kit.box(frame, 0.1, 0.66, 0.1, x, 0.56, -0.36);
    kit.drum(steel, 0.12, 0.3, 0, 0.56, -0.45, 16);
    // The hydraulics upgrade carries accumulators on the blade frame.
    if (hydraulics > 0) for (const s of [-1, 1]) kit.post(steel, 0.07, 0.36, s * 1.0, 0.82, -0.48, 0, 0, 14);
    this.decal(fine, 'keepClear', 0.2, new Vector3(0, 0.56, -0.43), new Vector3(0, 0, -1));
    kit.build(this.blade);
    this.blade.add(this.berm);
    this.inner.add(this.blade);

    // Lift arms and rams between the chassis and the blade frame (instanced, aimed each frame).
    for (const s of [-1, 1]) {
      const x = s * 0.7;
      this.links.push(
        {
          kind: 'arm',
          index: 0,
          from: new Vector3(x, BLADE_PIVOT.y, BLADE_PIVOT.z),
          to: new Vector3(x, 0.3, -0.22),
          on: 'blade',
          rest: 1,
        },
        {
          kind: 'barrel',
          index: 0,
          from: new Vector3(x * 0.6, 0.12, 2.0),
          to: new Vector3(x * 0.6, 0.82, -0.3),
          on: 'blade',
          rest: 0.62,
        },
        {
          kind: 'rod',
          index: 0,
          from: new Vector3(x * 0.6, 0.12, 2.0),
          to: new Vector3(x * 0.6, 0.82, -0.3),
          on: 'blade',
          rest: 1,
        },
      );
    }
  }

  private buildTiller(finisher: number): void {
    const kit = new Kit();
    const half = this.tillerHalf;
    // Local origin is the hitch pivot; the tiller trails toward -z.
    const housing: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const a = -0.25 + (k / 12) * (Math.PI + 0.5);
      housing.push([-0.32 + 0.35 * Math.sin(a), -1.4 + 0.35 * Math.cos(a)]);
    }
    const endPlate: Profile = [...housing.map(([y, z]) => [z, y] as const).reverse()];
    for (const side of [-1, 1]) {
      kit.box(frame, 0.12, 0.14, 1.3, side * 0.55, 0.0, -0.62);
      kit.add(
        this.paint,
        sweep(housing, [
          { x: side * 0.03, dz: 0 },
          { x: side * (half - 0.01), dz: 0 },
        ]),
      );
      kit.add(frame, extrudeX(endPlate, 0.04, 0.01, 1), side * (half + 0.01), 0, 0);
      kit.drum(steel, 0.17, half - 0.08, side * (0.04 + (half - 0.08) / 2), -0.4, -1.4, 16);
      kit.box(rubber, 0.03, 0.22, 0.9, side * (half + 0.045), -0.52, -1.78);
      kit.rbox(this.lamps.indicator, 0.06, 0.06, 0.08, 0.015, side * (half - 0.08), -0.02, -1.62);
    }
    // Cutter tines in two helices round the drum.
    const tines = Math.round((2 * half - 0.1) / 0.075);
    for (let k = 0; k < tines; k++) {
      const x = -half + 0.08 + (k * (2 * half - 0.16)) / (tines - 1);
      for (const phase of [0, Math.PI]) {
        const a = x * 3.2 + phase;
        kit.box(steel, 0.025, 0.11, 0.03, x, -0.4 + Math.sin(a) * 0.2, -1.4 + Math.cos(a) * 0.2, -a, 0, 0);
      }
    }
    kit.box(frame, 0.36, 0.3, 0.5, 0, -0.14, -1.3);
    kit.box(frame, 2 * half + 0.02, 0.07, 0.1, 0, 0.02, -1.4);
    kit.box(frame, 1.3, 0.1, 0.1, 0, 0.02, -0.02);
    for (const side of [-1, 1])
      kit.tube(
        hose,
        [
          new Vector3(side * 0.2, 0.12, -0.1),
          new Vector3(side * 0.3, 0.18, -0.7),
          new Vector3(side * 0.16, 0.0, -1.2),
        ],
        0.016,
      );
    // Finisher combs: one row, plus one per finisher upgrade level.
    const rows = 1 + finisher;
    for (let r = 0; r < rows; r++) {
      const z = -1.98 - r * 0.32;
      const y = -0.5 - r * 0.02;
      kit.box(rubber, 2 * half + 0.04, 0.025, 0.62, 0, y, z, 0.16);
      const teeth = Math.round((2 * half) / 0.06);
      for (let k = 0; k < teeth; k++)
        kit.box(
          rubber,
          0.03,
          0.05,
          0.14,
          -half + 0.02 + (k * (2 * half - 0.04)) / (teeth - 1),
          y - 0.08,
          z - 0.32,
          0.16,
        );
      kit.drum(steel, 0.02, 2 * half + 0.04, 0, y + 0.08, z + 0.26, 8);
    }
    for (let k = 0; k < 6; k++)
      kit.post(steel, 0.015, 0.22, -half + 0.3 + (k * (2 * half - 0.6)) / 5, -0.36, -1.82, 0.4, 0);
    const warn = new Kit();
    this.decal(
      warn,
      'tiller',
      0.2,
      new Vector3(-half * 0.55, -0.12, -1.68),
      new Vector3(0, 0.45, -1).normalize(),
    );
    this.decal(
      warn,
      'tiller',
      0.2,
      new Vector3(half * 0.55, -0.12, -1.68),
      new Vector3(0, 0.45, -1).normalize(),
    );
    warn.build(this.tiller, false);
    kit.build(this.tiller);
    this.tiller.position.copy(TILLER_PIVOT);
    this.inner.add(this.tiller);

    for (const side of [-1, 1]) {
      const x = side * 0.3;
      const from = new Vector3(x, 0.45, -2.35);
      const to = new Vector3(x, 0.06, -1.1);
      this.links.push(
        { kind: 'barrel', index: 0, from, to, on: 'tiller', rest: 0.5 },
        { kind: 'rod', index: 0, from, to, on: 'tiller', rest: 1 },
      );
    }
  }

  /** Winch tower on the engine deck: braced legs, cable drum with motor, and a slewing boom. */
  private buildWinch(): void {
    const kit = new Kit();
    const top = this.build.hood.top;
    for (const s of [-1, 1]) {
      kit.rod(frame, 0.06, new Vector3(s * 0.72, top, -0.95), new Vector3(s * 0.6, 1.68, -1.35));
      kit.rod(frame, 0.06, new Vector3(s * 0.72, top, -2.15), new Vector3(s * 0.6, 1.68, -1.75));
      kit.rod(frame, 0.035, new Vector3(s * 0.72, top + 0.05, -0.95), new Vector3(s * 0.66, 1.4, -1.75));
      kit.rbox(this.paint, 0.08, 0.7, 0.7, 0.03, s * 0.52, 1.02, -1.55);
    }
    kit.rbox(frame, 1.36, 0.12, 1.0, 0.03, 0, 1.72, -1.55);
    // Drum: grooved cable lay between flanges, motor housing on one end.
    const lay: [number, number][] = [];
    for (let k = 0; k <= 24; k++) lay.push([k % 2 ? 0.32 : 0.335, -0.45 + (0.9 * k) / 24]);
    kit.add(steel, latheX(lay, 24), 0, 1.02, -1.55);
    for (const s of [-1, 1]) kit.drum(frame, 0.4, 0.04, s * 0.47, 1.02, -1.55, 24);
    kit.rbox(this.paint, 0.3, 0.42, 0.42, 0.06, -0.66, 1.02, -1.55);
    kit.build(this.inner);

    // Boom: pivots on the tower, carries the fairlead sheave the cable leaves from.
    const boom = new Kit();
    boom.rbox(this.paint, 0.24, 0.22, 1.9, 0.05, 0, 0, -0.9);
    for (const s of [-1, 1]) boom.box(frame, 0.02, 0.18, 1.6, s * 0.13, 0, -0.85);
    boom.drum(frame, 0.2, 0.36, 0, 0, 0, 20);
    boom.drum(steel, 0.17, 0.08, 0, -0.05, -1.85, 18);
    for (const s of [-1, 1]) boom.box(frame, 0.04, 0.42, 0.42, s * 0.07, -0.05, -1.85);
    boom.drum(steel, 0.04, 0.16, 0, 0.12, -1.72, 8);
    boom.drum(steel, 0.04, 0.16, 0, -0.22, -1.72, 8);
    boom.build(this.winchBoom);
    this.winchBoom.position.set(0, 1.86, -1.55);
    this.inner.add(this.winchBoom);
  }

  /** Exhaust outlet in model (unscaled) coordinates. */
  private exhaustLocal(): Vector3 {
    return this.scratchA.copy(this.exhaust).divideScalar(this.look.scale);
  }

  /** Swings the winch boom toward a world point (the anchor), within its travel. */
  aimWinch(worldX: number, worldZ: number): void {
    if (!this.look.winch) return;
    const local = this.scratchA.set(worldX, this.group.position.y, worldZ);
    this.group.worldToLocal(local);
    const yaw = Math.atan2(-local.x, -local.z);
    this.winchBoom.rotation.y = Math.max(-1.75, Math.min(1.75, yaw));
  }

  /** World position of the fairlead the winch cable leaves from. */
  fairlead(out: Vector3): Vector3 {
    out.set(0, -0.05, -1.85);
    return this.winchBoom.localToWorld(out);
  }

  /** Lamp brightness, 0 (off) to 1: headlights, work lights, beacon and tail lights. */
  setLights(level: number): void {
    this.lamps.level.value = level;
  }

  /** Marks this as the machine being driven: its dashboard runs; parked ones show standby. */
  setDriven(driven: boolean): void {
    if (driven === this.driven) return;
    this.driven = driven;
    if (!driven) this.dashboard.standby();
  }

  updateDashboard(dt: number, cat: Snowcat, rpm: number): void {
    if (this.driven) this.dashboard.update(dt, cat, rpm);
  }

  /** Hides small parts beyond detail range. */
  updateDetail(distance: number): void {
    this.fine.visible = distance < DETAIL_RANGE_M * this.look.scale;
  }

  /** The cab glazing is hidden when the camera sits inside the cab. */
  setInteriorView(inside: boolean): void {
    for (const mesh of this.glassMeshes) mesh.visible = !inside;
  }

  /** Releases GPU resources when the machine is rebuilt or sold. */
  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.paint.dispose();
    this.lamps.dispose();
    this.decals.map?.dispose();
    this.decals.dispose();
    this.dashboard.dispose();
  }

  private setLink(link: Link, from: Vector3, to: Vector3): void {
    const mesh = this.linkMeshes[link.kind];
    const direction = this.scratchC.subVectors(to, from);
    const length = direction.length();
    const stretch = link.kind !== 'barrel';
    this.position.copy(from).addScaledVector(direction, stretch ? 0.5 : (link.rest * 0.5) / length);
    this.quaternion.setFromUnitVectors(this.yAxis, direction.divideScalar(length));
    this.scaleV.set(1, stretch ? length : link.rest, 1);
    this.matrix.compose(this.position, this.quaternion, this.scaleV);
    mesh.setMatrixAt(link.index, this.matrix);
  }

  /** Poses the model from the simulated machine. */
  sync(cat: Snowcat): void {
    const b = cat.body;
    this.group.position.set(b.px, b.py, b.pz);
    this.group.quaternion.set(b.qx, b.qy, b.qz, b.qw);

    const scale = this.look.scale;
    this.blade.position.set(0, TRACK_BOTTOM + cat.bladeHeightM / scale, cat.spec.bladeZ / scale);
    this.tiller.rotation.x = 0.42 * (1 - cat.tillerPos);

    const volume = cat.bladeLoadKg / PUSHED_DENSITY;
    if (volume > 0.02) {
      const width = 2 * cat.spec.bladeHalfWidthM * 0.92;
      const radius = Math.sqrt((2 * volume) / (Math.PI * width));
      this.berm.visible = true;
      this.berm.scale.set(width / scale, radius / scale, (radius * 1.15) / scale);
      this.berm.position.set(0, 0, 0.25 + (radius * 0.55) / scale);
    } else {
      this.berm.visible = false;
    }

    const counters = { arm: 0, barrel: 0, rod: 0 };
    for (const link of this.links) {
      link.index = counters[link.kind]++;
      const target = link.on === 'blade' ? this.blade : this.tiller;
      const to = this.scratchB.copy(link.to).applyQuaternion(target.quaternion).add(target.position);
      this.setLink(link, this.scratchA.copy(link.from), to);
    }
    for (const mesh of Object.values(this.linkMeshes)) mesh.instanceMatrix.needsUpdate = true;

    // Wheels turn with their track's travel.
    for (let k = 0; k < this.wheelSlots.length; k++) {
      const w = this.wheelSlots[k]!;
      this.quaternion.setFromAxisAngle(this.xAxis, cat.trackTravel[w.side]! / scale / w.r);
      const g = w.r / WHEEL_R;
      this.scaleV.set(1, g, g);
      this.matrix.compose(this.position.set(w.x, w.y, w.z), this.quaternion, this.scaleV);
      this.tyres.setMatrixAt(k, this.matrix);
      this.rims.setMatrixAt(k, this.matrix);
    }
    this.tyres.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
    for (let side = 0; side < 2; side++) {
      this.quaternion.setFromAxisAngle(this.xAxis, cat.trackTravel[side]! / scale / SPROCKET.r);
      this.matrix.compose(
        this.position.set(side === 0 ? TRACK_X : -TRACK_X, SPROCKET.y, SPROCKET.z),
        this.quaternion,
        this.unit,
      );
      this.sprockets.setMatrixAt(side, this.matrix);
    }
    this.sprockets.instanceMatrix.needsUpdate = true;

    // Cleats ride the belt at a fixed spacing, advanced by belt travel.
    const path = this.path;
    const n = path.y.length;
    for (let side = 0; side < 2; side++) {
      const x = side === 0 ? TRACK_X : -TRACK_X;
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
        this.matrix.compose(this.position.set(x, y, z), this.quaternion, this.unit);
        this.cleats.setMatrixAt(side * this.cleatCount + k, this.matrix);
      }
    }
    this.cleats.instanceMatrix.needsUpdate = true;
  }
}
