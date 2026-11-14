import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import type { Snowmaking } from '../sim/snowmaking';
import type { Snowpack } from '../sim/snow/snowpack';
import type { Conditions, Weather } from '../sim/weather';
import { MIST, type Particles } from './particles';

const body = new MeshStandardNodeMaterial({ color: 0xe5e9ee, roughness: 0.45, metalness: 0.2 });
const accent = new MeshStandardNodeMaterial({ color: 0xd8331f, roughness: 0.5, metalness: 0.1 });
const frame = new MeshStandardNodeMaterial({ color: 0x2b2f34, roughness: 0.55, metalness: 0.6 });

/** A fan gun on a short tower, pointing along +z, origin on the ground. */
function fanGunParts(): [BufferGeometry, Material][] {
  const barrel = new CylinderGeometry(0.62, 0.55, 1.5, 20, 1, true).rotateX(Math.PI / 2).translate(0, 3.1, 0);
  const shell = mergeGeometries([
    barrel,
    new CylinderGeometry(0.64, 0.64, 0.12, 20).rotateX(Math.PI / 2).translate(0, 3.1, -0.75),
  ]);
  const ring = new TorusGeometry(0.58, 0.06, 8, 24).translate(0, 3.1, 0.78);
  const stand = mergeGeometries([
    new CylinderGeometry(0.1, 0.12, 2.6, 8).translate(0, 1.3, 0),
    new BoxGeometry(0.4, 0.3, 0.6).translate(0, 2.55, -0.1),
    new BoxGeometry(1.6, 0.08, 0.08).translate(0, 0.05, 0),
    new BoxGeometry(0.08, 0.08, 1.6).translate(0, 0.05, 0),
    new BoxGeometry(0.5, 0.6, 0.4).translate(0, 0.45, -0.4),
  ]);
  return [
    [shell, body],
    [ring, accent],
    [stand, frame],
  ];
}

/** Snow guns on every run with snowmaking installed, and the mist plumes of those running. */
export class SnowGunsView {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly conditions: Conditions = { tempC: 0, humidity: 0, wetBulbC: 0, windMs: 0, windToward: 0 };
  private readonly matrix = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly at = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private shown = '';
  private emit = new Float64Array(0);

  constructor(
    private readonly making: Snowmaking,
    private readonly snow: Snowpack,
  ) {
    for (const [geometry, material] of fanGunParts()) {
      const mesh = new InstancedMesh(geometry, material, making.guns.length);
      mesh.castShadow = true;
      mesh.count = 0;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.emit = new Float64Array(making.guns.length);
  }

  update(dt: number, particles: Particles, weather: Weather, camera: Vector3): void {
    const making = this.making;
    // Rebuild the instance list when installations change.
    const key = making.installed.join(',');
    if (key !== this.shown) {
      this.shown = key;
      let n = 0;
      for (const gun of making.guns) {
        if (!making.installed[gun.run]) continue;
        // Guns turn to throw into the run.
        this.q.setFromAxisAngle(this.up, Math.atan2(gun.inX, gun.inZ));
        this.matrix.compose(
          this.at.set(gun.x, this.snow.surfaceAt(gun.x, gun.z) - 0.1, gun.z),
          this.q,
          this.one,
        );
        for (const mesh of this.meshes) mesh.setMatrixAt(n, this.matrix);
        n++;
      }
      for (const mesh of this.meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }

    // Plumes: only for running guns near enough to see, to keep the particle budget for the machines.
    for (let k = 0; k < making.guns.length; k++) {
      const output = making.output[k]!;
      if (output <= 0) continue;
      const gun = making.guns[k]!;
      if (Math.hypot(gun.x - camera.x, gun.z - camera.z) > 600) continue;
      const c = weather.at(gun.y, this.conditions);
      this.emit[k]! += dt * 50 * Math.min(1, output / 4);
      const wx = Math.sin(c.windToward) * c.windMs;
      const wz = Math.cos(c.windToward) * c.windMs;
      while (this.emit[k]! >= 1) {
        this.emit[k]! -= 1;
        const speed = 9 + Math.random() * 5;
        const spread = 0.12;
        const y = this.snow.surfaceAt(gun.x, gun.z) + 3.1;
        particles.emit(
          MIST,
          gun.x + gun.inX * 0.9,
          y,
          gun.z + gun.inZ * 0.9,
          gun.inX * speed + (Math.random() - 0.5) * spread * speed + wx * 0.3,
          2.2 + Math.random() * 1.4,
          gun.inZ * speed + (Math.random() - 0.5) * spread * speed + wz * 0.3,
          2.4 + Math.random() * 1.5,
          0.4 + Math.random() * 0.4,
          0.94,
          0.96,
          1,
        );
      }
    }
  }
}
