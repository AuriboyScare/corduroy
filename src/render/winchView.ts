import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import type { Snowpack } from '../sim/snow/snowpack';
import type { Mountain } from '../sim/terrain/mountain';
import type { Machine } from '../sim/world';
import { WINCH_POST_HEIGHT_M } from '../sim/world';
import type { FleetView } from './fleetView';

const SEGMENTS = 96;
/** Weight of the cable per metre, N/m; sets how much it sags between machine and anchor. */
const CABLE_WEIGHT_N_PER_M = 22;

const steel = new MeshStandardNodeMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.9 });
const orange = new MeshStandardNodeMaterial({ color: 0xff6a13, roughness: 0.5, metalness: 0.1 });
const reflector = new MeshStandardNodeMaterial({ color: 0xf2f2f2, roughness: 0.3, metalness: 0.2 });
const concrete = new MeshStandardNodeMaterial({ color: 0x8e8c88, roughness: 0.9 });
const cableMaterial = new MeshStandardNodeMaterial({ color: 0x3b3e42, roughness: 0.45, metalness: 0.8 });

/** Anchor posts on the mountain and the cable of every hooked winch. */
export class WinchView {
  readonly group = new Group();
  private readonly cables = new Map<number, InstancedMesh>();
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly start = new Vector3();
  private readonly points = Array.from({ length: SEGMENTS + 1 }, () => new Vector3());
  private readonly segment = new CylinderGeometry(0.022, 0.022, 1, 6);

  constructor(
    mountain: Mountain,
    private readonly snow: Snowpack,
  ) {
    const parts = new Map<Material, BufferGeometry[]>();
    const add = (material: Material, geometry: BufferGeometry): void => {
      const list = parts.get(material);
      if (list) list.push(geometry);
      else parts.set(material, [geometry]);
    };
    for (const anchor of mountain.winchAnchors) {
      const y = mountain.grid.sample(mountain.ground, anchor.x, anchor.z);
      add(concrete, new BoxGeometry(1.4, 0.8, 1.4).translate(anchor.x, y + 0.1, anchor.z));
      add(
        steel,
        new CylinderGeometry(0.14, 0.16, WINCH_POST_HEIGHT_M, 12).translate(
          anchor.x,
          y + WINCH_POST_HEIGHT_M / 2,
          anchor.z,
        ),
      );
      add(
        steel,
        new TorusGeometry(0.16, 0.035, 8, 16).translate(anchor.x, y + WINCH_POST_HEIGHT_M, anchor.z),
      );
      // A tall marker pole so the anchor can be found in deep snow and bad light.
      add(orange, new CylinderGeometry(0.035, 0.035, 4.2, 8).translate(anchor.x + 0.5, y + 2.1, anchor.z));
      for (const h of [2.6, 3.2, 3.8])
        add(reflector, new CylinderGeometry(0.04, 0.04, 0.18, 8).translate(anchor.x + 0.5, y + h, anchor.z));
    }
    for (const [material, list] of parts) {
      const mesh = new Mesh(mergeGeometries(list), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Draws each hooked cable from the winch boom to its anchor, sagging and resting on the snow. */
  sync(machines: readonly Machine[], fleet: FleetView): void {
    for (const machine of machines) {
      const uid = machine.owned.uid;
      const anchor = machine.vehicle.winchAnchor;
      let cable = this.cables.get(uid);
      const model = fleet.model(uid);
      if (!anchor || !model) {
        if (cable) cable.visible = false;
        model?.aimWinch(machine.vehicle.body.px, machine.vehicle.body.pz - 1);
        continue;
      }
      if (!cable) {
        cable = new InstancedMesh(this.segment, cableMaterial, SEGMENTS);
        cable.frustumCulled = false;
        cable.castShadow = true;
        this.cables.set(uid, cable);
        this.group.add(cable);
      }
      cable.visible = true;
      model.aimWinch(anchor.x, anchor.z);
      model.group.updateMatrixWorld(true);
      model.fairlead(this.start);

      // Parabolic sag from the cable's own weight under the current pull; it cannot go below the snow.
      const length = this.start.distanceTo(this.a.set(anchor.x, anchor.y, anchor.z));
      const tension = Math.max(2000, machine.vehicle.winchForceN);
      const sag = Math.min(length * 0.25, (CABLE_WEIGHT_N_PER_M * length * length) / (8 * tension));
      for (let k = 0; k <= SEGMENTS; k++) {
        const t = k / SEGMENTS;
        const p = this.points[k]!.lerpVectors(this.start, this.a, t);
        p.y -= 4 * sag * t * (1 - t);
        const ground = this.snow.surfaceAt(p.x, p.z) + 0.03;
        if (p.y < ground) p.y = ground;
      }
      for (let k = 0; k < SEGMENTS; k++) {
        const p = this.points[k]!;
        const q = this.points[k + 1]!;
        const d = this.b.subVectors(q, p);
        const len = d.length();
        this.quaternion.setFromUnitVectors(this.up, d.divideScalar(Math.max(1e-6, len)));
        this.matrix.compose(
          this.b.addVectors(p, q).multiplyScalar(0.5),
          this.quaternion,
          this.scale.set(1, len, 1),
        );
        cable.setMatrixAt(k, this.matrix);
      }
      cable.instanceMatrix.needsUpdate = true;
    }
  }
}
